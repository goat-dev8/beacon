/**
 * FCC lifecycle helper unit tests — status labels + honesty helpers (no live RPC).
 */
import { describe, it, expect } from "vitest";
import {
  teeMachineStatusLabel,
  isTeeProduction,
  isEphemeralExtProxyUrl,
  decodeFccPlatform,
  isHardwareAttestedPlatform,
  COSTON2_FLARE_TEE_MANAGER,
  COSTON2_EVIDENCE_TEE_ID,
  COSTON2_HARDWARE_TEE_ID,
  COSTON2_HISTORICAL_SIMULATED_TEE_ID,
} from "./fcc.js";

describe("teeMachineStatusLabel", () => {
  it("maps 2 to PRODUCTION", () => {
    expect(teeMachineStatusLabel(2)).toBe("PRODUCTION");
  });

  it("maps 1 to INITIALIZED", () => {
    expect(teeMachineStatusLabel(1)).toBe("INITIALIZED");
  });

  it("maps 0 to NONE", () => {
    expect(teeMachineStatusLabel(0)).toBe("NONE");
  });

  it("maps unknown codes to UNKNOWN", () => {
    expect(teeMachineStatusLabel(99)).toBe("UNKNOWN");
  });

  it("returns null for null/undefined", () => {
    expect(teeMachineStatusLabel(null)).toBeNull();
    expect(teeMachineStatusLabel(undefined)).toBeNull();
  });
});

describe("isTeeProduction", () => {
  it("is true only for status === 2", () => {
    expect(isTeeProduction(2)).toBe(true);
    expect(isTeeProduction(1)).toBe(false);
    expect(isTeeProduction(0)).toBe(false);
    expect(isTeeProduction(null)).toBe(false);
  });
});

describe("isEphemeralExtProxyUrl", () => {
  it("detects trycloudflare hosts", () => {
    expect(
      isEphemeralExtProxyUrl("https://robert-seattle-stationery-researcher.trycloudflare.com"),
    ).toBe(true);
  });

  it("detects random ngrok-free.app hosts", () => {
    expect(isEphemeralExtProxyUrl("https://abc.ngrok-free.app")).toBe(true);
  });

  it("treats reserved ngrok-free.dev as stable", () => {
    expect(
      isEphemeralExtProxyUrl("https://policy-handful-outlast.ngrok-free.dev"),
    ).toBe(false);
  });

  it("returns false for stable domains", () => {
    expect(isEphemeralExtProxyUrl("https://ext-proxy.example.com")).toBe(false);
  });

  it("returns false for empty", () => {
    expect(isEphemeralExtProxyUrl(null)).toBe(false);
    expect(isEphemeralExtProxyUrl("")).toBe(false);
  });
});

describe("Coston2 evidence constants", () => {
  it("exposes FlareTeeManager + hardware TEE id", () => {
    expect(COSTON2_FLARE_TEE_MANAGER.toLowerCase()).toBe(
      "0x1a9c4a0f9d76c0b1d91d22e24e573a9b377618ae",
    );
    expect(COSTON2_EVIDENCE_TEE_ID.toLowerCase()).toBe(
      COSTON2_HARDWARE_TEE_ID.toLowerCase(),
    );
    expect(COSTON2_HARDWARE_TEE_ID.toLowerCase()).toBe(
      "0xa5e9a81044dd4d66384de09cf95db317fde5646d",
    );
    expect(COSTON2_HISTORICAL_SIMULATED_TEE_ID.toLowerCase()).toBe(
      "0x6516ce58ae346fb4c438463f05b17b50eeb1c8ed",
    );
  });
});

describe("decodeFccPlatform", () => {
  it("decodes GCP_AMD_SEV platform bytes", () => {
    expect(
      decodeFccPlatform(
        "0x4743505f414d445f534556000000000000000000000000000000000000000000",
      ),
    ).toBe("GCP_AMD_SEV");
    expect(isHardwareAttestedPlatform("GCP_AMD_SEV")).toBe(true);
    expect(isHardwareAttestedPlatform("SIMULATED")).toBe(false);
  });
});
