#!/usr/bin/env python3
"""Isolated browser regression checks. Run under the host's 80 C thermal guard.

Uses a new Playwright browser/context, synthetic records, blocked service workers,
and request fulfillment from this checkout. No HTTP server, network, existing
browser profile, notification permission, reset button, or real user data is used.
Optional: --case storage_sleep (repeatable), --output PATH.
"""

import argparse
import asyncio
import copy
import datetime as dt
import json
import mimetypes
import os
from pathlib import Path
import sys
import traceback
from urllib.parse import unquote, urlsplit

from playwright.async_api import async_playwright, expect


ROOT = Path(__file__).resolve().parents[1]
ORIGIN = "http://today15.test"
TODAY, PAST, FUTURE = "2026-10-11", "2026-10-10", "2026-10-12"
CALKEY, OLDKEY = "today15_calendar_v3", "today15hours_v2"
METAKEY, FEEDBACKKEY = "today15_meta_v4", "today15_feedback_v1"
NOON = dt.datetime.fromisoformat("2026-10-11T12:00:00+09:00")


def day(date=TODAY, sleep=9, tasks=None, **extras):
    return {"date": date, "sleep": sleep, "sleepAt": "23:30",
            "tasks": tasks or [], "events": [], "choice": "", **extras}


def old_day(date=TODAY, sleep=7.5):
    # Deliberately lacks sleepAt; all records are clearly synthetic.
    return {"date": date, "sleep": sleep, "start": "08:30",
            "choice": "합성 선택 기록", "customDay": {"keep": [1, 2]},
            "events": [{"type": "synthetic", "customEvent": True}],
            "tasks": [{"id": "synthetic-old", "name": "합성 기존 활동", "min": 60,
                       "prepMin": 10, "travelMin": 20, "start": "13:00",
                       "logs": {"prep": "2026-10-11T03:00:00Z",
                                "start": "2026-10-11T03:10:00Z"},
                       "focus": {"question": "합성 질문", "first": "펼치기", "finish": "덮기"},
                       "customTask": {"keep": True}}]}


class Harness:
    def __init__(self, page, output):
        self.page, self.output = page, output
        self.errors, self.dialogs = [], []
        self.confirm = True
        self.dialog_queue = asyncio.Queue()

    async def on_dialog(self, dialog):
        entry = {"type": dialog.type, "message": dialog.message,
                 "accepted": self.confirm if dialog.type == "confirm" else True}
        self.dialogs.append(entry)
        if entry["accepted"]:
            await dialog.accept()
        else:
            await dialog.dismiss()
        await self.dialog_queue.put(entry)

    async def calendar(self):
        return await self.page.evaluate("key => JSON.parse(localStorage.getItem(key) || '{}')", CALKEY)

    async def storage(self):
        return await self.page.evaluate("() => Object.fromEntries(Object.keys(localStorage).map(k => [k,localStorage.getItem(k)]))")

    async def select_date(self, date):
        if await self.page.locator("#homeView").is_visible():
            await self.page.locator("#homeDetails").click()
        await self.page.locator('[data-view="calendarView"]').click()
        await self.page.locator(f'[data-calendar-date="{date}"]').click()
        await self.page.locator("#openDatePlan").click()

    async def reload_plan(self):
        await self.page.reload(wait_until="load")
        await self.page.locator("#homeDetails").click()

    async def home(self):
        if not await self.page.locator("#homeView").is_visible():
            await self.page.locator("#goHome").click()
        await expect(self.page.locator("#homeView")).to_be_visible()

    async def sleep(self, hours, at="23:30"):
        details = self.page.locator("details.sleep-settings")
        if not await details.evaluate("el => el.open"):
            await details.locator("summary").click()
        await self.page.locator("#sleepHours").fill(str(hours))
        await self.page.locator("#sleepAt").fill(at)
        await self.page.locator("#saveSleep").click()

    async def import_backup(self, payload, accept=True):
        self.confirm = accept
        while not self.dialog_queue.empty():
            self.dialog_queue.get_nowait()
        await self.page.locator("#importFile").set_input_files({
            "name": "synthetic-backup.json", "mimeType": "application/json",
            "buffer": json.dumps(payload, ensure_ascii=False).encode()})
        entry = await asyncio.wait_for(self.dialog_queue.get(), 5)
        assert entry["type"] == "confirm", entry
        if accept:
            entry = await asyncio.wait_for(self.dialog_queue.get(), 5)
            assert entry["type"] == "alert" and "가져왔습니다" in entry["message"], entry
        self.confirm = True


async def open_harness(browser, output, calendar=None, legacy=None, meta=None, now=NOON, initial_home=False):
    context = await browser.new_context(service_workers="block", timezone_id="Asia/Seoul",
                                        viewport={"width": 360, "height": 800},
                                        accept_downloads=True, reduced_motion="reduce")

    async def fulfill(route):
        url = urlsplit(route.request.url)
        if f"{url.scheme}://{url.netloc}" != ORIGIN:
            await route.abort()
            return
        relative = unquote(url.path).lstrip("/") or "index.html"
        path = (ROOT / relative).resolve()
        if not path.is_relative_to(ROOT) or not path.is_file():
            await route.fulfill(status=404, body="Not found")
            return
        mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        await route.fulfill(status=200, content_type=mime, body=path.read_bytes())

    await context.route("**/*", fulfill)
    page = await context.new_page()
    page.set_default_timeout(5000)
    harness = Harness(page, output)
    page.on("pageerror", lambda error: harness.errors.append(str(error)))
    page.on("dialog", harness.on_dialog)
    seed = {CALKEY: calendar or {}, METAKEY: meta or {"fixed": []},
            FEEDBACKKEY: "합성 테스트 메모"}
    if legacy is not None:
        seed[OLDKEY] = legacy
    # sessionStorage gate is essential: refresh must exercise saved persistence.
    await page.add_init_script("""
      (() => {
        if (sessionStorage.getItem('__synthetic_seeded')) return;
        const seed = %s;
        for (const [key, value] of Object.entries(seed)) {
          localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
        }
        sessionStorage.setItem('__synthetic_seeded', 'yes');
      })();
    """ % json.dumps(seed, ensure_ascii=False))
    await page.clock.install(time=now)
    await page.clock.pause_at(now + dt.timedelta(seconds=1))
    await page.goto(ORIGIN + "/index.html", wait_until="load")
    await expect(page.locator("#futureTime")).not_to_have_text("—")
    await expect(page.locator("#homeView")).to_be_visible()
    if not initial_home:
        await page.locator("#homeDetails").click()
        await expect(page.locator("#planView")).to_have_class("view on")
    return context, harness


async def storage_sleep(h):
    p = h.page
    original = old_day()
    await expect(p.locator("#sleepHours")).to_have_value("7.5")
    await expect(p.locator("#remainTop")).to_have_text("15시간")
    await expect(p.locator("#futureTime")).to_have_text("9시간 59분")
    await expect(p.locator("#futureLabel")).to_have_text("지금부터 열린 시간")
    await expect(p.locator("#untilMidnight")).to_have_text("자정까지 11시간 59분")
    await h.sleep(8)
    assert (await h.calendar())[TODAY] == {**original, "sleep": 8, "sleepAt": "23:30"}
    await expect(p.locator("#remainTop")).to_have_text("14시간 30분")
    await h.reload_plan()
    await expect(p.locator("#sleepHours")).to_have_value("8")
    assert (await h.calendar())[TODAY]["tasks"] == original["tasks"]

    await h.select_date(FUTURE)
    await expect(p.locator("#sleepHours")).to_have_value("0")
    await expect(p.locator("#remainTop")).to_have_text("24시간")
    await expect(p.locator("#futureTime")).to_have_text("24시간")
    await h.sleep(24, "00:00")
    await expect(p.locator("#remainTop")).to_have_text("0분")
    await expect(p.locator("#futureTime")).to_have_text("0분")
    assert await p.locator("#budgetFill").evaluate("el => el.style.width") == "0%"
    before = await h.storage()
    for invalid in ("-1", "25", "7.25", ""):
        await h.sleep(invalid)
        assert await h.storage() == before, f"invalid sleep {invalid!r} mutated storage"
        await expect(p.locator("#sleepStatus")).to_contain_text("0~24시간")
    await h.sleep(9, "")
    assert await h.storage() == before, "missing bedtime mutated storage"
    assert "NaN" not in await p.locator("body").inner_text()

    await h.select_date("2026-10-13")
    await expect(p.locator("#sleepHours")).to_have_value("9")
    await expect(p.locator("#futureTime")).to_have_text("15시간")
    await expect(p.locator("#futureLabel")).to_have_text("이 날짜의 열린 시간")
    await h.select_date(PAST)
    await expect(p.locator("#remainTop")).to_have_text("24시간")
    await expect(p.locator("#futureTime")).to_have_text("0분")
    await expect(p.locator("#futureLabel")).to_have_text("지난 날짜의 열린 시간")
    await h.reload_plan()
    await expect(p.locator("#sleepHours")).to_have_value("8")
    records = await h.calendar()
    assert records[FUTURE]["sleep"] == 24 and records[TODAY]["sleep"] == 8
    assert records["2026-10-13"]["customDay"] == "synthetic missing sleep"
    return ["7.5 and 0 hour records preserved; missing sleep defaults to 9",
            "date-specific saves survive refresh; invalid values do not save",
            "past/today/future budget and open-time labels; 24 hour sleep has no NaN"]


async def legacy_migration(h):
    p = h.page
    original = old_day()
    await expect(p.locator("#sleepHours")).to_have_value("7.5")
    assert (await h.calendar())[TODAY] == original
    await h.sleep(7.5)
    assert (await h.calendar())[TODAY] == {**original, "sleepAt": "23:30"}
    saved = json.loads((await h.storage())[OLDKEY])
    assert saved["tasks"] == original["tasks"] and saved["choice"] == original["choice"]
    return ["legacy today15hours_v2 record migrates without losing task/log/event/custom fields"]


async def editing_tabs(h):
    p = h.page
    await p.locator("#taskName").fill("합성 직접 활동")
    await p.locator("#directPrep").fill("20")
    await p.locator("#directTravel").fill("40")
    await p.locator("#add").evaluate("el => { el.click(); el.click(); }")
    tasks = (await h.calendar())[TODAY]["tasks"]
    assert len(tasks) == 1 and (tasks[0]["min"], tasks[0]["prepMin"], tasks[0]["travelMin"]) == (60, 20, 40)
    await expect(p.locator("#remainTop")).to_have_text("13시간")

    await p.locator('[data-preset="swim"]').click()
    await p.locator("#closeQuick").click()
    await p.locator("#addQuick").evaluate("el => el.click()")
    assert len((await h.calendar())[TODAY]["tasks"]) == 1
    await p.locator('[data-preset="swim"]').click()
    await p.locator('[data-adjust="prep,10"]').click()
    await p.locator('[data-adjust="travel,10"]').click()
    await p.locator("#addQuick").evaluate("el => { el.click(); el.click(); el.click(); }")
    tasks = (await h.calendar())[TODAY]["tasks"]
    assert len(tasks) == 2 and (tasks[1]["min"], tasks[1]["prepMin"], tasks[1]["travelMin"]) == (60, 30, 70)
    # Reopening is a deliberate second input; only repeated saves of one draft are blocked.
    await p.locator('[data-preset="read"]').click()
    await p.locator("#addQuick").click()
    assert len((await h.calendar())[TODAY]["tasks"]) == 3

    await p.locator('[data-cube-start="780"]').click()
    await p.locator("#cubePlanName").fill("합성 큐브")
    await p.locator('[data-cube-adjust="10"]').click()
    await p.locator("#saveCubePlan").evaluate("el => { el.click(); el.click(); el.click(); }")
    tasks = (await h.calendar())[TODAY]["tasks"]
    assert len(tasks) == 4 and tasks[-1]["start"] == "13:00" and tasks[-1]["min"] == 40
    await p.locator('[data-cube-start="840"]').click()
    await p.locator("#cubePlanName").fill("저장하지 않는 합성 큐브")
    await p.locator("#closeCubePlan").click()
    await p.locator("#saveCubePlan").evaluate("el => el.click()")
    assert len((await h.calendar())[TODAY]["tasks"]) == 4

    await p.locator('[data-focus="0"]').click()
    await p.locator("#focusQuestion").fill("합성 질문 수정")
    await p.locator("#firstMove").fill("합성 첫 행동")
    await p.locator("#finishLine").fill("합성 끝 기준")
    await p.locator("#saveFocus").click()
    await expect(p.locator("#focusView")).to_have_class("view on")
    await expect(p.locator("#focusBody")).to_contain_text("합성 질문 수정")
    assert (await h.calendar())[TODAY]["tasks"][0]["focus"]["first"] == "합성 첫 행동"

    await p.locator('[data-view="todayView"]').click()
    await p.locator('[data-time-index="0"]').fill("14:00")
    await p.locator("#todayView h1").click()
    assert (await h.calendar())[TODAY]["tasks"][0]["start"] == "14:00"
    await p.locator('[data-resize="0"][data-delta="10"]').click()
    assert (await h.calendar())[TODAY]["tasks"][0]["min"] == 70
    await p.locator('[data-move-task="0"][data-to="1"]').click()
    assert (await h.calendar())[TODAY]["tasks"][1]["name"] == "합성 직접 활동"
    await p.locator('[data-open-track="1"]').click()
    await p.locator('[data-track-stage="prep"]').click()
    await p.clock.run_for(600000)
    await p.locator('[data-track-stage="depart"]').click()
    await p.locator("#undoTrack").click()
    logs = (await h.calendar())[TODAY]["tasks"][1]["logs"]
    assert "prep" in logs and "depart" not in logs
    await p.locator("#closeTrack").click()

    before_tasks = copy.deepcopy((await h.calendar())[TODAY]["tasks"])
    await p.locator('[data-cancel="1"]').click()
    assert len((await h.calendar())[TODAY]["tasks"]) == 3
    await p.locator("#undoCancel").click()
    assert (await h.calendar())[TODAY]["tasks"] == before_tasks
    await p.locator('[data-cancel="1"]').click()
    await h.select_date(FUTURE)
    await p.locator("#undoCancel").evaluate("el => el.click()")
    records = await h.calendar()
    assert records[FUTURE]["tasks"] == [] and len(records[TODAY]["tasks"]) == 3
    assert "on" not in (await p.locator("#undoToast").get_attribute("class")).split()
    await h.select_date(TODAY)
    await h.reload_plan()
    assert len((await h.calendar())[TODAY]["tasks"]) == 3
    await p.locator('[data-view="calendarView"]').click()
    await expect(p.locator("#analytics")).to_contain_text("‘이름 없는 시간’은 낭비 판정이 아닙니다")
    return ["direct and quick additions include preparation and all travel time",
            "quick/cube close cancels; synchronous repeated saves add only one draft",
            "focus, order, start time, resize, route record undo, and calendar tabs work",
            "task cancellation restores complete task; changing date isolates undo"]


async def midnight_sudden(h):
    p = h.page
    await h.select_date(FUTURE)
    await p.locator("#openSudden").click()
    await expect(p.locator("#date")).to_contain_text("10월 11일")
    await p.locator("#closeSudden").click()
    assert (await h.calendar())[FUTURE]["tasks"] == []
    await p.locator("#openSudden").click()
    await p.locator("#suddenName").fill("자정을 넘긴 합성 일정")
    await p.clock.run_for(30000)
    # The registered 30 second timer must update without a tab switch or focus event.
    await expect(p.locator("#futureLabel")).to_have_text("지난 날짜의 열린 시간")
    await expect(p.locator("#futureTime")).to_have_text("0분")
    await expect(p.locator("#remainTop")).to_have_text("24시간")
    await p.locator("#addSudden").click()
    records = await h.calendar()
    assert records[TODAY]["tasks"] == [] and records[FUTURE]["tasks"] == []
    await expect(p.locator("#suddenSheet")).to_have_class("sheetbg")
    await expect(p.locator("#date")).to_contain_text("10월 12일")
    await expect(p.locator("#futureLabel")).to_have_text("지금부터 열린 시간")
    await p.locator("#openSudden").click()
    await p.locator("#suddenName").fill("합성 새 날짜 일정")
    await p.locator("#addSudden").evaluate("el => { el.click(); el.click(); }")
    records = await h.calendar()
    assert records[TODAY]["tasks"] == [] and len(records[FUTURE]["tasks"]) == 1
    assert records[FUTURE]["tasks"][0]["start"] == "00:00"
    assert records[FUTURE]["tasks"][0]["origin"] == "sudden"
    assert records[TODAY]["customDay"] == "synthetic midnight retained"
    return ["30 second timer changes selected yesterday to past at midnight without changing its budget",
            "sudden action selects real today from future; midnight draft requires reopening",
            "reopened sudden task belongs only to new date and repeated save is guarded"]


async def backups(h):
    p = h.page
    await p.locator("#openData").click()
    async with p.expect_download() as info:
        await p.locator("#exportData").click()
    download = await info.value
    export_path = h.output / "synthetic-schema-1-export.json"
    await download.save_as(export_path)
    exported = json.loads(export_path.read_text())
    assert exported["format"] == "today-15-hours" and exported["schemaVersion"] == 1
    assert exported["calendar"][TODAY]["customDay"] == {"keep": [1, 2]}
    assert exported["meta"]["customMeta"] == {"synthetic": True}
    incoming = {"format": "today-15-hours", "schemaVersion": 1,
                "calendar": {TODAY: old_day(sleep=5), FUTURE: day(FUTURE, sleep=0, customDay="old backup")},
                "meta": {"fixed": [{"id": "synthetic-fixed", "date": FUTURE, "name": "합성 고정 교체", "yearly": False}],
                         "incomingMeta": {"keep": True}}, "feedback": "합성 가져오기 메모"}
    before = await h.storage()
    await h.import_backup(incoming, accept=False)
    assert await h.storage() == before, "cancelled import mutated storage"
    await h.import_backup(incoming)
    records = await h.calendar()
    assert records[TODAY] == {**incoming["calendar"][TODAY], "sleepAt": "23:30"}
    assert records[FUTURE] == incoming["calendar"][FUTURE]
    assert records["2026-10-14"]["customDay"] == "synthetic existing date retained"
    metadata = json.loads((await h.storage())[METAKEY])
    assert metadata["customMeta"] == {"synthetic": True} and metadata["incomingMeta"] == {"keep": True}
    assert len(metadata["fixed"]) == 1 and metadata["fixed"][0]["name"] == "합성 고정 교체"
    assert "합성 테스트 메모" in (await h.storage())[FEEDBACKKEY]
    assert "합성 가져오기 메모" in (await h.storage())[FEEDBACKKEY]

    modern = copy.deepcopy(incoming)
    modern["calendar"] = {TODAY: day(TODAY, sleep=6, sleepAt="22:00", tasks=old_day()["tasks"],
                                      customDay={"new": True}, choice="새 합성 선택", events=[{"custom": "new"}])}
    modern["meta"] = {"fixed": [], "modernMeta": "synthetic"}
    await h.import_backup(modern)
    await expect(p.locator("#sleepHours")).to_have_value("6")
    await expect(p.locator("#sleepAt")).to_have_value("22:00")
    records = await h.calendar()
    assert records[TODAY] == modern["calendar"][TODAY] and records[FUTURE]["customDay"] == "old backup"
    await h.reload_plan()
    await expect(p.locator("#sleepHours")).to_have_value("6")
    await expect(p.locator("#sleepAt")).to_have_value("22:00")
    await p.locator("#openData").click()
    async with p.expect_download() as info:
        await p.locator("#exportData").click()
    download = await info.value
    roundtrip_path = h.output / "synthetic-schema-1-roundtrip.json"
    await download.save_as(roundtrip_path)
    roundtrip = json.loads(roundtrip_path.read_text())
    before_calendar = await h.calendar()
    await h.import_backup(roundtrip)
    assert await h.calendar() == before_calendar
    return ["schema 1 JSON export downloads with unknown day/meta fields",
            "cancel import makes no storage mutation; legacy/new schema 1 restore and refresh work",
            "merge keeps other dates, logs/events/choice, unknown fields, fixed entries, and feedback",
            "export/import round trip preserves calendar"]


async def crossing_midnight(h):
    p = h.page
    await expect(p.locator("#remainTop")).to_have_text("21시간 30분")
    await p.locator('[data-view="todayView"]').click()
    await expect(p.locator('[data-time-index="1"]')).to_have_value("01:00")
    await expect(p.locator("#todayBody")).to_contain_text("1일 뒤 시작")
    async with p.expect_download() as info:
        await p.locator("#calendar").click()
    download = await info.value
    ics_path = h.output / "synthetic-cross-midnight.ics"
    await download.save_as(ics_path)
    ics = ics_path.read_text()
    assert "DTSTART:20261011T233000" in ics and "DTEND:20261012T010000" in ics
    assert "DTSTART:20261012T010000" in ics and "DTEND:20261012T020000" in ics
    await h.select_date(FUTURE)
    await expect(p.locator("#remainTop")).to_have_text("24시간")
    await expect(p.locator("#futureTime")).to_have_text("22시간")
    assert await p.evaluate("""() => {
      const d = {date:'2026-10-11',sleep:0,tasks:[{min:60,prepMin:20,travelMin:40,start:'13:00'}]};
      const now = new Date('2026-10-11T12:00:00+09:00');
      return Today15Core.remaining(d) === 1320 && Today15Core.dayWindow(d,now).openMinutes === 600;
    }""")
    return ["sequential midnight crossing keeps absolute offsets and following-day ICS dates",
            "next date open time includes previous-date spillover while all-day budget stays separate",
            "browser Core distinguishes all-day budget from future preparation/travel occupancy"]


async def notification_stub(h):
    p = h.page
    # A harmless stub prevents native permissions/notifications. Capture only app
    # notification timers, leaving Playwright's clock and other timers intact.
    await p.evaluate("""() => {
      window.__notificationDelays = [];
      window.__permissionCalls = 0;
      class SyntheticNotification {
        constructor(name, options) { window.__issuedSyntheticNotification = {name, options}; }
        static requestPermission() { window.__permissionCalls++; return Promise.resolve('granted'); }
      }
      window.Notification = SyntheticNotification;
      const originalTimeout = window.setTimeout;
      window.setTimeout = (callback, delay, ...args) => {
        if (/new Notification/.test(String(callback))) window.__notificationDelays.push(delay);
        return originalTimeout(callback, delay, ...args);
      };
    }""")
    await p.locator('[data-view="todayView"]').click()
    await p.locator("#notify").click()
    entry = await asyncio.wait_for(h.dialog_queue.get(), 5)
    assert "알림이 켜졌습니다" in entry["message"]
    assert await p.evaluate("window.__notificationDelays") == [41399000, 46799000]
    assert await p.evaluate("window.__permissionCalls") == 1
    await p.evaluate("""() => {
      Notification.requestPermission = () => new Promise(resolve => window.__permissionResolve = resolve);
    }""")
    await p.locator("#notify").click()
    await p.clock.set_system_time(dt.datetime.fromisoformat("2026-10-12T00:00:01+09:00"))
    await p.evaluate("window.__permissionResolve('granted')")
    entry = await asyncio.wait_for(h.dialog_queue.get(), 5)
    assert "날짜가 바뀌었습니다" in entry["message"]
    assert await p.evaluate("window.__notificationDelays") == [41399000, 46799000]
    return ["stub notification timers retain absolute start offsets after midnight",
            "permission resolving after date change schedules no additional notifications"]


async def mobile_layout(h):
    p = h.page
    await p.locator('[data-focus="0"]').click()
    await p.locator("#focusQuestion").fill("모바일 합성 집중")
    await p.locator("#saveFocus").click()
    for width in (320, 360, 390):
        await p.set_viewport_size({"width": width, "height": 800})
        for view in ("planView", "todayView", "calendarView", "focusView"):
            await p.locator(f'[data-view="{view}"]').click()
            await expect(p.locator(f"#{view}")).to_have_class("view on")
            dimensions = await p.evaluate("""() => ({width:innerWidth,
                html:document.documentElement.scrollWidth,body:document.body.scrollWidth})""")
            assert max(dimensions["html"], dimensions["body"]) <= width + 1, (width, view, dimensions)
            if width == 360 or view == "planView":
                await p.screenshot(path=str(h.output / f"mobile-{width}-{view}.png"), full_page=True)
        await p.locator('[data-view="planView"]').click()
        await p.locator('[data-preset="swim"]').click()
        dimensions = await p.evaluate("() => [innerWidth, document.documentElement.scrollWidth]")
        assert dimensions[1] <= width + 1, ("quick sheet", width, dimensions)
        if width == 360:
            await p.screenshot(path=str(h.output / "mobile-360-quick-sheet.png"), full_page=True)
        await p.locator("#closeQuick").click()
    return ["320/360/390 px: all four tabs and quick sheet have no horizontal page overflow",
            "mobile screenshots saved for each plan width and all tabs at 360 px"]


async def home_ui(h):
    p = h.page
    await expect(p.locator("#homeView")).to_be_visible()
    await expect(p.locator("#planView")).to_be_hidden()
    await expect(p.locator("#homeTime")).to_have_text("11시간 29분")
    await expect(p.locator("#homeLabel")).to_contain_text("잠들기까지")
    await expect(p.locator("#homeDate")).to_contain_text("10월 11일")
    await expect(p.locator(".nav")).to_be_hidden()
    memories = p.locator("#homeMemories")
    for included in ("휴식", "합성 자정 완료", "합성 기존 종료 기록"):
        await expect(memories).to_contain_text(included)
    for excluded in ("합성 미리 놓은 활동", "합성 어제 완료", "합성 미래 계획",
                     "합성 잘못된 종료", "합성 날짜 오류", "합성 아직 완료 아님"):
        await expect(memories).not_to_contain_text(excluded)

    before = await h.storage()
    await p.locator("#homeStart").click()
    await expect(p.locator("#homeStartSheet [role=dialog]")).to_be_visible()
    await p.locator("#closeHomeStart").focus()
    await p.keyboard.press("Tab")
    assert await p.evaluate("!!document.activeElement.closest('#homeStartSheet')"), "Tab escaped modal"
    await p.keyboard.press("Shift+Tab")
    await expect(p.locator("#closeHomeStart")).to_be_focused()
    await p.keyboard.press("Escape")
    await expect(p.locator("#homeStartSheet [role=dialog]")).to_be_hidden()
    await expect(p.locator("#homeStart")).to_be_focused()
    assert await h.storage() == before, "closing activity selector changed records"

    await p.locator("#homeStart").click()
    await p.locator('[data-home-start="0"]').evaluate("el => { window.__oldHomeStart = el; el.click(); el.click(); }")
    planned = copy.deepcopy((await h.calendar())[TODAY]["tasks"][0])
    assert planned["logs"]["start"] == "2026-10-11T03:00:01.000Z"
    assert planned["start"] == "13:00" and planned["customTask"] == {"keep": True}
    await p.clock.run_for(1000)
    await p.evaluate("window.__oldHomeStart.click()")
    assert (await h.calendar())[TODAY]["tasks"][0]["logs"]["start"] == planned["logs"]["start"]
    await expect(p.locator("#homeActive")).to_contain_text(planned["name"])
    await expect(memories).not_to_contain_text(planned["name"])
    await p.clock.run_for(60000)
    await p.locator(f'#homeActive [data-home-finish="0"][data-source-date="{TODAY}"]').evaluate(
        "el => { window.__oldHomeFinish = el; el.click(); el.click(); }")
    finished = copy.deepcopy((await h.calendar())[TODAY]["tasks"][0])
    assert finished["logs"]["end"] == "2026-10-11T03:01:02.000Z"
    await p.clock.run_for(1000)
    await p.evaluate("window.__oldHomeFinish.click()")
    assert (await h.calendar())[TODAY]["tasks"][0]["logs"] == finished["logs"]
    await expect(memories).to_contain_text(planned["name"])

    for preset, name, activity, preparation, travel in (
            ("rest", "휴식", 30, 0, 0), ("swim", "수영", 60, 20, 60)):
        await p.locator("#homeStart").click()
        task_count = len((await h.calendar())[TODAY]["tasks"])
        await p.locator(f'[data-home-preset="{preset}"]').click()
        assert len((await h.calendar())[TODAY]["tasks"]) == task_count, "preset selection started a task"
        await expect(p.locator("#homeNewName")).to_have_value(name)
        await expect(p.locator("#homeNewMinutes")).to_have_value(str(activity))
        await p.locator("#homeNewStart").evaluate("el => { el.click(); el.click(); el.click(); }")
        tasks = (await h.calendar())[TODAY]["tasks"]
        assert len(tasks) == task_count + 1
        task = tasks[-1]
        assert (task["name"], task["min"], task["prepMin"], task["travelMin"]) == (name, activity, preparation, travel)
        assert task["logs"].get("start") and not task["logs"].get("end")
        await p.clock.run_for(1000)
        await p.locator(f'#homeActive [data-home-finish="{task_count}"][data-source-date="{TODAY}"]').click()
        await expect(memories).to_contain_text(name)
        if preset == "rest":
            await expect(p.get_by_role("img", name="휴식 · 마친 기록", exact=True)).to_have_count(2)
            assert (await h.calendar())[TODAY]["tasks"][-1]["kind"] == "rest"
    await expect(memories).not_to_contain_text("점수")

    await p.locator("#homeStart").click()
    before = await h.storage()
    await p.locator("#homeNewName").fill("")
    await p.locator("#homeNewStart").click()
    assert await h.storage() == before
    long_name = "합성 아주 긴 활동 이름 준비와 이동 뒤에 편히 쉬기"
    await p.locator("#homeNewName").fill(long_name)
    await p.locator("#homeNewMinutes").fill("45")
    await p.locator("#homeNewStart").evaluate("el => { el.click(); el.click(); }")
    records = await h.calendar()
    assert records[TODAY]["tasks"][-1]["name"] == long_name
    assert records[TODAY]["tasks"][-1]["min"] == 45
    assert records[TODAY]["customDay"] == {"synthetic": "home kept"}
    await expect(p.locator("#homeActive")).to_contain_text(long_name)
    await expect(memories).not_to_contain_text(long_name)

    await p.locator("#openHomeSleep").click()
    await expect(p.locator("#openHomeSleep")).to_have_attribute("aria-expanded", "true")
    await p.locator("#homeBedtime").fill("22:00")
    await p.locator("#homeSleepHours").fill("8.5")
    await p.locator("#saveHomeSleep").click()
    await expect(p.locator("#homeTime")).to_have_text("9시간 58분")
    assert (await h.calendar())[TODAY]["sleep"] == 8.5
    assert (await h.calendar())[TODAY]["sleepAt"] == "22:00"
    before = await h.storage()
    await p.locator("#homeSleepHours").fill("25")
    await p.locator("#saveHomeSleep").click()
    assert await h.storage() == before, "invalid home sleep mutated records"
    await p.locator("#homeSleepHours").fill("8.5")
    await p.locator("#openHomeSleep").click()

    for width in (320, 360, 390):
        await p.set_viewport_size({"width": width, "height": 800})
        sizes = await p.evaluate("""() => ({width:innerWidth, html:document.documentElement.scrollWidth,
          body:document.body.scrollWidth, time:parseFloat(getComputedStyle(document.querySelector('#homeTime')).fontSize),
          label:parseFloat(getComputedStyle(document.querySelector('#homeLabel')).fontSize)})""")
        assert max(sizes["html"], sizes["body"]) <= width + 1, (width, sizes)
        assert sizes["time"] >= 40 and sizes["time"] > sizes["label"], sizes
        await expect(p.locator("#homeTime")).to_have_attribute("aria-describedby", "homeLabel homeNote")
        await expect(p.locator("#homeStart")).to_have_accessible_name("활동 시작")
        await p.screenshot(path=str(h.output / f"mobile-{width}-homeView.png"), full_page=True)
        await p.locator("#homeStart").click()
        assert await p.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")
        assert await p.locator("#homeNewName").evaluate("el => [...el.labels].some(label => label.textContent.trim())")
        assert await p.locator("#homeNewMinutes").evaluate("el => [...el.labels].some(label => label.textContent.trim())")
        if width == 360:
            await p.screenshot(path=str(h.output / "mobile-360-home-start-sheet.png"), full_page=True)
        await p.keyboard.press("Escape")

    await p.locator("#homeRecords").click()
    await expect(p.locator("#todayView")).to_have_class("view on")
    await h.home()
    await p.locator("#openData").click()
    async with p.expect_download() as info:
        await p.locator("#exportData").click()
    download = await info.value
    export_path = h.output / "synthetic-home-completions.json"
    await download.save_as(export_path)
    payload = json.loads(export_path.read_text())
    snapshot = await h.calendar()
    assert payload["schemaVersion"] == 1 and payload["calendar"] == snapshot
    await h.import_backup(payload)
    assert await h.calendar() == snapshot
    if await p.locator("#closeData").is_visible():
        await p.locator("#closeData").click()
    await p.reload(wait_until="load")
    await expect(p.locator("#homeView")).to_be_visible()
    await expect(p.locator("#homeTime")).to_have_text("9시간 58분")
    await expect(p.locator("#homeActive")).to_contain_text(long_name)
    await expect(memories).to_contain_text(planned["name"])
    assert (await h.calendar())[TODAY]["tasks"][0]["logs"] == finished["logs"]
    await h.select_date(FUTURE)
    await h.home()
    await expect(p.locator("#homeTime")).to_have_text("23:30")
    await expect(p.locator("#homeLabel")).to_have_text("이 날짜에 잠들 시각")
    await p.locator("#homeToday").click()
    await expect(p.locator("#homeTime")).to_have_text("9시간 58분")
    await h.select_date(PAST)
    await h.home()
    await expect(p.locator("#homeTime")).to_have_text("0분")
    await p.locator("#homeToday").click()
    await expect(p.locator("#homeDate")).to_contain_text("10월 11일")
    await h.select_date(FUTURE)
    await h.home()
    before_calendar = await h.calendar()
    await p.locator("#homeStart").click()
    await expect(p.locator("#homeDate")).to_contain_text("10월 11일")
    await p.keyboard.press("Escape")
    assert await h.calendar() == before_calendar, "opening from future date changed calendar records"
    return ["initial home shows raw time until bedtime independently of plans; future/past labels are honest",
            "planned/custom/rest/swim activity starts and finishes create real logs without repeated overwrites",
            "completion memories exclude planned/malformed/future/reversed ends and accept legacy/cross-date completions",
            "preset selection preserves preparation/travel; Escape cancellation and modal Tab trapping work",
            "home sleep saves per date; actual logs survive refresh and schema 1 backup round trip",
            "home and activity selector fit 320/360/390 px; large time has descriptive text and labeled controls"]


async def home_midnight(h):
    p = h.page
    await expect(p.locator("#homeTime")).to_have_text("1분")
    before_note = await p.locator("#homeNote").inner_text()
    await p.clock.run_for(90000)
    await expect(p.locator("#homeTime")).to_have_text("0분")
    await expect(p.locator("#homeNote")).not_to_have_text(before_note)
    assert await p.evaluate("Today15Core.bedtimeWindow({date:'2026-10-11',sleepAt:'23:30'},new Date()).reached")
    await p.clock.set_system_time(dt.datetime.fromisoformat("2026-10-11T23:59:40+09:00"))
    await p.locator("#homeStart").click()
    await p.locator("#homeNewName").fill("합성 자정 활동")
    await p.locator("#homeNewMinutes").fill("40")
    await p.locator("#homeNewStart").click()
    task = copy.deepcopy((await h.calendar())[TODAY]["tasks"][-1])
    assert task["logs"]["start"] == "2026-10-11T14:59:40.000Z"
    await p.clock.run_for(30000)
    await expect(p.locator("#homeTime")).to_have_text("0분")
    await expect(p.locator("#homeActive")).to_contain_text("합성 자정 활동")
    await p.locator(f'#homeActive [data-home-finish="0"][data-source-date="{TODAY}"]').evaluate(
        "el => { window.__midnightFinish = el; el.click(); el.click(); }")
    completed = copy.deepcopy((await h.calendar())[TODAY]["tasks"][0])
    assert completed["logs"]["end"] == "2026-10-11T15:00:10.000Z"
    assert (await h.calendar())[FUTURE]["tasks"] == [], "midnight finish moved source task"
    await expect(p.locator("#homeDate")).to_contain_text("10월 12일")
    await expect(p.locator("#homeMemories")).to_contain_text("합성 자정 활동")
    await p.clock.run_for(1000)
    await p.evaluate("window.__midnightFinish.click()")
    assert (await h.calendar())[TODAY]["tasks"][0]["logs"] == completed["logs"]
    assert (await h.calendar())[TODAY]["customDay"] == "synthetic home midnight preserved"
    await h.select_date(TODAY)
    await h.home()
    await expect(p.locator("#homeTime")).to_have_text("0분")
    await expect(p.locator("#homeMemories")).not_to_contain_text("합성 자정 활동")
    await p.locator("#homeToday").click()
    await expect(p.locator("#homeMemories")).to_contain_text("합성 자정 활동")
    await p.reload(wait_until="load")
    await expect(p.locator("#homeMemories")).to_contain_text("합성 자정 활동")
    assert (await h.calendar())[TODAY]["tasks"][0]["logs"] == completed["logs"]
    return ["30 second refresh reaches bedtime and stays at zero without rolling to tomorrow",
            "ongoing activity spans midnight; finish records end on original date and selects real today",
            "completion memory belongs to actual completion date and repeated finish cannot overwrite logs"]


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--case", action="append", choices=["storage_sleep", "legacy_migration", "editing_tabs",
                        "midnight_sudden", "backups", "crossing_midnight", "notification_stub", "mobile_layout",
                        "home_ui", "home_midnight"])
    parser.add_argument("--output", type=Path, default=ROOT.parent / "verification")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    old = old_day()
    no_sleep = {"date": "2026-10-13", "tasks": [], "customDay": "synthetic missing sleep"}
    metadata = {"fixed": [{"id": "synthetic-fixed", "date": TODAY, "name": "합성 고정", "yearly": True}],
                "customMeta": {"synthetic": True}}
    home_tasks = [
        {"id": "synthetic-home-planned", "name": "합성 미리 놓은 활동", "min": 180,
         "prepMin": 10, "travelMin": 20, "start": "13:00", "logs": {}, "customTask": {"keep": True}},
        {"id": "synthetic-home-rest", "name": "휴식", "min": 30,
         "logs": {"start": "2026-10-11T01:00:00Z", "end": "2026-10-11T01:10:00Z"}},
        {"id": "synthetic-home-reversed", "name": "합성 잘못된 종료", "min": 10,
         "logs": {"start": "2026-10-11T02:00:00Z", "end": "2026-10-11T01:00:00Z"}},
        {"id": "synthetic-home-future-end", "name": "합성 아직 완료 아님", "min": 10,
         "logs": {"start": "2026-10-11T02:00:00Z", "end": "2026-10-11T14:00:00Z"}},
        {"id": "synthetic-home-invalid", "name": "합성 날짜 오류", "min": 10, "logs": {"end": "invalid"}},
        {"id": "synthetic-home-legacy-end", "name": "합성 기존 종료 기록", "min": 10,
         "logs": {"end": "2026-10-11T00:00:00Z"}},
    ]
    home_past = [
        {"id": "synthetic-home-cross-date", "name": "합성 자정 완료", "min": 30,
         "logs": {"start": "2026-10-10T14:50:00Z", "end": "2026-10-10T15:20:00Z"}},
        {"id": "synthetic-home-past", "name": "합성 어제 완료", "min": 10,
         "logs": {"start": "2026-10-10T01:00:00Z", "end": "2026-10-10T01:10:00Z"}},
    ]
    cases = [
        (storage_sleep, {"calendar": {TODAY: old, PAST: day(PAST, 0), FUTURE: day(FUTURE, 0), "2026-10-13": no_sleep}, "meta": metadata}),
        (legacy_migration, {"legacy": old}),
        (editing_tabs, {"calendar": {TODAY: day(), FUTURE: day(FUTURE)}}),
        (midnight_sudden, {"calendar": {TODAY: day(sleep=0, customDay="synthetic midnight retained"), FUTURE: day(FUTURE, 0)},
                           "now": dt.datetime.fromisoformat("2026-10-11T23:59:40+09:00")}),
        (backups, {"calendar": {TODAY: old, "2026-10-14": day("2026-10-14", customDay="synthetic existing date retained")}, "meta": metadata}),
        (crossing_midnight, {"calendar": {TODAY: day(sleep=0, tasks=[
             {"id": "synthetic-late", "name": "합성 늦은 활동", "min": 60, "prepMin": 10, "travelMin": 20, "start": "23:30"},
             {"id": "synthetic-after", "name": "합성 이어진 활동", "min": 60}]), FUTURE: day(FUTURE, 0)}}),
        (notification_stub, {"calendar": {TODAY: day(sleep=0, tasks=[
             {"id": "synthetic-notify-late", "name": "합성 늦은 알림", "min": 60, "prepMin": 10, "travelMin": 20, "start": "23:30"},
             {"id": "synthetic-notify-after", "name": "합성 다음 날 알림", "min": 60}])}}),
        (mobile_layout, {"calendar": {TODAY: old}}),
        (home_ui, {"calendar": {TODAY: day(tasks=home_tasks, customDay={"synthetic": "home kept"}),
                                 PAST: day(PAST, tasks=home_past),
                                 FUTURE: day(FUTURE, tasks=[{"id": "synthetic-home-future-plan", "name": "합성 미래 계획", "min": 60}])},
                   "initial_home": True}),
        (home_midnight, {"calendar": {TODAY: day(customDay="synthetic home midnight preserved"), FUTURE: day(FUTURE)},
                         "initial_home": True, "now": dt.datetime.fromisoformat("2026-10-11T23:28:40+09:00")}),
    ]
    report = {"origin": ORIGIN, "timezone": "Asia/Seoul", "synthetic_data_only": True,
              "existing_browser_profile_used": False, "service_workers": "block", "cases": []}
    try:
        async with async_playwright() as pw:
            launch = {"headless": True, "args": ["--disable-gpu", "--disable-dev-shm-usage", "--renderer-process-limit=1"]}
            if os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE"):
                launch["executable_path"] = os.environ["PLAYWRIGHT_CHROMIUM_EXECUTABLE"]
            browser = await pw.chromium.launch(**launch)
            try:
                for function, fixture in cases:
                    if args.case and function.__name__ not in args.case:
                        continue
                    context, h = None, None
                    result = {"name": function.__name__}
                    try:
                        context, h = await open_harness(browser, args.output, **fixture)
                        result["evidence"] = await function(h)
                        assert not h.errors, h.errors
                        assert not await h.page.locator("html").get_attribute("data-app-error")
                        result["status"] = "passed"
                        print(f"PASS {function.__name__}", flush=True)
                    except Exception:
                        result["status"] = "failed"
                        result["traceback"] = traceback.format_exc()
                        print(result["traceback"], file=sys.stderr, flush=True)
                        if h is not None:
                            try:
                                await h.page.screenshot(path=str(args.output / f"failure-{function.__name__}.png"), full_page=True)
                            except Exception:
                                pass
                    finally:
                        if h is not None:
                            result["page_errors"] = h.errors
                            result["dialogs"] = h.dialogs
                        if context is not None:
                            await context.close()
                        report["cases"].append(result)
            finally:
                await browser.close()
    except Exception:
        report["fatal_error"] = traceback.format_exc()
        print(report["fatal_error"], file=sys.stderr, flush=True)
    finally:
        report["passed"] = sum(c["status"] == "passed" for c in report["cases"])
        report["failed"] = sum(c["status"] == "failed" for c in report["cases"])
        report["artifacts"] = sorted(p.name for p in args.output.iterdir() if p.name.startswith(("mobile-", "synthetic-", "failure-")))
        (args.output / "browser-results.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(f"Browser checks: {report['passed']} passed, {report['failed']} failed; {args.output / 'browser-results.json'}", flush=True)
    return 1 if report.get("fatal_error") or report["failed"] else 0


if __name__ == "__main__":
    # Keep v18 fixture helpers/history, but run the current v19 suite.
    import runpy
    runpy.run_path(str(ROOT / "tests/touch.browser.test.py"), run_name="__main__")
