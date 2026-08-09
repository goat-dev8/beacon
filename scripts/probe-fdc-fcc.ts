import { Contract, JsonRpcProvider, getAddress } from "ethers";

async function main() {
  const p = new JsonRpcProvider("https://coston2-api.flare.network/ext/C/rpc");
  const sender = "0x11bFc67F6c5e7a1265b52292F5AE5a8f4B821c46";
  const code = await p.getCode(sender);
  console.log("INSTRUCTION_SENDER code length", code.length, code === "0x" ? "EMPTY" : "DEPLOYED");

  // Try getExtensionId if present
  try {
    const c = new Contract(
      sender,
      ["function getExtensionId() view returns (uint256)", "function extensionId() view returns (uint256)"],
      p,
    );
    try {
      console.log("getExtensionId", (await c.getExtensionId()).toString());
    } catch {
      console.log("getExtensionId unavailable");
    }
  } catch (e) {
    console.log("sender probe err", String(e).slice(0, 120));
  }

  // Probe DA layer roots
  const urls = [
    "https://ctn2-data-availability.flare.network/api/v1/health",
    "https://ctn2-data-availability.flare.network/api/v0/health",
    "https://ctn2-data-availability.flare.network/",
  ];
  for (const u of urls) {
    try {
      const r = await fetch(u);
      const t = await r.text();
      console.log("DA", u, r.status, t.slice(0, 120));
    } catch (e) {
      console.log("DA", u, "ERR", String(e).slice(0, 80));
    }
  }

  // Probe FDC verifier XRP prepare with minimal invalid body — expect structured error, not network fail
  try {
    const r = await fetch("https://fdc-verifiers-testnet.flare.network/verifier/xrp/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": "00000000-0000-0000-0000-000000000000" },
      body: JSON.stringify({ attestationType: "AddressValidity", sourceId: "testXRP" }),
    });
    const t = await r.text();
    console.log("FDC XRP prepare", r.status, t.slice(0, 300));
  } catch (e) {
    console.log("FDC XRP ERR", String(e).slice(0, 120));
  }

  // Probe EVM verifier
  try {
    const r = await fetch("https://fdc-verifiers-testnet.flare.network/verifier/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": "00000000-0000-0000-0000-000000000000" },
      body: JSON.stringify({ attestationType: "AddressValidity" }),
    });
    const t = await r.text();
    console.log("FDC EVM prepare", r.status, t.slice(0, 300));
  } catch (e) {
    console.log("FDC EVM ERR", String(e).slice(0, 120));
  }

  void getAddress;
}

main();
