#!/usr/bin/env python3
"""Synthetic Chromium mobile touch and accessibility regressions.

These contexts emulate touch/pointer and viewport behavior, not physical iPhone,
Android, Safari, OS keyboards, or screen readers. Assets are fulfilled from one
checkout snapshot and service workers/external network requests are blocked.
"""

import argparse
import asyncio
import copy
import importlib.util
import json
import os
from pathlib import Path
import traceback

from playwright.async_api import async_playwright, expect


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("today15_touch_helpers", ROOT / "tests/touch.browser.test.py")
touch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(touch)
TODAY, ORIGIN = touch.TODAY, touch.ORIGIN


class TouchBrowser:
    def __init__(self, browser, viewport):
        self.browser, self.viewport = browser, viewport

    async def new_context(self, **options):
        options.update(viewport=self.viewport, has_touch=True, is_mobile=True, device_scale_factor=2)
        return await self.browser.new_context(**options)


def fixture():
    task = {"id": "synthetic-mobile-task", "name": "합성 아주 긴 활동 이름 준비와 이동 뒤에 편히 쉬기",
            "min": 60, "prepMin": 10, "travelMin": 20, "start": "13:00", "logs": {},
            "customTask": {"synthetic": "preserve"}}
    return {TODAY: touch.confirmed_day(tasks=[task], customDay={"synthetic": "preserve"})}


async def assert_modal_isolation(p, selector):
    assert await p.locator(".app").evaluate("el => el.inert"), "modal background remains interactive"
    await expect(p.locator(".app")).to_have_attribute("aria-hidden", "true")
    await expect(p.locator(f"{selector} [role='dialog']")).to_have_attribute("aria-modal", "true")


async def assert_background_restored(p):
    assert not await p.locator(".app").evaluate("el => el.inert")
    assert await p.locator(".app").get_attribute("aria-hidden") != "true"


async def assert_geometry(p, selector):
    data = await p.locator(selector).evaluate("""el => {
      const r = el.getBoundingClientRect();
      return {width: innerWidth, height: innerHeight, left:r.left, right:r.right,
              top:r.top, bottom:r.bottom, client:el.clientWidth, scroll:el.scrollWidth};
    }""")
    assert data["left"] >= -1 and data["right"] <= data["width"] + 1, data
    assert data["scroll"] <= data["client"] + 1, data
    if selector.endswith(".sheet"):
        assert data["top"] >= -1 and data["bottom"] <= data["height"] + 1, data
    assert await p.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")
    return data


async def assert_targets(p, selector):
    for button in await p.locator(selector).all():
        data = await button.evaluate("""el => {
          const r=el.getBoundingClientRect();
          return {width:r.width,height:r.height,name:el.getAttribute('aria-label')||el.textContent};
        }""")
        assert data["height"] >= 44 and data["width"] >= 44, data
        assert data["name"].strip(), data


async def mobile_geometry(h, label):
    p = h.page
    device = await p.evaluate("({width:innerWidth,height:innerHeight,touch:navigator.maxTouchPoints,coarse:matchMedia('(pointer:coarse)').matches})")
    assert device["touch"] >= 1 and device["coarse"], device
    assert await p.locator("#homeView button:visible").count() <= 6
    await assert_targets(p, "#homeView button:visible")
    await assert_geometry(p, "#homeView")
    await p.screenshot(path=str(h.output / f"{label}-home.png"))
    before = await h.storage()
    await p.locator("#homeTime").tap()
    await assert_modal_isolation(p, "#timeAdjustSheet")
    await assert_geometry(p, "#timeAdjustSheet .sheet")
    await assert_targets(p, "#timeAdjustSheet button:visible")
    for field in ("adjustBedtime", "adjustWakeAt"):
        assert await p.locator(f"#{field}").evaluate("el => [...el.labels].some(label => label.textContent.trim())")
    await p.locator('[data-time-field="bedtime"][data-time-delta="10"]').tap()
    await p.locator('[data-time-field="bedtime"][data-time-delta="10"]').tap()
    await expect(p.locator("#adjustBedtime")).to_have_value("23:20")
    assert await h.storage() == before, "sleep draft touch wrote saved records"
    await p.locator("#cancelTimeAdjust").focus()
    await p.keyboard.press("Tab")
    assert await p.locator("#timeAdjustSheet").evaluate("el => el.contains(document.activeElement)")
    await p.keyboard.press("Shift+Tab")
    await expect(p.locator("#cancelTimeAdjust")).to_be_focused()
    await p.screenshot(path=str(h.output / f"{label}-sleep.png"))
    await p.keyboard.press("Escape")
    await expect(p.locator("#homeTime")).to_be_focused()
    await assert_background_restored(p)
    assert await h.storage() == before
    await p.locator("#homeStart").tap()
    await assert_modal_isolation(p, "#homeStartSheet")
    await assert_geometry(p, "#homeStartSheet .sheet")
    await assert_targets(p, "#homeStartSheet button:visible")
    await p.locator("#homeNewDuration").tap()
    await p.locator("#adjustDuration").fill("0")
    await p.locator("#cancelTimeAdjust").tap()
    await expect(p.locator("#homeNewDuration")).to_be_focused()
    await assert_modal_isolation(p, "#homeStartSheet")
    await p.keyboard.press("Escape")
    await expect(p.locator("#homeStart")).to_be_focused()
    await assert_background_restored(p)
    assert await h.storage() == before, "nested duration cancellation changed stored records"
    return {"device": device, "evidence": "Touch targets, native labels, narrow modal geometry, nested cancellation, focus trap, and background isolation"}


async def phase_focus(h, label):
    p = h.page
    await p.locator("#homeStart").tap()
    await p.locator('[data-home-start="0"]').tap()
    await expect(p.locator("#homeActive [data-home-next]")).to_be_focused()
    await p.clock.run_for(1000)
    await p.locator("#homeActive [data-home-next]").tap()
    await expect(p.locator("#homeActive [data-home-next]")).to_be_focused()
    await p.locator("#homeActive [data-home-next]").tap()
    await expect(p.locator("#homeActive [data-home-next]")).to_be_focused()
    task = (await h.calendar())[TODAY]["tasks"][0]
    assert set(task["logs"]) == {"prep", "depart"}, "freshly redrawn home action advanced twice within 450 ms"
    await p.clock.run_for(1000)
    await p.locator("#homeRecords").tap()
    trigger = p.locator('#todayBody [data-open-track="0"]')
    await trigger.tap()
    await assert_modal_isolation(p, "#trackSheet")
    await assert_geometry(p, "#trackSheet .sheet")
    await assert_targets(p, "#trackSheet button:visible")
    await p.locator("#trackNext").tap()
    await p.locator("#trackNext").tap()
    task = (await h.calendar())[TODAY]["tasks"][0]
    assert set(task["logs"]) == {"prep", "depart", "arrive"}, "freshly redrawn track action advanced twice within 450 ms"
    await p.locator("#closeTrack").tap()
    await expect(trigger).to_be_focused()
    await assert_background_restored(p)
    await trigger.tap()
    before = copy.deepcopy((await h.calendar())[TODAY]["tasks"][0])
    await p.locator("#undoTrack").tap()
    await p.locator("#undoTrack").tap()
    after = (await h.calendar())[TODAY]["tasks"][0]
    assert set(before["logs"]) - set(after["logs"]) == {"arrive"}, "rapid repeated undo removed multiple real endpoints"
    assert len(before["routeActions"]) - len(after["routeActions"]) == 1
    await p.locator(".track-detail summary").tap()
    await p.locator('[data-track-edit="depart"]').tap()
    await assert_geometry(p, "#trackEditTime")
    before_cancel = await h.storage()
    await p.locator("#trackEditTime").fill("2026-10-11T12:00")
    await p.locator("#trackCancelEdit").tap()
    assert await h.storage() == before_cancel
    await expect(p.locator('[data-track-edit="depart"]')).to_be_focused()
    await p.screenshot(path=str(h.output / f"{label}-tracking.png"))
    await p.locator("#closeTrack").tap()
    await expect(trigger).to_be_focused()
    await assert_background_restored(p)
    await p.reload(wait_until="domcontentloaded")
    assert (await h.calendar())[TODAY]["tasks"][0] == after
    for stage in ("arrive", "start", "end", "returnDepart", "return"):
        await p.clock.run_for(1000)
        await p.locator("#homeActive [data-home-next]").tap()
        current = (await h.calendar())[TODAY]["tasks"][0]
        assert stage in current["logs"]
        if stage == "return":
            await expect(p.locator("#homeStart")).to_be_focused()
        else:
            await expect(p.locator("#homeActive [data-home-next]")).to_be_focused()
    return {"evidence": "Real taps, redrawn home phase/completion focus, newly rendered repeat guard, one undo per rapid gesture, mutated modal focus return, edit cancellation and refresh preservation"}


async def duration_apply_focus(h, label):
    p = h.page
    await p.locator("#homeRecords").tap()
    trigger = p.locator('#todayBody [data-task-duration="0"][data-task-field="min"]')
    before = copy.deepcopy((await h.calendar())[TODAY]["tasks"][0])
    await trigger.tap()
    await p.locator("#adjustDuration").fill("50")
    await p.locator("#applyTimeAdjust").tap()
    await expect(trigger).to_be_focused()
    await assert_background_restored(p)
    after = (await h.calendar())[TODAY]["tasks"][0]
    assert after["min"] == 50 and after["logs"] == before["logs"]
    assert after["customTask"] == before["customTask"]
    await p.reload(wait_until="domcontentloaded")
    assert (await h.calendar())[TODAY]["tasks"][0] == after
    return {"evidence": "Saved duration application returns focus to redrawn trigger; actual and unknown fields survive refresh"}


async def browser_back_cancel(h, label):
    p = h.page
    # A prior same-origin document models browser/Android Back without injecting
    # SPA navigation. The helper seed does not access blocked about:blank storage.
    await p.context.route(ORIGIN + "/previous.html", lambda route: route.fulfill(
        status=200, content_type="text/html", body="<!doctype html><title>Synthetic previous page</title>"))
    await p.goto(ORIGIN + "/previous.html", wait_until="domcontentloaded")
    await p.goto(ORIGIN + "/index.html", wait_until="domcontentloaded")
    before = await h.storage()
    await p.locator("#homeTime").tap()
    await p.locator("#adjustBedtime").fill("22:00")
    await p.go_back(wait_until="domcontentloaded")
    assert p.url == ORIGIN + "/previous.html"
    assert await h.storage() == before, "browser Back committed a sleep draft"
    await p.go_forward(wait_until="domcontentloaded")
    await expect(p.locator("#homeView")).to_be_visible()
    assert await h.storage() == before
    await expect(p.locator("#timeAdjustSheet")).not_to_be_visible()
    await assert_background_restored(p)
    await p.locator("#homeStart").tap()
    await p.locator("#homeNewName").fill("합성 저장하지 않은 활동")
    await p.go_back(wait_until="domcontentloaded")
    await p.go_forward(wait_until="domcontentloaded")
    assert await h.storage() == before, "browser navigation saved an activity draft"
    await expect(p.locator("#homeStartSheet")).not_to_be_visible()
    await p.reload(wait_until="domcontentloaded")
    assert await h.storage() == before
    return {"evidence": "Browser Back navigates to previous document; Forward/reload discards drafts and preserves synthetic saved records"}


async def main():
    cases = {"mobile_geometry": mobile_geometry, "phase_focus": phase_focus,
             "duration_apply_focus": duration_apply_focus, "browser_back_cancel": browser_back_cancel}
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--case", action="append", choices=cases)
    parser.add_argument("--output", type=Path, default=ROOT.parent / "verification-cloud/mobile")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    report = {"engine": "Chromium", "synthetic_data_only": True, "has_touch": True, "is_mobile": True,
              "physical_devices_exercised": False, "service_workers": "block", "cases": []}
    try:
        async with async_playwright() as pw:
            launch = {"headless": True, "args": ["--disable-gpu", "--disable-dev-shm-usage", "--renderer-process-limit=1"]}
            if os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE"):
                launch["executable_path"] = os.environ["PLAYWRIGHT_CHROMIUM_EXECUTABLE"]
            browser = await pw.chromium.launch(**launch)
            try:
                for width, height in ((320, 568), (360, 800), (390, 844)):
                    for name, function in cases.items():
                        if args.case and name not in args.case:
                            continue
                        label = f"mobile-{width}x{height}-{name}"
                        context, h = None, None
                        result = {"name": name, "viewport": {"width": width, "height": height}}
                        try:
                            device = TouchBrowser(browser, result["viewport"])
                            context, h = await touch.open_harness(device, args.output, calendar=fixture())
                            result.update(await function(h, label))
                            assert not h.errors, h.errors
                            assert not h.route_errors, h.route_errors
                            result["status"] = "passed"
                            print(f"PASS {label}", flush=True)
                        except Exception:
                            result["status"] = "failed"
                            result["traceback"] = traceback.format_exc()
                            print(f"FAIL {label}\n{result['traceback']}", flush=True)
                            if h is not None:
                                try:
                                    await h.page.screenshot(path=str(args.output / f"failure-{label}.png"))
                                except Exception:
                                    pass
                        finally:
                            if h is not None:
                                result["page_errors"] = h.errors
                            if context is not None:
                                await context.close()
                            report["cases"].append(result)
            finally:
                await browser.close()
    except Exception:
        report["fatal_error"] = traceback.format_exc()
    report["passed"] = sum(case["status"] == "passed" for case in report["cases"])
    report["failed"] = sum(case["status"] == "failed" for case in report["cases"])
    (args.output / "mobile-results.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(f"Mobile checks: {report['passed']} passed, {report['failed']} failed", flush=True)
    return 1 if report.get("fatal_error") or report["failed"] else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
