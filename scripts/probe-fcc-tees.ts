import { Contract, JsonRpcProvider, id } from "ethers";

const MGR = "0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE";
const EXT = 65925n;

async function main() {
  const p = new JsonRpcProvider("https://coston2-api.flare.network/ext/C/rpc");
  const abi = [
    "function getRandomTeeIds(uint256 _extensionId, uint256 _count) view returns (address[])",
    "function getTeeMachine(address) view returns (address teeAddress, address owner, string url)",
    "function getTeeMachineStatus(address) view returns (uint8)",
    "function getTeeIds(uint256 _extensionId) view returns (address[])",
    "function getExtensionTeeIds(uint256) view returns (address[])",
    "function teeMachines(uint256) view returns (address)",
  ];
  const c = new Contract(MGR, abi, p);

  for (const fn of ["getRandomTeeIds", "getTeeIds", "getExtensionTeeIds"]) {
    try {
      const ids =
        fn === "getRandomTeeIds"
          ? await c.getRandomTeeIds(EXT, 5)
          : await (c as any)[fn](EXT);
      console.log(fn, ids);
      for (const teeId of ids as string[]) {
        try {
          const [addr, owner, url] = await c.getTeeMachine(teeId);
          const status = await c.getTeeMachineStatus(teeId);
          console.log({
            teeId,
            addr,
            owner,
            url,
            status: Number(status),
            label: Number(status) === 2 ? "PRODUCTION" : Number(status) === 1 ? "INITIALIZED" : String(status),
          });
        } catch (e) {
          console.log("machine probe fail", teeId, String(e).slice(0, 100));
        }
      }
    } catch (e) {
      console.log(fn, "fail", String(e).slice(0, 160));
    }
  }

  // Probe recent TeeInstructionsSent from our sender via logs
  const topic = id("TeeInstructionsSent(bytes32,address,address[],bytes32,bytes32)");
  console.log("TeeInstructionsSent topic", topic);
}

main();
