#!/usr/bin/env python3
"""Synthetic v18-to-v19 service-worker update and cache preservation regression.

Serve immutable old-main and candidate checkout snapshots on localhost. Use a
fresh Chromium context, real service workers, and synthetic records/cache bodies.
No production URL, personal browser profile, or physical device is exercised.
Requires Python Playwright and Chromium. Set PLAYWRIGHT_CHROMIUM_EXECUTABLE for a
system browser; --output defaults to a directory outside the checkout.
"""

import argparse
import asyncio
import datetime as dt
import hashlib
import http.server
import json
import mimetypes
import os
from pathlib import Path
import subprocess
import threading
import traceback
from urllib.parse import unquote, urlsplit

from playwright.async_api import async_playwright, expect


ROOT = Path(__file__).resolve().parents[1]
BASELINE = "faf3cc276216b55ac830104dd42d3a95980ef944"
ASSETS = ["index.html", "styles.css", "core.js", "app.js", "tracking.js",
          "time-controls.js", "sw.js", "manifest.webmanifest"]
TODAY = "2026-10-20"
DAY = {
    "date": TODAY, "sleep": 9, "sleepAt": "23:30", "tasks": [
        {"id": "synthetic-pwa-legacy", "name": "합성 기존 종료 활동", "min": 60,
         "prepMin": 10, "travelMin": 20, "start": "13:00",
         "logs": {"start": "2026-10-20T01:00:00.000Z", "end": "2026-10-20T01:40:00.000Z"},
         "customTask": {"synthetic": "keep"}},
        {"id": "synthetic-pwa-planned", "name": "합성 아직 시작하지 않은 계획",
         "min": 30, "prepMin": 0, "travelMin": 0, "logs": {}, "customTask": {"synthetic": "keep"}}],
    "events": [{"id": "synthetic-old-event", "type": "recorded",
                "at": "2026-10-20T01:40:00.000Z", "custom": "keep"}],
    "choice": "합성 기존 선택", "customDay": {"synthetic": "keep"}}
CALENDAR = {
    TODAY: DAY,
    "2026-10-19": {"date": "2026-10-19", "sleep": 7.5, "sleepAt": "00:00",
                   "tasks": [], "events": [], "choice": "합성 과거 선택", "unknown": "keep"}}
SEED = {
    "today15_calendar_v3": CALENDAR,
    "today15hours_v2": DAY,
    "today15_meta_v4": {"fixed": [{"id": "synthetic-birthday", "date": TODAY,
                                  "name": "합성 기념일", "yearly": True}],
                        "customMeta": {"synthetic": "keep"}},
    "today15_feedback_v1": "합성 피드백", "today15_grid_v1": "48",
    "synthetic_other_app_user_data": "synthetic unrelated localStorage preserved"}
PRESERVED_CACHE_NAMES = ["synthetic-other-project-offline-v1", "sibling-app-cache-v1",
                         "today15-v17", "today15-v999", "today15-v18-extra", "today15-v19"]


def snapshots():
    old = {}
    for filename in ASSETS:
        result = subprocess.run(["git", "show", f"{BASELINE}:{filename}"], cwd=ROOT, capture_output=True)
        if result.returncode == 0:
            old[filename] = result.stdout
    if not all(name in old for name in ("index.html", "core.js", "app.js", "sw.js")):
        raise RuntimeError(f"The v18 baseline {BASELINE} is unavailable in this checkout")
    # Read once before serving. Concurrent writes cannot mix asset revisions.
    candidate = {filename: (ROOT / filename).read_bytes() for filename in ASSETS}
    return {"v18": old, "candidate": candidate}


def create_server(assets, state, requests):
    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_GET(self):
            path = unquote(urlsplit(self.path).path)
            relative = path.removeprefix("/today-15-hours/") if path.startswith("/today-15-hours/") else None
            if relative == "":
                relative = "index.html"
            revision = state["revision"]
            data = assets[revision].get(relative)
            status = 200 if data is not None else 404
            requests.append({"revision": revision, "path": self.path, "status": status})
            self.send_response(status)
            self.send_header("Content-Type", mimetypes.guess_type(relative or "")[0] or "application/octet-stream")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data if data is not None else b"not found")

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


async def storage(page):
    return await page.evaluate("Object.fromEntries(Object.entries(localStorage))")


async def cache_inventory(page):
    return await page.evaluate("""async () => {
      const result = {};
      for (const name of await caches.keys()) {
        result[name] = (await (await caches.open(name)).keys()).map(request => request.url);
      }
      return result;
    }""")


async def payload_inventory(page, entries):
    return await page.evaluate("""async entries => {
      const result = {};
      const names = await caches.keys();
      for (const entry of entries) {
        if (!names.includes(entry.name)) { result[entry.name] = null; continue; }
        const response = await (await caches.open(entry.name)).match(entry.path);
        result[entry.name] = response ? {
          body: await response.text(), status: response.status,
          contentType: response.headers.get('Content-Type'),
          marker: response.headers.get('X-Synthetic-Marker')
        } : null;
      }
      return result;
    }""", entries)


async def ready(page, version):
    await page.wait_for_function("navigator.serviceWorker.controller !== null")
    await page.wait_for_function("async version => (await caches.keys()).includes('today15-v' + version)", arg=version)
    await expect(page.locator("#homeView")).to_be_visible()


def record(report, name, condition, **details):
    status = "passed" if condition else "failed"
    report["cases"].append({"name": name, "status": status, **details})
    print(f"{status.upper()} {name}", flush=True)


async def browser_checks(args, assets, state, origin, report):
    async with async_playwright() as pw:
        launch = {"headless": True, "args": ["--disable-gpu", "--disable-dev-shm-usage", "--renderer-process-limit=1"]}
        if os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE"):
            launch["executable_path"] = os.environ["PLAYWRIGHT_CHROMIUM_EXECUTABLE"]
        browser = await pw.chromium.launch(**launch)
        try:
            context = await browser.new_context(service_workers="allow", timezone_id="Asia/Seoul",
                viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True)
            try:
                await context.add_init_script("""(() => {
                  if (location.origin !== %s || sessionStorage.getItem('__synthetic_pwa_seeded')) return;
                  const seed = %s;
                  for (const [key,value] of Object.entries(seed)) {
                    localStorage.setItem(key,typeof value === 'string' ? value : JSON.stringify(value));
                  }
                  sessionStorage.setItem('__synthetic_pwa_seeded','yes');
                })();""" % (json.dumps(origin), json.dumps(SEED, ensure_ascii=False)))
                page = await context.new_page()
                page.set_default_timeout(15000)
                page.set_default_navigation_timeout(15000)
                errors, external_requests = [], []
                page.on("pageerror", lambda error: errors.append(str(error)))
                context.on("request", lambda request: external_requests.append(request.url)
                           if not request.url.startswith(origin + "/") else None)
                report["page_errors"], report["external_requests"] = errors, external_requests
                await page.clock.install(time=dt.datetime.fromisoformat("2026-10-20T12:00:00+09:00"))
                url = origin + "/today-15-hours/index.html"
                await page.goto(url, wait_until="load")
                await ready(page, "18")
                await page.wait_for_function("document.querySelector('script[src*=app]').src.endsWith('?v=18')")
                baseline = await storage(page)
                report["v18_storage"], report["v18_caches"] = baseline, await cache_inventory(page)
                record(report, "v18_initial_install_and_legacy_storage_fixture",
                       json.loads(baseline["today15_calendar_v3"]) == CALENDAR and
                       json.loads(baseline["today15hours_v2"]) == DAY)

                await context.set_offline(True)
                await page.reload(wait_until="load")
                await ready(page, "18")
                record(report, "v18_offline_reload_preserves_records", await storage(page) == baseline)
                await context.set_offline(False)

                entries = [{"name": name, "path": f"/synthetic-cache-probe/{index}.json",
                            "body": json.dumps({"synthetic": "offline-only-user-document", "cache": name,
                                                "text": "합성 보존 자료"}, ensure_ascii=False),
                            "marker": f"synthetic-{index}"}
                           for index, name in enumerate(PRESERVED_CACHE_NAMES)]
                await page.evaluate("""async entries => {
                  for (const entry of entries) {
                    const cache = await caches.open(entry.name);
                    await cache.put(entry.path,new Response(entry.body,{status:200,headers:{
                      'Content-Type':'application/json; charset=utf-8','X-Synthetic-Marker':entry.marker
                    }}));
                  }
                }""", entries)
                before_payloads = await payload_inventory(page, entries)
                report["before_update_caches"] = await cache_inventory(page)
                report["before_update_synthetic_payloads"] = before_payloads
                await page.locator("#openHomeSleep").tap()
                await page.locator("#homeBedtime").fill("22:00")
                record(report, "v18_unsaved_sleep_draft_does_not_write", await storage(page) == baseline)
                state["revision"] = "candidate"
                await page.evaluate("async () => {const registration=await navigator.serviceWorker.getRegistration();await registration.update();}")
                await page.wait_for_function("typeof Today15Tracking !== 'undefined' && typeof Today15TimeControls !== 'undefined'")
                await ready(page, "19")
                record(report, "v18_to_v19_localStorage_byte_identical_including_old_key",
                       await storage(page) == baseline)
                cache_urls = await cache_inventory(page)
                report["v19_caches"] = cache_urls
                after_payloads = await payload_inventory(page, entries)
                report["after_update_synthetic_payloads"] = after_payloads
                record(report, "only_known_retired_v18_cache_removed", "today15-v18" not in cache_urls)
                unknown = [name for name in PRESERVED_CACHE_NAMES if name != "today15-v19"]
                record(report, "unrelated_and_unknown_cache_payloads_preserved",
                       all(after_payloads[name] == before_payloads[name] and after_payloads[name] is not None
                           for name in unknown), preserved_names=unknown)
                record(report, "current_namespace_extra_payload_preserved",
                       after_payloads["today15-v19"] == before_payloads["today15-v19"] and
                       after_payloads["today15-v19"] is not None)
                required = ["index.html", "core.js?v=19", "tracking.js?v=19", "time-controls.js?v=19",
                            "app.js?v=19", "styles.css?v=19", "manifest.webmanifest"]
                record(report, "v19_modules_and_css_precached",
                       all(origin + "/today-15-hours/" + name in cache_urls.get("today15-v19", [])
                           for name in required))

                await context.set_offline(True)
                await page.reload(wait_until="load")
                await ready(page, "19")
                await expect(page.locator("#homeTime")).to_have_attribute("aria-haspopup", "dialog")
                await page.locator("#homeTime").tap()
                await expect(page.locator("#timeAdjustSheet")).to_be_visible()
                await page.locator("#cancelTimeAdjust").tap()
                record(report, "v19_offline_reload_and_editor_preserve_records",
                       await storage(page) == baseline and not await page.locator("html").get_attribute("data-app-error"))
                await page.screenshot(path=str(args.output / "v19-offline-synthetic-mobile.png"))
                await page.goto(origin + "/today-15-hours/", wait_until="load")
                await ready(page, "19")
                record(report, "v19_offline_directory_start_url", await storage(page) == baseline)
                offline_payloads = await payload_inventory(page, entries)
                record(report, "all_synthetic_payloads_preserved_after_offline_reload", offline_payloads == before_payloads)
                # Unknown caches must survive without supplying another version
                # of this app's shell or modules when their URLs collide.
                probes = [{"url": origin + "/today-15-hours/" + filename,
                           "body": f"synthetic stale v17 payload for {filename}"}
                          for filename in ("index.html", "core.js?v=19")]
                expected = {origin + "/today-15-hours/" + filename: assets["candidate"][filename.split("?")[0]].decode()
                            for filename in ("index.html", "core.js?v=19")}
                namespace_results = await page.evaluate("""async ({probes,expected}) => {
                  const old = await caches.open('today15-v17');
                  for (const probe of probes) await old.put(probe.url,new Response(probe.body));
                  const results=[];
                  for (const probe of probes) {
                    const response=await fetch(probe.url,{cache:'no-store'});
                    const body=await response.text();
                    const retained=await (await old.match(probe.url)).text();
                    results.push({url:probe.url,usesCurrentCandidate:body===expected[probe.url],
                      stalePayloadPreserved:retained===probe.body,servedStalePayload:body===probe.body});
                  }
                  return results;
                }""", {"probes": probes, "expected": expected})
                report["offline_namespace_probes"] = namespace_results
                record(report, "offline_current_shell_and_module_ignore_unknown_cache_collisions",
                       all(item["usesCurrentCandidate"] and item["stalePayloadPreserved"]
                           for item in namespace_results))
                if all(item["usesCurrentCandidate"] for item in namespace_results):
                    await page.reload(wait_until="load")
                    await ready(page, "19")
                    await page.wait_for_function("typeof Today15Tracking !== 'undefined' && typeof Today15TimeControls !== 'undefined'")
                    record(report, "offline_reload_with_stale_same_url_entries_uses_v19",
                           await storage(page) == baseline and
                           not await page.locator("html").get_attribute("data-app-error"))
                    await page.goto(origin + "/today-15-hours/synthetic-not-cached-page", wait_until="load")
                    await ready(page, "19")
                    await page.wait_for_function("typeof Today15Tracking !== 'undefined' && typeof Today15TimeControls !== 'undefined'")
                    record(report, "uncached_offline_navigation_uses_current_cached_index",
                           await storage(page) == baseline and
                           not await page.locator("html").get_attribute("data-app-error"))
                    retained_collision_bodies = await page.evaluate("""async probes => {
                      const cache=await caches.open('today15-v17');
                      return await Promise.all(probes.map(async probe =>
                        (await (await cache.match(probe.url)).text())===probe.body));
                    }""", probes)
                    record(report, "stale_same_url_payloads_remain_untouched", all(retained_collision_bodies))
                report["final_storage"] = await storage(page)
                record(report, "no_page_errors_or_external_requests", not errors and not external_requests)
            finally:
                await context.close()
        finally:
            await browser.close()


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT.parent / "verification-pwa")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    report = {"baseline_sha": BASELINE, "candidate_source": "immutable checkout snapshot",
              "production_accessed": False, "synthetic_data_only": True,
              "physical_devices_exercised": False, "cases": []}
    server = None
    try:
        assets = snapshots()
        report["checkout_head"] = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
        report["asset_sha256"] = {revision: {name: hashlib.sha256(data).hexdigest()
                                            for name, data in files.items()} for revision, files in assets.items()}
        state, requests = {"revision": "v18"}, []
        server = create_server(assets, state, requests)
        origin = f"http://127.0.0.1:{server.server_address[1]}"
        report["origin"], report["requests"] = origin, requests
        await asyncio.wait_for(browser_checks(args, assets, state, origin, report), timeout=120)
    except Exception:
        report["fatal_error"] = traceback.format_exc()
        print(report["fatal_error"], flush=True)
    finally:
        if server is not None:
            server.shutdown()
            server.server_close()
        report["passed"] = sum(case["status"] == "passed" for case in report["cases"])
        report["failed"] = sum(case["status"] == "failed" for case in report["cases"])
        (args.output / "pwa-results.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(f"PWA checks: {report['passed']} passed, {report['failed']} failed", flush=True)
    return 1 if report.get("fatal_error") or report["failed"] else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
