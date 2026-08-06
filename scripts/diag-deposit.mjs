import "dotenv/config";
import { JsonRpcProvider, Contract, Wallet, parseUnits, formatUnits, Interface } from "ethers";

const rpc = process.env.COSTON2_RPC_URL;
const p = new JsonRpcProvider(rpc);
const user = "0x3be57a5b65265d3704f846b93600308154fec794";
const tokenAddr = "0x6fd8a72a972040f3153894BBd0d829a58f1Fe86c";
const vaultNew = "0xc7C6C06Dd59173dBAf8382627d6A483Ca53AAF33";
const vaultOld = "0x9bD5B894Da0a54B7649A4084d93D58df4f6182e0";

const ERC20 = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function name() view returns (string)",
  "function approve(address,uint256) returns (bool)",
  "function mint(address,uint256)",
];
const VAULT = [
  "function deposit(uint256)",
  "function owner() view returns (address)",
  "function token() view returns (address)",
  "function balance() view returns (uint256)",
];

const t = new Contract(tokenAddr, ERC20, p);
const v = new Contract(vaultNew, VAULT, p);

console.log("name", await t.name());
console.log("user bal", formatUnits(await t.balanceOf(user), 6));
console.log("allow new", (await t.allowance(user, vaultNew)).toString());
console.log("allow old", (await t.allowance(user, vaultOld)).toString());
console.log("vault owner", await v.owner());
console.log("vault token", await v.token());
console.log("vault bal", (await v.balance()).toString());

// static deposit without allowance should fail
try {
  await v.deposit.staticCall(parseUnits("4", 6), { from: user });
  console.log("static deposit: unexpected success");
} catch (e) {
  console.log("static deposit (no approve) revert:", e.shortMessage || e.message);
}

// simulate approve+deposit with deployer funding path using eth_call chain
const amount = parseUnits("4", 6);
const iface = new Interface(VAULT);
const data = iface.encodeFunctionData("deposit", [amount]);
console.log("deposit calldata", data);

// check recent user txs
const latest = await p.getBlockNumber();
console.log("latest block", latest);

// API prepare
const prepRes = await fetch("https://beacon-api-97gl.onrender.com/v1/vault/prepare", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ action: "deposit", amountUsdt0: "4" }),
});
const prep = await prepRes.json();
console.log("prepare ok", prepRes.status, JSON.stringify(prep, null, 2).slice(0, 1200));

// vercel bundle vault
const html = await (await fetch("https://beacon-desk.vercel.app/")).text();
const m = html.match(/assets\/index-[^"]+\.js/);
console.log("asset", m?.[0]);
if (m) {
  const js = await (await fetch("https://beacon-desk.vercel.app/" + m[0])).text();
  console.log("bundle has new", js.includes("c7C6C06Dd59173dBAf8382627d6A483Ca53AAF33") || js.includes("c7c6c06dd59173dbaf8382627d6a483ca53aaf33"));
  console.log("bundle has old", js.includes("9bD5B894Da0a54B7649A4084d93D58df4f6182e0") || js.includes("9bd5b894da0a54b7649a4084d93d58df4f6182e0"));
}

// actually execute approve+deposit as user? we don't have user key.
// execute as deployer to prove path works
const key = process.env.DEPLOYMENT_PRIVATE_KEY?.startsWith("0x")
  ? process.env.DEPLOYMENT_PRIVATE_KEY
  : "0x" + process.env.DEPLOYMENT_PRIVATE_KEY;
const w = new Wallet(key, p);
const tSigner = t.connect(w);
const vSigner = v.connect(w);
console.log("deployer", w.address);
console.log("deployer bal", formatUnits(await t.balanceOf(w.address), 6));
if ((await t.balanceOf(w.address)) < amount) {
  const mintTx = await tSigner.mint(w.address, parseUnits("100", 6));
  await mintTx.wait();
  console.log("minted to deployer");
}
const appr = await tSigner.approve(vaultNew, amount);
await appr.wait();
console.log("approved");
const dep = await vSigner.deposit(amount);
const rec = await dep.wait();
console.log("deposit status", rec.status, rec.hash);
console.log("vault bal after", formatUnits(await v.balance(), 6));
