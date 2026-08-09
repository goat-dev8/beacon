function toHex(data: string): string {
  let result = "";
  for (let i = 0; i < data.length; i++) result += data.charCodeAt(i)!.toString(16);
  return result.padEnd(64, "0");
}

async function main() {
  const key = "00000000-0000-0000-0000-000000000000";
  const base = "https://fdc-verifiers-testnet.flare.network";

  // Official EVMTransaction prepareRequest path
  const body = {
    attestationType: "0x" + toHex("EVMTransaction"),
    sourceId: "0x" + toHex("testETH"),
    requestBody: {
      transactionHash: "0x4e636c6590b22d8dcdade7ee3b5ae5572f42edb1878f09b3034b2f7c3362ef3c",
      requiredConfirmations: "1",
      provideInput: true,
      listEvents: true,
      logIndices: [] as number[],
    },
  };

  const urls = [
    `${base}/verifier/eth/EVMTransaction/prepareRequest`,
    `${base}/verifier/xrp/AddressValidity/prepareRequest`,
    `${base}/verifier/api-doc`,
  ];

  for (const u of urls) {
    try {
      const r = await fetch(u, {
        method: u.includes("api-doc") ? "GET" : "POST",
        headers: { "Content-Type": "application/json", "X-API-KEY": key },
        body: u.includes("api-doc") ? undefined : JSON.stringify(body),
      });
      const t = await r.text();
      console.log("\n==", u, r.status);
      console.log(t.slice(0, 400));
    } catch (e) {
      console.log("ERR", u, String(e).slice(0, 100));
    }
  }

  // DA layer proof endpoint probe
  const daUrls = [
    "https://coston2-data-availability.flare.network/api/v0/fdc/get-proof-round-id-bytes",
    "https://ctn2-data-availability.flare.network/api/v0/fdc/get-proof-round-id-bytes",
    "https://flarenetworks-data-availability-coston2.flare.network/api/v0/fdc/get-proof-round-id-bytes",
  ];
  for (const u of daUrls) {
    try {
      const r = await fetch(u, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-KEY": key },
        body: JSON.stringify({ votingRoundId: 1, requestBytes: "0x00" }),
      });
      const t = await r.text();
      console.log("\nDA", u, r.status, t.slice(0, 200));
    } catch (e) {
      console.log("DA ERR", u, String(e).slice(0, 100));
    }
  }
}

main();
