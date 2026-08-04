import "dotenv/config";
import { createHash } from "node:crypto";
import { JsonRpcProvider, Wallet, Contract } from "ethers";

const jobId = process.argv[2] ?? "bd318f92-0dde-4a86-8775-00a9d3bf6402";
const jobHash = "0x" + createHash("sha256").update(jobId).digest("hex");

const provider = new JsonRpcProvider(process.env.COSTON2_RPC_URL);
const signer = new Wallet(process.env.SETTLER_PRIVATE_KEY!, provider);
const escrow = new Contract(
  process.env.BEACON_ESCROW!,
  [
    "function refund(bytes32 jobId)",
    "function locks(bytes32) view returns (address payer,uint256 amount,bool released,bool refunded)",
  ],
  signer,
);

const before = await escrow.locks(jobHash);
console.log("before", {
  payer: before.payer,
  amount: before.amount.toString(),
  released: before.released,
  refunded: before.refunded,
});

if (
  before.payer !== "0x0000000000000000000000000000000000000000" &&
  !before.released &&
  !before.refunded
) {
  const tx = await escrow.refund(jobHash);
  console.log("refund tx", tx.hash);
  await tx.wait();
  const after = await escrow.locks(jobHash);
  console.log("after", {
    payer: after.payer,
    amount: after.amount.toString(),
    released: after.released,
    refunded: after.refunded,
  });
} else {
  console.log("nothing to refund");
}
