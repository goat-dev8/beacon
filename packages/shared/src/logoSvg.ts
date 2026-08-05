export interface LogoBrief {
  name: string;
  tagline?: string;
  industry?: string;
}

/** Extract a short brand name from a logo/creative brief. */
export function extractBrandName(brief: string): string {
  const cleaned = brief.trim().replace(/\s+/g, " ");
  const quoted = cleaned.match(/["'“]([^"'”]{2,32})["'”]/);
  if (quoted?.[1]) return quoted[1].trim();

  const forMatch = cleaned.match(
    /\b(?:logo|mark|brand|identity)\s+(?:for|of)\s+([A-Za-z0-9][\w\s&.-]{1,40})/i,
  );
  if (forMatch?.[1]) {
    return forMatch[1]
      .replace(/\b(company|brand|startup|web3|ai|app|the|a|an)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 24);
  }

  const keep = cleaned.match(/\b(keep\d*|kept|beacon|flare)[a-z0-9_-]*/i);
  if (keep?.[0]) return keep[0].replace(/\s+/g, "");

  const words = cleaned
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !/^(generate|image|logo|for|my|the|a|an|company|web3|make|create)$/i.test(w));
  return (words[0] || "Beacon").slice(0, 18);
}

/**
 * Premium vector logo SVG — used when raster providers are out of credits.
 * Far better than the old placeholder diamond; suitable for brand-mark jobs.
 */
export function buildProfessionalLogoSvg(
  brief: string,
  opts: { width?: number; height?: number } = {},
): { svg: string; brand: string; mimeType: "image/svg+xml" } {
  const width = opts.width ?? 1280;
  const height = opts.height ?? 1280;
  const brand = extractBrandName(brief) || "Beacon";
  const display = brand.length > 14 ? brand.slice(0, 14) : brand;
  const initial = display.charAt(0).toUpperCase();
  const safe = display
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  // Deterministic accent from name hash
  let hash = 0;
  for (let i = 0; i < display.length; i++) hash = (hash * 31 + display.charCodeAt(i)) >>> 0;
  const accents = ["#39e08a", "#2dd4bf", "#34d399", "#4ade80", "#22c55e"];
  const accent = accents[hash % accents.length]!;
  const ink = "#1a1820";
  const paper = "#f4f1ea";

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 1280 1280">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${paper}"/>
      <stop offset="100%" stop-color="#e8e2d6"/>
    </linearGradient>
    <linearGradient id="mark" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${accent}"/>
      <stop offset="100%" stop-color="#1f9e5c"/>
    </linearGradient>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="18" stdDeviation="24" flood-color="${ink}" flood-opacity="0.12"/>
    </filter>
  </defs>
  <rect width="1280" height="1280" fill="url(#bg)"/>
  <circle cx="180" cy="180" r="3" fill="${ink}" opacity="0.15"/>
  <circle cx="1100" cy="220" r="3" fill="${ink}" opacity="0.12"/>
  <circle cx="200" cy="1080" r="3" fill="${ink}" opacity="0.1"/>
  <g filter="url(#soft)">
    <rect x="420" y="280" width="440" height="440" rx="96" fill="url(#mark)"/>
    <text x="640" y="560" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="220" font-weight="700" fill="${ink}">${initial}</text>
  </g>
  <text x="640" y="860" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="72" letter-spacing="4" fill="${ink}">${safe.toUpperCase()}</text>
  <text x="640" y="920" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="22" fill="${ink}" opacity="0.45">BEACON · VECTOR MARK</text>
  <rect x="560" y="960" width="160" height="4" rx="2" fill="${accent}"/>
</svg>`;

  return { svg, brand: display, mimeType: "image/svg+xml" };
}

export function looksLikeLogoBrief(brief: string): boolean {
  return /\b(logo|brand\s*mark|wordmark|identity|icon\s*for)\b/i.test(brief);
}
