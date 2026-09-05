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

A repo `.nojekyll` file (empty, just needs to exist) tells GitHub Pages to publish the
branch as-is instead of running it through Jekyll first. This isn't our `sync.yml` workflow
— it's a separate, GitHub-managed "pages build and deployment" job that runs automatically
whenever Pages is set to deploy from a branch, and it occasionally fails outright with a
Docker-image-pull timeout pulling GitHub's own Jekyll build container (an infra hiccup on
GitHub's side, unrelated to anything committed here — it typically succeeds on the next
push). Since nothing here needs Jekyll's templating, `.nojekyll` skips that step — and its
failure mode — entirely.

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
static image rather than an interactive layer — shown inline as a small thumbnail). Its
caption is deliberately hedged: checking it live, IMD's own copy was running about seven
hours behind despite our fetching it fresh, so it can lag by hours rather than minutes with
no way for us to detect that automatically (the timestamp is burned into the image pixels,
not exposed as metadata) — the caption tells readers to check that printed timestamp before
trusting it over the live map above it. The second link, [FloodWatch Gurgaon](https://floodwatchgurgaon.in/),
is a citizen- and civic-body-sourced map of where waterlogging is actually being reported,
sector by sector — the part rain totals alone can't tell you, since that depends on
drainage as much as rainfall.

The frame list itself used to be fetched once, on page load, and never again — meaning a
tab left open for a while quietly fell behind RainViewer's own live site, which keeps
polling. That's the most common reason "our map and RainViewer's own site show different
rain": not different data, an older snapshot of the same data. It now refetches the frame
list every 10 minutes (skipping the refresh, not the fetch, while an animation happens to
be mid-playback so it doesn't yank the frame out from under it), the same way `data.json`
itself refreshes every 5.

### Haryana & Delhi NCR view (Tomorrow.io)

RainViewer's zoom-7 cap for India means the live map is necessarily a *wide* view — it can
show a storm sitting over Gurugram, but not much finer than "somewhere over the city."
[Tomorrow.io](https://www.tomorrow.io)'s map-tile API covers India up to zoom 12, by
blending five geostationary satellites' IR brightness temperature with forecast-model
context and terrestrial microwave links, calibrated against ground radar via ML — built
specifically to estimate rain in places (India among them) that don't share a raw radar
feed. `sync.mjs` fetches a small fixed **mosaic** — 2 tiles at zoom 6, stacked vertically —
per field (`precipitationIntensity` and `cloudCover`) each run and commits them alongside
`data.json` as `tomorrow-{field}-6-45-26.png` (north half) and `tomorrow-{field}-6-45-27.png`
(south half). The "Live radar" section shows the stitched pair once they exist, timestamped
from `data.json`'s `tomorrowRadar.time`.

The mosaic covers roughly 21.9–32.0°N, 73.1–78.75°E — all of Haryana, Delhi NCR, Chandigarh,
southern Punjab, western UP, and northern Rajasthan — at about 2.5 km/pixel. This went
through two narrower iterations first: a tight zoom-11 tile over just the DLF Phase 5 ↔
Leena.AI corridor turned out to be *too* close — Tomorrow.io's satellite-blended fields carry
real spatial resolution on the order of a few km, so a tile that small had nothing to show
variation across and just rendered as one flat, uninformative color. A single zoom-9 tile
(just the Delhi NCR core) fixed that but was still a small, arbitrarily-cropped view rather
than a real region. Going wider still to cover all of India in one shot doesn't work well
either: India straddles the fixed 90°E tile boundary at every zoom up to z1/z2, so a single
tile only fully contains it at z1 — by which point the whole tile is just 256×256 px for
*half the globe*, making India's slice of it only ~40×45 px (worse than any of the above).
Real all-India coverage would need a much larger tile grid (roughly 6 tiles at z6 up to 140+
at z7) and would have to drop to an hourly cadence to stay under the API's rate limit (below)
— a bigger change than this project's Haryana/NCR scope called for.

A bare PNG swatch by itself is close to unreadable regardless of zoom — no coastline, no
city names, nothing to anchor a solid color block to a place, and during an actively wide
storm a whole tile actually can be one flat color legitimately (not a bug). So instead of an
`<img>`, `index.html` draws each mosaic tile as its own `L.imageOverlay`, at its own precise
bounds, on a small Leaflet map using the same Esri World Dark Gray base + label layers as the
live radar map above — so city names and roads sit under the color, a uniform block can
actually be checked against the live radar/IMD thumbnail rather than just stared at, and
(unlike an early version of this) it's fully pannable/zoomable rather than locked in place.
Zooming in past the mosaic's native ~2.5 km/pixel just enlarges its pixels rather than
revealing finer detail, since it's a fixed-resolution image, not a live tile source — but the
basemap underneath keeps its own full resolution for orientation. Tomorrow.io doesn't publish
an exact value-to-color legend for these tiles, so reading them is relative (darker/more
saturated = more intense) rather than absolute.

The key is used server-side only (sent as an `apikey` header, never a URL query string, so
it never ends up in an Actions log or a committed file, and never reaches a visitor's
browser) — this is also why the map can't be a truly *live*, freely-zoomable tile layer like
RainViewer's: doing that would mean either putting the key in a URL every visitor's browser
calls directly, or sending it from client-side JS, and either way it stops being a secret the
moment it's used client-side. The free tier's real constraint is the **25-requests/hour**
cap, not the 500/day one — two sync runs can land in the same clock hour, so this mosaic
stays at 2 tiles × 2 fields = 4 requests/run (8/hour at worst), comfortably under the cap at
the existing 30-min cadence, unlike a wider grid or a live layer would be. Set it up by
creating a free account at [tomorrow.io](https://www.tomorrow.io/weather-api/) and adding the key as a repo secret
named `TOMORROW_API_KEY` (same place as the two secrets below) — everything degrades
gracefully without it: `sync.mjs` just skips the fetch and the section stays hidden.

A field that fails to fetch on a given run only hides its tile if it has never loaded
successfully before; once a tile has shown a real image, a later transient failure just
leaves that (now slightly stale) image in place — labeled "stale — latest fetch failed" next
to its timestamp — rather than yanking the tile away, which is what made a tile look like it
had randomly vanished the first time this happened.

## Golf weather (Qutab Golf Course & Karma Lakelands)

A second tab, separate from the commute dashboard, shows current conditions plus a 12-hour
outlook (temperature, rain chance/amount, wind) for two specific golf courses: [Qutab Golf
Course](https://dda.gov.in/sports/Qutab_Golf_Course) (Press Enclave Road, Lado Sarai, Delhi —
28.53063785, 77.1973041445) and [Karma Lakelands](https://www.karmalakelands.com/golf/golf-course.html)
(Sector 80, Gurugram — 28.3628194877, 76.9575145841). Both coordinates came from each course's
own GolfPass "Get Directions" map link, not a guess.

This only fetches and shows data **Friday through Sunday** (weekend golf, not weekday) — on
any other day `sync.mjs`'s `fetchGolfWeather()` returns `null` outright rather than fetching
anyway and hiding it, and `data.json`'s `golf` key is `null`. The tab explains this rather than
just sitting empty. Unlike Tomorrow.io, this uses plain [Open-Meteo](https://open-meteo.com)
(same free, unlimited, no-key API the main regional forecast already uses) called for these
two specific points, so there's no quota math to worry about here — the Friday-Sunday gate is
purely about not showing a stale weekday-irrelevant forecast, not about API limits.

## Files

| File | Purpose |
|---|---|
| `index.html` | The dashboard itself — all HTML/CSS/JS in one file |
| `data.json` | The current live data, rewritten every ~30 min by the Action |
| `scripts/sync.mjs` | Node script that fetches the APIs and writes `data.json` (and the two Tomorrow.io tiles below, if configured) |
| `tomorrow-{precipitationIntensity,cloudCover}-6-45-{26,27}.png` | 2-tile Haryana/Delhi NCR mosaic (4 files total), rewritten every ~30 min alongside `data.json` (only if `TOMORROW_API_KEY` is set) |
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

1. Add repository secrets (**Settings → Secrets and variables → Actions**):
   `WEATHERUNION_KEY` and `GOOGLE_ROUTES_KEY` (required), plus optionally `TOMORROW_API_KEY`
   for the close-up radar/cloud snapshot (see "Close-up view (Tomorrow.io)" above) — the
   dashboard works fine without it, that section just stays hidden.
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
