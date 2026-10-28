// "This Weekend" tab for the Trailbook pages. Add after trailbook-data.js and the page's own script:
//   <script src="trailbook-weekend.js" data-mode="troop"></script>   (trailbook.html)
//   <script src="trailbook-weekend.js" data-mode="pack"></script>    (pack.html)
// Live data (ranger programs, public programs, Scout events, park alerts) comes from the Scout Event Finder's
// nightly weekend.json. Trip ideas come from trailbook-data.js. Nothing else on the page is changed.
(() => {
  const MODE = (document.currentScript && document.currentScript.dataset.mode) || "troop";
  const FEED = "https://brucewaine1940-jpg.github.io/scout-event-finder/data/weekend.json";
  const FINDER = "https://brucewaine1940-jpg.github.io/scout-event-finder/weekend.html";
  const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const PROG = MODE === "pack" ? ["Cub Scouts"] : ["Scouts BSA", "Venturing", "Sea Scouts"];
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const parse = (s) => new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  const nice = (d) => `${DAY[d.getDay()]} ${MON[d.getMonth()]} ${d.getDate()}`;
  const fmtDrive = (m) => (m < 60 ? `${m} min` : `${Math.round(m / 15) / 4} hr`);
  const ZIPS = "https://brucewaine1940-jpg.github.io/scout-event-finder/data/zips-ca.json";
  const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } } };
  let feed = null, wk = 0, maxMi = 25, origin = null, zipTable = null, zip = "91401";
  const hav = (a, b) => { const r = (x) => (x * Math.PI) / 180;
    const h = Math.sin(r(b[0] - a[0]) / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(r(b[1] - a[1]) / 2) ** 2;
    return Math.round(3958.8 * 2 * Math.asin(Math.sqrt(h))); };
  function measure() {
    if (!feed) return;
    [...feed.scout, ...feed.public].forEach((e) => {
      if (e.m0 === undefined) e.m0 = e.miles;
      e.miles = e.online ? null : origin && e.lat != null ? hav(origin, [e.lat, e.lng]) : zip === "91401" ? e.m0 : null;
    });
  }
  async function setZip(z) {
    const msg = document.getElementById("wkZipMsg");
    if (!/^\d{5}$/.test(z)) { msg.textContent = "Enter a 5-digit ZIP."; return; }
    if (!zipTable) { try { const r = await fetch(ZIPS); if (r.ok) zipTable = await r.json(); } catch (e) { /* retry next time */ } }
    if (!zipTable) { msg.textContent = "Couldn't load the ZIP list. Try again in a moment."; return; }
    if (!zipTable[z]) { msg.textContent = "ZIP not found in the Los Angeles area."; return; }
    zip = z; origin = zipTable[z]; msg.textContent = ""; store.set("tbw-zip", z);
    measure(); render();
  }

  // ---------- trips from trailbook-data.js ----------
  const trips = (typeof T === "undefined" ? [] : T).map((r) => ({
    id: r[0], name: r[1], cat: r[2], drive: r[3], months: r[4], fit: r[5], stay: r[6], cost: r[7],
    badges: r[8], what: r[9], know: r[10], link: r[11], ...(r[12] || {}),
  })).filter((i) => (MODE === "pack"
    ? i.fit !== "Troop" && i.cat !== "Backpacking" && i.cat !== "Urban treks" && !(i.miles > 4)
    : i.fit !== "PackOnly") && i.status !== "closed");
  const byId = Object.fromEntries(trips.map((i) => [i.id, i]));

  // ---------- styles (uses the page's own colors and fonts) ----------
  const css = document.createElement("style");
  css.textContent = `
  #weekend .wk-bar{display:flex;flex-wrap:wrap;gap:10px 16px;align-items:center;margin:4px 0 6px}
  #weekend .wk-seg{display:inline-flex;border:1px solid var(--line);border-radius:999px;overflow:hidden;background:var(--surface)}
  #weekend .wk-seg button{font:inherit;font-size:14px;border:0;background:none;color:var(--ink);padding:6px 14px;cursor:pointer}
  #weekend .wk-seg button[aria-pressed="true"]{background:var(--forest);color:#fff}
  #weekend h2.wk-h{font-family:var(--display);font-size:30px;margin:6px 0 2px}
  #weekend h3.wk-h3{font-family:var(--display);font-size:22px;margin:26px 0 4px;letter-spacing:.01em}
  #weekend .wk-note{color:var(--muted);font-size:14px;margin:0 0 10px}
  #weekend .wk-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}
  #weekend .wk-card{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:5px;min-width:0}
  #weekend .wk-card h4{font-family:var(--display);font-size:20px;line-height:1.1;margin:0}
  #weekend .wk-card h4 a{color:var(--ink);text-decoration:none}
  #weekend .wk-card h4 a:hover{text-decoration:underline}
  #weekend .wk-when{font-size:13px;font-weight:700;color:var(--forest)}
  #weekend .wk-meta{font-size:13px;color:var(--muted)}
  #weekend .wk-card p{margin:0;font-size:14px}
  #weekend .wk-pills{display:flex;flex-wrap:wrap;gap:5px}
  #weekend .wk-pill{font-size:12px;font-weight:600;border-radius:4px;padding:1px 7px;background:var(--forest-soft);color:var(--forest)}
  #weekend .wk-pill.d{font-family:var(--mono);background:var(--sky-soft);color:var(--sky)}
  #weekend .wk-pill.b{background:var(--blaze-soft);color:var(--blaze)}
  #weekend ul.wk-list{margin:2px 0 0;padding-left:18px;font-size:14px}
  #weekend ul.wk-list li{margin:2px 0}
  #weekend .wk-alert{border-color:var(--warn);background:var(--warn-soft)}
  #weekend .wk-alert .wk-when{color:var(--warn)}
  #weekend .wk-empty{color:var(--muted);font-size:14px;border:1px dashed var(--line);border-radius:10px;padding:12px}
  #weekend .wk-more{display:inline-block;margin-top:10px;font-weight:600}`;
  document.head.append(css);

  // ---------- tab + panel ----------
  const nav = document.querySelector("nav.tabs .wrap");
  const first = nav && nav.querySelector('[role="tab"]');
  const main = document.querySelector("main .wrap");
  if (!nav || !first || !main) return;
  const tab = document.createElement("button");
  tab.setAttribute("role", "tab"); tab.id = "t-weekend"; tab.setAttribute("aria-selected", "false");
  tab.textContent = "This Weekend";
  nav.insertBefore(tab, first);
  const panel = document.createElement("section");
  panel.setAttribute("role", "tabpanel"); panel.id = "weekend"; panel.setAttribute("aria-labelledby", "t-weekend");
  panel.hidden = true;
  panel.innerHTML = `
    <div class="wk-bar">
      <div class="wk-seg" role="group" aria-label="Which weekend">
        <button type="button" data-wk="0" aria-pressed="true">This weekend</button>
        <button type="button" data-wk="1" aria-pressed="false">Next weekend</button>
      </div>
      <div class="wk-seg" role="group" aria-label="Distance for events">
        ${[5, 10, 25, 50].map((m) => `<button type="button" data-mi="${m}" aria-pressed="${m === 25}">${m} mi</button>`).join("")}
      </div>
      <form id="wkZipForm" style="display:inline-flex;gap:6px;align-items:center" autocomplete="off">
        <label class="wk-meta" for="wkZip">Events near ZIP</label>
        <input id="wkZip" inputmode="numeric" maxlength="5" value="91401" style="width:72px;font:inherit;padding:4px 8px;border:1px solid var(--line);border-radius:6px;background:var(--surface);color:var(--ink)">
        <button type="submit" style="font:inherit;font-size:14px;border:0;border-radius:6px;padding:5px 12px;background:var(--forest);color:#fff;cursor:pointer">Go</button>
      </form>
      <span class="wk-meta" id="wkZipMsg" role="status"></span>
    </div>
    <h2 class="wk-h" id="wkDates"></h2>
    <p class="wk-note">Updated nightly. Public programs and ideas from this Trailbook, plus Scout events from the Scout Event Finder.</p>
    <div id="wkAlerts"></div>
    <div id="wkDeadlines"></div>
    <h3 class="wk-h3">Happening this weekend</h3>
    <p class="wk-note">Dated public programs: ranger programs, star parties, workshops, service days.</p>
    <div id="wkPublic" class="wk-grid"></div>
    <h3 class="wk-h3">Good fits for this weekend</h3>
    <p class="wk-note">In-season ideas from the Trailbook, a new mix each week. Drive times are from Van Nuys. Book campouts well ahead.</p>
    <div id="wkTrips" class="wk-grid"></div>
    <h3 class="wk-h3">Scout events this weekend</h3>
    <p class="wk-note">Put on by councils, districts and merit badge programs, within the distance you picked.</p>
    <div id="wkScout" class="wk-grid"></div>
    <a class="wk-more" href="${FINDER}" target="_blank" rel="noopener">All Scout events this weekend in the Scout Event Finder ↗</a>`;
  main.prepend(panel);

  const others = () => [...document.querySelectorAll('[role="tab"]:not(#t-weekend), #t-suggest')];
  function showWeekend() {
    document.querySelectorAll('section[role="tabpanel"]').forEach((p) => { p.hidden = p !== panel; });
    others().forEach((t) => t.setAttribute("aria-selected", "false"));
    tab.setAttribute("aria-selected", "true");
    history.replaceState(null, "", "#weekend");
    window.scrollTo({ top: 0 });
    render();
  }
  tab.addEventListener("click", showWeekend);
  others().forEach((t) => t.addEventListener("click", () => { panel.hidden = true; tab.setAttribute("aria-selected", "false"); }));
  panel.querySelectorAll("[data-mi]").forEach((b) => b.addEventListener("click", () => {
    maxMi = +b.dataset.mi;
    panel.querySelectorAll("[data-mi]").forEach((x) => x.setAttribute("aria-pressed", x === b));
    render();
  }));
  panel.querySelectorAll("[data-wk]").forEach((b) => b.addEventListener("click", () => {
    wk = +b.dataset.wk;
    panel.querySelectorAll("[data-wk]").forEach((x) => x.setAttribute("aria-pressed", x === b));
    render();
  }));

  // ---------- helpers ----------
  function weekend(offset) {
    const t = new Date(); t.setHours(0, 0, 0, 0);
    const dow = t.getDay();
    const fri = new Date(t); fri.setDate(t.getDate() + (dow === 6 ? -1 : dow === 0 ? -2 : 5 - dow) + 7 * offset);
    const sun = new Date(fri); sun.setDate(fri.getDate() + 2);
    return { fri, sun, lo: iso(fri), hi: iso(sun) };
  }
  const inRange = (e, w) => e.start.slice(0, 10) <= w.hi && (e.end || e.start).slice(0, 10) >= w.lo;
  function time(e) {
    if (e.time) return e.time;
    const hm = e.start.slice(11, 16);
    if (!hm || hm === "00:00") return "";
    let [h, m] = hm.split(":").map(Number); const ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12;
    return `${h}:${String(m).padStart(2, "0")} ${ap}`;
  }
  const empty = (m) => `<div class="wk-empty">${m}</div>`;
  // same weekend -> same mix; changes every week
  function seeded(list, seed) {
    let s = 0; for (const c of seed) s = (s * 31 + c.charCodeAt(0)) >>> 0;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    return list.map((x) => [rnd(), x]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  }

  function tripCard(i, extra) {
    return `<article class="wk-card">
      <div class="wk-pills"><span class="wk-pill">${esc(i.cat)}</span><span class="wk-pill d">${fmtDrive(i.drive)}</span><span class="wk-pill">${esc(i.cost)}</span>${i.stay !== "Day" ? `<span class="wk-pill b">${esc(i.stay)}</span>` : ""}</div>
      <h4><a href="${esc(i.link)}" target="_blank" rel="noopener">${esc(i.name)}</a></h4>
      ${extra || ""}<p>${esc(i.what)}</p>${i.status === "check" ? `<div class="wk-meta">Check status before going.</div>` : ""}
    </article>`;
  }

  // ---------- render ----------
  function render() {
    const w = weekend(wk);
    document.getElementById("wkDates").textContent = `${nice(w.fri)} – ${nice(w.sun)}`;
    const sat = new Date(w.fri); sat.setDate(w.fri.getDate() + 1);
    const month = sat.getMonth() + 1;

    // deadlines in the next two weeks (from the Trailbook's DATES list)
    const lim = new Date(w.fri); lim.setDate(lim.getDate() + 14);
    const dl = (typeof DATES === "undefined" ? [] : DATES).filter((d) => d[0] >= iso(new Date()) && d[0] <= iso(lim));
    document.getElementById("wkDeadlines").innerHTML = dl.length ? `<h3 class="wk-h3">Heads-up: deadlines in the next two weeks</h3><div class="wk-grid">${dl.map((d) =>
      `<article class="wk-card"><div class="wk-when">${nice(parse(d[0]))}${d[1] ? ` – ${nice(parse(d[1]))}` : ""} · ${esc(d[2])}</div><h4><a href="${esc(d[4])}" target="_blank" rel="noopener">${esc(d[3])}</a></h4></article>`).join("")}</div>` : "";

    // trip ideas: in season, sensible drive for a weekend
    const fits = trips.filter((i) => (i.months || []).includes(month));
    const day = seeded(fits.filter((i) => i.stay === "Day" && i.drive <= 90), w.lo + MODE).slice(0, 6);
    const camp = seeded(fits.filter((i) => i.stay !== "Day" && i.drive <= 180), w.lo + MODE + "c").slice(0, 3);
    document.getElementById("wkTrips").innerHTML = [...day, ...camp].map((i) => tripCard(i)).join("") || empty("No in-season ideas found.");

    if (!feed) {
      ["wkPublic", "wkScout"].forEach((id) => { document.getElementById(id).innerHTML = empty("Loading live listings…"); });
      return;
    }
    // park alerts
    const al = (feed.alerts || []).filter((a) => ["Park Closure", "Danger"].includes(a.category));
    document.getElementById("wkAlerts").innerHTML = al.length ? `<h3 class="wk-h3">Park alerts</h3><div class="wk-grid">${al.map((a) =>
      `<article class="wk-card wk-alert"><div class="wk-when">${esc(a.category)} · ${esc((feed.parks || {})[a.parkCode] || a.parkCode.toUpperCase())}</div><h4><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.title)}</a></h4></article>`).join("")}</div>` : "";

    // public programs (non-ranger) and ranger programs grouped by park
    const pub = feed.public.filter((e) => inRange(e, w) && (e.kind === "ranger" || e.miles == null || e.miles <= maxMi) && (!e.programs.length || e.programs.some((p) => PROG.includes(p) || (MODE === "troop" && p === "Adults / Leaders"))));
    let html = pub.filter((e) => e.kind !== "ranger").map((e) => {
      const t = byId[e.trailbook];
      return `<article class="wk-card"><div class="wk-when">${nice(parse(e.start))}${time(e) ? `, ${time(e)}` : ""}</div>
        <h4><a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.title)}</a></h4>
        <div class="wk-meta">${esc(e.location)}${e.miles != null ? ` · ${e.miles} mi` : ""}</div>
        ${t ? `<p>${esc(t.know || t.what)}</p>` : ""}</article>`;
    }).join("");
    const parks = {};
    pub.filter((e) => e.kind === "ranger" && !(MODE === "pack" && e.miles > 150)).forEach((e) => {
      const p = (parks[e.council] ||= { name: e.council, miles: e.miles, items: {} });
      if (e.miles != null && (p.miles == null || e.miles < p.miles)) p.miles = e.miles;
      (p.items[e.title] ||= { title: e.title, url: e.url, time: e.time, days: new Set() }).days.add(DAY[parse(e.start).getDay()]);
    });
    html += Object.values(parks).sort((a, b) => (a.miles ?? 999) - (b.miles ?? 999)).map((p) =>
      `<article class="wk-card"><div class="wk-when">Ranger programs${p.miles != null ? ` · ${p.miles} mi` : ""}</div><h4>${esc(p.name)}</h4>
        <ul class="wk-list">${Object.values(p.items).map((i) => `<li><a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a> <span class="wk-meta">${[...i.days].join(", ")}${i.time ? ` · ${esc(i.time)}` : ""}</span></li>`).join("")}</ul></article>`).join("");
    document.getElementById("wkPublic").innerHTML = html || empty("No dated public programs listed for this weekend.");

    // Scout events for this unit, within ~60 mi
    const sc = feed.scout.filter((e) => inRange(e, w) && !e.online && e.miles != null && e.miles <= maxMi &&
      (!e.programs.length || e.programs.some((p) => PROG.includes(p)))).slice(0, 9);
    document.getElementById("wkScout").innerHTML = sc.map((e) => `<article class="wk-card">
      <div class="wk-when">${nice(parse(e.start))}${time(e) ? `, ${time(e)}` : ""}</div>
      <h4><a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.title)}</a></h4>
      <div class="wk-meta">${esc(e.location)} · ${e.approx ? "~" : ""}${e.miles} mi${e.approx ? " (council area)" : ""}</div>
      ${e.badges.length ? `<div class="wk-pills">${e.badges.map((b) => `<span class="wk-pill b">${esc(b)}</span>`).join("")}</div>` : ""}</article>`).join("")
      || empty(`No Scout events for this unit within ${maxMi} miles this weekend.`);
  }

  panel.querySelector("#wkZipForm").addEventListener("submit", (e) => { e.preventDefault(); setZip(panel.querySelector("#wkZip").value.trim()); });
  fetch(FEED, { cache: "no-cache" }).then((r) => r.json()).then((j) => {
    feed = j; measure();
    const saved = store.get("tbw-zip");
    if (saved && saved !== "91401") { panel.querySelector("#wkZip").value = saved; setZip(saved); } else if (!panel.hidden) render();
  })
    .catch(() => { feed = { scout: [], public: [], alerts: [] }; if (!panel.hidden) render(); });
  if (location.hash === "#weekend") showWeekend();
})();
