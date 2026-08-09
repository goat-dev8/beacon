import { Contract, JsonRpcProvider } from "ethers";

const MGR = "0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE";
const TEE = "0x6516cE58ae346fB4c438463f05B17B50EeB1c8ed";

async function main() {
  const p = new JsonRpcProvider("https://coston2-api.flare.network/ext/C/rpc");
  const c = new Contract(
    MGR,
    [
      "function getTeeMachineStatus(address) view returns (uint8)",
      "function getRandomTeeIds(uint256,uint256) view returns (address[])",
    ],
    p,
  );
  const status = Number(await c.getTeeMachineStatus(TEE));
  let randomTeeIds: string[] | { error: string } = [];
  try {
    randomTeeIds = (await c.getRandomTeeIds(65925n, 1)) as string[];
  } catch (e) {
    randomTeeIds = { error: String(e).slice(0, 200) };
  }
  console.log(
    JSON.stringify(
      {
        teeId: TEE,
        status,
        label: status === 2 ? "PRODUCTION" : status === 1 ? "INITIALIZED" : String(status),
        randomTeeIds,
      },
      null,
      2,
    ),
  );
}

main();
