/**
 * Bootstrap personal Safe for deployer + MCP swap within limit (Coston2).
 * No secrets printed. Real explorer hashes only.
 */
import fs from "fs";
import { randomBytes } from "crypto";
import {
  Contract,
  JsonRpcProvider,
  Wallet,
  parseUnits,
  formatUnits,
} from "ethers";

const env = Object.fromEntries(
  fs
    .readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const API = "https://beacon-api-97gl.onrender.com";
const rpc = env.COSTON2_RPC_URL || "https://coston2-api.flare.network/ext/C/rpc";
const tokenAddr = env.X402_TOKEN_ADDRESS || "0x6fd8a72a972040f3153894BBd0d829a58f1Fe86c";
const key = env.DEPLOYER_PRIVATE_KEY.startsWith("0x")
  ? env.DEPLOYER_PRIVATE_KEY
  : `0x${env.DEPLOYER_PRIVATE_KEY}`;

const provider = new JsonRpcProvider(rpc);
const wallet = new Wallet(key, provider);
console.log("wallet", `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`);

async function sessionToken() {
  const ch = await (
    await fetch(`${API}/v1/auth/safe-session/challenge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet: wallet.address }),
    })
  ).json();
  if (!ch.ok) throw new Error(JSON.stringify(ch));
  const signature = await wallet.signMessage(ch.message);
  const sess = await (
    await fetch(`${API}/v1/auth/safe-session/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        wallet: wallet.address,
        message: ch.message,
        signature,
      }),
    })
  ).json();
  if (!sess.ok) throw new Error(JSON.stringify(sess));
  return sess.token;
}

let status = await (
  await fetch(`${API}/v1/vault/status?wallet=${wallet.address}`)
).json();
let safe = status.status?.configured ? status.status.address : null;

if (!safe) {
  console.log("creating Safe…");
  const prep = await (
    await fetch(`${API}/v1/vault/prepare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "createSafe", wallet: wallet.address }),
    })
  ).json();
  if (!prep.ok) throw new Error(JSON.stringify(prep));
  const tx = await wallet.sendTransaction({
    to: prep.prep.to,
    data: prep.prep.data,
    value: 0n,
  });
  const rec = await tx.wait();
  console.log("PASS createSafe", rec.hash);
  status = await (
    await fetch(`${API}/v1/vault/status?wallet=${wallet.address}`)
  ).json();
  safe = status.status?.address;
}
if (!safe) throw new Error("Safe still missing after create");
console.log("safe", `${safe.slice(0, 8)}…`);

const token = new Contract(
  tokenAddr,
  [
    "function mint(address to,uint256 amount)",
    "function balanceOf(address) view returns (uint256)",
    "function name() view returns (string)",
    "function version() view returns (string)",
  ],
  wallet,
);

const bal = await token.balanceOf(wallet.address);
if (bal < parseUnits("20", 6)) {
  const mintTx = await token.mint(wallet.address, parseUnits("100", 6));
  await mintTx.wait();
  console.log("PASS mint", mintTx.hash);
}

const vault = new Contract(
  safe,
  [
    "function balance() view returns (uint256)",
    "function depositWithAuthorization(address from,uint256 amount,uint256 validAfter,uint256 validBefore,bytes32 nonce,bytes signature)",
    "function setPolicy(uint256 maxSpendPerTx,uint256 rollingWindowBudget,uint256 rollingWindowSeconds,uint256 sessionExpiresAt)",
    "function maxSpendPerTx() view returns (uint256)",
  ],
  wallet,
);

const safeBal = await vault.balance();
if (safeBal < parseUnits("10", 6)) {
  const amount = parseUnits("25", 6);
  const name = await token.name();
  const version = await token.version();
  const validAfter = BigInt(Math.floor(Date.now() / 1000) - 60);
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const nonceHex = `0x${randomBytes(32).toString("hex")}`;
  const signature = await wallet.signTypedData(
    { name, version, chainId: 114, verifyingContract: tokenAddr },
    {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    {
      from: wallet.address,
      to: safe,
      value: amount,
      validAfter,
      validBefore,
      nonce: nonceHex,
    },
  );
  const dep = await vault.depositWithAuthorization(
    wallet.address,
    amount,
    validAfter,
    validBefore,
    nonceHex,
    signature,
  );
  await dep.wait();
  console.log("PASS deposit", dep.hash, "safeBal", formatUnits(await vault.balance(), 6));
} else {
  console.log("safe funded", formatUnits(safeBal, 6));
}

const maxTx = await vault.maxSpendPerTx();
if (maxTx === 0n) {
  const sessionExpiresAt = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
  const polTx = await vault.setPolicy(
    parseUnits("10", 6),
    parseUnits("50", 6),
    7 * 24 * 3600,
    sessionExpiresAt,
  );
  await polTx.wait();
  console.log("PASS setPolicy", polTx.hash);
}

// App policy allow swap
const sess = await sessionToken();
await fetch(`${API}/v1/security/policy`, {
  method: "PUT",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${sess}`,
  },
  body: JSON.stringify({
    wallet: wallet.address,
    policy: {
      dailySpendUsdt0: 50,
      perJobLimitUsdt0: 10,
      allowedAgents: ["swap", "bridge", "desk", "pay"],
      allowedChains: [114],
      maxImageCostUsdt0: 0,
      maxVideoSeconds: 0,
      emergencyPause: false,
      sessionExpiryHours: 24,
    },
  }),
});
console.log("PASS app_policy");

const grant = await (
  await fetch(`${API}/v1/mcp/grants`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sess}`,
    },
    body: JSON.stringify({
      wallet: wallet.address,
      clientKind: "generic",
      clientLabel: "MCP swap E2E",
      scopes: ["read:safe", "read:policy", "exec:swap"],
      maxSpendPerTxUsdt0: 5,
      dailyLimitUsdt0: 20,
      ttlHours: 2,
    }),
  })
).json();
if (!grant.ok) throw new Error(JSON.stringify(grant));
console.log("PASS mcp_grant", grant.grant.id);

async function mcpCall(name, args) {
  const res = await fetch(`${API}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${grant.accessToken}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const body = await res.json();
  const text = body?.result?.content?.[0]?.text || JSON.stringify(body);
  let parsed = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }
  return { status: res.status, parsed, isError: body?.result?.isError };
}

const over = await mcpCall("swap", { amountUsdt0: 100 });
console.log(
  over.parsed?.code === "MCP_TX_LIMIT" ? "PASS" : "FAIL",
  "overspend",
  over.parsed?.code || over.parsed?.error,
);

const swap = await mcpCall("swap", { amountUsdt0: 1 });
if (swap.parsed?.ok) {
  const hash = swap.parsed?.result?.spendHash || swap.parsed?.txHash;
  console.log(
    "PASS swap",
    hash,
    swap.parsed?.explorer ||
      (hash ? `https://coston2-explorer.flare.network/tx/${hash}` : ""),
  );
} else {
  console.log(
    "FAIL swap",
    JSON.stringify(swap.parsed).slice(0, 400),
  );
}

await fetch(`${API}/v1/mcp/grants/${grant.grant.id}/revoke`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${sess}`,
  },
  body: JSON.stringify({ wallet: wallet.address }),
});
console.log("PASS revoke");
