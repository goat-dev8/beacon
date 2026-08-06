import "dotenv/config";
import { JsonRpcProvider, Wallet, Contract, parseUnits, formatUnits } from "ethers";
import { randomBytes } from "crypto";

const rpc = process.env.COSTON2_RPC_URL;
const key = process.env.DEPLOYMENT_PRIVATE_KEY?.startsWith("0x")
  ? process.env.DEPLOYMENT_PRIVATE_KEY
  : "0x" + process.env.DEPLOYMENT_PRIVATE_KEY;
const tokenAddr = "0x6fd8a72a972040f3153894BBd0d829a58f1Fe86c";
const vaultAddr = "0xc7C6C06Dd59173dBAf8382627d6A483Ca53AAF33";

const TOKEN_ABI = [
  "function name() view returns (string)",
  "function version() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
];
const VAULT_ABI = [
  "function depositWithAuthorization(address from,uint256 amount,uint256 validAfter,uint256 validBefore,bytes32 nonce,bytes signature)",
  "function balance() view returns (uint256)",
];

const p = new JsonRpcProvider(rpc);
const w = new Wallet(key, p);
const token = new Contract(tokenAddr, TOKEN_ABI, w);
const vault = new Contract(vaultAddr, VAULT_ABI, w);

const amount = parseUnits("4", 6);
console.log("signer", w.address);
console.log("bal before", formatUnits(await token.balanceOf(w.address), 6));
console.log("safe before", formatUnits(await vault.balance(), 6));

const name = await token.name();
const version = await token.version();
const validAfter = BigInt(Math.floor(Date.now() / 1000) - 60);
const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);
const nonceHex = "0x" + randomBytes(32).toString("hex");

const signature = await w.signTypedData(
  { name, version, chainId: 114, verifyingContract: tokenAddr },
  {
    TransferWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  },
  {
    from: w.address,
    to: vaultAddr,
    value: amount,
    validAfter,
    validBefore,
    nonce: nonceHex,
  },
);
console.log("signed ok");

const tx = await vault.depositWithAuthorization(
  w.address,
  amount,
  validAfter,
  validBefore,
  nonceHex,
  signature,
);
const rec = await tx.wait();
console.log("deposit status", rec.status, rec.hash);
console.log("safe after", formatUnits(await vault.balance(), 6));
console.log("bal after", formatUnits(await token.balanceOf(w.address), 6));
