#!/usr/bin/env bash
# Provision the Hermes `finn` profile: ~/.hermes-finn
#   - Fireworks models (chat: strong, crons: flash), Exa for people search
#   - api_server on :8642 for the app's chat, busy_input_mode=steer
#   - FINN skills + SOUL, protect-identity plugin, cron jobs with wake-gated scripts
# Re-runnable. Secrets are read from the environment or existing profiles; nothing is printed.
set -euo pipefail

FINN_REPO="${FINN_REPO:-$(cd "$(dirname "$0")/.." && pwd)}"
HOME_DIR="${FINN_HERMES_HOME:-$HOME/.hermes-finn}"
HERMES_BIN="${HERMES_BIN:-$HOME/building_shit/hermes-agent/.venv/bin/hermes}"
HERMES_PY="$(dirname "$HERMES_BIN")/python"
PLUGIN_SRC="${PLUGIN_SRC:-$HOME/building_shit/buildsync/deploy/hermes/plugins/protect-identity}"
MODEL_CHAT="${FINN_MODEL_CHAT:-accounts/fireworks/models/glm-5p3}"
MODEL_CRON="${FINN_MODEL_CRON:-accounts/fireworks/models/glm-5p3-flash}"

mkdir -p "$HOME_DIR"/{memories,skills,cron,sessions,logs,plugins,scripts}

# ── secrets: env first, then existing local configs ─────────────────────────
read_env() { # file key
  [[ -f "$1" ]] && grep -E "^$2=" "$1" | tail -1 | cut -d= -f2- | tr -d '"' || true
}
FIREWORKS_API_KEY="${FIREWORKS_API_KEY:-$(read_env "$HOME/.hermes-fieldclaw/.env" FIREWORKS_API_KEY)}"
DATALAB_API_KEY="${DATALAB_API_KEY:-$(read_env "$HOME/.hermes-fieldclaw/.env" DATALAB_API_KEY)}"
OPENROUTER_API_KEY="${OPENROUTER_API_KEY:-$(read_env "$HOME/.hermes-fieldclaw/.env" OPENROUTER_API_KEY)}"
MEM0_API_KEY="${MEM0_API_KEY:-$(read_env "$HOME/.hermes-fieldclaw/.env" MEM0_API_KEY)}"
SMALLEST_API_KEY="${SMALLEST_API_KEY:-$(read_env "$HOME/.hermes-fieldclaw/.env" SMALLEST_API_KEY)}"
if [[ -z "${EXA_API_KEY:-}" && -f "$HOME/.pi/web-search.json" ]]; then
  EXA_API_KEY="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("exaApiKey",""))' "$HOME/.pi/web-search.json")"
fi
FINN_API_KEY="${FINN_API_KEY:-$(read_env "$FINN_REPO/.env" FINN_API_KEY)}"
FINN_API_KEY="${FINN_API_KEY:-$(python3 -c 'import secrets;print(secrets.token_urlsafe(24))')}"
API_SERVER_KEY="$(read_env "$HOME_DIR/.env" API_SERVER_KEY)"
API_SERVER_KEY="${API_SERVER_KEY:-$(python3 -c 'import secrets;print(secrets.token_urlsafe(24))')}"
BRIDGE_SECRET="$(read_env "$HOME_DIR/.env" FINN_APP_BRIDGE_SECRET)"
BRIDGE_SECRET="${BRIDGE_SECRET:-$(python3 -c 'import secrets;print(secrets.token_urlsafe(32))')}"
for k in FIREWORKS_API_KEY EXA_API_KEY; do
  [[ -n "${!k}" ]] || echo "WARNING: $k not found — set it in $HOME_DIR/.env" >&2
done

umask 077
cat > "$HOME_DIR/.env" <<EOF
HERMES_HOME=$HOME_DIR
FINN_REPO=$FINN_REPO
FIREWORKS_API_KEY=$FIREWORKS_API_KEY
EXA_API_KEY=$EXA_API_KEY
DATALAB_API_KEY=$DATALAB_API_KEY
OPENROUTER_API_KEY=$OPENROUTER_API_KEY
API_SERVER_ENABLED=true
API_SERVER_KEY=$API_SERVER_KEY
API_SERVER_PORT=8642
FINN_API_KEY=$FINN_API_KEY
FINN_APP_BRIDGE_SECRET=$BRIDGE_SECRET
FINN_APP_API_URL=http://127.0.0.1:8000
FINN_APP_LISTEN=127.0.0.1:8650
FINN_APP_HOME_CHANNEL=home
FINN_APP_ALLOW_ALL_USERS=true
MEM0_API_KEY=$MEM0_API_KEY
SMALLEST_API_KEY=$SMALLEST_API_KEY
EOF
# The FINN API proxies chat to Hermes with the same key.
touch "$FINN_REPO/.env"
python3 - "$FINN_REPO/.env" "$FINN_API_KEY" "$API_SERVER_KEY" "$FIREWORKS_API_KEY" "$DATALAB_API_KEY" "$EXA_API_KEY" "$BRIDGE_SECRET" "$SMALLEST_API_KEY" <<'PY'
import sys
from pathlib import Path
p = Path(sys.argv[1])
want = {"FINN_API_KEY": sys.argv[2], "HERMES_API_KEY": sys.argv[3], "FIREWORKS_API_KEY": sys.argv[4],
        "DATALAB_API_KEY": sys.argv[5], "EXA_API_KEY": sys.argv[6], "HERMES_API_URL": "http://127.0.0.1:8642",
        "FINN_APP_BRIDGE_SECRET": sys.argv[7], "FINN_APP_BRIDGE_URL": "http://127.0.0.1:8650",
        "SMALLEST_API_KEY": sys.argv[8]}
lines = [l for l in p.read_text().splitlines() if l.split("=", 1)[0] not in want]
lines += [f"{k}={v}" for k, v in want.items() if v]
p.write_text("\n".join(lines) + "\n")
PY
umask 022

# ── identity, skills, plugin, scripts ───────────────────────────────────────
cp "$FINN_REPO/hermes/SOUL.md" "$HOME_DIR/SOUL.md"
ln -sfn "$FINN_REPO/hermes/skills/finn" "$HOME_DIR/skills/finn"
[[ -d "$PLUGIN_SRC" ]] && ln -sfn "$PLUGIN_SRC" "$HOME_DIR/plugins/protect-identity"
ln -sfn "$FINN_REPO/hermes/plugins/finn" "$HOME_DIR/plugins/finn"
ln -sfn "$FINN_REPO/hermes/plugins/finn_app" "$HOME_DIR/plugins/finn_app"
for s in "$FINN_REPO"/hermes/scripts/*.py; do
  sed "s|__FINN_REPO__|$FINN_REPO|" "$s" > "$HOME_DIR/scripts/$(basename "$s")"
done

# ── config.yaml ─────────────────────────────────────────────────────────────
FINN_REPO_PATH="$FINN_REPO" "$HERMES_PY" - "$HOME_DIR/config.yaml" "$MODEL_CHAT" <<'PY'
import sys, yaml
from pathlib import Path
p, model = Path(sys.argv[1]), sys.argv[2]
cfg = yaml.safe_load(p.read_text()) if p.exists() else {}
cfg = cfg or {}
fw = "https://api.fireworks.ai/inference/v1"
cfg["timezone"] = "Asia/Kolkata"
cfg["custom_providers"] = [{"name": "fireworks", "base_url": fw, "key_env": "FIREWORKS_API_KEY",
                            "api_mode": "chat_completions"}]
cfg["model"] = {"default": model, "provider": "custom:fireworks", "base_url": fw}
cfg.setdefault("display", {})["busy_input_mode"] = "steer"
cfg.setdefault("web", {})["search_backend"] = "exa"
plug = cfg.setdefault("plugins", {})
plug["enabled"] = sorted(set(plug.get("enabled") or []) | {"protect-identity", "finn", "finn_app"})
# The app is a first-class chat platform: stream replies, no tool-progress spam.
dp = cfg.setdefault("display", {}).setdefault("platforms", {}).setdefault("finn_app", {})
dp.update({"streaming": True, "tool_progress": "off"})
# Personal memory per chat (Mem0) and voice via smallest.ai — the FieldClaw setup.
import os
repo = os.environ.get("FINN_REPO_PATH", "")
mem = cfg.setdefault("memory", {})
mem.update({"memory_enabled": True, "user_profile_enabled": True, "provider": "mem0"})
voice_dir = f"{repo}/hermes/scripts/voice"
cfg["stt"] = {"enabled": True, "provider": "smallest", "providers": {"smallest": {
    "type": "command", "format": "txt", "language": "en", "model": "pulse", "timeout": 180,
    "command": f"python3 {voice_dir}/smallest_stt.py --audio {{input_path}} --out {{output_path}} --language {{language}} --model {{model}}"}}}
cfg["tts"] = {"provider": "smallest", "providers": {"smallest": {
    "type": "command", "output_format": "mp3", "voice_compatible": True, "voice": "avery", "model": "lightning_v3.1",
    "timeout": 120, "max_text_length": 4000,
    "command": f"python3 {voice_dir}/smallest_tts.py --text-file {{input_path}} --out {{output_path}} --voice {{voice}} --model {{model}}"}}}
# Same tools as a Telegram chat (memory, cron, web, files, skills, delegation…) plus FINN's own.
cfg.setdefault("platform_toolsets", {})["finn_app"] = ["hermes-telegram", "finn"]
gw = cfg.setdefault("gateway", {})
gw["multiplex_profiles"] = False
gw.setdefault("api_server", {})["max_concurrent_runs"] = 4
# Compaction and other side tasks run on the cheap model.
aux = cfg.setdefault("auxiliary", {})
for task in ("compression", "web_extract", "approval"):
    aux[task] = {"provider": "custom:fireworks", "model": "accounts/fireworks/models/glm-5p3-flash",
                 "base_url": fw, "timeout": 120}
p.write_text(yaml.dump(cfg, default_flow_style=False, sort_keys=False))
print("config:", p)
PY

# ── wrapper ────────────────────────────────────────────────────────────────
mkdir -p "$HOME/.local/bin"
cat > "$HOME/.local/bin/hermes-finn" <<EOF
#!/usr/bin/env bash
export HERMES_HOME="\${HERMES_HOME:-$HOME_DIR}"
if [[ -f "\$HERMES_HOME/.env" ]]; then set -a; source "\$HERMES_HOME/.env"; set +a; fi
exec "$HERMES_BIN" "\$@"
EOF
chmod +x "$HOME/.local/bin/hermes-finn"

# ── cron jobs (idempotent by name) ──────────────────────────────────────────
HERMES_HOME="$HOME_DIR" "$HERMES_PY" - "$MODEL_CRON" <<'PY'
import sys
from cron.jobs import create_job, list_jobs, remove_job

model = sys.argv[1]
fw = "https://api.fireworks.ai/inference/v1"
jobs = [
    dict(name="finn-announcements", schedule="*/15 9-22 * * 1-5",  # IST; results land after the close
         script="finn_announcements.py", skills=["finn", "finn-enrich"],
         prompt="Enrich each FINN item above using the finn-enrich skill, write back with the finn_enrich tool, then stop.",
         enabled_toolsets=["finn", "file", "web", "skills"]),
    dict(name="finn-announcements-weekend", schedule="0 * * * 0,6",
         script="finn_announcements.py", skills=["finn", "finn-enrich"],
         prompt="Enrich each FINN item above using the finn-enrich skill, write back with the finn_enrich tool, then stop.",
         enabled_toolsets=["finn", "file", "web", "skills"]),
    dict(name="finn-eod", schedule="30 18 * * 1-5",  # IST; bhavcopy is out by ~18:00
         script="finn_eod.py", skills=["finn"],
         prompt="Each line above is an unusual move with same-day filings. For each, write one line on the likely "
                "cause from those filings only, via the finn_enrich tool. If the filings don't explain "
                "it, say 'No filing explains the move'.",
         enabled_toolsets=["finn", "file", "skills"]),
]
no_agent = [
    dict(name="finn-ingest", schedule="*/15 * * * *", script="finn_ingest.py"),
]
existing = {j.get("name"): j for j in list_jobs(include_disabled=True)}
for j in no_agent:
    if j["name"] in existing:
        remove_job(existing[j["name"]]["id"])
    create_job(prompt=None, schedule=j["schedule"], name=j["name"], deliver="local",
               script=j["script"], no_agent=True)
    print("cron:", j["name"], j["schedule"], "(no agent)")
for j in jobs:
    if j["name"] in existing:
        remove_job(existing[j["name"]]["id"])
    create_job(prompt=j["prompt"], schedule=j["schedule"], name=j["name"], deliver="local",
               skills=j["skills"], script=j["script"], model=model, provider="custom:fireworks",
               base_url=fw, enabled_toolsets=j["enabled_toolsets"], workdir=None)
    print("cron:", j["name"], j["schedule"])
PY

echo "==> FINN Hermes profile ready at $HOME_DIR"
echo "    run:  hermes-finn gateway run     (api_server on :8642, crons)"
