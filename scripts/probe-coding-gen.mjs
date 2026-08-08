import "dotenv/config";
import { chatForRole, loadEnv, resetEnvCache } from "../packages/shared/src/index.ts";

resetEnvCache();
const env = loadEnv();
const brief =
  "Create a simple calculator program in Python that takes two numbers and a math operator (+, -, *, /) as input from the user, performs the calculation using conditional statements, and prints the result clearly";
const r = await chatForRole(
  "generator",
  [
    {
      role: "system",
      content:
        "You are Beacon coding generator. Write complete Python in one markdown fenced block. No stubs.",
    },
    { role: "user", content: `Service: coding\n\nBrief:\n${brief}` },
  ],
  { temperature: 0.2, maxTokens: 1200, env },
);
console.log("MODEL", r.model, "MS", r.latencyMs, "CHARS", r.content.length);
console.log(r.content.slice(0, 500));
console.log("HAS_INPUT", /input\s*\(/.test(r.content));
console.log("HAS_FALLBACK", /Generated fallback/.test(r.content));
