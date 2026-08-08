"""Patch Render + Vercel AI env to gpt-5.6-sol and trigger Render deploy."""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV = (ROOT / ".env").read_text(encoding="utf-8")
SERVICE_ID = "srv-d9ojf9tbedkc73d1k6jg"
VERCEL_PROJECT = "prj_VhawZFTcgXxKQWRxcqv7tJQOASWq"


def env_get(key: str) -> str:
    for line in ENV.splitlines():
        if line.startswith(key + "="):
            return line.split("=", 1)[1].strip()
    raise SystemExit(f"missing {key}")


RENDER_KEY = env_get("RENDER_API_KEY")
VERCEL_TOKEN = env_get("vercal_token")


def req(method: str, url: str, token: str, body: object | None = None):
    data = None if body is None else json.dumps(body).encode("utf-8")
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    r = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=90) as resp:
            raw = resp.read().decode("utf-8")
            return resp.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        err = e.read().decode("utf-8", errors="replace")
        raise SystemExit(f"{method} {url} -> {e.code}: {err[:800]}") from e


def main() -> None:
    render_updates = {
        "AI_MODEL_GENERATOR": "gpt-5.6-sol",
        "AI_MODEL_QUOTE": "gpt-5.6-sol",
        "AI_MODEL_PROMPT_ENGINEER": "gpt-5.6-sol",
        "AI_MODEL_JUDGE": "claude-opus-4-8",
        "AI_MODEL_ACCEPTANCE": "claude-opus-4-8",
        "AI_REQUIRE_REAL": "true",
        "AI_BASE_URL": "https://agentrouter.org/v1",
        "OPENAI_BASE_URL": "https://agentrouter.org/v1",
        "ANTHROPIC_BASE_URL": "https://agentrouter.org",
        "AI_PROXY_URL": "https://beacon-desk.vercel.app/api/ai/proxy",
        "AI_API_KEY": env_get("AI_API_KEY"),
        "OPENAI_API_KEY": env_get("OPENAI_API_KEY"),
        "ANTHROPIC_API_KEY": env_get("ANTHROPIC_API_KEY"),
        "AI_PROXY_SECRET": env_get("AI_PROXY_SECRET"),
        "POLLINATIONS_API_KEY": env_get("POLLINATIONS_API_KEY"),
    }

    for key, value in render_updates.items():
        status, _ = req(
            "PUT",
            f"https://api.render.com/v1/services/{SERVICE_ID}/env-vars/{key}",
            RENDER_KEY,
            {"value": value},
        )
        print(f"Render PUT {key}: {status}")

    status, deploy = req(
        "POST",
        f"https://api.render.com/v1/services/{SERVICE_ID}/deploys",
        RENDER_KEY,
        {"clearCache": "do_not_clear"},
    )
    print("Render deploy:", status, (deploy or {}).get("id") if isinstance(deploy, dict) else deploy)

    vercel_updates = {
        "AI_API_KEY": env_get("AI_API_KEY"),
        "OPENAI_API_KEY": env_get("OPENAI_API_KEY"),
        "ANTHROPIC_API_KEY": env_get("ANTHROPIC_API_KEY"),
        "AI_BASE_URL": "https://agentrouter.org/v1",
        "OPENAI_BASE_URL": "https://agentrouter.org/v1",
        "AI_PROXY_SECRET": env_get("AI_PROXY_SECRET"),
        "AI_MODEL_GENERATOR": "gpt-5.6-sol",
    }
    for key, value in vercel_updates.items():
        status, _ = req(
            "POST",
            f"https://api.vercel.com/v10/projects/{VERCEL_PROJECT}/env?upsert=true",
            VERCEL_TOKEN,
            [
                {
                    "key": key,
                    "value": value,
                    "type": "encrypted",
                    "target": ["production", "preview", "development"],
                }
            ],
        )
        print(f"Vercel upsert {key}: {status}")

    print("DONE")


if __name__ == "__main__":
    main()
