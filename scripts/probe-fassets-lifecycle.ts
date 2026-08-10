/**
 * Read-only Coston2 FAssets probe — no secrets printed, no write txs.
 */
import "dotenv/config";
import { Contract, JsonRpcProvider, formatUnits } from "ethers";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const REGISTRY = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019";

async function main() {
  const rpc = process.env.COSTON2_RPC_URL || "https://coston2-api.flare.network/ext/C/rpc";
  const p = new JsonRpcProvider(rpc);
  const reg = new Contract(
    process.env.FLARE_CONTRACT_REGISTRY || REGISTRY,
    ["function getContractAddressByName(string) view returns (address)"],
    p,
  );
  const amAddr = (await reg.getContractAddressByName("AssetManagerFXRP")) as string;
  const am = new Contract(
    amAddr,
    [
      "function fAsset() view returns (address)",
      "function lotSize() view returns (uint256)",
      "function minimumRedeemAmountUBA() view returns (uint256)",
      "function getAllAgents(uint256,uint256) view returns (address[],uint256)",
      "function redemptionQueue(uint256,uint256) view returns (tuple(uint256 redemptionTicketId, address agentVault, uint256 ticketValueUBA)[], uint256)",
      "function getAvailableAgentsList(uint256,uint256) view returns (address[],uint256)",
    ],
    p,
  );

  const fxrp = (await am.fAsset()) as string;
  const lot = (await am.lotSize()) as bigint;
  const minR = (await am.minimumRedeemAmountUBA()) as bigint;
  const agents = await am.getAllAgents(0, 5);
  let availableAgents: { count: number; sample: string[] } | { error: string } = {
    count: 0,
    sample: [],
  };
  try {
    const avail = await am.getAvailableAgentsList(0, 5);
    availableAgents = {
      count: Number(avail[1]),
      sample: (avail[0] as string[]).slice(0, 3),
    };
  } catch (e) {
    availableAgents = { error: String(e).slice(0, 160) };
  }

  let queue:
    | {
        tickets: Array<{ id: string; agent: string; valueUBA: string }>;
        next: string;
      }
    | { error: string };
  try {
    const q = await am.redemptionQueue(0n, 5n);
    queue = {
      tickets: (q[0] as Array<{ redemptionTicketId: bigint; agentVault: string; ticketValueUBA: bigint }>).map(
        (t) => ({
          id: t.redemptionTicketId.toString(),
          agent: t.agentVault,
          valueUBA: t.ticketValueUBA.toString(),
        }),
      ),
      next: (q[1] as bigint).toString(),
    };
  } catch (e) {
    queue = { error: String(e).slice(0, 200) };
  }

  const token = new Contract(
    fxrp,
    [
      "function symbol() view returns (string)",
      "function decimals() view returns (uint8)",
      "function balanceOf(address) view returns (uint256)",
      "function name() view returns (string)",
    ],
    p,
  );
  const symbol = String(await token.symbol());
  const name = String(await token.name());
  const decimals = Number(await token.decimals());

  const balanceAddrs = [
    process.env.DEPLOYER_ADDRESS,
    process.env.SETTLER_ADDRESS,
    process.env.BEACON_AGENT_VAULT_ADDRESS,
    process.env.X402_PAYEE_ADDRESS,
    process.env.BEACON_SWAP_DESK_ADDRESS,
  ].filter((a): a is string => Boolean(a) && /^0x[a-fA-F0-9]{40}$/.test(a));

  const fxrpBalances: Record<string, string> = {};
  for (const a of balanceAddrs) {
    try {
      fxrpBalances[a.toLowerCase()] = formatUnits(await token.balanceOf(a), decimals);
    } catch {
      fxrpBalances[a.toLowerCase()] = "read_error";
    }
  }

  // Probe redeemAmount / redeemWithTag selectors via eth_call simulate (expect revert without FXRP)
  const iface = new Contract(
    amAddr,
    [
      "function redeemAmount(uint256,string,address) returns (uint256)",
      "function redeemWithTag(uint256,string,address,uint256) returns (uint256)",
    ],
    p,
  );
  const selectorProbe: Record<string, string> = {};
  for (const [label, data] of [
    [
      "redeemAmount",
      iface.interface.encodeFunctionData("redeemAmount", [
        minR,
        "rSHYuiEvsYsKR8uUHhBTuGP5zjRcGt4nm",
        "0x0000000000000000000000000000000000000000",
      ]),
    ],
    [
      "redeemWithTag",
      iface.interface.encodeFunctionData("redeemWithTag", [
        minR,
        "rSHYuiEvsYsKR8uUHhBTuGP5zjRcGt4nm",
        "0x0000000000000000000000000000000000000000",
        1n,
      ]),
    ],
  ] as const) {
    try {
      await p.call({ to: amAddr, data });
      selectorProbe[label] = "call_ok_unexpected";
    } catch (e) {
      const msg = String(e);
      // Selector exists if we get a contract revert rather than "function not found"
      selectorProbe[label] = /execution reverted|revert|insufficient|ERC20|allowance|balance/i.test(msg)
        ? "selector_present_reverted_as_expected"
        : msg.slice(0, 180);
    }
  }

  const evidence = {
    capturedAt: new Date().toISOString(),
    network: "coston2",
    chainId: 114,
    rpcHost: (() => {
      try {
        return new URL(rpc).host;
      } catch {
        return "unknown";
      }
    })(),
    registryResolved: {
      AssetManagerFXRP: amAddr,
      fAsset: fxrp,
    },
    expectedCrossCheck: {
      EXPECTED_ASSET_MANAGER_FXRP: process.env.EXPECTED_ASSET_MANAGER_FXRP ?? null,
      EXPECTED_FXRP_TOKEN: process.env.EXPECTED_FXRP_TOKEN ?? null,
      assetManagerMatch:
        !process.env.EXPECTED_ASSET_MANAGER_FXRP ||
        process.env.EXPECTED_ASSET_MANAGER_FXRP.toLowerCase() === amAddr.toLowerCase(),
      fxrpMatch:
        !process.env.EXPECTED_FXRP_TOKEN ||
        process.env.EXPECTED_FXRP_TOKEN.toLowerCase() === fxrp.toLowerCase(),
    },
    settings: {
      symbol,
      name,
      decimals,
      lotSizeUBA: lot.toString(),
      lotSizeDisplay: formatUnits(lot, decimals),
      minimumRedeemAmountUBA: minR.toString(),
      minimumRedeemDisplay: formatUnits(minR, decimals),
    },
    agents: {
      total: Number(agents[1]),
      sample: (agents[0] as string[]).slice(0, 3),
      available: availableAgents,
    },
    redemptionQueue: queue,
    fxrpBalancesSample: fxrpBalances,
    selectorProbe,
    xrplConfigured: Boolean(process.env.XRPL_JSON_RPC_URL || process.env.XRPL_WSS_URL),
    honesty: {
      preparePath: "REAL — redeem / redeemAmount / redeemWithTag calldata can be prepared from live lotSize + minimumRedeemAmountUBA",
      requestSubmission: "Requires funded FXRP wallet + user/agent signature — not auto-completed by this probe",
      completedRequires: "RedemptionPerformed with XRPL transactionHash (or verified XRPL payment) — never invent COMPLETE",
      mint: "docs_handoff / NOT_AVAILABLE for automated mint",
    },
    docs: [
      "https://dev.flare.network/fassets/overview",
      "https://dev.flare.network/fassets/redemption",
      "https://dev.flare.network/fassets/developer-guides/fassets-redeem",
      "https://dev.flare.network/fassets/developer-guides/fassets-redeem-amount",
      "https://dev.flare.network/fassets/developer-guides/fassets-list-agents",
    ],
  };

  const outDir = resolve("docs/evidence");
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, "fassets-coston2-status.json");
  writeFileSync(outPath, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ wrote: outPath, ...evidence }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
