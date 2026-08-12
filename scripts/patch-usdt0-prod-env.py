"""Patch Render + Vercel USDT0 rail addresses only. Never touch FCC/TEE flags."""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV = (ROOT / ".env").read_text(encoding="utf-8")
SERVICE_ID = "srv-d9ojf9tbedkc73d1k6jg"
VERCEL_PROJECT = "prj_VhawZFTcgXxKQWRxcqv7tJQOASWq"

USDT0 = "0xC1A5B41512496B80903D1f32d6dEa3a73212E71F"
FACILITATOR = "0x1506f2177769EcB8Fa4903160c896E68f5d15747"
ESCROW = "0x59F9E2471BE3747b00fD53E0Cea828227345399C"
FACTORY = "0x8250e3946fFAD7C3306E7286Cf82131E79038106"
SWAP_DESK = "0xD926f5Bce2F89CD279aCa3648807607f6125986F"
JOB_REGISTRY = "0x100a3E24909DE25B9CAe75Ba665Be6F893b98889"
PAYEE = "0xBDfCeE82Bd42FEfA58ee850B3709636a8B6b0034"


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
        "X402_TOKEN_ADDRESS": USDT0,
        "X402_FACILITATOR_ADDRESS": FACILITATOR,
        "X402_PAYEE_ADDRESS": PAYEE,
        "BEACON_ESCROW": ESCROW,
        "BEACON_SAFE_FACTORY_ADDRESS": FACTORY,
        "BEACON_SWAP_DESK_ADDRESS": SWAP_DESK,
        "BEACON_JOB_REGISTRY": JOB_REGISTRY,
        "BEACON_AGENT_VAULT_ADDRESS": "",
    }
    forbidden = {
        "SIMULATED_TEE",
        "FCC_MODE",
        "TEE_ID",
        "EXT_PROXY_URL",
        "FLARE_TEE_MANAGER",
        "INSTRUCTION_SENDER",
        "EXTENSION_ID",
    }
    overlap = set(render_updates) & forbidden
    if overlap:
        raise SystemExit(f"refusing to patch FCC keys: {overlap}")

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
    deploy_id = (deploy or {}).get("id") if isinstance(deploy, dict) else None
    print("Render deploy:", status, deploy_id)

    vercel_updates = {
        "VITE_X402_TOKEN_ADDRESS": USDT0,
        "VITE_X402_FACILITATOR_ADDRESS": FACILITATOR,
        "VITE_X402_PAYEE_ADDRESS": PAYEE,
        "VITE_BEACON_ESCROW": ESCROW,
        "VITE_BEACON_SAFE_FACTORY_ADDRESS": FACTORY,
        "VITE_BEACON_JOB_REGISTRY": JOB_REGISTRY,
        "VITE_BEACON_AGENT_VAULT_ADDRESS": "",
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

    print("DONE — FCC/TEE env not modified")


if __name__ == "__main__":
    main()
