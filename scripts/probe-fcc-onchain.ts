import { Contract, JsonRpcProvider } from "ethers";

const TEE_MANAGER = "0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE";
const OLD_MANAGER = "0x004224fa00000000000000000000000000005d41F"; // may be incomplete
const SENDER = "0x11bFc67F6c5e7a1265b52292F5AE5a8f4B821c46";
const EXT_ID = BigInt("0x0000000000000000000000000000000000000000000000000000000000010185");

async function main() {
  const p = new JsonRpcProvider("https://coston2-api.flare.network/ext/C/rpc");

  const mgrCode = await p.getCode(TEE_MANAGER);
  console.log("FlareTeeManager code len", mgrCode.length, mgrCode === "0x" ? "EMPTY" : "OK");

  const senderCode = await p.getCode(SENDER);
  console.log("InstructionSender code len", senderCode.length);

  // Probe common facet methods on TeeManager / registries
  const abi = [
    "function getTeeMachine(address) view returns (address,address,string)",
    "function getTeeMachineStatus(address) view returns (uint8)",
    "function getTeeExtensionInstructionsSender(uint256) view returns (address)",
    "function nextPublicExtensionId() view returns (uint256)",
    "function getRandomTeeIds(uint256,uint256) view returns (address[])",
  ];

  const mgr = new Contract(TEE_MANAGER, abi, p);

  try {
    const next = await mgr.nextPublicExtensionId();
    console.log("nextPublicExtensionId", next.toString());
  } catch (e) {
    console.log("nextPublicExtensionId fail", String(e).slice(0, 120));
  }

  try {
    const sender = await mgr.getTeeExtensionInstructionsSender(EXT_ID);
    console.log("getTeeExtensionInstructionsSender(EXT)", sender);
  } catch (e) {
    console.log("getTeeExtensionInstructionsSender fail", String(e).slice(0, 160));
  }

  // Try sender's registries from constructor immutables via storage? Use interface if available
  const senderAbi = [
    "function TEE_EXTENSION_REGISTRY() view returns (address)",
    "function TEE_MACHINE_REGISTRY() view returns (address)",
    "function getExtensionId() view returns (uint256)",
    "function OP_TYPE_FIT() view returns (bytes32)",
  ];
  const s = new Contract(SENDER, senderAbi, p);
  for (const fn of ["TEE_EXTENSION_REGISTRY", "TEE_MACHINE_REGISTRY", "getExtensionId", "OP_TYPE_FIT"]) {
    try {
      const v = await (s as any)[fn]();
      console.log(fn, String(v));
    } catch (e) {
      console.log(fn, "fail", String(e).slice(0, 100));
    }
  }

  // Fetch systems explorer hint via public RPC events? skip
  console.log("EXT_ID decimal", EXT_ID.toString());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
