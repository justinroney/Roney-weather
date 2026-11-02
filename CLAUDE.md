# CLAUDE.md

Roney Weather: a personal weather PWA. One hand-written `index.html`, zero
dependencies, no build step — keep it that way. Sibling of
`justinroney/roney-routine-app`, same house style and the same discipline,
but a separate app: separate repo, origin, storage key (`roney-weather-v1`),
version string (`wNN`), service worker.

## Commands

```bash
npm install --no-save --no-package-lock playwright@1.49.1   # not a repo dependency
npx playwright install chromium
node tests/smoke.mjs        # ~113 checks, every network source mocked, ~15s
# Syntax-check the inline script before any commit:
python3 -c "import re;open('/tmp/w.js','w').write(max(re.findall(r'<script>(.*?)</script>',open('index.html').read(),re.S),key=len))" && node --check /tmp/w.js
```

**Deploying is pushing `main`** (Vercel auto-deploys to
https://roney-weather.vercel.app in ~30s). Every release bumps
`APP_VERSION` in index.html **and** `CACHE` in sw.js to the same `wNN` — the
suite fails if they differ. Never open a PR unless asked.

## Architecture

State is one localStorage object (`roney-weather-v1`, `schema: 1`): unit,
theme, saved places, the current index, and a per-place cache
(`{at, d, aq, alerts, alertsAt}` keyed by rounded lat,lon; pruned to saved
places). `refresh()` fetches forecast, air quality and NWS point alerts with
`Promise.allSettled` and keeps the previous copy of any part that fails;
alerts are only requested for US places (`inUS()`).

**Nothing on screen is blank or unexplained** (w6): every number has words
(`windWord`, `dewWord`, `aqiAdvice`, …), every tile has a scale bar, and
`openInfo(kind, idx)` builds the explainer sheet (`#info`) for tiles,
hours and days from `ctx()`. `daySummary()` writes the hero sentence from
the hourly codes/probabilities. Keep that bar when adding anything: a
missing value shows *why* ("Not reported", "no air-quality model covers
this spot"), never "—"; the suite greps the view for bare dashes.

Overlays (`#map`, `#alerts`) ride the history stack: `openOverlay()` pushes,
the back button pops, `route()` reads the hash — so Android's back gesture
closes them. The map is hand-rolled (`proj`/`unproj` Web Mercator, `layTiles`
moves existing `<img>` tiles rather than recreating them, radar tiles stop at
Rain Viewer's zoom 7 and are upscaled past it, warning polygons are SVG).
State-wide warnings for the map come from a second NWS call (`area=XX`,
filtered to `MAP_EVENTS`); the state code comes from `stateOf()`.
Everything is fetched once in °F/mph/inch and converted on display, so a unit
flip never refetches. Open-Meteo returns local wall-clock times with
`timezone=auto`; the app formats those strings directly and never converts
them through `Date` (the phone's zone may differ from the place's). Hourly
starts at the hour of `current.time`; today's row is matched by date.
`esc()` every piece of data before it lands in an HTML fragment.

The suite mocks Open-Meteo (forecast, air, geocoding), `api.weather.gov`,
`api.rainviewer.com`, both tile hosts, and `api.bigdatacloud.net`, and blocks
service workers in its contexts so the
mocks always see the requests. Sandboxed sessions usually can't reach the
real APIs; a real-data check is done on the phone.

Editing happens from a phone: suite green before commit, story-style commit
messages, the deployed version confirmed from the footer of the forecast.
