/**
 * Coston2 FXRP yield vault rails — on-chain status + prepare calldata.
 *
 * NEVER invent APY numbers. Surface shares / assets / pending claims only.
 *
 * Network: Flare Testnet Coston2 (chain 114)
 * Docs:
 * - https://dev.flare.network/fxrp/firelight
 * - https://dev.flare.network/fxrp/upshift
 */

import { Contract, Interface, JsonRpcProvider, formatUnits, parseUnits } from "ethers";
import { loadEnv, type BeaconEnv } from "./env.js";

export const COSTON2_CHAIN_ID = 114;
export const COSTON2_EXPLORER = "https://coston2.testnet.flarescan.com";

/** Documented Firelight vault on Coston2. */
export const FIRELIGHT_VAULT_COSTON2 = "0xC90D6847747b85d1fa2E07859869fb9fB72c0361";
/** Documented Upshift tokenized vault on Coston2. */
export const UPSHIFT_VAULT_COSTON2 = "0x24c1a47cD5e8473b64EAB2a94515a196E10C7C81";

const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address spender,uint256 amount) returns (bool)",
];

const FIRELIGHT_ABI = [
  "function asset() view returns (address)",
  "function totalAssets() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function convertToAssets(uint256 shares) view returns (uint256)",
  "function convertToShares(uint256 assets) view returns (uint256)",
  "function maxDeposit(address) view returns (uint256)",
  "function maxWithdraw(address) view returns (uint256)",
  "function maxRedeem(address) view returns (uint256)",
  "function currentPeriod() view returns (uint256)",
  "function currentPeriodEnd() view returns (uint256)",
  "function withdrawalsOf(uint256 period,address account) view returns (uint256)",
  "function deposit(uint256 assets,address receiver) returns (uint256)",
  "function withdraw(uint256 assets,address receiver,address owner) returns (uint256)",
  "function redeem(uint256 shares,address receiver,address owner) returns (uint256)",
  "function claimWithdraw(uint256 period) returns (uint256)",
];

const UPSHIFT_ABI = [
  "function asset() view returns (address)",
  "function lpTokenAddress() view returns (address)",
  "function withdrawalsPaused() view returns (bool)",
  "function lagDuration() view returns (uint256)",
  "function withdrawalFee() view returns (uint256)",
  "function instantRedemptionFee() view returns (uint256)",
  "function maxWithdrawalAmount() view returns (uint256)",
  "function getWithdrawalEpoch() view returns (uint256 year,uint256 month,uint256 day,uint256 claimableEpoch)",
  "function previewDeposit(address token,uint256 amount) view returns (uint256 shares,uint256 amountInRef)",
  "function previewRedemption(uint256 shares,bool instant) view returns (uint256 assets,uint256 assetsAfterFee)",
  "function getBurnableAmountByReceiver(uint256 year,uint256 month,uint256 day,address receiver) view returns (uint256)",
  "function deposit(address token,uint256 amount,address receiver)",
  "function requestRedeem(uint256 shares,address receiver)",
  "function instantRedeem(uint256 shares,address receiver)",
  "function claim(uint256 year,uint256 month,uint256 day,address receiver)",
];

export type YieldVaultId = "firelight" | "upshift";

export interface YieldVaultPrep {
  vaultId: YieldVaultId;
  action: string;
  chainId: number;
  network: string;
  to: string;
  data: string;
  approveTo?: string;
  approveData?: string;
  value: "0";
  honesty: string;
  docs: string[];
  note: string;
}

export interface FirelightVaultStatus {
  id: "firelight";
  network: "coston2";
  chainId: number;
  vault: string;
  asset: string;
  assetSymbol: string;
  assetDecimals: number;
  totalAssets: string;
  totalAssetsDisplay: string;
  totalSupply: string;
  totalSupplyDisplay: string;
  /** assets per share from on-chain totals — NOT an APY. */
  sharePriceDisplay: string | null;
  currentPeriod: string;
  currentPeriodEnd: number;
  user?: {
    shares: string;
    sharesDisplay: string;
    assets: string;
    assetsDisplay: string;
    pendingWithdrawals: Array<{ period: string; amount: string; amountDisplay: string }>;
  };
  honesty: string;
  docs: string[];
  explorer: string;
}

export interface UpshiftVaultStatus {
  id: "upshift";
  network: "coston2";
  chainId: number;
  vault: string;
  asset: string;
  assetSymbol: string;
  assetDecimals: number;
  lpToken: string;
  withdrawalsPaused: boolean;
  lagDurationSec: string;
  /** Fee fields are on-chain config — NOT APY. */
  withdrawalFeeRaw: string;
  instantRedemptionFeeRaw: string;
  maxWithdrawalAmount: string;
  epoch: { year: string; month: string; day: string; claimableEpoch: string };
  user?: {
    assetBalance: string;
    assetBalanceDisplay: string;
    lpBalance: string;
    lpBalanceDisplay: string;
  };
  honesty: string;
  docs: string[];
  explorer: string;
}

export interface YieldVaultDesk {
  network: "coston2";
  chainId: number;
  firelight: FirelightVaultStatus | { error: string; vault: string };
  upshift: UpshiftVaultStatus | { error: string; vault: string };
  honesty: string;
  docs: string[];
  flarePrimitive: "FXRP yield rails (Coston2)";
}

function firelightDocs() {
  return [
    "https://dev.flare.network/fxrp/firelight",
    "https://dev.flare.network/fxrp/firelight/status",
    `${COSTON2_EXPLORER}/address/${FIRELIGHT_VAULT_COSTON2}`,
  ];
}

function upshiftDocs() {
  return [
    "https://dev.flare.network/fxrp/upshift",
    "https://dev.flare.network/fxrp/upshift/status",
    `${COSTON2_EXPLORER}/address/${UPSHIFT_VAULT_COSTON2}`,
  ];
}

const NO_APY =
  "On-chain yield-rail status only. Beacon never invents APY — verify rewards and risk yourself.";

export async function readFirelightVaultStatus(
  opts?: { wallet?: string; env?: BeaconEnv },
): Promise<FirelightVaultStatus> {
  const env = opts?.env ?? loadEnv();
  const provider = new JsonRpcProvider(env.COSTON2_RPC_URL);
  const vault = new Contract(FIRELIGHT_VAULT_COSTON2, FIRELIGHT_ABI, provider);
  const asset = (await vault.asset()) as string;
  const token = new Contract(asset, ERC20_ABI, provider);
  const [symbol, decimals, totalAssets, totalSupply, currentPeriod, currentPeriodEnd] =
    await Promise.all([
      token.symbol().then(String).catch(() => "ASSET"),
      token.decimals().then(Number),
      vault.totalAssets() as Promise<bigint>,
      vault.totalSupply() as Promise<bigint>,
      vault.currentPeriod() as Promise<bigint>,
      vault.currentPeriodEnd() as Promise<bigint>,
    ]);

  let sharePriceDisplay: string | null = null;
  if (totalSupply > 0n) {
    const precision = 10n ** BigInt(decimals);
    const rate = (totalAssets * precision) / totalSupply;
    sharePriceDisplay = formatUnits(rate, decimals);
  }

  let user: FirelightVaultStatus["user"];
  if (opts?.wallet) {
    const shares = (await vault.balanceOf(opts.wallet)) as bigint;
    const assets = shares > 0n ? ((await vault.convertToAssets(shares)) as bigint) : 0n;
    const pending: Array<{ period: string; amount: string; amountDisplay: string }> = [];
    const periods = [currentPeriod];
    if (currentPeriod > 0n) periods.push(currentPeriod - 1n);
    for (const period of periods) {
      try {
        const w = (await vault.withdrawalsOf(period, opts.wallet)) as bigint;
        if (w > 0n) {
          pending.push({
            period: period.toString(),
            amount: w.toString(),
            amountDisplay: formatUnits(w, decimals),
          });
        }
      } catch {
        /* period may not exist */
      }
    }
    user = {
      shares: shares.toString(),
      sharesDisplay: formatUnits(shares, decimals),
      assets: assets.toString(),
      assetsDisplay: formatUnits(assets, decimals),
      pendingWithdrawals: pending,
    };
  }

  return {
    id: "firelight",
    network: "coston2",
    chainId: COSTON2_CHAIN_ID,
    vault: FIRELIGHT_VAULT_COSTON2,
    asset,
    assetSymbol: symbol,
    assetDecimals: decimals,
    totalAssets: totalAssets.toString(),
    totalAssetsDisplay: formatUnits(totalAssets, decimals),
    totalSupply: totalSupply.toString(),
    totalSupplyDisplay: formatUnits(totalSupply, decimals),
    sharePriceDisplay,
    currentPeriod: currentPeriod.toString(),
    currentPeriodEnd: Number(currentPeriodEnd),
    user,
    honesty: NO_APY,
    docs: firelightDocs(),
    explorer: `${COSTON2_EXPLORER}/address/${FIRELIGHT_VAULT_COSTON2}`,
  };
}

export async function readUpshiftVaultStatus(
  opts?: { wallet?: string; env?: BeaconEnv },
): Promise<UpshiftVaultStatus> {
  const env = opts?.env ?? loadEnv();
  const provider = new JsonRpcProvider(env.COSTON2_RPC_URL);
  const vault = new Contract(UPSHIFT_VAULT_COSTON2, UPSHIFT_ABI, provider);
  const asset = (await vault.asset()) as string;
  const lpToken = (await vault.lpTokenAddress()) as string;
  const token = new Contract(asset, ERC20_ABI, provider);
  const lp = new Contract(lpToken, ERC20_ABI, provider);

  const [
    symbol,
    decimals,
    withdrawalsPaused,
    lagDuration,
    withdrawalFee,
    instantRedemptionFee,
    maxWithdrawalAmount,
    epoch,
  ] = await Promise.all([
    token.symbol().then(String).catch(() => "ASSET"),
    token.decimals().then(Number),
    vault.withdrawalsPaused() as Promise<boolean>,
    vault.lagDuration() as Promise<bigint>,
    vault.withdrawalFee() as Promise<bigint>,
    vault.instantRedemptionFee() as Promise<bigint>,
    vault.maxWithdrawalAmount() as Promise<bigint>,
    vault.getWithdrawalEpoch() as Promise<[bigint, bigint, bigint, bigint]>,
  ]);

  let user: UpshiftVaultStatus["user"];
  if (opts?.wallet) {
    const [assetBal, lpBal] = await Promise.all([
      token.balanceOf(opts.wallet) as Promise<bigint>,
      lp.balanceOf(opts.wallet) as Promise<bigint>,
    ]);
    user = {
      assetBalance: assetBal.toString(),
      assetBalanceDisplay: formatUnits(assetBal, decimals),
      lpBalance: lpBal.toString(),
      lpBalanceDisplay: formatUnits(lpBal, decimals),
    };
  }

  return {
    id: "upshift",
    network: "coston2",
    chainId: COSTON2_CHAIN_ID,
    vault: UPSHIFT_VAULT_COSTON2,
    asset,
    assetSymbol: symbol,
    assetDecimals: decimals,
    lpToken,
    withdrawalsPaused,
    lagDurationSec: lagDuration.toString(),
    withdrawalFeeRaw: withdrawalFee.toString(),
    instantRedemptionFeeRaw: instantRedemptionFee.toString(),
    maxWithdrawalAmount: maxWithdrawalAmount.toString(),
    epoch: {
      year: epoch[0].toString(),
      month: epoch[1].toString(),
      day: epoch[2].toString(),
      claimableEpoch: epoch[3].toString(),
    },
    user,
    honesty: NO_APY,
    docs: upshiftDocs(),
    explorer: `${COSTON2_EXPLORER}/address/${UPSHIFT_VAULT_COSTON2}`,
  };
}

export async function readYieldVaultDesk(opts?: {
  wallet?: string;
  env?: BeaconEnv;
}): Promise<YieldVaultDesk> {
  const [firelight, upshift] = await Promise.all([
    readFirelightVaultStatus(opts).catch((e) => ({
      error: e instanceof Error ? e.message : String(e),
      vault: FIRELIGHT_VAULT_COSTON2,
    })),
    readUpshiftVaultStatus(opts).catch((e) => ({
      error: e instanceof Error ? e.message : String(e),
      vault: UPSHIFT_VAULT_COSTON2,
    })),
  ]);

  return {
    network: "coston2",
    chainId: COSTON2_CHAIN_ID,
    firelight,
    upshift,
    honesty: `${NO_APY} Contracts documented on DevHub for Coston2 only.`,
    docs: [...firelightDocs(), ...upshiftDocs()],
    flarePrimitive: "FXRP vault rails (Coston2)",
  };
}

function approveData(spender: string, amount: bigint): { approveTo: string; approveData: string } {
  const erc20 = new Interface(ERC20_ABI);
  return {
    approveTo: "", // filled by caller with token address
    approveData: erc20.encodeFunctionData("approve", [spender, amount]),
  };
}

export async function prepareFirelightDeposit(
  params: { amountUnits: string; recipient: string },
  env: BeaconEnv = loadEnv(),
): Promise<YieldVaultPrep> {
  const provider = new JsonRpcProvider(env.COSTON2_RPC_URL);
  const vault = new Contract(FIRELIGHT_VAULT_COSTON2, FIRELIGHT_ABI, provider);
  const asset = (await vault.asset()) as string;
  const decimals = Number(await new Contract(asset, ERC20_ABI, provider).decimals());
  const amount = parseUnits(params.amountUnits, decimals);
  const iface = new Interface(FIRELIGHT_ABI);
  const appr = approveData(FIRELIGHT_VAULT_COSTON2, amount);
  return {
    vaultId: "firelight",
    action: "deposit",
    chainId: COSTON2_CHAIN_ID,
    network: "Flare Testnet Coston2",
    to: FIRELIGHT_VAULT_COSTON2,
    data: iface.encodeFunctionData("deposit", [amount, params.recipient]),
    approveTo: asset,
    approveData: appr.approveData,
    value: "0",
    honesty: NO_APY,
    docs: firelightDocs(),
    note: "ERC-4626 deposit. Approve asset then deposit. Period-based withdraws require a later claimWithdraw.",
  };
}

export async function prepareFirelightWithdraw(
  params: { amountUnits: string; owner: string; receiver?: string },
  env: BeaconEnv = loadEnv(),
): Promise<YieldVaultPrep> {
  const provider = new JsonRpcProvider(env.COSTON2_RPC_URL);
  const vault = new Contract(FIRELIGHT_VAULT_COSTON2, FIRELIGHT_ABI, provider);
  const asset = (await vault.asset()) as string;
  const decimals = Number(await new Contract(asset, ERC20_ABI, provider).decimals());
  const amount = parseUnits(params.amountUnits, decimals);
  const iface = new Interface(FIRELIGHT_ABI);
  const receiver = params.receiver || params.owner;
  return {
    vaultId: "firelight",
    action: "withdraw",
    chainId: COSTON2_CHAIN_ID,
    network: "Flare Testnet Coston2",
    to: FIRELIGHT_VAULT_COSTON2,
    data: iface.encodeFunctionData("withdraw", [amount, receiver, params.owner]),
    value: "0",
    honesty: NO_APY,
    docs: firelightDocs(),
    note: "Creates a period withdrawal request — assets are not sent until claimWithdraw after the period ends.",
  };
}

export async function prepareFirelightClaimWithdraw(
  params: { period: string | number },
): Promise<YieldVaultPrep> {
  const iface = new Interface(FIRELIGHT_ABI);
  return {
    vaultId: "firelight",
    action: "claimWithdraw",
    chainId: COSTON2_CHAIN_ID,
    network: "Flare Testnet Coston2",
    to: FIRELIGHT_VAULT_COSTON2,
    data: iface.encodeFunctionData("claimWithdraw", [BigInt(params.period)]),
    value: "0",
    honesty: NO_APY,
    docs: firelightDocs(),
    note: "Claims assets for a completed withdrawal period.",
  };
}

export async function prepareUpshiftDeposit(
  params: { amountUnits: string; recipient: string },
  env: BeaconEnv = loadEnv(),
): Promise<YieldVaultPrep> {
  const provider = new JsonRpcProvider(env.COSTON2_RPC_URL);
  const vault = new Contract(UPSHIFT_VAULT_COSTON2, UPSHIFT_ABI, provider);
  const asset = (await vault.asset()) as string;
  const decimals = Number(await new Contract(asset, ERC20_ABI, provider).decimals());
  const amount = parseUnits(params.amountUnits, decimals);
  const iface = new Interface(UPSHIFT_ABI);
  const appr = approveData(UPSHIFT_VAULT_COSTON2, amount);
  return {
    vaultId: "upshift",
    action: "deposit",
    chainId: COSTON2_CHAIN_ID,
    network: "Flare Testnet Coston2",
    to: UPSHIFT_VAULT_COSTON2,
    data: iface.encodeFunctionData("deposit", [asset, amount, params.recipient]),
    approveTo: asset,
    approveData: appr.approveData,
    value: "0",
    honesty: NO_APY,
    docs: upshiftDocs(),
    note: "Approve reference asset then deposit — mints LP shares. No APY claimed.",
  };
}

export async function prepareUpshiftRequestRedeem(
  params: { sharesUnits: string; recipient: string },
  env: BeaconEnv = loadEnv(),
): Promise<YieldVaultPrep> {
  const provider = new JsonRpcProvider(env.COSTON2_RPC_URL);
  const vault = new Contract(UPSHIFT_VAULT_COSTON2, UPSHIFT_ABI, provider);
  const lpToken = (await vault.lpTokenAddress()) as string;
  const decimals = Number(await new Contract(lpToken, ERC20_ABI, provider).decimals());
  const shares = parseUnits(params.sharesUnits, decimals);
  const iface = new Interface(UPSHIFT_ABI);
  const appr = approveData(UPSHIFT_VAULT_COSTON2, shares);
  return {
    vaultId: "upshift",
    action: "requestRedeem",
    chainId: COSTON2_CHAIN_ID,
    network: "Flare Testnet Coston2",
    to: UPSHIFT_VAULT_COSTON2,
    data: iface.encodeFunctionData("requestRedeem", [shares, params.recipient]),
    approveTo: lpToken,
    approveData: appr.approveData,
    value: "0",
    honesty: NO_APY,
    docs: upshiftDocs(),
    note: "Locks LP shares; claim later with claim(year,month,day,receiver) after lag.",
  };
}

export async function prepareUpshiftInstantRedeem(
  params: { sharesUnits: string; recipient: string },
  env: BeaconEnv = loadEnv(),
): Promise<YieldVaultPrep> {
  const provider = new JsonRpcProvider(env.COSTON2_RPC_URL);
  const vault = new Contract(UPSHIFT_VAULT_COSTON2, UPSHIFT_ABI, provider);
  const lpToken = (await vault.lpTokenAddress()) as string;
  const decimals = Number(await new Contract(lpToken, ERC20_ABI, provider).decimals());
  const shares = parseUnits(params.sharesUnits, decimals);
  const iface = new Interface(UPSHIFT_ABI);
  return {
    vaultId: "upshift",
    action: "instantRedeem",
    chainId: COSTON2_CHAIN_ID,
    network: "Flare Testnet Coston2",
    to: UPSHIFT_VAULT_COSTON2,
    data: iface.encodeFunctionData("instantRedeem", [shares, params.recipient]),
    value: "0",
    honesty: NO_APY,
    docs: upshiftDocs(),
    note: "Burns LP immediately subject to on-chain instant redemption fee (not an APY).",
  };
}

export async function prepareUpshiftClaim(
  params: { year: number; month: number; day: number; receiver: string },
): Promise<YieldVaultPrep> {
  const iface = new Interface(UPSHIFT_ABI);
  return {
    vaultId: "upshift",
    action: "claim",
    chainId: COSTON2_CHAIN_ID,
    network: "Flare Testnet Coston2",
    to: UPSHIFT_VAULT_COSTON2,
    data: iface.encodeFunctionData("claim", [params.year, params.month, params.day, params.receiver]),
    value: "0",
    honesty: NO_APY,
    docs: upshiftDocs(),
    note: "Claims a previously requested redeem for the given epoch date.",
  };
}
