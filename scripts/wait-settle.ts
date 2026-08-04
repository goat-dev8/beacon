import "dotenv/config";
import { createHash } from "node:crypto";
import { JsonRpcProvider, Contract } from "ethers";

const id = process.argv[2]!;
const h = "0x" + createHash("sha256").update(id).digest("hex");
const api = process.env.API_URL ?? "http://127.0.0.1:3001";

for (let i = 0; i < 20; i++) {
  const j = await fetch(`${api}/v1/jobs/${id}`).then((r) => r.json());
  const e = new Contract(
    process.env.BEACON_ESCROW!,
    ["function locks(bytes32) view returns (address,uint256,bool,bool)"],
    new JsonRpcProvider(process.env.COSTON2_RPC_URL!),
  );
  const l = await e.locks(h);
  console.log(i, j.job.status, { released: l[2], refunded: l[3] });
  if (j.job.status === "CLOSED" && (l[2] || l[3])) {
    console.log("OK");
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 3000));
}
process.exit(1);
