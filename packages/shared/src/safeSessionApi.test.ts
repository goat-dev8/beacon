import { Wallet } from "ethers";
import { describe, expect, it } from "vitest";
import {
  createSafeSessionChallenge,
  verifyChallengeAndIssueSession,
  verifySafeSessionToken,
} from "../../../apps/api/src/safeSession.js";

describe("Beacon Agent Safe session", () => {
  it("issues a wallet-bound session and rejects another wallet", async () => {
    const wallet = Wallet.createRandom();
    const other = Wallet.createRandom();
    const secret = "test-session-secret";
    const now = 1_786_230_000;
    const challenge = createSafeSessionChallenge(wallet.address, secret, now);
    const signature = await wallet.signMessage(challenge.message);
    const issued = verifyChallengeAndIssueSession({
      wallet: wallet.address,
      message: challenge.message,
      signature,
      secret,
      nowSeconds: now + 1,
    });

    expect(issued).not.toBeNull();
    expect(issued!.session.issuedAt).toBe(now);
    expect(
      verifySafeSessionToken(issued!.token, wallet.address, secret, now + 2)?.wallet,
    ).toBe(wallet.address.toLowerCase());
    expect(verifySafeSessionToken(issued!.token, other.address, secret, now + 2)).toBeNull();
  });

  it("rejects a tampered or expired challenge", async () => {
    const wallet = Wallet.createRandom();
    const secret = "test-session-secret";
    const now = 1_786_230_000;
    const challenge = createSafeSessionChallenge(wallet.address, secret, now);
    const tampered = challenge.message.replace("chain:114", "chain:14");
    const signature = await wallet.signMessage(tampered);

    expect(
      verifyChallengeAndIssueSession({
        wallet: wallet.address,
        message: tampered,
        signature,
        secret,
        nowSeconds: now + 1,
      }),
    ).toBeNull();

    const validSignature = await wallet.signMessage(challenge.message);
    expect(
      verifyChallengeAndIssueSession({
        wallet: wallet.address,
        message: challenge.message,
        signature: validSignature,
        secret,
        nowSeconds: now + 301,
      }),
    ).toBeNull();
  });
});
