/**
 * Live research retrieval for Agent Jobs + Flow x402 research.
 *
 * This is NOT a canned-answer bank. Official URLs are fetched at runtime.
 * Only successfully fetched pages are passed to the model as excerpts.
 * Beacon/Flare notes are structured facts the model may use when relevant.
 */
import { loadEnv, type BeaconEnv } from "./env.js";
import { COSTON2_USDT0, readFtsoFeeds } from "./ftso.js";
import {
  FLARE_MAINNET_USDT0,
  SPARKDEX_QUOTER_V2,
  SPARKDEX_SWAP_ROUTER,
  resolveSparkDexDeployment,
} from "./sparkDex.js";

export type RetrievedSource = {
  title: string;
  url: string;
  excerpt: string;
  fetchedAt: string;
  ok: boolean;
  error?: string;
};

export type ResearchGrounding = {
  topic: string;
  retrievedAt: string;
  beaconFlareContext: string;
  liveNotes: string[];
  sources: RetrievedSource[];
  modelContext: string;
};

const FETCH_MS = 5_000;
const EXCERPT_CHARS = 2_400;
const MAX_SOURCES = 4;

/** Public, verified Beacon/FCC identifiers — not secrets. */
export const BEACON_FCC = {
  teeId: "0x2ebCFD562A24BDf0ea7b47F351f97d2140376506",
  codeHash: "0xb11215743d8b701bd757442cce17ec0c3a12d98e2d5ca083f6a92aa5fd9333be",
  extension: 65925,
  explorer: "https://coston2-systems-explorer.flare.network/tee/extensions/65925",
} as const;

type OfficialPage = {
  title: string;
  url: string;
  match: RegExp;
  /** Always fetch when the topic is Flare/Beacon related. */
  flareCore?: boolean;
};

const OFFICIAL_PAGES: OfficialPage[] = [
  {
    title: "SparkDEX — What is SparkDEX",
    url: "https://docs.sparkdex.ai/introduction/what-is-sparkdex.md",
    match: /sparkdex|spark dex|\bdex\b|amm|perpetual/i,
  },
  {
    title: "SparkDEX — V4 DEX",
    url: "https://docs.sparkdex.ai/sparkdex-defi-ecosystem/v4-dex.md",
    match: /sparkdex|spark dex|v4|algebra|liquidity/i,
  },
  {
    title: "SparkDEX — Eternal perps",
    url: "https://docs.sparkdex.ai/sparkdex-defi-ecosystem/sparkdex-eternal-perps-exchange.md",
    match: /sparkdex|perpetual|perps/i,
  },
  {
    title: "Flare — FTSO overview",
    url: "https://dev.flare.network/ftso/overview",
    match: /ftso|oracle|price feed|flare ecosystem/i,
    flareCore: true,
  },
  {
    title: "Flare — FDC overview",
    url: "https://dev.flare.network/fdc/overview",
    match: /fdc|attestation|data connector/i,
    flareCore: true,
  },
  {
    title: "Flare — FCC overview",
    url: "https://dev.flare.network/fcc/overview",
    match: /\bfcc\b|confidential compute|\btee\b/i,
    flareCore: true,
  },
  {
    title: "Flare — FAssets overview",
    url: "https://dev.flare.network/fassets/overview",
    match: /fasset|fxrp|xrp defi|xrp on flare/i,
    flareCore: true,
  },
  {
    title: "Flare — USDT0 / FXRP swap",
    url: "https://dev.flare.network/fxrp/token-interactions/usdt0-fxrp-swap",
    match: /usdt0|fxrp|sparkdex|swap/i,
  },
  {
    title: "Flare — FXRP OFT / LayerZero",
    url: "https://dev.flare.network/fxrp/oft/fxrp-autoredeem",
    match: /layerzero|\boft\b|bridge|fxrp/i,
  },
  {
    title: "Flare — network overview",
    url: "https://dev.flare.network/network/overview",
    match: /flare ecosystem|flare network|coston|layerzero|ftso/i,
    flareCore: true,
  },
  {
    title: "Flare — getting started",
    url: "https://dev.flare.network/network/getting-started",
    match: /flare|developer|coston2/i,
    flareCore: true,
  },
  {
    title: "Beacon README (live)",
    url: "https://raw.githubusercontent.com/goat-dev8/beacon/main/README.md",
    match: /beacon|agent jobs|x402|\bmcp\b|safe policy/i,
    flareCore: true,
  },
  {
    title: "FCC extension 65925 (Coston2 Systems Explorer)",
    url: BEACON_FCC.explorer,
    match: /\bfcc\b|\btee\b|confidential/i,
  },
  {
    title: "x402 protocol",
    url: "https://www.x402.org/",
    match: /x402|micropay/i,
  },
  {
    title: "Model Context Protocol",
    url: "https://modelcontextprotocol.io/",
    match: /\bmcp\b|model context/i,
  },
];

const ALLOWED_HOSTS = new Set([
  "dev.flare.network",
  "docs.flare.network",
  "docs.sparkdex.ai",
  "github.com",
  "raw.githubusercontent.com",
  "flare.network",
  "www.flare.network",
  "coston2-systems-explorer.flare.network",
  "coston2-explorer.flare.network",
  "flarescan.com",
  "www.x402.org",
  "x402.org",
  "modelcontextprotocol.io",
  "en.wikipedia.org",
]);

export function topicTouchesFlare(topic: string): boolean {
  return /flare|ftso|fdc|\bfcc\b|fasset|fxrp|usdt0|coston|sparkdex|beacon|layerzero|\boft\b|x402|\bmcp\b|xrp/i.test(
    topic,
  );
}

export function selectOfficialSources(topic: string): OfficialPage[] {
  const flare = topicTouchesFlare(topic);
  const matched = OFFICIAL_PAGES.filter((p) => p.match.test(topic) || (flare && p.flareCore)).sort(
    (a, b) => {
      const aHit = a.match.test(topic) ? 0 : 1;
      const bHit = b.match.test(topic) ? 0 : 1;
      return aHit - bHit;
    },
  );
  const seen = new Set<string>();
  const out: OfficialPage[] = [];
  for (const p of matched) {
    if (seen.has(p.url)) continue;
    seen.add(p.url);
    out.push(p);
    if (out.length >= MAX_SOURCES) break;
  }
  return out;
}

const TOPIC_ALIASES: Array<{ match: RegExp; canonical: string; wiki?: string; gecko?: string }> = [
  { match: /\b(btc|bitcoin)\b/i, canonical: "Bitcoin", wiki: "Bitcoin", gecko: "bitcoin" },
  { match: /\b(eth|ethereum)\b/i, canonical: "Ethereum", wiki: "Ethereum", gecko: "ethereum" },
  { match: /\b(xrp|ripple)\b/i, canonical: "XRP", wiki: "XRP", gecko: "ripple" },
  { match: /\bpoly[\s_-]*market/i, canonical: "Polymarket" },
  { match: /\buni[\s_-]*swap/i, canonical: "Uniswap" },
];

function aliasFor(topic: string) {
  return TOPIC_ALIASES.find((a) => a.match.test(topic)) ?? null;
}

export function extractSearchQuery(topic: string): string {
  const stripped = topic
    .replace(/^(please\s+)?(research|compare|analyze|analyse|explain|what is|what's)\s+/i, "")
    .replace(/\b(reasearch|research|analysis)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const hit = aliasFor(stripped) || aliasFor(topic);
  if (hit) return hit.canonical;
  return stripped.slice(0, 120);
}

export function wikipediaTitleRelevant(query: string, title: string): boolean {
  const qTokens = extractSearchQuery(query)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);
  if (!qTokens.length) return false;
  const hay = title.toLowerCase();
  return qTokens.some((t) => hay.includes(t));
}

export function isSafeHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    if (!host.includes(".")) return false;
    if (host === "localhost" || host.endsWith(".local")) return false;
    if (/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

/** Pull title+URL hits out of a Jina search dump. */
export function parseJinaSearchHits(text: string): Array<{ title: string; url: string }> {
  const hits: Array<{ title: string; url: string }> = [];
  const seen = new Set<string>();
  const re = /\[([^\]]{2,160})\]\((https?:\/\/[^)\s]+)\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let href = m[2] ?? "";
    href = href.replace(/^https?:\/\/(?:r|s)\.jina\.ai\//i, "");
    if (!isSafeHttpUrl(href)) continue;
    try {
      const host = new URL(href).hostname.toLowerCase();
      if (host === "jina.ai" || host.endsWith(".jina.ai")) continue;
    } catch {
      continue;
    }
    if (seen.has(href)) continue;
    seen.add(href);
    hits.push({ title: (m[1] ?? "").trim(), url: href });
    if (hits.length >= 5) break;
  }
  return hits;
}

export function stripToExcerpt(raw: string): string {
  let text = raw.replace(/\u0000/g, "");
  if (/<html|<!doctype|<body/i.test(text)) {
    text = text
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ");
  }
  return text.replace(/\s+/g, " ").trim().slice(0, EXCERPT_CHARS);
}

export function hostAllowed(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return ALLOWED_HOSTS.has(host);
  } catch {
    return false;
  }
}

export function buildBeaconFlareContext(): string {
  return [
    "Verified Beacon / Flare notes — use only when the user's topic is related. This is not the answer.",
    `- Coston2 chainId 114. Payment token for Beacon Jobs/Safe/x402 is Coston2 faucet USDT0 ${COSTON2_USDT0} (6 decimals). It is not Flare Mainnet USD₮0 ${FLARE_MAINNET_USDT0}.`,
    `- SparkDEX published SwapRouter ${SPARKDEX_SWAP_ROUTER} / QuoterV2 ${SPARKDEX_QUOTER_V2}. Bytecode is on Flare Mainnet (chain 14). Coston2 published addresses are empty. Beacon Coston2 swaps use SwapDesk + FTSOv2, not SparkDEX.`,
    `- FCC: hardware TEE ${BEACON_FCC.teeId}, measured codeHash ${BEACON_FCC.codeHash}, extension ${BEACON_FCC.extension} (${BEACON_FCC.explorer}). Platform GCP AMD SEV. FCC signs ALLOW/DENY and cannot move funds (canMoveFunds: false). Beacon Safe + on-chain policy is the spend boundary. The model never receives the user's private key.`,
    "- FTSO (Flare Time Series Oracle): live prices used by Beacon SwapDesk guards. FDC (Flare Data Connector): attestations. FAssets / FXRP: XRP represented on Flare; LayerZero OFT for bridging.",
    "- Agent Jobs lock Coston2 USDT0 in BeaconEscrow, generate, then release or refund. x402 is the HTTP 402 micropayment rail. MCP is how agents discover tools/docs.",
  ].join("\n");
}

function readerUrl(url: string): string {
  if (/\.md($|\?)/i.test(url) || /llms\.txt/i.test(url) || /raw\.githubusercontent\.com/i.test(url)) {
    return url;
  }
  return `https://r.jina.ai/${url}`;
}

async function fetchExcerpt(
  url: string,
  fetchImpl: typeof fetch,
): Promise<{ ok: boolean; excerpt: string; error?: string }> {
  const targets = [readerUrl(url)];
  if (targets[0] !== url) targets.push(url);
  let lastErr = "fetch failed";
  for (const target of targets) {
    try {
      const res = await fetchImpl(target, {
        headers: { Accept: "text/plain, text/markdown, text/html, */*", "User-Agent": "BeaconResearch/1.0" },
        signal: AbortSignal.timeout(FETCH_MS),
      });
      const body = await res.text();
      if (!res.ok) {
        lastErr = `HTTP ${res.status}`;
        continue;
      }
      const excerpt = stripToExcerpt(body);
      if (excerpt.length < 80) {
        lastErr = "excerpt too short";
        continue;
      }
      return { ok: true, excerpt };
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
  }
  return { ok: false, excerpt: "", error: lastErr };
}

async function fetchWikiSummary(
  title: string,
  fetchImpl: typeof fetch,
): Promise<RetrievedSource | null> {
  try {
    const sumRes = await fetchImpl(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!sumRes.ok) return null;
    const sum = (await sumRes.json()) as {
      title?: string;
      extract?: string;
      content_urls?: { desktop?: { page?: string } };
    };
    const extract = (sum.extract || "").trim();
    if (extract.length < 80) return null;
    const url = sum.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`;
    return {
      title: `Wikipedia — ${sum.title || title}`,
      url,
      excerpt: extract.slice(0, EXCERPT_CHARS),
      fetchedAt: new Date().toISOString(),
      ok: true,
    };
  } catch {
    return null;
  }
}

async function fetchCoinGeckoNote(topic: string, fetchImpl: typeof fetch): Promise<string | null> {
  const hit = aliasFor(topic);
  if (!hit?.gecko) return null;
  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(hit.gecko)}&vs_currencies=usd&include_24hr_change=true`;
    const res = await fetchImpl(url, {
      headers: { Accept: "application/json", "User-Agent": "BeaconResearch/1.0" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as Record<string, { usd?: number; usd_24h_change?: number }>;
    const row = json[hit.gecko];
    if (!row || typeof row.usd !== "number") return null;
    const change = typeof row.usd_24h_change === "number" ? ` (${row.usd_24h_change.toFixed(2)}% 24h)` : "";
    return `Live CoinGecko ${hit.canonical}: $${row.usd.toLocaleString("en-US")}${change}. Quote this as live, not unverified.`;
  } catch {
    return null;
  }
}

async function fetchWikipedia(
  topic: string,
  fetchImpl: typeof fetch,
): Promise<RetrievedSource | null> {
  const q = extractSearchQuery(topic);
  if (q.length < 3) return null;
  const alias = aliasFor(topic) || aliasFor(q);
  const directTitle = alias?.wiki || q;
  const direct = await fetchWikiSummary(directTitle, fetchImpl);
  if (direct) return direct;
  try {
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(q)}&limit=1&namespace=0&format=json`;
    const searchRes = await fetchImpl(searchUrl, { signal: AbortSignal.timeout(8_000) });
    if (!searchRes.ok) return null;
    const json = (await searchRes.json()) as [string, string[], string[], string[]];
    const title = json[1]?.[0];
    if (!title || !wikipediaTitleRelevant(q, title)) return null;
    return fetchWikiSummary(title, fetchImpl);
  } catch {
    return null;
  }
}

async function fetchWebSearch(
  topic: string,
  fetchImpl: typeof fetch,
  opts: { skipJina?: boolean } = {},
): Promise<RetrievedSource[]> {
  const q = extractSearchQuery(topic);
  if (q.length < 3) return [];
  const retrievedAt = new Date().toISOString();
  const out: RetrievedSource[] = [];

  try {
    const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`;
    const res = await fetchImpl(ddgUrl, {
      headers: { Accept: "application/json", "User-Agent": "BeaconResearch/1.0" },
      signal: AbortSignal.timeout(FETCH_MS),
    });
    if (res.ok) {
      const json = (await res.json()) as {
        AbstractText?: string;
        AbstractURL?: string;
        Heading?: string;
        RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
      };
      const abstract = (json.AbstractText || "").trim();
      const absUrl = json.AbstractURL || "";
      if (abstract.length >= 80 && absUrl) {
        out.push({
          title: json.Heading ? `Web — ${json.Heading}` : "DuckDuckGo abstract",
          url: absUrl,
          excerpt: abstract.slice(0, EXCERPT_CHARS),
          fetchedAt: retrievedAt,
          ok: true,
        });
      }
      for (const rel of json.RelatedTopics || []) {
        if (out.length >= 3) break;
        const text = (rel.Text || "").trim();
        const url = rel.FirstURL || "";
        if (text.length < 80 || !url) continue;
        out.push({
          title: `Web — ${text.slice(0, 80)}`,
          url,
          excerpt: text.slice(0, EXCERPT_CHARS),
          fetchedAt: retrievedAt,
          ok: true,
        });
      }
    }
  } catch {
    // continue to jina
  }

  if (opts.skipJina && out.length >= 1) return out.slice(0, 3);

  try {
    const jinaUrl = `https://s.jina.ai/${encodeURIComponent(q)}`;
    const res = await fetchImpl(jinaUrl, {
      headers: {
        Accept: "text/plain, application/json, */*",
        "User-Agent": "BeaconResearch/1.0",
        "X-Retain-Images": "none",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      const excerpt = stripToExcerpt(await res.text());
      if (excerpt.length >= 80) {
        out.push({
          title: `Web search — ${q}`,
          url: jinaUrl,
          excerpt: excerpt.slice(0, EXCERPT_CHARS),
          fetchedAt: retrievedAt,
          ok: true,
        });
        const pages = parseJinaSearchHits(excerpt);
        const extras = await Promise.all(
          pages.slice(0, 3).map(async (hit) => {
            const got = await fetchExcerpt(hit.url, fetchImpl);
            return {
              title: hit.title.slice(0, 120) || hit.url,
              url: hit.url,
              excerpt: got.excerpt,
              fetchedAt: retrievedAt,
              ok: got.ok,
              error: got.error,
            } satisfies RetrievedSource;
          }),
        );
        out.push(...extras.filter((s) => s.ok));
      }
    }
  } catch {
    // optional
  }

  return out.slice(0, 6);
}

function formatModelContext(g: Omit<ResearchGrounding, "modelContext">): string {
  const okSources = g.sources.filter((s) => s.ok);
  const failed = g.sources.filter((s) => !s.ok);
  const blocks = okSources.map(
    (s, i) =>
      `[${i + 1}] ${s.title}\nURL: ${s.url}\nFetched: ${s.fetchedAt}\nExcerpt: ${s.excerpt}`,
  );
  return [
    "RETRIEVED CONTEXT — only the URLs listed here were actually fetched. Do not invent URLs, paper titles, TVL, or audit scores.",
    "Wikipedia and live price notes ARE retrieved context. Do not write 'current state is unverified' or 'no live data' when excerpts or live checks exist. Quote them.",
    "Prefer these excerpts over unaudited memory. If a specific live figure is missing, omit that figure — still answer the topic.",
    g.beaconFlareContext,
    g.liveNotes.length ? `Live checks:\n${g.liveNotes.map((n) => `- ${n}`).join("\n")}` : "",
    blocks.length
      ? `Fetched sources:\n\n${blocks.join("\n\n")}`
      : "No Flare-official docs matched this topic. That does not mean the topic is unanswerable. Still write a useful research brief. Mark live figures as unverified. Do not invent URLs.",
    failed.length
      ? `Fetch failures (do not cite these as sources): ${failed.map((s) => `${s.title} (${s.error})`).join("; ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function gatherResearchGrounding(
  topic: string,
  env: BeaconEnv = loadEnv(),
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<ResearchGrounding> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const retrievedAt = new Date().toISOString();
  const pages = selectOfficialSources(topic);

  const sparkP =
    topicTouchesFlare(topic) || /sparkdex|\bdex\b/i.test(topic)
      ? resolveSparkDexDeployment(env)
          .then(
            (dep) =>
              `SparkDEX on-chain: network=${dep.network} chainId=${dep.chainId}. ${dep.honesty} Router ${dep.router}.`,
          )
          .catch(
            (err) =>
              `SparkDEX on-chain check failed (${err instanceof Error ? err.message : String(err)}). Do not invent bytecode status.`,
          )
      : Promise.resolve(null as string | null);

  const ftsoP =
    topicTouchesFlare(topic) || /ftso|price/i.test(topic)
      ? readFtsoFeeds(env)
          .then((snap) =>
            snap.feeds.length
              ? `Live Coston2 FTSO (not DEX pool prices): ${snap.feeds
                  .slice(0, 6)
                  .map((f) => `${f.symbol}=${Number(f.value).toPrecision(6)}`)
                  .join(" · ")}`
              : "FTSO snapshot returned no feeds.",
          )
          .catch(
            (err) =>
              `FTSO snapshot failed (${err instanceof Error ? err.message : String(err)}). Do not invent prices.`,
          )
      : Promise.resolve(null as string | null);

  const [sourceResults, wiki, web, sparkNote, ftsoNote, geckoNote] = await Promise.all([
    Promise.all(
      pages.map(async (page) => {
        const got = await fetchExcerpt(page.url, fetchImpl);
        return {
          title: page.title,
          url: page.url,
          excerpt: got.excerpt,
          fetchedAt: retrievedAt,
          ok: got.ok,
          error: got.error,
        } satisfies RetrievedSource;
      }),
    ),
    fetchWikipedia(topic, fetchImpl),
    fetchWebSearch(topic, fetchImpl, { skipJina: topicTouchesFlare(topic) && pages.length > 0 }),
    sparkP,
    ftsoP,
    fetchCoinGeckoNote(topic, fetchImpl),
  ]);

  const liveNotes = [sparkNote, ftsoNote, geckoNote].filter((n): n is string => Boolean(n));
  const sources = [...sourceResults, ...(wiki ? [wiki] : []), ...web];

  const base = {
    topic,
    retrievedAt,
    beaconFlareContext: topicTouchesFlare(topic)
      ? buildBeaconFlareContext()
      : `${buildBeaconFlareContext()}\nTopic may not be Flare/Beacon-related. Use Beacon notes only if relevant. Do not hijack the answer into a Beacon pitch.`,
    liveNotes,
    sources,
  };
  return { ...base, modelContext: formatModelContext(base) };
}
