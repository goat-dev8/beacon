import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  chatForRole,
  gatherResearchGrounding,
  isAiConfigured,
  loadEnv,
  PRODUCT_MODEL_LABEL,
} from "@beacon/shared";

export interface TextJob {
  jobId: string;
  serviceId: string;
  briefText: string;
  outputDir: string;
}

export interface TextArtifact {
  kind: string;
  uri: string;
  mimeType: string;
  meta?: Record<string, unknown>;
}

export async function generateTextContent(job: TextJob): Promise<TextArtifact[]> {
  const env = loadEnv();
  const draftPath = path.join(job.outputDir, "draft.md");
  const sidEarly = String(job.serviceId ?? "")
    .toLowerCase()
    .trim();
  const mediaFast = (env.MEDIA_FAST || "").toLowerCase() === "true";
  const skipAiDraft = mediaFast && ["image", "video"].includes(sidEarly);
  const textService = !["image", "video", "voice"].includes(sidEarly);
  const mediaSoft = ["image", "video"].includes(sidEarly) || mediaFast;

  let body = "";
  let providerMeta: Record<string, unknown> = { provider: "pending" };
  let retrievalMeta: Record<string, unknown> | undefined;
  let groundingBlock = "";

  const textNeedsRetrieval = ["research", "analysis", "planning", "agents"].includes(sidEarly);
  if (textNeedsRetrieval) {
    try {
      const grounding = await gatherResearchGrounding(job.briefText, env);
      groundingBlock = `\n\n${grounding.modelContext}`;
      retrievalMeta = {
        retrievedAt: grounding.retrievedAt,
        sourceCount: grounding.sources.filter((s) => s.ok).length,
        sourceUrls: grounding.sources.filter((s) => s.ok).map((s) => s.url),
        fetchFailures: grounding.sources
          .filter((s) => !s.ok)
          .map((s) => ({ title: s.title, url: s.url, error: s.error })),
        liveNotes: grounding.liveNotes,
      };
      console.log(
        "[textGenerate] research grounding",
        job.jobId,
        retrievalMeta.sourceCount,
        Array.isArray(retrievalMeta.sourceUrls) ? retrievalMeta.sourceUrls : [],
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      groundingBlock = `\n\nRetrieval layer failed (${message}). Do not invent URLs. Label unverified claims.`;
      retrievalMeta = { error: message };
    }
  }

  if (!isAiConfigured(env)) {
    if (env.AI_REQUIRE_REAL || textService) {
      throw new Error(
        "AI_REQUIRE_REAL: AI_API_KEY / AI_BASE_URL missing — cannot generate real deliverable",
      );
    }
    providerMeta = { provider: "unconfigured" };
  } else if (!skipAiDraft) {
    // Keep the request bounded. Small coding/document jobs should not reserve
    // thousands of output tokens on metered gateways.
    const maxTokens = maxTokensForService(sidEarly);
    const attempts = textService ? 3 : 1;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const result = await chatForRole(
          "generator",
          [
            {
              role: "system",
              content:
                attempt === 1
                  ? generatorSystemPrompt(sidEarly)
                  : `${generatorSystemPrompt(sidEarly)} CRITICAL: Prior reply was rejected. Output the FULL working solution now. Wrap code in a markdown fenced block. No scaffolds. No echoing the brief as a return string.`,
            },
            {
              role: "user",
              content: `Service: ${job.serviceId}\nRequested generator: ${PRODUCT_MODEL_LABEL}\n\nBrief:\n${job.briefText}${groundingBlock}`,
            },
          ],
          { temperature: attempt === 1 ? 0.25 : 0.15, maxTokens, env },
        );
        let trimmed = (result.content || "").trim();
        trimmed = normalizeCodingMarkdown(sidEarly, trimmed, job.briefText);
        if (!isAcceptableTextDeliverable(sidEarly, trimmed, job.briefText)) {
          lastErr = new Error(
            `gpt-5.6-sol returned stub/short draft (chars=${trimmed.length}, attempt=${attempt})`,
          );
          continue;
        }
        body = trimmed;
        providerMeta = {
          model: PRODUCT_MODEL_LABEL,
          requestedModel: PRODUCT_MODEL_LABEL,
          via: result.via,
          latencyMs: result.latencyMs,
          role: "generator",
          attempt,
          retrieval: retrievalMeta,
        };
        break;
      } catch (err) {
        lastErr = err;
        if (mediaSoft) {
          providerMeta = {
            provider: "local-fallback",
            error: err instanceof Error ? err.message : String(err),
          };
          break;
        }
      }
    }
    if (!body && !mediaSoft) {
      throw lastErr instanceof Error
        ? lastErr
        : new Error("gpt-5.6-sol generation failed — refusing scaffold fallback");
    }
  } else {
    providerMeta = { provider: "media-fast-skip-draft" };
  }

  if (!body) {
    body = `# ${job.serviceId}\n\n${job.briefText}\n`;
  }

  await writeFile(draftPath, body, "utf8");
  const out: TextArtifact[] = [
    { kind: "draft", uri: draftPath, mimeType: "text/markdown", meta: providerMeta },
  ];

  if (sidEarly === "coding") {
    const extracted = extractPrimaryCodeFile(body, job.briefText);
    if (extracted) {
      const codePath = path.join(job.outputDir, extracted.filename);
      await writeFile(codePath, extracted.source, "utf8");
      out.push({
        kind: "code",
        uri: codePath,
        mimeType: "text/plain",
        meta: {
          language: extracted.language,
          filename: extracted.filename,
          model: PRODUCT_MODEL_LABEL,
        },
      });
    }
  }

  return out;
}

function normalizeGeneratedModel(model: string): string {
  const value = (model || "").toLowerCase();
  if (value.includes("gpt-5.6-sol")) return "gpt-5.6-sol";
  if (value.includes("gpt-5.6-luna")) return "gpt-5.6-luna";
  return model || "unknown";
}

function maxTokensForService(serviceId: string): number {
  if (serviceId === "coding") return 900;
  if (serviceId === "research" || serviceId === "analysis") return 2400;
  if (
    serviceId === "presentations" ||
    serviceId === "documents" ||
    serviceId === "planning" ||
    serviceId === "agents"
  ) {
    return 1600;
  }
  if (serviceId === "marketing" || serviceId === "ui") return 1400;
  return 1200;
}

export function generatorSystemPrompt(serviceId: string): string {
  const common =
    "You are Beacon, Flare AI OS on Coston2 (chain 114). Know FTSO, FDC, FCC (TEE cannot move funds), FAssets/FXRP, LayerZero OFT, x402, Beacon Safe policy, and Agent Jobs escrow. Use markdown. Never ship placeholders, TODOs, scaffolds, or echo the brief back. Do not invent URLs, citations, TVL, audits, or live market figures. Never mention upstream API vendors.";
  if (serviceId === "documents") {
    return [
      "You are Beacon's documents generator for Agent Jobs.",
      "Expand short briefs into a complete, usable markdown document.",
      "For school / education briefs include: title, learning goals, outline or syllabus,",
      "lesson notes or worksheet, and a short parent/teacher note.",
      "Be concrete and ready to hand to a student or teacher.",
      common,
    ].join(" ");
  }
  if (serviceId === "coding") {
    return [
      "You are Beacon's coding generator.",
      "Produce a COMPLETE, RUNNABLE program that matches the brief exactly.",
      "Detect the requested language from the brief (Python, TypeScript, etc.). If Python is named, write Python.",
      "Output markdown with: (1) a short title, (2) one fenced code block with the full program, (3) a brief How to run section.",
      "The code must implement the requested behavior (inputs, operators, conditionals, clear printed output when asked).",
      "Never echo the brief as a string. Never ship stubs, TODOs, or 'fallback' scaffolds.",
      "Do not wrap the solution in export function run() that only returns the prompt text.",
    ].join(" ");
  }
  if (serviceId === "research") {
    return [
      "You are Beacon Research for Agent Jobs.",
      "You receive retrieved excerpts from official pages that were actually fetched at runtime, plus optional on-chain / FTSO notes.",
      "Research the user's topic: protocols, products, competitors, markets, projects, or a specific question.",
      "Structure with headings: What was researched, Key findings, Conclusions, Caveats, Sources used.",
      "Sources used = only URLs that appear in the retrieved context. Never invent URLs, paper titles, TVL, or audit scores.",
      "If a claim is not in the retrieved excerpts, label it unverified or omit it.",
      "Use Beacon/Flare notes only when they are relevant to the topic. Do not hijack unrelated topics into a Beacon pitch.",
      "If SparkDEX / Coston2 vs Mainnet honesty appears in live checks, include it. Do not invent bytecode status.",
      common,
    ].join(" ");
  }
  if (serviceId === "marketing") {
    return [
      "You are Beacon's marketing generator.",
      "Deliver usable campaign copy: positioning one-liner, 3 headline options, primary body copy, CTA, and channel notes (X, landing, email).",
      "Match the brief's audience and tone. No generic 'revolutionize' filler.",
      common,
    ].join(" ");
  }
  if (serviceId === "design") {
    return [
      "You are Beacon's design generator.",
      "Deliver a coherent design direction: concept, layout/composition notes, color + type, and export/handoff notes.",
      "A visual creative is generated separately — write direction a designer can execute.",
      common,
    ].join(" ");
  }
  if (serviceId === "ui") {
    return [
      "You are Beacon's UI generator.",
      "Deliver a useful UI spec: screen inventory, layout (mobile-first), key components, copy, and a fenced HTML+CSS sketch when a screen is requested.",
      "Keep it implementable. No fake component libraries.",
      common,
    ].join(" ");
  }
  if (serviceId === "branding") {
    return [
      "You are Beacon's branding generator.",
      "Deliver a coherent brand pack: name lockup notes, personality, color + type, do/don't usage, and a short rationale.",
      "A mark visual is generated separately. Do not invent trademark claims.",
      common,
    ].join(" ");
  }
  if (serviceId === "analysis") {
    return [
      "You are Beacon's analysis generator.",
      "Deliver an actual analysis: question, evidence/assumptions, findings, trade-offs, recommendation, and caveats.",
      "Do not invent data. Label inferences as inferences.",
      common,
    ].join(" ");
  }
  if (serviceId === "presentations") {
    return [
      "You are Beacon's presentation generator.",
      "Deliver a usable deck in markdown: title slide, 6–10 slides with headline + 3 bullets each, and speaker notes per slide.",
      "One idea per slide. Ready to paste into slides.",
      common,
    ].join(" ");
  }
  if (serviceId === "planning") {
    return [
      "You are Beacon's planning generator.",
      "Deliver an actionable plan: goal, success metric, sequenced milestones with owners/timeboxes if known, risks, and next action.",
      common,
    ].join(" ");
  }
  if (serviceId === "agents") {
    return [
      "You are Beacon's agent-brief generator.",
      "Deliver a useful agent spec: role, tools, inputs/outputs, guardrails, failure modes, and a sample first user message.",
      "Do not invent APIs that are not in the brief.",
      common,
    ].join(" ");
  }
  return [
    "You are Beacon's first-party generator.",
    "Produce concise, on-brief draft content for the requested deliverable.",
    "Expand vague briefs into concrete deliverables.",
    common,
  ].join(" ");
}

/** If the model returns raw code without fences, wrap it so UX + acceptance both pass. */
export function normalizeCodingMarkdown(
  serviceId: string,
  body: string,
  briefText: string,
): string {
  if (serviceId !== "coding") return body;
  const text = (body || "").trim();
  if (!text || isStubDeliverable(text, briefText)) return text;
  if (/```[\w+-]*\n[\s\S]{40,}```/.test(text)) return text;
  const looksPy =
    /python|\.py\b/i.test(briefText) ||
    /\b(def |import |input\s*\(|print\s*\(|if __name__)/i.test(text);
  if (looksPy && text.length >= 40) {
    return `# Python deliverable\n\n\`\`\`python\n${text}\n\`\`\`\n\n## How to run\n\n\`\`\`bash\npython main.py\n\`\`\`\n`;
  }
  if (/\b(function |const |export |console\.log)/i.test(text) && text.length >= 40) {
    return `# Coding deliverable\n\n\`\`\`ts\n${text}\n\`\`\`\n`;
  }
  return text;
}

/** Reject scaffold / echo stubs that previously shipped as done. */
export function isStubDeliverable(body: string, briefText: string): boolean {
  const text = (body || "").trim();
  if (!text) return true;
  if (
    /Generated fallback|Replace this scaffold|live generator is reachable|local-expand|TODO:\s*implement/i.test(
      text,
    )
  ) {
    return true;
  }
  const brief = (briefText || "").trim();
  if (brief.length >= 24) {
    const echoReturn = new RegExp(
      `return\\s+["'\`][^"'\`]{0,20}${escapeRegExp(brief.slice(0, 32))}`,
      "i",
    );
    if (echoReturn.test(text) && !/\binput\s*\(|\bprint\s*\(|\bif\s+__name__/i.test(text)) {
      return true;
    }
  }
  return false;
}

export function isAcceptableTextDeliverable(
  serviceId: string,
  body: string,
  briefText: string,
): boolean {
  const text = (body || "").trim();
  if (isStubDeliverable(text, briefText)) return false;
  if (serviceId === "coding") {
    const hasFence = /```[\w+-]*\n[\s\S]{20,}```/.test(text);
    const hasLogic =
      /\b(def |class |function |const |let |input\s*\(|print\s*\(|console\.log|if\s*\()/i.test(text);
    // Small complete CLIs (even/odd, fizzbuzz) are valid — do not require 80+ chars.
    return hasLogic && (hasFence || text.length >= 40);
  }
  if (text.length < 80) return false;
  const brief = (briefText || "").trim();
  if (brief && text.replace(/\s+/g, " ") === brief.replace(/\s+/g, " ")) return false;
  if (serviceId === "research" || serviceId === "analysis") {
    const structured =
      /what was researched|key findings|conclusions?|caveats?|recommendation/i.test(text);
    return structured && text.length >= 400;
  }
  if (serviceId === "presentations") {
    return /slide/i.test(text) && text.length >= 280;
  }
  return text.length >= 160 || /^#\s+/m.test(text);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractPrimaryCodeFile(
  markdown: string,
  briefText: string,
): { filename: string; language: string; source: string } | null {
  const re = /```([\w+-]*)\n([\s\S]*?)```/g;
  let best: { lang: string; source: string } | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) {
    const lang = (m[1] || "").toLowerCase();
    const source = (m[2] || "").trim();
    if (source.length < 40) continue;
    if (isStubDeliverable(source, briefText)) continue;
    if (!best || source.length > best.source.length) best = { lang, source };
  }
  if (!best) return null;
  const wantsPython =
    /python|\.py\b/i.test(briefText) || best.lang === "python" || best.lang === "py";
  if (wantsPython || best.lang === "python" || best.lang === "py") {
    return { filename: "main.py", language: "python", source: best.source };
  }
  if (best.lang === "ts" || best.lang === "typescript") {
    return { filename: "main.ts", language: "typescript", source: best.source };
  }
  if (best.lang === "js" || best.lang === "javascript") {
    return { filename: "main.js", language: "javascript", source: best.source };
  }
  return {
    filename: wantsPython ? "main.py" : "main.txt",
    language: best.lang || "text",
    source: best.source,
  };
}
