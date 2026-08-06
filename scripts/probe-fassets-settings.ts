import { Contract, JsonRpcProvider } from "ethers";

const p = new JsonRpcProvider("https://coston2-api.flare.network/ext/C/rpc");
const reg = new Contract(
  "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019",
  ["function getContractAddressByName(string) view returns (address)"],
  p,
);
const am = await reg.getContractAddressByName("AssetManagerFXRP");
console.log("am", am);

for (const sig of [
  "function lotSize() view returns (uint256)",
  "function assetMintingGranularityUBA() view returns (uint256)",
  "function getCollateralPoolTokenTimelockSeconds() view returns (uint256)",
]) {
  try {
    const c = new Contract(am, [sig], p);
    const name = sig.split(" ")[1]!.split("(")[0]!;
    console.log(name, (await c[name]()).toString());
  } catch (e) {
    console.log("fail", sig.slice(0, 50), String(e).slice(0, 80));
  }
}

// Decode getSettings the way Flare Hardhat starter often does — read as Result array
try {
  const c = new Contract(
    am,
    [
      "function getSettings() view returns (tuple(uint64 assetMintingGracePeriodSeconds, uint64 lotSizeAMG, uint8 assetDecimals))",
    ],
    p,
  );
  const s = await c.getSettings();
  console.log("partial", s);
} catch (e) {
  console.log("partial fail", String(e).slice(0, 120));
}

// Use periphery-style: many fields — try common IAssetManagerSettings
const SETTINGS_ABI = [
  `function getSettings() view returns (
    tuple(
      uint64 assetMintingGracePeriodSeconds,
      uint64 lotSizeAMG,
      uint64 maxTrustedPriceAgeSeconds,
      uint64 mintingPoolHoldingsRequiredBIPS,
      uint64 mintingVaultCollateralBuyPremiumBIPS,
      uint64 vaultCollateralBuyPremiumBIPS,
      uint64 poolCollateralBuyPremiumBIPS,
      uint64 redemptionDefaultPremiumBIPS,
      uint64 mintingFeeBIPS,
      uint64 redemptionFeeBIPS,
      uint64 vaultCollateralReservationFeeBIPS,
      uint64 poolCollateralReservationFeeBIPS,
      uint64 auctionPriceFactorBIPS,
      uint64 mintingCapAMG,
      uint8 assetDecimals,
      uint8 assetMintingDecimals,
      address fAsset,
      address agentOwnerRegistry
    )
  )`,
];
try {
  const c = new Contract(am, SETTINGS_ABI, p);
  const s = await c.getSettings();
  console.log(
    "settings2 lotSizeAMG",
    s.lotSizeAMG?.toString?.() ?? s[1]?.toString?.(),
    "assetDecimals",
    s.assetDecimals ?? s[14],
  );
} catch (e) {
  console.log("settings2 fail", String(e).slice(0, 160));
}
