import "dotenv/config";
import { resetEnvCache, loadEnv } from "@beacon/shared";
import { fdcClientFromEnv } from "@beacon/fdc";

async function main() {
  resetEnvCache();
  const client = fdcClientFromEnv(loadEnv());
  const abi =
    "0x4164647265737356616c696469747900000000000000000000000000000000007465737458525000000000000000000000000000000000000000000000000000fd9db8a26d7cbeebd60776d3ef75bd0da9fc1a44672daf5762b91a4802609a2700000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000002272505431536a7132594772424d5474745834475a486a4b75396479667a6270415965000000000000000000000000000000000000000000000000000000000000";
  const proof = await client.fetchProofWithRetry(abi, 1420937, 4, 3000);
  console.log(
    JSON.stringify(
      {
        ok: proof.ok,
        status: proof.status,
        proofLen: proof.proof?.length ?? 0,
        urlTried: proof.urlTried,
        responsePreview: proof.responseHex?.slice(0, 160),
        isValid:
          typeof proof.raw === "object" &&
          proof.raw &&
          "response" in (proof.raw as object)
            ? (proof.raw as { response?: { responseBody?: { isValid?: boolean } } }).response
                ?.responseBody?.isValid
            : undefined,
      },
      null,
      2,
    ),
  );
}

main();
