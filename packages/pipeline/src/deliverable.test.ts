import { describe, expect, it } from "vitest";
import {
  generatorSystemPrompt,
  isAcceptableTextDeliverable,
  isStubDeliverable,
  normalizeCodingMarkdown,
} from "./textGenerate.js";

const brief =
  "Create a simple calculator program in Python that takes two numbers and a math operator (+, -, *, /) as input from the user, performs the calculation using conditional statements, and prints the result clearly";

describe("coding deliverable gates", () => {
  it("rejects the old Generated fallback scaffold", () => {
    const stub = `# Coding deliverable

Brief: ${brief}

\`\`\`ts
/** Generated fallback for: ${brief} */
export function run(): string {
  return ${JSON.stringify(brief)};
}
\`\`\`

## Notes
Replace this scaffold with production logic once the live generator is reachable.
`;
    expect(isStubDeliverable(stub, brief)).toBe(true);
    expect(isAcceptableTextDeliverable("coding", stub, brief)).toBe(false);
  });

  it("wraps raw Python into a fenced markdown pack", () => {
    const raw = `a = float(input("First number: "))
op = input("Operator: ").strip()
b = float(input("Second number: "))
if op == "+":
    print(a + b)
elif op == "-":
    print(a - b)
elif op == "*":
    print(a * b)
elif op == "/":
    print(a / b)
else:
    print("bad op")`;
    const wrapped = normalizeCodingMarkdown("coding", raw, brief);
    expect(wrapped).toContain("```python");
    expect(isAcceptableTextDeliverable("coding", wrapped, brief)).toBe(true);
  });

  it("accepts a real Python calculator markdown pack", () => {
    const real = `# Python calculator

\`\`\`python
a = float(input("First number: "))
op = input("Operator (+ - * /): ").strip()
b = float(input("Second number: "))
if op == "+":
    result = a + b
elif op == "-":
    result = a - b
elif op == "*":
    result = a * b
elif op == "/":
    result = a / b if b != 0 else "Error: division by zero"
else:
    result = "Unknown operator"
print("Result:", result)
\`\`\`

## How to run
python main.py
`;
    expect(isStubDeliverable(real, brief)).toBe(false);
    expect(isAcceptableTextDeliverable("coding", real, brief)).toBe(true);
  });
});

describe("research deliverable gates", () => {
  it("rejects a generic one-liner", () => {
    expect(
      isAcceptableTextDeliverable("research", "SparkDEX is a DEX on Flare.", "Research SparkDEX"),
    ).toBe(false);
  });

  it("accepts a structured research brief", () => {
    const body = `# Research SparkDEX

## What was researched
SparkDEX — Flare’s concentrated-liquidity DEX.

## Key findings
1. SparkDEX runs Uniswap v3-style pools on Flare Mainnet.
2. Coston2 SparkDEX SwapRouter bytecode is empty; Beacon uses SwapDesk there.
3. USDT0 on Coston2 is faucet test token, not mainnet USD₮0.

## Conclusions
Trade on SparkDEX on mainnet. Use Beacon Flow on Coston2 for SwapDesk tests.

## Caveats
Not financial advice. No invented URLs or TVL.

## Source checklist
- SparkDEX official documentation
- Flare Developer Hub
`;
    expect(isAcceptableTextDeliverable("research", body, "Research SparkDEX")).toBe(true);
  });

  it("instructs the research generator to structure findings and never invent URLs", () => {
    const prompt = generatorSystemPrompt("research").toLowerCase();
    expect(prompt).toContain("what was researched");
    expect(prompt).toContain("never invent urls");
    expect(prompt).toContain("sparkdex");
  });
});
