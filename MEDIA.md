# Beacon professional media stack

Pollinations anonymous Flux is **no longer reliable** (402/500 — Pollen balance). Production quality requires one of:

| Priority | Provider | Env | Quality |
|---|---|---|---|
| 1 | **ComfyUI** (Flux.2 / Qwen Image / Wan 2.2 / LTX) | `COMFYUI_URL` + optional workflow | Best open-source |
| 2 | **Hugging Face** Flux (fal-ai via Inference Providers) | `HF_TOKEN` | Strong, free tier credits |
| 3 | Pollinations | `POLLINATIONS_*` | Only if entitled |
| — | SVG fallback | none | Honest placeholder |

**Always:** Claude Opus 5 / GPT-5.6 Sol (AgentRouter) engineer the prompt before pixels (`AI_MODEL_PROMPT_ENGINEER`).

## Linked skills

| Skill | Use |
|---|---|
| `/openmontage` | Full GPU video pipelines (Wan/LTX/Remotion) at `D:\route\OpenMontage` |
| `/agent-demo-video` | Beacon product demo film via Remotion toolkit |
| `/remotion-create` | Scaffold Remotion compositions |

Set `OPENMONTAGE_ROOT` / `VIDEO_TOOLKIT_ROOT` so job video compose can call Remotion.

## ComfyUI (recommended for “best ever”)

1. Install ComfyUI + Flux.2 (or Wan for video) on a GPU machine.
2. Export your workflow **API Format** → save as `workflows/comfy-flux-api.json`.
3. Placeholders `__PROMPT__` `__NEGATIVE__` `__SEED__` `__WIDTH__` `__HEIGHT__` are injected; or CLIPTextEncode nodes are auto-patched.
4. Run ComfyUI (`:8188`). Tunnel if needed (`cloudflared` / ngrok).
5. Set on Render + local:

```
COMFYUI_URL=https://your-tunnel.example
COMFYUI_WORKFLOW_PATH=/opt/render/project/src/workflows/comfy-flux-api.json
IMAGE_PROVIDER=auto
VIDEO_PROVIDER=auto
AI_MODEL_PROMPT_ENGINEER=claude-opus-5
```

MCP (Cursor control of local Comfy):

```json
"comfyui": {
  "command": "npx",
  "args": ["-y", "comfyui-mcp-server"],
  "env": { "COMFYUI_URL": "http://127.0.0.1:8188" }
}
```

## Hugging Face fallback

Create a fine-grained **Inference** token at huggingface.co → Settings → Access Tokens → set `HF_TOKEN`.
Default path: fal-ai Flux.schnell via `https://router.huggingface.co/fal-ai/...` (`HF_IMAGE_MODEL=fal-ai/flux/schnell`).
Legacy `api-inference` / OpenAI `/v1/images/generations` often 404/410 for Flux.

## Video assembly

Without Remotion CLI, Beacon uses **ffmpeg-static**: engineered stills → slow zoom + crossfade MP4 (vertical 9:16).
With OpenMontage/Remotion roots, prefers Remotion render.
