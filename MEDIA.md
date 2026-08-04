# Beacon media tooling

Beacon production jobs generate **real images** via Pollinations (free HTTP API) and **video packs** via Remotion/OpenMontage when available, otherwise Pollinations stills (+ ffmpeg slideshow when present).

## Linked skills (Cursor)

| Slash / skill | Path | Role |
|---|---|---|
| `/openmontage` | `D:\route\OpenMontage` + `~/.cursor/skills/openmontage` | Full agentic video studio / Remotion pipelines |
| `/agent-demo-video` | `~/.cursor/skills/agent-demo-video` | Product demo film (toolkit at `D:/route/okx/claude-code-video-toolkit`) |
| `/remotion-create` | `~/.claude/skills/remotion-create` | Scaffold Remotion compositions |

Set `OPENMONTAGE_ROOT` / `VIDEO_TOOLKIT_ROOT` for local Remotion MP4 renders. On Render free tier those paths are usually empty — Pollinations stills still ship.

## MCP

Pollinations MCP (agent-side generation in Cursor):

```json
"pollinations": {
  "command": "npx",
  "args": ["-y", "@pollinations/mcp"]
}
```

Server-side Beacon does **not** need MCP — it calls `https://image.pollinations.ai/prompt/...` directly (`packages/shared/src/pollinations.ts`).

## Env

```
IMAGE_PROVIDER=pollinations
VIDEO_PROVIDER=auto
POLLINATIONS_IMAGE_BASE=https://image.pollinations.ai/prompt
POLLINATIONS_MODEL=flux
POLLINATIONS_API_KEY=   # optional; gen.pollinations.ai paid/auth tiers
```

AgentRouter chat models (`gpt-5.6-sol`, Claude) are used for briefs/quotes/judges. They do **not** replace Pollinations for pixels — AgentRouter image models return 403 on this token.
