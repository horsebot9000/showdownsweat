/* ---------------- market props: Kalshi player ladders (public API, no login) ----------------
   Pulls rushing attempts, rushing yards, receptions and receiving yards ladders ("Will Shipley: 30+" at 55c),
   turns each ladder into a market mean and median, converts to expected carries and targets, and offers to set a
   team's RB/WR/TE run or target split to the market's (blendable). Only the split WITHIN the players the market
   lists changes: the group's total share stays the model's, so team volume still comes from the game model. */
const KX = { base: 'https://api.elections.kalshi.com/trade-api/v2',
  series: { ra: 'KXNFLRSHATT', ry: 'KXNFLRSHYDS', rec: 'KXNFLREC', recy: 'KXNFLRECYDS', rry: 'KXNFLRRYDS', py: 'KXNFLPASSYDS', ptd: 'KXNFLPASSTDS', pa: 'KXNFLPASSATT', pc: 'KXNFLPASSCOMP', td: 'KXNFLTD' } };
const KX_LABEL = { ra: 'Rush att', ry: 'Rush yds', rec: 'Receptions', recy: 'Rec yds', rry: 'Rush+rec yds', py: 'Pass yds', ptd: 'Pass TDs', pa: 'Pass att', pc: 'Completions', td: 'Anytime TDs' };
const KX_TEAM = { JAX: 'JAC', LA: 'LAR' };
const kxTeam = (t) => KX_TEAM[t] || t;
const KX_CONV = { ypc: { RB: 4.2, WR: 6.5, TE: 4.0, QB: 5.0 }, catch: { RB: 0.78, WR: 0.64, TE: 0.72 }, ypt: { RB: 5.6, WR: 8.1, TE: 7.2 } };
async function kxSeries(series) {
  let out = [], cursor = '';
  for (let k = 0; k < 10; k++) {
    const r = await fetch(`${KX.base}/markets?series_ticker=${series}&status=open&limit=1000${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`);
    if (!r.ok) throw new Error('Kalshi returned ' + r.status);
    const j = await r.json(); out = out.concat(j.markets || []); cursor = j.cursor; if (!cursor) break;
  }
  return out;
}
const kxNum = (v) => v == null || v === '' ? null : +v;
function kxPrice(m) {
  const b = kxNum(m.yes_bid_dollars) ?? (m.yes_bid != null ? m.yes_bid / 100 : null), a = kxNum(m.yes_ask_dollars) ?? (m.yes_ask != null ? m.yes_ask / 100 : null);
  // only a tight two-sided book counts: a wide or one-sided book (or a stale last trade) is not a price
  if (b != null && a != null && a > 0 && b > 0 && a - b <= 0.10) return (a + b) / 2;
  return null;
}
// raw market list -> {gameCode: {stat: {normName: {name, team, lad:[[strike,p]]}}}}
function kxParse(markets, statOf) {
  const G = {};
  for (const m of markets) {
    const stat = statOf(m); if (!stat) continue;
    const ev = (m.event_ticker || '').split('-'); const code = (ev[1] || '').replace(/^\d{2}[A-Z]{3}\d{2}/, ''); if (!code) continue;
    const nm = ((m.yes_sub_title || m.subtitle || m.title || '').split(':')[0] || '').trim(); const s = kxNum(m.floor_strike); const p = kxPrice(m);
    if (!nm || s == null || p == null) continue;
    const seg = (m.ticker || '').split('-')[2] || '';
    const g = G[code] || (G[code] = {}); const st = g[stat] || (g[stat] = {}); const k = SL.norm(nm);
    const e = st[k] || (st[k] = { name: nm, seg, lad: [] });
    const bid = kxNum(m.yes_bid_dollars) ?? (m.yes_bid != null ? m.yes_bid / 100 : null), ask = kxNum(m.yes_ask_dollars) ?? (m.yes_ask != null ? m.yes_ask / 100 : null);
    e.lad.push([s, p, bid, ask, kxNum(m.volume_fp) ?? kxNum(m.volume) ?? 0, m.ticker]);
  }
  return G;
}
// ladder of P(X > strike) -> mean and median (piecewise-linear survival from 0, exponential tail past the last rung)
function kxSummary(lad) {
  const L = lad.map((x) => [x[0], x[1]]).sort((a, b) => a[0] - b[0]); for (let i = 1; i < L.length; i++) L[i][1] = Math.min(L[i][1], L[i - 1][1]);
  const pts = [[Math.min(0, L[0][0] - 1), 1], ...L].map(([s, p]) => [s, Math.max(0.001, Math.min(1, p))]);
  let mean = pts[0][0];
  for (let i = 1; i < pts.length; i++) mean += (pts[i][0] - pts[i - 1][0]) * (pts[i][1] + pts[i - 1][1]) / 2;
  const n = pts.length, a = pts[n - 2], b = pts[n - 1];
  const lam = b[1] < a[1] ? (b[0] - a[0]) / Math.log(a[1] / b[1]) : (b[0] - a[0]) || 1; mean += b[1] * lam;
  let med = null;
  for (let i = 1; i < n; i++) if (pts[i][1] <= 0.5) { const [s0, p0] = pts[i - 1], [s1, p1] = pts[i]; med = s0 + (p0 - 0.5) / Math.max(1e-6, p0 - p1) * (s1 - s0); break; }
  if (med == null) med = b[0] + lam * Math.log(b[1] / 0.5);
  return { mean, med, rungs: L.length };
}
const KX_STAT = (m) => { const s = (m.event_ticker || '').split('-')[0]; for (const k in KX.series) if (KX.series[k] === s) return k; return null; };
// Kalshi's API refuses requests from web pages, so the page goes through your relay (kalshi_relay.gs, a free Google Apps Script
// web app) when one is saved; the direct call is tried first in case Kalshi ever opens it up.
const KX_RELAY_SRC = /*RELAYSRC*/'';
const KX_RELAY_DEFAULT = 'https://script.google.com/macros/s/AKfycbwruoBeBOpjjKL0hJaTPGZA_SWM1J5DNhDOkrV43o3fQEK314UbX8MPmIchW5ILx5ue/exec'; // the shared relay (DraftKings contest details + Kalshi); a URL saved in this browser overrides it
const kxRelay = () => { try { return store.get('kxRelay', '') || KX_RELAY_DEFAULT; } catch (e) { return KX_RELAY_DEFAULT; } };
async function kxPullAll() {
  const relay = kxRelay();
  if (relay) {
    const r = await fetch(relay + (relay.includes('?') ? '&' : '?') + 'series=' + Object.values(KX.series).join(','));
    if (!r.ok) throw new Error('relay returned ' + r.status);
    const j = await r.json(); if (!j.markets) throw new Error('relay answered without market data'); ST.kxVia = 'relay'; return kxParse(j.markets, KX_STAT);
  }
  ST.kxVia = 'direct';

  let fails = 0, err = null; const lists = await Promise.all(Object.values(KX.series).map((s) => kxSeries(s).catch((e) => { fails++; err = e; return []; })));
  if (fails === Object.keys(KX.series).length) throw err;
  return kxParse([].concat(...lists), KX_STAT);
}
// market estimates for one team: [{p, j, carries, targets, sum:{ra,ry,rec,recy}}]
function kxTeamRows(G, away, home, team, players) {
  const code = kxTeam(away) + kxTeam(home); const g = G && G[code]; if (!g) return null;
  const rows = [];
  players.forEach((p, j) => {
    if (p.team !== team || !['QB', 'RB', 'WR', 'TE'].includes(p.pos)) return;
    const k = SL.norm(p.name); const sum = {};
    for (const st in g) { const e = g[st][k]; if (e && (!e.seg || e.seg.startsWith(kxTeam(team)))) sum[st] = kxSummary(e.lad); }
    if (!Object.keys(sum).length) return;
    const carries = sum.ra ? sum.ra.mean : sum.ry ? Math.max(0, sum.ry.mean) / (KX_CONV.ypc[p.pos] || 4.2) : null;
    const targets = p.pos === 'QB' ? null : sum.rec ? sum.rec.mean / (KX_CONV.catch[p.pos] || 0.65) : sum.recy ? Math.max(0, sum.recy.mean) / (KX_CONV.ypt[p.pos] || 7.5) : null;
    rows.push({ p, j, sum, carries, targets });
  });
  return rows;
}
// team volume per game from the line and pass tendency (fit on 2024-2026 team-games: designed runs incl. QB designed runs; targets)
function kxVol(team, opp, impT, impO) {
  const sp = impT - impO, tot = impT + impO, pr = ((MODEL.teams[team] || {}).proe || 0) + ((MODEL.teams[opp] || {}).dproe || 0) + kxTiltOf(team);
  return { run: Math.max(14, 23.07 + 0.265 * sp - 0.021 * (tot - 44) - 47.7 * pr), tgt: Math.max(20, 33.53 - 0.136 * sp + 0.221 * (tot - 44) + 59.0 * pr) };
}
// market split: each listed player's share = his expected carries (targets) / team designed runs (targets); everyone else on the
// team (unlisted players, the starting QB's designed runs) is scaled to fill the rest, so the team column total is unchanged.
function kxSplit(rows, kind, w, VA, vol, players) {
  const f = kind === 'run' ? 'rs' : 'ts', est = kind === 'run' ? 'carries' : 'targets';
  const cur = (j) => VA ? (+VA[j][f] || 0) : (+players[j][f] || 0);
  const L = rows.filter((r) => r.p.pos !== 'QB' && r.p.active && r[est] != null && r[est] > 0); if (!L.length || !vol) return null;
  const team = L[0].p.team; const inL = new Set(L.map((r) => r.j));
  const all = []; players.forEach((p, j) => { if (p.team === team && p.active && (['RB', 'WR', 'TE'].includes(p.pos) || (kind === 'run' && p.pos === 'QB' && p.isStarterQB))) all.push(j); });
  const T = all.reduce((a, j) => a + cur(j), 0); if (!(T > 0)) return null;
  const V = kind === 'run' ? vol.run : vol.tgt; const mk = {}; L.forEach((r) => { mk[r.j] = T * r[est] / V; });
  let sm = Object.values(mk).reduce((a, b) => a + b, 0); if (sm > 0.95 * T) { const k = 0.95 * T / sm; for (const j in mk) mk[j] *= k; sm = 0.95 * T; }
  const shares = {}; L.forEach((r) => { shares[r.j] = (1 - w) * cur(r.j) + w * mk[r.j]; });
  const newL = L.reduce((a, r) => a + shares[r.j], 0), others = all.filter((j) => !inL.has(j)), co = others.reduce((a, j) => a + cur(j), 0);
  const k = co > 0 ? Math.max(0, T - newL) / co : 0; others.forEach((j) => { shares[j] = cur(j) * k; });
  return { col: f, shares, group: all, listed: [...inL], mk, vol: V, T };
}
// apply a split: main column set; companion columns (red zone, short yardage / pass downs) keep each player's ratio to his main share
function kxApply(players, sp, VA) {
  const tm0 = sp.group.length ? players[sp.group[0]].team : null; // keep each player's shares from before any market input (for the Model sim)
  players.forEach((p) => { if (p.team === tm0 && ['QB', 'RB', 'WR', 'TE'].includes(p.pos) && !p.preMkt) p.preMkt = { rs: p.rs, ts: p.ts, rsz: p.rsz, tsz: p.tsz, rsy: p.rsy, tpd: p.tpd, mkt: p.mkt, mktGrp: p.mktGrp }; });
  // bake in the effective shares (incl. work moved from players who are out) for every player at the affected team/positions,
  // since the injury redistribution is skipped for a group whose split you set
  if (VA) { const keys = new Set(sp.group.map((j) => players[j].team + '|' + players[j].pos));
    players.forEach((p, j) => { if (keys.has(p.team + '|' + p.pos) && VA[j]) ['rs', 'ts', 'rsz', 'tsz', 'rsy', 'tpd'].forEach((f) => { if (VA[j][f] != null) p[f] = VA[j][f]; }); }); }
  const comp = sp.col === 'rs' ? ['rsz', 'rsy'] : ['tsz', 'tpd'];
  const before = Object.fromEntries(sp.group.map((j) => [j, +players[j][sp.col] || 0]));
  comp.forEach((cf) => {
    const tot = sp.group.reduce((a, j) => a + (+players[j][cf] || 0), 0); if (!(tot > 0)) return;
    const raw = {}; sp.group.forEach((j) => { const r0 = before[j] > 0.01 ? (+players[j][cf] || 0) / before[j] : 1; raw[j] = Math.max(0, r0 * sp.shares[j]); });
    const rs = sp.group.reduce((a, j) => a + raw[j], 0) || 1; sp.group.forEach((j) => { players[j][cf] = tot * raw[j] / rs; });
  });
  sp.group.forEach((j) => { players[j][sp.col] = sp.shares[j]; players[j].mktGrp = true; });
  (sp.listed || sp.group).forEach((j) => { players[j].mkt = Object.assign({}, players[j].mkt, { [sp.col === 'rs' ? 'run' : 'tgt']: true }); });
  if (VA) players.forEach((p) => { if (sp.group.length && p.team === players[sp.group[0]].team && ['QB', 'RB', 'WR', 'TE'].includes(p.pos)) p.mktGrp = true; });
}
// card: one row per player the market lists, model vs market shares, apply buttons per team
function propsCard(games, opts) {
  opts = opts || {}; const P = ST.players; const G = ST.props; const VA = G ? adjustVacated().sh : null;
  const head = `<div class="row" style="justify-content:space-between"><h3>Market props (Kalshi)</h3><div class="row small"><button id="kxPull" class="small">Pull props</button>
    <label title="Apply the market split to every team as soon as props are pulled"><input type="checkbox" id="kxAuto" ${kxAutoOn() ? 'checked' : ''}> Auto-apply</label><button id="kxAll" class="small">Apply all</button>
    <label title="How far Apply moves shares toward the market split">Blend <input id="kxW" type="number" min="0" max="100" step="10" value="${Math.round((ST.kxW ?? 1) * 100)}" style="width:56px">%</label>
    <label class="small" title="Your Kalshi relay (one-time setup: kalshi_relay.gs in the project folder). Saved in this browser.">Relay URL <input id="kxRelayIn" type="url" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(kxRelay())}" style="width:240px"></label><button id="kxRelaySave" class="small">Save</button></div></div>
    ${kxRelay() ? '' : `<details style="margin:6px 0"><summary class="small"><b>Set up the Kalshi relay (once, about 3 minutes)</b></summary><ol class="small"><li>Open <a href="https://script.google.com/home/projects/create" target="_blank" rel="noopener">script.google.com → New project</a>, paste the script below over the starter code, save.</li><li>Deploy → New deployment → Web app. Execute as: Me. Who has access: Anyone. Deploy and allow access.</li><li>Copy the Web app URL (ends in /exec), paste it into Relay URL above, Save. Props then pull on their own every time a slate loads.</li></ol><button id="kxCopy" class="small">Copy script</button><pre class="small" style="max-height:160px;overflow:auto;white-space:pre-wrap;background:var(--soft);padding:8px;border-radius:6px">${esc(KX_RELAY_SRC)}</pre></details>`}
    <p class="small muted">${esc(ST.kxMsg || 'Pull the player ladders to compare the market\'s backfield and target splits with the model.')} Model shares include work moved from players who are out. Market share = expected carries (or targets) / the team's expected designed runs (targets) from the line and pass tendency. Carries come from the rushing attempts ladder (or rushing yards / ${KX_CONV.ypc.RB} YPC); targets from receptions / catch rate (or receiving yards / yards per target). Ladder cells show median (mean). QB props: on every run the starting QB's pass attempts set his team's pass rate and his rush attempts set his share of designed runs (shown under each team name); both re-measure each run, so they settle instead of stacking. Apply sets the listed players to the market, scales everyone else on the team to fill the rest, keeps red-zone and short-yardage roles in proportion, and stops the injury redistribution from double counting.</p>`;
  if (!G) return `<div class="card" style="margin-bottom:16px">${head}</div>`;
  let body = ''; const pp = (v) => v == null ? '-' : (v * 100).toFixed(1);
  for (const g of games) {
    for (const tm of [g.away, g.home]) {
      const rows = kxTeamRows(G, g.away, g.home, tm, P); if (!rows || !rows.length) continue;
      const opp = tm === g.away ? g.home : g.away, it = tm === g.away ? g.imp[0] : g.imp[1], io = tm === g.away ? g.imp[1] : g.imp[0]; const vol = kxVol(tm, opp, it, io);
      const sr = kxSplit(rows, 'run', 1, VA, vol, P), st = kxSplit(rows, 'tgt', 1, VA, vol, P); const cv = (r, f) => +VA[r.j][f] || 0;
      const md = (r, k, d = 0) => r.sum[k] ? `${r.sum[k].med.toFixed(d)} <span class="muted">(${r.sum[k].mean.toFixed(d)})</span>` : '<span class="muted">-</span>';
      const dlt = (a, b) => a == null || b == null ? '' : (Math.abs(b - a) >= 0.05 ? `style="background:color-mix(in srgb, var(--warn) 22%, var(--panel));font-weight:700"` : '');
      body += `<tr class="teamhead"><td colspan="11"><div class="row" style="justify-content:space-between"><b>${typeof tdot === 'function' ? tdot(tm) : ''}${esc(tm)}</b> <span class="small muted" style="text-transform:none;letter-spacing:0">expected ${vol.run.toFixed(1)} designed runs, ${vol.tgt.toFixed(1)} targets (line ${it.toFixed(1)}-${io.toFixed(1)} and pass tendency${kxTiltOf(tm) ? `, market pass rate ${kxTiltOf(tm) > 0 ? '+' : ''}${(kxTiltOf(tm) * 100).toFixed(1)} pts` : ''})${(() => { const q = ST.kxQb && ST.kxQb[tm]; if (!q) return ''; const a = []; if (q.mktPA != null && q.simPA != null) a.push(`QB attempts market ${q.mktPA.toFixed(1)} vs sim ${q.simPA.toFixed(1)} → pass rate ${q.tilt >= 0 ? '+' : ''}${(q.tilt * 100).toFixed(1)} pts`); if (q.mktRA != null && q.simRA != null) a.push(`QB rush att market ${q.mktRA.toFixed(1)} vs sim ${q.simRA.toFixed(1)}${q.q1 != null ? ` → designed-run share ${(q.q0 * 100).toFixed(0)}% → ${(q.q1 * 100).toFixed(0)}%` : ''}`); return a.length ? `<br>${a.join(' · ')}` : ''; })()}</span><div class="row small">
        ${sr ? `<button class="small" data-kxa="run" data-kxt="${esc(tm)}" data-kxg="${g.away}|${g.home}">Apply market run split</button>` : '<span class="muted">no run markets</span>'}
        ${st ? `<button class="small" data-kxa="tgt" data-kxt="${esc(tm)}" data-kxg="${g.away}|${g.home}">Apply market target split</button>` : ''}</div></div></td></tr>`;
      body += rows.sort((a, b) => (POSO[a.p.pos] - POSO[b.p.pos]) || ((b.carries || 0) + (b.targets || 0) - (a.carries || 0) - (a.targets || 0))).map((r) => {
        const mr = sr && sr.mk[r.j] != null ? sr.mk[r.j] / sr.T : null, mt = st && st.mk[r.j] != null ? st.mk[r.j] / st.T : null;
        const tr = sr ? sr.T : 1, tt = st ? st.T : 1;
        return `<tr class="${r.p.active ? '' : 'off'}"><td><button class="pname plink" data-pc="${r.j}">${esc(r.p.name)}</button><span class="pos">${r.p.pos}</span>${r.p.mkt ? ' <span class="chip ok" title="Shares set from the market split">market</span>' : ''}</td>
          <td class="n">${md(r, 'ra', 1)}</td><td class="n">${md(r, 'ry')}</td><td class="n">${md(r, 'rec', 1)}</td><td class="n">${md(r, 'recy')}</td>
          <td class="n">${r.p.pos === 'QB' ? '<span class="muted">-</span>' : pp(cv(r, 'rs') / tr)}</td><td class="n" ${dlt(cv(r, 'rs') / tr, mr)}>${pp(mr)}</td>
          <td class="n">${r.p.pos === 'QB' ? '<span class="muted">-</span>' : pp(cv(r, 'ts') / tt)}</td><td class="n" ${dlt(cv(r, 'ts') / tt, mt)}>${pp(mt)}</td></tr>`; }).join('');
    }
  }
  if (!body) body = `<tr><td colspan="11" class="muted small">No Kalshi player markets matched this ${games.length > 1 ? 'slate' : 'game'} yet.</td></tr>`;
  return `<div class="card" style="margin-bottom:16px">${head}<div class="tw" style="border:0"><table class="nosort"><thead><tr><th>Player</th><th class="n" title="Median (mean)">Rush att</th><th class="n" title="Median (mean)">Rush yds</th><th class="n" title="Median (mean)">Rec</th><th class="n" title="Median (mean)">Rec yds</th><th class="n" title="Share of the team's designed runs in the sim (after work from players who are out is moved)">Run % model</th><th class="n" title="Expected carries / team expected designed runs">Run % market</th><th class="n">Tgt % model</th><th class="n" title="Expected targets / team expected targets">Tgt % market</th></tr></thead><tbody>${body}</tbody></table></div></div>`;
}
// apply the market run and target split for every team that has listed players
function kxApplyAll(games, quiet) { if (!ST.props) return 0; let n = 0; const w = ST.kxW ?? 1; if (!quiet) ST.kxApplied = true;
  for (const g of games) for (const tm of [g.away, g.home]) { const opp = tm === g.away ? g.home : g.away; const vol = kxVol(tm, opp, tm === g.away ? g.imp[0] : g.imp[1], tm === g.away ? g.imp[1] : g.imp[0]);
    for (const kind of ['run', 'tgt']) { const rows = kxTeamRows(ST.props, g.away, g.home, tm, ST.players); if (!rows) continue; const VA = adjustVacated().sh; const sp = kxSplit(rows, kind, w, VA, vol, ST.players); if (sp) { kxApply(ST.players, sp, VA); n++; } } }
  if (n && !quiet) { ST.slateOrd = null; markStale(); } return n; }

/* ---------------- QB props into the sim ----------------
   Pass attempts: the market's mean for the starting QB sets that team's pass rate for the game. A quick sim of your setup
   (without any market pass tilt) measures his attempts; the gap is converted to pass rate over expected at about 50 attempts
   per 100 points of pass rate (the engine's slope: about 62 plays x 0.98 x 0.85 dropbacks that become attempts).
   Rush attempts: the market's mean, minus the sim's, moves the QB's share of designed runs (scrambles and kneels stay as
   simmed); the rest of the backfield is scaled to fill. Both re-measure on every run, so they converge instead of stacking. */
const KX_ATT_SLOPE = 50;
function kxTiltOf(team) { return (ST.kxTilt && ST.kxTilt[team]) || 0; }
function kxQbOn() { return !!ST.props && (kxAutoOn() || !!ST.kxApplied); }
function kxQbTargets(games) {
  const out = {}; if (!ST.props) return out; const P = ST.players;
  for (const g of games) for (const tm of [g.away, g.home]) { const rows = kxTeamRows(ST.props, g.away, g.home, tm, P); if (!rows) continue;
    const qb = rows.find((r) => r.p.pos === 'QB' && r.p.active && r.p.isStarterQB); if (!qb) continue;
    const pa = qb.sum.pa ? qb.sum.pa.mean : null, ra = qb.sum.ra ? qb.sum.ra.mean : null; if (pa == null && ra == null) continue;
    out[tm] = { j: qb.j, pa, ra, opp: tm === g.away ? g.home : g.away }; }
  return out;
}
// measure(): async, returns {team: {pa, ra, nonQbRa}} from a quick sim of the current setup
async function kxQbApply(games, measure) {
  const tg = kxQbTargets(games); const teams = Object.keys(tg); if (!teams.length) { ST.kxTilt = {}; ST.kxQb = {}; return null; }
  const w = ST.kxW ?? 1; ST.kxTilt = {}; const m = await measure(); const info = {}; const tilt = {};
  for (const t of teams) { const x = tg[t], s = m[t]; if (!s) continue; info[t] = { qb: x.j, mktPA: x.pa, simPA: s.pa, mktRA: x.ra, simRA: s.ra };
    if (x.pa != null && s.pa != null) { tilt[t] = Math.max(-0.15, Math.min(0.15, w * (x.pa - s.pa) / KX_ATT_SLOPE)); info[t].tilt = tilt[t]; } }
  ST.kxTilt = tilt; if (kxAutoOn()) kxApplyAll(games, true); // backfield and target splits again, now with the pass tilt in each team's volume
  const P = ST.players;
  for (const t of teams) { const x = tg[t], s = m[t], I = info[t]; if (!I || x.ra == null || s.ra == null) continue;
    const VA = adjustVacated().sh; const all = []; P.forEach((p, j) => { if (p.team === t && p.active && (['RB', 'WR', 'TE'].includes(p.pos) || (p.pos === 'QB' && p.isStarterQB))) all.push(j); });
    const T = all.reduce((a, j) => a + (+VA[j].rs || 0), 0); if (!(T > 0)) continue; const qs = +VA[x.j].rs || 0, q0 = qs / T;
    const D = s.nonQbRa / Math.max(0.5, 1 - q0); if (!(D > 0)) continue; const q1 = Math.max(0, Math.min(0.45, (q0 * D + w * (x.ra - s.ra)) / D));
    const k = (T - qs) > 0 ? (T - q1 * T) / (T - qs) : 1; const shares = {}; all.forEach((j) => { shares[j] = j === x.j ? q1 * T : (+VA[j].rs || 0) * k; });
    kxApply(P, { col: 'rs', shares, group: all, listed: [x.j] }, VA); I.q0 = q0; I.q1 = q1; }
  ST.kxQb = info; return info;
}
// run fn() with every market input removed: shares from before the first market split, no pass tilt (for the Model sim)
function kxModelSwap(fn) {
  const P = ST.players; const F = ['rs', 'ts', 'rsz', 'tsz', 'rsy', 'tpd']; const stash = []; const tilt = ST.kxTilt;
  P.forEach((p, j) => { if (!p.preMkt) return; const o = { j, mkt: p.mkt, mktGrp: p.mktGrp }; F.forEach((f) => { o[f] = p[f]; p[f] = p.preMkt[f]; }); if (p.preMkt.mkt) p.mkt = p.preMkt.mkt; else delete p.mkt; if (p.preMkt.mktGrp) p.mktGrp = p.preMkt.mktGrp; else delete p.mktGrp; stash.push(o); });
  ST.kxTilt = {}; try { return fn(); } finally { ST.kxTilt = tilt; stash.forEach((o) => { const p = P[o.j]; F.forEach((f) => { p[f] = o[f]; }); if (o.mkt) p.mkt = o.mkt; else delete p.mkt; if (o.mktGrp) p.mktGrp = o.mktGrp; else delete p.mktGrp; }); }
}
const kxAnyMarket = () => ST.players.some((p) => p.preMkt) || Object.values(ST.kxTilt || {}).some((v) => v);
function kxResetMarket() { ST.players.forEach((p) => { delete p.preMkt; }); ST.kxTilt = {}; ST.kxQb = {}; ST.kxApplied = false; }
// per team means from a pstats block: QB pass and rush attempts, everyone else's rush attempts
function kxPsTeamMeans(ps, idxs, players) { const out = {}; if (!ps) return out; const PA = PSTAT_KEYS.indexOf('pa'), RA = PSTAT_KEYS.indexOf('ra');
  idxs.forEach(([j, k]) => { const p = players[j]; if (!['QB', 'RB', 'WR', 'TE'].includes(p.pos)) return; let a = 0, r = 0; for (let i = 0; i < ps.n; i++) { const b = (i * ps.np + k) * ps.K; a += ps.data[b + PA]; r += ps.data[b + RA]; } a /= ps.n; r /= ps.n;
    const o = out[p.team] || (out[p.team] = { pa: null, ra: null, nonQbRa: 0 }); if (p.pos === 'QB' && p.isStarterQB && p.active) { o.pa = a; o.ra = r; } else if (p.pos !== 'QB') o.nonQbRa += r; });
  return out; }
const kxAutoOn = () => { try { return store.get('kxAuto', true); } catch (e) { return true; } };
async function kxPull(rerender) {
  ST.kxMsg = 'Pulling Kalshi ladders…'; rerender();
  try { ST.props = await kxPullAll(); const n = Object.keys(ST.props).length; ST.kxMsg = `Kalshi ladders for ${n} game${n === 1 ? '' : 's'}${ST.kxVia === 'relay' ? ' via your relay' : ''}, pulled ${new Date().toLocaleTimeString()}. Prices are the mid of a two-sided book no wider than 10¢; wider or one-sided rungs are ignored (in-game books thin out, so pull before kickoff).`;
    if (ST.props && kxAutoOn() && typeof kxGamesAll === 'function') { const n = kxApplyAll(kxGamesAll()); if (n) ST.kxMsg += ` Market splits applied automatically (${n} team groups).`; } }
  catch (e) { ST.kxMsg = kxRelay() ? `Relay pull failed (${e.message}). Check the relay URL, or redeploy the script with access set to Anyone.` : `Kalshi blocks requests made straight from a web page. One-time fix (3 minutes): open "Set up the Kalshi relay" below. After that props pull automatically, like the lines.`; }
  rerender();
}
function bindProps(el, games, rerender) {
  const b = $('#kxPull', el); if (b) b.onclick = () => kxPull(rerender);
  const w = $('#kxW', el); if (w) w.onchange = () => { ST.kxW = Math.max(0, Math.min(1, (+w.value || 0) / 100)); rerender(); };
  const au = $('#kxAuto', el); if (au) au.onchange = () => { try { store.set('kxAuto', au.checked); } catch (e) {} };
  const all = $('#kxAll', el); if (all) all.onclick = () => { const n = kxApplyAll(games); toast(n ? `Market splits applied (${n} team groups)` : 'No market splits to apply'); rerender(); };
  const cp = $('#kxCopy', el); if (cp) cp.onclick = async () => { try { await navigator.clipboard.writeText(KX_RELAY_SRC); cp.textContent = 'Copied'; } catch (e) { cp.textContent = 'Select the text below and copy'; } };
  const rs = $('#kxRelaySave', el); if (rs) rs.onclick = () => { const v = ($('#kxRelayIn', el).value || '').trim(); try { store.set('kxRelay', v); } catch (e) {} kxPull(rerender); };
  const f = $('#kxFile', el); if (f) f.onchange = async () => { try { const j = JSON.parse(await f.files[0].text()); const mk = Array.isArray(j) ? j : (j.markets || []); ST.props = kxParse(mk, KX_STAT); ST.kxMsg = `Loaded ${mk.length} markets from file${j.pulled ? ' (pulled ' + j.pulled + ')' : ''}.`; } catch (e) { ST.kxMsg = 'Could not read that props file.'; } rerender(); };
  $$('button[data-kxa]', el).forEach((btn) => btn.onclick = () => {
    const [a, h] = btn.dataset.kxg.split('|'); const rows = kxTeamRows(ST.props, a, h, btn.dataset.kxt, ST.players); const VA = adjustVacated().sh; const g = games.find((x) => x.away === a && x.home === h); const tm = btn.dataset.kxt; const opp = tm === a ? h : a;
    const vol = g ? kxVol(tm, opp, tm === a ? g.imp[0] : g.imp[1], tm === a ? g.imp[1] : g.imp[0]) : null; const sp = rows && kxSplit(rows, btn.dataset.kxa, ST.kxW ?? 1, VA, vol, ST.players);
    if (!sp) return; kxApply(ST.players, sp, VA); markStale(); toast(`${btn.dataset.kxt} ${btn.dataset.kxa === 'run' ? 'run' : 'target'} split set from the market`); rerender();
  });
}
/* ---------------- props vs sim: every liquid rung, market price next to the sim's probability ---------------- */
// ps: {np, K, n, data} per game (box-score stats from extra sims); idx(j) maps a slate player to the game's player index
function simProb(ps, k, stat, strike) {
  const si = PSTAT_KEYS.indexOf(stat); if (si < 0 || !ps) return null; let c = 0;
  for (let i = 0; i < ps.n; i++) if (ps.data[(i * ps.np + k) * ps.K + si] > strike) c++;
  return c / ps.n;
}
function simMedian(ps, k, stat) {
  const si = PSTAT_KEYS.indexOf(stat); if (si < 0 || !ps) return null; const a = new Float32Array(ps.n);
  for (let i = 0; i < ps.n; i++) a[i] = ps.data[(i * ps.np + k) * ps.K + si]; a.sort(); return a[ps.n >> 1];
}
const PSTAT_KEYS = ['py', 'ptd', 'pa', 'pc', 'ra', 'ry', 'rec', 'recy', 'td', 'rry'];
// rows for the Props tab. games: [{away, home, ps, idx:(j)=>k}]
function propRows(games) {
  const out = []; const G = ST.props; if (!G) return out;
  for (const g of games) {
    const code = kxTeam(g.away) + kxTeam(g.home); const gm = G[code]; if (!gm) continue;
    const byName = new Map(); ST.players.forEach((p, j) => { if (p.team === g.away || p.team === g.home) byName.set(SL.norm(p.name), j); });
    for (const st in gm) for (const k in gm[st]) {
      const e = gm[st][k]; const j = byName.get(k); if (j == null) continue; const p = ST.players[j]; const pk = g.idx(j);
      const sm = kxSummary(e.lad); const simMed = g.ps && pk != null ? simMedian(g.ps, pk, st) : null;
      for (const [s, mid, bid, ask, vol, tk] of e.lad) {
        const sp = g.ps && pk != null ? simProb(g.ps, pk, st, s) : null; const spM = g.psM && pk != null ? simProb(g.psM, pk, st, s) : null;
        out.push({ j, p, st, strike: s, rung: Math.ceil(s), mid, bid, ask, vol, tk, simL: sp, sim: spM != null ? spM : sp, model: spM != null, mktMed: sm.med, simMed: g.psM && pk != null ? simMedian(g.psM, pk, st) : simMed, game: g.away + '@' + g.home });
      }
    }
  }
  return out;
}
function renderPropsTab(games) {
  const el = $('#pane-props'); if (!el) return; const V = ST.view;
  V.pvMin = V.pvMin ?? 500; V.pvSpr = V.pvSpr ?? 0.03; V.pvStat = V.pvStat || 'ALL'; V.pvEdge = V.pvEdge ?? 0;
  const rows = propRows(games).filter((r) => (V.pvStat === 'ALL' || r.st === V.pvStat) && r.vol >= V.pvMin && r.bid != null && r.ask != null && r.ask - r.bid <= V.pvSpr + 1e-9 && r.ask > 0 && r.bid < 1);
  rows.forEach((r) => { r.edgeY = r.sim == null ? null : r.sim - r.ask; r.edgeN = r.sim == null ? null : (1 - r.sim) - (1 - r.bid); r.edge = r.sim == null ? null : Math.max(r.edgeY, r.edgeN); });
  const shown = rows.filter((r) => r.edge == null || Math.abs(r.sim - r.mid) >= V.pvEdge / 100).sort((a, b) => (b.edge ?? -9) - (a.edge ?? -9));
  const pc = (v) => v == null ? '-' : (v * 100).toFixed(1) + '%';
  const anySim = games.some((g) => g.ps);
  el.innerHTML = `<div class="card"><div class="row" style="justify-content:space-between"><h3>Props vs sim</h3><div class="row small">
      <button id="pvPull" class="small">Pull props</button>
      <label>Stat <select id="pvStat"><option value="ALL">All</option>${Object.keys(KX_LABEL).map((k) => `<option value="${k}" ${V.pvStat === k ? 'selected' : ''}>${KX_LABEL[k]}</option>`).join('')}</select></label>
      <label title="Contracts traded">Min volume <input id="pvMin" type="number" step="100" min="0" value="${V.pvMin}" style="width:80px"></label>
      <label title="Widest bid/ask spread to show">Max spread <input id="pvSpr" type="number" step="1" min="1" value="${Math.round(V.pvSpr * 100)}" style="width:56px">¢</label>
      <label title="Hide rungs where the sim and the market agree within this many points">Min gap <input id="pvEdge" type="number" step="1" min="0" value="${V.pvEdge}" style="width:56px"> pts</label></div></div>
    <p class="small muted">${esc(ST.kxMsg || '')} Every Kalshi rung with real liquidity, priced against the sim's probability for the same stat from ${anySim ? 'extra box-score sims of your current setup' : 'the sim (run the simulation first)'}. ${games.some((g) => g.psM && g.psM !== g.ps) ? 'Model = your setup with every Kalshi input taken out (no market splits, no QB pass rate or QB designed runs from props), so the comparison is not graded against itself; Lineup sim is what your lineups use. ' : games.some((g) => g.ps && !g.psM) ? 'Model sim still running… ' : ''}Every row is shown from the side the model prefers: Market, Sim, Gap and Edge are all for that side (for No, the market is 100 minus the Yes price), so Yes and No rows compare directly. Edge = sim probability minus the price you would pay (Yes at the ask, No at 1 minus the bid). Gaps of 10+ points are flagged: at that size the sim is usually the one missing something. A big gap is a reason to look: either the sim is missing something (usage, role, injury news) or the market is. ${rows.length} liquid rungs, ${shown.length} shown, best edge first.</p>
    <div class="tw" style="border:0;max-height:720px"><table><thead><tr><th>Player</th><th>Stat</th><th>Side</th><th class="n">Line</th><th class="n" title="Market probability for the side shown (No = 100 minus Yes)">Market</th><th class="n" title="Model sim: your setup with every Kalshi input removed (no market splits, no QB pass tilt or QB run share), for the side shown. Gap and Edge use this.">Model</th><th class="n" title="The sim your lineups use, market inputs included, for the side shown">Lineup sim</th><th class="n" title="Sim minus market on the side shown, before the spread">Gap</th><th class="n" title="Sim minus the price you would pay on that side">Edge</th><th class="n">Yes ask</th><th class="n">No ask</th><th class="n">Volume</th><th class="n">Mkt median</th><th class="n">Sim median</th></tr></thead><tbody>
    ${shown.map((r) => { const yes = r.sim == null || r.edgeY >= r.edgeN; const side = r.sim == null ? '' : yes ? 'Yes' : 'No'; const mS = yes ? r.mid : 1 - r.mid, sS = r.sim == null ? null : yes ? r.sim : 1 - r.sim, lS = r.simL == null ? null : yes ? r.simL : 1 - r.simL; const gap = sS == null ? null : sS - mS; const big = gap != null && gap >= 0.1;
      const ec = r.edge == null ? '' : r.edge > 0 ? 'style="color:var(--good);font-weight:700"' : 'class="muted"';
      return `<tr><td><button class="pname plink" data-pc="${r.j}">${esc(r.p.name)}</button><span class="pos">${r.p.pos}</span> <span class="muted small">${esc(r.p.team)}</span></td><td class="small">${KX_LABEL[r.st]}</td><td>${side === 'No' ? '<b style="color:var(--bad)">No</b>' : side === 'Yes' ? '<b style="color:var(--good)">Yes</b>' : ''}</td><td class="n">${r.rung}+</td>
        <td class="n">${pc(mS)}</td><td class="n"><b>${pc(sS)}</b></td><td class="n muted">${pc(lS)}</td><td class="n" style="${gap == null ? '' : `background:color-mix(in srgb, var(--good) ${Math.round(Math.min(1, Math.abs(gap) / 0.2) * 40)}%, var(--panel))`}" ${big ? 'title="Sim and market disagree by 10+ points: check the sim\'s role and share for this player before betting it"' : ''}>${gap == null ? '-' : (gap >= 0 ? '+' : '') + (gap * 100).toFixed(1)}${big ? ' <span class="chip" style="font-size:10px">check sim</span>' : ''}</td><td class="n" ${ec}>${r.edge == null ? '-' : (r.edge >= 0 ? '+' : '') + (r.edge * 100).toFixed(1)}</td><td class="n">${Math.round(r.ask * 100)}¢</td><td class="n">${Math.round((1 - r.bid) * 100)}¢</td><td class="n">${Math.round(r.vol).toLocaleString()}</td>
        <td class="n">${r.mktMed == null ? '-' : fmt(r.mktMed, r.st === 'py' || /yds/.test(KX_LABEL[r.st]) ? 0 : 1)}</td><td class="n">${r.simMed == null ? '-' : fmt(r.simMed, r.st === 'py' || /yds/.test(KX_LABEL[r.st]) ? 0 : 1)}</td></tr>`; }).join('') || `<tr><td colspan="14" class="muted small">${ST.props ? 'No rungs pass the filters.' : 'No props pulled yet.'}</td></tr>`}</tbody></table></div></div>`;
  const rr = () => renderPropsTab(games);
  $('#pvPull', el).onclick = () => kxPull(() => { rr(); if (typeof renderSlate === 'function' && !$('#pane-slate').hidden) renderSlate(); });
  $('#pvStat', el).onchange = (e) => { V.pvStat = e.target.value; rr(); };
  $('#pvMin', el).onchange = (e) => { V.pvMin = Math.max(0, +e.target.value || 0); rr(); };
  $('#pvSpr', el).onchange = (e) => { V.pvSpr = Math.max(0.01, (+e.target.value || 3) / 100); rr(); };
  $('#pvEdge', el).onchange = (e) => { V.pvEdge = Math.max(0, +e.target.value || 0); rr(); };
}

/* re-render without losing your place: page scroll, scroll inside tables, and the input you were on */
function keepScroll(el, fn) {
  const sy = window.scrollY, sx = window.scrollX; const tws = el ? Array.from(el.querySelectorAll('.tw')).map((t) => [t.scrollTop, t.scrollLeft]) : [];
  const ae = document.activeElement; const sel = ae && el && el.contains(ae) && ae.dataset && Object.keys(ae.dataset).length ? Object.entries(ae.dataset).map(([k, v]) => `[data-${k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}="${CSS.escape(v)}"]`).join('') : null;
  fn();
  if (el) Array.from(el.querySelectorAll('.tw')).forEach((t, i) => { if (tws[i]) { t.scrollTop = tws[i][0]; t.scrollLeft = tws[i][1]; } });
  window.scrollTo(sx, sy);
  if (sel) { const n = el.querySelector(sel); if (n && n.focus) { n.focus({ preventScroll: true }); if (n.select && n.type === 'number') n.select(); } }
}
// row order on Slate inputs stays put while you edit; it re-sorts when you switch team/filter or load a slate
function stableSort(list, key, cmp) {
  if (!ST.slateOrd) ST.slateOrd = {}; let M = ST.slateOrd[key]; if (!M) M = ST.slateOrd[key] = new Map(list.slice().sort(cmp).map((x, i) => [x.j, i]));
  return list.slice().sort((a, b) => (M.get(a.j) ?? 1e9) - (M.get(b.j) ?? 1e9) || cmp(a, b));
}
