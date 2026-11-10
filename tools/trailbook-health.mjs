// Trailbook nightly health check
// ------------------------------------------------------------
// Reads trailbook-data.js, checks every source link, pulls official
// National Park Service closure alerts for parks in the Trailbook,
// compares with last night, and writes a short report ONLY when
// something changed. GitHub Actions turns that report into an issue,
// and GitHub emails it to you.
//
// Run locally:  NPS_API_KEY=xxxx node tools/trailbook-health.mjs
// Files it uses:
//   trailbook-data.js            (read)
//   health/state.json            (read + write: last night's results)
//   health/report.md             (written only when there is news)
// ------------------------------------------------------------
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";

// TRAILBOOK_DIR: folder holding trailbook-data.js, trailbook.html and pack.html (default: here)
// HEALTH_DIR:    folder for state.json and report.md (default: ./health)
const ROOT = path.resolve(process.env.TRAILBOOK_DIR || ".");
const DATA = path.join(ROOT, "trailbook-data.js");
const DIR = path.resolve(process.env.HEALTH_DIR || "health");
const STATE = path.join(DIR, "state.json");
const REPORT = path.join(DIR, "report.md");
const NPS_KEY = process.env.NPS_API_KEY || "";
const TIMEOUT_MS = 20000;
const CONCURRENCY = 8;
// A link has to fail this many nights in a row before it is reported,
// so a site that is down for one evening doesn't trigger an email.
const FAIL_NIGHTS = 2;

// National Park Service units that Trailbook trips sit in.
// Trips are matched by their link (nps.gov/xxxx/) or by words in the name.
const PARKS = {
  samo: { name: "Santa Monica Mountains NRA", match: /circle x|grotto|sandstone|backbone|sycamore canyon|point mugu|paramount ranch|rocky oaks|santa monica mountains/i },
  jotr: { name: "Joshua Tree NP", match: /joshua tree|lost palms|sheep pass|boy scout trail/i },
  chis: { name: "Channel Islands NP", match: /channel islands|santa cruz island|santa rosa island|anacapa|scorpion|del norte/i },
  moja: { name: "Mojave National Preserve", match: /mojave|kelso|hole-in-the-wall|rings trail|lava tube/i },
  deva: { name: "Death Valley NP", match: /death valley/i },
  seki: { name: "Sequoia & Kings Canyon NP", match: /sequoia|crystal cave/i },
  pinn: { name: "Pinnacles NP", match: /pinnacles/i },
  depo: { name: "Devils Postpile NM", match: /devils postpile/i },
  manz: { name: "Manzanar NHS", match: /manzanar/i },
  lame: { name: "Lake Mead NRA", match: /black canyon|lake mead/i },
  cabr: { name: "Cabrillo NM", match: /cabrillo national/i },
};

// ---------- load the trip list ----------
function loadData() {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(DATA, "utf8") + ";this.D={T,BTS,CITY,CAMPS,SUMMER,DATES};", ctx);
  const D = ctx.D, entries = [];
  // Which page(s) each entry shows on. The Pack page lists trips that aren't troop-only
  // (and skips backpacking, urban treks and hikes over 4 miles).
  const onPack = r => r[5] !== "Troop" && r[2] !== "Backpacking" && r[2] !== "Urban treks" && !((r[12] || {}).miles > 4);
  const onTroop = r => r[5] !== "PackOnly";
  const pages = (troop, pack) => troop && pack ? "Troop + Pack" : pack ? "Pack" : "Troop";
  D.T.forEach(r => entries.push({ id: r[0], name: r[1], link: r[11], status: (r[12] || {}).status || "", where: "Trip", page: pages(onTroop(r), onPack(r)) }));
  D.BTS.forEach(x => entries.push({ id: "bts:" + x.name, name: x.name, link: x.link, where: "Behind the Scenes", page: "Troop" }));
  D.CITY.forEach(x => entries.push({ id: "city:" + x.name, name: x.name, link: x.link, where: "City Explorer", page: x.age === "teen" ? "Troop" : "Troop + Pack" }));
  D.CAMPS.forEach(x => entries.push({ id: "camp:" + x.name, name: x.name, link: x.link, where: "Scout Camps", page: "Troop" }));
  D.SUMMER.forEach(x => entries.push({ id: "summer:" + x.name, name: x.name, link: x.link, where: "Summer Camp Finder", page: "Troop" }));
  D.DATES.forEach(x => entries.push({ id: "date:" + x[3] + "|" + x[2], name: `${x[3]} (${x[2]})`, link: x[4], where: "Big Trip Planner", page: "Troop", start: x[0], end: x[1] }));
  // Links written directly into the pages (e.g. the Pack page's Midway-by-Train sources)
  const known = new Set(entries.map(e => e.link));
  for (const [file, page] of [["pack.html", "Pack"], ["trailbook.html", "Troop"]]) {
    const f = path.join(ROOT, file);
    if (!fs.existsSync(f)) continue;
    const html = fs.readFileSync(f, "utf8");
    for (const m of html.matchAll(/<a[^>]+href="(https?:\/\/[^"$]+)"[^>]*>([^<]{1,80})/g)) {
      if (known.has(m[1])) continue;
      known.add(m[1]);
      entries.push({ id: "page:" + m[1], name: m[2].replace(/\s*↗$/, "").trim() || m[1], link: m[1], where: page === "Pack" ? "Pack page text" : "Troop page text", page });
    }
  }
  return entries;
}

// ---------- link checking ----------
const UA = "Mozilla/5.0 (compatible; TrailbookHealthCheck/1.0; +https://scoutactivitytracker.com)";
async function fetchWithTimeout(url, method) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { method, redirect: "follow", signal: ac.signal, headers: { "user-agent": UA, accept: "text/html,*/*" } });
  } finally { clearTimeout(t); }
}
// Result kinds:
//   ok       page loads
//   broken   404/410 or the site doesn't exist any more
//   error    server error / timeout / couldn't connect (retried next night)
//   blocked  the site refuses automated checks (403/429) - not reported
async function checkLink(url) {
  if (!/^https?:\/\//.test(url || "")) return { kind: "broken", code: "bad link" };
  for (const method of ["HEAD", "GET"]) {
    try {
      const r = await fetchWithTimeout(url, method);
      if (method === "HEAD" && [403, 405, 429, 501].includes(r.status)) continue; // many sites dislike HEAD
      const finalUrl = r.url || url;
      if (r.status >= 200 && r.status < 400) {
        const moved = new URL(finalUrl).hostname.replace(/^www\./, "") !== new URL(url).hostname.replace(/^www\./, "");
        const toHome = new URL(finalUrl).pathname.replace(/\/$/, "") === "" && new URL(url).pathname.replace(/\/$/, "") !== "";
        return { kind: "ok", code: r.status, moved: moved || toHome ? finalUrl : "" };
      }
      if ([404, 410].includes(r.status)) return { kind: "broken", code: r.status };
      if ([401, 403, 429].includes(r.status)) return { kind: "blocked", code: r.status };
      return { kind: "error", code: r.status };
    } catch (e) {
      const msg = String(e && (e.cause && e.cause.code || e.name || e.message));
      if (/ENOTFOUND|EAI_AGAIN/.test(msg) && method === "GET") return { kind: "broken", code: "site not found" };
      if (method === "GET") return { kind: "error", code: msg.slice(0, 40) };
    }
  }
  return { kind: "blocked", code: "refused" };
}
async function checkAll(urls) {
  const out = {}, list = [...urls];
  let i = 0;
  async function worker() { while (i < list.length) { const u = list[i++]; out[u] = await checkLink(u); } }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return out;
}

// ---------- NPS alerts ----------
async function npsAlerts(codes) {
  if (!NPS_KEY) return { skipped: true, alerts: [] };
  const url = `https://developer.nps.gov/api/v1/alerts?parkCode=${codes.join(",")}&limit=200&api_key=${NPS_KEY}`;
  try {
    const r = await fetchWithTimeout(url, "GET");
    if (!r.ok) return { error: `NPS API answered ${r.status}`, alerts: [] };
    const j = await r.json();
    // Keep closures and danger notices; skip routine "information" alerts.
    const alerts = (j.data || [])
      .filter(a => /closure|danger|caution/i.test(a.category || ""))
      .map(a => ({ id: a.id, park: a.parkCode, category: a.category, title: a.title, url: a.url || `https://www.nps.gov/${a.parkCode}/planyourvisit/conditions.htm` }));
    return { alerts };
  } catch (e) { return { error: "Couldn't reach the NPS API", alerts: [] }; }
}

// ---------- main ----------
const entries = loadData();
const prev = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : { links: {}, alerts: [], firstRun: true };
const urls = new Set(entries.map(e => e.link).filter(Boolean));
console.log(`Checking ${urls.size} links...`);
const results = await checkAll(urls);

// failure streaks
const links = {};
for (const u of urls) {
  const r = results[u], p = prev.links[u] || {};
  const bad = r.kind === "broken" || r.kind === "error";
  links[u] = { ...r, streak: bad ? (p.streak || 0) + 1 : 0, reported: bad ? !!p.reported : false };
}

// park codes in use
const parkTrips = {};
for (const e of entries) {
  const m = (e.link || "").match(/nps\.gov\/([a-z]{4})\//);
  const codes = new Set(m && PARKS[m[1]] ? [m[1]] : []);
  for (const [code, p] of Object.entries(PARKS)) if (p.match.test(e.name)) codes.add(code);
  for (const c of codes) (parkTrips[c] = parkTrips[c] || new Set()).add(e.name);
}
const nps = await npsAlerts(Object.keys(parkTrips));
const prevAlertIds = new Set((prev.alerts || []).map(a => a.id));

// ---------- build the report (only new news) ----------
const byLink = {};
entries.forEach(e => (byLink[e.link] = byLink[e.link] || []).push(e));
const newlyBroken = [], fixed = [], moved = [];
for (const [u, s] of Object.entries(links)) {
  if (s.streak >= FAIL_NIGHTS && !s.reported) { newlyBroken.push(u); s.reported = true; }
  const p = prev.links[u];
  if (p && p.reported && s.streak === 0) fixed.push(u);
  if (s.moved && (!p || p.moved !== s.moved)) moved.push(u);
}
const newAlerts = nps.alerts.filter(a => !prevAlertIds.has(a.id));
const today = new Date().toISOString().slice(0, 10);
const expiredDates = entries.filter(e => e.where === "Big Trip Planner" && e.end && e.end < today);

const names = u => (byLink[u] || []).map(e => `**${e.name}** (${e.page} · ${e.where})`).join(", ");
const lines = [];
if (prev.firstRun) lines.push(`First run: now watching ${urls.size} links${nps.skipped ? "" : ` and closure alerts for ${Object.keys(parkTrips).length} national parks`}. From now on you'll only hear about changes.\n`);
if (newlyBroken.length) {
  lines.push(`### Broken links (${newlyBroken.length})`, "These have failed two nights in a row. The page may have moved, or the place may have closed.", "");
  newlyBroken.forEach(u => lines.push(`- ${names(u)}: ${links[u].code}. ${u}`));
  lines.push("");
}
if (newAlerts.length) {
  lines.push(`### New park closure or danger alerts (${newAlerts.length})`, "");
  newAlerts.forEach(a => lines.push(`- **${PARKS[a.park] ? PARKS[a.park].name : a.park}**, ${a.category}: ${a.title}. Trips there: ${[...(parkTrips[a.park] || [])].join(", ")}. ${a.url}`));
  lines.push("");
}
if (moved.length) {
  lines.push(`### Links that now redirect somewhere else (${moved.length})`, "Often fine, but sometimes a sign the program page was removed.", "");
  moved.forEach(u => lines.push(`- ${names(u)}: ${u} now goes to ${links[u].moved}`));
  lines.push("");
}
if (fixed.length) {
  lines.push(`### Working again (${fixed.length})`, "");
  fixed.forEach(u => lines.push(`- ${names(u)}`));
  lines.push("");
}
const prevExpired = new Set(prev.expiredDates || []);
const newlyExpired = expiredDates.filter(e => !prevExpired.has(e.id));
if (newlyExpired.length) {
  lines.push(`### Big Trip Planner dates that have passed (${newlyExpired.length})`, "Time to update these with next year's dates.", "");
  newlyExpired.forEach(e => lines.push(`- ${e.name}: ended ${e.end}`));
  lines.push("");
}
if (nps.error) lines.push(`_Note: ${nps.error}; park alerts were skipped tonight._`);
if (nps.skipped && prev.firstRun) lines.push("_Park alerts are off until an NPS_API_KEY secret is added._");

const blocked = Object.values(links).filter(s => s.kind === "blocked").length;
const counts = Object.values(links).reduce((a, s) => (a[s.kind] = (a[s.kind] || 0) + 1, a), {});
console.log("Results:", counts, "| new alerts:", newAlerts.length);

fs.mkdirSync(DIR, { recursive: true });
fs.writeFileSync(STATE, JSON.stringify({ checked: new Date().toISOString(), counts, links, alerts: nps.error ? prev.alerts : nps.alerts, expiredDates: expiredDates.map(e => e.id) }, null, 1));
const news = newlyBroken.length || newAlerts.length || moved.length || fixed.length || newlyExpired.length || prev.firstRun;
if (news) {
  lines.push("", `_Checked ${urls.size} links on ${today}. ${blocked} sites block automated checks and are skipped. Change a trip in trailbook-data.js (or send the list to Claude) and this issue can be closed._`);
  fs.writeFileSync(REPORT, lines.join("\n"));
  console.log("Report written to " + path.relative(process.cwd(), path.join(DIR, "report.md")));
} else {
  if (fs.existsSync(REPORT)) fs.unlinkSync(REPORT);
  console.log("No changes tonight.");
}
