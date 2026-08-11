/**
 * Beacon MCP routes — OAuth-style authorization + Streamable JSON-RPC /mcp.
 * Never exposes private keys. Safe + app policy remain the spend boundary.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Redis } from "@upstash/redis";
import {
  AppError,
  type BeaconEnv,
  executeBeaconSafeSwap,
  prepareBeaconAgentBridge,
  executeBeaconAgentBridge,
  readAgentVaultStatus,
  readFassetsDesk,
  readFtsoFeeds,
  buildMarketIntelligence,
  readPortfolioDesk,
  readYieldVaultDesk,
  discoverFxrpOftRoutes,
  prepareFassetsRedeemLots,
  agentBridgeReadiness,
} from "@beacon/shared";
import { SERVICE_CATALOG } from "@beacon/quote";
import {
  appendAudit,
  buildCursorMcpConfig,
  buildSetupPrompt,
  checkRateLimit,
  DEFAULT_CONNECT_SCOPES,
  filterValidScopes,
  gateTool,
  getGrant,
  handleMcpJsonRpc,
  hashToken,
  isGrantActive,
  issueMcpAccessToken,
  issueMcpRefreshToken,
  listAudit,
  listGrantsForWallet,
  newAuthCode,
  newGrantId,
  revokeAllGrantsForWallet,
  revokeGrant,
  saveGrant,
  toolsForGrant,
  verifyMcpAccessToken,
  verifyMcpRefreshToken,
  type McpClientKind,
  type McpGrant,
  type RedisLike,
  MCP_ACCESS_TTL_SECONDS,
} from "@beacon/mcp";
import {
  DEFAULT_SECURITY_POLICY,
  assertPolicyAllows,
  getDailySpendUsdt0,
  loadPolicy,
  recordSpendUsdt0,
  type BeaconSecurityPolicy,
} from "./securityPolicy.js";

type Deps = {
  env: BeaconEnv;
  redis: Redis | null;
  requireSafeSession: (req: FastifyRequest, wallet: string) => Promise<void>;
  bearerToken: (req: FastifyRequest) => string | null;
  createJob?: (opts: {
    serviceId: string;
    briefText: string;
  }) => Promise<{ jobId: string; status: string }>;
};

function asRedis(redis: Redis): RedisLike {
  return redis as unknown as RedisLike;
}

function publicApiBase(env: BeaconEnv): string {
  return (env.API_URL || "http://localhost:3001").replace(/\/$/, "");
}

function publicWebBase(env: BeaconEnv): string {
  return (env.APP_URL || "http://localhost:5173").replace(/\/$/, "");
}

async function loadPolicySnapshot(
  redis: Redis | null,
  wallet: string,
): Promise<{ policy: BeaconSecurityPolicy; spentTodayUsdt0: number }> {
  const policy = redis
    ? (await loadPolicy(redis, wallet)).policy
    : { ...DEFAULT_SECURITY_POLICY };
  const spentTodayUsdt0 = redis ? await getDailySpendUsdt0(redis, wallet) : 0;
  return { policy, spentTodayUsdt0 };
}

async function resolveMcpGrantFromRequest(
  req: FastifyRequest,
  deps: Deps,
): Promise<McpGrant> {
  if (!deps.redis) {
    throw new AppError("SERVICE_UNAVAILABLE", {
      message: "Redis required for Beacon MCP authorizations.",
      details: { code: "MCP_REDIS_REQUIRED" },
    });
  }
  const token = deps.bearerToken(req);
  if (!token) {
    throw new AppError("UNAUTHORIZED", {
      message: "Beacon MCP requires Authorization: Bearer <access_token>.",
      details: { code: "MCP_TOKEN_REQUIRED" },
    });
  }
  const access = verifyMcpAccessToken(token, deps.env.SESSION_SECRET);
  if (!access) {
    throw new AppError("UNAUTHORIZED", {
      message: "Invalid or expired MCP access token.",
      details: { code: "MCP_TOKEN_INVALID" },
    });
  }
  const grant = await getGrant(asRedis(deps.redis), access.grantId);
  if (!grant || grant.wallet !== access.wallet) {
    throw new AppError("UNAUTHORIZED", {
      message: "MCP grant not found for this token.",
      details: { code: "MCP_GRANT_MISSING" },
    });
  }
  const active = isGrantActive(grant);
  if (!active.ok) {
    throw new AppError("UNAUTHORIZED", {
      message: `MCP grant inactive: ${active.reason}`,
      details: { code: active.reason },
    });
  }
  return grant;
}

export async function registerMcpRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const { env, redis } = deps;

  app.get("/.well-known/oauth-protected-resource", async () => ({
    resource: `${publicApiBase(env)}/mcp`,
    authorization_servers: [publicApiBase(env)],
    scopes_supported: [
      ...DEFAULT_CONNECT_SCOPES,
      "exec:bridge",
      "exec:job",
      "exec:x402",
      "exec:fassets_redeem",
      "read:signals",
    ],
    bearer_methods_supported: ["header"],
    resource_documentation: `${publicWebBase(env)}/mcp`,
  }));

  app.get("/.well-known/oauth-authorization-server", async () => ({
    issuer: publicApiBase(env),
    authorization_endpoint: `${publicWebBase(env)}/mcp`,
    token_endpoint: `${publicApiBase(env)}/v1/mcp/oauth/token`,
    registration_endpoint: `${publicApiBase(env)}/v1/mcp/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
    scopes_supported: DEFAULT_CONNECT_SCOPES,
  }));

  app.get("/v1/mcp/health", async () => ({
    ok: true,
    service: "beacon-mcp",
    redis: Boolean(redis),
    endpoint: `${publicApiBase(env)}/mcp`,
    connectPage: `${publicWebBase(env)}/mcp`,
  }));

  app.get("/v1/mcp/grants", async (req) => {
    const q = z
      .object({ wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/i) })
      .parse(req.query ?? {});
    await deps.requireSafeSession(req, q.wallet);
    if (!redis) {
      throw new AppError("SERVICE_UNAVAILABLE", { message: "Redis required for MCP grants." });
    }
    const grants = await listGrantsForWallet(asRedis(redis), q.wallet);
    return {
      ok: true,
      grants: grants.map((g) => ({
        ...g,
        refreshTokenHash: undefined,
        active: isGrantActive(g).ok,
      })),
    };
  });

  app.post("/v1/mcp/grants", async (req) => {
    const body = z
      .object({
        wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/i),
        clientKind: z.enum(["claude", "cursor", "generic"]).default("generic"),
        clientLabel: z.string().min(1).max(80).optional(),
        scopes: z.array(z.string()).optional(),
        maxSpendPerTxUsdt0: z.number().positive().max(50).default(5),
        dailyLimitUsdt0: z.number().positive().max(200).default(20),
        ttlHours: z.number().int().min(1).max(24 * 30).default(24 * 7),
      })
      .parse(req.body ?? {});
    await deps.requireSafeSession(req, body.wallet);
    if (!redis) {
      throw new AppError("SERVICE_UNAVAILABLE", { message: "Redis required for MCP grants." });
    }

    const vault = await readAgentVaultStatus({
      wallet: body.wallet,
      personalOnly: true,
      env,
    });
    const scopes = filterValidScopes(body.scopes?.length ? body.scopes : DEFAULT_CONNECT_SCOPES);
    if (!scopes.length) {
      throw new AppError("VALIDATION", { message: "At least one valid scope required." });
    }

    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + body.ttlHours * 3600;
    const grantId = newGrantId();
    const refresh = issueMcpRefreshToken({
      grantId,
      wallet: body.wallet,
      secret: env.SESSION_SECRET,
      expiresAt,
    });
    const access = issueMcpAccessToken({
      grantId,
      wallet: body.wallet,
      secret: env.SESSION_SECRET,
    });

    const grant: McpGrant = {
      id: grantId,
      wallet: body.wallet.toLowerCase(),
      safeAddress: vault.configured ? vault.address : null,
      clientKind: body.clientKind as McpClientKind,
      clientLabel:
        body.clientLabel ||
        (body.clientKind === "claude"
          ? "Claude"
          : body.clientKind === "cursor"
            ? "Cursor"
            : "MCP client"),
      scopes,
      maxSpendPerTxUsdt0: body.maxSpendPerTxUsdt0,
      dailyLimitUsdt0: body.dailyLimitUsdt0,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(expiresAt * 1000).toISOString(),
      revokedAt: null,
      refreshTokenHash: hashToken(refresh),
    };
    await saveGrant(asRedis(redis), grant);
    await appendAudit(asRedis(redis), {
      at: new Date().toISOString(),
      grantId,
      wallet: grant.wallet,
      tool: "grant.create",
      ok: true,
      detail: `Created ${grant.clientLabel} grant`,
    });

    const cursorConfig = buildCursorMcpConfig({
      apiBase: publicApiBase(env),
      accessToken: access.token,
    });
    const setupPrompt = buildSetupPrompt({
      apiBase: publicApiBase(env),
      webBase: publicWebBase(env),
      grantId,
      wallet: grant.wallet,
      scopes,
      maxSpendPerTxUsdt0: grant.maxSpendPerTxUsdt0,
      dailyLimitUsdt0: grant.dailyLimitUsdt0,
      expiresAt: grant.expiresAt,
      clientKind: grant.clientKind,
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken: refresh,
      mcpEndpoint: `${publicApiBase(env)}/mcp`,
      cursorConfig,
    });

    return {
      ok: true,
      grant: { ...grant, refreshTokenHash: undefined },
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken: refresh,
      mcpEndpoint: `${publicApiBase(env)}/mcp`,
      cursorConfig,
      setupPrompt,
      warning:
        "Copy tokens now. Access tokens expire in 1 hour; use refresh_token to renew. Never paste refresh tokens into public chats.",
    };
  });

  app.delete("/v1/mcp/grants/:id", async (req) => {
    const params = z.object({ id: z.string().min(8) }).parse(req.params);
    const body = z
      .object({ wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/i) })
      .parse({
        ...((req.body as object) ?? {}),
        ...((req.query as object) ?? {}),
      });
    await deps.requireSafeSession(req, body.wallet);
    if (!redis) {
      throw new AppError("SERVICE_UNAVAILABLE", { message: "Redis required for MCP grants." });
    }
    const existing = await getGrant(asRedis(redis), params.id);
    if (!existing || existing.wallet !== body.wallet.toLowerCase()) {
      throw new AppError("JOB_NOT_FOUND", { message: "Grant not found for this wallet." });
    }
    const revoked = await revokeGrant(asRedis(redis), params.id);
    await appendAudit(asRedis(redis), {
      at: new Date().toISOString(),
      grantId: params.id,
      wallet: body.wallet.toLowerCase(),
      tool: "grant.revoke",
      ok: true,
      detail: "User revoked MCP grant",
    });
    return { ok: true, grant: revoked ? { ...revoked, refreshTokenHash: undefined } : null };
  });

  app.post("/v1/mcp/grants/:id/revoke", async (req) => {
    const params = z.object({ id: z.string().min(8) }).parse(req.params);
    const body = z
      .object({ wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/i) })
      .parse(req.body ?? {});
    await deps.requireSafeSession(req, body.wallet);
    if (!redis) {
      throw new AppError("SERVICE_UNAVAILABLE", { message: "Redis required for MCP grants." });
    }
    const existing = await getGrant(asRedis(redis), params.id);
    if (!existing || existing.wallet !== body.wallet.toLowerCase()) {
      throw new AppError("JOB_NOT_FOUND", { message: "Grant not found for this wallet." });
    }
    const revoked = await revokeGrant(asRedis(redis), params.id);
    await appendAudit(asRedis(redis), {
      at: new Date().toISOString(),
      grantId: params.id,
      wallet: body.wallet.toLowerCase(),
      tool: "grant.revoke",
      ok: true,
      detail: "User revoked MCP grant",
    });
    return { ok: true, grant: revoked ? { ...revoked, refreshTokenHash: undefined } : null };
  });

  app.get("/v1/mcp/grants/:id/activity", async (req) => {
    const params = z.object({ id: z.string().min(8) }).parse(req.params);
    const q = z
      .object({ wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/i) })
      .parse(req.query ?? {});
    await deps.requireSafeSession(req, q.wallet);
    if (!redis) {
      throw new AppError("SERVICE_UNAVAILABLE", { message: "Redis required for MCP grants." });
    }
    const existing = await getGrant(asRedis(redis), params.id);
    if (!existing || existing.wallet !== q.wallet.toLowerCase()) {
      throw new AppError("JOB_NOT_FOUND", { message: "Grant not found for this wallet." });
    }
    const events = await listAudit(asRedis(redis), params.id, 50);
    return { ok: true, events };
  });

  app.post("/v1/mcp/test", async (req) => {
    const grant = await resolveMcpGrantFromRequest(req, deps);
    const { policy, spentTodayUsdt0 } = await loadPolicySnapshot(redis, grant.wallet);
    return {
      ok: true,
      message: "Beacon connected.",
      safe: grant.safeAddress,
      wallet: grant.wallet,
      permissions: grant.scopes,
      perTransactionLimit: grant.maxSpendPerTxUsdt0,
      dailyLimit: grant.dailyLimitUsdt0,
      appDailyRemaining: Math.max(0, policy.dailySpendUsdt0 - spentTodayUsdt0),
      emergencyPause: policy.emergencyPause,
      availableActions: toolsForGrant(grant).map((t) => t.name),
      expiresAt: grant.expiresAt,
    };
  });

  app.post("/v1/mcp/oauth/register", async (req) => {
    const body = z
      .object({
        client_name: z.string().max(80).optional(),
        redirect_uris: z.array(z.string().url()).min(1),
        token_endpoint_auth_method: z.string().optional(),
      })
      .parse(req.body ?? {});
    const clientId = `beacon_mcp_${newGrantId().slice(4)}`;
    if (redis) {
      await redis.set(
        `mcp:oauth-client:${clientId}`,
        {
          client_id: clientId,
          client_name: body.client_name ?? "MCP client",
          redirect_uris: body.redirect_uris,
          created_at: new Date().toISOString(),
        },
        { ex: 90 * 24 * 3600 },
      );
    }
    return {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      token_endpoint_auth_method: "none",
      redirect_uris: body.redirect_uris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    };
  });

  app.post("/v1/mcp/oauth/code", async (req) => {
    const body = z
      .object({
        wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/i),
        grantId: z.string().min(8),
        codeChallenge: z.string().min(20),
        codeChallengeMethod: z.literal("S256").default("S256"),
        redirectUri: z.string().url(),
        clientId: z.string().min(3),
        state: z.string().max(200).optional(),
      })
      .parse(req.body ?? {});
    await deps.requireSafeSession(req, body.wallet);
    if (!redis) {
      throw new AppError("SERVICE_UNAVAILABLE", { message: "Redis required for OAuth codes." });
    }
    const grant = await getGrant(asRedis(redis), body.grantId);
    if (!grant || grant.wallet !== body.wallet.toLowerCase() || !isGrantActive(grant).ok) {
      throw new AppError("VALIDATION", { message: "Active grant required." });
    }
    const code = newAuthCode();
    await redis.set(
      `mcp:oauth-code:${code}`,
      {
        grantId: grant.id,
        wallet: grant.wallet,
        codeChallenge: body.codeChallenge,
        codeChallengeMethod: body.codeChallengeMethod,
        redirectUri: body.redirectUri,
        clientId: body.clientId,
        createdAt: Date.now(),
      },
      { ex: 5 * 60 },
    );
    return { ok: true, code, state: body.state ?? null, expiresIn: 300 };
  });

  app.post("/v1/mcp/oauth/token", async (req) => {
    if (!redis) {
      throw new AppError("SERVICE_UNAVAILABLE", { message: "Redis required for token exchange." });
    }
    const body = z
      .object({
        grant_type: z.enum(["authorization_code", "refresh_token"]),
        code: z.string().optional(),
        refresh_token: z.string().optional(),
        code_verifier: z.string().optional(),
        redirect_uri: z.string().optional(),
        client_id: z.string().optional(),
      })
      .parse(req.body ?? {});

    if (body.grant_type === "refresh_token") {
      if (!body.refresh_token) {
        throw new AppError("VALIDATION", { message: "refresh_token required" });
      }
      const parsed = verifyMcpRefreshToken(body.refresh_token, env.SESSION_SECRET);
      if (!parsed) {
        throw new AppError("UNAUTHORIZED", { message: "Invalid refresh_token" });
      }
      const grant = await getGrant(asRedis(redis), parsed.grantId);
      if (
        !grant ||
        grant.wallet !== parsed.wallet ||
        !isGrantActive(grant).ok ||
        !grant.refreshTokenHash ||
        grant.refreshTokenHash !== hashToken(body.refresh_token)
      ) {
        throw new AppError("UNAUTHORIZED", { message: "Refresh not allowed for this grant." });
      }
      const access = issueMcpAccessToken({
        grantId: grant.id,
        wallet: grant.wallet,
        secret: env.SESSION_SECRET,
      });
      return {
        access_token: access.token,
        token_type: "bearer",
        expires_in: MCP_ACCESS_TTL_SECONDS,
        refresh_token: body.refresh_token,
        scope: grant.scopes.join(" "),
      };
    }

    if (!body.code || !body.code_verifier || !body.redirect_uri) {
      throw new AppError("VALIDATION", {
        message: "code, code_verifier, redirect_uri required",
      });
    }
    const stored = await redis.get<{
      grantId: string;
      wallet: string;
      codeChallenge: string;
      redirectUri: string;
      clientId: string;
    }>(`mcp:oauth-code:${body.code}`);
    if (!stored) {
      throw new AppError("UNAUTHORIZED", { message: "Invalid or expired authorization code." });
    }
    await redis.del(`mcp:oauth-code:${body.code}`);
    if (stored.redirectUri !== body.redirect_uri) {
      throw new AppError("UNAUTHORIZED", { message: "redirect_uri mismatch" });
    }
    const challenge = createHash("sha256").update(body.code_verifier).digest("base64url");
    if (challenge !== stored.codeChallenge) {
      throw new AppError("UNAUTHORIZED", { message: "PKCE verification failed" });
    }
    const grant = await getGrant(asRedis(redis), stored.grantId);
    if (!grant || !isGrantActive(grant).ok) {
      throw new AppError("UNAUTHORIZED", { message: "Grant inactive" });
    }
    const access = issueMcpAccessToken({
      grantId: grant.id,
      wallet: grant.wallet,
      secret: env.SESSION_SECRET,
    });
    let refresh: string | undefined;
    if (!grant.refreshTokenHash) {
      refresh = issueMcpRefreshToken({
        grantId: grant.id,
        wallet: grant.wallet,
        secret: env.SESSION_SECRET,
        expiresAt: Math.floor(Date.parse(grant.expiresAt) / 1000),
      });
      await saveGrant(asRedis(redis), {
        ...grant,
        refreshTokenHash: hashToken(refresh),
      });
    }
    return {
      access_token: access.token,
      token_type: "bearer",
      expires_in: MCP_ACCESS_TTL_SECONDS,
      refresh_token: refresh,
      scope: grant.scopes.join(" "),
    };
  });

  async function runTool(grant: McpGrant, name: string, args: Record<string, unknown>) {
    if (!redis) {
      return {
        content: [{ type: "text" as const, text: "Redis required for MCP tool calls." }],
        isError: true,
      };
    }
    const rate = await checkRateLimit(asRedis(redis), grant.id);
    if (!rate.ok) {
      return {
        content: [
          { type: "text" as const, text: JSON.stringify({ ok: false, error: rate.reason }) },
        ],
        isError: true,
      };
    }

    const { policy, spentTodayUsdt0 } = await loadPolicySnapshot(redis, grant.wallet);
    const gated = gateTool(grant, name, args, {
      emergencyPause: policy.emergencyPause,
      dailySpendUsdt0: policy.dailySpendUsdt0,
      perJobLimitUsdt0: policy.perJobLimitUsdt0,
      spentTodayUsdt0,
    });
    if (!gated.ok) {
      await appendAudit(asRedis(redis), {
        at: new Date().toISOString(),
        grantId: grant.id,
        wallet: grant.wallet,
        tool: name,
        ok: false,
        detail: `${gated.code}: ${gated.message}`,
        amountUsdt0: typeof args.amountUsdt0 === "number" ? args.amountUsdt0 : undefined,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              ok: false,
              code: gated.code,
              message: gated.message,
            }),
          },
        ],
        isError: true,
      };
    }

    try {
      const result = await executeMcpTool({
        env,
        redis,
        grant,
        name,
        args,
        policy,
        createJob: deps.createJob,
      });
      await appendAudit(asRedis(redis), {
        at: new Date().toISOString(),
        grantId: grant.id,
        wallet: grant.wallet,
        tool: name,
        ok: !result.isError,
        detail: result.summary,
        amountUsdt0: gated.amountUsdt0 || undefined,
        txHash: result.txHash,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result.payload, null, 2) }],
        isError: result.isError,
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await appendAudit(asRedis(redis), {
        at: new Date().toISOString(),
        grantId: grant.id,
        wallet: grant.wallet,
        tool: name,
        ok: false,
        detail: message.slice(0, 500),
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: message }) }],
        isError: true,
      };
    }
  }

  const mcpHandler = async (req: FastifyRequest, reply: import("fastify").FastifyReply) => {
    try {
      const grant = await resolveMcpGrantFromRequest(req, deps);
      const body = (req.body ?? {}) as {
        jsonrpc?: string;
        id?: string | number | null;
        method?: string;
        params?: unknown;
      };
      if (!body.method) {
        reply.code(400);
        return { error: "JSON-RPC method required" };
      }
      const response = await handleMcpJsonRpc(
        {
          jsonrpc: "2.0",
          id: body.id ?? null,
          method: body.method,
          params: body.params,
        },
        grant,
        (toolName, toolArgs) => runTool(grant, toolName, toolArgs),
      );
      reply.header("Content-Type", "application/json");
      return response;
    } catch (e) {
      if (e instanceof AppError) {
        reply.code(
          e.code === "UNAUTHORIZED"
            ? 401
            : e.code === "JOB_NOT_FOUND"
              ? 404
              : e.code === "SERVICE_UNAVAILABLE"
                ? 503
                : 400,
        );
        reply.header(
          "WWW-Authenticate",
          `Bearer realm="beacon-mcp", resource_metadata="${publicApiBase(env)}/.well-known/oauth-protected-resource"`,
        );
        return {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32000, message: e.message, data: e.details },
        };
      }
      throw e;
    }
  };

  app.post("/mcp", mcpHandler);
  app.post("/v1/mcp", mcpHandler);
  app.get("/mcp", async () => ({
    name: "beacon-mcp",
    version: "0.1.0",
    transport: "streamable-http-jsonrpc",
    documentation: `${publicWebBase(env)}/mcp`,
    auth: "Bearer MCP access token from Connect Agents",
  }));
}

async function executeMcpTool(opts: {
  env: BeaconEnv;
  redis: Redis;
  grant: McpGrant;
  name: string;
  args: Record<string, unknown>;
  policy: BeaconSecurityPolicy;
  createJob?: Deps["createJob"];
}): Promise<{ payload: unknown; summary: string; isError: boolean; txHash?: string }> {
  const { env, redis, grant, name, args } = opts;
  const wallet = grant.wallet;

  if (name === "get_safe" || name === "get_balance") {
    const status = await readAgentVaultStatus({ wallet, personalOnly: true, env });
    return {
      payload: { ok: true, status },
      summary: status.configured ? `Safe ${status.address}` : "Safe not created",
      isError: false,
    };
  }

  if (name === "get_portfolio") {
    const [status, desk] = await Promise.all([
      readAgentVaultStatus({ wallet, personalOnly: true, env }),
      readPortfolioDesk(wallet, env).catch((e) => ({
        error: e instanceof Error ? e.message : String(e),
      })),
    ]);
    return {
      payload: { ok: true, safe: status, desk },
      summary: "portfolio",
      isError: false,
    };
  }

  if (name === "get_policy" || name === "get_supported_actions") {
    const spentTodayUsdt0 = await getDailySpendUsdt0(redis, wallet);
    return {
      payload: {
        ok: true,
        mcp: {
          scopes: grant.scopes,
          maxSpendPerTxUsdt0: grant.maxSpendPerTxUsdt0,
          dailyLimitUsdt0: grant.dailyLimitUsdt0,
          expiresAt: grant.expiresAt,
        },
        appPolicy: opts.policy,
        spentTodayUsdt0,
        tools: toolsForGrant(grant).map((t) => t.name),
        flowMap: {
          swap: "Safe MockUSDT0→FXRP on Coston2",
          bridge: "Agent OFT FXRP Coston2→peer (use get_bridge_routes)",
          signals: "get_signals",
          yield: "get_yield",
          fassets: "get_fassets / fassets_redeem",
          jobs: "create_job",
          x402: "x402_pay",
        },
      },
      summary: "policy snapshot",
      isError: false,
    };
  }

  if (name === "get_activity") {
    const limit = typeof args.limit === "number" ? args.limit : 20;
    const events = await listAudit(redis as unknown as RedisLike, grant.id, limit);
    return { payload: { ok: true, events }, summary: `activity ${events.length}`, isError: false };
  }

  if (name === "get_job" || name === "get_job_status") {
    const jobId = String(args.jobId ?? "");
    return {
      payload: {
        ok: true,
        jobId,
        note: "Open Beacon Jobs (/flow/desk) for full detail when job exists.",
        wallet,
      },
      summary: `job ${jobId}`,
      isError: false,
    };
  }

  if (name === "get_execution") {
    return {
      payload: {
        ok: true,
        executionId: String(args.executionId ?? ""),
        note: "Open Beacon receipts for explorer links when available.",
      },
      summary: "execution lookup",
      isError: false,
    };
  }

  if (name === "get_signals") {
    try {
      const [ftso, intel] = await Promise.all([
        readFtsoFeeds(env),
        buildMarketIntelligence({ env }).catch(() => null),
      ]);
      return {
        payload: { ok: true, ftso, intel },
        summary: "signals",
        isError: false,
      };
    } catch (e) {
      return {
        payload: { ok: false, error: e instanceof Error ? e.message : String(e) },
        summary: "signals error",
        isError: true,
      };
    }
  }

  if (name === "get_yield") {
    try {
      const desk = await readYieldVaultDesk({ env });
      return { payload: { ok: true, desk }, summary: "yield", isError: false };
    } catch (e) {
      return {
        payload: { ok: false, error: e instanceof Error ? e.message : String(e) },
        summary: "yield error",
        isError: true,
      };
    }
  }

  if (name === "get_bridge_routes") {
    try {
      const [discovered, ready] = await Promise.all([
        discoverFxrpOftRoutes(env),
        agentBridgeReadiness(env),
      ]);
      return {
        payload: {
          ok: true,
          routes: discovered.routes,
          readiness: ready,
          tip: 'Use destination names exactly, e.g. "Sepolia" or "Base Sepolia".',
        },
        summary: "bridge routes",
        isError: false,
      };
    } catch (e) {
      return {
        payload: { ok: false, error: e instanceof Error ? e.message : String(e) },
        summary: "routes error",
        isError: true,
      };
    }
  }

  if (name === "get_fassets") {
    try {
      const desk = await readFassetsDesk(env);
      return { payload: { ok: true, desk }, summary: "fassets", isError: false };
    } catch (e) {
      return {
        payload: { ok: false, error: e instanceof Error ? e.message : String(e) },
        summary: "fassets error",
        isError: true,
      };
    }
  }

  if (name === "swap") {
    const amountUsdt0 = Number(args.amountUsdt0);
    await assertPolicyAllows(redis, {
      wallet,
      agentId: "swap",
      amountUsdt0,
    });
    const st = await readAgentVaultStatus({ wallet, personalOnly: true, env });
    if (!st.configured || !st.address) {
      return {
        payload: { ok: false, code: "SAFE_NOT_CREATED", message: "Create Beacon Safe first." },
        summary: "SAFE_NOT_CREATED",
        isError: true,
      };
    }
    const result = await executeBeaconSafeSwap(
      {
        amountInUnits: String(amountUsdt0),
        recipient: wallet,
        address: st.address,
      },
      env,
    );
    if (!result.ok) {
      return {
        payload: result,
        summary: result.error ?? "swap failed",
        isError: true,
      };
    }
    await recordSpendUsdt0(redis, wallet, amountUsdt0);
    return {
      payload: {
        ok: true,
        rail: "safe_swap_coston2",
        pair: "MockUSDT0→FXRP",
        result,
        explorer: result.explorerSpend,
        explorerFulfill: result.explorerFulfill,
      },
      summary: "swap ok",
      isError: false,
      txHash: result.spendHash,
    };
  }

  if (name === "bridge") {
    const amountFxrp = Number(
      typeof args.amountFxrp === "number" ? args.amountFxrp : args.amountUsdt0,
    );
    if (!(amountFxrp > 0)) {
      return {
        payload: {
          ok: false,
          code: "INVALID_AMOUNT",
          message: "bridge requires amountFxrp (or amountUsdt0 alias).",
        },
        summary: "INVALID_AMOUNT",
        isError: true,
      };
    }
    const destination =
      typeof args.destination === "string" && args.destination.trim()
        ? args.destination.trim()
        : "Sepolia";
    await assertPolicyAllows(redis, {
      wallet,
      agentId: "bridge",
      amountUsdt0: amountFxrp,
    });
    const bridgeParams = {
      amountFxrpUnits: String(amountFxrp),
      recipient: wallet,
      destination,
      preferSafeFunding: true,
    };
    const prep = await prepareBeaconAgentBridge(bridgeParams, env);
    if (!prep.ok) {
      return { payload: prep, summary: prep.error ?? "bridge prep failed", isError: true };
    }
    const result = await executeBeaconAgentBridge(bridgeParams, env);
    if (result.ok) await recordSpendUsdt0(redis, wallet, amountFxrp);
    return {
      payload: {
        ...result,
        rail: "agent_oft_coston2",
        note: "Destination delivery is tracked on LayerZero Scan; Coston2 is the source chain for policy.",
      },
      summary: result.ok ? "bridge ok" : result.error ?? "bridge failed",
      isError: !result.ok,
      txHash: result.ok ? result.sendHash : undefined,
    };
  }

  if (name === "create_job") {
    const service = String(args.service ?? "");
    const brief = String(args.brief ?? "");
    const allowed = new Set(SERVICE_CATALOG.map((s) => s.id as string));
    if (!allowed.has(service)) {
      return {
        payload: {
          ok: false,
          code: "UNKNOWN_SERVICE",
          message: `Unknown service. Use one of: ${[...allowed].join(", ")}`,
        },
        summary: "UNKNOWN_SERVICE",
        isError: true,
      };
    }
    if (!opts.createJob) {
      return {
        payload: {
          ok: true,
          service,
          brief: brief.slice(0, 200),
          next: "Open Beacon Jobs (/flow/desk) to quote + approve from Safe.",
        },
        summary: "job intent",
        isError: false,
      };
    }
    const created = await opts.createJob({ serviceId: service, briefText: brief });
    return {
      payload: {
        ok: true,
        ...created,
        desk: "https://beacon-desk.vercel.app/flow/desk",
        next: "Quote and approve from Safe on Jobs desk (or continue via get_job_status).",
      },
      summary: `job ${created.jobId}`,
      isError: false,
    };
  }

  if (name === "x402_pay") {
    const amountUsdt0 = Number(args.amountUsdt0);
    await assertPolicyAllows(redis, {
      wallet,
      agentId: "pay",
      amountUsdt0,
    });
    const resource = String(args.resource ?? "research");
    return {
      payload: {
        ok: true,
        amountUsdt0,
        resource,
        honesty:
          "x402 settlement needs owner EIP-3009 in Flow (or paid resource with X-Payment). MCP returns the intent + resource hint; it does not hold keys.",
        flow: "https://beacon-desk.vercel.app/flow",
        tip: "In Flow, use x402 buttons / paid resources for settle + receipt.",
      },
      summary: "x402 intent",
      isError: false,
    };
  }

  if (name === "fassets_redeem") {
    try {
      const desk = await readFassetsDesk(env);
      const lots = typeof args.lots === "number" ? args.lots : 1;
      const underlying =
        typeof args.underlyingAddress === "string" ? args.underlyingAddress : "";
      if (!underlying) {
        return {
          payload: {
            ok: true,
            desk,
            lots,
            next: "Provide XRPL classic underlyingAddress (r…) to prepare redeem calldata.",
            honesty:
              "Mint is docs handoff. Redeem prepare is REAL; COMPLETED needs RedemptionPerformed evidence.",
          },
          summary: "fassets redeem needs XRPL address",
          isError: false,
        };
      }
      const prep = await prepareFassetsRedeemLots(
        { lots: Math.max(1, Math.floor(lots)), underlyingAddress: underlying },
        env,
      );
      return {
        payload: {
          ok: true,
          prep,
          honesty:
            "PREPARED calldata only until wallet completes on-chain redeem. Never invent COMPLETED.",
        },
        summary: prep && "ok" in prep && prep.ok === false ? "prep failed" : "fassets redeem prep",
        isError: Boolean(prep && "ok" in prep && prep.ok === false),
      };
    } catch (e) {
      return {
        payload: { ok: false, error: e instanceof Error ? e.message : String(e) },
        summary: "fassets redeem error",
        isError: true,
      };
    }
  }

  return {
    payload: { ok: false, error: `Unhandled tool ${name}` },
    summary: "unhandled",
    isError: true,
  };
}

export async function revokeMcpGrantsForWallet(
  redis: Redis | null,
  wallet: string,
): Promise<number> {
  if (!redis) return 0;
  return revokeAllGrantsForWallet(asRedis(redis), wallet);
}
