# Gurugram Weather Station

A personal commute dashboard for the DLF Phase 5 → Leena.AI (Sector 48) route in Gurugram —
hyperlocal weather from 11 Weather Union sensors, bias-corrected against Open-Meteo's regional
model, plus live Google Routes traffic and a "best time to leave" recommendation.

**Live site:** https://aakarsh-prod.github.io/gurugram-weather-sync/

## How it works

There's no server, no database, and no dependency on any device staying online. Everything
runs on GitHub's own infrastructure:

```
GitHub Actions (cron, every 30 min)
        │
        ├─ scripts/sync.mjs fetches:
        │    • Weather Union (11 stations) — always
        │    • Open-Meteo (regional forecast) — always
        │    • Google Routes "current traffic" — weekdays, 8 AM–9 PM IST, every 30 min
        │    • Google Routes "best time to leave" slot projections — weekdays,
        │      9 AM–12 PM / 2–9 PM IST, roughly hourly (budget-capped, see below)
        │
        ├─ also diffs each new reading against the previous run to track how long
        │   the current rain/wind/heat/humidity state has held (see "Ongoing
        │   conditions" below) — no extra API calls, just memory of its own past runs
        │
        ├─ writes the result to data.json and commits it back to this repo
        │
        └─ GitHub Pages serves index.html, which fetches data.json on load
           and every 5 minutes thereafter, and renders the dashboard
```

`index.html` is a fully static page — no build step, no framework. It ships with a small
baked-in snapshot so it never shows a blank page, then immediately overwrites that with
live data from `data.json`.

## Ongoing conditions (streak tracking)

Since `sync.mjs` already polls every 30 minutes, it also keeps a small memory of its own
past runs (carried inside `data.json` itself, under `conditions`) to answer "how long has
this been true" rather than just "what's true right now":

- **Rain** gets a richer tracker than the rest: a continuous wet/dry "spell", how long it's
  held, and whether that spell has been steady or on-and-off ("sporadic" — rain that stops
  and restarts within an hour counts as one on-and-off event; a proper dry spell over an
  hour resets that memory so it doesn't tag a brand-new storm as sporadic).
- **Wind, heat, and humidity** each get a simpler "how long has this bucket held" streak
  (calm/breezy/strong, cool/mild/hot, normal/humid/very-humid).
- Tracked at both **zone level** (each of the 11 stations) and **city level** (the wettest
  live rain gauge for rain; Open-Meteo's regional reading for wind/heat/humidity).
- Only non-baseline states ever show up on the dashboard — calm, mild, and normal humidity
  never earn a callout. A brief sensor outage freezes a station's streak rather than
  resetting it, so a 30-minute gap in readings doesn't wipe out a 3-hour streak.
- Each zone shows exactly **one** callout, not one per condition — rain (any sustained
  spell, however light) takes precedence over wind, heat, and humidity, since humidity is
  largely a side-effect of rain and otherwise ends up repeated identically on every zone
  during a storm. The same precedence applies citywide: once it's actively raining, the
  humidity chip drops rather than stating the obvious a second time.

## Live radar

A radar map (tiles from [RainViewer](https://www.rainviewer.com)'s free public API, on
Esri's free "World Dark Gray" basemap via [Leaflet](https://leafletjs.com) — dark by
design, no API key or account needed anywhere in this stack) sits alongside a "how to use
it" panel further down the page. It animates RainViewer's full available history (usually
~13 frames / ~2 hours at 10-min steps) plus any short nowcast it offers, centered on the
DLF Phase 5 ↔ Leena.AI corridor. This is entirely independent of `sync.mjs` — the
visitor's own browser pulls the tiles directly, so it never touches the Google Maps budget
or this site's own 30-minute refresh cycle. If RainViewer or Esri's tiles are unreachable,
the section degrades to a link to RainViewer's own live map instead of showing a broken map.

(Earlier drafts tried CARTO's dark basemap, then plain OpenStreetMap tiles with a CSS
invert filter — CARTO now requires a paid API key for its raster tiles, and the OSM tiles
occasionally served "Zoom Level Not Supported" placeholder tiles under embedded/automated
use, which OSM's own tile usage policy discourages for exactly this kind of embedding.
Esri's dark basemap avoids both problems.)

RainViewer's own radar mosaic over India tops out at native zoom 7 (it's satellite-derived
here, not ground radar, unlike the US/Europe) — requesting a closer zoom returns a "zoom
level not supported" placeholder instead of data, even during genuinely heavy rain. The map
now opens at zoom 9 and the radar layer caps itself there too (`maxZoom: 9` alongside
`maxNativeZoom: 7`), so Leaflet only ever has to stretch the real z7 tile by a small, safe
factor. Letting it stretch further — which an initial zoom-11 view required — turned out to
silently fail to paint at all in testing (a big CSS `scale()` on a raster tile, rather than
just rendering blocky, rendered nothing), which is worse than the placeholder it replaced.
The base map can still be zoomed in by hand for street detail; past zoom 9 the radar overlay
just stops updating rather than risk another silent blank.

Since RainViewer's India coverage is capped this way, the "how to use it" panel also links
out to two sources that don't have that limit: [IMD's own Doppler radar](https://mausam.imd.gov.in/imd_latest/contents/index_radar_animation.php)
out of its Palam station (real ground-based reflectivity, far finer resolution, but a single
static image refreshed every 10–15 minutes rather than an interactive layer — shown inline
as a small thumbnail, cache-busted on the same cadence) and [FloodWatch Gurgaon](https://floodwatchgurgaon.in/),
a citizen- and civic-body-sourced map of where waterlogging is actually being reported,
sector by sector — the part rain totals alone can't tell you, since that depends on
drainage as much as rainfall.

## Files

| File | Purpose |
|---|---|
| `index.html` | The dashboard itself — all HTML/CSS/JS in one file |
| `data.json` | The current live data, rewritten every ~30 min by the Action |
| `scripts/sync.mjs` | Node script that fetches the three APIs and writes `data.json` |
| `.github/workflows/sync.yml` | The scheduled GitHub Actions workflow |
| `gurugram-widget.js` | A Scriptable script for an iPad/iPhone home-screen widget (see below) |

## Keeping Google Maps costs at zero

Google Routes API bills per call once you're off the free tier, and `TRAFFIC_AWARE` requests
specifically fall under the **Pro SKU**, whose free allowance is 5,000 calls/month. `sync.mjs`
enforces several independent limits so this can never turn into a surprise bill:

1. Google Routes is only called on weekdays, within commute-relevant hours — no point checking
   traffic at 3 AM.
2. "Current traffic" (the number shown on every route card) refreshes every 30 minutes, 8 AM–9
   PM IST — that's the number actually worth checking that often. The "best time to leave"
   slot projections (which recompute 9-18 future departure times per run) are throttled to
   roughly once an hour instead, since recomputing them every 30 min added little value.
3. A running monthly call count is written into `data.json` itself (`gmapsUsage`) and checked
   before every batch of calls — hard-capped at 4,500/month. At the current cadence, actual
   usage should land around 3,900–4,050/month, so this cap is a safety net against a bad
   estimate (extra manual runs, a longer month) rather than something that triggers in normal
   operation.

Weather Union and Open-Meteo are free/unlimited and refresh every 30 minutes regardless.

## Setting up from scratch

1. Add two repository secrets (**Settings → Secrets and variables → Actions**):
   `WEATHERUNION_KEY` and `GOOGLE_ROUTES_KEY`.
2. Make the repo public (GitHub Pages' free tier requires it) and enable **Pages**
   (Settings → Pages → Source: Deploy from a branch → `main` / `/(root)`).
3. Run the "Sync weather & traffic data" workflow once manually
   (Actions tab → select it → Run workflow) to seed `data.json`.

## iPad / iPhone widget

`gurugram-widget.js` is a [Scriptable](https://scriptable.app/) script — install the free
Scriptable app, paste the script in, save it, then add a Scriptable widget to your home
screen and point it at that script. It shows current temp, next-hour rain chance, and (on
weekdays during office hours) the fastest current commute leg. See the comment at the top of
the file for exact steps.

## Notes

This started as a Claude Artifact (interactive, refreshed by a scheduled Claude session using
a browser bridge to reach APIs blocked from server-side sandboxes). It was rebuilt as this
fully static, self-hosted version so it keeps updating with zero dependency on any Claude
session, laptop, or browser staying online.
