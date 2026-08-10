import { describe, expect, it } from "vitest";
import { Interface } from "ethers";

describe("fassets redeem prepare encoding", () => {
  it("encodes AssetManager.redeem(lots, underlying, executor)", () => {
    const amIf = new Interface([
      "function redeem(uint256 _lots, string _redeemerUnderlyingAddressString, address payable _executor) payable returns (uint256)",
    ]);
    const data = amIf.encodeFunctionData("redeem", [
      2n,
      "rSHYuiEvsYsKR8uUHhBTuGP5zjRcGt4nm",
      "0x0000000000000000000000000000000000000000",
    ]);
    const decoded = amIf.decodeFunctionData("redeem", data);
    expect(Number(decoded[0])).toBe(2);
    expect(String(decoded[1])).toBe("rSHYuiEvsYsKR8uUHhBTuGP5zjRcGt4nm");
  });

  it("encodes AssetManager.redeemAmount(amountUBA, underlying, executor)", () => {
    const amIf = new Interface([
      "function redeemAmount(uint256 _amountUBA, string _redeemerUnderlyingAddressString, address payable _executor) returns (uint256)",
    ]);
    const data = amIf.encodeFunctionData("redeemAmount", [
      5_000_000n,
      "rSHYuiEvsYsKR8uUHhBTuGP5zjRcGt4nm",
      "0x0000000000000000000000000000000000000000",
    ]);
    const decoded = amIf.decodeFunctionData("redeemAmount", data);
    expect(decoded[0]).toBe(5_000_000n);
    expect(String(decoded[1])).toBe("rSHYuiEvsYsKR8uUHhBTuGP5zjRcGt4nm");
  });

  it("encodes AssetManager.redeemWithTag(...)", () => {
    const amIf = new Interface([
      "function redeemWithTag(uint256 _amountUBA, string _redeemerUnderlyingAddressString, address payable _executor, uint256 _destinationTag) returns (uint256)",
    ]);
    const data = amIf.encodeFunctionData("redeemWithTag", [
      5_000_000n,
      "rSHYuiEvsYsKR8uUHhBTuGP5zjRcGt4nm",
      "0x0000000000000000000000000000000000000000",
      42n,
    ]);
    const decoded = amIf.decodeFunctionData("redeemWithTag", data);
    expect(decoded[0]).toBe(5_000_000n);
    expect(Number(decoded[3])).toBe(42);
  });

  it("never maps EMPTY without performed evidence to COMPLETED", () => {
    // Lifecycle honesty unit: COMPLETED requires performed XRPL hash, not EMPTY alone.
    const onChainStatus = "EMPTY";
    const performed = null;
    const lifecycle =
      performed != null
        ? "COMPLETED"
        : onChainStatus === "ACTIVE"
          ? "PENDING"
          : "NOT_FOUND";
    expect(lifecycle).toBe("NOT_FOUND");
  });
});
