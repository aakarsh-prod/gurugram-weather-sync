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
        ├─ writes the result to data.json and commits it back to this repo
        │
        └─ GitHub Pages serves index.html, which fetches data.json on load
           and every 5 minutes thereafter, and renders the dashboard
```

`index.html` is a fully static page — no build step, no framework. It ships with a small
baked-in snapshot so it never shows a blank page, then immediately overwrites that with
live data from `data.json`.

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
