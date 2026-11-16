"use strict";
/* PothSheba prototype: simulates sensing -> quick check -> detect -> merge/confirm -> score -> map. 1 px = 2 m */
const $ = s => document.querySelector(s);
const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const W = 800, H = 500;

const ROADS = [
  { n: "Campus Rd", w: 1.0, p: [[40, 250], [260, 250], [540, 250], [760, 250]] },
  { n: "Ashulia Rd", w: 0.8, p: [[260, 40], [260, 250], [260, 460]] },
  { n: "Market Rd", w: 0.6, p: [[540, 60], [540, 250], [540, 440]] },
  { n: "Link Rd", w: 0.4, p: [[260, 460], [540, 450], [740, 440]] }
];
const POIS = [{ t: "School", x: 300, y: 250, i: "S" }, { t: "Hospital", x: 540, y: 150, i: "H" }, { t: "Bus stop", x: 260, y: 370, i: "B" }];
// Ground truth used only for evaluation (precision / recall)
const HOLES = [[120, 250, "Pothole"], [200, 250, "Pothole"], [330, 250, "Speed breaker"], [410, 250, "Pothole"], [620, 250, "Pothole"],
  [260, 120, "Pothole"], [260, 340, "Pothole"], [400, 450, "Pothole"], [540, 330, "Pothole"]];
const LV = [["Critical", 75, "#d7263d"], ["High", 55, "#f46036"], ["Medium", 35, "#f2b134"], ["Low", 0, "#2e9e6b"]];
const level = s => LV.find(l => s >= l[1])[0];
const color = l => LV.find(x => x[0] === l)[2];
const SPOT = { "Waterlogging": [546, 262], "Bin full": [530, 238], "Street light off": [553, 242] };

let S, DEV, P;
function init() {
  S = { issues: [], log: [], id: 1, run: true, speed: 1, rain: false, sel: null, pick: null, mine: [], m: { ev: 0, drop: 0 }, t: 0, v: 1 };
  DEV = [
    { id: "D1", name: "CNG-01", route: ROADS[0].p, d: 0, v: 38, cool: {} },
    { id: "D2", name: "UniBus-02", route: [...ROADS[1].p, ...ROADS[3].p.slice(1)], d: 0, v: 34, cool: {} }
  ];
  P = { water: 4, bin: 30, light: true, flag: {} };
  S.issues.length = 0; N.list.length = 0; loadIssues(); ui(); bell();
  log(DEMO ? "Demo simulation started: 2 vehicle devices and 1 fixed pole." : "System started. Waiting for citizen reports.");
}

/* ---------- AI priority ranking: starts from the proposal formula, learns from officer decisions ---------- */
const FN = ["Size", "Traffic", "Risk zone", "Repeat reports", "Time open", "Problem type", "Confirmed", "Rain impact"];
const W0 = [0.30, 0.22, 0.22, 0.08, 0.06, 0.06, 0.04, 0.02];
const TYPEW = { "Pothole": 0.7, "Crack": 0.4, "Waterlogging": 1, "Bin full": 0.3, "Street light off": 0.5 };
const AI = { on: true, w: W0.slice(), n: 0, over: 0 };
try { const s = JSON.parse(localStorage.getItem("ps_ai")); if (s && s.w.length === 8) Object.assign(AI, { w: s.w, n: s.n, over: s.over }); } catch (e) {}
const aiSave = () => { try { localStorage.setItem("ps_ai", JSON.stringify({ w: AI.w, n: AI.n, over: AI.over })); } catch (e) {} };
const feats = i => [i.size / 100, i.traffic / 100, i.risk / 100, Math.min(i.reports, 5) / 5, clamp((Date.now() - i.t) / 6e5, 0, 1),
  TYPEW[i.type] || 0.4, i.confirmed ? 1 : 0, S.rain && (i.type === "Pothole" || i.type === "Waterlogging") ? 1 : 0];
const aiScore = f => Math.round(100 * clamp(f.reduce((a, x, k) => a + x * AI.w[k], 0), 0, 1));
const why = i => i.f.map((x, k) => [FN[k], x * AI.w[k] * 100]).sort((a, b) => b[1] - a[1]).slice(0, 3).map(a => `${a[0]} +${Math.round(a[1])}`).join(", ");
// Pairwise learning: if the officer assigns an issue that was ranked lower, shift weight toward its features.
function learn(c) {
  const key = q => AI.on ? q.ai : q.score;
  const higher = S.issues.filter(q => q.status === "Open" && q !== c && key(q) > key(c));
  AI.n++;
  if (higher.length) {
    AI.over++;
    for (const q of higher) AI.w = AI.w.map((w, k) => Math.max(0.01, w + 0.04 * (c.f[k] - q.f[k])));
    const t = AI.w.reduce((a, b) => a + b, 0); AI.w = AI.w.map(w => w / t);
    S.issues.forEach(score);
    log(`AI model updated: officer chose ${c.id} over ${higher.length} higher-ranked issue(s).`);
  }
  aiSave();
}

/* ---------- real-time GPS: simulated devices + the viewer's real device ---------- */
const BASE = { lat: 23.8760, lon: 90.3200 }; // map centre (400,250). Change to your campus.
const toLL = (x, y) => [BASE.lat - (y - 250) * 2 / 111320, BASE.lon + (x - 400) * 2 / (111320 * Math.cos(BASE.lat * Math.PI / 180))];
const G = { id: null, anchor: null, me: null, ll: null, acc: 0, spd: null, trail: [], msg: "GPS off", want: false };
function setPick(p, ll) { S.pick = p; $("#locTxt").textContent = "Location chosen: " + (ll || toLL(p[0], p[1])).map(v => v.toFixed(5)).join(", "); }
function gpsStart() {
  if (!navigator.geolocation) { G.msg = "GPS is not supported in this browser."; return; }
  G.msg = "Waiting for GPS fix...";
  G.id = navigator.geolocation.watchPosition(p => {
    const c = p.coords; if (!G.anchor) G.anchor = { lat: c.latitude, lon: c.longitude }; // first fix = map centre
    G.me = GM.ready ? toXY(c.latitude, c.longitude) : [clamp(400 + (c.longitude - G.anchor.lon) * 111320 * Math.cos(c.latitude * Math.PI / 180) / 2, 0, W), clamp(250 - (c.latitude - G.anchor.lat) * 111320 / 2, 0, H)];
    G.ll = [c.latitude, c.longitude]; G.acc = c.accuracy; G.spd = c.speed; G.msg = "Live";
    G.trail.push(G.me); if (G.trail.length > 40) G.trail.shift();
    if (G.want) { G.want = false; setPick(G.me.slice(), G.ll); }
  }, e => { G.msg = e.code === 1 ? "Permission denied. Allow location access in the browser." : "GPS error: " + e.message; gpsStop(true); },
  { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
}
function gpsStop(keepMsg) {
  if (G.id !== null) navigator.geolocation.clearWatch(G.id);
  G.id = null; G.me = G.ll = G.anchor = null; G.trail = []; Object.values(GM.maps).forEach(m => { m.panned = false; }); if (!keepMsg) G.msg = "GPS off";
}

/* ---------- geometry ---------- */
const len = r => { let L = 0; for (let i = 1; i < r.length; i++) L += Math.hypot(r[i][0] - r[i - 1][0], r[i][1] - r[i - 1][1]); return L; };
function at(r, d) {
  const L = len(r); d %= 2 * L; if (d > L) d = 2 * L - d;
  for (let i = 1; i < r.length; i++) {
    const a = r[i - 1], b = r[i], s = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (d <= s) { const t = d / s; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }
    d -= s;
  }
  return r[r.length - 1];
}
function segD(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], t = clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
function roadWeight(p) {
  let best = [1e9, 0.3];
  for (const r of ROADS) for (let i = 1; i < r.p.length; i++) { const d = segD(p, r.p[i - 1], r.p[i]); if (d < best[0]) best = [d, r.w]; }
  return best[1];
}

/* ---------- severity score: 0.4 Size + 0.3 Traffic + 0.3 Risk ---------- */
function score(i) {
  i.traffic = i.road != null ? i.road : Math.round(roadWeight([i.x, i.y]) * 100);
  let m = 1e9; for (const p of POIS) m = Math.min(m, Math.hypot(p.x - i.x, p.y - i.y));
  i.risk = i.near != null ? i.near : (m < 45 ? 100 : m < 100 ? 50 : 10);
  i.score = Math.round(0.4 * i.size + 0.3 * i.traffic + 0.3 * i.risk);
  i.f = feats(i); i.ai = aiScore(i.f);
  i.level = level(AI.on ? i.ai : i.score);
  if (i.level === "Critical" && !i.cA && i.status === "Open") { i.cA = 1; notify({ to: "admin", type: "crit", id: i.id, title: `CRITICAL: ${i.id} ${i.type}`, text: `${i.confirmed ? "Confirmed" : "Unconfirmed"}, priority ${AI.on ? i.ai : i.score}. Assign a repair team now.` }); }
}

/* ---------- server: merge within 10 m (5 px) and 24 h, confirm at 2+ reports ---------- */
function report(o) {
  const now = Date.now();
  let i = S.issues.find(q => q.type === o.type && q.status !== "Fixed" && now - q.t < 864e5 && Math.hypot(q.x - o.x, q.y - o.y) <= 5);
  const isNew = !i, wasC = !!(i && i.confirmed);
  if (i) {
    i.reports++; i.x = (i.x * (i.reports - 1) + o.x) / i.reports; i.y = (i.y * (i.reports - 1) + o.y) / i.reports;
    i.size = Math.max(i.size, o.size); i.srcs.add(o.src); if (o.by && !(i.by || []).includes(o.by)) (i.by = i.by || []).push(o.by);
    if (o.photo && !i.photo) i.photo = o.photo;
  } else {
    i = { id: "PS-" + String(S.id++).padStart(3, "0"), type: o.type, x: o.x, y: o.y, size: o.size, reports: 1, srcs: new Set([o.src]),
      status: "Open", t: now, note: o.note || "", photo: o.photo || "", sure: !!o.sure, dev: false, hole: undefined, road: o.road == null ? null : o.road, near: o.near == null ? null : o.near, by: o.by ? [o.by] : [], hist: [[now, "Reported"]] };
    S.issues.push(i);
  }
  if (o.dev) { i.dev = true; if (o.hole !== undefined) i.hole = o.hole; }
  i.confirmed = i.sure || i.reports >= 2;
  score(i); S.v++;
  if (isNew && !o.sure && i.level !== "Critical") notify({ to: "admin", type: "info", id: i.id, title: `New report ${i.id}`, text: `${i.type}, ${i.level}, from ${o.src}.` });
  if (!isNew && !wasC && i.confirmed) {
    (i.hist = i.hist || []).push([Date.now(), "Confirmed"]);
    notify({ to: "admin", type: "warn", id: i.id, title: `${i.id} confirmed`, text: `${i.type}: ${i.reports} reports now match.` });
    notify({ to: "user", type: "ok", id: i.id, title: `Report ${i.id} confirmed`, text: "Another report matched yours. The issue is now confirmed." });
  }
  persist(); return i;
}

/* ---------- vehicle device: sense -> quick check -> AI detect ---------- */
function hit(dv, k) {
  const h = k === null ? null : HOLES[k], isBreaker = h && h[2] === "Speed breaker";
  const shake = h ? (isBreaker ? rnd(1.6, 2.4) : rnd(1.3, 3.8)) : rnd(1.5, 2.1);
  let photo = h && !isBreaker ? rnd(0.65, 0.95) : rnd(0.3, 0.6);
  if (S.rain) photo *= 0.75;
  S.m.ev++;
  if (shake < 1.5) { S.m.drop++; return log(`${dv.name}: shake ${shake.toFixed(1)} g, too small. Dropped on device.`); }
  if (isBreaker) return log(`${dv.name}: AI classified a speed breaker. Not a defect.`);
  const conf = 0.6 * photo + 0.4 * clamp(shake / 3.5, 0, 1);
  if (conf < 0.55) { S.m.drop++; return log(`${dv.name}: AI confidence ${(conf * 100).toFixed(0)}%, rejected.`); }
  const i = report({ type: "Pothole", x: dv.x + rnd(-2, 2), y: dv.y + rnd(-2, 2), size: clamp((shake - 1) / 2.8 * 100), src: dv.id, dev: true, hole: k === null ? undefined : k });
  log(`${dv.name}: pothole detected (${(conf * 100).toFixed(0)}%). ${i.id} ${i.confirmed ? "Confirmed" : "Unconfirmed"}, ${i.level}.`);
}

/* ---------- fixed pole: water level, bin, street light ---------- */
function poleTick(dt) {
  P.water = clamp(P.water + rnd(-0.8, S.rain ? 2.2 : 1.1) * dt, 0, 30);
  P.bin = clamp(P.bin + rnd(0, 0.9) * dt, 0, 100);
  if (Math.random() < 0.004 * dt) P.light = false;
  const chk = (type, bad, val, size) => {
    if (bad && !P.flag[type]) { P.flag[type] = 1; const i = report({ type, x: SPOT[type][0], y: SPOT[type][1], size, src: "D3", sure: true }); log(`Pole-03: ${type} (${val}). ${i.id}, ${i.level}.`); notify({ to: "admin", type: "warn", id: i.id, title: `Pole-03 alert: ${type}`, text: `${val}. Issue ${i.id} created (${i.level}).` }); }
  };
  chk("Waterlogging", P.water > 15, P.water.toFixed(0) + " cm", clamp(P.water * 3.3));
  chk("Bin full", P.bin > 85, P.bin.toFixed(0) + "%", P.bin);
  chk("Street light off", !P.light, "light is off", 55);
}
function resetSensor(type) {
  delete P.flag[type];
  if (type === "Waterlogging") P.water = 4; if (type === "Bin full") P.bin = 10; if (type === "Street light off") P.light = true;
}

/* ---------- simulation loop ---------- */
let TK = 0;
setInterval(() => {
  if (!DEMO) { TK++; if (TK % 10 === 0) { S.issues.forEach(score); panels(); } if (TK % 5 === 0) drawMaps(); return; } // production: no fake data
  if (!S.run) return;
  const dt = 0.1 * S.speed; S.t += dt;
  for (const dv of DEV) {
    dv.d += dv.v * dt;
    [dv.x, dv.y] = at(dv.route, dv.d);
    (dv.trail ||= []).push([dv.x, dv.y]); if (dv.trail.length > 25) dv.trail.shift();
    HOLES.forEach((h, k) => { if (Math.hypot(dv.x - h[0], dv.y - h[1]) < 3 && !(dv.cool[k] > S.t)) { dv.cool[k] = S.t + 40; hit(dv, k); } });
    if (Math.random() < 0.02 * dt) hit(dv, null); // occasional false alarm (manhole, rough patch)
  }
  poleTick(dt); drawMaps(); if (Math.round(S.t * 10) % 10 === 0) { S.issues.forEach(score); panels(); }
}, 100);

/* ---------- actions ---------- */
function setStatus(i, st) { if (!isAdmin()) return; if (st === "Assigned") learn(i); i.status = st; if (st === "Fixed") resetSensor(i.type); (i.hist = i.hist || []).push([Date.now(), st]); log(`${i.id} marked ${st}.`); notify({ to: "user", type: st === "Fixed" ? "ok" : "info", id: i.id, title: `Report ${i.id} is now ${st}`, text: st === "Assigned" ? "A repair team has been assigned." : "The problem is fixed. Thank you for reporting." }); persist(); S.v++; ui(); }
function log(m) { S.log.unshift([new Date().toLocaleTimeString("en-GB"), m]); S.log.length = Math.min(S.log.length, 40); }

/* ---------- rendering ---------- */
function mapSVG(pick) {
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Road map">`;
  for (const r of ROADS) { const pts = r.p.map(p => p.join(",")).join(" "); s += `<polyline class="road" points="${pts}"/><polyline class="mark" points="${pts}"/>`; }
  s += `<text class="rname" x="50" y="236">Campus Rd</text><text class="rname" x="268" y="70">Ashulia Rd</text><text class="rname" x="548" y="80">Market Rd</text><text class="rname" x="600" y="432">Link Rd</text>`;
  for (const p of POIS) s += `<g><rect x="${p.x - 12}" y="${p.y - 42}" width="24" height="24" rx="4" fill="#fff"/><text x="${p.x}" y="${p.y - 25}" text-anchor="middle" font-size="14" font-weight="700" fill="#1c2226">${p.i}</text><text x="${p.x}" y="${p.y - 46}" text-anchor="middle" font-size="10" fill="#9fb0b7">${p.t}</text></g>`;
  for (const i of S.issues) {
    if (i.status === "Fixed") continue;
    s += `<circle class="iss ${i.confirmed ? "" : "un"} ${i.level === "Critical" ? "crit" : ""} ${S.sel === i.id ? "sel" : ""}" data-id="${i.id}" cx="${i.x.toFixed(1)}" cy="${i.y.toFixed(1)}" r="${(6 + i.size / 14).toFixed(1)}" fill="${color(i.level)}"><title>${i.id} ${i.type} (${i.level})</title></circle>`;
  }
  for (const d of DEV) if (d.trail && d.trail.length > 1) s += `<polyline points="${d.trail.map(p => p.map(Math.round).join(",")).join(" ")}" fill="none" stroke="#f2c230" stroke-width="3" opacity=".55" stroke-linecap="round"/>`;
  if (G.me) {
    if (G.trail.length > 1) s += `<polyline points="${G.trail.map(p => p.map(Math.round).join(",")).join(" ")}" fill="none" stroke="#3b82f6" stroke-width="3" opacity=".7"/>`;
    s += `<circle cx="${G.me[0]}" cy="${G.me[1]}" r="${clamp(G.acc / 2, 6, 60)}" fill="#3b82f6" opacity=".2"/><circle cx="${G.me[0]}" cy="${G.me[1]}" r="6" fill="#3b82f6" stroke="#fff" stroke-width="2"/><text x="${G.me[0] + 10}" y="${G.me[1] - 8}" font-size="11" fill="#9cc3ff">You</text>`;
  }
  for (const d of DEV) if (d.x !== undefined) s += `<rect class="dev" x="${d.x - 6}" y="${d.y - 6}" width="12" height="12" rx="3"/><text x="${d.x + 10}" y="${d.y - 8}" font-size="10" fill="#fff">${d.name}</text>`;
  s += `<polygon class="dev" points="540,236 547,250 533,250" transform="translate(0,-6)"/><text x="556" y="228" font-size="10" fill="#fff">Pole-03</text>`;
  if (pick && S.pick) s += `<circle cx="${S.pick[0]}" cy="${S.pick[1]}" r="9" fill="none" stroke="#f2c230" stroke-width="3"/><circle cx="${S.pick[0]}" cy="${S.pick[1]}" r="2.5" fill="#f2c230"/>`;
  return s + "</svg>";
}
function drawMaps() {
  const d = $("#dash").classList.contains("on"), c = $("#cit").classList.contains("on");
  if (GM.ready) { if (d) gmSync("dash", "#map"); if (c) gmSync("cit", "#cmap"); return; } // Google Maps mode
  if (!DEMO) { if (d) keyBox("#map"); if (c) keyBox("#cmap"); return; } // no fake map in production
  if (d) $("#map").innerHTML = mapSVG(false);
  if (c) $("#cmap").innerHTML = mapSVG(true);
}
const badge = l => `<span class="badge" style="--c:${color(l)}">${l}</span>`;
function panels() {
  const act = S.issues.filter(i => i.status !== "Fixed"), cr = act.filter(i => i.level === "Critical").length;
  alertBar(act); extras();
  $("#stats").innerHTML = [["Active issues", act.length], ["Confirmed", act.filter(i => i.confirmed).length], ["Critical", cr, "crit"], ["Assigned", act.filter(i => i.status === "Assigned").length], ["Fixed", S.issues.length - act.length], ...(DEMO ? [["Events sensed", S.m.ev]] : [])]
    .map(s => `<div class="stat ${s[2] || ""}"><b>${s[1]}</b><span>${s[0]}</span></div>`).join("");
  const fl = $("#fLevel").value, fs = $("#fStatus").value;
  const rows = S.issues.filter(i => (!fl || i.level === fl) && (!fs ? i.status !== "Fixed" : i.status === fs)).sort((a, b) => AI.on ? b.ai - a.ai : b.score - a.score);
  $("#list").innerHTML = rows.map(i => `<li data-id="${i.id}" class="${S.sel === i.id ? "sel" : ""}"><span class="t">${i.id} ${i.type}<br><small>${i.confirmed ? "Confirmed" : "Unconfirmed"} · ${i.reports} report${i.reports > 1 ? "s" : ""} · ${i.status}</small></span>${badge(i.level)}<b>${AI.on ? i.ai : i.score}</b></li>`).join("") || `<li class="muted">No reports yet.</li>`;
  const i = S.issues.find(q => q.id === S.sel);
  if (i) geo(i);
  $("#detail").innerHTML = i ? `<h3>${i.id}: ${i.type} ${badge(i.level)}</h3>
    ${["Size", "Traffic", "Risk"].map(k => `<div>${k} ${Math.round(i[k.toLowerCase()])}<div class="bar"><i style="width:${i[k.toLowerCase()]}%"></i></div></div>`).join("")}
    <div class="kv"><span>Formula score</span><b>0.4×${Math.round(i.size)} + 0.3×${i.traffic} + 0.3×${i.risk} = ${i.score}</b></div>
    <div class="kv"><span>AI priority</span><b>${i.ai}</b></div>
    <p class="muted">AI reasons: ${why(i)}</p>
    <div class="kv"><span>GPS</span><span>${toLL(i.x, i.y).map(v => v.toFixed(5)).join(", ")}</span></div>
    <div class="kv"><span>Reports / sources</span><span>${i.reports} / ${[...i.srcs].join(", ")}</span></div>
    ${i.addr ? `<div class="kv"><span>Address</span><span>${esc(i.addr)}</span></div>` : ""}<div class="kv"><span>Status</span><b>${i.status}</b></div>
    <p class="muted">${(i.hist || []).map(h => new Date(h[0]).toLocaleString("en-GB") + ": " + h[1]).join("<br>")}</p>
    ${i.note ? `<p>Note: ${esc(i.note)}</p>` : ""}${i.photo ? `<img src="${i.photo}" alt="Reported photo" style="max-width:100%;max-height:120px;border-radius:6px">` : ""}
    <div class="detail-btns"><button data-act="Assigned" ${i.status !== "Open" ? "disabled" : ""}>Assign repair team</button><button class="ghost" data-act="Fixed" ${i.status === "Fixed" ? "disabled" : ""}>Mark fixed</button></div>`
    : `<p class="muted">Select an issue on the map or in the list.</p>`;
  $("#pole").innerHTML = `<div class="kv"><span>Water on road</span><b>${P.water.toFixed(0)} cm</b></div><div class="kv"><span>Bin fill</span><b>${P.bin.toFixed(0)}%</b></div><div class="kv"><span>Street light</span><b>${P.light ? "On" : "Off"}</b></div><p class="muted">Alerts at water above 15 cm, bin above 85%, or light off.</p>`;
  const dv = S.issues.filter(q => q.dev), tp = dv.filter(q => q.hole !== undefined).length, fp = dv.length - tp;
  const total = HOLES.filter(h => h[2] === "Pothole").length, found = new Set(dv.filter(q => q.hole !== undefined).map(q => q.hole)).size;
  $("#eval").innerHTML = `<div class="kv"><span>Precision</span><b>${dv.length ? Math.round(tp / dv.length * 100) + "%" : "n/a"}</b></div><div class="kv"><span>Recall</span><b>${Math.round(found / total * 100)}% (${found}/${total})</b></div><div class="kv"><span>False alarms</span><b>${fp}</b></div><p class="muted">Target: both above 80%. Compared against the hidden ground truth.</p>`;
  gpsPanel(); aiPanel();
  $("#log").innerHTML = S.log.slice(0, 12).map(l => `<li><time>${l[0]}</time>${esc(l[1])}</li>`).join("");
  $("#mine").innerHTML = S.mine.map(id => S.issues.find(q => q.id === id)).filter(Boolean).map(q => `<li><span class="t">${q.id} ${q.type}<br><small>${q.confirmed ? "Confirmed" : "Waiting for a 2nd report"}</small></span>${badge(q.level)}<b>${q.status}</b></li>`).join("");
}
const esc = t => String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function gpsPanel() {
  const f = p => toLL(p[0], p[1]).map(v => v.toFixed(5)).join(", ");
  let h = DEV.filter(d => d.x !== undefined).map(d => `<div class="kv"><span>${d.name}</span><b>${f([d.x, d.y])}</b></div>`).join("") + `<div class="kv"><span>Pole-03</span><b>${f([540, 250])}</b></div>`;
  if (G.id !== null && G.ll) h += `<div class="kv"><span>You (live)</span><b>${G.ll.map(v => v.toFixed(5)).join(", ")}</b></div><div class="kv"><span>Accuracy / speed</span><b>±${Math.round(G.acc)} m / ${G.spd != null ? (G.spd * 3.6).toFixed(1) : "0.0"} km/h</b></div>`;
  else h += `<p class="muted">${G.msg}</p>`;
  $("#gps").innerHTML = h; $("#gpsBtn").textContent = G.id !== null ? "Stop tracking me" : "Track my location";
}
function aiPanel() {
  $("#aiW").innerHTML = FN.map((n, k) => `<div class="kv"><span>${n}</span><b>${Math.round(AI.w[k] * 100)}%</b></div>`).join("");
  $("#aiN").textContent = `Officer decisions: ${AI.n}. Overrides learned: ${AI.over}. Assign a lower-ranked issue first and the model shifts its weights.`;
}
function ui() { drawMaps(); panels(); }

/* ---------- events ---------- */
document.addEventListener("click", e => {
  const tb = e.target.closest("#tabs button");
  if (tb) { show(tb.dataset.tab); return; }
  const it = e.target.closest("[data-id]"); if (it) { S.sel = it.dataset.id; ui(); return; }
  const ac = e.target.closest("[data-act]"); if (ac) { const i = S.issues.find(q => q.id === S.sel); if (i) setStatus(i, ac.dataset.act); return; }
  const cm = !GM.ready && e.target.closest("#cmap svg");
  if (cm) { const pt = cm.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; const q = pt.matrixTransform(cm.getScreenCTM().inverse());
    setPick([Math.round(q.x), Math.round(q.y)]); drawMaps(); }
});
$("#play").onclick = e => { S.run = !S.run; e.target.textContent = S.run ? "Pause" : "Play"; };
$("#speed").onchange = e => S.speed = +e.target.value;
$("#rain").onchange = e => { S.rain = e.target.checked; log(S.rain ? "Rain/night mode on: photo confidence drops, water rises faster." : "Rain/night mode off."); };
$("#reset").onclick = () => { if (confirm("Delete ALL reports? This cannot be undone.")) { store.set("ps_issues", []); init(); } };
$("#fLevel").onchange = $("#fStatus").onchange = panels;
/* photo + camera handlers are in the camera module near the bottom */
$("#form").onsubmit = e => {
  e.preventDefault();
  if (!S.pick) { $("#msg").textContent = "Click on the map first to choose the location."; return; }
  const i = report({ type: $("#cType").value, x: S.pick[0], y: S.pick[1], size: +$("#cSize").value, src: "Citizen", road: +$("#cRoad").value, near: +$("#cNear").value, by: SESS && SESS.email, note: $("#cNote").value.trim(), photo: $("#prev").hidden ? "" : $("#prev").src });
  if (!S.mine.includes(i.id)) S.mine.push(i.id);
  log(`Citizen report ${i.id}: ${i.type}.`);
  notify({ to: "user", type: "ok", id: i.id, title: `Report ${i.id} received`, text: i.confirmed ? "Confirmed." : "Unconfirmed until a 2nd report matches." });
  $("#msg").textContent = `Sent. Your report ID is ${i.id}. Status: ${i.confirmed ? "Confirmed" : "Unconfirmed until a 2nd report matches"}.`;
  S.pick = null; $("#locTxt").textContent = "Location: not chosen yet"; $("#form").reset(); clearPhoto(); ui();
};
$("#gpsBtn").onclick = () => { if (G.id !== null) gpsStop(); else gpsStart(); panels(); };
$("#useGps").onclick = () => { if (G.id !== null && G.ll) setPick(G.me.slice(), G.ll); else { G.want = true; if (G.id === null) gpsStart(); } drawMaps(); };
$("#aiOn").onchange = e => { AI.on = e.target.checked; S.issues.forEach(score); ui(); };
$("#aiReset").onclick = () => { AI.w = W0.slice(); AI.n = AI.over = 0; aiSave(); S.issues.forEach(score); ui(); };
/* ---------- accounts: sign up / log in. Admin email opens the dashboard, everyone else gets the user page ---------- */
/* Demo only: accounts are kept in this browser (localStorage), so this is not real security. */
const ADMIN = { email: "admin@gmail.com", pass: "admin1", name: "Admin" };
const store = { get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
let SESS = null; try { SESS = JSON.parse(sessionStorage.getItem("ps_sess")); } catch (e) {}
const isAdmin = () => !!SESS && SESS.role === "admin";
async function hash(p, e) {
  if (window.crypto && crypto.subtle) { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(e + ":" + p)); return "s:" + [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join(""); }
  return "b:" + btoa(unescape(encodeURIComponent(e + ":" + p)));
}
function show(tab) {
  if (tab === "dash" && !isAdmin()) return;
  if (tab !== "cit") camStop();
  document.querySelectorAll("#tabs button,.tab").forEach(x => x.classList.remove("on"));
  const b = document.querySelector(`#tabs [data-tab="${tab}"]`); if (b) b.classList.add("on");
  $("#" + tab).classList.add("on"); ui();
}
function authUI() {
  const r = SESS ? SESS.role : "";
  document.querySelector('[data-tab="dash"]').hidden = r !== "admin";
  document.querySelector('[data-tab="cit"]').hidden = r !== "user";
  document.querySelector('[data-tab="about"]').hidden = !SESS;
  $("#logout").hidden = !SESS; $("#who").textContent = SESS ? `${SESS.name} (${r})` : "";
  bell();
  show(!SESS ? "auth" : r === "admin" ? "dash" : "cit");
}
const msg = t => { $("#lMsg").textContent = t; };
function signIn(s) {
  SESS = s; S.mine = s.role === "user" ? S.issues.filter(q => (q.by || []).includes(s.email)).map(q => q.id) : []; try { sessionStorage.setItem("ps_sess", JSON.stringify(s)); } catch (e) {}
  document.querySelectorAll("#fLogin,#fSign").forEach(f => f.reset()); msg(""); authUI();
}
$("#mLogin").onclick = $("#mSign").onclick = e => {
  const s = e.target.id === "mSign"; $("#fLogin").hidden = s; $("#fSign").hidden = !s;
  $("#mLogin").classList.toggle("on", !s); $("#mSign").classList.toggle("on", s); msg("");
};
$("#fLogin").onsubmit = async e => {
  e.preventDefault(); const em = $("#lEmail").value.trim().toLowerCase(), pw = $("#lPass").value;
  if (em === ADMIN.email && pw === ADMIN.pass) return signIn({ role: "admin", email: em, name: ADMIN.name });
  const u = store.get("ps_users", []).find(x => x.email === em);
  if (u && u.hash === await hash(pw, em)) return signIn({ role: "user", email: em, name: u.name });
  msg("Wrong email or password. No account yet? Use Sign up."); $("#lPass").value = "";
};
$("#fSign").onsubmit = async e => {
  e.preventDefault();
  const name = $("#sName").value.trim(), em = $("#sEmail").value.trim().toLowerCase(), pw = $("#sPass").value, users = store.get("ps_users", []);
  if (pw !== $("#sPass2").value) return msg("Passwords do not match.");
  if (em === ADMIN.email || users.some(x => x.email === em)) return msg("An account with this email already exists. Log in instead.");
  users.push({ name, email: em, hash: await hash(pw, em) }); store.set("ps_users", users);
  signIn({ role: "user", email: em, name });
};
$("#logout").onclick = () => {
  SESS = null; S.sel = null; S.mine = []; gpsStop();
  try { sessionStorage.removeItem("ps_sess"); } catch (e) {} authUI();
};
$("#track").onclick = () => {
  const id = $("#tid").value.trim().toUpperCase(), i = S.issues.find(q => q.id === id);
  if (i && !S.mine.includes(id)) S.mine.push(id);
  $("#msg").textContent = i ? `${i.id}: ${i.status}, ${i.level}.` : "No report found with that ID."; panels();
};

/* =====================================================================
   NEW FEATURES
   1) Google Maps live interactive map   2) Notifications & alerts   3) Camera photo capture
   ===================================================================== */

/* ---------- 1. Google Maps live interactive map ---------- */
// Paste your key here (enable "Maps JavaScript API" in Google Cloud). With no key, the built-in simulated map is used.
const GMAPS_KEY = store.get("ps_gkey", "") || "YOUR_GOOGLE_MAPS_API_KEY";
const GM = { ready: false, maps: {} };
const toXY = (lat, lon) => [400 + (lon - BASE.lon) * 111320 * Math.cos(BASE.lat * Math.PI / 180) / 2, 250 - (lat - BASE.lat) * 111320 / 2];
const ll2 = p => { const l = toLL(p[0], p[1]); return { lat: l[0], lng: l[1] }; };
const gIcon = (fill, scale, stroke, sw, op = 1) => ({ path: google.maps.SymbolPath.CIRCLE, fillColor: fill, fillOpacity: op, strokeColor: stroke, strokeWeight: sw, scale });
const mapNote = t => document.querySelectorAll(".mapnote").forEach(n => { n.textContent = t; });

function gmLoad() {
  if (!GMAPS_KEY || /^YOUR_/.test(GMAPS_KEY)) { mapNote(DEMO ? "Built-in simulated map. Save a Google Maps API key to use Google Maps." : ""); return; }
  window.gm_authFailure = () => { gmOff(); mapNote("Google Maps key was rejected. Showing the built-in map."); ui(); };
  window.gmReady = () => { GM.ready = true; mapNote("Live Google Map. Use the Map / Satellite switch on the map."); ui(); };
  const s = document.createElement("script");
  s.async = true; s.src = "https://maps.googleapis.com/maps/api/js?key=" + encodeURIComponent(GMAPS_KEY) + "&callback=gmReady";
  s.onerror = () => mapNote("Could not load Google Maps (offline?). Showing the built-in map.");
  document.head.appendChild(s);
}
function gmOff() { GM.ready = false; GM.maps = {}; ["#map", "#cmap"].forEach(s => { $(s).classList.remove("gm"); $(s).innerHTML = ""; delete $(s).dataset.ph; }); }

function gmMap(key, sel) {
  if (GM.maps[key]) return GM.maps[key];
  const el = $(sel); el.innerHTML = ""; el.classList.add("gm");
  const map = new google.maps.Map(el, { center: ll2([400, 250]), zoom: 17, mapTypeControl: true, streetViewControl: false, fullscreenControl: true, gestureHandling: "greedy", clickableIcons: false });
  if (DEMO) { const b = new google.maps.LatLngBounds(); b.extend(ll2([0, 0])); b.extend(ll2([W, H])); map.fitBounds(b); } else map.setZoom(15);
  if (DEMO) {
  ROADS.forEach(r => new google.maps.Polyline({ map, path: r.p.map(ll2), strokeColor: "#0f6e6e", strokeOpacity: 0.7, strokeWeight: 5, clickable: false }));
  POIS.forEach(p => new google.maps.Marker({ map, position: ll2([p.x, p.y]), title: p.t, clickable: false, label: { text: p.i, color: "#1c2226", fontWeight: "700" }, icon: gIcon("#ffffff", 11, "#1c2226", 2) }));
  new google.maps.Marker({ map, position: ll2([540, 250]), title: "Pole-03", clickable: false, label: { text: "Pole-03", className: "gml" }, icon: { path: "M0,-9 L9,7 L-9,7 Z", fillColor: "#ffffff", fillOpacity: 1, strokeColor: "#f2c230", strokeWeight: 3, scale: 1 } });
  }
  const m = { map, it: {}, dev: {}, pick: null, me: null, acc: null, panned: false };
  if (key === "cit") map.addListener("click", e => {
    const la = e.latLng.lat(), lo = e.latLng.lng(), p = toXY(la, lo);
    setPick([Math.round(p[0]), Math.round(p[1])], [la, lo]); drawMaps();
  });
  return (GM.maps[key] = m);
}
function gmSync(key, sel) {
  const m = gmMap(key, sel), seen = new Set();
  for (const i of S.issues) {
    if (i.status === "Fixed") continue;
    seen.add(i.id);
    const pos = ll2([i.x, i.y]), on = S.sel === i.id, sig = [i.level, i.confirmed, on, Math.round(i.size / 8)].join("|");
    let o = m.it[i.id];
    if (!o) {
      const mk = new google.maps.Marker({ map: m.map, position: pos, zIndex: 10 });
      mk.addListener("click", () => { S.sel = i.id; ui(); });
      o = m.it[i.id] = { mk, sig: "" };
    }
    o.mk.setPosition(pos);
    if (o.sig !== sig) {
      o.sig = sig;
      o.mk.setIcon(gIcon(color(i.level), 7 + i.size / 12, on ? "#f2c230" : "#ffffff", on ? 4 : 2, i.confirmed ? 0.95 : 0.5));
      o.mk.setTitle(i.id + " " + i.type + " (" + i.level + (i.confirmed ? "" : ", unconfirmed") + ")");
      o.mk.setZIndex(on ? 50 : 10);
    }
  }
  if (!m.fit && !DEMO && S.issues.length) { // first view: zoom to the real reports
    m.fit = 1; const b = new google.maps.LatLngBounds(); S.issues.forEach(i => b.extend(ll2([i.x, i.y]))); m.map.fitBounds(b, 60);
    google.maps.event.addListenerOnce(m.map, "idle", () => { if (m.map.getZoom() > 17) m.map.setZoom(17); });
  }
  for (const id in m.it) if (!seen.has(id)) { m.it[id].mk.setMap(null); delete m.it[id]; }
  for (const d of DEMO ? DEV : []) if (d.x !== undefined) {
    let o = m.dev[d.id];
    if (!o) o = m.dev[d.id] = {
      mk: new google.maps.Marker({ map: m.map, title: d.name, clickable: false, zIndex: 20, label: { text: d.name, className: "gml" }, icon: gIcon("#ffffff", 7, "#f2c230", 3) }),
      tr: new google.maps.Polyline({ map: m.map, strokeColor: "#f2c230", strokeOpacity: 0.8, strokeWeight: 4, clickable: false })
    };
    o.mk.setPosition(ll2([d.x, d.y])); o.tr.setPath((d.trail || []).map(ll2));
  }
  if (G.me && G.ll) {
    const pos = { lat: G.ll[0], lng: G.ll[1] };
    if (!m.me) {
      m.me = new google.maps.Marker({ map: m.map, title: "You", zIndex: 60, label: { text: "You", className: "gml" }, icon: gIcon("#3b82f6", 7, "#ffffff", 2) });
      m.acc = new google.maps.Circle({ map: m.map, strokeWeight: 0, fillColor: "#3b82f6", fillOpacity: 0.15, clickable: false });
    }
    m.me.setPosition(pos); m.acc.setCenter(pos); m.acc.setRadius(G.acc || 10);
    if (!m.panned) { m.panned = true; m.map.panTo(pos); if (m.map.getZoom() < 17) m.map.setZoom(17); }
  } else if (m.me) { m.me.setMap(null); m.acc.setMap(null); m.me = m.acc = null; }
  if (key === "cit" && S.pick) {
    if (!m.pick) m.pick = new google.maps.Marker({ map: m.map, title: "Chosen location", zIndex: 70, clickable: false, icon: gIcon("#f2c230", 8, "#1c2226", 3) });
    m.pick.setPosition(ll2(S.pick));
  } else if (m.pick) { m.pick.setMap(null); m.pick = null; }
}

/* ---------- 2. Notifications & alerts ---------- */
// to: "admin" or "user". type: info | ok | warn | crit. id: issue id (lets the item open that issue).
const NS = store.get("ps_alert", { sound: true, desk: false });
const N = { list: [], k: 0, sound: NS.sound !== false, desk: !!NS.desk && "Notification" in window && Notification.permission === "granted" };
const nSave = () => store.set("ps_alert", { sound: N.sound, desk: N.desk });
const forMe = n => !!SESS && n.to === SESS.role && (n.to !== "user" || !n.id || S.mine.includes(n.id));
let AC = null;
function beep(type) {
  if (!N.sound) return;
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === "suspended") AC.resume();
    const o = AC.createOscillator(), g = AC.createGain(), t = AC.currentTime, hi = type === "crit";
    o.type = "sine"; o.frequency.value = hi ? 880 : 620; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + (hi ? 0.5 : 0.25));
    o.connect(g); g.connect(AC.destination); o.start(t); o.stop(t + (hi ? 0.5 : 0.25));
  } catch (e) {}
}
function toast(n) {
  const box = $("#toasts"), el = document.createElement("div");
  el.className = "toast " + n.type; el.setAttribute("role", n.type === "crit" ? "alert" : "status");
  el.innerHTML = `<b>${esc(n.title)}</b><span>${esc(n.text || "")}</span><button type="button" aria-label="Dismiss">&times;</button>`;
  el.onclick = e => { if (!e.target.closest("button") && n.id && isAdmin()) { S.sel = n.id; show("dash"); } el.remove(); };
  box.appendChild(el); while (box.children.length > 4) box.firstChild.remove();
  setTimeout(() => el.remove(), n.type === "crit" ? 10000 : 6000);
}
function deskNote(n) {
  if (!N.desk || !("Notification" in window) || Notification.permission !== "granted") return;
  if (!document.hidden && n.type !== "crit") return;
  try { new Notification("PothSheba: " + n.title, { body: n.text, tag: "ps-" + n.k }); } catch (e) {}
}
function notify(n) {
  n = Object.assign({ to: "admin", type: "info", text: "", k: ++N.k, t: Date.now(), read: false }, n);
  N.list.unshift(n); N.list.length = Math.min(N.list.length, 60);
  if (forMe(n)) {
    toast(n); if (n.type !== "info") beep(n.type);
    if (n.type === "crit" && navigator.vibrate) navigator.vibrate([200, 100, 200]);
    deskNote(n);
  }
  bell();
}
function bell() {
  $("#bellwrap").hidden = !SESS; if (!SESS) $("#npanel").hidden = true;
  const l = N.list.filter(forMe), un = l.filter(n => !n.read).length;
  $("#bellN").hidden = !un; $("#bellN").textContent = un > 9 ? "9+" : un;
  $("#nlist").innerHTML = l.map(n => `<li class="${n.type} ${n.read ? "" : "unread"}" ${n.id ? `data-id="${n.id}"` : ""}><b>${esc(n.title)}</b>${esc(n.text)}<br><time>${new Date(n.t).toLocaleTimeString("en-GB")}</time></li>`).join("") || `<li class="muted">No notifications yet.</li>`;
  $("#nSound").checked = N.sound; $("#nDesk").textContent = N.desk ? "Desktop alerts: on" : "Enable desktop alerts";
}
function nOpen(open) {
  const p = $("#npanel"), was = !p.hidden; p.hidden = !open; $("#bell").setAttribute("aria-expanded", String(open));
  if (open) bell();
  if (was && !open) { N.list.filter(forMe).forEach(n => { n.read = true; }); bell(); }
}
function alertBar(act) {
  const c = act.filter(i => i.level === "Critical" && i.status === "Open").sort((a, b) => (AI.on ? b.ai - a.ai : b.score - a.score)), el = $("#alertbar");
  el.hidden = !c.length;
  if (c.length) el.innerHTML = `<b>${c.length} critical issue${c.length > 1 ? "s" : ""} waiting for a repair team.</b><button type="button" data-id="${c[0].id}">Show top priority (${c[0].id})</button>`;
}
$("#bell").onclick = e => { e.stopPropagation(); nOpen($("#npanel").hidden); };
document.addEventListener("click", e => { if (!e.target.closest("#bellwrap")) nOpen(false); });
$("#nRead").onclick = () => { N.list.filter(forMe).forEach(n => { n.read = true; }); bell(); };
$("#nClear").onclick = () => { N.list = N.list.filter(n => !forMe(n)); bell(); };
$("#nSound").onchange = e => { N.sound = e.target.checked; nSave(); };
$("#nTest").onclick = () => notify({ to: SESS ? SESS.role : "admin", type: "crit", title: "Test alert", text: "Alerts, sound and notifications are working." });
$("#nDesk").onclick = async () => {
  if (!("Notification" in window)) return toast({ type: "warn", title: "Not supported", text: "This browser has no desktop notifications." });
  if (N.desk) N.desk = false;
  else {
    const p = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    N.desk = p === "granted";
    if (!N.desk) toast({ type: "warn", title: "Permission denied", text: "Allow notifications in the browser site settings to turn this on." });
  }
  nSave(); bell();
};

/* ---------- 3. Camera: take a photo or choose a file ---------- */
const CAM = { stream: null, face: "environment" };
function setPhoto(u) { $("#prev").src = u; $("#prev").hidden = false; $("#rmPhoto").hidden = false; $("#camMsg").textContent = ""; }
function clearPhoto() {
  const p = $("#prev"); p.hidden = true; p.removeAttribute("src");
  $("#cPhoto").value = ""; $("#cPhotoCam").value = ""; $("#rmPhoto").hidden = true; $("#camMsg").textContent = ""; camStop();
}
function fileToPhoto(f) {
  if (!f) return;
  if (!/^image/.test(f.type)) { $("#camMsg").textContent = "Please choose an image file."; return; }
  const r = new FileReader();
  r.onload = () => {
    const im = new Image();
    im.onload = () => { // shrink big phone photos so the page stays fast
      const k = Math.min(1, 1024 / Math.max(im.width, im.height)), c = document.createElement("canvas");
      c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
      c.getContext("2d").drawImage(im, 0, 0, c.width, c.height); setPhoto(c.toDataURL("image/jpeg", 0.85));
    };
    im.onerror = () => setPhoto(r.result); im.src = r.result;
  };
  r.readAsDataURL(f);
}
async function camStart() {
  // No live camera API (or no HTTPS)? Fall back to the phone's native camera through the file picker.
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.isSecureContext) { $("#cPhotoCam").click(); return; }
  camStop();
  try {
    CAM.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: CAM.face }, width: { ideal: 1280 } }, audio: false });
    $("#camVid").srcObject = CAM.stream; $("#camBox").hidden = false; $("#camMsg").textContent = "";
  } catch (e) {
    $("#camMsg").textContent = e.name === "NotAllowedError" ? "Camera permission denied. Allow camera access, or use Choose file." : "Camera not available: " + e.message;
  }
}
function camStop() {
  if (CAM.stream) { CAM.stream.getTracks().forEach(t => t.stop()); CAM.stream = null; }
  const v = $("#camVid"); if (v) v.srcObject = null; const b = $("#camBox"); if (b) b.hidden = true;
}
function camSnap() {
  const v = $("#camVid"); if (!v.videoWidth) { $("#camMsg").textContent = "Camera is still starting. Try again."; return; }
  const k = Math.min(1, 1024 / Math.max(v.videoWidth, v.videoHeight)), c = document.createElement("canvas");
  c.width = Math.round(v.videoWidth * k); c.height = Math.round(v.videoHeight * k);
  c.getContext("2d").drawImage(v, 0, 0, c.width, c.height); setPhoto(c.toDataURL("image/jpeg", 0.85)); camStop();
}
$("#camBtn").onclick = camStart;
$("#fileBtn").onclick = () => $("#cPhoto").click();
$("#cPhoto").onchange = $("#cPhotoCam").onchange = e => fileToPhoto(e.target.files[0]);
$("#camSnap").onclick = camSnap;
$("#camOff").onclick = camStop;
$("#camFlip").onclick = () => { CAM.face = CAM.face === "environment" ? "user" : "environment"; camStart(); };
$("#rmPhoto").onclick = clearPhoto;

/* =====================================================================
   PRODUCTION MODE: demo simulation OFF by default, saved reports, analytics, CSV, address lookup
   ===================================================================== */
let DEMO = store.get("ps_demo", false) === true; // fake vehicles + pole only run when this is on
$("#demo").checked = DEMO;
$("#demo").onchange = e => { store.set("ps_demo", e.target.checked); location.reload(); };

function persist() { // only real citizen reports are saved (demo issues are never saved)
  store.set("ps_issues", S.issues.filter(i => i.srcs.has("Citizen")).map(i => Object.assign({}, i, { srcs: [...i.srcs] })));
}
function loadIssues() {
  store.get("ps_issues", []).forEach(o => { o.srcs = new Set(o.srcs); S.issues.push(o); S.id = Math.max(S.id, (+String(o.id).slice(3) || 0) + 1); });
  S.issues.forEach(score);
  S.mine = SESS && SESS.role === "user" ? S.issues.filter(i => (i.by || []).includes(SESS.email)).map(i => i.id) : [];
}
function geo(i) { // street address for the selected issue (needs Geocoding API enabled on the key)
  if (!GM.ready || i.geo || !google.maps.Geocoder) return;
  i.geo = 1;
  new google.maps.Geocoder().geocode({ location: ll2([i.x, i.y]) }, (r, s) => { if (s === "OK" && r[0]) { i.addr = r[0].formatted_address; persist(); } });
}
function extras() {
  document.querySelectorAll(".demoonly").forEach(e => { e.hidden = !DEMO; });
  const T = ["Pothole", "Crack", "Waterlogging", "Bin full", "Street light off"], c = t => S.issues.filter(i => i.type === t).length, mx = Math.max(1, ...T.map(c));
  const fx = S.issues.filter(i => i.status === "Fixed").map(i => { const h = (i.hist || []).find(x => x[1] === "Fixed"); return h ? h[0] - i.t : null; }).filter(v => v !== null);
  const avg = fx.length ? fx.reduce((a, b) => a + b, 0) / fx.length / 6e4 : null;
  $("#ana").innerHTML = T.map(t => `<div>${t} <b>${c(t)}</b><div class="bar"><i style="width:${c(t) / mx * 100}%"></i></div></div>`).join("")
    + `<div class="kv"><span>Avg time to fix</span><b>${avg === null ? "n/a" : avg < 90 ? Math.round(avg) + " min" : (avg / 60).toFixed(1) + " h"}</b></div>`;
}
function keyBox(sel) {
  const el = $(sel); if (el.dataset.ph) return; el.dataset.ph = 1;
  el.innerHTML = `<div class="keybox"><b>Connect Google Maps</b><p>Paste a Google Maps API key (enable Maps JavaScript API and Geocoding API).</p><div class="row"><input class="gk" placeholder="AIza..." aria-label="Google Maps API key"><button type="button" class="gks">Save key</button></div></div>`;
}
document.addEventListener("click", e => {
  const b = e.target.closest(".gks"); if (!b) return;
  const v = b.parentNode.querySelector(".gk").value.trim(); if (v) { store.set("ps_gkey", v); location.reload(); }
});
$("#csv").onclick = () => {
  const q = v => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
  const rows = [["ID", "Type", "Severity", "Score", "Status", "Reports", "Latitude", "Longitude", "Address", "Reported at", "Note"]].concat(S.issues.map(i => {
    const l = toLL(i.x, i.y); return [i.id, i.type, i.level, AI.on ? i.ai : i.score, i.status, i.reports, l[0].toFixed(6), l[1].toFixed(6), i.addr || "", new Date(i.t).toISOString(), i.note];
  }));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([rows.map(r => r.map(q).join(",")).join("\n")], { type: "text/csv" })); a.download = "pothsheba-reports.csv"; a.click();
};

init();
authUI();
gmLoad();
