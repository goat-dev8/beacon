import "dotenv/config";

const abi =
  "0x4164647265737356616c696469747900000000000000000000000000000000007465737458525000000000000000000000000000000000000000000000000000fd9db8a26d7cbeebd60776d3ef75bd0da9fc1a44672daf5762b91a4802609a2700000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000002272505431536a7132594772424d5474745834475a486a4b75396479667a6270415965000000000000000000000000000000000000000000000000000000000000";
const roundId = 1420937;
const key = "00000000-0000-0000-0000-000000000000";

async function tryUrl(url: string, body: unknown) {
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": key,
      "X-apikey": key,
    },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  console.log("\n", url, r.status);
  console.log(t.slice(0, 500));
}

async function main() {
  const bodies = [
    { votingRoundId: roundId, requestBytes: abi },
    { roundId, requestBytes: abi },
    { votingRoundId: String(roundId), requestBytes: abi },
  ];
  const urls = [
    "https://ctn2-data-availability.flare.network/api/v1/fdc/proof-by-request-round-raw",
    "https://ctn2-data-availability.flare.network/api/v0/fdc/get-proof-round-id-bytes",
    "https://ctn2-data-availability.flare.network/api/v1/fdc/proof-by-request-round",
  ];
  for (const url of urls) {
    for (const body of bodies) {
      await tryUrl(url, body);
    }
  }
}

main();
