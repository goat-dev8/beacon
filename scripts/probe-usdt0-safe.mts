import { config } from "dotenv";
config({ path: ".env", override: true });
import { Contract, JsonRpcProvider, formatUnits } from "ethers";
import { loadEnv } from "../packages/shared/src/env.ts";
import { prepareBeaconSafeSwap } from "../packages/shared/src/safeSwap.ts";
import { lookupPersonalSafe, readAgentVaultStatus } from "../packages/shared/src/vaultClient.ts";

const wallet = process.argv[2] || "0x3bE57A5b65265D3704f846B93600308154fec794";
const env = loadEnv();
const safe = await lookupPersonalSafe(wallet, env);
const out = {
  factory: env.BEACON_SAFE_FACTORY_ADDRESS,
  desk: env.BEACON_SWAP_DESK_ADDRESS,
  token: env.X402_TOKEN_ADDRESS,
  vaultEnv: env.BEACON_AGENT_VAULT_ADDRESS || null,
  personalSafe: safe,
};
if (!safe) {
  console.log(JSON.stringify({ ...out, error: "no personal Safe" }, null, 2));
  process.exit(2);
}
const st = await readAgentVaultStatus({ address: safe, wallet, env, personalOnly: true });
const provider = new JsonRpcProvider(env.COSTON2_RPC_URL);
const vault = new Contract(
  safe,
  [
    "function allowedTargets(address) view returns (bool)",
    "function allowedSelectors(bytes4) view returns (bool)",
    "function token() view returns (address)",
  ],
  provider,
);
const token = (await vault.token()) as string;
const transferSel = "0xa9059cbb";
const [targetOk, selectorOk] = await Promise.all([
  vault.allowedTargets(token) as Promise<boolean>,
  vault.allowedSelectors(transferSel) as Promise<boolean>,
]);
const desk = new Contract(env.BEACON_SWAP_DESK_ADDRESS, ["function tokenOut() view returns (address)"], provider);
const fxrp = (await desk.tokenOut()) as string;
const erc = new Contract(
  fxrp,
  ["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)"],
  provider,
);
const [bal, dec] = await Promise.all([erc.balanceOf(env.BEACON_SWAP_DESK_ADDRESS), erc.decimals()]);
const quote = await prepareBeaconSafeSwap({ amountInUnits: "0.01", recipient: wallet, wallet }, env);
console.log(
  JSON.stringify(
    {
      ...out,
      safe: {
        address: st.address,
        owner: st.owner,
        token: st.token,
        balance: st.balanceDisplay,
        maxTx: st.maxSpendPerTxDisplay,
        window: st.rollingWindowBudgetDisplay,
        paused: st.paused,
        sessionActive: st.sessionActive,
        configured: st.configured,
      },
      allowlist: { token, targetOk, selectorOk },
      deskFxrp: formatUnits(bal, dec),
      quote: quote.ok
        ? {
            vault: quote.vault,
            estimatedOut: quote.estimatedOut,
            ftsoAge: quote.ftsoGuard.feedAge,
            xrpUsd: quote.xrpUsd,
            symbolIn: quote.symbolIn,
            symbolOut: quote.symbolOut,
          }
        : { error: quote.error },
    },
    null,
    2,
  ),
);
if (!quote.ok) process.exit(1);
