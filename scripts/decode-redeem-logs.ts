import "dotenv/config";
import { JsonRpcProvider, id, Interface } from "ethers";

async function main() {
  const p = new JsonRpcProvider(process.env.COSTON2_RPC_URL!);
  const txHash = "0x2a2edb61551dbf2bda2460d465d79363fe309eeb4ea84abc2421599f85e66440";
  const rc = await p.getTransactionReceipt(txHash);
  const topic = id(
    "RedemptionRequested(address,address,uint256,string,uint256,uint256,uint256,uint256,uint256,bytes32,address,uint256)",
  );
  console.log(
    JSON.stringify(
      {
        status: rc?.status,
        blockNumber: rc?.blockNumber,
        logCount: rc?.logs.length,
        redemptionTopic: topic,
        matching: (rc?.logs ?? [])
          .filter((l) => l.topics[0]?.toLowerCase() === topic.toLowerCase())
          .map((l) => ({
            address: l.address,
            topics: l.topics,
            dataLen: l.data.length,
          })),
        otherTopics: [...new Set((rc?.logs ?? []).map((l) => l.topics[0]))],
      },
      null,
      2,
    ),
  );

  // Try decode with official ABI
  const iface = new Interface([
    "event RedemptionRequested(address indexed agentVault, address indexed redeemer, uint256 indexed requestId, string paymentAddress, uint256 valueUBA, uint256 feeUBA, uint256 firstUnderlyingBlock, uint256 lastUnderlyingBlock, uint256 lastUnderlyingTimestamp, bytes32 paymentReference, address executor, uint256 executorFeeNatWei)",
  ]);
  for (const log of rc?.logs ?? []) {
    try {
      const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
      if (parsed) {
        console.log(
          "PARSED",
          JSON.stringify(
            {
              name: parsed.name,
              requestId: parsed.args.requestId?.toString?.() ?? String(parsed.args[2]),
              paymentAddress: parsed.args.paymentAddress,
              valueUBA: parsed.args.valueUBA?.toString?.(),
              agentVault: parsed.args.agentVault,
              redeemer: parsed.args.redeemer,
            },
            null,
            2,
          ),
        );
      }
    } catch (e) {
      /* */
    }
  }
}

main().catch((e) => {
  console.error(String(e).slice(0, 300));
  process.exit(1);
});
