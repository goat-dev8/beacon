import { Contract, JsonRpcProvider } from "ethers";

async function main() {
  const p = new JsonRpcProvider("https://coston2-api.flare.network/ext/C/rpc");
  const r = new Contract(
    "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019",
    ["function getContractAddressByName(string) view returns (address)"],
    p,
  );
  const names = [
    "FdcHub",
    "FdcVerification",
    "FdcRequestFeeConfigurations",
    "FtsoV2",
    "AssetManagerController",
    "Relay",
    "FlareSystemsManager",
  ];
  for (const n of names) {
    try {
      const a = await r.getContractAddressByName(n);
      console.log(n, a);
    } catch (e) {
      console.log(n, "ERR", String(e).slice(0, 100));
    }
  }
}

main();
