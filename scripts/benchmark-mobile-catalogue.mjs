import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const [baselineArg, candidateArg] = process.argv.slice(2);
function localOrigin(value) {
  const url = new URL(value);
  assert.equal(url.protocol, "http:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.href, url.origin + "/");
  return url.origin;
}
const variants = [
  ["baseline", localOrigin(baselineArg)],
  ["candidate", localOrigin(candidateArg)],
];
assert.notEqual(variants[0][1], variants[1][1]);
const browser = await chromium.launch();
try {
  for (let run = 0; run < 3; run++) {
    for (const [variant, origin] of run % 2 ? [...variants].reverse() : variants) {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        serviceWorkers: "block",
      });
      try {
        await context.route("**/*", (route) => {
          const url = new URL(route.request().url());
          return url.origin === origin ? route.continue() : route.abort();
        });
        const page = await context.newPage();
        const cdp = await context.newCDPSession(page);
        await cdp.send("Network.enable");
        await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
        await cdp.send("Network.emulateNetworkConditions", {
          offline: false,
          latency: 150,
          downloadThroughput: 200_000,
          uploadThroughput: 93_750,
          connectionType: "cellular4g",
        });
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
        await page.addInitScript(() => {
          window.lab = { lcp: null, shifts: [], interactions: [] };
          new PerformanceObserver((list) => {
            window.lab.lcp = list.getEntries().at(-1)?.startTime ?? window.lab.lcp;
          }).observe({ type: "largest-contentful-paint", buffered: true });
          new PerformanceObserver((list) => {
            for (const item of list.getEntries()) {
              if (!item.hadRecentInput)
                window.lab.shifts.push({ time: item.startTime, value: item.value });
            }
          }).observe({ type: "layout-shift", buffered: true });
          new PerformanceObserver((list) => {
            for (const item of list.getEntries()) {
              if (item.interactionId) window.lab.interactions.push(item.duration);
            }
          }).observe({ type: "event", durationThreshold: 16, buffered: true });
        });
        const response = await page.goto(origin + "/", { waitUntil: "load", timeout: 45_000 });
        assert.equal(response.status(), 200);
        assert.match(response.headers()["cache-control"], /private.*no-store/);
        const grid = page.locator(".festivalGrid");
        const initialCount = variant === "candidate" ? 48 : 551;
        const input = page.getByRole("textbox", { name: "Search festivals, artists or cities" });
        await page.locator(".search[data-ready=true]").waitFor({ timeout: 20_000 });
        assert.equal(await grid.getByRole("heading").count(), initialCount);
        await page.waitForFunction(() => window.lab.lcp !== null);
        const load = await page.evaluate(() => {
          const nav = performance.getEntriesByType("navigation")[0];
          const entries = performance.getEntriesByType("resource");
          return {
            ttfbMs: Math.round(nav.responseStart),
            lcpMs: Math.round(window.lab.lcp),
            htmlEncodedBytes: nav.encodedBodySize,
            jsEncodedBytes: entries
              .filter((r) => new URL(r.name).pathname.endsWith(".js"))
              .reduce((total, r) => total + r.encodedBodySize, 0),
          };
        });
        const begin = performance.now();
        await input.pressSequentially("Fixture Festival 549");
        await page.waitForFunction(() => {
          const cards = document.querySelectorAll(".festivalGrid h2");
          return cards.length === 1 && cards[0].textContent === "Fixture Festival 549";
        });
        const typeAndRenderMs = Math.round(performance.now() - begin);
        await page.getByRole("button", { name: "Clear search" }).click();
        await page.waitForFunction(
          (count) => document.querySelectorAll(".festivalGrid h2").length === count,
          initialCount,
        );
        await page.evaluate(
          () =>
            new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        );
        const interaction = await page.evaluate(() => {
          let first = -Infinity;
          let previous = -Infinity;
          let cluster = 0;
          let cls = 0;
          for (const { time, value } of window.lab.shifts) {
            if (time - previous > 1000 || time - first > 5000) {
              first = time;
              cluster = 0;
            }
            cluster += value;
            previous = time;
            cls = Math.max(cls, cluster);
          }
          return {
            cls: Number(cls.toFixed(4)),
            longestLabInteractionMs: window.lab.interactions.length
              ? Math.max(...window.lab.interactions)
              : null,
            noDocumentOverflow: document.documentElement.scrollWidth <= innerWidth,
          };
        });
        console.log(
          JSON.stringify({ variant, run: run + 1, ...load, typeAndRenderMs, ...interaction }),
        );
      } finally {
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
}
