import { describe, expect, it } from "vitest";
import { isAcceptableTextDeliverable, isStubDeliverable } from "./textGenerate.js";

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
