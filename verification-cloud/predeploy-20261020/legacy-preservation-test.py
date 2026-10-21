#!/usr/bin/env python3
"""Reproduce legacy storage preservation checks with fresh synthetic contexts.

Loads an immutable snapshot through the repository's isolated touch harness.
No actual profiles, production URL, notification permission, or personal data.
Service-worker update/offline behavior is covered by the separate cache test.
"""

import argparse
import asyncio
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess


async def check(root, output):
    spec = importlib.util.spec_from_file_location("today15_touch", root / "tests/touch.browser.test.py")
    touch = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(touch)
    hashes = {name: hashlib.sha256((root / name).read_bytes()).hexdigest()
              for name in ("app.js", "core.js", "tracking.js", "time-controls.js", "sw.js", "index.html")}
    report = {"head": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip(),
              "working_files_sha256": hashes, "synthetic_only": True,
              "service_workers": "blocked", "checks": []}
    async with touch.async_playwright() as playwright:
        browser = await playwright.chromium.launch(
            executable_path=os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE", "/usr/bin/chromium"),
            headless=True, args=["--disable-gpu", "--disable-dev-shm-usage"])
        try:
            for legacy_only in (True, False):
                original = {"date": touch.TODAY, "sleep": "7.5", "start": "08:30",
                    "tasks": [{"id": "synthetic-legacy-audit", "name": "합성 기존자료",
                        "min": 60, "prepMin": 10, "travelMin": 20, "start": "13:00",
                        "logs": {"prep": "2026-10-11T01:00:00Z", "start": "2026-10-11T01:10:00Z",
                                 "unknownEvent": {"preserve": True}},
                        "focus": {"question": "합성 질문", "first": "펼치기", "finish": "덮기",
                                  "unknown": {"preserve": True}}, "unknown": {"preserve": [1, 2]}}],
                    "events": [{"type": "synthetic", "unknown": True}], "choice": "합성 선택",
                    "unknown": {"preserve": True}}
                if not legacy_only:
                    original["sleepAt"] = "23:30"
                meta = {"fixed": [{"id": "synthetic-event", "date": touch.TODAY, "name": "합성 일정",
                                    "yearly": True, "unknown": {"preserve": True}}],
                        "unknown": {"preserve": [1, 2]}}
                context, harness = await touch.open_harness(browser, output, {})
                try:
                    page = harness.page
                    await page.evaluate("""({cal,old,meta,feedback,keys}) => {
                        localStorage.setItem(keys[0], JSON.stringify(cal));
                        localStorage.setItem(keys[1], JSON.stringify(old));
                        localStorage.setItem(keys[2], JSON.stringify(meta));
                        localStorage.setItem(keys[3], feedback);
                    }""", {"cal": {} if legacy_only else {touch.TODAY: original}, "old": original,
                          "meta": meta, "feedback": "합성 메모",
                          "keys": [touch.CALKEY, touch.OLDKEY, touch.METAKEY, touch.FEEDBACKKEY]})
                    await page.reload(wait_until="domcontentloaded")
                    assert (await harness.calendar())[touch.TODAY] == original, "Initial migration changed existing data"
                    await page.locator("#homeTime").click()
                    await page.keyboard.press("Escape")
                    assert (await harness.calendar())[touch.TODAY] == original, "Cancel changed existing data"
                    await page.locator("#homeDetails").click()
                    await page.locator("#openData").click()
                    async with page.expect_download() as download_info:
                        await page.locator("#exportData").click()
                    downloaded = await download_info.value
                    backup = json.loads(Path(await downloaded.path()).read_text())
                    assert backup["schemaVersion"] == 1
                    assert backup["calendar"][touch.TODAY] == original, "Export changed day/task/log/focus fields"
                    assert backup["meta"] == meta, "Export changed fixed events or unknown metadata"
                    assert backup["feedback"] == "합성 메모", "Export changed feedback"
                    await page.reload(wait_until="domcontentloaded")
                    assert (await harness.calendar())[touch.TODAY] == original, "Reload changed existing data"
                    assert not harness.errors, harness.errors
                    assert not harness.route_errors, harness.route_errors
                    report["checks"].append({"legacy_key_only": legacy_only,
                        "initial_migration_unchanged": True, "cancel_unchanged": True,
                        "schema_1_export_unknown_fields_preserved": True, "refresh_unchanged": True,
                        "page_errors": harness.errors})
                finally:
                    await context.close()
        finally:
            await browser.close()
    assert hashes == {name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in hashes}, "Source changed during audit"
    report["passed"] = True
    (output / "legacy-preservation.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path("/workspace/today-15-hours"))
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parent)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    asyncio.run(check(args.root.resolve(), args.output.resolve()))
