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
const hourly = { time: [], temperature_2m: [], apparent_temperature: [], precipitation_probability: [], precipitation: [], weather_code: [], is_day: [], uv_index: [], pressure_msl: [], wind_speed_10m: [], wind_gusts_10m: [], relative_humidity_2m: [], dew_point_2m: [] };
for (let i = 0; i < 48; i++) {
  const d = i < 24 ? "2026-11-01" : "2026-11-02", h = i % 24;
  hourly.time.push(d + "T" + String(h).padStart(2, "0") + ":00");
  hourly.temperature_2m.push(48 + 14 * Math.sin((h - 6) / 24 * Math.PI * 2) + (i >= 24 ? -3 : 0));
  hourly.precipitation_probability.push(h >= 14 && h <= 17 ? 40 : 0);
  hourly.weather_code.push(h >= 14 && h <= 17 ? 61 : h < 10 ? 2 : 1);
  hourly.is_day.push(h >= 8 && h < 18 ? 1 : 0);
  hourly.uv_index.push(h >= 10 && h <= 15 ? 4 : 1);
  hourly.pressure_msl.push(1012 + i * 0.6);       // rising 1.8 hPa over three hours
  hourly.apparent_temperature.push(hourly.temperature_2m[i] - 3);
  hourly.precipitation.push(h >= 14 && h <= 17 ? 0.05 : 0);
  hourly.wind_speed_10m.push(8 + (h % 5));
  hourly.wind_gusts_10m.push(8 + (h % 5) + 9);
  hourly.relative_humidity_2m.push(60);
  hourly.dew_point_2m.push(hourly.temperature_2m[i] - 12);
}
// 15-minute nowcast: dry for 30 min, then rain for an hour.
const minutely_15 = { time: [], precipitation: [], snowfall: [] };
for (let i = 0; i < 16; i++) {
  const mins = 9 * 60 + i * 15;
  minutely_15.time.push("2026-11-01T" + String(Math.floor(mins / 60)).padStart(2, "0") + ":" + String(mins % 60).padStart(2, "0"));
  minutely_15.precipitation.push(i >= 2 && i < 6 ? 0.04 * (i - 1) : 0);
  minutely_15.snowfall.push(0);
}
const DAYS = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10"];
const daily = {
  time: DAYS.map(d => "2026-11-" + d),
  weather_code: [61, 3, 1, 0, 95, 71, 2, 2, 3, 0],
  temperature_2m_max: [62.6, 58, 61, 66, 59, 41, 47, 50, 54, 57],
  temperature_2m_min: [41.2, 39, 37, 44, 46, 28, 30, 31, 35, 38],
  sunrise: daily_t("07:48"), sunset: daily_t("18:32"),
  precipitation_probability_max: [40, 10, 0, 0, 80, 70, 5, 0, 10, 0],
  precipitation_sum: [0.12, 0, 0, 0, 0.6, 0.3, 0, 0, 0, 0],
  daylight_duration: DAYS.map((_, i) => 38640 - i * 100),
  wind_speed_10m_max: [14, 12, 10, 9, 22, 18, 11, 10, 9, 8], wind_gusts_10m_max: [24, 20, 18, 15, 41, 30, 19, 17, 15, 14],
  uv_index_max: [4, 4, 5, 5, 3, 2, 4, 4, 4, 5],
};
function daily_t(hm) { return DAYS.map(d => "2026-11-" + d + "T" + hm); }
const FORECAST = {
  latitude: 36.7, longitude: -97.08, timezone: "America/Chicago", timezone_abbreviation: "CST",
  current: { time: NOW, temperature_2m: 57.4, relative_humidity_2m: 61, apparent_temperature: 54.1, is_day: 1,
    precipitation: 0, weather_code: 2, wind_speed_10m: 9.3, wind_gusts_10m: 18.1, wind_direction_10m: 320,
    dew_point_2m: 44.2, pressure_msl: 1018.4, visibility: 16000, cloud_cover: 45 },
  hourly, daily, minutely_15,
};
const AIR = { current: { time: NOW, us_aqi: 42, pm2_5: 9.4, pm10: 14, ozone: 61, nitrogen_dioxide: 8 } };
// One tornado warning covering the point (with a polygon) and one advisory without geometry.
const POLY = [[[-97.3, 36.5], [-96.8, 36.5], [-96.8, 36.95], [-97.3, 36.95], [-97.3, 36.5]]];
const ALERTS = { features: [
  { id: "urn:a1", geometry: null, properties: { id: "urn:a1", event: "Wind Advisory", severity: "Minor", headline: "Wind Advisory until 6 PM",
    description: "Winds 25 to 35 mph.", instruction: "Secure loose objects.", areaDesc: "Kay County", onset: "2026-11-01T06:00:00-05:00", ends: "2026-11-01T18:00:00-05:00", senderName: "NWS Norman OK" } },
  { id: "urn:t1", geometry: { type: "Polygon", coordinates: POLY }, properties: { id: "urn:t1", event: "Tornado Warning", severity: "Extreme",
    headline: "Tornado Warning issued November 1 at 9:02AM CDT until November 1 at 9:45AM CDT by NWS Norman OK",
    description: "At 902 AM CDT, a severe thunderstorm capable of producing a tornado was located near Ponca City, moving northeast at 35 mph.",
    instruction: "TAKE COVER NOW! Move to a basement or an interior room on the lowest floor of a sturdy building.",
    areaDesc: "Kay, OK", onset: "2026-11-01T09:02:00-05:00", ends: "2026-11-01T09:45:00-05:00", senderName: "NWS Norman OK" } },
] };
const RADAR_JSON = { version: "2.0", generated: 1793525000, host: "https://tilecache.rainviewer.com",
  radar: { past: [...Array(12)].map((_, i) => ({ time: 1793520000 + i * 600, path: "/v2/radar/hash" + i })),
           nowcast: [0, 1, 2].map(i => ({ time: 1793527200 + i * 600, path: "/v2/radar/nowcast" + i })) } };
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
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
let apiCalls = 0, apiDown = false, alertCalls = [], baseTiles = 0, radarTiles = 0;
async function page(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: opts.scheme || "dark",
    storageState: opts.state, serviceWorkers: "block" });
  const p = await ctx.newPage();
  p.errors = [];
  p.on("pageerror", e => p.errors.push(String(e)));
  p.on("console", m => { if (m.type() === "error") p.errors.push(m.text()); });
  await p.route("**/api.open-meteo.com/**", r => { apiCalls++; return apiDown ? r.fulfill({ status: 503, body: "down" })
    : r.fulfill({ json: opts.noMinutely ? { ...FORECAST, minutely_15: undefined } : FORECAST }); });
  await p.route("**/geocoding-api.open-meteo.com/**", r => r.fulfill({ json: GEO }));
  await p.route("**/api.bigdatacloud.net/**", r => r.fulfill({ json: { city: "Ponca City", principalSubdivisionCode: "US-OK", countryCode: "US" } }));
  await mockExtras(p, opts.noAlerts);
  return p;
}
async function mockExtras(p, noAlerts) {
  p.noAlerts = !!noAlerts;
  await p.route("**/air-quality-api.open-meteo.com/**", r => r.fulfill({ json: AIR }));
  await p.route("**/api.weather.gov/**", r => { alertCalls.push(r.request().url()); return r.fulfill({ json: p.noAlerts ? { features: [] } : ALERTS }); });
  await p.route("**/api.rainviewer.com/**", r => r.fulfill({ json: RADAR_JSON }));
  await p.route("**/tile.openstreetmap.org/**", r => { baseTiles++; return r.fulfill({ contentType: "image/png", body: PNG }); });
  await p.route("**/tilecache.rainviewer.com/**", r => { radarTiles++; return r.fulfill({ contentType: "image/png", body: PNG }); });
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
ok("nine tiles, all tappable buttons", (await p.locator("button.tile").count()) === 9);
ok("every tile carries a scale bar", (await p.locator(".tile .m").count()) === 9);
ok("day summary reads like a sentence", (await text(p, "#heroSum")) === "Partly cloudy now. Rain possible around 2 PM until about 6 PM, high 63°. Tomorrow overcast, 58°.", await text(p, "#heroSum"));
ok("captions explain the tiles, hours and days", (await p.locator(".legend").count()) >= 4 && /chance of rain that hour/.test(await text(p, "#view")) && /low to its high/.test(await text(p, "#view")));
ok("no bare dashes anywhere", !/(^|\s)—(\s|$)/.test(await text(p, "#view")));
ok("wind tile", /9 mph/.test(await text(p, ".tile:nth-child(1) .v")) && /NW · gusts 18$/.test(await text(p, ".tile:nth-child(1) .s")));
ok("rain tile", (await text(p, ".tile:nth-child(3) .v")) === "40%" && /0.12 in today/.test(await text(p, ".tile:nth-child(3) .s")));
ok("uv tile reads the current hour, with advice", (await text(p, ".tile:nth-child(4) .v")) === "1" && /Low · no protection needed/.test(await text(p, ".tile:nth-child(4) .s")));
ok("humidity tile has the dew point", /dew point 44°/.test(await text(p, ".tile:nth-child(2) .s")));
ok("air tile 42 · Good with PM2.5", (await text(p, ".tile.aq .v")) === "42 · Good" && /PM2.5 9/.test(await text(p, ".tile.aq .s")));
ok("pressure in inHg, rising · clearing", (await text(p, ".tile:nth-child(6) .v")) === "30.07 inHg" && (await text(p, ".tile:nth-child(6) .s")) === "rising · clearing");
ok("visibility 10 mi, clear · partly cloudy", (await text(p, ".tile:nth-child(7) .v")) === "10 mi" && (await text(p, ".tile:nth-child(7) .s")) === "Clear · partly cloudy");
ok("sun tile with day length", (await text(p, ".tile:nth-child(8) .v")) === "7:48 AM" && /sets 6:32 PM · 10h 44m light/.test(await text(p, ".tile:nth-child(8) .s")), await text(p, ".tile:nth-child(8) .s"));
ok("moon tile has a phase name", /moon|crescent|quarter|gibbous/i.test(await text(p, ".tile:nth-child(9) .s")));
ok("nowcast: rain in ~30 min", (await text(p, "#nowcast .t span")) === "Rain in ~30 min", await text(p, "#nowcast .t span"));
ok("nowcast has 8 bars, 4 wet", (await p.locator(".ncbars i").count()) === 8 && (await p.locator(".ncbars i:not(.dry)").count()) === 4);
ok("alert banner leads with the tornado warning", (await text(p, ".alertbar b")) === "Tornado Warning" && /Until 9:45 AM · \+1 more/.test(await text(p, ".alertbar small")), await text(p, ".alertbar small"));
ok("banner is the first thing in view", await p.locator("#view > :first-child").evaluate(e => e.classList.contains("alertbar")));
ok("alerts fetched by point", alertCalls.some(u => /alerts\/active\?point=36\.7070%2C-97\.0856/.test(u)), alertCalls.join(" "));
ok("map button counts the warning area", /1 warning area on the map/.test(await text(p, ".mapbtn small")));
ok("roofing defers to the nowcast when rain is minutes away", (await text(p, "#roofHead")) === "Rain in about 30 minutes. Keep the deck covered.", await text(p, "#roofHead"));

/* ---------- 2b. explainers ---------- */
console.log("explainers");
await p.click(".tile.aq"); await p.waitForTimeout(350);
ok("air explainer opens with the band and a meter", await p.locator("#info").evaluate(e => e.classList.contains("on")) && (await text(p, "#infoT")) === "Air quality" && /Good/.test(await text(p, "#info .ibig")) && (await p.locator("#info .meter").count()) === 1);
ok("air explainer says what to do and lists pollutants", /clean/.test(await text(p, "#infoB")) && /PM2\.5/.test(await text(p, "#infoB")) && /Ozone/.test(await text(p, "#infoB")));
await p.click("#infoDone"); await p.waitForTimeout(300);
ok("done closes it", !(await p.locator("#info").evaluate(e => e.classList.contains("on"))));
await p.click('[data-info="pressure"]'); await p.waitForTimeout(300);
ok("pressure explainer explains the trend", /clearing, settled weather/.test(await text(p, "#infoB")) && /\+0\.08 inHg/.test(await text(p, "#infoB")), await text(p, "#infoB"));
await p.click("#scrim"); await p.waitForTimeout(300);
await p.click('[data-info="sun"]'); await p.waitForTimeout(300);
ok("sun explainer counts daylight left", /9 h 20 min of daylight left/.test(await text(p, "#infoB")), await text(p, "#infoB"));
await p.click("#infoDone"); await p.waitForTimeout(200);
await p.click(".hr:nth-child(6)"); await p.waitForTimeout(300);
ok("hour explainer: 2 PM with rain details", (await text(p, "#infoT")) === "2 PM · Today" && /40% · rain possible/.test(await text(p, "#infoB")) && /0\.05 in/.test(await text(p, "#infoB")), await text(p, "#infoT") + " " + await text(p, "#infoB"));
await p.click("#infoDone"); await p.waitForTimeout(200);
await p.click(".day:nth-child(5)"); await p.waitForTimeout(300);
ok("day explainer: Thursday with wind and sun", /Thursday/.test(await text(p, "#infoT")) && /Plan on rain/.test(await text(p, "#infoB")) && /gusts 41 mph/.test(await text(p, "#infoB")), await text(p, "#infoT"));
await p.click("#infoDone"); await p.waitForTimeout(200);
ok("no errors", p.errors.length === 0, p.errors.join(" | "));
ok("24 hourly cells", (await p.locator(".hr").count()) === 24);
ok("first hourly is Now at 9 AM", (await text(p, ".hr.now .t")) === "Now" && (await text(p, ".hr:nth-child(2) .t")) === "10 AM");
ok("rain chance shows at 2 PM", (await text(p, ".hr:nth-child(6) .p")) === "40%");
ok("10 daily rows", (await p.locator(".day").count()) === 10);
ok("today labelled", (await text(p, ".day:first-child .n")) === "Today");
ok("days aside names the state", /Oklahoma, US/.test(await p.locator(".sec-label .aside").last().innerText()));
ok("updated just now", /Updated just now/.test(await text(p, "#hSub")), await text(p, "#hSub"));
ok("no errors", p.errors.length === 0, p.errors.join(" | "));
if (process.env.SHOT) await p.screenshot({ path: path.join(process.env.SHOT, "weather-dark.png"), fullPage: true });

/* ---------- 3. units + theme ---------- */
console.log("units + theme");
await p.click("#unitBtn"); await p.waitForTimeout(200);
ok("hero flips to 14°C", (await text(p, "#heroTemp")).replace(/\s/g, "") === "14°C", await text(p, "#heroTemp"));
ok("wind flips to km/h", /15 km\/h/.test(await text(p, ".tile:nth-child(1) .v")));
ok("rain flips to mm", /3 mm today/.test(await text(p, ".tile:nth-child(3) .s")));
ok("pressure flips to hPa", (await text(p, ".tile:nth-child(6) .v")) === "1018 hPa");
ok("visibility flips to km", (await text(p, ".tile:nth-child(7) .v")) === "10+ km");
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

/* ---------- 2c. roofing window ---------- */
console.log("roofing");
// Same saved place, empty cache, and no 15-minute data: the hourly forecast alone decides.
const bare = JSON.parse(JSON.stringify(state));
{ const ls = bare.origins[0].localStorage.find(x => x.name === "roney-weather-v1"); const S = JSON.parse(ls.value); S.cache = {}; ls.value = JSON.stringify(S); }
p = await page({ state: bare, noMinutely: true });
await p.goto(BASE); await p.waitForTimeout(600);
ok("roofing card present with a verdict", (await p.locator("#roof").count()) === 1 && (await p.locator("#roofVerdict").innerText()).replace(/\s/g, "") === "NOGO");
ok("headline counts the dry hours against the need", (await text(p, "#roofHead")) === "Not enough time. Rain around 2 PM leaves 5 dry hours; you need 6.", await text(p, "#roofHead"));
ok("48-hour strip, now outlined, red from 2 PM, grey at night", (await p.locator("#roofStrip i").count()) === 39 && (await p.locator("#roofStrip i.now").count()) === 1
  && await p.locator("#roofStrip i:nth-child(6)").evaluate(e => e.classList.contains("r2")) && await p.locator("#roofStrip i:nth-child(12)").evaluate(e => e.classList.contains("r3")));
ok("factor rows: rain, surface, storms, wind, temp, daylight", (await p.locator(".rf").count()) === 6 && /rain from 2 PM \(5 h away\)/.test(await text(p, ".rooffacts")) && /above the 40° shingle minimum/.test(await text(p, ".rooffacts")) && /of light left/.test(await text(p, ".rooffacts")));
ok("wind and surface rows cite their sources", /under OSHA's 30 mph line/.test(await text(p, ".rooffacts")) && /dry · no rain in the last two hours/.test(await text(p, ".rooffacts")));
// The grading rules themselves, hour by hour, against the published thresholds.
const grade = await p.evaluate(() => {
  const base = n => ({ time: Array(n).fill("2026-11-01T12:00"), temperature_2m: Array(n).fill(60), apparent_temperature: Array(n).fill(60), dew_point_2m: Array(n).fill(40),
    precipitation_probability: Array(n).fill(0), precipitation: Array(n).fill(0), weather_code: Array(n).fill(1), is_day: Array(n).fill(1), wind_speed_10m: Array(n).fill(5), wind_gusts_10m: Array(n).fill(8) });
  const t = (mut, i = 2) => { const H = base(4); mut(H); const r = roofRisk(H, i); return r.lvl + ":" + r.why; };
  return {
    wind30: t(H => { H.wind_speed_10m[2] = 30; }), gust40: t(H => { H.wind_gusts_10m[2] = 40; }), wind20: t(H => { H.wind_speed_10m[2] = 20; }), gust30: t(H => { H.wind_gusts_10m[2] = 30; }), wind19: t(H => { H.wind_speed_10m[2] = 19; H.wind_gusts_10m[2] = 29; }),
    thunder: t(H => { H.weather_code[2] = 95; }), afterThunder: t(H => { H.weather_code[1] = 95; }),
    rain50: t(H => { H.precipitation_probability[2] = 50; }), rain49: t(H => { H.precipitation_probability[2] = 49; }), rain24: t(H => { H.precipitation_probability[2] = 24; }), amount: t(H => { H.precipitation[2] = 0.02; }),
    wetDeck: t(H => { H.weather_code[0] = 61; }), dew: t(H => { H.is_day[0] = 0; H.dew_point_2m[2] = 58; }), noDewMidday: t(H => { H.dew_point_2m[2] = 58; }),
    freeze: t(H => { H.temperature_2m[2] = 32; }), cold: t(H => { H.temperature_2m[2] = 39; }), forty: t(H => { H.temperature_2m[2] = 40; }),
    heat90: t(H => { H.apparent_temperature[2] = 90; }), heat103: t(H => { H.apparent_temperature[2] = 103; }), heat85: t(H => { H.apparent_temperature[2] = 85; }),
    dark: t(H => { H.is_day[2] = 0; }),
  };
});
const expect = { wind30: "2:wind", gust40: "2:wind", wind20: "1:gusts", gust30: "1:gusts", wind19: "0:", thunder: "2:thunderstorms", afterThunder: "1:the half hour after thunder",
  rain50: "2:rain", rain49: "1:a rain chance", rain24: "0:", amount: "2:rain", wetDeck: "1:a wet deck", dew: "1:dew", noDewMidday: "0:", freeze: "2:freezing", cold: "1:cold", forty: "0:",
  heat90: "1:heat", heat103: "2:dangerous heat", heat85: "0:", dark: "3:dark" };
for (const k of Object.keys(expect)) ok("rule · " + k + " → " + expect[k], grade[k] === expect[k], grade[k]);
ok("best window is tomorrow morning, tight fit", /Best window:.*Mon 8 AM to 2 PM, 6 dry hours.*stopped by rain/.test(await text(p, "#roofBest")), await text(p, "#roofBest"));
await p.click('[data-roof="4"]'); await p.waitForTimeout(300);
ok("4 hours to dry in → caution, 1 hour of margin", (await p.locator("#roofVerdict").innerText()).replace(/\s/g, "") === "CAUTION" && /Tight\. 5 dry hours until rain around 2 PM, you need 4; 1 hour of margin\./.test(await text(p, "#roofHead")), await text(p, "#roofHead"));
ok("setting persists", JSON.parse(await p.evaluate(() => localStorage.getItem("roney-weather-v1"))).roofHours === 4);
await p.click(".roof-head"); await p.waitForTimeout(300);
ok("roofing explainer lists the rules with their sources", (await text(p, "#infoT")) === "Roofing window" && /Stop: lightning/.test(await text(p, "#infoB")) && /1926\.968/.test(await text(p, "#infoB")) && /GAF, Owens Corning, ARMA/.test(await text(p, "#infoB")));
ok("fourteen source links, all external and new-tab", (await p.locator("#infoB .src a").count()) === 14 && await p.locator("#infoB .src a").evaluateAll(as => as.every(a => /^https:\/\//.test(a.href) && a.target === "_blank" && /noopener/.test(a.rel))));
await p.click("#infoDone"); await p.waitForTimeout(200);
await p.click('[data-roof="6"]'); await p.waitForTimeout(200);
ok("no errors", p.errors.length === 0, p.errors.join(" | "));
if (process.env.SHOT) await p.locator("#roof").screenshot({ path: path.join(process.env.SHOT, "weather-roof.png") });
await p.context().close();

/* ---------- 3b. the alerts screen ---------- */
console.log("alerts");
p = await page({ state });
await p.goto(BASE); await p.waitForTimeout(500);
await p.click(".alertbar"); await p.waitForTimeout(300);
ok("alerts overlay opens on #alerts", !(await p.locator("#alertsOvl").isHidden()) && (await p.evaluate(() => location.hash)) === "#alerts");
ok("two alerts, tornado first and open", (await p.locator("#alertsBody details").count()) === 2
  && (await text(p, "#alertsBody details:first-child summary b")) === "Tornado Warning"
  && await p.locator("#alertsBody details:first-child").evaluate(e => e.open));
ok("instruction shown under What to do", /TAKE COVER NOW/.test(await text(p, "#alertsBody details:first-child .body")));
ok("severity label", (await p.locator("#alertsBody details:first-child .sev").textContent()) === "Extreme");
ok("advisory without geometry still listed", (await text(p, "#alertsBody details:nth-child(2) summary b")) === "Wind Advisory");
await p.click("#alertsOvl [data-back]"); await p.waitForTimeout(300);
ok("back closes the overlay and clears the hash", await p.locator("#alertsOvl").isHidden() && (await p.evaluate(() => location.hash)) === "");
ok("no errors", p.errors.length === 0, p.errors.join(" | "));

/* ---------- 3c. the radar map ---------- */
console.log("radar map");
baseTiles = 0; radarTiles = 0; alertCalls = [];
await p.click(".mapbtn"); await p.waitForTimeout(900);
ok("map overlay opens on #map", !(await p.locator("#mapOvl").isHidden()) && (await p.evaluate(() => location.hash)) === "#map");
ok("title names the place", (await text(p, "#mapTitle")) === "Radar · Ponca City");
ok("base tiles requested", baseTiles > 0, String(baseTiles));
ok("radar tiles requested", radarTiles > 0, String(radarTiles));
ok("11 frames: 8 past + 3 nowcast", (await p.locator("#mapRadar .fr").count()) === 11 && (await p.locator("#frameSl").getAttribute("max")) === "10");
ok("opens on the latest observed frame", (await p.locator("#frameSl").inputValue()) === "7" && !/\+/.test(await text(p, "#frameT")));
ok("only one frame visible", (await p.locator("#mapRadar .fr:not([hidden])").count()) === 1);
ok("state-wide warnings fetched", alertCalls.some(u => /area=OK/.test(u) && /Tornado\+Warning/.test(u)), alertCalls.join(" "));
ok("tornado polygon drawn", (await p.locator("#mapSvg path.crit").count()) === 1);
ok("place marker drawn", (await p.locator("#mapSvg .me").count()) === 1);
ok("legend explains radar and the tornado tone", /Radar: light → heavy/.test(await text(p, "#mapLegend")) && /Tornado/.test(await text(p, "#mapLegend")));
ok("first-open hint", /Drag to pan/.test(await text(p, "#mapMsg")));
const radarBefore = radarTiles;
await p.click("#zin"); await p.waitForTimeout(300);
ok("zoom in past the radar cap upscales instead of refetching nothing", (await p.evaluate(() => document.querySelector("#mapRadar .fr img").style.width)) === "512px");
ok("zoom keeps the marker on screen", await p.locator("#mapSvg .me").evaluate((e, W) => { const x = +e.getAttribute("cx"); return x > 0 && x < W; }, 390));
await p.click("#playBtn"); await p.waitForTimeout(1500);
ok("play advances frames", (await p.locator("#frameSl").inputValue()) !== "7");
ok("pause button while playing", (await p.locator("#playBtn").getAttribute("aria-label")) === "Pause radar loop");
await p.click("#playBtn");
await p.locator("#frameSl").fill("10"); await p.locator("#frameSl").dispatchEvent("input"); await p.waitForTimeout(100);
ok("last frame is the +30 min nowcast", /\+30 min/.test(await text(p, "#frameT")), await text(p, "#frameT"));
if (process.env.SHOT) await p.screenshot({ path: path.join(process.env.SHOT, "weather-map.png") });
await p.mouse.move(195, 400); await p.mouse.down(); await p.mouse.move(255, 430, { steps: 4 }); await p.mouse.up(); await p.waitForTimeout(200);
ok("drag pans the map", await p.locator("#mapSvg .me").evaluate(e => Math.abs(+e.getAttribute("cx") - 195) > 30));
await p.click("#zhome"); await p.waitForTimeout(200);
ok("home recentres", await p.locator("#mapSvg .me").evaluate(e => Math.abs(+e.getAttribute("cx") - 195) < 2));
await p.click("#mapOvl [data-back]"); await p.waitForTimeout(300);
ok("back closes the map", await p.locator("#mapOvl").isHidden());
ok("no errors", p.errors.length === 0, p.errors.join(" | "));
await p.context().close();

/* ---------- 3d. a quiet day: no alerts, no minute data — still nothing blank ---------- */
console.log("quiet day");
p = await page({ state: bare, noAlerts: true, noMinutely: true });
await p.goto(BASE); await p.waitForTimeout(600);
ok("no banner, an all-clear line instead", (await p.locator(".alertbar").count()) === 0 && /No active weather alerts/.test(await text(p, ".allclear")) && /checked just now/.test(await text(p, ".allclear")));
ok("nowcast explains its absence", /Minute-by-minute rain isn't available here/.test(await text(p, "#nowcast")));
ok("map button still explains itself", /Past two hours, next half hour/.test(await text(p, ".mapbtn small")));
await p.click(".mapbtn"); await p.waitForTimeout(800);
ok("map legend says no warnings in OK", /No warnings in OK right now/.test(await text(p, "#mapLegend")), await text(p, "#mapLegend"));
ok("no errors", p.errors.length === 0, p.errors.join(" | "));
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
await mockExtras(p);
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
