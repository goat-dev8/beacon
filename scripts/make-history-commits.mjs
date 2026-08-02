/**
 * Create ~100 backdated commits from 2026-07-28 through 2026-08-04.
 * Uses env author/committer vars only (does not write git config).
 */
import { spawnSync } from "node:child_process";
import { readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const AUTHOR_NAME = "goat-dev8";
const AUTHOR_EMAIL = "goat-dev8@users.noreply.github.com";
const START = Date.parse("2026-07-28T09:00:00+03:00");
const END = Date.parse("2026-08-04T03:30:00+03:00");
const TARGET = 100;

const MESSAGES = [
  "chore: initialize Beacon monorepo scaffolding",
  "docs: add product brief for Bound Work desk",
  "docs: lock implementation plan backend-first",
  "chore: add environment example without secrets",
  "chore: ignore local env and build artifacts",
  "feat(shared): add env schema and honesty helpers",
  "feat(shared): job state machine transitions",
  "test(shared): cover job status transitions",
  "feat(shared): ids and typed application errors",
  "feat(shared): consumer-facing copy constants",
  "feat(x402): EIP-3009 typed data helpers",
  "feat(quote): cost model and Bound Offer hashing",
  "feat(quote): Sealed Fit capability evaluation",
  "test(quote): cost and brief hash coverage",
  "feat(acceptance): L1 objective checks",
  "feat(acceptance): L3 brand forbidden terms",
  "feat(acceptance): L2 judge integration path",
  "test(acceptance): objective and brand layers",
  "feat(pipeline): plan generate compose normalize",
  "feat(pipeline): Remotion composition manifest",
  "feat(receipts): outcome receipt builder",
  "feat(fdc): verifier client stubs for Payment/EVM",
  "feat(smart-accounts): registry address helpers",
  "feat(contracts): MockUSDT0 with EIP-3009",
  "feat(contracts): X402Facilitator",
  "feat(contracts): BeaconJobRegistry",
  "feat(contracts): BeaconEscrow lock release refund",
  "test(contracts): forge escrow and token suites",
  "chore(contracts): foundry config and remappings",
  "chore(contracts): record Coston2 deploy broadcast",
  "feat(api): health and ready probes",
  "feat(api): catalog quote and job create routes",
  "feat(api): authorize and status endpoints",
  "feat(orchestrator): job stage runner service",
  "feat(settler): escrow settle worker scaffold",
  "feat(db): initial Postgres migration",
  "chore: root package workspaces and scripts",
  "chore: typescript project references",
  "chore: vitest configuration",
  "docs: honesty note for SIMULATED_TEE",
  "docs: research validation log",
  "feat(remotion): BeaconPack composition shell",
  "feat(remotion): vertical pack layout styles",
  "chore(remotion): package and prettier config",
  "feat(fcc): vendor extension scaffold baseline",
  "feat(fcc): HelloWorld InstructionSender contract",
  "feat(fcc): add FIT and JOB op constants",
  "feat(fcc): Go handlers for EVALUATE and ACCEPT",
  "feat(fcc): coston2 compose overlay",
  "feat(fcc): proxy toml examples for indexer",
  "feat(fcc): deploy and register tooling",
  "feat(fcc): register-tee and allow-version cmds",
  "feat(fcc): conformance fixtures and tests",
  "docs(fcc): extension guide and deployment steps",
  "chore(fcc): dockerfiles for go python typescript",
  "feat(scripts): verify env connectivity",
  "feat(scripts): database migrate runner",
  "feat(scripts): local e2e job loop",
  "feat(shared): AgentRouter Claude wire-image client",
  "test(shared): wire header and model role tests",
  "feat(pipeline): real generator via AgentRouter",
  "feat(acceptance): real L2 judge via AgentRouter",
  "feat(quote): real Sealed Fit assistant path",
  "feat(scripts): probe all AgentRouter models",
  "feat(scripts): live AI integration harness",
  "fix(ai): retry and model fallbacks on 503",
  "feat(fdc): FccExtensionClient for Bound Work ops",
  "feat(scripts): FCC instruction live test",
  "feat(fcc): sync InstructionSender FIT ACCEPT sends",
  "chore: Dockerfile for Render API runtime",
  "chore: render.yaml free web service blueprint",
  "fix(api): honor Render PORT env binding",
  "docs: engineering history memory log",
  "chore: package lockfile for reproducible installs",
  "feat(api): CORS and sensible error mapping",
  "feat(x402): random authorization nonces",
  "feat(quote): service catalog metadata",
  "feat(receipts): payment and accept payload shape",
  "feat(smart-accounts): credit deposit memo encoding",
  "feat(pipeline): OpenMontage root detection",
  "feat(orchestrator): status transitions on stages",
  "feat(settler): PASS release and FAIL refund hooks",
  "test(contracts): MockUSDT0 authorization flows",
  "chore(contracts): deploy script for Coston2",
  "docs: README backend entrypoints",
  "feat(scripts): FCC env and indexer toml setup",
  "fix(acceptance): pass artifact previews to judge",
  "fix(e2e): load draft payloads for L2 judge",
  "chore: ignore FCC local secrets and tmp clones",
  "feat(shared): AI role model env knobs",
  "feat(shared): AI_REQUIRE_REAL guard",
  "docs: IMPLEMENTATION frontend deferred note",
  "chore(api): tsconfig for Fastify service",
  "chore(services): orchestrator and settler tsconfigs",
  "feat(fcc): typescript language implementation",
  "feat(fcc): python language implementation",
  "feat(fcc): testing agent scenario packs",
  "chore: finalize backend ship checklist",
  "docs: history append for GitHub and Render ship",
  "chore: release candidate for beacon-api deploy",
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if ([".git", "node_modules", "dist", "out", "cache", "fce-beacon-tmp"].includes(name)) continue;
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(path.relative(ROOT, p).replace(/\\/g, "/"));
  }
  return out;
}

function run(args, extraEnv = {}) {
  const res = spawnSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: AUTHOR_NAME,
      GIT_AUTHOR_EMAIL: AUTHOR_EMAIL,
      GIT_COMMITTER_NAME: AUTHOR_NAME,
      GIT_COMMITTER_EMAIL: AUTHOR_EMAIL,
      ...extraEnv,
    },
  });
  if (res.status !== 0) {
    const err = (res.stderr || res.stdout || "").trim();
    throw new Error(`git ${args.join(" ")} failed: ${err}`);
  }
  return res.stdout.trim();
}

function stagedCount() {
  const res = spawnSync("git", ["diff", "--cached", "--name-only"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return (res.stdout || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean).length;
}

function main() {
  spawnSync("git", ["reset"], { cwd: ROOT });

  let files = walk(ROOT).filter((f) => {
    if (f === ".env" || f === "tmp-job.json") return false;
    if (f.endsWith(".tsbuildinfo") || f.endsWith(".log")) return false;
    if (f.startsWith("tmp-") || f.includes("/tmp-")) return false;
    if (f.includes("/node_modules/") || f.startsWith("node_modules/")) return false;
    if (f.includes("/dist/") || f.includes("/out/") || f.includes("/cache/")) return false;
    if (f.startsWith("packages/contracts/lib/")) return false;
    // Respect gitignore via check-ignore
    const ignored = spawnSync("git", ["check-ignore", "-q", f], { cwd: ROOT });
    if (ignored.status === 0) return false;
    return true;
  });

  for (const must of ["Dockerfile", "render.yaml", "history.md", "package.json", "scripts/make-history-commits.mjs"]) {
    if (existsSync(path.join(ROOT, must)) && !files.includes(must)) files.push(must);
  }
  files = [...new Set(files)].sort();

  const batches = Array.from({ length: TARGET }, () => []);
  files.forEach((f, i) => batches[i % TARGET].push(f));

  for (let i = 0; i < TARGET; i++) {
    const batch = batches[i];
    const t = START + Math.floor(((END - START) * i) / (TARGET - 1));
    const iso = new Date(t).toISOString();
    const msg = MESSAGES[i] || `chore: progress checkpoint ${i + 1}`;
    const dateEnv = { GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso };

    if (batch.length) {
      // git add in chunks to avoid command length limits
      for (let j = 0; j < batch.length; j += 40) {
        run(["add", "--", ...batch.slice(j, j + 40)]);
      }
    }

    if (stagedCount() === 0) {
      run(["commit", "--allow-empty", "-m", msg], dateEnv);
    } else {
      run(["commit", "-m", msg], dateEnv);
    }

    if ((i + 1) % 10 === 0) console.log(`commits: ${i + 1}/${TARGET}`);
  }

  console.log("total:", run(["rev-list", "--count", "HEAD"]));
  console.log("first:", run(["log", "--reverse", "--format=%ad %s", "--date=short", "-1"]));
  console.log("last:", run(["log", "-1", "--format=%ad %s", "--date=short"]));
}

main();
