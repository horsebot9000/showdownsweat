/* ---------------- classic live: ESPN box scores for every slate game, sim the rest of the slate ----------------
   Final games are fixed at their actual DK points; games in progress are simmed from the current down, distance,
   score and clock with every player's stats so far carried in; games not started are simmed in full. Your lineups
   (DK entries file, else the built portfolio) get current and projected final points; loaded contest standings
   are re-ranked in every sim for live win and cash odds. */
const LIVEC = { busy: false };
async function espnSlateEvents() {
  const d = ST.games[0] && /(\d{2})\/(\d{2})\/(\d{4})/.exec(ST.games[0].date);
  const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard${d ? `?dates=${d[3]}${d[1]}${d[2]}` : ''}`, { cache: 'no-store' });
  if (!r.ok) throw new Error('ESPN returned ' + r.status); const js = await r.json(); const out = new Map();
  for (const ev of js.events || []) { const c = ev.competitions && ev.competitions[0]; if (!c) continue; const tm = {}; c.competitors.forEach((x) => tm[x.homeAway] = ESPN_AB[x.team.abbreviation] || x.team.abbreviation);
    const g = ST.games.find((g) => g.away === tm.away && g.home === tm.home); if (g) out.set(g.gi, { id: ev.id, comp: c, state: (c.status && c.status.type && c.status.type.state) || 'pre', detail: (c.status && c.status.type && c.status.type.shortDetail) || '' }); }
  return out;
}
async function pullLiveClassic() {
  const note = $('#lcStatus'); if (note) note.textContent = 'Pulling every game from ESPN…';
  try {
    const evs = await espnSlateEvents(); const P = ST.players; const pts = new Float64Array(P.length); const G = {};
    await Promise.all(ST.games.map(async (g) => {
      const e = evs.get(g.gi); const T = [g.away, g.home]; const Pg = P.slice(g.off, g.off + g.n);
      if (!e || e.state === 'pre') { G[g.gi] = { state: 'pre', detail: e ? e.detail : 'not found on ESPN', T }; return; }
      const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${e.id}`, { cache: 'no-store' }); if (!r.ok) throw new Error('ESPN returned ' + r.status);
      const js = await r.json(); const LV = dkFromEspn(js, Pg, T); const S = espnState(e.comp, js.situation, LV, T);
      for (let k = 0; k < g.n; k++) pts[g.off + k] = LV.pts[k];
      G[g.gi] = { state: e.state === 'post' || (S && S.final) ? 'post' : 'in', detail: e.detail, T, LV, S, score: LV.score || [S ? S.s0 : 0, S ? S.s1 : 0] };
    }));
    ST.lc = Object.assign(ST.lc || {}, { at: new Date(), G, pts }); if (note) note.textContent = `Updated ${ST.lc.at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    renderLiveClassic(); if ($('#lcAutoSim') && $('#lcAutoSim').checked && ST.res && !LIVEC.busy) simLiveClassic();
  } catch (e) { if (note) note.textContent = /Failed to fetch|NetworkError|Load failed|Content Security/i.test(String(e)) ? 'Could not reach ESPN from here. Use the downloaded HTML file if the viewer blocks it.' : String(e.message || e); }
}
// mid-game start for one game (same model as the showdown live sim, game-local player indices)
function startForGame(g, info) {
  const S = info.S, LV = info.LV, n = g.n, Pg = ST.players.slice(g.off, g.off + g.n), T = info.T; if (!S) return null;
  const m = /^(\d{1,2}):?(\d{2})?$/.exec(String(S.clk).trim()); const c = m ? (+m[1]) * 60 + (+(m[2] || 0)) : 900;
  const half = S.q <= 2 ? 1 : S.q <= 4 ? 2 : 3; const clock = half === 3 ? Math.min(600, c) : (S.q === 1 || S.q === 3 ? 900 + Math.min(900, c) : Math.min(900, c));
  const out = (LV.inj || []).filter((o) => o.status === 'out' || o.status === 'likely out').map((o) => o.j);
  const Z = { half, clock, to: (S.to || [3, 3]).slice(), score: [S.s0, S.s1], recvFirst: S.recv || 0, out };
  if ((S.pos || 'k0')[0] === 'k') { Z.phase = 1; Z.kicker = +(S.pos || 'k0')[1]; } else { const off = +S.pos[1]; Z.phase = 0; Z.off = off; Z.yl = S.yd >= 50 ? 50 : (S.side === off ? 100 - S.yd : S.yd); Z.down = S.down; Z.togo = Math.min(S.togo, Z.yl); }
  const z = () => new Array(n).fill(0); const B = { pY: z(), pTD: z(), pInt: z(), rY: z(), rTD: z(), rec: z(), recY: z(), recTD: z(), fl: z(), two: z(), ret: z(), kp: z(), rA: z(), tg: z(), pA: z(), pC: z() };
  Pg.forEach((p, j) => { const s = LV.st[j]; if (p.pos === 'K') { B.kp[j] = s.kpts || 0; return; } if (p.pos === 'DST') return;
    B.pY[j] = s.py; B.pTD[j] = s.ptd; B.pInt[j] = s.pint; B.rY[j] = s.ry; B.rTD[j] = s.rtd; B.rec[j] = s.rec; B.recY[j] = s.recy; B.recTD[j] = s.rectd; B.fl[j] = s.fl; B.two[j] = s.two; B.ret[j] = s.ret; B.rA[j] = s.ra; B.tg[j] = s.tg; B.pA[j] = s.pa; B.pC[j] = s.pc; });
  Z.buf = B; Z.dst = [0, 1].map((t) => { const d = Pg.findIndex((p) => p.pos === 'DST' && p.team === T[t]); const s = d >= 0 && LV.st[d].dst; return s ? { sk: s.sk, int: s.it, fr: s.fr, td: s.td, sf: s.sf || 0, blk: s.blk || 0, paX: s.paX || 0 } : {}; });
  return Z;
}
// one entry's lineup from your DK entries file (pre-set or assigned from the portfolio)
function lcEntryLineup(e) {
  if (!e) return null; const P = ST.players; if (!LIVEC.ix || LIVEC.ixP !== P) { LIVEC.ix = new Map(P.map((p, j) => [String(p.idF), j])); LIVEC.ixP = P; }
  let L = null; if (e.pre) L = (e.cells || []).map((x) => LIVEC.ix.get(String((/\((\d+)\)/.exec(x) || [null, x])[1])));
  else if (ST.assign) { const c = ST.assign.map.get(e.id); if (c) L = c.L; }
  return L && L.length === 9 && L.every((j) => j != null && j >= 0) ? L : null;
}
// lineups to track without standings: DK entries (pre-set and assigned), else the portfolio
function lcLineups() {
  const out = new Map(); const add = (L, fee) => { if (!L) return; const k = L.slice().sort((a, b) => a - b).join(','); const o = out.get(k) || { L, key: k, n: 0, fee: 0 }; o.n++; o.fee += fee || 0; out.set(k, o); };
  if (ST.entries) for (const e of ST.entries.rows) add(lcEntryLineup(e), +e.fee || 0);
  if (!out.size && ST.port) ST.port.forEach((o) => add(o.L, 0));
  return Array.from(out.values());
}
/* ---------------- contest standings, the same flow as the showdown lab ----------------
   DraftKings contest-standings download (.zip or .csv). While late games have not kicked off, DK hides those players as
   LOCKED in everyone's lineup. Your hidden slots come from your DK entries file (matched by entry ID); everyone else's are
   filled with players from the games not yet started, drawn by projected ownership within the $50,000 cap. Re-download
   the standings after each kickoff window to replace the fills with real players. */
const LC_SLOT = /\b(QB|RB|WR|TE|FLEX|DST)\s+/g;
const lcUser = () => (store.get('dkUser', '') || '').trim().toLowerCase();
const lcStrip = (u) => (u || '').replace(/\s*\(\d+\/\d+\)\s*$/, '').trim();
function lcParseStandings(text, fname) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const lines = text.split(/\r?\n/); const h = (SL.parseCSV(lines[0])[0] || []).map((x) => x.trim().toLowerCase()); const ix = (k) => h.indexOf(k);
  const iR = ix('rank'), iE = ix('entryid'), iN = ix('entryname'), iP = ix('points'), iL = ix('lineup'); if (iL < 0 || iE < 0) return null;
  const P = ST.players; const byName = new Map(); P.forEach((p, j) => { if (p.pos === 'DST') return; const k = SL.norm(p.name); if (!byName.has(k)) byName.set(k, j); });
  const dstBy = new Map(); P.forEach((p, j) => { if (p.pos === 'DST') dstBy.set(SL.norm(p.name), j); });
  const rows = []; const unk = new Map();
  for (let k = 1; k < lines.length; k++) { const ln = lines[k]; if (!ln) continue; const r = ln.indexOf('"') >= 0 ? (SL.parseCSV(ln)[0] || []) : ln.split(','); const id = (r[iE] || '').trim(); if (!id) continue;
    const parts = (r[iL] || '').trim().split(LC_SLOT).filter(Boolean); const sl = new Int16Array(9).fill(-2); const pos = [];
    for (let q = 0, s = 0; q + 1 < parts.length && s < 9; q += 2, s++) { const ps = parts[q], nm = parts[q + 1].trim(); pos.push(ps);
      if (/^LOCKED$/i.test(nm)) { sl[s] = -1; continue; } const j = ps === 'DST' ? dstBy.get(SL.norm(nm)) : byName.get(SL.norm(nm)); if (j == null) { unk.set(nm, (unk.get(nm) || 0) + 1); continue; } sl[s] = j; }
    rows.push({ id, user: (r[iN] || '').trim(), rank: +r[iR] || 0, pts: +r[iP] || 0, sl, pos: pos.length === 9 ? pos.join(' ') : null }); }
  if (!rows.length) return null;
  const cid = (/standings-(\d+)/i.exec(fname) || /(\d{6,})/.exec(fname) || [])[1] || fname;
  return { cid, file: fname, rows, total: rows.length, unk, at: new Date() };
}
// fill LOCKED slots: players from games no visible lineup slot comes from, weighted by projected ownership, under the cap
function lcResolve(C) {
  const P = ST.players; const user = lcUser(); const EN = ST.entries; const ownK = hasOwn() ? 'own' : 'est';
  const key = [user, EN ? EN.label + EN.rows.length : '', ST.assign ? 'a' : '', ownK, ST.res ? 'r' : ''].join('|'); if (C.rkey === key) return; C.rkey = key;
  const byId = new Map((EN ? EN.rows : []).map((e) => [String(e.id), e]));
  const seen = new Set(); for (const r of C.rows) for (const j of r.sl) if (j >= 0) seen.add(P[j].gi);
  const w = ST.res ? ownEst() : P.map((p) => p.active && p.salF > 0 ? (p.own != null ? p.own : 0.02) : 0);
  const pool = {}; ['QB', 'RB', 'WR', 'TE', 'DST'].forEach((ps) => pool[ps] = P.map((p, j) => j).filter((j) => P[j].pos === ps && !seen.has(P[j].gi) && w[j] > 0 && P[j].salF > 0));
  pool.FLEX = [...pool.RB, ...pool.WR, ...pool.TE]; const minSal = {}; for (const k in pool) minSal[k] = pool[k].length ? Math.min(...pool[k].map((j) => P[j].salF)) : 0;
  const ORDER = ['QB', 'DST', 'TE', 'RB', 'WR', 'FLEX'];
  const L = []; let nImp = 0, nMine = 0, myImp = 0, bad = 0; const cnt = new Map();
  for (const r of C.rows) { const mine = byId.has(r.id) || (!!user && lcStrip(r.user).toLowerCase() === user); let lu = null, imp = 0;
    if (mine) lu = lcEntryLineup(byId.get(r.id));
    if (!lu) { if (r.sl.some((j) => j === -2) || !r.pos) { bad++; if (mine) nMine++; continue; }
      lu = Array.from(r.sl); const hid = []; r.pos.split(' ').forEach((ps, s) => { if (lu[s] === -1) hid.push([ps, s]); });
      if (hid.length) { imp = hid.length; hid.sort((a, b) => ORDER.indexOf(a[0]) - ORDER.indexOf(b[0])); let rem = 50000 - lu.reduce((a, j) => a + (j >= 0 ? P[j].salF : 0), 0);
        let seed = 0; for (let q = 0; q < r.id.length; q++) seed = (seed * 31 + r.id.charCodeAt(q)) >>> 0; const rng = E.makeRng(seed || 1);
        hid.forEach(([ps, s], q) => { const restMin = hid.slice(q + 1).reduce((a, [p2]) => a + minSal[p2], 0); const last = q === hid.length - 1;
          const cs = pool[ps].filter((j) => !lu.includes(j) && P[j].salF <= rem - restMin); let pick = -1;
          if (cs.length) { let tot = 0; const ww = cs.map((j) => { const v = w[j] * (last ? Math.exp(-(rem - P[j].salF) / 1500) : 1); tot += v; return v; }); let u = rng() * tot; for (let q2 = 0; q2 < cs.length; q2++) { u -= ww[q2]; if (u <= 0) { pick = cs[q2]; break; } } if (pick < 0) pick = cs[cs.length - 1]; }
          else { const any = pool[ps].filter((j) => !lu.includes(j)).sort((a, b) => P[a].salF - P[b].salF); pick = any.length ? any[0] : -1; }
          lu[s] = pick; if (pick >= 0) rem -= P[pick].salF; });
        if (lu.some((j) => j < 0)) { bad++; if (mine) nMine++; continue; } nImp++; if (mine) myImp++; } }
    if (mine) nMine++; L.push({ L: lu, id: r.id, user: r.user, rank: r.rank, pts: r.pts, mine, imp }); lu.forEach((j) => cnt.set(j, (cnt.get(j) || 0) + 1)); }
  Object.assign(C, { L, nImp, myImp, bad, cnt, nMine, nMineOk: L.filter((x) => x.mine).length, res: null });
}
function lcMeta(C) {
  const e = ST.entries ? ST.entries.rows.find((r) => String(r.cid) === String(C.cid)) : null; const lf = store.get('lcFees', {});
  const fee = lf[C.cid] != null && lf[C.cid] !== '' ? +lf[C.cid] : (e ? e.fee : null);
  const tbl = (store.get('payouts', {}) || {})[C.cid];
  let pay = null; if (tbl && tbl.length) pay = Object.assign(payTable(tbl), { real: true }); else if (fee) { const f = payCurve(C.total, fee); pay = { Pd: Math.max(1, Math.round(0.22 * C.total)), avg: f.avg, real: false }; }
  return { fee, fromEntries: !!e, label: (fee != null ? `$${fee.toFixed(2)} ` : '') + (e ? shortName(e.cname) : `contest ${C.cid}`), tbl, pay };
}
// standing right now: DK's own rank from the file, or re-ranked with live points after a pull
function lcNow(C) {
  const LC = ST.lc; const m = lcMeta(C); const my = C.L.filter((x) => x.mine); if (!my.length) return { best: null, cash: 0, won: null };
  let ranks;
  if (LC && LC.pts) { const n = C.L.length; const sc = new Float32Array(n); C.L.forEach((x, i) => { let v = 0; for (const j of x.L) v += LC.pts[j]; sc[i] = v; }); const srt = sc.slice().sort(); const k = C.total / n;
    ranks = []; C.L.forEach((x, i) => { if (!x.mine) return; const v = sc[i]; let lo = 0, hi = n; while (lo < hi) { const mm = (lo + hi) >> 1; if (srt[mm] <= v) lo = mm + 1; else hi = mm; } let eq = 0, q = lo - 1; while (q >= 0 && srt[q] === v) { eq++; q--; } ranks.push([1 + (n - lo) * k, (n - lo + eq) * k]); }); }
  else ranks = my.map((x) => [x.rank, x.rank]);
  const Pd = m.pay ? m.pay.Pd : Math.round(0.22 * C.total);
  return { best: Math.min(...ranks.map((r) => r[0])), cash: ranks.filter((r) => r[0] <= Pd).length, won: m.pay ? ranks.reduce((a, r) => a + m.pay.avg(r[0], r[1]), 0) : null };
}
async function simLiveClassic() {
  if (!ST.res || LIVEC.busy) return; const st = $('#lcSim'); LIVEC.busy = true; const R = ST.res;
  try {
    makeWorkers(); const LC = ST.lc || {}; const G = ST.games; const N = Math.max(500, Math.min(20000, +($('#lcN') && $('#lcN').value) || 5000));
    if (st) st.textContent = `Simulating the rest of the slate ${N.toLocaleString()} times…`;
    const VA = adjustVacated().sh; const games = G.map((g) => { const info = LC.G && LC.G[g.gi]; const slate = gameSlate(g, VA); const s = R.gstat[g.gi].s;
      if (info && info.state === 'post') { const fixed = new Float32Array(g.n); for (let k = 0; k < g.n; k++) fixed[k] = LC.pts[g.off + k]; return { slate, off: g.off, s, fixed: Array.from(fixed), score: info.score || [0, 0] }; }
      if (info && info.state === 'in') return { slate, off: g.off, s, start: startForGame(g, info) };
      const v = qSlates(ST.players.slice(g.off, g.off + g.n), () => gameSlate(g)); return { slate, off: g.off, s, variants: v.length > 1 ? v : null }; });
    const per = Math.ceil(N / NW), nT = ST.players.length;
    const parts = (await Promise.all(workers.map((w, k) => { const n = Math.min(per, N - k * per); if (n <= 0) return null; return call(w, { type: 'sim', games, nTotal: nT, n, seed: (Date.now() + k * 7919) >>> 0, opt: null }); }))).filter(Boolean);
    let NN = 0; parts.forEach((p) => NN += p.n); const pts = new Float32Array(NN * nT); let o = 0; parts.forEach((p) => { pts.set(p.pts, o * nT); o += p.n; });
    const Cs = (ST.lcStand || []).filter((C) => { lcResolve(C); return C.nMineOk; });
    const res = await lcScore(pts, NN, nT, Cs, (d, lab) => { if (st) st.textContent = `Ranking ${lab} in every sim… ${Math.round(100 * d)}%`; });
    ST.lcSimR = Object.assign({ N: NN, nT, pts, at: new Date(), LS: lcLineups() }, res);
    const nIn = G.filter((g) => LC.G && LC.G[g.gi] && LC.G[g.gi].state === 'in').length, nPost = G.filter((g) => LC.G && LC.G[g.gi] && LC.G[g.gi].state === 'post').length;
    LIVEC.msg = `${NN.toLocaleString()} sims at ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · ${nPost} final, ${nIn} in progress (simmed from the current down), ${G.length - nIn - nPost} not started${Cs.length ? ` · ${res.NR.toLocaleString()} ranked against the full field` : ''}`;
    renderLiveClassic();
  } catch (e) { console.error(e); if (st) st.textContent = 'Sim failed: ' + e.message; }
  LIVEC.busy = false;
}
// every contest re-ranked in every sim: unique field lineups binned at 0.1 points (same method as the showdown live tab)
async function lcScore(pts, N0, nT, Cs, prog) {
  const fieldN = Cs.reduce((a, C) => a + C.L.length, 0); const NR = Math.min(N0, fieldN > 250000 ? 1200 : fieldN > 50000 ? 2000 : 3000); const sIdx = Int32Array.from({ length: NR }, (_, q) => Math.floor(q * N0 / NR));
  const W = 0.1, NB = 4000, CW = 20, NC = NB / CW; const tot$ = new Float64Array(NR); const out = [];
  for (const C of Cs) { const meta = lcMeta(C); const pay = meta.pay; const m = new Map();
    for (const x of C.L) { const k = x.L.slice().sort((a, b) => a - b).join(','); let u = m.get(k); if (!u) { u = { L: x.L, c: 0, my: 0, key: k }; m.set(k, u); } u.c++; if (x.mine) u.my++; }
    const U = Array.from(m.values()); const nu = U.length; const FL = new Int32Array(nu * 9), cnt = new Float64Array(nu); const myU = [];
    U.forEach((u, i) => { FL.set(u.L, i * 9); cnt[i] = u.c; if (u.my) myU.push(i); });
    out.push({ C, Lref: C.L, meta, pay, U, nu, FL, cnt, myU, myN: Float64Array.from(myU, (i) => U[i].my), Pd: pay ? pay.Pd : Math.round(C.total * 0.22), scale: C.total / C.L.length,
      ev: 0, p1: 0, pc: 0, ncash: 0, bestR: new Float64Array(NR), uev: new Float64Array(myU.length), ucash: new Float64Array(myU.length), u1: new Float64Array(myU.length) }); }
  const maxU = out.reduce((a, c) => Math.max(a, c.nu), 0); const hist = new Float64Array(NB), coarse = new Float64Array(NC), above = new Float64Array(NC + 1), bins = new Int32Array(maxU);
  for (const X of out) { const { nu, FL, cnt } = X;
    for (let s = 0; s < NR; s++) { const o = sIdx[s] * nT;
      for (let u = 0; u < nu; u++) { const f = u * 9; const v = pts[o + FL[f]] + pts[o + FL[f + 1]] + pts[o + FL[f + 2]] + pts[o + FL[f + 3]] + pts[o + FL[f + 4]] + pts[o + FL[f + 5]] + pts[o + FL[f + 6]] + pts[o + FL[f + 7]] + pts[o + FL[f + 8]];
        let b = Math.floor(v / W); b = b < 0 ? 0 : b >= NB ? NB - 1 : b; bins[u] = b; hist[b] += cnt[u]; coarse[(b / CW) | 0] += cnt[u]; }
      above[NC - 1] = 0; for (let k = NC - 2; k >= 0; k--) above[k] = above[k + 1] + coarse[k + 1];
      let any1 = 0, anyC = 0, best = 1e12;
      for (let q = 0; q < X.myU.length; q++) { const u = X.myU[q]; const b = bins[u]; const cb = (b / CW) | 0; let a = above[cb]; for (let bb = cb * CW + CW - 1; bb > b; bb--) a += hist[bb]; a += 0.5 * (hist[b] - cnt[u]);
        a *= X.scale; const t = cnt[u]; const rank = a + 1; if (rank < best) best = rank;
        const won = X.pay ? X.pay.avg(a + 1, a + t) * X.myN[q] : 0; X.uev[q] += won; X.ev += won; tot$[s] += won;
        if (rank <= X.Pd) { X.ucash[q]++; anyC = 1; X.ncash += X.myN[q]; } if (a < 0.5) { X.u1[q]++; any1 = 1; } }
      X.p1 += any1; X.pc += anyC; X.bestR[s] = best;
      for (let u = 0; u < nu; u++) { const b = bins[u]; hist[b] = 0; coarse[(b / CW) | 0] = 0; }
      if (s % 25 === 24) { prog((s + 1) / NR, X.meta.label); await new Promise((r) => setTimeout(r, 0)); } } }
  return { Cs: out, tot$, sIdx, NR };
}
const money = (v) => v == null ? '-' : (v < 0 ? '-' : '') + '$' + Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const lcShort = (p) => p.pos === 'DST' ? p.name : p.name.replace(/\s+(Jr\.?|Sr\.?|II|III|IV|V)$/i, '').split(' ').slice(-1)[0];
function renderLiveClassic() {
  const el = $('#pane-live'); if (!el) return; const P = ST.players; const LC = ST.lc || {}; const SR = ST.lcSimR; const keepY = window.scrollY;
  const C0 = ST.lcStand || []; C0.forEach(lcResolve); const myC = C0.filter((C) => C.nMineOk);
  const cur = LC.pts || new Float64Array(P.length); const left = (j) => { const i = LC.G && LC.G[P[j].gi]; return !i || i.state !== 'post'; };
  const gRows = ST.games.map((g) => { const i = LC.G && LC.G[g.gi]; const sc = i && i.score ? `${i.score[0]} - ${i.score[1]}` : '';
    return `<tr><td>${tdot(g.away)}${esc(g.away)} <span class="muted">@</span> ${tdot(g.home)}${esc(g.home)}</td><td class="n num">${sc}</td><td class="small">${i ? (i.state === 'post' ? '<span class="chip">Final</span>' : i.state === 'in' ? `<span class="chip ok">${esc(i.detail)}</span>` : `<span class="muted">${esc(i.detail || g.time)}</span>`) : `<span class="muted">${esc(g.time)}</span>`}</td>
      <td class="small muted">${i && i.LV && i.LV.inj && i.LV.inj.length ? i.LV.inj.map((o) => `${esc(P[g.off + o.j].name)} (${o.status})`).join(', ') : ''}</td></tr>`; }).join('');
  const sgn = (v) => `${v >= 0 ? '+' : '-'}$${Math.abs(v).toFixed(2)}`, col$ = (v) => `color:var(${v >= 0 ? '--good' : '--bad'});font-weight:600`, roi = (w, f) => f ? `${w >= f ? '+' : ''}${((w / f - 1) * 100).toFixed(0)}%` : '-';
  // contest management (upload, username, fees, payouts, standing now)
  const user = store.get('dkUser', '');
  const mRows = C0.map((C, ci) => { const m = lcMeta(C); const nw = lcNow(C);
    const notes = [C.nImp ? `${C.nImp.toLocaleString()} lineups had late-game players hidden (filled by projected ownership)` : '', C.myImp ? `<span style="color:var(--bad)">${C.myImp} of yours hidden too: load your DK entries file</span>` : '', C.bad ? `${C.bad} unreadable` : ''].filter(Boolean).join(' · ');
    return `<tr><td class="small" style="white-space:normal">${esc(m.label)}<div class="muted">${C.total.toLocaleString()} entries · file ${C.at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}${notes ? ' · ' + notes : ''}</div></td>
      <td class="n">${m.fromEntries ? '$' + m.fee.toFixed(2) : `<input type="number" step="0.01" min="0" data-lcfee="${esc(C.cid)}" value="${m.fee != null ? m.fee : ''}" placeholder="fee" style="width:70px">`}</td>
      <td class="n">${C.nMine || '<span style="color:var(--bad)">0</span>'}</td>
      <td><button class="small" data-lcpay="${ci}">${m.tbl ? `${m.tbl[m.tbl.length - 1][1].toLocaleString()} paid` : 'Paste payouts'}</button>${m.tbl ? '' : m.pay ? ' <span class="small muted">proj</span>' : ''}</td>
      <td class="n">${nw.best != null ? Math.round(nw.best).toLocaleString() : '-'}</td><td class="n">${C.nMine ? nw.cash : '-'}</td><td class="n">${nw.won != null && C.nMine ? money(nw.won) : '-'}</td>
      <td><button class="small" data-lcdel="${ci}" title="Remove this contest">×</button></td></tr>`; }).join('');
  const manage = `<div class="card" style="margin-top:16px"><div class="row" style="justify-content:space-between"><h3>Contest standings</h3><div class="row small"><label for="lcUser" class="muted">DraftKings username</label><input id="lcUser" type="text" value="${esc(user)}" placeholder="username" style="width:160px"></div></div>
    <p class="small muted">Download the standings for each contest you are in (the .zip from each contest page) and drop them all here at once; a newer file for the same contest replaces the old one. Your entries are found by username or entry ID. Players in games that have not kicked off show as LOCKED in DraftKings' file: yours come from your DK entries file, everyone else's are filled from those games by projected ownership under the cap. Re-download after each kickoff window for the real ones. Fees come from your entries file or type them; paste each payout table for exact winnings (otherwise projected).</p>
    <div class="drop" id="lcDrop" role="button" tabindex="0"><b>Upload contest-standings .zip or .csv files</b><input type="file" id="lcStandFile" accept=".zip,.csv" multiple hidden></div>
    ${C0.length ? `<div class="tw" style="border:0;margin-top:10px"><table class="nosort"><thead><tr><th>Contest</th><th class="n">Fee</th><th class="n">Yours</th><th>Payouts</th><th class="n" title="${LC.pts ? 'Re-ranked with live points' : 'From the standings file'}">Best rank now</th><th class="n">Cashing now</th><th class="n">Winning now</th><th></th></tr></thead><tbody>${mRows}</tbody></table></div>
      ${C0.some((C) => !C.nMine) ? `<p class="small" style="color:var(--bad)">None of your entries found in ${C0.filter((C) => !C.nMine).map((C) => esc(lcMeta(C).label)).join(', ')}. Check the username${ST.entries ? '' : ' or load your DK entries file on Portfolio builder'}.</p>` : ''}` : ''}
    <div id="lcPayBox"></div></div>`;
  // results from the last sim (same layout as the showdown live tab)
  let body = '';
  const fresh = SR && SR.Cs && SR.Cs.length && SR.Cs.every((X) => C0.includes(X.C) && X.C.L === X.Lref);
  if (fresh) {
    const N = SR.NR, nT = SR.nT, Cs = SR.Cs; const anyPay = Cs.some((X) => X.pay);
    const nMy = (X) => X.myN.reduce((a, b) => a + b, 0); const fees = Cs.reduce((a, X) => a + (X.meta.fee || 0) * nMy(X), 0), ev = Cs.reduce((a, X) => a + X.ev / N, 0);
    const prof = Float64Array.from(SR.tot$, (x) => x - fees).sort(); const pq = (x) => prof[Math.min(N - 1, Math.max(0, Math.round(x * (N - 1))))]; let pUp = 0; for (const v of prof) if (v > 0) pUp++;
    const pFirst = 1 - Cs.reduce((a, X) => a * (1 - X.p1 / N), 1);
    const crow = Cs.map((X) => { const br = X.bestR.slice().sort(); const f = (X.meta.fee || 0) * nMy(X), w = X.ev / N;
      return `<tr><td class="small" style="white-space:normal">${esc(X.meta.label)}</td><td class="n">${X.C.total.toLocaleString()}</td><td class="n">${nMy(X)}</td><td class="n">${pct(X.p1 / N, 1)}</td><td class="n">${pct(X.pc / N, 0)}</td><td class="n">${fmt(X.ncash / N, 1)}</td><td class="n">${Math.round(br[Math.floor(N / 2)]).toLocaleString()}</td><td class="n">${X.meta.fee != null ? money(f) : '-'}</td><td class="n">${X.pay ? `<b>${money(w)}</b>${X.pay.real ? '' : ' <span class="small muted">proj</span>'}` : '-'}</td>${X.pay ? `<td class="n" style="${col$(w - f)}">${sgn(w - f)}</td><td class="n">${roi(w, f)}</td>` : '<td class="n">-</td><td class="n">-</td>'}</tr>`; }).join('');
    // exposure: yours by entries, the field's by drafted share weighted by your fees in each contest
    const myX = new Float64Array(nT), fdX = new Float64Array(nT); let wSum = 0, myTot = 0;
    Cs.forEach((X) => { const w = Math.max(0.01, X.meta.fee || 1) * nMy(X); wSum += w; const nF = X.C.L.length; X.U.forEach((u) => u.L.forEach((j) => fdX[j] += w * u.c / nF)); X.myU.forEach((u, q) => { X.U[u].L.forEach((j) => myX[j] += X.myN[q]); myTot += X.myN[q]; }); });
    // root for: OLS slope of (capped) total winnings on the player's final points, scaled to his top-quarter minus bottom-quarter outcome
    const capped = pFirst < 0.02; const srt = Float64Array.from(SR.tot$).sort(); const cap = capped ? srt[Math.min(N - 1, Math.floor(0.99 * N))] : Infinity; const T$ = Float64Array.from(SR.tot$, (x) => Math.min(x, cap));
    let mt = 0; for (let i = 0; i < N; i++) mt += T$[i]; mt /= N;
    const col = new Float32Array(N); const pstat = []; const root = [];
    for (let j = 0; j < nT; j++) { if (!left(j) && !cur[j]) continue; const me = myTot ? myX[j] / myTot : 0, fd = wSum ? fdX[j] / wSum : 0; const mean0 = ST.res.stats[j] ? ST.res.stats[j].mean : 0; if (me < 0.005 && fd < 0.005 && mean0 < 1 && !cur[j]) continue;
      let mx = 0; for (let i = 0; i < N; i++) { col[i] = SR.pts[SR.sIdx[i] * nT + j]; mx += col[i]; } mx /= N; const so = col.slice().sort(); const q = (x) => so[Math.min(N - 1, Math.round(x * (N - 1)))]; const q25 = q(0.25), q75 = q(0.75);
      let sxy = 0, sxx = 0, hi = 0, nh = 0, lo = 0, nl = 0; for (let i = 0; i < N; i++) { const dx = col[i] - mx; sxy += dx * (T$[i] - mt); sxx += dx * dx; if (col[i] >= q75) { hi += col[i]; nh++; } if (col[i] <= q25) { lo += col[i]; nl++; } }
      const b = sxx ? sxy / sxx : 0, gap = (nh ? hi / nh : 0) - (nl ? lo / nl : 0);
      const r = { j, mean: mx, p10: q(0.1), p50: q(0.5), p90: q(0.9), my: me, fd, sw: b * gap }; if (me >= 0.03 || fd >= 0.03 || cur[j] || mean0 >= 5) pstat.push(r);
      if (r.sw !== 0 && !(me < 0.03 && fd < 0.03 && !cur[j])) root.push(r); }
    root.sort((a, b) => b.sw - a.sw); pstat.sort((a, b) => b.mean - a.mean);
    const rootTab = (arr, h) => `<div><h3 style="font-size:15px">${h}</h3><div class="tw" style="border:0"><table><thead><tr><th>Player</th><th class="n">Now</th><th class="n">Proj final</th><th class="n">You</th><th class="n">Field</th><th class="n">${anyPay ? '$ swing' : 'Swing'}</th></tr></thead><tbody>${arr.length ? '' : '<tr><td colspan="6" class="small muted">Nobody clears the bar yet.</td></tr>'}${arr.map((r) => `<tr><td>${tdot(P[r.j].team)}<button class="plink" data-pc="${r.j}">${esc(P[r.j].name)}</button><span class="pos">${P[r.j].pos}</span></td><td class="n">${fmt(cur[r.j], 1)}</td><td class="n">${fmt(r.mean, 1)}</td><td class="n">${pct(r.my, 0)}</td><td class="n">${pct(r.fd, 0)}</td><td class="n" style="${col$(r.sw)}">${sgn(r.sw)}</td></tr>`).join('')}</tbody></table></div></div>`;
    // your lineups by expected winnings across contests
    const LU = new Map(); Cs.forEach((X) => X.myU.forEach((u, q) => { const x = X.U[u]; if (!LU.has(x.key)) LU.set(x.key, { L: x.L, ev: 0, cs: [] }); const o = LU.get(x.key); o.ev += X.uev[q] / N; o.cs.push({ label: X.meta.label, fee: X.meta.fee || 0, n: X.myN[q], cash: X.ucash[q] / N, w1: X.u1[q] / N }); }));
    const lus = Array.from(LU.values()).map((o) => { let s = 0; const v = new Float32Array(N); for (let i = 0; i < N; i++) { let t = 0; const b = SR.sIdx[i] * nT; for (const j of o.L) t += SR.pts[b + j]; v[i] = t; s += t; } const so = v.sort();
      return Object.assign(o, { cur: o.L.reduce((a, j) => a + cur[j], 0), mean: s / N, p10: so[Math.floor(0.1 * (N - 1))], p90: so[Math.floor(0.9 * (N - 1))], left: o.L.filter(left).length }); }).sort((a, b) => b.ev - a.ev || b.mean - a.mean);
    const ord = { QB: 0, RB: 1, WR: 2, TE: 3, DST: 5 };
    body = `<div class="pc-tiles" style="margin-top:16px"><div><span class="lbl">Entry fees</span><b class="num">${fees ? money(fees) : '-'}</b></div><div><span class="lbl">Expected winnings</span><b class="num">${anyPay ? money(ev) : '-'}</b></div>
      ${anyPay ? `<div><span class="lbl">Exp. profit after fees</span><b class="num" style="${col$(ev - fees)}">${sgn(ev - fees)}</b></div><div><span class="lbl">ROI</span><b class="num" style="${col$(ev - fees)}">${roi(ev, fees)}</b></div><div><span class="lbl">Chance of profit</span><b class="num">${pct(pUp / N, 0)}</b></div><div><span class="lbl">Profit p10 / p50 / p90</span><b class="num">${sgn(pq(0.1))} / ${sgn(pq(0.5))} / ${sgn(pq(0.9))}</b></div>` : ''}<div><span class="lbl">Any entry first</span><b class="num">${pct(pFirst, 1)}</b></div></div>
    <div class="card" style="margin-top:12px"><h3>Contests from here</h3><p class="small muted">Each sim's final points re-rank the full field from your standings files. P(1st) and P(cash) are for any of your entries in that contest.</p><div class="tw" style="border:0"><table><thead><tr><th>Contest</th><th class="n">Field</th><th class="n">Yours</th><th class="n">P(1st)</th><th class="n">P(cash)</th><th class="n">Avg cashing</th><th class="n">Median best rank</th><th class="n">Fees</th><th class="n">Exp. winnings</th><th class="n">Exp. profit</th><th class="n">ROI</th></tr></thead><tbody>${crow}
      ${Cs.length > 1 && anyPay ? `<tr><td><b>Total</b></td><td></td><td class="n"><b>${Cs.reduce((a, X) => a + nMy(X), 0)}</b></td><td></td><td></td><td></td><td></td><td class="n"><b>${money(fees)}</b></td><td class="n"><b>${money(ev)}</b></td><td class="n" style="${col$(ev - fees)}">${sgn(ev - fees)}</td><td class="n"><b>${roi(ev, fees)}</b></td></tr>` : ''}</tbody></table></div></div>
    <div class="card" style="margin-top:12px"><h3>Who to root for</h3><p class="small muted">Your expected total winnings when the player lands in his top quarter of outcomes from here, minus when he lands in his bottom quarter. Swing is fit across every sim, then scaled to his top-quarter minus bottom-quarter outcome; ${capped ? 'winnings are capped at the 99th percentile sim so one rare first-place finish does not drive it' : 'winnings are not capped because one of your entries wins its contest in ' + pct(pFirst, 1) + ' of sims, so those wins count in full'}. Field share counts the filled-in late-game players until you load a newer standings file. Hidden: players under 3% for both you and the field who have not scored yet.</p><div class="grid2">${rootTab(root.filter((r) => r.sw > 0).slice(0, 12), 'Root for')}${rootTab(root.filter((r) => r.sw < 0).slice(-12).reverse(), 'Root against')}</div></div>
    <div class="card" style="margin-top:12px"><h3>Your lineups from here</h3><div class="tw" style="border:0;max-height:560px;overflow:auto"><table><thead><tr><th class="n">Now</th><th class="n">Left</th><th class="n">Proj final</th><th class="n">p10</th><th class="n">p90</th><th class="n">Fees</th><th class="n">Exp. winnings</th><th class="n">Exp. profit</th><th>Lineup</th><th>Contests (P cash · P 1st)</th></tr></thead><tbody>
      ${lus.slice(0, 150).map((o) => { const f = o.cs.reduce((x, c) => x + c.fee * c.n, 0); return `<tr><td class="n"><b>${fmt(o.cur, 1)}</b></td><td class="n">${o.left}</td><td class="n">${fmt(o.mean, 1)}</td><td class="n">${fmt(o.p10, 1)}</td><td class="n">${fmt(o.p90, 1)}</td><td class="n">${money(f)}</td><td class="n"><b>${anyPay ? money(o.ev) : '-'}</b></td><td class="n" style="${anyPay ? col$(o.ev - f) : ''}">${anyPay ? sgn(o.ev - f) : '-'}</td>
        <td class="small">${o.L.slice().sort((a, b) => (ord[P[a].pos] - ord[P[b].pos]) || P[b].salF - P[a].salF).map((j) => `<span title="${esc(P[j].name)}">${esc(lcShort(P[j]))}${cur[j] ? `<span class="muted"> ${fmt(cur[j], 1)}</span>` : ''}</span>`).join(', ')}</td>
        <td class="small" style="white-space:normal">${o.cs.sort((a, b) => b.fee - a.fee).map((c) => `${esc(c.label)}${c.n > 1 ? ` ×${c.n}` : ''}: ${pct(c.cash, 0)} · ${pct(c.w1, 1)}`).join('<br>')}</td></tr>`; }).join('')}</tbody></table></div></div>
    <div class="card" style="margin-top:12px"><h3>Player finals from here</h3><p class="small muted">Players you or the field have at 3%+, or still projecting 5+ points.</p><div class="tw" style="border:0;max-height:560px;overflow:auto"><table><thead><tr><th>Player</th><th class="n">Now</th><th class="n">Mean</th><th class="n">p10</th><th class="n">p50</th><th class="n">p90</th><th class="n">You</th><th class="n">Field</th></tr></thead><tbody>
      ${pstat.map((r) => `<tr><td>${tdot(P[r.j].team)}<button class="plink" data-pc="${r.j}">${esc(P[r.j].name)}</button><span class="pos">${P[r.j].pos}</span></td><td class="n">${fmt(cur[r.j], 1)}</td><td class="n"><b>${fmt(r.mean, 1)}</b></td><td class="n">${fmt(r.p10, 1)}</td><td class="n">${fmt(r.p50, 1)}</td><td class="n">${fmt(r.p90, 1)}</td><td class="n">${pct(r.my, 0)}</td><td class="n">${pct(r.fd, 0)}</td></tr>`).join('')}</tbody></table></div></div>`;
  } else {
    // before a sim with standings: your lineups (entries file or portfolio) and a plain exposure comparison
    const LS = (SR && SR.LS) || lcLineups();
    body = `<p class="note" style="margin-top:12px">${myC.length ? 'Run "Sim rest of slate" for contest odds, expected winnings and who to root for.' : 'Load your contest-standings files above to get contest odds, expected winnings and who to root for, the same as the showdown live tab.'}</p>
    ${LS.length ? `<div class="card" style="margin-top:12px"><h3>Your lineups (${LS.length})</h3><p class="small muted">From ${ST.entries ? 'your DK entries file' : 'the portfolio'}. Now = DK points so far.</p><div class="tw" style="border:0;max-height:560px;overflow:auto"><table><thead><tr><th>Lineup</th><th class="n">Entries</th><th class="n">Now</th><th class="n">Left</th></tr></thead><tbody>
      ${LS.map((x) => `<tr><td class="small">${x.L.map((j) => `${esc(lcShort(P[j]))}${cur[j] ? `<span class="muted"> ${fmt(cur[j], 1)}</span>` : ''}`).join(', ')}</td><td class="n">${x.n}</td><td class="n"><b>${fmt(x.L.reduce((a, j) => a + cur[j], 0), 1)}</b></td><td class="n">${x.L.filter(left).length}</td></tr>`).join('')}</tbody></table></div></div>` : ''}`;
  }
  el.innerHTML = `<div class="card"><div class="row" style="justify-content:space-between"><h3>Live slate</h3><div class="row small">
      <button id="lcPull" class="primary">Pull live (ESPN)</button><label><input type="checkbox" id="lcAuto" ${LIVEC.auto ? 'checked' : ''}> refresh every 2 min</label><label><input type="checkbox" id="lcAutoSim" ${LIVEC.autoSim ? 'checked' : ''}> re-sim on refresh</label>
      <label>Sims <input id="lcN" type="number" min="500" max="20000" step="1000" value="${LIVEC.n || 5000}" style="width:80px"></label><button id="lcGo">Sim rest of slate</button></div></div>
    <p class="small muted"><span id="lcStatus">${LC.at ? 'Updated ' + LC.at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'Not pulled yet.'}</span> · <span id="lcSim">${esc(LIVEC.msg || '')}</span></p>
    <div class="tw" style="border:0"><table class="nosort"><thead><tr><th>Game</th><th class="n">Score</th><th>Status</th><th>Injuries seen in play-by-play</th></tr></thead><tbody>${gRows}</tbody></table></div></div>
  ${manage}${body}`;
  window.scrollTo(0, keepY);
  const stale = () => { ST.lcSimR = null; };
  $('#lcPull', el).onclick = pullLiveClassic; $('#lcGo', el).onclick = () => { LIVEC.n = +$('#lcN', el).value || 5000; simLiveClassic(); };
  $('#lcAuto', el).onchange = (e) => { LIVEC.auto = e.target.checked; clearInterval(LIVEC.timer); if (LIVEC.auto) LIVEC.timer = setInterval(pullLiveClassic, 120000); };
  $('#lcAutoSim', el).onchange = (e) => { LIVEC.autoSim = e.target.checked; };
  $('#lcN', el).onchange = (e) => { LIVEC.n = +e.target.value || 5000; };
  $('#lcUser', el).onchange = (e) => { store.set('dkUser', e.target.value.trim()); stale(); renderLiveClassic(); };
  const load = async (files) => { const cur2 = (ST.lcStand || []).slice(); const errs = []; const stEl = $('#lcSim');
    for (const f of files) { try { if (stEl) stEl.textContent = `Reading ${f.name}…`; await new Promise((r) => setTimeout(r, 20)); const txt = await readUpload(f); const C = lcParseStandings(txt, f.name); if (!C) { errs.push(`${f.name}: not a DraftKings contest standings file`); continue; } const k = cur2.findIndex((x) => x.cid === C.cid); if (k >= 0) cur2[k] = C; else cur2.push(C); } catch (e) { errs.push(`${f.name}: ${e.message}`); } }
    ST.lcStand = cur2; stale(); if (errs.length) toast(errs.join('; ')); renderLiveClassic(); };
  const fi = $('#lcStandFile', el), d = $('#lcDrop', el);
  fi.onchange = () => { const f = Array.from(fi.files); fi.value = ''; if (f.length) load(f); }; d.onclick = (e) => { if (e.target.tagName !== 'INPUT') fi.click(); };
  d.ondragover = (e) => { e.preventDefault(); d.classList.add('over'); }; d.ondragleave = () => d.classList.remove('over'); d.ondrop = (e) => { e.preventDefault(); d.classList.remove('over'); const f = Array.from(e.dataTransfer.files); if (f.length) load(f); };
  $$('input[data-lcfee]', el).forEach((i) => i.onchange = () => { const lf = store.get('lcFees', {}); lf[i.dataset.lcfee] = i.value === '' ? '' : +i.value; store.set('lcFees', lf); stale(); renderLiveClassic(); });
  $$('button[data-lcdel]', el).forEach((b) => b.onclick = () => { ST.lcStand.splice(+b.dataset.lcdel, 1); stale(); renderLiveClassic(); });
  $$('button[data-lcpay]', el).forEach((b) => b.onclick = () => { const C = C0[+b.dataset.lcpay]; const m = lcMeta(C); const box = $('#lcPayBox', el);
    box.innerHTML = `<div class="card" style="margin-top:10px"><h3 style="font-size:16px">Payouts: ${esc(m.label)}</h3><p class="small muted">Copy the prize table from the contest details on DraftKings and paste it here (lines like "1st $1,000.00" and "11th - 15th $20.00").</p>
      <textarea id="lcPayTxt" rows="8" style="width:100%">${m.tbl ? m.tbl.map(([lo, hi, v]) => `${lo}${hi > lo ? ' - ' + hi : ''} $${v}`).join('\n') : ''}</textarea>
      <div class="row" style="margin-top:8px"><button class="primary" id="lcPaySave">Save payouts</button><button id="lcPayClear">Clear</button><button id="lcPayClose">Close</button><span id="lcPayNote" class="small muted"></span></div></div>`;
    const ta = $('#lcPayTxt', box); const note = () => { const t = parsePayouts(ta.value); $('#lcPayNote', box).textContent = t.length ? `${t.length} tiers, ${t[t.length - 1][1].toLocaleString()} places paid, ${money(payTotal(t))} total` : 'No payout lines recognized yet.'; };
    ta.oninput = note; note(); ta.focus();
    const setP = (t) => { const p = store.get('payouts', {}) || {}; if (t && t.length) p[C.cid] = t; else delete p[C.cid]; store.set('payouts', p); stale(); };
    $('#lcPaySave', box).onclick = () => { const t = parsePayouts(ta.value); if (!t.length) { toast('No payout lines recognized'); return; } setP(t); toast('Payouts saved. Sim again for expected winnings.'); renderLiveClassic(); };
    $('#lcPayClear', box).onclick = () => { setP(null); renderLiveClassic(); }; $('#lcPayClose', box).onclick = () => { box.innerHTML = ''; }; });
}
