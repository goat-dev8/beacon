import { describe, expect, it, vi, beforeEach } from "vitest";
import { Interface, parseUnits } from "ethers";

const QUOTER_OUT = parseUnits("0.42", 6);
const USDT0 = "0xe7cd86e13AC4309349F30B3435a9d337750fC82D";
const FXRP = "0x1111111111111111111111111111111111111111";
const POOL = "0x2222222222222222222222222222222222222222";
const WNAT = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const ROUTER = "0x8a1E35F5c98C4E85B36B7B253222eE17773b2781";
const QUOTER = "0x5B5513c55fd06e2658010c121c37b07fC8e8B705";
const FACTORY = "0x8A2578d23d4C532cC9A98FaD91C0523f5efDE652";

vi.mock("./ftso.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ftso.js")>();
  return {
    ...actual,
    readFtsoFeeds: vi.fn(async () => ({
      feeds: [
        { symbol: "XRP/USD", value: 1.0 },
        { symbol: "FLR/USD", value: 0.02 },
      ],
      timestamp: Date.now(),
      ftsoV2: "0xmock",
    })),
  };
});

vi.mock("ethers", async (importOriginal) => {
  const eth = await importOriginal<typeof import("ethers")>();

  class MockJsonRpcProvider {
    async getCode(addr: string) {
      const a = addr.toLowerCase();
      if (
        a === ROUTER.toLowerCase() ||
        a === QUOTER.toLowerCase() ||
        a === FACTORY.toLowerCase() ||
        a === USDT0.toLowerCase() ||
        a === FXRP.toLowerCase() ||
        a === WNAT.toLowerCase() ||
        a === POOL.toLowerCase()
      ) {
        return "0x60806040";
      }
      // Simulate Coston2 emptiness for published SparkDEX addresses when RPC differs —
      // our resolve hits both RPCs with same mock; keep bytecode so Mainnet path wins.
      return "0x60806040";
    }
    async getBlockNumber() {
      return 10_000_000;
    }
  }

  class MockContract {
    address: string;
    constructor(address: string, _abi: unknown, _provider?: unknown) {
      this.address = address.toLowerCase();
    }
    async decimals() {
      return 6;
    }
    async symbol() {
      if (this.address === USDT0.toLowerCase()) return "USDT0";
      if (this.address === FXRP.toLowerCase()) return "FXRP";
      if (this.address === WNAT.toLowerCase()) return "WFLR";
      return "TOKEN";
    }
    async liquidity() {
      return 1_000_000n;
    }
    async getPool(a: string, b: string, fee: number) {
      const pair = [a.toLowerCase(), b.toLowerCase()].sort().join("-");
      const usdtFxrp = [USDT0.toLowerCase(), FXRP.toLowerCase()].sort().join("-");
      if (pair === usdtFxrp && fee === 500) return POOL;
      return "0x0000000000000000000000000000000000000000";
    }
    async fAsset() {
      return FXRP;
    }
    async getContractAddressByName(name: string) {
      if (name === "AssetManagerFXRP") return "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      if (name === "WNat") return WNAT;
      return "0x0000000000000000000000000000000000000000";
    }
    get filters() {
      return { PoolCreated: () => ({}) };
    }
    async queryFilter() {
      return [];
    }
    get quoteExactInputSingle() {
      return {
        staticCall: async () => ({
          amountOut: QUOTER_OUT,
          sqrtPriceX96After: 0n,
          initializedTicksCrossed: 1,
          gasEstimate: 120000n,
          0: QUOTER_OUT,
          3: 120000n,
        }),
      };
    }
  }

  return {
    ...eth,
    Contract: MockContract as unknown as typeof eth.Contract,
    JsonRpcProvider: MockJsonRpcProvider as unknown as typeof eth.JsonRpcProvider,
  };
});

describe("SparkDEX QuoterV2 vs FTSO", () => {
  beforeEach(() => {
    process.env.FLARE_MAINNET_RPC_URL = "https://flare-api.flare.network/ext/C/rpc";
    process.env.COSTON2_RPC_URL = "https://coston2-api.flare.network/ext/bc/C/rpc";
  });

  it("FTSO mid helper is labeled narrative-only (not QuoterV2)", async () => {
    const { estimateSparkDexOutFtso, estimateSparkDexOut, SPARKDEX_QUOTER_V2 } = await import("./sparkDex.js");
    expect(SPARKDEX_QUOTER_V2.toLowerCase()).toBe(QUOTER.toLowerCase());
    const ftso = await estimateSparkDexOutFtso({
      tokenInSymbol: "USDT0",
      tokenOutSymbol: "FXRP",
      amountInUnits: "1",
    });
    expect(parseFloat(ftso.estimatedOut)).toBeCloseTo(1.0, 3);
    expect(ftso.basis.toLowerCase()).toMatch(/ftso/);
    expect(ftso.basis.toLowerCase()).toMatch(/narrative|portfolio|not an executable/);
    expect(ftso.basis.toLowerCase()).not.toContain("quoterv2");

    const legacy = await estimateSparkDexOut({
      tokenInSymbol: "USDT0",
      tokenOutSymbol: "FXRP",
      amountInUnits: "1",
    });
    expect(legacy.basis.toLowerCase()).toMatch(/ftso/);
  });

  it("prepareSparkDexSwap minOut comes from QuoterV2, not FTSO mid", async () => {
    const { prepareSparkDexSwap } = await import("./sparkDex.js");
    const prep = await prepareSparkDexSwap({
      tokenIn: USDT0,
      tokenOut: FXRP,
      fee: 500,
      amountInUnits: "1",
      recipient: "0x3333333333333333333333333333333333333333",
      slippageBps: 100,
    });

    expect(prep.ok).toBe(true);
    if (!prep.ok) return;

    expect(prep.quoteSource).toBe("QuoterV2");
    expect(prep.estimateBasis).toBe("QuoterV2 quoteExactInputSingle");
    expect(prep.estimatedOut).toBe("0.42");
    // Quoter 0.42 with 100 bps slippage → 0.4158 — NOT FTSO ~1.0 * 0.99
    expect(prep.amountOutMinimum).toBe(parseUnits("0.4158", 6).toString());
    expect(prep.amountOutMinimum).not.toBe(parseUnits("0.99", 6).toString());
    expect(prep.amountOutMinimum).not.toBe(parseUnits("1", 6).toString());
    expect(prep.quoter.toLowerCase()).toBe(QUOTER.toLowerCase());
    expect(prep.slippageBps).toBe(100);
    expect(prep.ftsoMidOut).toBeDefined();
    expect(parseFloat(prep.ftsoMidOut!)).toBeCloseTo(1.0, 3);

    const routerIf = new Interface([
      "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
    ]);
    const decoded = routerIf.decodeFunctionData("exactInputSingle", prep.swapData);
    const params = decoded[0] as { amountOutMinimum: bigint };
    expect(params.amountOutMinimum).toBe(parseUnits("0.4158", 6));
  });
});
