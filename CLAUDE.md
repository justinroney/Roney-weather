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
node tests/smoke.mjs        # ~50 checks, Open-Meteo mocked, ~6s
# Syntax-check the inline script before any commit:
python3 -c "import re;open('/tmp/w.js','w').write(max(re.findall(r'<script>(.*?)</script>',open('index.html').read(),re.S),key=len))" && node --check /tmp/w.js
```

**Deploying is pushing `main`** (Vercel auto-deploys). Every release bumps
`APP_VERSION` in index.html **and** `CACHE` in sw.js to the same `wNN` — the
suite fails if they differ. Never open a PR unless asked.

## Architecture

State is one localStorage object (`roney-weather-v1`, `schema: 1`): unit,
theme, saved places, the current index, and a per-place cache of the last
good forecast (`{at, d}` keyed by rounded lat,lon; pruned to saved places).
Everything is fetched once in °F/mph/inch and converted on display, so a unit
flip never refetches. Open-Meteo returns local wall-clock times with
`timezone=auto`; the app formats those strings directly and never converts
them through `Date` (the phone's zone may differ from the place's). Hourly
starts at the hour of `current.time`; today's row is matched by date.
`esc()` every piece of data before it lands in an HTML fragment.

The suite mocks `api.open-meteo.com`, `geocoding-api.open-meteo.com` and
`api.bigdatacloud.net`, and blocks service workers in its contexts so the
mocks always see the requests. Sandboxed sessions usually can't reach the
real APIs; a real-data check is done on the phone.

Editing happens from a phone: suite green before commit, story-style commit
messages, the deployed version confirmed from the footer of the forecast.
