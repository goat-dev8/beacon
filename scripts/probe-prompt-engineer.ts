import "dotenv/config";
import { engineerMediaPrompt } from "@beacon/shared";

const r = await engineerMediaPrompt(
  "image",
  "Minimal mint Beacon mark on warm paper, flat vector, green accent",
);
console.log(
  JSON.stringify(
    {
      source: r.source,
      model: r.model,
      prompt: r.prompt.slice(0, 240),
      neg: r.negativePrompt.slice(0, 100),
    },
    null,
    2,
  ),
);
