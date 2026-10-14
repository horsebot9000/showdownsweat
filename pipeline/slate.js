/* DK CSV parsing + matching to model players. Pure JS. */
(function (root) {
'use strict';
function parseCSV(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); f = ''; if (row.some((x) => x !== '')) rows.push(row); row = []; }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); if (row.some((x) => x !== '')) rows.push(row); }
  return rows;
}
const norm = (s) => (s || '').toLowerCase().replace(/[\.\'’,]/g, '').replace(/-/g, ' ').replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '').replace(/\s+/g, ' ').trim();
const INACTIVE = new Set(['OUT', 'O', 'IR', 'D', 'PUP', 'SUSP', 'NA', 'NFI', 'DND']);
function parseDK(text) {
  const rows = parseCSV(text); const h = rows[0].map((x) => x.trim());
  const ix = (n) => h.indexOf(n);
  const iPos = ix('Position'), iName = ix('Name'), iId = ix('ID'), iRP = ix('Roster Position'), iSal = ix('Salary'), iGI = ix('Game Info'), iTm = ix('TeamAbbrev'), iAvg = ix('AvgPointsPerGame'), iSt = ix('Status');
  const map = new Map(); let gameInfo = '';
  for (const r of rows.slice(1)) {
    if (!r[iName]) continue;
    const key = r[iName] + '|' + r[iTm]; gameInfo = gameInfo || r[iGI];
    if (!map.has(key)) map.set(key, { name: r[iName], team: r[iTm], pos: r[iPos], avg: parseFloat(r[iAvg]) || 0, status: (iSt >= 0 ? r[iSt] : '') || '', salC: 0, salF: 0, idC: '', idF: '' });
    const p = map.get(key); const rp = (r[iRP] || '').toUpperCase();
    if (rp === 'CPT') { p.salC = +r[iSal]; p.idC = r[iId]; } else { p.salF = +r[iSal]; p.idF = r[iId]; }
  }
  const players = Array.from(map.values()).filter((p) => p.idF);
  for (const p of players) if (!p.salC) p.salC = Math.round(p.salF * 1.5);
  let teams = []; const m = /([A-Z]{2,4})@([A-Z]{2,4})/.exec(gameInfo || ''); if (m) teams = [m[1], m[2]];
  if (teams.length < 2) teams = Array.from(new Set(players.map((p) => p.team))).slice(0, 2);
  return { players: players, teams: teams, gameInfo: gameInfo };
}
const ALIAS = { LAR: 'LA', JAC: 'JAX', WSH: 'WAS', LVR: 'LV', OAK: 'LV', SD: 'LAC', STL: 'LA' };
function nflTeam(ab) { return ALIAS[ab] || ab; }
function matchSlate(MODEL, dk) {
  const byName = new Map();
  for (const id in MODEL.players) { const e = MODEL.players[id]; const k = norm(e.n); if (!byName.has(k)) byName.set(k, []); byName.get(k).push(e); }
  const kByName = new Map(); for (const id in MODEL.kickers) kByName.set(norm(MODEL.kickers[id][0]), id);
  const out = [];
  for (const p of dk.players) {
    const tm = nflTeam(p.team); const o = Object.assign({}, p, { team: tm, mid: null, matched: false });
    o.active = !INACTIVE.has((p.status || '').toUpperCase());
    if (p.pos === 'DST') { o.mid = tm; o.matched = true; }
    else if (p.pos === 'K') { const id = kByName.get(norm(p.name)); if (id) { o.mid = id; o.matched = true; } }
    else {
      let c = byName.get(norm(p.name)) || [];
      if (!c.length) { // last-name + first initial fallback within team
        const nn = norm(p.name).split(' '); const last = nn[nn.length - 1];
        c = []; for (const [k, arr] of byName) { const kk = k.split(' '); if (kk[kk.length - 1] === last && kk[0][0] === nn[0][0]) c.push(...arr.filter((e) => e.tm === tm)); }
      }
      if (c.length > 1) { const t2 = c.filter((e) => e.tm === tm); if (t2.length) c = t2; const pz = c.filter((e) => e.pos === p.pos); if (pz.length) c = pz; }
      if (c.length) { const e = c[0]; o.mid = e.id; o.matched = true; o.rs = e.rs; o.ts = e.ts; o.rsz = e.rsz; o.tsz = e.tsz; o.rsy = e.rsy != null ? e.rsy : e.rs; o.tpd = e.tpd != null ? e.tpd : e.ts; o.nr = e.nr || 0; o.nt = e.nt || 0; o.g = e.g; o.gc = e.gc; o.prevTeam = e.tm; }
    }
    if (['QB', 'RB', 'WR', 'TE'].includes(p.pos) && o.rs == null) {
      // defaults for players with no NFL data
      const d = { QB: [0.05, 0], RB: [0.03, 0.01], WR: [0.003, 0.015], TE: [0, 0.01] }[p.pos];
      o.rs = d[0]; o.ts = d[1]; o.rsz = d[0]; o.tsz = d[1]; o.rsy = d[0]; o.tpd = d[1]; o.g = 0; o.gc = 0; o.nr = 0; o.nt = 0;
    }
    out.push(o);
  }
  // starter QB per team: highest salary active QB
  for (const tm of dk.teams.map(nflTeam)) {
    const qbs = out.filter((p) => p.team === tm && p.pos === 'QB' && p.active).sort((a, b) => b.salF - a.salF);
    qbs.forEach((q, i) => { q.isStarterQB = i === 0 ? 1 : 0; });
  }
  applyPriors(out);
  return out;
}
/* Shrink each active player's share toward the typical share for his depth-chart rank (rank among active teammates
   at his position). Weight on the prior = k games vs the player's recency-weighted games. Backtest (2025 wk4-18 + 2026 wk2-4):
   run-share MSE 0.00521 -> 0.00488 at k=1, target-share MSE 0.00392 -> 0.00366 at k=2. */
const PRIOR = { rs: { RB: [0.62, 0.24, 0.07, 0.03], WR: [0.02, 0.01, 0.01, 0.005, 0.005, 0], TE: [0] },
  ts: { WR: [0.24, 0.18, 0.12, 0.06, 0.03, 0.02], TE: [0.16, 0.05, 0.02], RB: [0.11, 0.05, 0.02, 0.01] } };
function applyPriors(players) {
  const teams = Array.from(new Set(players.map((p) => p.team)));
  // A player with no games yet this season while his team has played 2+ is a depth player (or returning from injury): his share from a prior
  // role or team gets no evidence weight, so he drops to the bottom rung of the depth ladder. A projections file can restore it.
  const teamN = {}; for (const p of players) if (p.gc != null) teamN[p.team] = Math.max(teamN[p.team] || 0, +p.gc || 0);
  for (const p of players) { p.noGame = ['RB', 'WR', 'TE'].includes(p.pos) && (teamN[p.team] || 0) >= 2 && p.gc != null && +p.gc === 0;
    if (p.noGame && !p.noGameRaw) p.noGameRaw = { rs: p.rs, ts: p.ts, rsz: p.rsz, tsz: p.tsz, rsy: p.rsy, tpd: p.tpd }; }
  const ev = (p, nk) => (p.noGame ? 0 : p[nk] || 0);
  for (const tm of teams) for (const [col, nk, k, sub] of [['rs', 'nr', 1, ['rsz', 'rsy']], ['ts', 'nt', 2, ['tsz', 'tpd']]]) {
    for (const pos of ['RB', 'WR', 'TE']) {
      const grp = players.filter((p) => p.team === tm && p.pos === pos && p.active).sort((a, b) => (b[col] || 0) - (a[col] || 0));
      const pr = PRIOR[col][pos] || [0];
      grp.sort((a, b) => ((ev(b, nk) > 0) - (ev(a, nk) > 0)) || ((b[col] || 0) - (a[col] || 0)) || (b.salF - a.salF));
      grp.forEach((p, r) => { const n = ev(p, nk); const prior = n > 0 ? pr[Math.min(r, pr.length - 1)] : pr[pr.length - 1]; const old = p[col] || 0;
        const nv = (n * old + k * prior) / (n + k); p[col] = nv;
        for (const s of sub) p[s] = old > 0 ? (p[s] || 0) * nv / old : nv; });
    }
  }
  return players;
}
const API = { parseDK, matchSlate, norm, nflTeam, INACTIVE, applyPriors, parseCSV };
if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.SLATE = API;
})(typeof self !== 'undefined' ? self : this);
