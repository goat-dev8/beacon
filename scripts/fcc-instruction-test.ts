import "dotenv/config";
import { resetEnvCache, loadEnv } from "@beacon/shared";
import { FccExtensionClient, fccConfigFromEnv } from "@beacon/fdc";

async function main(): Promise<void> {
  resetEnvCache();
  const env = loadEnv();
  const client = new FccExtensionClient(fccConfigFromEnv(env));

  console.log("honesty:", client.honesty());
  const info = await client.proxyInfo();
  console.log("proxy /info ok:", Boolean(info));

  console.log("FIT/EVALUATE...");
  const fit = await client.sendEvaluateFit({
    serviceId: "documents",
    brief: "Write an onboarding SOP for contractors.",
  });
  console.log("  status:", fit.status, "tx:", fit.txHash);
  console.log("  data:", JSON.stringify(fit.data));
  if (fit.status !== 1) throw new Error(`FIT failed: ${fit.log ?? fit.status}`);

  console.log("JOB/ACCEPT...");
  const accept = await client.sendAccept({
    jobId: "fcc-test-1",
    resultHint: "PASS",
  });
  console.log("  status:", accept.status, "tx:", accept.txHash);
  console.log("  data:", JSON.stringify(accept.data));
  if (accept.status !== 1) throw new Error(`ACCEPT failed: ${accept.log ?? accept.status}`);

  console.log("\nFCC Bound Work instructions OK.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
