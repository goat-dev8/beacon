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
});
