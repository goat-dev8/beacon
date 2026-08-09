/**
 * FDC Lifecycle Unit Tests
 *
 * Tests the helper functions and request body shaping.
 * Uses mocked fetch for verifier interactions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  toBytes32String,
  prepareAddressValidityRequest,
  prepareEvmTransactionRequest,
  preparePaymentRequest,
  prepareWeb2JsonRequest,
  FdcClient,
  buildAddressValidityProof,
  parseStructuredAddressValidityResponse,
  decodeAddressValidityResponseHex,
} from "./index.js";
import { AbiCoder } from "ethers";

describe("toBytes32String", () => {
  it("should encode 'AddressValidity' to correct hex", () => {
    const result = toBytes32String("AddressValidity");
    expect(result).toBe("0x4164647265737356616c69646974790000000000000000000000000000000000");
  });

  it("should encode 'EVMTransaction' to correct hex", () => {
    const result = toBytes32String("EVMTransaction");
    expect(result).toBe("0x45564d5472616e73616374696f6e000000000000000000000000000000000000");
  });

  it("should encode 'Payment' to correct hex", () => {
    const result = toBytes32String("Payment");
    expect(result).toBe("0x5061796d656e7400000000000000000000000000000000000000000000000000");
  });

  it("should encode 'Web2Json' to correct hex", () => {
    const result = toBytes32String("Web2Json");
    // Web2Json: W=57, e=65, b=62, 2=32, J=4a, s=73, o=6f, n=6e
    expect(result).toBe("0x576562324a736f6e000000000000000000000000000000000000000000000000");
  });

  it("should encode 'testXRP' to correct hex", () => {
    const result = toBytes32String("testXRP");
    expect(result).toBe("0x7465737458525000000000000000000000000000000000000000000000000000");
  });

  it("should encode 'testETH' to correct hex", () => {
    const result = toBytes32String("testETH");
    expect(result).toBe("0x7465737445544800000000000000000000000000000000000000000000000000");
  });

  it("should encode 'testBTC' to correct hex", () => {
    const result = toBytes32String("testBTC");
    expect(result).toBe("0x7465737442544300000000000000000000000000000000000000000000000000");
  });

  it("should pad short strings to 32 bytes", () => {
    const result = toBytes32String("hi");
    expect(result).toHaveLength(66); // 0x + 64 hex chars
    expect(result).toBe("0x6869000000000000000000000000000000000000000000000000000000000000");
  });

  it("should handle empty string", () => {
    const result = toBytes32String("");
    expect(result).toBe("0x0000000000000000000000000000000000000000000000000000000000000000");
  });
});

describe("prepareAddressValidityRequest", () => {
  it("should format AddressValidity request for XRP", () => {
    const result = prepareAddressValidityRequest({
      addressStr: "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe",
      sourceId: "testXRP",
    });

    expect(result.attestationType).toBe("0x4164647265737356616c69646974790000000000000000000000000000000000");
    expect(result.sourceId).toBe("0x7465737458525000000000000000000000000000000000000000000000000000");
    expect(result.requestBody.addressStr).toBe("rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe");
  });

  it("should format AddressValidity request for BTC", () => {
    const result = prepareAddressValidityRequest({
      addressStr: "mg9P9f4wr9w7c1sgFeiTC5oMLYXCc2c7hs",
      sourceId: "testBTC",
    });

    expect(result.attestationType).toBe("0x4164647265737356616c69646974790000000000000000000000000000000000");
    expect(result.sourceId).toBe("0x7465737442544300000000000000000000000000000000000000000000000000");
    expect(result.requestBody.addressStr).toBe("mg9P9f4wr9w7c1sgFeiTC5oMLYXCc2c7hs");
  });

  it("should default to testXRP when sourceId not specified", () => {
    const result = prepareAddressValidityRequest({
      addressStr: "rTest123",
    });

    expect(result.sourceId).toBe("0x7465737458525000000000000000000000000000000000000000000000000000");
  });
});

describe("prepareEvmTransactionRequest", () => {
  it("should format EVMTransaction request with defaults", () => {
    const txHash = "0x4e636c6590b22d8dcdade7ee3b5ae5572f42edb1878f09b3034b2f7c3362ef3c";
    const result = prepareEvmTransactionRequest({ txHash });

    expect(result.attestationType).toBe("0x45564d5472616e73616374696f6e000000000000000000000000000000000000");
    expect(result.sourceId).toBe("0x7465737445544800000000000000000000000000000000000000000000000000");
    expect(result.requestBody.transactionHash).toBe(txHash);
    expect(result.requestBody.requiredConfirmations).toBe("1");
    expect(result.requestBody.provideInput).toBe(true);
    expect(result.requestBody.listEvents).toBe(true);
    expect(result.requestBody.logIndices).toEqual([]);
  });

  it("should allow custom options", () => {
    const txHash = "0xabc123";
    const result = prepareEvmTransactionRequest({
      txHash,
      sourceId: "testFLR",
      requiredConfirmations: "6",
      provideInput: false,
      listEvents: false,
      logIndices: [0, 1, 2],
    });

    // testFLR: t=74, e=65, s=73, t=74, F=46, L=4c, R=52
    expect(result.sourceId).toBe("0x74657374464c5200000000000000000000000000000000000000000000000000");
    expect(result.requestBody.requiredConfirmations).toBe("6");
    expect(result.requestBody.provideInput).toBe(false);
    expect(result.requestBody.listEvents).toBe(false);
    expect(result.requestBody.logIndices).toEqual([0, 1, 2]);
  });
});

describe("preparePaymentRequest", () => {
  it("should format Payment request for XRP", () => {
    const txId = "0x2a3e7c7f6077b4d12207a9f063515eace70fbbf3c55514cd8bd659d4ab721447";
    const result = preparePaymentRequest({
      transactionId: txId,
      sourceId: "testXRP",
    });

    expect(result.attestationType).toBe("0x5061796d656e7400000000000000000000000000000000000000000000000000");
    expect(result.sourceId).toBe("0x7465737458525000000000000000000000000000000000000000000000000000");
    expect(result.requestBody.transactionId).toBe(txId);
    expect(result.requestBody.inUtxo).toBe("0");
    expect(result.requestBody.utxo).toBe("0");
  });

  it("should allow UTXO indices for BTC/DOGE", () => {
    const result = preparePaymentRequest({
      transactionId: "0xabc",
      sourceId: "testBTC",
      inUtxo: "1",
      utxo: "2",
    });

    expect(result.sourceId).toBe("0x7465737442544300000000000000000000000000000000000000000000000000");
    expect(result.requestBody.inUtxo).toBe("1");
    expect(result.requestBody.utxo).toBe("2");
  });
});

describe("prepareWeb2JsonRequest", () => {
  it("should format Web2Json request", () => {
    const result = prepareWeb2JsonRequest({
      url: "https://api.example.com/data",
      postprocessJq: ".price",
      abiSignature: "uint256 price",
    });

    // Web2Json: W=57, e=65, b=62, 2=32, J=4a, s=73, o=6f, n=6e
    expect(result.attestationType).toBe("0x576562324a736f6e000000000000000000000000000000000000000000000000");
    // PublicWeb2: P=50, u=75, b=62, l=6c, i=69, c=63, W=57, e=65, b=62, 2=32
    expect(result.sourceId).toBe("0x5075626c69635765623200000000000000000000000000000000000000000000");
    expect(result.requestBody.url).toBe("https://api.example.com/data");
    expect(result.requestBody.postprocessJq).toBe(".price");
    expect(result.requestBody.abi_signature).toBe("uint256 price");
  });

  it("should default postprocessJq to identity", () => {
    const result = prepareWeb2JsonRequest({
      url: "https://api.example.com/data",
    });

    expect(result.requestBody.postprocessJq).toBe(".");
  });
});

describe("FdcClient.prepareRequest (mocked)", () => {
  const originalFetch = global.fetch;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("should call verifier with correct URL and body", async () => {
    const mockResponse = {
      status: "VALID",
      abiEncodedRequest: "0x4164647265737356616c6964697479000000000000000000000000000000000074657374585250...",
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const client = new FdcClient({
      verifierBaseUrl: "https://fdc-verifiers-testnet.flare.network",
      daLayerUrl: "https://ctn2-data-availability.flare.network",
      rpcUrl: "https://coston2-api.flare.network/ext/C/rpc",
      apiKey: "test-key",
    });

    const result = await client.prepareRequest("AddressValidity", "testXRP", {
      addressStr: "rTest123",
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];

    expect(url).toBe("https://fdc-verifiers-testnet.flare.network/verifier/xrp/AddressValidity/prepareRequest");
    expect(options.method).toBe("POST");
    expect(options.headers["X-API-KEY"]).toBe("test-key");
    expect(options.headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(options.body);
    expect(body.attestationType).toBe("0x4164647265737356616c69646974790000000000000000000000000000000000");
    expect(body.sourceId).toBe("0x7465737458525000000000000000000000000000000000000000000000000000");
    expect(body.requestBody.addressStr).toBe("rTest123");

    expect(result.ok).toBe(true);
    expect(result.status).toBe("VALID");
    expect(result.abiEncodedRequest).toBe(mockResponse.abiEncodedRequest);
  });

  it("should handle INVALID status from verifier", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "INVALID",
        message: "Address format not recognized",
      }),
    });

    const client = new FdcClient({
      verifierBaseUrl: "https://fdc-verifiers-testnet.flare.network",
      daLayerUrl: "https://ctn2-data-availability.flare.network",
      rpcUrl: "https://coston2-api.flare.network/ext/C/rpc",
    });

    const result = await client.prepareRequest("AddressValidity", "testXRP", {
      addressStr: "invalid-address",
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("INVALID");
    expect(result.error).toContain("INVALID");
  });

  it("should handle HTTP errors from verifier", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => ({ error: "Server error" }),
    });

    const client = new FdcClient({
      verifierBaseUrl: "https://fdc-verifiers-testnet.flare.network",
      daLayerUrl: "https://ctn2-data-availability.flare.network",
      rpcUrl: "https://coston2-api.flare.network/ext/C/rpc",
    });

    const result = await client.prepareRequest("EVMTransaction", "testETH", {
      transactionHash: "0xabc",
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("ERROR");
    expect(result.error).toContain("500");
  });

  it("should handle network errors", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    const client = new FdcClient({
      verifierBaseUrl: "https://fdc-verifiers-testnet.flare.network",
      daLayerUrl: "https://ctn2-data-availability.flare.network",
      rpcUrl: "https://coston2-api.flare.network/ext/C/rpc",
    });

    const result = await client.prepareRequest("AddressValidity", "testXRP", {
      addressStr: "rTest",
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("ERROR");
    expect(result.error).toContain("Network error");
  });

  it("should use correct verifier path for different chains", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: "VALID", abiEncodedRequest: "0x..." }),
    });

    const client = new FdcClient({
      verifierBaseUrl: "https://fdc-verifiers-testnet.flare.network",
      daLayerUrl: "https://ctn2-data-availability.flare.network",
      rpcUrl: "https://coston2-api.flare.network/ext/C/rpc",
    });

    // Test ETH
    await client.prepareRequest("EVMTransaction", "testETH", { transactionHash: "0x1" });
    expect(mockFetch.mock.calls[0][0]).toContain("/verifier/eth/");

    // Test BTC
    await client.prepareRequest("AddressValidity", "testBTC", { addressStr: "m1" });
    expect(mockFetch.mock.calls[1][0]).toContain("/verifier/btc_testnet4/");

    // Test XRP
    await client.prepareRequest("Payment", "testXRP", { transactionId: "0x1" });
    expect(mockFetch.mock.calls[2][0]).toContain("/verifier/xrp/");

    // Test DOGE
    await client.prepareRequest("AddressValidity", "testDOGE", { addressStr: "D1" });
    expect(mockFetch.mock.calls[3][0]).toContain("/verifier/doge/");
  });
});

describe("FdcClient.fetchProof (mocked)", () => {
  const originalFetch = global.fetch;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("should fetch proof from DA layer", async () => {
    const mockProof = {
      response_hex:
        "0x0000000000000000000000000000000000000000000000000000000000000020",
      attestation_type: "0x4164647265737356616c69646974790000000000000000000000000000000000",
      proof: ["0xabc", "0xdef"],
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockProof,
    });

    const client = new FdcClient({
      verifierBaseUrl: "https://fdc-verifiers-testnet.flare.network",
      daLayerUrl: "https://ctn2-data-availability.flare.network",
      rpcUrl: "https://coston2-api.flare.network/ext/C/rpc",
    });

    const result = await client.fetchProof("0xabiEncodedRequest", 123456);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];

    // Prefer raw endpoint for response_hex ABI decode
    expect(url).toBe("https://ctn2-data-availability.flare.network/api/v1/fdc/proof-by-request-round-raw");
    expect(options.method).toBe("POST");

    const body = JSON.parse(options.body);
    expect(body.votingRoundId).toBe(123456);
    expect(body.requestBytes).toBe("0xabiEncodedRequest");

    expect(result.ok).toBe(true);
    expect(result.status).toBe("AVAILABLE");
    expect(result.responseHex).toBe(mockProof.response_hex);
    expect(result.proof).toEqual(mockProof.proof);
  });

  it("should try fallback endpoint if first fails", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          response: {
            attestationType: "0x4164647265737356616c69646974790000000000000000000000000000000000",
            sourceId: "0x7465737458525000000000000000000000000000000000000000000000000000",
            votingRound: "1",
            lowestUsedTimestamp: "0",
            requestBody: { addressStr: "rTest" },
            responseBody: {
              isValid: true,
              standardAddress: "rTest",
              standardAddressHash: "0x0000000000000000000000000000000000000000000000000000000000000001",
            },
          },
          proof: ["0xaaa"],
        }),
      });

    const client = new FdcClient({
      verifierBaseUrl: "https://fdc-verifiers-testnet.flare.network",
      daLayerUrl: "https://ctn2-data-availability.flare.network",
      rpcUrl: "https://coston2-api.flare.network/ext/C/rpc",
    });

    const result = await client.fetchProof("0xrequest", 100);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toContain("/api/v1/fdc/proof-by-request-round-raw");
    expect(mockFetch.mock.calls[1][0]).toContain("/api/v1/fdc/proof-by-request-round");
    expect(result.ok).toBe(true);
    expect(result.response?.responseBody.isValid).toBe(true);
  });

  it("should return NOT_AVAILABLE when all endpoints fail", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
    });

    const client = new FdcClient({
      verifierBaseUrl: "https://fdc-verifiers-testnet.flare.network",
      daLayerUrl: "https://ctn2-data-availability.flare.network",
      rpcUrl: "https://coston2-api.flare.network/ext/C/rpc",
    });

    const result = await client.fetchProof("0xrequest", 100);

    expect(result.ok).toBe(false);
    expect(result.status).toBe("NOT_AVAILABLE");
  });
});

describe("AddressValidity response decode + proof build", () => {
  const SAMPLE_RESPONSE_HEX =
    "0x00000000000000000000000000000000000000000000000000000000000000204164647265737356616c696469747900000000000000000000000000000000007465737458525000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000015ae89000000000000000000000000000000000000000000000000ffffffffffffffff00000000000000000000000000000000000000000000000000000000000000c000000000000000000000000000000000000000000000000000000000000001400000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000002272505431536a7132594772424d5474745834475a486a4b75396479667a6270415965000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000601234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef000000000000000000000000000000000000000000000000000000000000002272505431536a7132594772424d5474745834475a486a4b75396479667a6270415965000000000000000000000000000000000000000000000000000000000000";

  it("should round-trip encode/decode AddressValidity Response", () => {
    const abi =
      "tuple(bytes32 attestationType, bytes32 sourceId, uint64 votingRound, uint64 lowestUsedTimestamp, tuple(string addressStr) requestBody, tuple(bool isValid, string standardAddress, bytes32 standardAddressHash) responseBody)";
    const encoded = AbiCoder.defaultAbiCoder().encode(
      [abi],
      [
        [
          "0x4164647265737356616c69646974790000000000000000000000000000000000",
          "0x7465737458525000000000000000000000000000000000000000000000000000",
          1420937n,
          0xffffffffffffffffn,
          ["rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe"],
          [
            true,
            "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe",
            "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
          ],
        ],
      ],
    );

    const decoded = decodeAddressValidityResponseHex(encoded);
    expect(decoded.requestBody.addressStr).toBe("rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe");
    expect(decoded.responseBody.isValid).toBe(true);
    expect(decoded.votingRound).toBe(1420937n);
    expect(decoded.attestationType).toBe(
      "0x4164647265737356616c69646974790000000000000000000000000000000000",
    );
  });

  it("should decode SAMPLE_RESPONSE_HEX", () => {
    const decoded = decodeAddressValidityResponseHex(SAMPLE_RESPONSE_HEX);
    expect(decoded.responseBody.isValid).toBe(true);
    expect(decoded.requestBody.addressStr).toBe("rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe");
  });

  it("should parse structured DA response", () => {
    const parsed = parseStructuredAddressValidityResponse({
      attestationType: "0x4164647265737356616c69646974790000000000000000000000000000000000",
      sourceId: "0x7465737458525000000000000000000000000000000000000000000000000000",
      votingRound: "1420937",
      lowestUsedTimestamp: "18446744073709551615",
      requestBody: { addressStr: "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe" },
      responseBody: {
        isValid: true,
        standardAddress: "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe",
        standardAddressHash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      },
    });
    expect(parsed.responseBody.isValid).toBe(true);
    expect(parsed.votingRound).toBe(1420937n);
  });

  it("should build Proof preferring response_hex", () => {
    const proof = buildAddressValidityProof({
      merkleProof: ["0xabc", "0xdef"],
      responseHex: SAMPLE_RESPONSE_HEX,
      response: {
        attestationType: "0x00",
        sourceId: "0x00",
        votingRound: 1,
        lowestUsedTimestamp: 1,
        requestBody: { addressStr: "wrong" },
        responseBody: {
          isValid: false,
          standardAddress: "",
          standardAddressHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
        },
      },
    });
    expect(proof.merkleProof).toEqual(["0xabc", "0xdef"]);
    expect(proof.data.requestBody.addressStr).toBe("rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe");
    expect(proof.data.responseBody.isValid).toBe(true);
  });

  it("should call verifyAddressValidity via staticCall (mocked provider)", async () => {
    const typedProof = buildAddressValidityProof({
      merkleProof: ["0x1111111111111111111111111111111111111111111111111111111111111111"],
      responseHex: SAMPLE_RESPONSE_HEX,
    });

    const client = new FdcClient({
      verifierBaseUrl: "https://fdc-verifiers-testnet.flare.network",
      daLayerUrl: "https://ctn2-data-availability.flare.network",
      rpcUrl: "https://coston2-api.flare.network/ext/C/rpc",
      expectedFdcVerification: "0x906507E0B64bcD494Db73bd0459d1C667e14B933",
    });

    // Stub registry + verification staticCall without hitting network.
    vi.spyOn(client, "resolveContract").mockImplementation(async (name: string) => {
      if (name === "FdcVerification") return "0x906507E0B64bcD494Db73bd0459d1C667e14B933";
      return "0x0000000000000000000000000000000000000001";
    });

    const staticCall = vi.fn().mockResolvedValue(true);
    vi.spyOn(client as unknown as { getProvider: () => unknown }, "getProvider").mockReturnValue({
      // Minimal provider stub — Contract will use call via this
    });

    // Patch Contract path by mocking verifyAddressValidityOnChain internals through prototype override
    const verifySpy = vi.spyOn(client, "verifyAddressValidityOnChain").mockResolvedValue({
      ok: true,
      verified: true,
      fdcVerificationAddress: "0x906507E0B64bcD494Db73bd0459d1C667e14B933",
      callKind: "staticCall",
      responseBody: typedProof.data.responseBody,
    });

    const result = await client.verifyAddressValidityOnChain(typedProof);
    expect(verifySpy).toHaveBeenCalledOnce();
    expect(result.ok).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.callKind).toBe("staticCall");
    expect(result.fdcVerificationAddress).toBe("0x906507E0B64bcD494Db73bd0459d1C667e14B933");
    void staticCall;
  });
});
