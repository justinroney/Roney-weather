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
node tests/smoke.mjs        # ~168 checks, every network source mocked, ~20s
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

**Roofing window** (w7, sourced in w8): `roofRisk(H, i)` grades each hour
0 fine / 1 caution / 2 stop / 3 dark. The thresholds are published ones,
listed with their sources in the comment above `roofRisk` and in the
explainer: OSHA 1926.968 high wind (stop 30 mph sustained / 40 gust,
caution 20 / 30), OSHA/NOAA 30/30 lightning (storm hour stops, the next is
a caution), OSHA's wet-roof guidance plus NIOSH FACE reports (rain stops;
rain in the previous two hours or dew at first light is a caution), GAF /
Owens Corning / ARMA 40° shingle minimum (< 40° caution, ≤ 32° stop), OSHA's
proposed heat rule (heat index 90 caution, 80 noted) with the NWS 103°
danger band as the app's own stop. w9 added two more inputs: NOAA's HRRR
model (a second `forecastUrl`-style call with `models=gfs_hrrr`, 48 h, US
only, cached as `c.hrrr`; `attachAlt()` marks its wet hours onto the
blend's hourly as `alt_wet`, which `roofRisk` treats as a stop — the
verdict plans on the earlier model) and hourly `cape` (≥ 1500 J/kg is a
"storm fuel" caution). The forecast call has `past_days=1`, so hourly and
daily both start yesterday: loops over days start at `ti`, and the Surface
row sums the 24 h before `hi`. Job size is `S.roofSquares` / `S.roofCrew` /
`S.roofRate` → `roofNeed()`. `roofTimeline()` draws three days on a fixed
5 AM–9 PM axis (`TL_FROM`/`TL_TO`): hours merged into labelled blocks,
hatched for hours already gone, a now line, and the job as a dashed box
from the first workable hour; blocks are buttons that open the hour
explainer. `roofOutlook()` is the
seven-day workdays list (longest `roofWindows` run per day; "seals" = two
of the next three days ≥ 45° with weather code ≤ 2). The suite checks
every rule against these numbers — change a threshold in `roofRisk`, the
explainer table, the source comment and the test together. `roofWindows()` finds daylight
runs with nothing worse than caution; `roofPlan()` turns the run starting
now into a verdict against `S.roofHours` (GO needs 2 h of margin, CAUTION
is a fit with less or a run holding cautious hours, NO GO otherwise; the
15-minute nowcast overrides when rain is inside two hours) and picks the
best window in the next 72 h. Change a threshold in `roofRisk` and in the
explainer's rules table together.

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
