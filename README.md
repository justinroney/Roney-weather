# Roney Weather

**Live at https://roney-weather.vercel.app** (Vercel deploys `main`).

A personal weather app: one hand-written `index.html`, zero dependencies, no
build step. Save the places you care about (search a city, or use the phone's
location), see current conditions, the next 24 hours, and the week ahead; flip
°F/°C; the last forecast per place stays on the device so the app still
answers with no signal. Installable as its own app from Chrome (⋮ → Install
app) or Safari (Share → Add to Home Screen).

Forecasts and city search come from [Open-Meteo](https://open-meteo.com)
(free, no key). The phone's location is named via BigDataCloud's free reverse
geocoder; if that fails the place is simply "My location".

## Files

- `index.html` — the entire app: theme tokens, WMO code table, inline SVG
  icons, rendering, data fetching, the places sheet.
- `sw.js` — offline shell (network-first). `CACHE` must match `APP_VERSION`.
- `manifest.json`, `icons/` — the install surface. `icons/icon.svg` is the
  source; the PNGs were rendered from it with headless Chromium.
- `tests/smoke.mjs` — the suite. Open-Meteo is mocked at the network layer.

## Tests

```
npm install --no-save --no-package-lock playwright@1.49.1
npx playwright install chromium
node tests/smoke.mjs
```

## Releasing

Edit `index.html`, bump `APP_VERSION` (`wNN`) and `CACHE` in `sw.js` to the
same number, run the suite, commit, push `main`. Vercel deploys `main`.
