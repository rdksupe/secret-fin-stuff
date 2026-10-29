"""Hermes cron pre-run script: `finn cron eod`. Last stdout line is the wake gate."""
import os
import subprocess
import sys

repo = os.environ.get("FINN_REPO", "__FINN_REPO__")
r = subprocess.run(
    ["uv", "run", "--project", f"{repo}/api", "finn", "cron", "eod", *sys.argv[1:]],
    capture_output=True, text=True, timeout=600,
)
sys.stderr.write(r.stderr[-2000:])
if r.returncode != 0:
    # Fail closed: don't wake the agent on a broken run; the cron log keeps stderr.
    print('{"wakeAgent": false}')
    sys.exit(0)
sys.stdout.write(r.stdout)
