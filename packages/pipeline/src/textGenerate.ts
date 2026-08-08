import { writeFile } from "node:fs/promises";
import path from "node:path";
import { chatForRole, isAiConfigured, loadEnv } from "@beacon/shared";

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

  if (!isAiConfigured(env)) {
    if (env.AI_REQUIRE_REAL || textService) {
      throw new Error(
        "AI_REQUIRE_REAL: AI_API_KEY / AI_BASE_URL missing — cannot generate real deliverable",
      );
    }
    providerMeta = { provider: "unconfigured" };
  } else if (!skipAiDraft) {
    const maxTokens = sidEarly === "coding" ? 8192 : 4096;
    const attempts = textService ? 2 : 1;
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
                  : `${generatorSystemPrompt(sidEarly)} CRITICAL: Prior reply was rejected as a stub. Output the FULL working solution now. No scaffolds. No echoing the brief as a return string.`,
            },
            {
              role: "user",
              content: `Service: ${job.serviceId}\nModel target: gpt-5.6-sol (AgentRouter)\n\nBrief:\n${job.briefText}`,
            },
          ],
          { temperature: attempt === 1 ? 0.35 : 0.2, maxTokens, env },
        );
        const trimmed = (result.content || "").trim();
        if (!isAcceptableTextDeliverable(sidEarly, trimmed, job.briefText)) {
          lastErr = new Error(
            `generator returned stub/short draft (model=${result.model}, chars=${trimmed.length}, attempt=${attempt})`,
          );
          continue;
        }
        body = trimmed;
        providerMeta = {
          provider: "agentrouter",
          model: result.model,
          latencyMs: result.latencyMs,
          role: "generator",
          attempt,
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
        : new Error("AgentRouter generator failed — refusing scaffold fallback");
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
          provider: providerMeta.provider,
          model: providerMeta.model,
        },
      });
    }
  }

  return out;
}

function generatorSystemPrompt(serviceId: string): string {
  if (serviceId === "documents") {
    return [
      "You are Beacon's documents generator for Agent Jobs on Flare Coston2 (AgentRouter gpt-5.6-sol).",
      "Expand short briefs into a complete, usable markdown document pack.",
      "For school / education briefs include: title, learning goals, outline or syllabus,",
      "lesson notes or worksheet, and a short parent/teacher note.",
      "Be concrete and ready to hand to a student or teacher. Use markdown headings.",
      "Do not refuse short briefs — expand them into real docs.",
      "Never return a scaffold, placeholder, or echo-only reply.",
    ].join(" ");
  }
  if (serviceId === "coding") {
    return [
      "You are Beacon's coding generator (AgentRouter gpt-5.6-sol).",
      "Produce a COMPLETE, RUNNABLE program that matches the brief exactly.",
      "Detect the requested language from the brief (Python, TypeScript, etc.). If Python is named, write Python.",
      "Output markdown with: (1) a short title, (2) one fenced code block with the full program, (3) a brief How to run section.",
      "The code must implement the requested behavior (inputs, operators, conditionals, clear printed output when asked).",
      "Never echo the brief as a string. Never ship stubs, TODOs, or 'fallback' scaffolds.",
      "Do not wrap the solution in export function run() that only returns the prompt text.",
    ].join(" ");
  }
  return [
    "You are Beacon's first-party generator for Agent Jobs (AgentRouter gpt-5.6-sol).",
    "Produce concise, on-brief draft content for the requested deliverable. Use markdown.",
    "Expand vague briefs into concrete deliverables — never return only the brief echoed back.",
    "Never ship placeholders, scaffolds, or fake fallback content.",
  ].join(" ");
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
  if (text.length < 80) return false;
  if (isStubDeliverable(text, briefText)) return false;
  if (serviceId === "coding") {
    const hasFence = /```[\w+-]*\n[\s\S]{40,}```/.test(text);
    const hasLogic =
      /\b(def |class |function |const |let |input\s*\(|print\s*\(|console\.log|if\s*\()/i.test(text);
    return hasFence && hasLogic;
  }
  const brief = (briefText || "").trim();
  if (brief && text.replace(/\s+/g, " ") === brief.replace(/\s+/g, " ")) return false;
  return text.length >= 120 || /^#\s+/m.test(text);
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
