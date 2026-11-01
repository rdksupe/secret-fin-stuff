import json

from finn_api import watches


def test_human_schedule():
    assert watches.human_schedule("30 8 * * 1-5") == "Weekdays 08:30"
    assert watches.human_schedule("0 9 * * *") == "Daily 09:00"
    assert watches.human_schedule("*/15 * * * *") == "Every 15 min"
    assert watches.human_schedule("0 7 * * 1") == "Mons 07:00"
    assert watches.human_schedule("0 9 1 * *") == "0 9 1 * *"


def test_lists_user_watches_and_runs(tmp_path, monkeypatch):
    home = tmp_path / "hermes"
    (home / "cron" / "output" / "abc123def456").mkdir(parents=True)
    jobs = [
        {"id": "abc123def456", "name": "IT brief", "schedule": {"kind": "cron", "expr": "30 8 * * 1-5"},
         "enabled": True, "state": "scheduled", "prompt": "[IMPORTANT: cron boilerplate]\n\nBrief me on IT.",
         "origin": {"platform": "finn_app", "chat_id": "app-1"}},
        {"id": "fff000fff000", "name": "finn-ingest", "schedule": {"expr": "*/15 * * * *"}},
    ]
    (home / "cron" / "jobs.json").write_text(json.dumps({"jobs": jobs}))
    out = home / "cron" / "output" / "abc123def456"
    (out / "2026-11-01_08-30-00.md").write_text("# Cron Job: IT brief\n\n## Prompt\n\nx\n\n## Response\n\nTCS flat; INFY +2%.\n")
    (out / "2026-11-02_08-30-00.md").write_text("# Cron Job\n\n## Response\n\n[SILENT]\n")
    monkeypatch.setattr(watches, "HERMES_HOME", home)

    listed = watches.list_watches()
    assert [w["name"] for w in listed] == ["IT brief"]  # system jobs hidden
    w = listed[0]
    assert w["schedule"] == "Weekdays 08:30" and w["prompt"] == "Brief me on IT." and w["runs"] == 2

    detail = watches.get_watch("abc123def456")
    assert [r["id"] for r in detail["runs_list"]] == ["2026-11-02_08-30-00", "2026-11-01_08-30-00"]  # newest first
    assert detail["runs_list"][0]["silent"] is True
    assert watches.get_run("abc123def456", "2026-11-01_08-30-00")["response"] == "TCS flat; INFY +2%."
