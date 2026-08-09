import { JsonRpcProvider, id, Interface } from "ethers";
import { writeFileSync } from "node:fs";

async function main() {
  const p = new JsonRpcProvider("https://coston2-api.flare.network/ext/C/rpc");
  const txs = [
    "0x1446f4143a1c317f4eaf71b0a981c1ff751bec485870b093d9ac498d5a124aa5",
  ];
  const guessed = [
    "TeeInstructionsSent(bytes32,address,address[],bytes32,bytes32)",
    "TeeInstructionsSent(uint256,bytes32,address[],bytes32,bytes32)",
    "InstructionsSent(bytes32,address[],bytes32,bytes32)",
  ];
  for (const sig of guessed) {
    console.log(sig, id(sig));
  }
  for (const tx of txs) {
    const r = await p.getTransactionReceipt(tx);
    console.log("tx", tx, "logs", r?.logs.length);
    for (const log of r?.logs ?? []) {
      console.log({
        address: log.address,
        topic0: log.topics[0],
        topics: [...log.topics],
        dataPreview: log.data.slice(0, 130),
      });
    }
  }
}

main();
