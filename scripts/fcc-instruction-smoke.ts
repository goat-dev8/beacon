import "dotenv/config";
import { Contract, JsonRpcProvider, Wallet, toUtf8Bytes } from "ethers";
import { resetEnvCache, loadEnv, honestyMessage } from "@beacon/shared";

async function main() {
  resetEnvCache();
  const env = loadEnv();
  const pk = env.DEPLOYMENT_PRIVATE_KEY || env.DEPLOYER_PRIVATE_KEY || env.SETTLER_PRIVATE_KEY;
  if (!pk || !env.INSTRUCTION_SENDER) {
    console.log(JSON.stringify({ status: "NOT_AVAILABLE", reason: "missing key or INSTRUCTION_SENDER" }));
    return;
  }
  const provider = new JsonRpcProvider(env.COSTON2_RPC_URL);
  const wallet = new Wallet(pk.startsWith("0x") ? pk : `0x${pk}`, provider);
  const sender = new Contract(
    env.INSTRUCTION_SENDER,
    ["function sendSayHello(bytes _message) payable"],
    wallet,
  );
  const fee = 1_000_000n;
  const payload = toUtf8Bytes(
    JSON.stringify({
      kind: "beacon_policy_shadow",
      allow: false,
      note: "lifecycle smoke — cannot move funds",
      at: new Date().toISOString(),
    }),
  );
  console.log("honesty", honestyMessage(env.SIMULATED_TEE));
  console.log("sending sendSayHello to", env.INSTRUCTION_SENDER);
  try {
    const tx = await sender.sendSayHello(payload, { value: fee, gasLimit: 1_500_000n });
    const receipt = await tx.wait();
    console.log(
      JSON.stringify({
        status: env.EXT_PROXY_URL ? "PARTIAL" : "PARTIAL",
        honesty: "SIMULATED_TEE instruction submit — result poll blocked without EXT_PROXY_URL",
        canMoveFunds: false,
        hardwareClaim: false,
        txHash: receipt?.hash ?? tx.hash,
        explorer: `https://coston2-explorer.flare.network/tx/${receipt?.hash ?? tx.hash}`,
        blockNumber: receipt?.blockNumber,
      }),
    );
  } catch (e) {
    console.log(
      JSON.stringify({
        status: "NOT_AVAILABLE",
        honesty: "InstructionSender call failed — extension may lack TEE machines or fee/config",
        error: e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300),
      }),
    );
  }
}

main();
