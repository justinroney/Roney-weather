# Roney Weather

**Live at https://roney-weather.vercel.app** (Vercel deploys `main`).

A personal weather app: one hand-written `index.html`, zero dependencies, no
build step. Installable as its own app from Chrome (⋮ → Install app) or
Safari (Share → Add to Home Screen).

What it does (w7):

- **Places** — search a city, or use the phone's location. Saved on the
  device; the last forecast per place is kept so the app answers with no signal.
- **Severe weather** — active NWS alerts for the place, led by the most
  urgent (a tornado warning pulses red at the very top), with the full text
  and the "what to do" instruction one tap away.
- **Radar & warnings map** — a hand-rolled slippy map: OpenStreetMap base,
  Rain Viewer radar loop (past two hours + a half-hour nowcast, play/scrub),
  and every live warning polygon in the state drawn on top (tornado and
  extreme in red, warnings in amber, watches in orange). Pinch, drag,
  double-tap, wheel.
- **Now** — temperature, feels-like, condition, high/low; a 15-minute rain
  strip for the next two hours ("Rain in ~30 min"); wind and gusts, humidity
  and dew point, rain chance and total, UV, air quality (US AQI with PM2.5
  and ozone), pressure and its trend, visibility and cloud cover, sunrise and
  sunset, moon phase.
- **Roofing window** — can the deck be opened now and dried in before the
  weather closes it? A GO / CAUTION / NO GO verdict with the reason ("Rain
  around 2 PM leaves 5 dry hours; you need 6"), a 48-hour strip coloured by
  risk, the factors (rain, storms, wind, temperature, daylight), a setting
  for how many hours the crew needs from tear-off to underlayment, and the
  best window in the next three days. The 15-minute nowcast overrides
  everything when rain is minutes away. Thresholds are in the explainer.
- **Ahead** — 24 hours from the current hour, and 10 days with range bars.
- **Nothing blank, everything explained** — a one-sentence day summary in
  the hero ("Rain possible around 2 PM until about 6 PM, high 63°. Tomorrow
  overcast, 58°."), an all-clear line when NWS has nothing, a scale bar on
  every tile, and a tap on any tile, hour or day opens a plain-language
  explainer: the value on its scale, what it means, what to do. Captions
  under each section say what the visuals mean; the map legend always
  shows the radar scale and either the warning colours or "no warnings in
  OK right now". Missing data says why ("no air-quality model covers this
  spot"), never a dash.
- °F/°C flips everything on screen without a refetch; light and dark.

Data: forecasts, 15-minute nowcast, air quality and city search from
[Open-Meteo](https://open-meteo.com); alerts from the
[National Weather Service](https://www.weather.gov/documentation/services-web-api)
(US only); radar from [Rain Viewer](https://www.rainviewer.com/api.html)
(free tier: zoom 7, 100 requests a minute); base map © OpenStreetMap
contributors; the phone's location is named via BigDataCloud's free reverse
geocoder. All free, no keys.

Not built, on purpose: push notifications (the phone's own Wireless
Emergency Alerts already carry tornado warnings), lightning and pollen (no
free US source). Possible next: NOAA's own higher-resolution radar imagery,
hurricane tracks from the NHC feeds, storm reports, an hourly detail sheet.

## Files

- `index.html` — the entire app: theme tokens, WMO code table, inline SVG
  icons, rendering, data fetching, the places sheet.
- `sw.js` — offline shell (network-first). `CACHE` must match `APP_VERSION`.
- `manifest.json`, `icons/` — the install surface. `icons/icon.svg` is the
  source; the PNGs were rendered from it with headless Chromium.
- `tests/smoke.mjs` — the suite (~123 checks). Open-Meteo, NWS, Rain Viewer
  and the map tiles are all mocked at the network layer.

## Tests

```
npm install --no-save --no-package-lock playwright@1.49.1
npx playwright install chromium
node tests/smoke.mjs
```

## Releasing

Edit `index.html`, bump `APP_VERSION` (`wNN`) and `CACHE` in `sw.js` to the
same number, run the suite, commit, push `main`. Vercel deploys `main`.
