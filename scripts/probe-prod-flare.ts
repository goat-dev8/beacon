const paths = [
  "/health",
  "/ready",
  "/v1/flare/integrations",
  "/v1/fcc/lifecycle",
  "/v1/fdc/status",
  "/v1/ftso/guard",
];

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function main() {
  for (let i = 1; i <= 30; i++) {
    await sleep(15000);
    try {
      const r = await fetch("https://beacon-api-97gl.onrender.com/v1/flare/integrations");
      const t = await r.text();
      console.log(`tick ${i} integrations ${r.status} ${t.slice(0, 200)}`);
      if (r.status === 200) break;
    } catch (e) {
      console.log(`tick ${i} err ${String(e).slice(0, 100)}`);
    }
  }
  for (const p of paths) {
    try {
      const r = await fetch(`https://beacon-api-97gl.onrender.com${p}`);
      const t = await r.text();
      console.log(p, r.status, t.slice(0, 250));
    } catch (e) {
      console.log(p, "ERR", String(e).slice(0, 120));
    }
  }
}

main();
