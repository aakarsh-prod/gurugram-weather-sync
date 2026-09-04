// Fetches Weather Union + Open-Meteo (always) and Google Routes traffic/best-time-to-leave
// (weekdays only, gated further to specific IST windows), then writes data.json for the
// static dashboard to read. Runs on GitHub Actions — real server-side network, no browser,
// no laptop dependency.
import fs from "node:fs/promises";

const WEATHERUNION_KEY = process.env.WEATHERUNION_KEY;
const GOOGLE_ROUTES_KEY = process.env.GOOGLE_ROUTES_KEY;
const DATA_PATH = "data.json";

const IST_OFFSET_MS = 5.5 * 60 * 60000;
function nowIst() {
  return new Date(Date.now() + IST_OFFSET_MS);
}
function istDate() {
  return nowIst().toISOString().slice(0, 10);
}
function istHM() {
  const d = nowIst();
  return { hh: d.getUTCHours(), mm: d.getUTCMinutes(), weekday: d.getUTCDay() }; // 0=Sun..6=Sat
}
function istWeekdayName() {
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return names[istHM().weekday];
}
function isWeekday() {
  const w = istHM().weekday;
  return w >= 1 && w <= 5;
}
function inWindow(startHH, endHH) {
  const { hh, mm } = istHM();
  const mins = hh * 60 + mm;
  return mins >= startHH * 60 && mins < endHH * 60;
}

const STATIONS_META = [
  { id: "sector-53", name: "DLF Phase 5, Sector 53", tag: "Golf Course Rd · home", locality_id: "ZWL003118", routes: ["forward", "return-subhash", "return-ext"] },
  { id: "sector-43", name: "Paras Hospital, Sector 43", tag: "Sushant Lok-I", lat: 28.4645, lon: 77.0870, routes: ["forward", "return-subhash"] },
  { id: "sector-48", name: "Leena.AI Office, Sector 48", tag: "Welldon Techpark", lat: 28.4108, lon: 77.0576, routes: ["forward", "return-subhash", "return-ext"] },
  { id: "sector-49", name: "Sispal Vihar, Sector 49", tag: "Golf Course Ext approach", lat: 28.4180, lon: 77.0680, routes: ["forward", "return-ext"] },
  { id: "sector-54", name: "Sector 54 corridor", tag: "Golf Course Ext Rd", lat: 28.4295, lon: 77.1010, routes: ["return-ext"] },
  { id: "sector-50", name: "Good Earth / Mayfield Garden, Sector 50", tag: "Golf Course Ext Rd", lat: 28.4230, lon: 77.0620, routes: ["forward", "return-ext"] },
  { id: "sector-15", name: "Sector 15, Gurugram", tag: "Part II", locality_id: "ZWL006287", routes: [] },
  { id: "sector-52", name: "Sector 52, Gurugram", tag: "Nirvana Country", locality_id: "ZWL008401", routes: [] },
  { id: "sector-10", name: "Sector 10, Gurugram", tag: "Old Gurugram", locality_id: "ZWL001073", routes: [] },
  { id: "sector-51", name: "Sector 51, Gurugram", tag: "rain gauge only", locality_id: "ZWL004159", routes: [] },
  { id: "sector-47", name: "Sector 47, Gurugram", tag: "Sohna Road", locality_id: "ZWL005762", routes: [] },
];

const COMPASS = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
function toCompass(deg) {
  if (deg === null || deg === undefined) return null;
  return COMPASS[Math.round(deg / 22.5) % 16];
}

async function fetchWeatherUnion(station) {
  const base = "https://www.weatherunion.com/gw/weather/external/v0/";
  const url = station.locality_id
    ? `${base}get_locality_weather_data?locality_id=${station.locality_id}`
    : `${base}get_weather_data?latitude=${station.lat}&longitude=${station.lon}`;
  try {
    const res = await fetch(url, { headers: { "x-zomato-api-key": WEATHERUNION_KEY } });
    if (!res.ok) return { ...station, status: "offline", temperature: null, humidity: null, wind_speed: null, wind_dir: null, rain_intensity: null, rain_accumulation: null, pm10: null, pm25: null };
    const json = await res.json();
    const d = json.locality_weather_data || {};
    const hasTemp = d.temperature !== undefined && d.temperature !== null;
    const hasRain = d.rain_accumulation !== undefined && d.rain_accumulation !== null;
    // A station can report neither temperature nor rain (e.g. a degraded/misconfigured
    // sensor) -- that's a real "offline" station, not a "rain gauge only" one. Getting this
    // classification right matters: the front-end trusts "rain_only" to always carry a real
    // rain_accumulation number, and a bad guess here previously crashed the whole render.
    const status = hasTemp ? "ok" : hasRain ? "rain_only" : "offline";
    return {
      id: station.id, name: station.name, tag: station.tag, routes: station.routes,
      temperature: hasTemp ? d.temperature : null,
      humidity: hasTemp ? d.humidity : null,
      wind_speed: hasTemp && d.wind_speed !== undefined ? d.wind_speed * 3.6 : null,
      wind_dir: hasTemp ? toCompass(d.wind_direction) : null,
      rain_intensity: hasRain ? (d.rain_intensity ?? 0) : null,
      rain_accumulation: hasRain ? d.rain_accumulation : null,
      pm10: d.aqi_pm_10 ?? null,
      pm25: d.aqi_pm_2_point_5 ?? null,
      status,
    };
  } catch (e) {
    return { id: station.id, name: station.name, tag: station.tag, routes: station.routes, status: "offline", temperature: null, humidity: null, wind_speed: null, wind_dir: null, rain_intensity: null, rain_accumulation: null, pm10: null, pm25: null };
  }
}

async function fetchOpenMeteo() {
  const url = "https://api.open-meteo.com/v1/forecast?latitude=28.4595&longitude=77.0266&current=temperature_2m,relative_humidity_2m,precipitation,pressure_msl,wind_speed_10m,wind_direction_10m,weather_code&hourly=temperature_2m,precipitation_probability,precipitation,relative_humidity_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max&timezone=Asia%2FKolkata&forecast_days=3";
  const res = await fetch(url);
  const j = await res.json();
  const nowIdx = j.hourly.time.findIndex(t => t.slice(11, 16) === j.current.time.slice(11, 16));
  const startIdx = nowIdx >= 0 ? nowIdx : 0;
  const hourly = [];
  for (let i = startIdx; i < Math.min(startIdx + 7, j.hourly.time.length); i++) {
    hourly.push({ t: j.hourly.time[i].slice(11, 16), temp: j.hourly.temperature_2m[i], pop: j.hourly.precipitation_probability[i], code: j.hourly.weather_code[i] });
  }
  const dayLabels = ["Today", "Tomorrow"];
  const daily = j.daily.time.map((date, i) => {
    const label = i < 2 ? dayLabels[i] : new Date(date).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
    return { date, label, code: j.daily.weather_code[i], tmax: j.daily.temperature_2m_max[i], tmin: j.daily.temperature_2m_min[i], precip_sum: j.daily.precipitation_sum[i], pop_max: j.daily.precipitation_probability_max[i] };
  });
  return {
    lat: 28.4595, lon: 77.0266,
    current: { time: j.current.time, temp: j.current.temperature_2m, humidity: j.current.relative_humidity_2m, precip: j.current.precipitation, pressure: j.current.pressure_msl, wind_speed: j.current.wind_speed_10m, wind_dir: j.current.wind_direction_10m, code: j.current.weather_code },
    hourly, daily,
  };
}

const ROUTE_DEFS = {
  forward: { origin: "DLF Phase 5, Sector 53, Gurugram, Haryana", intermediates: ["Paras Hospital, Sector 43, Gurugram, Haryana", "Good Earth, Sector 50, Gurugram, Haryana", "Sispal Vihar, Sector 49, Gurugram, Haryana"], destination: "Welldon Techpark, Sector 48, Gurugram, Haryana" },
  "return-subhash": { origin: "Welldon Techpark, Sector 48, Gurugram, Haryana", intermediates: ["Paras Hospital, Sector 43, Gurugram, Haryana"], destination: "DLF Phase 5, Sector 53, Gurugram, Haryana" },
  "return-ext": { origin: "Welldon Techpark, Sector 48, Gurugram, Haryana", intermediates: ["Sispal Vihar, Sector 49, Gurugram, Haryana", "Good Earth, Sector 50, Gurugram, Haryana", "Sector 54, Golf Course Extension Road, Gurugram, Haryana"], destination: "DLF Phase 5, Sector 53, Gurugram, Haryana" },
};

async function computeRoute(routeKey, departureTime) {
  const def = ROUTE_DEFS[routeKey];
  const body = {
    origin: { address: def.origin },
    destination: { address: def.destination },
    intermediates: def.intermediates.map(a => ({ address: a })),
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_AWARE",
  };
  if (departureTime) body.departureTime = departureTime;
  const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_ROUTES_KEY,
      "X-Goog-FieldMask": "routes.duration,routes.staticDuration,routes.distanceMeters",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  const j = await res.json();
  const r = j.routes && j.routes[0];
  if (!r) return null;
  return {
    duration_s: parseInt(r.duration, 10),
    static_duration_s: parseInt(r.staticDuration, 10),
    distance_m: r.distanceMeters,
  };
}

function futureSlots(slots, date) {
  const nowMs = Date.now();
  return slots.filter(t => new Date(`${date}T${t}:00+05:30`).getTime() > nowMs);
}

// The workflow itself runs every 30 min (weather needs that cadence), but Google Routes
// billing is a per-call cost -- gate the routes-calling steps down to roughly once an hour.
// mm<10 (rather than mm===0) tolerates GitHub Actions' scheduling jitter (scheduled runs can
// fire a few minutes late) without silently skipping the intended hourly slot.
function isHourlySlot() {
  return istHM().mm < 10;
}

// Google Routes with routingPreference:"TRAFFIC_AWARE" bills under the Pro SKU, whose free
// tier is 5,000 calls/month (not the 10,000 Essentials gets) -- this is a hard circuit
// breaker so a bad estimate (more weekdays than expected, extra manual runs, etc.) can
// NEVER turn into a surprise bill, on top of the office-hours + hourly-cadence savings above.
const GMAPS_MONTHLY_BUDGET = 4500; // stay comfortably under the 5,000 free-tier ceiling

async function main() {
  let prev = {};
  try {
    prev = JSON.parse(await fs.readFile(DATA_PATH, "utf8"));
  } catch { /* first run, no previous file */ }

  const historyStart = prev.historyStart || new Date().toISOString();

  const stations = await Promise.all(STATIONS_META.map(fetchWeatherUnion));
  const om = await fetchOpenMeteo();

  const date = istDate();
  const weekday = istWeekdayName();
  const weekdayFlag = isWeekday();
  const curMonth = date.slice(0, 7); // YYYY-MM, IST calendar

  let traffic = prev.traffic || null;
  let departurePlanToday = prev.departurePlanToday || null;
  let departurePlanMorning = prev.departurePlanMorning || null;

  const prevUsage = prev.gmapsUsage || {};
  let gmapsCalls = prevUsage.month === curMonth ? (prevUsage.calls || 0) : 0;
  let gmapsSkipped = false;
  function budgetAllows(n) {
    if (gmapsCalls + n > GMAPS_MONTHLY_BUDGET) { gmapsSkipped = true; return false; }
    return true;
  }
  function recordCalls(n) { gmapsCalls += n; }

  // Only spend Google Routes calls during real commute-relevant hours (8 AM - 9 PM IST) and
  // roughly once an hour, not every 30-min cycle around the clock -- overnight traffic reads
  // are worthless and were previously the single biggest driver of API usage.
  if (weekdayFlag && GOOGLE_ROUTES_KEY && isHourlySlot()) {
    // 6a: current traffic for all 3 routes, office hours only
    if (inWindow(8, 21) && budgetAllows(Object.keys(ROUTE_DEFS).length)) {
      const entries = await Promise.all(Object.keys(ROUTE_DEFS).map(async key => {
        const r = await computeRoute(key, null);
        return r ? [key, { ...r, updated_at: nowIst().toISOString().replace("Z", "+05:30").slice(0, 19) + "+05:30" }] : null;
      }));
      recordCalls(Object.keys(ROUTE_DEFS).length);
      const freshTraffic = Object.fromEntries(entries.filter(Boolean));
      if (Object.keys(freshTraffic).length) traffic = { ...(traffic || {}), ...freshTraffic };
    }

    // 6b: evening best-time-to-leave, 14:00-21:00 IST, return routes
    if (inWindow(14, 21)) {
      const slots = futureSlots(["16:30","17:00","17:30","18:00","18:30","19:00","19:30","20:00","20:30"], date);
      const routeKeys = ["return-subhash", "return-ext"];
      if (budgetAllows(slots.length * routeKeys.length)) {
        const routes = {};
        for (const key of routeKeys) {
          const results = [];
          for (const t of slots) {
            const r = await computeRoute(key, `${date}T${t}:00+05:30`);
            if (r) results.push({ time: t, duration_s: r.duration_s });
          }
          routes[key] = results;
        }
        recordCalls(slots.length * routeKeys.length);
        let best = null;
        for (const [key, arr] of Object.entries(routes)) {
          for (const s of arr) {
            if (!best || s.duration_s < best.duration_s) best = { routeKey: key, time: s.time, duration_s: s.duration_s };
          }
        }
        departurePlanToday = { date, weekday, routes, best, computed_at: new Date().toISOString() };
      }
    }

    // 6c: morning best-time-to-leave, 09:00-12:00 IST, forward route only
    if (inWindow(9, 12)) {
      const slots = futureSlots(["09:00","09:30","10:00","10:30","11:00","11:30","12:00"], date);
      if (budgetAllows(slots.length)) {
        const results = [];
        for (const t of slots) {
          const r = await computeRoute("forward", `${date}T${t}:00+05:30`);
          if (r) results.push({ time: t, duration_s: r.duration_s });
        }
        recordCalls(slots.length);
        let best = null;
        for (const s of results) {
          if (!best || s.duration_s < best.duration_s) best = { routeKey: "forward", time: s.time, duration_s: s.duration_s };
        }
        departurePlanMorning = { date, weekday, routes: { forward: results }, best, computed_at: new Date().toISOString() };
      }
    }
  }

  const out = {
    generatedAt: new Date().toISOString(),
    historyStart,
    weekday,
    stations,
    om,
    traffic,
    departurePlanToday,
    departurePlanMorning,
    gmapsUsage: { month: curMonth, calls: gmapsCalls, budget: GMAPS_MONTHLY_BUDGET },
  };

  await fs.writeFile(DATA_PATH, JSON.stringify(out, null, 2) + "\n");
  console.log(`Synced ${stations.length} stations, weekday=${weekday}, traffic=${!!traffic}, eveningPlan=${!!(departurePlanToday && departurePlanToday.date === date)}, morningPlan=${!!(departurePlanMorning && departurePlanMorning.date === date)}, gmapsCalls=${gmapsCalls}/${GMAPS_MONTHLY_BUDGET}${gmapsSkipped ? " (budget-limited this run)" : ""}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
