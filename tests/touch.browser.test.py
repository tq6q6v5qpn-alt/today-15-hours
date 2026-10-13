#!/usr/bin/env python3
"""Touch-time and actual-phase browser checks using only synthetic records.

Run serially under the host's 80 C thermal guard. Every case uses a fresh
Playwright context, an isolated local origin, blocked service workers, and
checkout files fulfilled in memory. No user profile, server, network request,
notification permission, or production state is used. Chromium viewport checks
are not claims about physical iPhone/Android devices or the Safari engine.
"""

import argparse
import asyncio
import copy
import datetime as dt
import importlib.util
import json
import mimetypes
import os
from pathlib import Path
import sys
import traceback
from urllib.parse import unquote, urlsplit

from playwright.async_api import async_playwright, expect


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("today15_browser_helpers", ROOT / "tests/browser.test.py")
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
Harness = base.Harness
CALKEY, METAKEY, FEEDBACKKEY, OLDKEY = base.CALKEY, base.METAKEY, base.FEEDBACKKEY, base.OLDKEY
TODAY, FUTURE, PAST, NOON = base.TODAY, base.FUTURE, base.PAST, base.NOON
ORIGIN = "http://today15-touch.test"


def confirmed_day(date=TODAY, tasks=None, **extra):
    return {"date": date, "sleep": 8, "sleepAt": "23:00", "sleepConfirmed": True,
            "tasks": tasks or [], "events": [], "choice": "", **extra}


async def open_harness(browser, output, calendar=None, now=NOON):
    # Fulfill one immutable checkout snapshot for this context. A concurrent
    # source write must not mix different script versions during navigation.
    assets = {path.relative_to(ROOT).as_posix(): path.read_bytes()
              for path in ROOT.rglob("*") if path.is_file() and
              ".git" not in path.relative_to(ROOT).parts and
              path.suffix in (".html", ".css", ".js", ".webmanifest", ".svg", ".png", ".ico")}
    requests, route_errors = [], []
    context = await browser.new_context(service_workers="block", timezone_id="Asia/Seoul",
        viewport={"width": 390, "height": 844}, accept_downloads=True, reduced_motion="reduce")

    async def fulfill(route):
        url = urlsplit(route.request.url)
        relative = unquote(url.path).lstrip("/") or "index.html"
        entry = {"url": route.request.url, "path": relative}
        requests.append(entry)
        try:
            if f"{url.scheme}://{url.netloc}" != ORIGIN:
                entry["result"] = "external blocked"
                await route.abort()
            elif relative not in assets:
                entry["result"] = "local 404"
                await route.fulfill(status=404, body="Not found")
            else:
                entry["result"] = "local 200"
                await route.fulfill(status=200, content_type=mimetypes.guess_type(relative)[0] or
                                    "application/octet-stream", body=assets[relative])
        except Exception as error:
            route_errors.append({"path": relative, "error": repr(error)})
            raise

    await context.route("**/*", fulfill)
    page = await context.new_page()
    page.set_default_timeout(5000)
    page.set_default_navigation_timeout(15000)
    harness = Harness(page, output)
    harness.requests, harness.route_errors = requests, route_errors
    page.on("pageerror", lambda error: harness.errors.append(str(error)))
    page.on("dialog", harness.on_dialog)
    seed = {CALKEY: calendar or {}, METAKEY: {"fixed": [], "customMeta": {"synthetic": True}},
            FEEDBACKKEY: "합성 시간 조절 검증"}
    await page.add_init_script("""
      (() => {
        if (sessionStorage.getItem('__synthetic_touch_seeded')) return;
        const seed = %s;
        for (const [key,value] of Object.entries(seed)) {
          localStorage.setItem(key,typeof value === 'string' ? value : JSON.stringify(value));
        }
        sessionStorage.setItem('__synthetic_touch_seeded','yes');
      })();
    """ % json.dumps(seed, ensure_ascii=False))
    await page.clock.install(time=now)
    await page.clock.pause_at(now + dt.timedelta(seconds=1))
    try:
        # DOMContentLoaded includes these synchronous local scripts. Waiting
        # for load adds no coverage here; a ready app and its errors are checked.
        await page.goto(ORIGIN + "/index.html", wait_until="domcontentloaded")
        await expect(page.locator("#homeView")).to_be_visible()
        assert not harness.errors, harness.errors
        assert not route_errors, route_errors
    except Exception as error:
        diagnostic = {"error": repr(error), "requests": requests,
                      "route_errors": route_errors, "page_errors": harness.errors,
                      "snapshot_files": sorted(assets)}
        (output / "load-diagnostic.json").write_text(json.dumps(diagnostic, ensure_ascii=False, indent=2) + "\n")
        await context.close()
        raise AssertionError(f"Isolated page load failed: {json.dumps(diagnostic, ensure_ascii=False)}") from error
    return context, harness


async def open_sleep(h):
    await h.home()
    await h.page.locator("#homeTime").click()
    await expect(h.page.locator("#timeAdjustSheet")).to_have_class("sheetbg on")


async def sleep_pair(h, bedtime, wake, next_day=False, full_day=False):
    p = h.page
    await open_sleep(h)
    await p.locator("#adjustBedtime").fill(bedtime)
    await p.locator("#adjustWakeAt").fill(wake)
    await p.locator("#adjustBedNextDay").set_checked(next_day)
    if bedtime == wake:
        await p.locator("#adjustFullDay").set_checked(full_day)
    await p.locator("#applyTimeAdjust").evaluate("el => {el.click();el.click()}")
    await expect(p.locator("#timeAdjustSheet")).not_to_have_class("sheetbg on")


async def set_duration(h, selector, minutes, cancel=False, delta=None):
    p = h.page
    await p.locator(selector).first.click()
    await expect(p.locator("#adjustDuration")).to_be_visible()
    assert await p.locator("#adjustDuration").get_attribute("min") == "0"
    await p.locator("#adjustDuration").fill(str(minutes))
    if delta is not None:
        await p.locator(f"[data-time-field='duration'][data-time-delta='{delta}']").evaluate(
            "el => {el.click();el.click()}")
    await p.locator("#cancelTimeAdjust" if cancel else "#applyTimeAdjust").evaluate(
        "el => {el.click();el.click()}")
    await expect(p.locator("#timeAdjustSheet")).not_to_have_class("sheetbg on")


async def sleep_touch(h):
    p = h.page
    await expect(p.locator("#homeTime")).to_contain_text("설정")
    before = await h.storage()
    await open_sleep(h)
    await expect(p.locator("#adjustBedtime")).to_have_value("")
    await expect(p.locator("#adjustWakeAt")).to_have_value("")
    await p.locator("#adjustBedtime").fill("23:30")
    await p.locator("#adjustWakeAt").fill("08:00")
    await expect(p.locator("#timeAdjustPreview")).to_contain_text("8시간 30분")
    assert await h.storage() == before, "sleep preview saved before Apply"
    await p.locator("#cancelTimeAdjust").click()
    assert await h.storage() == before, "sleep cancellation changed records"
    await expect(p.locator("#homeTime")).to_be_focused()

    await sleep_pair(h, "23:30", "08:00")
    record = (await h.calendar())[TODAY]
    assert (record["sleep"], record["sleepAt"], record["sleepConfirmed"]) == (8.5, "23:30", True)
    await expect(p.locator("#homeTime")).to_have_text("11시간 29분")
    await p.reload(wait_until="load")
    assert (await h.calendar())[TODAY]["sleep"] == 8.5
    await sleep_pair(h, "08:00", "08:00", full_day=False)
    assert (await h.calendar())[TODAY]["sleep"] == 0
    await sleep_pair(h, "08:00", "08:00", full_day=True)
    assert (await h.calendar())[TODAY]["sleep"] == 24
    await sleep_pair(h, "01:00", "09:00", next_day=True)
    record = (await h.calendar())[TODAY]
    assert record["sleep"] == 8 and record["sleepAtDayOffset"] == 1
    await expect(p.locator("#homeTime")).to_have_text("12시간 59분")
    await p.clock.fast_forward(12 * 60 * 60 * 1000)
    await expect(p.locator("#homeTime")).to_have_text("59분")
    assert (await h.calendar())[TODAY]["sleepAtDayOffset"] == 1

    # Import a complete old record with no confirmation marker. Its provenance
    # cannot be inferred from the 9 h/23:30 pair and must not be overwritten.
    legacy = base.day(FUTURE, 9, customDay={"keep": "synthetic legacy"})
    legacy["tasks"] = [{"id": "synthetic-legacy-touch", "name": "합성 보존 활동", "min": 10,
                         "logs": {"customLog": "keep"}, "customTask": {"keep": True}}]
    await p.locator("#homeDetails").click()
    await p.locator("#openData").click()
    await h.import_backup({"schemaVersion": 1, "format": "today-15-hours", "calendar": {FUTURE: legacy},
                           "meta": {"fixed": [], "importedMeta": "preserved"}, "feedback": "합성 백업"})
    await h.home()
    await expect(p.locator("#homeNote")).to_contain_text("확인")
    assert (await h.calendar())[FUTURE] == legacy, "old unconfirmed sleep or unknown fields changed"
    before = await h.storage()
    await open_sleep(h)
    await expect(p.locator("#adjustBedtime")).to_have_value("23:30")
    await expect(p.locator("#adjustWakeAt")).to_have_value("08:30")
    await p.keyboard.press("Escape")
    assert await h.storage() == before, "old-record dialog cancellation changed fields"
    await p.reload(wait_until="load")
    assert (await h.calendar())[FUTURE] == legacy
    assert "NaN" not in await p.locator("body").inner_text()
    return ["Unset sleep has blank clock fields; preview/cancel does not save or invent values",
            "23:30 to 08:00 saves 8.5 h and confirmation; refresh preserves the date-specific pair",
            "Equal clocks explicitly distinguish 0/24 h; next-day bedtime remains active across midnight",
            "Schema 1 restore preserves unconfirmed legacy 9 h/23:30 and unknown task/log/day fields"]


async def duration_touch(h):
    p = h.page
    await p.locator("#homeDetails").click()
    before = await h.storage()
    await set_duration(h, "[data-duration-input='directActivity']", 0, cancel=True)
    await expect(p.locator("#directActivity")).to_have_value("60")
    assert await h.storage() == before
    await set_duration(h, "[data-duration-input='directActivity']", 0, delta=10)
    await expect(p.locator("#directActivity")).to_have_value("20")
    assert await h.storage() == before, "editing a new task draft wrote to the calendar"
    await set_duration(h, "[data-duration-input='directActivity']", 0)
    await set_duration(h, "[data-duration-input='directPrep']", 10)
    await set_duration(h, "[data-duration-input='directTravel']", 20)
    await p.locator("#taskName").fill("합성 0분 활동과 준비 이동")
    await p.locator("#add").evaluate("el => {el.click();el.click()}")
    tasks = (await h.calendar())[TODAY]["tasks"]
    assert len(tasks) == 1
    assert (tasks[0]["min"], tasks[0]["prepMin"], tasks[0]["travelMin"]) == (0, 10, 20)

    before = await h.storage()
    await set_duration(h, "#taskList [data-task-duration='0'][data-task-field='prepMin']", 80, cancel=True)
    assert await h.storage() == before
    await set_duration(h, "#taskList [data-task-duration='0'][data-task-field='min']", 30)
    assert (await h.calendar())[TODAY]["tasks"][0]["min"] == 30
    await set_duration(h, "#taskList [data-task-duration='0'][data-task-field='travelMin']", 0)
    await p.reload(wait_until="load")
    assert (await h.calendar())[TODAY]["tasks"][0]["travelMin"] == 0
    await p.locator("#homeDetails").click()

    # These three entry points share the same duration editor, while applying
    # the editor alone remains a draft until the containing sheet is saved.
    before = await h.storage()
    await p.locator("[data-preset='swim']").click()
    await set_duration(h, "#quickActivity", 0)
    await set_duration(h, "#quickPrep", 0)
    await set_duration(h, "#quickTravel", 0)
    await p.locator("#closeQuick").click()
    assert await h.storage() == before, "canceled quick draft changed records"
    await p.locator("#openSudden").click()
    await set_duration(h, "#suddenTime", 0)
    await expect(p.locator("#suddenRange")).to_have_value("0")
    await p.locator("#closeSudden").click()
    assert await h.storage() == before, "canceled sudden draft changed records"
    await p.locator("#dayMap [data-cube-start='900']").click()
    await set_duration(h, "#cubePlanDuration", 0)
    await p.locator("#closeCubePlan").click()
    assert await h.storage() == before, "canceled cube draft changed records"

    await p.locator("[data-view='todayView']").click()
    await p.locator(".clock-touch[data-time-index='0']").first.click()
    if await p.locator("#adjustAutoClock").is_checked():
        await p.locator("#adjustAutoClock").uncheck()
    await p.locator("#adjustClock").fill("23:50")
    await p.locator("[data-time-field='clock'][data-time-delta='10']").evaluate(
        "el => {el.click();el.click()}")
    await expect(p.locator("#adjustClock")).to_have_value("00:10")
    assert await h.storage() == before, "clock preview wrote to saved task"
    await p.locator("#cancelTimeAdjust").click()
    assert await h.storage() == before
    await p.locator(".clock-touch[data-time-index='0']").first.click()
    if await p.locator("#adjustAutoClock").is_checked():
        await p.locator("#adjustAutoClock").uncheck()
    await p.locator("#adjustClock").fill("23:50")
    await p.locator("#applyTimeAdjust").evaluate("el => {el.click();el.click()}")
    assert (await h.calendar())[TODAY]["tasks"][0]["start"] == "23:50"
    await p.reload(wait_until="load")
    records = await h.calendar()
    assert records[TODAY]["tasks"][0]["start"] == "23:50"
    assert records[TODAY]["customDay"] == {"synthetic": "preserved"}
    assert json.loads((await h.storage())[METAKEY])["customMeta"] == {"synthetic": True}
    return ["All shared duration fields allow zero; repeated +10 touch adds twice; cancel restores its draft",
            "Activity/preparation/travel remain distinct and calendar writes occur only at the intended Apply/save",
            "Quick/sudden/cube cancel preserves stored records; existing task duration and 23:50 clock persist after reload",
            "Date-specific unknown fields and metadata remain intact"]


async def actual_phases(h):
    p = h.page

    async def task(index=0, date=TODAY):
        return (await h.calendar())[date]["tasks"][index]

    async def home_next(stage, minutes=0):
        if minutes:
            await p.clock.run_for(minutes * 60 * 1000)
        before = copy.deepcopy((await task())["logs"])
        # Capturing the old button and clicking it twice exercises the expected
        # stage guard even though the first click redraws the current action.
        await p.locator("#homeActive [data-home-next]").first.evaluate(
            "el => {window.__syntheticOldPhaseButton=el;el.click();el.click()}")
        after = (await task())["logs"]
        assert set(after) == set(before) | {stage}, (stage, before, after)
        assert all(after[key] == value for key, value in before.items())
        expected = await p.evaluate("new Date().toISOString()")
        assert after[stage] == expected
        await p.clock.run_for(1000)
        await p.evaluate("window.__syntheticOldPhaseButton.click()")
        assert (await task())["logs"] == after, f"stale {stage} button rewrote logs"

    await p.locator("#homeStart").click()
    await p.locator("[data-home-start='0']").evaluate("el => {el.click();el.click()}")
    first = await task()
    assert set(first["logs"]) == {"prep"} and first["trackingVersion"] == 1
    assert first["logs"]["prep"] == "2026-10-11T03:00:01.000Z"
    assert first["logOrigins"]["prep"]["type"] == "tap"
    await home_next("depart", 2)
    saved = copy.deepcopy(await task())
    await p.reload(wait_until="load")
    assert await task() == saved, "refresh changed phase state"
    await expect(p.locator("#homeActive")).to_contain_text("이동")
    await home_next("arrive", 3)
    await home_next("start")
    await home_next("end", 5)
    await home_next("returnDepart")
    await home_next("return", 4)
    complete = await task()
    assert complete["routeComplete"] is True and complete["customTask"] == {"keep": True}
    assert set(complete["logs"]) == {"prep", "depart", "arrive", "start", "end", "returnDepart", "return"}
    assert all(complete["logOrigins"][stage]["type"] == "tap" for stage in complete["logs"])
    times = [dt.datetime.fromisoformat(complete["logs"][stage].replace("Z", "+00:00"))
             for stage in ("prep", "depart", "arrive", "start", "end", "returnDepart", "return")]
    assert times == sorted(times), "real-stage endpoints out of order"
    await expect(p.locator("#homeMemories")).to_contain_text("수영")

    await p.locator("#homeRecords").click()
    await p.locator("[data-open-track='0']").click()
    await p.locator(".track-detail summary").click()
    await expect(p.locator(".track-parts")).to_contain_text("예상 60분")
    await expect(p.locator(".track-parts")).to_contain_text("실제 0분")
    await p.locator("#undoTrack").click()
    undone = await task()
    assert "return" not in undone["logs"] and undone.get("routeComplete") is not True
    assert all(undone["logs"][key] == value for key, value in complete["logs"].items() if key != "return")
    await p.locator("#trackNext").evaluate("el => {el.click();el.click()}")
    assert (await task())["routeComplete"] is True

    before = await h.storage()
    await p.locator("[data-track-edit='start']").click()
    await p.locator("#trackEditTime").fill("2026-10-11T12:06")
    await expect(p.locator("#trackEditPreview")).to_contain_text("미리보기")
    assert await h.storage() == before
    await p.locator("#trackCancelEdit").click()
    assert await h.storage() == before
    await p.locator("[data-track-edit='start']").click()
    await p.locator("#trackEditTime").fill("2026-10-11T12:20")
    await p.locator("#trackApplyEdit").click()
    assert await h.storage() == before, "future/out-of-order actual edit saved"
    await p.locator("#trackCancelEdit").click()
    await p.locator("[data-track-edit='start']").click()
    await p.locator("#trackEditTime").fill("2026-10-11T12:06")
    await p.locator("#trackApplyEdit").evaluate("el => {el.click();el.click()}")
    assert (await task())["logs"]["start"] == "2026-10-11T03:06:00.000Z"
    assert (await task())["logOrigins"]["start"]["type"] == "user-edited"
    await expect(p.locator("[data-track-edit='start']")).to_contain_text("직접 수정한 시각")
    await p.locator("#undoTrack").click()
    assert (await task())["logs"]["start"] == complete["logs"]["start"]
    assert (await task())["logOrigins"]["start"]["type"] == "tap"
    await p.locator("[data-track-edit='start']").click()
    await p.locator("#trackEditTime").fill("2026-10-11T12:06")
    await p.locator("#trackApplyEdit").click()
    assert (await task())["logOrigins"]["start"]["type"] == "user-edited"
    await p.locator("#closeTrack").click()
    await p.locator("[data-open-track='1']").click()
    await p.locator("#trackSkip").evaluate("el => {el.click();el.click()}")
    skipped = await task(1)
    assert skipped["skippedStages"] == ["prep"] and "prep" not in skipped.get("logs", {})
    await p.clock.run_for(500)
    await p.locator("#trackNext").click()
    await p.clock.run_for(60 * 1000)
    await p.locator("#trackNext").click()
    await p.clock.run_for(500)
    await p.locator("#trackSkip").click()
    skipped = await task(1)
    assert skipped["routeComplete"] is True
    assert "returnDepart" not in skipped["logs"] and skipped["skippedStages"] == ["prep", "returnDepart"]
    await p.locator(".track-detail summary").click()
    await expect(p.locator(".track-parts")).to_contain_text("실제 미확인")
    assert (await task(1))["prepMin"] == 10, "skipping actual measurement changed its planned preparation"
    await p.locator("#closeTrack").click()

    # A late activity stays on its original task date while its actual finish
    # and completion memory belong to the next civil date.
    await h.home()
    delta = await p.evaluate("new Date('2026-10-11T23:59:40+09:00').getTime()-Date.now()")
    await p.clock.fast_forward(delta)
    await p.locator("#homeStart").click()
    await p.locator("[data-home-start='2']").click()
    midnight_before = await task(2)
    assert midnight_before["logs"]["start"] == "2026-10-11T14:59:40.000Z"
    await p.clock.run_for(40 * 1000)
    await p.locator("#homeActive [data-home-next]").first.evaluate("el => {el.click();el.click()}")
    ended = await task(2)
    assert ended["logs"]["end"] == "2026-10-11T15:00:20.000Z"
    assert not any(entry.get("id") == ended["id"] for entry in (await h.calendar()).get(FUTURE, {}).get("tasks", []))
    await expect(p.locator("#homeMemories")).to_contain_text("합성 자정 기록")
    await p.reload(wait_until="load")
    assert (await task(2))["logs"] == ended["logs"]
    snapshot = copy.deepcopy(await h.calendar())
    await p.locator("#homeDetails").click()
    await p.locator("#openData").click()
    await h.import_backup({"schemaVersion": 1, "format": "today-15-hours", "calendar": snapshot,
        "meta": {"fixed": [], "customMeta": {"synthetic": True}}, "feedback": "합성 단계 복원"})
    assert await h.calendar() == snapshot, "schema 1 restore lost actual phase/skip/undo history or unknown fields"
    await p.reload(wait_until="load")
    assert await h.calendar() == snapshot
    return ["Preparation/outbound/activity/wrap-up/return record ordered ISO endpoints with one current next action",
            "Repeated old buttons cannot overwrite or advance a different phase; refresh resumes the saved phase",
            "Undo removes only the last phase; actual clock edit previews/cancels safely and rejects invalid chronology",
            "Tap/user-edited provenance is distinct, displayed, preserved by restore, and restored by edit undo",
            "Skipped actual stages retain no fabricated timestamps and show unknown, while an explicitly measured short interval shows zero",
            "Cross-midnight end stays in its original task record and appears in the actual completion date",
            "Schema 1 restore and refresh preserve new phase records, skipped stages, undo history, and unknown fields"]


async def mobile_touch(h):
    p = h.page
    for width in (320, 390):
        await p.set_viewport_size({"width": width, "height": 844})
        await h.home()
        assert await p.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")
        await expect(p.locator("#homeTime")).to_have_attribute("aria-haspopup", "dialog")
        assert await p.locator("#homeView button:visible").count() <= 6
        assert await p.locator("#homeTime").evaluate("el => el.getBoundingClientRect().height >= 44")
        await p.screenshot(path=str(h.output / f"mobile-{width}-touch-home.png"), full_page=True)
        before = await h.storage()
        await open_sleep(h)
        await expect(p.locator("#timeAdjustSheet [role='dialog']")).to_have_attribute("aria-modal", "true")
        for field in ("adjustBedtime", "adjustWakeAt"):
            assert await p.locator(f"#{field}").get_attribute("type") == "time"
            assert await p.locator(f"#{field}").evaluate(
                "el => [...el.labels].some(label => label.textContent.trim())")
        assert await p.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")
        for button in await p.locator("#timeAdjustSheet button:visible").all():
            assert await button.evaluate("el => el.getBoundingClientRect().height >= 44")
        await p.locator("#cancelTimeAdjust").focus()
        await p.keyboard.press("Tab")
        assert await p.locator("#timeAdjustSheet").evaluate("el => el.contains(document.activeElement)")
        await p.screenshot(path=str(h.output / f"mobile-{width}-touch-sleep.png"), full_page=True)
        await p.keyboard.press("Escape")
        await expect(p.locator("#homeTime")).to_be_focused()
        assert await h.storage() == before
        await p.locator("#homeStart").click()
        await set_duration(h, "#homeNewDuration", 0, cancel=True)
        await expect(p.locator("#homeStartSheet")).to_have_class("sheetbg on")
        await expect(p.locator("#homeNewDuration")).to_be_focused()
        assert await p.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")
        await p.keyboard.press("Escape")
        assert await h.storage() == before
    return ["320/390 CSS-pixel Chromium viewports have no horizontal overflow or extra home action clutter",
            "Native clock inputs have labels, dialog aria semantics, and touch controls at least 44 px high",
            "Tab remains inside the modal; Escape restores focus and nested editor cancellation preserves records",
            "Screenshots are synthetic Chromium viewport evidence; Safari/iPhone/Android physical devices not exercised"]


async def main():
    cases = {
        "sleep_touch": (sleep_touch, {}),
        "duration_touch": (duration_touch, {"calendar": {TODAY: confirmed_day(customDay={"synthetic": "preserved"})}}),
        "actual_phases": (actual_phases, {"calendar": {TODAY: confirmed_day(tasks=[{
            "id": "synthetic-swim-phases", "name": "수영", "min": 60, "prepMin": 20, "travelMin": 60,
            "logs": {}, "customTask": {"keep": True}},
            {"id": "synthetic-skipped-phases", "name": "합성 생략 경로", "min": 30, "prepMin": 10,
             "travelMin": 0, "logs": {}},
            {"id": "synthetic-midnight-phases", "name": "합성 자정 기록", "min": 5, "prepMin": 0,
             "travelMin": 0, "logs": {}}])}}),
        "mobile_touch": (mobile_touch, {"calendar": {TODAY: confirmed_day()}}),
    }
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--case", action="append", choices=cases)
    parser.add_argument("--output", type=Path, default=ROOT.parent / "verification-touch/browser")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    report = {"origin": ORIGIN, "timezone": "Asia/Seoul", "engine": "Chromium",
              "physical_devices_tested": False, "safari_engine_tested": False,
              "synthetic_data_only": True, "existing_browser_profile_used": False,
              "service_workers": "block", "notification_permission_requested": False, "cases": []}
    try:
        async with async_playwright() as pw:
            launch = {"headless": True, "slow_mo": int(os.environ.get("TOUCH_TEST_SLOW_MO_MS", "0")), "args": ["--disable-gpu", "--disable-dev-shm-usage", "--renderer-process-limit=1"]}
            if os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE"):
                launch["executable_path"] = os.environ["PLAYWRIGHT_CHROMIUM_EXECUTABLE"]
            browser = await pw.chromium.launch(**launch)
            try:
                for name, (function, fixture) in cases.items():
                    if args.case and name not in args.case:
                        continue
                    context, h, result = None, None, {"name": name}
                    try:
                        context, h = await open_harness(browser, args.output, **fixture)
                        result["evidence"] = await function(h)
                        assert not h.errors, h.errors
                        assert not await h.page.locator("html").get_attribute("data-app-error")
                        result["status"] = "passed"
                        print(f"PASS {name}", flush=True)
                    except Exception:
                        result["status"] = "failed"
                        result["traceback"] = traceback.format_exc()
                        print(result["traceback"], file=sys.stderr, flush=True)
                        if h is not None:
                            try:
                                await h.page.screenshot(path=str(args.output / f"failure-{name}.png"), full_page=True)
                            except Exception:
                                pass
                    finally:
                        if h is not None:
                            result["page_errors"], result["dialogs"] = h.errors, h.dialogs
                            result["requests"], result["route_errors"] = h.requests, h.route_errors
                        if context is not None:
                            await context.close()
                        report["cases"].append(result)
            finally:
                await browser.close()
    except Exception:
        report["fatal_error"] = traceback.format_exc()
        print(report["fatal_error"], file=sys.stderr, flush=True)
    finally:
        report["passed"] = sum(case["status"] == "passed" for case in report["cases"])
        report["failed"] = sum(case["status"] == "failed" for case in report["cases"])
        report["artifacts"] = sorted(path.name for path in args.output.iterdir() if path.suffix == ".png")
        path = args.output / "touch-browser-results.json"
        path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(f"Touch browser checks: {report['passed']} passed, {report['failed']} failed; {path}", flush=True)
    return 1 if report.get("fatal_error") or report["failed"] else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
