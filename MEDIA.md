# Beacon professional media stack

| Priority | Provider | Env | Quality |
|---|---|---|---|
| 1 | **ComfyUI** (Flux.2 / Wan / LTX) | `COMFYUI_URL` | Best open-source local |
| 2 | **Cloudflare Workers AI** FLUX.1-schnell | `CF_ACCOUNT_ID` + `CF_API_TOKEN` | Strong, **free daily Neurons** |
| 3 | **Hugging Face** fal Flux | `HF_TOKEN` | Strong when credits remain |
| 4 | Pollinations | `POLLINATIONS_*` | Only with Pollen balance |
| — | Premium vector logo SVG | none | Logo briefs only |

**Always:** AgentRouter (gpt-5.6-sol / Opus) engineers prompts unless `MEDIA_FAST=true`.

## Flare mandatory

Beacon boots only when Flare Coston2 rails are present (`FLARE_REQUIRED=true`):
- `CHAIN_ID=114`, `NETWORK_NAME=coston2`
- Escrow + X402 + JobRegistry + Contract Registry

Install Flare AI Skills (required for agents):

```bash
# already copied into beacon/.cursor/skills/
# source: https://github.com/flare-foundation/flare-ai-skills
```

See `.cursor/rules/flare-mandatory.mdc`.

## Cloudflare Workers AI

```
CF_ACCOUNT_ID=...
CF_API_TOKEN=...   # Workers AI Read+Edit
CF_IMAGE_MODEL=@cf/black-forest-labs/flux-1-schnell
```

## Hugging Face

Fine-grained Inference token. Prefer `fal-ai/flux/dev` when credits available; schnell when not.

## Video

Stills via same cascade → `ffmpeg-static` zoom/xfade MP4 (9:16). Remotion when `OPENMONTAGE_ROOT` / `VIDEO_TOOLKIT_ROOT` set.
