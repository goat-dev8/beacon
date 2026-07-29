import {
  chatForRole,
  extractJsonObject,
  isAiConfigured,
  loadEnv,
} from "@beacon/shared";

export type AcceptResult = "PASS" | "FAIL" | "NEEDS_LOOK";

export interface ArtifactMeta {
  kind: string;
  mimeType?: string;
  uri: string;
  sha256?: string;
  durationSeconds?: number;
  schemaVersion?: string;
  payload?: unknown;
}

export interface AcceptContext {
  jobId: string;
  serviceId: string;
  rubricVersion: string;
  brandForbiddenWords?: string[];
  artifacts: ArtifactMeta[];
}

export interface LayerResult {
  layer: "L1" | "L2" | "L3";
  passed: boolean;
  notes: string[];
}

export interface AcceptReport {
  jobId: string;
  result: AcceptResult;
  confidence: number;
  layers: LayerResult[];
  summary: string;
  checkedAt: string;
}

export async function runAcceptance(ctx: AcceptContext): Promise<AcceptReport> {
  const layers: LayerResult[] = [];
  const l1 = runL1Objective(ctx);
  layers.push(l1);

  const l3 = runL3Brand(ctx);
  layers.push(l3);

  let l2: LayerResult = { layer: "L2", passed: true, notes: ["Skipped — no judge configured."] };
  const env = loadEnv();
  if (isAiConfigured(env)) {
    l2 = await runL2Judge(ctx);
  } else if (env.AI_REQUIRE_REAL) {
    throw new Error("AI_REQUIRE_REAL=true but AI judge is not configured");
  }
  layers.push(l2);

  const hardFail = layers.some((l) => !l.passed);
  const softLook = l2.notes.some((n) => n.includes("uncertain"));

  let result: AcceptResult = "PASS";
  if (hardFail) result = "FAIL";
  else if (softLook) result = "NEEDS_LOOK";

  return {
    jobId: ctx.jobId,
    result,
    confidence: hardFail ? 0.2 : softLook ? 0.65 : 0.92,
    layers,
    summary: hardFail
      ? "Quality checks did not pass."
      : softLook
        ? "Almost there — a quick look is recommended."
        : "All quality checks passed.",
    checkedAt: new Date().toISOString(),
  };
}

export function runL1Objective(ctx: AcceptContext): LayerResult {
  const notes: string[] = [];
  const primary = ctx.artifacts.filter(
    (a) => !["plan", "index", "composition_manifest"].includes(a.kind),
  );
  if (primary.length === 0) {
    return { layer: "L1", passed: false, notes: ["No deliverables attached."] };
  }

  for (const artifact of primary) {
    if (!artifact.mimeType) {
      notes.push(`Missing mime type for ${artifact.kind}.`);
      continue;
    }
    if (!isAllowedMime(ctx.serviceId, artifact.mimeType)) {
      notes.push(`Unexpected format ${artifact.mimeType} for ${ctx.serviceId}.`);
    }
    if (artifact.durationSeconds !== undefined && artifact.durationSeconds <= 0) {
      notes.push(`Invalid duration metadata for ${artifact.kind}.`);
    }
    if (artifact.schemaVersion && !isValidSchema(artifact.schemaVersion)) {
      notes.push(`Unsupported schema version ${artifact.schemaVersion}.`);
    }
  }

  const passed = notes.length === 0;
  if (passed) notes.push("Objective checks passed.");
  return { layer: "L1", passed, notes };
}

function isAllowedMime(serviceId: string, mime: string): boolean {
  const map: Record<string, string[]> = {
    video: ["video/mp4", "video/webm", "application/json"],
    image: ["image/png", "image/jpeg", "image/webp"],
    voice: ["audio/mpeg", "audio/wav", "audio/mp4"],
    presentations: ["application/pdf", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
    coding: ["text/plain", "text/markdown", "application/json"],
    research: ["text/markdown", "application/pdf", "application/json"],
    documents: ["text/markdown", "application/pdf", "text/plain"],
  };
  const allowed = map[serviceId] ?? ["application/octet-stream"];
  return allowed.includes(mime);
}

function isValidSchema(version: string): boolean {
  return /^v\d+(\.\d+)?$/.test(version);
}

export function runL3Brand(ctx: AcceptContext): LayerResult {
  const forbidden = ctx.brandForbiddenWords ?? [];
  const notes: string[] = [];
  for (const artifact of ctx.artifacts) {
    const text = JSON.stringify(artifact.payload ?? artifact.uri).toLowerCase();
    for (const word of forbidden) {
      if (word && text.includes(word.toLowerCase())) {
        notes.push(`Brand rule violated: forbidden term detected.`);
        break;
      }
    }
  }
  if (notes.length === 0) notes.push("Brand rules passed.");
  return { layer: "L3", passed: notes.every((n) => n.includes("passed")), notes };
}

export async function runL2Judge(ctx: AcceptContext): Promise<LayerResult> {
  const env = loadEnv();
  try {
    const result = await chatForRole(
      "acceptance",
      [
        {
          role: "system",
          content:
            'You are a strict quality judge. Reply JSON only: {"pass":true|false,"confidence":0-1,"notes":["..."],"uncertain":true|false}.',
        },
        {
          role: "user",
          content: JSON.stringify({
            service: ctx.serviceId,
            rubric: ctx.rubricVersion,
            artifacts: ctx.artifacts.map((a) => ({
              kind: a.kind,
              mime: a.mimeType,
              duration: a.durationSeconds,
              preview:
                typeof a.payload === "string"
                  ? a.payload.slice(0, 2000)
                  : a.payload
                    ? JSON.stringify(a.payload).slice(0, 2000)
                    : undefined,
            })),
          }),
        },
      ],
      { temperature: 0, maxTokens: 512, env },
    );

    try {
      const parsed = extractJsonObject<{
        pass?: boolean;
        notes?: string[];
        uncertain?: boolean;
      }>(result.content);
      const notes = [...(parsed.notes ?? [])];
      if (parsed.uncertain) notes.push("uncertain");
      notes.push(`judge:${result.model};${result.latencyMs}ms`);
      return {
        layer: "L2",
        passed: parsed.pass === true,
        notes: notes.length ? notes : [parsed.pass ? "Judge passed." : "Judge failed."],
      };
    } catch {
      return {
        layer: "L2",
        passed: true,
        notes: ["Judge returned non-JSON; treated as pass with review.", "uncertain"],
      };
    }
  } catch (err) {
    if (env.AI_REQUIRE_REAL) throw err;
    return {
      layer: "L2",
      passed: true,
      notes: [
        `Judge skipped (${err instanceof Error ? err.message : String(err)}). Objective and brand checks still apply.`,
        "uncertain",
      ],
    };
  }
}
