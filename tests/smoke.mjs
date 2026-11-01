// Smoke suite — the net under index.html (Roney Weather).
// Same shape as smoke.mjs: headless Chromium, a throwaway static server, plain
// assertions. Open-Meteo is mocked at the network layer so the suite is
// deterministic and runs where the real API can't be reached.
//
//   node tests/smoke.mjs            (playwright, or playwright-core + PW_EXEC)
//   SHOT=/dir node tests/smoke.mjs  also writes dark/light screenshots there

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let chromium;
try { ({ chromium } = await import("playwright")); }
catch { ({ chromium } = await import("playwright-core")); }

const fails = [];
const ok = (name, cond, detail) => {
  console.log((cond ? "  ✓ " : "  ✗ ") + name + (cond || detail == null ? "" : " — " + detail));
  if (!cond) fails.push(name);
};

/* ---------- fixture: a plausible Open-Meteo answer, pinned to one clock ---------- */
const NOW = "2026-11-01T09:12";
const hourly = { time: [], temperature_2m: [], precipitation_probability: [], weather_code: [], is_day: [], uv_index: [] };
for (let i = 0; i < 48; i++) {
  const d = i < 24 ? "2026-11-01" : "2026-11-02", h = i % 24;
  hourly.time.push(d + "T" + String(h).padStart(2, "0") + ":00");
  hourly.temperature_2m.push(48 + 14 * Math.sin((h - 6) / 24 * Math.PI * 2) + (i >= 24 ? -3 : 0));
  hourly.precipitation_probability.push(h >= 14 && h <= 17 ? 40 : 0);
  hourly.weather_code.push(h >= 14 && h <= 17 ? 61 : h < 10 ? 2 : 1);
  hourly.is_day.push(h >= 8 && h < 18 ? 1 : 0);
  hourly.uv_index.push(h >= 10 && h <= 15 ? 4 : 1);
}
const daily = {
  time: ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"],
  weather_code: [61, 3, 1, 0, 95, 71, 2],
  temperature_2m_max: [62.6, 58, 61, 66, 59, 41, 47],
  temperature_2m_min: [41.2, 39, 37, 44, 46, 28, 30],
  sunrise: daily_t("07:48"), sunset: daily_t("18:32"),
  precipitation_probability_max: [40, 10, 0, 0, 80, 70, 5],
  precipitation_sum: [0.12, 0, 0, 0, 0.6, 0.3, 0],
};
function daily_t(hm) { return ["01", "02", "03", "04", "05", "06", "07"].map(d => "2026-11-" + d + "T" + hm); }
const FORECAST = {
  latitude: 36.7, longitude: -97.08, timezone: "America/Chicago", timezone_abbreviation: "CST",
  current: { time: NOW, temperature_2m: 57.4, relative_humidity_2m: 61, apparent_temperature: 54.1, is_day: 1,
    precipitation: 0, weather_code: 2, wind_speed_10m: 9.3, wind_gusts_10m: 18.1, wind_direction_10m: 320 },
  hourly, daily,
};
const GEO = { results: [
  { name: "Ponca City", latitude: 36.707, longitude: -97.0856, country_code: "US", admin1: "Oklahoma" },
  { name: "Ponca", latitude: 42.5633, longitude: -96.7056, country_code: "US", admin1: "Nebraska" },
] };

/* ---------- static server ---------- */
const MIME = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png" };
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const data = await readFile(path.join(ROOT, p));
    res.writeHead(200, { "content-type": MIME[path.extname(p)] || "application/octet-stream" });
    res.end(data);
  } catch (e) { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, r));
const BASE = "http://localhost:" + server.address().port + "/";

const browser = await chromium.launch(process.env.PW_EXEC ? { executablePath: process.env.PW_EXEC } : {});
let apiCalls = 0, apiDown = false;
async function page(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: opts.scheme || "dark",
    storageState: opts.state, serviceWorkers: "block" });
  const p = await ctx.newPage();
  p.errors = [];
  p.on("pageerror", e => p.errors.push(String(e)));
  p.on("console", m => { if (m.type() === "error") p.errors.push(m.text()); });
  await p.route("**/api.open-meteo.com/**", r => { apiCalls++; return apiDown ? r.fulfill({ status: 503, body: "down" }) : r.fulfill({ json: FORECAST }); });
  await p.route("**/geocoding-api.open-meteo.com/**", r => r.fulfill({ json: GEO }));
  await p.route("**/api.bigdatacloud.net/**", r => r.fulfill({ json: { city: "Ponca City", principalSubdivisionCode: "US-OK", countryCode: "US" } }));
  return p;
}
const text = (p, sel) => p.locator(sel).first().innerText();

/* ---------- 0. the install surface is really there ---------- */
console.log("install surface");
try { execFileSync(process.execPath, ["--check", path.join(ROOT, "sw.js")]); ok("sw.js parses", true); }
catch (e) { ok("sw.js parses", false, String(e.stderr || e).slice(0, 200)); }
ok("sw.js cache name matches the app version", (await readFile(path.join(ROOT, "sw.js"), "utf8")).includes('CACHE = "weather-' + (await readFile(path.join(ROOT, "index.html"), "utf8")).match(/APP_VERSION = "(w\d+)/)[1] + '"'));
for (const f of ["manifest.json", "sw.js", "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-192.png", "icons/maskable-512.png"]) {
  const r = await fetch(BASE + f); ok(f + " serves", r.ok, String(r.status));
}
const man = await (await fetch(BASE + "manifest.json")).json();
ok("manifest icons are local", man.icons.every(i => i.src.startsWith("icons/")));
ok("manifest scope is the root", man.scope === "./" && man.start_url === "./" && man.id === "/");
ok("any and maskable icons are separate", man.icons.some(i => i.purpose === "any") && man.icons.some(i => i.purpose === "maskable") && !man.icons.some(i => /any maskable/.test(i.purpose)));

/* ---------- 1. first open ---------- */
console.log("first open");
let p = await page();
await p.goto(BASE); await p.waitForTimeout(400);
ok("onboarding card shows", (await p.locator(".onb").count()) === 1);
ok("header says pick a place", (await text(p, "#hSub")).includes("Pick a place"));
ok("no API call before a place exists", apiCalls === 0);
ok("no errors", p.errors.length === 0, p.errors.join(" | "));

/* ---------- 2. search, pick, forecast renders ---------- */
console.log("search → forecast");
await p.click('[data-act="search"]'); await p.waitForTimeout(400);
ok("sheet opens", await p.locator("#sheet").evaluate(e => e.classList.contains("on")));
await p.fill("#q", "Ponca"); await p.waitForTimeout(500);
ok("two results", (await p.locator("#results .pick").count()) === 2);
await p.click('#results [data-pick="0"]'); await p.waitForTimeout(600);
ok("sheet closes after pick", !(await p.locator("#sheet").evaluate(e => e.classList.contains("on"))));
ok("one forecast fetch", apiCalls === 1, String(apiCalls));
ok("title is the place", (await text(p, "#hTitle")) === "Ponca City");
ok("hero temp 57°F", (await text(p, "#heroTemp")).replace(/\s/g, "") === "57°F", await text(p, "#heroTemp"));
ok("condition text", (await text(p, ".hero-cond")) === "Partly cloudy");
ok("feels/high/low", /Feels 54° · H 63° L 41°/.test(await text(p, ".hero-sub")), await text(p, ".hero-sub"));
ok("six tiles", (await p.locator(".tile").count()) === 6);
ok("wind tile", /9 mph/.test(await text(p, ".tile:nth-child(1) .v")) && /NW · gusts 18 mph/.test(await text(p, ".tile:nth-child(1) .s")));
ok("rain tile", (await text(p, ".tile:nth-child(3) .v")) === "40%" && /0.12 in today/.test(await text(p, ".tile:nth-child(3) .s")));
ok("uv tile reads the current hour", (await text(p, ".tile:nth-child(4) .v")) === "1");
ok("sunrise/sunset", (await text(p, ".tile:nth-child(5) .v")) === "7:48 AM" && (await text(p, ".tile:nth-child(6) .v")) === "6:32 PM");
ok("24 hourly cells", (await p.locator(".hr").count()) === 24);
ok("first hourly is Now at 9 AM", (await text(p, ".hr.now .t")) === "Now" && (await text(p, ".hr:nth-child(2) .t")) === "10 AM");
ok("rain chance shows at 2 PM", (await text(p, ".hr:nth-child(6) .p")) === "40%");
ok("7 daily rows", (await p.locator(".day").count()) === 7);
ok("today labelled", (await text(p, ".day:first-child .n")) === "Today");
ok("week aside names the state", /Oklahoma, US/.test(await text(p, ".sec-label .aside")));
ok("updated just now", /Updated just now/.test(await text(p, "#hSub")), await text(p, "#hSub"));
ok("no errors", p.errors.length === 0, p.errors.join(" | "));
if (process.env.SHOT) await p.screenshot({ path: path.join(process.env.SHOT, "weather-dark.png"), fullPage: true });

/* ---------- 3. units + theme ---------- */
console.log("units + theme");
await p.click("#unitBtn"); await p.waitForTimeout(200);
ok("hero flips to 14°C", (await text(p, "#heroTemp")).replace(/\s/g, "") === "14°C", await text(p, "#heroTemp"));
ok("wind flips to km/h", /15 km\/h/.test(await text(p, ".tile:nth-child(1) .v")));
ok("rain flips to mm", /3 mm today/.test(await text(p, ".tile:nth-child(3) .s")));
ok("no refetch on unit flip", apiCalls === 1);
await p.click("#unitBtn"); await p.waitForTimeout(100);
await p.click("#themeBtn"); await p.waitForTimeout(200);
ok("theme toggles to light", (await p.evaluate(() => document.documentElement.dataset.theme)) === "light");
if (process.env.SHOT) await p.screenshot({ path: path.join(process.env.SHOT, "weather-light.png"), fullPage: true });
await p.click("#themeBtn"); await p.waitForTimeout(100);
ok("theme toggles back to dark", (await p.evaluate(() => document.documentElement.dataset.theme)) === "dark");
const state = await p.context().storageState();
ok("state persisted", JSON.parse(state.origins[0].localStorage.find(x => x.name === "roney-weather-v1").value).locs.length === 1);
await p.context().close();

/* ---------- 4. cached forecast survives the API going dark ---------- */
console.log("offline");
apiDown = true;
// Age the cache past the refresh threshold so the app actually tries the network.
const aged = JSON.parse(JSON.stringify(state));
const ls = aged.origins[0].localStorage.find(x => x.name === "roney-weather-v1");
const S = JSON.parse(ls.value); for (const k in S.cache) S.cache[k].at = Date.now() - 3 * 3600 * 1000; ls.value = JSON.stringify(S);
p = await page({ state: aged });
const before = apiCalls;
await p.goto(BASE); await p.waitForTimeout(700);
ok("tried the network", apiCalls === before + 1);
ok("still shows the hero from cache", (await p.locator(".hero").count()) === 1);
ok("header says last forecast 3 h ago", /Last forecast 3 h ago/.test(await text(p, "#hSub")), await text(p, "#hSub"));
ok("toast explains", /last forecast/.test(await text(p, "#toast")));
// The 503 itself is logged by the browser; that's the fixture, not a bug.
const real = p.errors.filter(e => !/Failed to load resource/.test(e));
ok("no errors", real.length === 0, real.join(" | "));
await p.context().close();
apiDown = false;

/* ---------- 5. geolocation path + remove ---------- */
console.log("my location");
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, geolocation: { latitude: 36.7, longitude: -97.08 }, permissions: ["geolocation"], serviceWorkers: "block" });
p = await ctx.newPage(); p.errors = []; p.on("pageerror", e => p.errors.push(String(e)));
await p.route("**/api.open-meteo.com/**", r => r.fulfill({ json: FORECAST }));
await p.route("**/api.bigdatacloud.net/**", r => r.fulfill({ json: { city: "Ponca City", principalSubdivisionCode: "US-OK", countryCode: "US" } }));
await p.goto(BASE); await p.waitForTimeout(300);
await p.click('[data-act="geo"]'); await p.waitForTimeout(900);
ok("reverse-geocoded name", (await text(p, "#hTitle")) === "Ponca City", await text(p, "#hTitle"));
ok("forecast rendered", (await p.locator(".hero").count()) === 1);
await p.click("#locBtn"); await p.waitForTimeout(300);
ok("saved list has one, marked current", (await p.locator("#saved .pick.cur").count()) === 1);
await p.click('#saved [data-rm="0"]'); await p.waitForTimeout(300);
ok("remove empties the list", /No saved places/.test(await text(p, "#saved")));
await p.click("#sheetDone"); await p.waitForTimeout(300);
ok("back to onboarding", (await p.locator(".onb").count()) === 1);
ok("no errors", p.errors.length === 0, p.errors.join(" | "));
await ctx.close();

await browser.close(); server.close();
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(", ")}` : "\nall green");
process.exit(fails.length ? 1 : 0);
