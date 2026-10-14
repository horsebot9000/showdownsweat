/* NFL Showdown play-by-play engine. Pure JS, no DOM. Used by the browser workers and the Node backtest. */
(function (root) {
'use strict';
function makeRng(seed) {
  let a = seed >>> 0 || 1, b = (seed * 2654435761) >>> 0 || 7, c = 0x9e3779b9, d = 0x7f4a7c15;
  return function () {
    const t = b << 9; let r = a * 5; r = ((r << 7) | (r >>> 25)) * 9;
    c ^= a; d ^= b; b ^= c; a ^= d; c ^= t; d = (d << 11) | (d >>> 21);
    return (r >>> 0) / 4294967296;
  };
}
const ZE = [2, 5, 10, 20, 100];
function zoneOf(y) { for (let i = 0; i < 5; i++) if (y <= ZE[i]) return i; return 4; }
const TOGO = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 13, 17, 99];
const SD = [-17, -9, -4, -1, 0, 3, 8, 16, 99];
function binOf(v, edges) { for (let i = 0; i < edges.length; i++) if (v <= edges[i]) return i; return edges.length - 1; }
function ylBin(y) { return Math.min(19, Math.max(0, Math.ceil(y / 5) - 1)); }
function tstate(qtr, hs) {
  if (qtr === 1) return 0; if (qtr === 2) return hs > 120 ? 1 : 2; if (qtr === 3) return 3;
  if (qtr === 4) return hs > 600 ? 4 : hs > 300 ? 5 : hs > 120 ? 6 : 7; return 8;
}
function logit(p) { p = Math.min(0.999, Math.max(0.001, p)); return Math.log(p / (1 - p)); }
function sig(x) { return 1 / (1 + Math.exp(-x)); }

/* ---------------- league prep ---------------- */
function prepLeague(L) {
  if (L._prepped) return L;
  const pools = {};
  const get = (k) => L.pools[k] || [];
  const merge = (k, fb, min) => { let a = get(k).slice(); for (const f of fb) { if (a.length >= min) break; a = a.concat(get(f)); } return a; };
  for (let z = 0; z < 5; z++) {
    pools['R_RB_' + z] = merge('R_RB_' + z, ['R_RB_' + Math.min(4, z + 1)], 60);
    pools['R_QB_' + z] = merge('R_QB_' + z, ['S_' + z, 'R_RB_' + z], 60);
    pools['R_WR_' + z] = merge('R_WR_' + z, ['R_RB_' + z], 60);
    pools['S_' + z] = merge('S_' + z, ['R_QB_' + z, 'R_RB_' + z], 60);
    pools['T_WR_' + z] = merge('T_WR_' + z, ['T_TE_' + z], 60);
    pools['T_TE_' + z] = merge('T_TE_' + z, ['T_WR_' + z], 60);
    pools['T_RB_' + z] = merge('T_RB_' + z, ['T_TE_' + z, 'T_WR_' + z], 60);
  }
  const flat = {};
  for (const k in pools) {
    const arr = pools[k]; const w = arr[0] ? arr[0].length : 2;
    const f = new Int16Array(arr.length * w); arr.forEach((r, i) => { for (let j = 0; j < w; j++) f[i * w + j] = r[j]; });
    flat[k] = { a: f, w: w, n: arr.length };
  }
  L._pools = flat;
  const qa = (a) => Float64Array.from(a);
  L._clock = {}; for (const k in L.clock) L._clock[k] = qa(L.clock[k]);
  // punt bins fallback
  L._punt = [];
  for (let b = 0; b < 20; b++) {
    let best = null;
    for (let d = 0; d < 20 && !best; d++) for (const bb of [b - d, b + d]) if (!best && L.punt[bb] && L.punt[bb].length >= 30) best = L.punt[bb];
    L._punt[b] = best;
  }
  L._prepped = true; return L;
}
function sampleClock(L, R, cat, mode) {
  const q = L._clock[cat + '_' + mode] || L._clock[cat + '_all'] || L._clock['inb_all'];
  const u = R() * (q.length - 1); const i = Math.floor(u); return q[i] + (q[i + 1] - q[i]) * (u - i);
}

/* ---------------- game prep ----------------
 slate: {teams:[A,B], implied:[a,b], players:[{name,team,pos,mid,active,rs,ts,rsz,tsz,isStarterQB}] }
 Everything per-player already resolved by caller (shares are raw, normalized dynamically). */
function prepGame(MODEL, slate) {
  const L = prepLeague(MODEL.league);
  const P = slate.players.map((p, i) => Object.assign({ i: i }, p));
  const teams = [0, 1].map((t) => {
    const ab = slate.teams[t]; const tm = (MODEL.teams[ab] || {});
    const off = P.filter((p) => p.team === ab && p.active && ['QB', 'RB', 'WR', 'TE'].includes(p.pos));
    const qbs = off.filter((p) => p.pos === 'QB').sort((a, b) => (b.isStarterQB - a.isStarterQB) || (b.sal - a.sal));
    const T = {
      ab: ab, idx: t, proe: (tm.proe || 0) + (slate.teamAdj && slate.teamAdj[t] ? slate.teamAdj[t].proe || 0 : 0),
      pace: tm.pace || 0, go: tm.go || 0, dsk: tm.dsk || 1, dint: tm.dint || 1, dproe: tm.dproe || 0, drun: tm.drun || 0,
      qb: qbs.length ? qbs[0].i : -1, qb2: qbs.length > 1 ? qbs[1].i : -1,
      off: off.filter((p) => p.pos !== 'QB' || p.i === (qbs[0] && qbs[0].i) || (qbs[1] && p.i === qbs[1].i)).map((p) => p.i),
      k: -1, kadj: 0, dst: -1, kr: [], pr: []
    };
    const K = P.find((p) => p.team === ab && p.pos === 'K' && p.active); if (K) { T.k = K.i; T.kadj = (MODEL.kickerAdj || {})[K.mid] || 0; }
    const DST = P.find((p) => p.team === ab && p.pos === 'DST'); if (DST) T.dst = DST.i;
    const mapRet = (obj) => { const out = []; if (!obj) return out; for (const gid in obj) { const pl = P.find((p) => p.mid === gid && p.active); if (pl) out.push([pl.i, obj[gid]]); } return out; };
    T.kr = mapRet(tm.kr); T.pr = mapRet(tm.pr);
    return T;
  });
  // per-player arrays
  for (const p of P) {
    const m = (MODEL.players || {})[p.mid] || {};
    p.posKey = p.pos === 'TE' ? 'TE' : p.pos === 'RB' ? 'RB' : p.pos === 'QB' ? 'QB' : 'WR';
    p.rpos = p.pos === 'QB' ? 'QB' : p.pos === 'RB' ? 'RB' : 'WR';
    p.tpos = p.pos === 'TE' ? 'TE' : p.pos === 'RB' ? 'RB' : 'WR';
    p.rp = m.rp ? Int16Array.from([].concat(...m.rp.map((y) => [y, 0]))) : null; p.rpown = m.rp ? (m.rn || 0) / ((m.rn || 0) + L.k.rush_eff) : 0;
    p.tp = m.tp ? Int16Array.from(m.tp) : null; p.tpown = m.tp ? (m.tn || 0) / ((m.tn || 0) + L.k.tgt_eff) : 0;
    p.sk = m.sk != null ? m.sk : L.sackBase; p.sc = m.sc != null ? m.sc : L.scrBase; p.it = m.it != null ? m.it : L.intBase;
    if (p.ovSk != null) p.sk = p.ovSk; if (p.ovSc != null) p.sc = p.ovSc;
    if (p.rsy == null) p.rsy = p.rs; if (p.tpd == null) p.tpd = p.ts;
    p.inj = ((+p.rs || 0) + (+p.ts || 0) >= 0.04 || p.isStarterQB) ? (L.inj[p.posKey] || 0.02) / 62 : 0;
  }
  const W = (slate && slate.weather) || {}; // game weather: pass-rate shift, pass/run efficiency tilts, fumble multiplier, FG logit shift
  const G = { L: L, P: P, T: teams, n: P.length, W: { proe: W.proe || 0, sp: W.sp || 0, sr: W.sr || 0, fum: W.fum || 1, fg: W.fg || 0 } };
  const n = P.length;
  G.buf = { pY: new Float64Array(n), pTD: new Float64Array(n), pInt: new Float64Array(n), rY: new Float64Array(n), rTD: new Float64Array(n),
    rec: new Float64Array(n), recY: new Float64Array(n), recTD: new Float64Array(n), fl: new Float64Array(n), two: new Float64Array(n),
    ret: new Float64Array(n), kp: new Float64Array(n), inj: new Uint8Array(n), rsx: new Float64Array(n), tsx: new Float64Array(n), rA: new Float64Array(n), tg: new Float64Array(n), pA: new Float64Array(n), pC: new Float64Array(n) };
  return G;
}

/* ---------------- simulation ---------------- */
const NS = 16; // summary stats per team
// summary layout per team: 0 pts,1 plays,2 passAtt,3 sacks,4 rushAtt,5 passYds,6 rushYds,7 penalties(no-play),8 4thAtt,9 FGA,10 punts,11 turnovers,12 TDs,13 drives,14 scrambles,15 int
function simGame(G, R, sArr, out, summ) {
  const L = G.L, P = G.P, T = G.T, B = G.buf, n = G.n; const WX = G.W || { proe: 0, sp: 0, sr: 0, fum: 1, fg: 0 };
  for (const k in B) B[k].fill(0);
  const S = summ || new Float64Array(2 * NS); S.fill(0); G._ot = 0;
  const dst = [{ sk: 0, int: 0, fr: 0, td: 0, sf: 0, blk: 0, paX: 0 }, { sk: 0, int: 0, fr: 0, td: 0, sf: 0, blk: 0, paX: 0 }];
  const score = [0, 0]; const qb = [T[0].qb, T[1].qb];
  const NZ = L.noise || {}; const ADJ = L.adj || {};
  const gauss = () => { let u = 0, v = 0; while (u === 0) u = R(); v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const sEff = [sArr[0] + (NZ.s || 0) * gauss(), sArr[1] + (NZ.s || 0) * gauss()];
  const proeN = [(NZ.proe || 0) * gauss() + (ADJ.passLogit || 0), (NZ.proe || 0) * gauss() + (ADJ.passLogit || 0)];
  const paceM = Math.exp((NZ.pace || 0) * gauss());
  const ZS = G.start || {}; // mid-game: game-specific usage uncertainty shrinks once tonight's carries/targets are observed
  const sr = (NZ.shareR != null ? NZ.shareR : (NZ.share || 0)) * (ZS.srMul != null ? ZS.srMul : 1), st = (NZ.shareT != null ? NZ.shareT : (NZ.share || 0)) * (ZS.stMul != null ? ZS.stMul : 1);
  for (let i = 0; i < n; i++) { B.rsx[i] = Math.exp(sr * gauss() - 0.5 * sr * sr); B.tsx[i] = Math.exp(st * gauss() - 0.5 * st * st); }
  const blowSwap = [false, false];
  const LOG = G.log || null; let ev = null, driveNo = 0;
  const nm = (i) => (i >= 0 && P[i]) ? P[i].name : 'unknown';
  const spotTxt = (t, y) => y === 50 ? '50' : (y > 50 ? T[t].ab + ' ' + (100 - y) : T[1 - t].ab + ' ' + y);
  const note = (type, txt) => { if (!ev) return; if (type && !ev.t) ev.t = type; if (type === 'td' || type === 'to' || type === 'fg' || type === 'inj' || type === 'sf') ev.flags.push(type); ev.x.push(txt); };
  if (LOG) { LOG.meta = { s: sEff.slice(), proe: proeN.slice(), pace: paceM }; G._gt = 0; }
  let half = 1, clock = 1800, to = [3, 3], off = 0, yl = 75, down = 1, togo = 10, over = false;
  const otPoss = [0, 0];
  let recvFirst = R() < 0.5 ? 0 : 1;
  let phase = 1; let kicker = 1 - recvFirst; let freeKick = false;
  const qtrOf = () => half === 1 ? (clock > 900 ? 1 : 2) : half === 2 ? (clock > 900 ? 3 : 4) : 5;
  const extra = (s) => { const a = Math.abs(s); let k = Math.floor(a); if (R() < a - k) k++; return k; };
  function pick(list, wfn) { let tot = 0; for (const i of list) tot += wfn(i); if (tot <= 0) return -1; let u = R() * tot; for (const i of list) { u -= wfn(i); if (u <= 0) return i; } return list[list.length - 1]; }
  function blowout() { const sd = Math.abs(score[0] - score[1]); const q = qtrOf(); return q >= 4 && (sd >= 17 || (sd >= 14 && clock < 420)); }
  // ctx: 0 normal, 1 red zone (<=10), 2 short yardage (3rd/4th & <=2)
  const RHO = L.rbRho != null ? L.rbRho : 0.53; const lead = [-1, -1]; let leadNote = null;
  function baseRush(t, i, ctx) { const p = P[i];
    if (p.pos === 'QB') { if (i !== qb[t]) return 0; return ctx === 1 ? T[t].qbRsz : ctx === 2 ? T[t].qbRsy : T[t].qbRs; }
    return (ctx === 1 ? p.rsz : ctx === 2 ? p.rsy : p.rs) * B.rsx[i]; }
  // Series rotation (fit by max likelihood on 5,775 drives, 2024-26): lead back chosen with prob ~ share^GAM, he takes RHO of
  // the drive's normal carries; remaining carries use weights q chosen so each back's expected share is unchanged.
  const GAM = L.rbGam != null ? L.rbGam : 1.75; const qW = [new Float64Array(n), new Float64Array(n)];
  // Opening script: on each team's first offensive plays the starters are on the field and the ball is scripted to them, so carries and
  // targets concentrate on the top of the depth chart (fit to 2024-26 first-3-play vs rest-of-game usage by depth rank, bt_firstdrive.py).
  const EA = L.early || { n: 3, lt: 0, lr: 0, gam1: GAM }; const early = (t) => half === 1 && S[t * NS + 1] <= EA.n;
  function pickLead(t) {
    let tot = 0, totL = 0; const ids = [];
    const G1 = (half === 1 && S[t * NS + 13] === 1) ? EA.gam1 : GAM; // opening series: lead back follows the depth chart more closely
    for (const i of T[t].off) if (!B.inj[i] && P[i].pos === 'RB') { const w = baseRush(t, i, 0); if (w > 0) { ids.push(i); tot += w; totL += Math.pow(w, G1); } }
    lead[t] = -1; qW[t].fill(0); if (tot <= 0) return;
    let u = R() * totL; for (const i of ids) { u -= Math.pow(baseRush(t, i, 0), G1); if (u <= 0) { lead[t] = i; break; } } if (lead[t] < 0) lead[t] = ids[ids.length - 1];
    let qs = 0; for (const i of ids) { const pi = baseRush(t, i, 0) / tot, Li = Math.pow(baseRush(t, i, 0), G1) / totL; const q = Math.max(0, pi - RHO * Li); qW[t][i] = q; qs += q; }
    if (qs > 0) for (const i of ids) qW[t][i] /= qs;
  }
  function rushW(t, ctx, bl) {
    let rbTot = 0; if (ctx === 0 && !bl && lead[t] >= 0) for (const i of T[t].off) if (!B.inj[i] && P[i].pos === 'RB') rbTot += baseRush(t, i, 0);
    const ex = !bl && EA.lr && early(t) ? 1 + EA.lr : 1;
    return (i) => { if (B.inj[i]) return 0; const p = P[i]; let w = baseRush(t, i, ctx);
      if (p.pos === 'RB') { if (bl) w = Math.pow(w, 0.45) * 0.55; else if (ctx === 0 && rbTot > 0) w = rbTot * (RHO * (i === lead[t] ? 1 : 0) + (1 - RHO) * qW[t][i]); }
      return ex !== 1 && w > 0 ? Math.pow(w, ex) : w; };
  }
  function tgtW(t, ctx, bl) { const ex = !bl && EA.lt && early(t) ? 1 + EA.lt : 1; return (i) => { if (B.inj[i]) return 0; const p = P[i]; if (p.pos === 'QB') return 0; const w = (ctx === 1 ? p.tsz : ctx === 3 ? p.tpd : p.ts) * B.tsx[i]; return bl ? Math.pow(w, 0.85) : (ex !== 1 && w > 0 ? Math.pow(w, ex) : w); }; }
  for (let t = 0; t < 2; t++) { const q = T[t].qb >= 0 ? P[T[t].qb] : null; T[t].qbRs = q ? q.rs : 0; T[t].qbRsz = q ? q.rsz : 0; T[t].qbRsy = q ? (q.rsy != null ? q.rsy : q.rs) : 0; }
  function poolDraw(key, own, pown, s, w) {
    // returns index into chosen flat array; tilt by s: take best (s>0) or worst (s<0) of 1+extra draws
    const pp = L._pools[key]; let best = null, bv = 0, bArr = null;
    const k = 1 + extra(s);
    for (let d = 0; d < k; d++) {
      let arr, idx;
      if (own && R() < pown) { arr = own; idx = Math.floor(R() * (own.length / w)) * w; } else { arr = pp.a; idx = Math.floor(R() * pp.n) * pp.w; }
      const v = w === 3 ? arr[idx + 1] * (arr[idx] ? 1 : 0) + (arr[idx + 2] ? 15 : 0) : arr[idx] + (arr[idx + 1] ? 15 : 0);
      if (best === null || (s >= 0 ? v > bv : v < bv)) { best = idx; bv = v; bArr = arr; }
    }
    return [bArr, best];
  }
  function credRet(t, list) { const i = pick(list.map((x) => x[0]), (j) => { const e = list.find((x) => x[0] === j); return e ? e[1] : 0; }); if (i >= 0) B.ret[i] += 1; }
  function changePoss(newOff, newYl) {
    off = newOff; yl = Math.max(1, Math.min(99, newYl)); down = 1; togo = Math.min(10, yl); S[newOff * NS + 13]++; driveNo++;
    pickLead(newOff); if (LOG && lead[newOff] >= 0) leadNote = ({ h: half, q: qtrOf(), c: clock, off: newOff, ko: false, drive: driveNo, down: 1, togo: togo, yl: yl, s0: score[0], s1: score[1], a0: score[0], a1: score[1], t: 'info', x: [`Lead back this series: ${nm(lead[newOff])}`], flags: [], info: 1 });
    if (half === 3) { otPoss[newOff]++; if (otPoss[0] >= 1 && otPoss[1] >= 1 && score[0] !== score[1] && otPoss[newOff] >= 2) over = true; }
  }
  function otCheckAfterScore(scorer) {
    if (half === 3 && otPoss[0] >= 1 && otPoss[1] >= 1 && score[0] !== score[1]) over = true;
  }
  function addScore(t, pts, defensive) { score[t] += pts; S[t * NS] += pts; if (defensive) dst[1 - t].paX += pts; }
  function touchdown(t, defensive) {
    addScore(t, 6, defensive); S[t * NS + 12]++;
    // PAT
    const sd = score[t] - score[1 - t]; const late = (half >= 2 && clock <= 900) ? 1 : 0;
    const key = late + '_' + Math.max(-20, Math.min(20, sd));
    const pGo = L.twoPtGo[key] != null ? L.twoPtGo[key] : 0.05;
    if (R() < pGo) {
      const ok = R() < Math.min(0.75, Math.max(0.25, L.twoPt.succ * (1 + 0.25 * sEff[t])));
      if (ok) {
        addScore(t, 2, defensive);
        if (R() < L.twoPt.passRate) { if (qb[t] >= 0) B.two[qb[t]]++; const r = pick(T[t].off, tgtW(t, 1, false)); if (r >= 0) B.two[r]++; note('', `2-pt try (go rate ${Math.round(pGo * 100)}%): ${nm(qb[t])} pass to ${nm(r)}, good`); }
        else { const r = pick(T[t].off, rushW(t, 1, false)); if (r >= 0) B.two[r]++; note('', `2-pt try (go rate ${Math.round(pGo * 100)}%): ${nm(r)} run, good`); }
      } else note('', `2-pt try (go rate ${Math.round(pGo * 100)}%) failed`);
    } else {
      const kp = sig(logit(L.xp) + T[t].kadj);
      if (R() < kp) { addScore(t, 1, defensive); if (T[t].k >= 0) B.kp[T[t].k] += 1; note('', `XP good (${nm(T[t].k)})`); } else note('', `XP missed (${nm(T[t].k)}, make rate ${Math.round(kp * 100)}%)`);
    }
    otCheckAfterScore(t);
    phase = 1; kicker = t;
  }
  function safety(t /* team that conceded */) { note('sf', `SAFETY, ${T[1 - t].ab} +2`); addScore(1 - t, 2, false); dst[1 - t].sf++; otCheckAfterScore(1 - t); phase = 1; kicker = t; freeKick = true; }
  function endOfPeriodCheck() {
    if (clock > 0) return;
    if (half === 1) { half = 2; clock = 1800; to = [3, 3]; phase = 1; kicker = recvFirst; note('', 'End of first half'); }
    else if (half === 2) {
      if (score[0] === score[1]) { half = 3; G._ot = 1; clock = 600; to = [2, 2]; phase = 1; kicker = R() < 0.5 ? 0 : 1; note('', 'End of regulation, tied: 10-minute overtime'); }
      else { over = true; note('', 'Final'); }
    } else over = true;
  }
  let spikeNext = false;
  function runClock(cat, offT) {
    const q = qtrOf(); const hs = clock; const sd = score[offT] - score[1 - offT];
    let mode = 'norm';
    if ((q >= 4 && sd < 0 && hs <= 300) || (q === 2 && hs <= 120) || (q >= 4 && sd <= 0 && hs <= 120)) mode = 'hurry';
    else if (q >= 4 && sd > 0 && hs <= 600) mode = 'milk';
    if (cat === 'oob' && ((q === 2 && hs <= 120) || (q >= 4 && hs <= 300))) cat = 'oobstop';
    if (ev) ev.mode = mode;
    let dt = sampleClock(L, R, cat, mode) * ((cat === 'inb' || cat === 'oob') ? paceM : 1);
    if (mode === 'norm' && (cat === 'inb' || cat === 'oob')) dt += T[offT].pace;
    const d = 1 - offT; let stopped = false;
    if (cat === 'inb' && half >= 2 && sd > 0 && sd <= 16 && hs <= 180 && to[d] > 0 && R() < (hs <= 120 ? 0.75 : 0.45)) { to[d]--; dt = 4 + R() * 4; stopped = true; note('', `Timeout ${T[d].ab} (defense stops clock, ${to[d]} left)`); }
    if (!stopped && cat === 'inb' && mode === 'hurry') {
      const H = L.hurry || {}; const bk = hs <= 30 ? '30' : hs <= 60 ? '60' : hs <= 120 ? '120' : '300';
      if (to[offT] > 0 && R() < ((H.offTO || {})[bk] != null ? H.offTO[bk] : L.offTOlate)) { to[offT]--; dt = 4 + R() * 4; note('', `Timeout ${T[offT].ab} (${to[offT]} left)`); }
      else if (to[offT] === 0 && down <= 3 && H.spike && R() < (H.spike[bk] || 0)) {
        const q2 = H.spikeDt; dt = (q2 ? q2[Math.floor(R() * q2.length)] : 14) + 1; spikeNext = true; note('', `No timeouts left: ${T[offT].ab} hurries up and spikes it`);
      } else if (H.dt && H.dt[bk]) { const q2 = H.dt[bk]; dt = q2[Math.floor(R() * q2.length)] * paceM; }
    }
    let nc = clock - Math.max(0, dt);
    if (half <= 2 && clock > 120 && nc < 120) { nc = 120; note('', 'Two-minute warning'); }
    if (ev) ev.dt = Math.round(clock - Math.max(0, nc)); 
    clock = Math.max(0, nc);
  }
  function kickoff() {
    const k = kicker; const r = 1 - k; S[k * NS + 13] += 0;
    const q = qtrOf(); const def = score[r] - score[k];
    let e;
    if (!freeKick && half >= 2 && q >= 4 && def > 0 && def <= 16 && clock <= 240 && (clock <= 150 || def > 8) && L.onside.length) {
      e = L.onside[Math.floor(R() * L.onside.length)];
      if (e[1]) changePoss(k, e[0]); else changePoss(r, e[0]);
      note('ko', `Onside kick by ${T[k].ab} (trailing by ${def}), ${e[1] ? 'RECOVERED by ' + T[k].ab : 'recovered by ' + T[r].ab} at ${spotTxt(off, yl)}`);
    } else {
      e = L.kickoff[Math.floor(R() * L.kickoff.length)];
      if (e[2]) { note('ko', `Kickoff by ${T[k].ab} returned for a TOUCHDOWN`); note('td', `${T[r].ab} kick return TD`); if (T[r].kr.length) credRet(r, T[r].kr); dst[r].td++; clock = Math.max(0, clock - 8); touchdown(r, false); freeKick = false; endOfPeriodCheck(); return; }
      let ny = e[0]; if (freeKick) ny = Math.max(30, ny - 10);
      if (e[1]) { changePoss(k, ny); dst[k].fr++; note('ko', `${freeKick ? 'Free kick' : 'Kickoff'} by ${T[k].ab}: muffed, ${T[k].ab} recovers at ${spotTxt(k, ny)}`); note('to', 'Turnover on the return'); }
      else { changePoss(r, ny); note('ko', `${freeKick ? 'Free kick' : 'Kickoff'} by ${T[k].ab}: ${ny === 65 ? 'touchback' : 'returned'}, ${T[r].ab} ball at ${spotTxt(r, ny)}`); }
      if (half <= 2 || true) clock = Math.max(0, clock - (e[0] === 65 ? 0 : 5));
    }
    freeKick = false; phase = 0;
    endOfPeriodCheck();
  }
  function turnover(newOff, newYl) { S[off * NS + 11]++; changePoss(newOff, newYl); }
  function scrimmage() {
    if (clock <= 0) { endOfPeriodCheck(); return; }
    const t = off, d = 1 - t; const q = qtrOf(); const hs = clock; const sd = score[t] - score[d];
    if (qb[t] < 0) { // no QB on slate: fall back
    }
    if (!blowSwap[t] && T[t].qb2 >= 0 && blowout()) { blowSwap[t] = true; if (R() < (sd > 0 ? 0.35 : 0.08)) { qb[t] = T[t].qb2; note('', `Blowout: backup QB ${nm(qb[t])} takes over`); } }
    const bl = blowout();
    if (LOG && bl && !G._gt) { G._gt = 1; note('', `Garbage time (${Math.abs(score[0] - score[1])}-pt margin in Q4): backups get more of the work`); }
    // kneel-downs
    if (half >= 2 && sd > 0 && clock <= Math.max(2.5, (4 - down) * 40 - to[d] * 38)) {
      yl = Math.min(99, yl + 1); down++; togo++; S[t * NS + 1]++;
      if (qb[t] >= 0) B.rY[qb[t]] -= 1;
      note('kneel', `${nm(qb[t])} kneels (lead ${sd}, ${T[d].ab} has ${to[d]} TO)`);
      if (to[d] > 0 && sd <= 16 && down < 4) { to[d]--; clock = Math.max(0, clock - 2); note('', `Timeout ${T[d].ab} (${to[d]} left)`); } else runClock('kneel', t);
      if (down > 4) turnover(d, 100 - yl);
      endOfPeriodCheck(); return;
    }
    if (half === 1 && clock <= 22 && yl >= 70 && down <= 3) { note('kneel', `${nm(qb[t])} kneels to end the half`); runClock('kneel', t); down++; yl = Math.min(99, yl + 1); togo++; endOfPeriodCheck(); return; }
    // end-of-half FG
    if (clock <= 6 && yl <= 42 && (half === 1 || (sd >= -3 && sd <= 0))) { if (ev) ev.dec = 'Clock nearly out: kick'; return fieldGoal(t); }
    let playType;
    if (down === 4) {
      const ti = binOf(Math.min(togo, yl), TOGO), yi = ylBin(yl), si = binOf(sd, SD), k = tstate(q, hs);
      const g = L.fourthGrid[((ti * 20 + yi) * 9 + si) * 9 + k];
      let pGo = g[0] / 1000, pPunt = g[1] / 1000, pFg = Math.max(0, 1 - pGo - pPunt);
      if (T[t].go) { const lg = logit(pGo) + T[t].go; const ng = sig(lg); const sc = (1 - ng) / Math.max(1e-6, pPunt + pFg); pGo = ng; pPunt *= sc; pFg *= sc; }
      if (ADJ.fg && yl <= 45) { const x = pFg * ADJ.fg; const r = (1 - Math.min(0.98, x)) / Math.max(1e-6, pGo + pPunt); pGo *= r; pPunt *= r; pFg = Math.min(0.98, x); }
      if (yl + 17 > 64) { pPunt += pFg; pFg = 0; }
      if (half >= 2 && q >= 4 && hs <= 150 && sd < 0) { if (sd >= -3 && yl <= 40) { pFg = 1; pGo = 0; pPunt = 0; } else { pGo = 1; pPunt = 0; pFg = 0; } }
      const u = R();
      if (ev) ev.dec = `4th-down model: go ${Math.round(pGo * 100)}% · punt ${Math.round(pPunt * 100)}% · FG ${Math.round(pFg * 100)}% → ${u < pPunt ? 'PUNT' : u < pPunt + pFg ? 'FG' : 'GO'}`;
      if (u < pPunt) return punt(t); else if (u < pPunt + pFg) return fieldGoal(t);
      S[t * NS + 8]++;
    }
    // pass prob
    const ti = binOf(Math.min(togo, yl), TOGO), yi = ylBin(yl), si = binOf(sd, SD), k = tstate(q, hs);
    let pp = L.passGrid[((((down - 1) * 13 + ti) * 20 + yi) * 9 + si) * 9 + k] / 1000;
    pp = sig(logit(pp) + (T[t].proe + T[1 - t].dproe + WX.proe) / 0.244 + proeN[t]); // offense tendency + opposing defense funnel (how offenses attack this D, current season)
    if (half >= 2 && q >= 4 && hs <= 8 && sd < 0) pp = 1;
    if (ev) ev.pp = pp;
    // penalties that nullify the play
    if (R() < (L.penRateDown[down] || L.penRate)) {
      const e = L.penPool[Math.floor(R() * L.penPool.length)]; S[t * NS + 7]++;
      const side = e[0], fd = e[2]; let yd = Math.abs(e[3]);
      if (side === 0) { yd = Math.min(yd, Math.floor((100 - yl) / 2)); yl += yd; togo += yd; }
      else { yd = Math.min(yd, Math.max(1, Math.floor(yl / 2))); if (yd >= yl) yd = yl - 1; yl -= yd; if (fd || yd >= togo) { down = 1; togo = Math.min(10, yl); if (ev) ev.pfd = 1; } else togo -= yd; }
      if (yl < 1) yl = 1;
      note('pen', `FLAG${e[1] ? ' (pre-snap)' : ''} on ${side === 0 ? T[t].ab + ' offense' : T[d].ab + ' defense'}: ${yd} yds${side === 1 && ev && ev.pfd ? ', first down' : ', replay down'}. No play.`);
      if (!e[1]) runClock('pen', t);
      endOfPeriodCheck(); return;
    }
    S[t * NS + 1]++;
    const s = sEff[t]; const fS = Math.exp(-0.6 * s);
    const rz = yl <= 10; const z = zoneOf(yl);
    const rctx = rz ? 1 : (down >= 3 && togo <= 2) ? 2 : 0;
    const hm = (q === 2 && hs <= 120) || (q >= 4 && sd <= 0 && hs <= 120) || (q >= 4 && sd < 0 && hs <= 300);
    const pdn = (down >= 3 && togo >= 5) || (q === 2 && hs <= 120) || (q >= 4 && sd < 0 && hs <= 300); const tctx = rz ? 1 : pdn ? 3 : 0;
    let gain = 0, cat = 'inb', carrier = -1, isTD = false, fumble = false;
    if (half >= 2 && q >= 4 && hs <= 8 && sd < 0 && (sd < -3 || yl > 42) && yl >= 35 && L.hail) {
      const qbi = qb[t]; S[t * NS + 2]++; if (qbi >= 0) B.pA[qbi]++; const u = R();
      const r = pick(T[t].off, tgtW(t, 3, false));
      if (u < L.hail.td && r >= 0) { B.rec[r]++; B.recY[r] += yl; B.recTD[r]++; B.tg[r]++; if (qbi >= 0) { B.pY[qbi] += yl; B.pTD[qbi]++; B.pC[qbi]++; } note('pass', `Hail Mary: ${nm(qbi)} to ${nm(r)}, TOUCHDOWN`); note('td', ''); clock = 0; touchdown(t, false); endOfPeriodCheck(); return; }
      if (u < L.hail.td + L.hail.int) { if (qbi >= 0) B.pInt[qbi]++; dst[d].int++; S[t * NS + 15]++; note('pass', `Hail Mary by ${nm(qbi)} INTERCEPTED`); note('to', ''); clock = 0; endOfPeriodCheck(); return; }
      if (u < L.hail.td + L.hail.int + 0.25 && r >= 0) { const g2 = Math.min(yl - 1, 12 + Math.floor(R() * 20)); B.rec[r]++; B.recY[r] += g2; B.tg[r]++; if (qbi >= 0) { B.pY[qbi] += g2; B.pC[qbi]++; } note('pass', `Final heave: ${nm(qbi)} to ${nm(r)} for ${g2}, tackled short as time expires`); }
      else note('pass', `Final heave by ${nm(qbi)} falls incomplete`);
      clock = 0; endOfPeriodCheck(); return;
    }
    if (R() < pp) {
      const qbi = qb[t]; const Q = qbi >= 0 ? P[qbi] : { sk: L.sackBase, sc: L.scrBase, it: L.intBase };
      const tg = binOf(togo, [2, 5, 9, 99]);
      const pSack = Q.sk * (L.sackDT[down + '_' + tg] || 1) * T[d].dsk * fS * (ADJ.sack || 1);
      if (R() < pSack) {
        S[t * NS + 3]++; dst[d].sk++;
        gain = L.sackYds[Math.floor(R() * L.sackYds.length)];
        note('sack', `${nm(qbi)} SACKED for ${gain} (sack rate this snap ${(pSack * 100).toFixed(1)}%)`);
        if (R() < L.sackFumLost * fS) {
          note('to', `FUMBLE on the sack, recovered by ${T[d].ab}`);
          dst[d].fr++; S[t * NS + 11]++; if (qbi >= 0) B.fl[qbi]++;
          runClock('inc', t);
          if (R() < L.sackFumTD / L.sackFumLost) { note('td', `${T[d].ab} returns it for a TOUCHDOWN`); dst[d].td++; changePoss(d, 50); touchdown(d, true); endOfPeriodCheck(); return; }
          changePoss(d, Math.max(1, Math.min(99, 100 - (yl - gain)))); endOfPeriodCheck(); return;
        }
        cat = 'inb';
      } else if (R() < Q.sc) {
        S[t * NS + 14]++; S[t * NS + 4]++;
        const [arr, idx] = poolDraw('S_' + z, null, 0, s + WX.sp, 2);
        gain = arr[idx]; isTD = z === 4 ? gain >= yl : !!arr[idx + 1]; if (!isTD && gain >= yl) gain = yl - 1; if (isTD) gain = yl;
        carrier = qbi; if (qbi >= 0) B.rY[qbi] += gain; S[t * NS + 6] += gain;
        cat = R() < (hm && L.oobHurry ? L.oobHurry.scr : L.oobScr) ? 'oob' : 'inb'; if (R() < L.rushFL * fS * WX.fum) fumble = true;
        if (isTD && qbi >= 0) B.rTD[qbi]++;
        if (qbi >= 0) B.rA[qbi]++;
        note('scr', `${nm(qbi)} scrambles for ${gain}${isTD ? ', TOUCHDOWN' : ''}${cat === 'oob' ? ', out of bounds' : ''}`); if (isTD) note('td', '');
      } else {
        S[t * NS + 2]++;
        if (qbi >= 0) B.pA[qbi]++;
        if (R() < L.throwaway) { cat = 'inc'; gain = 0; note('pass', `${nm(qbi)} throws it away, incomplete`); }
        else if (R() < Q.it * T[d].dint * fS * (ADJ.int || 1)) {
          S[t * NS + 15]++; S[t * NS + 11]++; if (qbi >= 0) B.pInt[qbi]++; dst[d].int++;
          const e = L.intPool[Math.floor(R() * L.intPool.length)];
          note('pass', `${nm(qbi)} pass INTERCEPTED by ${T[d].ab}`); note('to', '');
          runClock('inc', t);
          if (R() < L.intTD) { note('td', `Pick-six, ${T[d].ab} TOUCHDOWN`); dst[d].td++; changePoss(d, 50); touchdown(d, true); endOfPeriodCheck(); return; }
          let spot = yl - e[0]; let ny = 100 - spot - e[1];
          if (spot <= 0 && ny >= 100) ny = 80;
          changePoss(d, Math.max(1, Math.min(99, ny))); if (ev) ev.x.push(`${T[d].ab} ball at ${spotTxt(d, yl)}`); endOfPeriodCheck(); return;
        } else {
          const r = pick(T[t].off, tgtW(t, tctx, bl));
          if (r < 0) { cat = 'inc'; }
          else {
            const p = P[r]; B.tg[r]++;
            const [arr, idx] = z === 4 ? poolDraw('T_' + p.tpos + '_4', p.tp, p.tpown, s + WX.sp, 3) : poolDraw('T_' + p.tpos + '_' + z, null, 0, s + WX.sp, 3);
            const c = arr[idx]; gain = c ? arr[idx + 1] : 0;
            if (c) {
              isTD = z === 4 ? gain >= yl : !!arr[idx + 2]; if (isTD) gain = yl; else if (gain >= yl) gain = yl - 1;
              B.rec[r]++; B.recY[r] += gain; if (qbi >= 0) B.pY[qbi] += gain; S[t * NS + 5] += gain;
              if (isTD) { B.recTD[r]++; if (qbi >= 0) B.pTD[qbi]++; }
              carrier = r; cat = R() < (hm && L.oobHurry ? L.oobHurry.comp : L.oobComp) ? 'oob' : 'inb';
              if (!isTD && R() < L.recFL * fS * WX.fum) fumble = true;
              if (qbi >= 0) B.pC[qbi]++;
              note('pass', `${nm(qbi)} pass to ${nm(r)} for ${gain}${isTD ? ', TOUCHDOWN' : ''}${cat === 'oob' ? ', out of bounds' : ''}`); if (isTD) note('td', '');
            } else { cat = 'inc'; note('pass', `${nm(qbi)} pass to ${nm(r)} incomplete`); }
          }
        }
      }
    } else {
      S[t * NS + 4]++;
      const r = pick(T[t].off, rushW(t, rctx, bl));
      const p = r >= 0 ? P[r] : null; const rp = p ? p.rpos : 'RB';
      const sr2 = s + T[1 - t].drun + WX.sr; // opposing run defense (current season, opponent-adjusted)
      const [arr, idx] = (z === 4 && p) ? poolDraw('R_' + rp + '_4', p.rp, p.rpown, sr2, 2) : poolDraw('R_' + rp + '_' + z, null, 0, sr2, 2);
      gain = arr[idx]; if (z === 4) isTD = gain >= yl; else isTD = !!arr[idx + 1];
      if (isTD) gain = yl; else if (gain >= yl) gain = yl - 1;
      if (r >= 0) { B.rY[r] += gain; if (isTD) B.rTD[r]++; B.rA[r]++; }
      S[t * NS + 6] += gain; carrier = r;
      cat = R() < (hm && L.oobHurry ? L.oobHurry.run : L.oobRun) ? 'oob' : 'inb';
      if (!isTD && R() < L.rushFL * fS * WX.fum) fumble = true;
      note('run', `${nm(r)} run for ${gain}${isTD ? ', TOUCHDOWN' : ''}${cat === 'oob' ? ', out of bounds' : ''}`); if (isTD) note('td', '');
    }
    // injuries (offense)
    for (const i of T[t].off) {
      if (!B.inj[i] && P[i].inj && R() < P[i].inj * ((i === carrier) ? 2.5 : 0.85)) {
        if (i === qb[t] && T[t].qb2 >= 0 && i !== T[t].qb2) { B.inj[i] = 1; qb[t] = T[t].qb2; sEff[t] -= 0.15; note('inj', `INJURY: ${nm(i)} out for the game, ${nm(qb[t])} takes over at QB`); }
        else if (P[i].pos !== 'QB') {
          let nxt = -1, bw = -1; if (LOG) for (const k of T[t].off) { if (k === i || B.inj[k] || P[k].pos !== P[i].pos) continue; const w = P[i].pos === 'RB' ? baseRush(t, k, 0) : P[k].ts * B.tsx[k]; if (w > bw) { bw = w; nxt = k; } }
          B.inj[i] = 1; if (lead[t] === i) pickLead(t);
          note('inj', `INJURY: ${nm(i)} out for the game.${nxt >= 0 ? ' Next up at ' + P[i].pos + ': ' + nm(nxt) + '.' : ''} His share moves to active teammates`); }
      }
    }
    if (isTD) { runClock('inb', t); touchdown(t, false); endOfPeriodCheck(); return; }
    if (fumble) {
      if (carrier >= 0) B.fl[carrier]++; dst[d].fr++; S[t * NS + 11]++;
      note('to', `FUMBLE by ${nm(carrier)}, recovered by ${T[d].ab}`);
      runClock('inc', t);
      if (R() < L.fumRetTD) { note('td', `${T[d].ab} returns the fumble for a TOUCHDOWN`); dst[d].td++; changePoss(d, 50); touchdown(d, true); endOfPeriodCheck(); return; }
      changePoss(d, Math.max(1, Math.min(99, 100 - (yl - gain)))); endOfPeriodCheck(); return;
    }
    const ny = yl - gain;
    if (ny >= 100) { runClock('inb', t); safety(t); endOfPeriodCheck(); return; }
    yl = ny;
    // live-ball penalties (added on)
    if (R() < L.livePenRate) {
      const e = L.livePenPool[Math.floor(R() * L.livePenPool.length)]; let yd = Math.abs(e[2]);
      if (e[0] === 0) { yd = Math.min(yd, Math.floor((100 - yl) / 2)); yl += yd; togo += yd; }
      else { yd = Math.min(yd, Math.max(1, Math.floor(yl / 2))); if (yd >= yl) yd = yl - 1; yl -= yd; gain += yd; if (e[1]) { gain = Math.max(gain, togo); } }
      note('', `Flag after the play on ${e[0] === 0 ? T[t].ab : T[d].ab}: ${e[0] === 0 ? '-' : '+'}${yd} yds`);
    }
    if (gain >= togo) { down = 1; togo = Math.min(10, yl); }
    else { down++; togo -= gain; if (togo < 1) togo = 1; }
    runClock(down > 4 ? 'inc' : cat, t);
    if (spikeNext) { spikeNext = false; if (down <= 3 && clock > 0) { down++; S[t * NS + 2]++; if (qb[t] >= 0) B.pA[qb[t]]++; } }
    if (down > 4) { note('to', `Turnover on downs, ${T[d].ab} ball`); turnover(d, 100 - yl); }
    endOfPeriodCheck();
  }
  function punt(t) {
    const d = 1 - t; S[t * NS + 10]++;
    const pool = L._punt[Math.min(19, Math.floor(yl / 5))]; const e = pool[Math.floor(R() * pool.length)];
    clock = Math.max(0, clock - 7);
    if (e[3]) { dst[d].blk++; note('punt', `Punt BLOCKED by ${T[d].ab}`); }
    if (e[2]) { note('td', `${T[d].ab} punt return TOUCHDOWN`); if (T[d].pr.length && !e[3]) credRet(d, T[d].pr); dst[d].td++; changePoss(d, 50); touchdown(d, false); endOfPeriodCheck(); return; }
    if (e[1]) { if (!e[3]) dst[t].fr++; changePoss(t, e[0] || yl); note('punt', `Punt by ${T[t].ab}: muffed, ${T[t].ab} keeps it at ${spotTxt(t, yl)}`); note('to', ''); } else { const yl0 = yl, los = spotTxt(t, yl); changePoss(d, e[0] || 80); const net = yl0 - (100 - yl); note('punt', `${e[3] ? '' : 'Punt by ' + T[t].ab + ' from the ' + los + ', net ' + net + ' yards' + (net < 10 ? ' (long return)' : '') + ': '}${T[d].ab} ball at ${spotTxt(d, yl)}`); }
    endOfPeriodCheck();
  }
  function fieldGoal(t) {
    const d = 1 - t; S[t * NS + 9]++; const dist = yl + 17;
    clock = Math.max(0, clock - 4);
    if (R() < L.fg.blk) { note('fg', `${dist}-yd FG attempt BLOCKED`); dst[d].blk++; changePoss(d, Math.max(1, 100 - (yl + 7))); endOfPeriodCheck(); return; }
    const pm = sig(L.fg.b0 + L.fg.b1 * dist + L.fg.b2 * dist * dist + T[t].kadj + WX.fg);
    if (R() < pm) {
      note('fg', `${nm(T[t].k)} ${dist}-yd FG GOOD (make prob ${Math.round(pm * 100)}%)`);
      addScore(t, 3, false); if (T[t].k >= 0) B.kp[T[t].k] += dist < 40 ? 3 : dist < 50 ? 4 : 5;
      otCheckAfterScore(t); phase = 1; kicker = t; endOfPeriodCheck(); return;
    }
    note('fgx', `${nm(T[t].k)} ${dist}-yd FG MISSED (make prob ${Math.round(pm * 100)}%)`);
    const spot = yl + 7; changePoss(d, spot <= 20 ? 80 : 100 - spot); endOfPeriodCheck();
  }
  // ---------------- optional mid-game start (live state) ----------------
  const Z = G.start;
  if (Z) {
    half = Z.half; clock = Z.clock; to = Z.to.slice(); score[0] = Z.score[0]; score[1] = Z.score[1]; S[0] += score[0]; S[NS] += score[1];
    if (Z.recvFirst != null) recvFirst = Z.recvFirst; if (half === 3) { G._ot = 1; otPoss[0] = otPoss[1] = 1; }
    if (Z.phase === 1) { phase = 1; kicker = Z.kicker; freeKick = !!Z.freeKick; } else { phase = 0; off = Z.off; yl = Z.yl; down = Z.down; togo = Z.togo; }
    if (Z.buf) for (const k in Z.buf) { const a = Z.buf[k], b = B[k]; if (b && a) for (let i = 0; i < n; i++) b[i] += a[i] || 0; }
    if (Z.dst) for (let t = 0; t < 2; t++) if (Z.dst[t]) for (const k in Z.dst[t]) dst[t][k] += Z.dst[t][k] || 0;
    if (Z.out) for (const i of Z.out) { B.inj[i] = 1; for (let t = 0; t < 2; t++) if (qb[t] === i && T[t].qb2 >= 0 && T[t].qb2 !== i) qb[t] = T[t].qb2; }
    if (phase === 0) pickLead(off);
    if (Z.over) over = true; else if (clock <= 0) endOfPeriodCheck();
  }
  // ---------------- main loop ----------------
  let guard = 0;
  while (!over && guard++ < 600) {
    if (LOG) ev = { h: half, q: qtrOf(), c: clock, off: phase === 1 ? kicker : off, ko: phase === 1, down: down, togo: togo, yl: yl, s0: score[0], s1: score[1], drive: driveNo, t: '', x: [], flags: [] };
    if (phase === 1) kickoff(); else scrimmage();
    if (LOG) { ev.a0 = score[0]; ev.a1 = score[1]; ev.x = ev.x.filter((z) => z); if (ev.x.length) LOG.push(ev); ev = null; if (leadNote) { LOG.push(leadNote); leadNote = null; } }
  }
  // ---------------- DK scoring ----------------
  for (let i = 0; i < n; i++) {
    const p = P[i]; let v = 0;
    if (p.pos === 'DST' || p.pos === 'K') { out[i] = 0; continue; }
    v += B.pY[i] * 0.04 + B.pTD[i] * 4 + (B.pY[i] >= 300 ? 3 : 0) - B.pInt[i];
    v += B.rY[i] * 0.1 + B.rTD[i] * 6 + (B.rY[i] >= 100 ? 3 : 0);
    v += B.rec[i] + B.recY[i] * 0.1 + B.recTD[i] * 6 + (B.recY[i] >= 100 ? 3 : 0);
    v += -B.fl[i] + 2 * B.two[i] + 6 * B.ret[i];
    out[i] = v;
  }
  for (let t = 0; t < 2; t++) {
    if (T[t].k >= 0) out[T[t].k] = B.kp[T[t].k];
    if (T[t].dst >= 0) {
      const D = dst[t]; const pa = score[1 - t] - D.paX;
      const tier = pa === 0 ? 10 : pa <= 6 ? 7 : pa <= 13 ? 4 : pa <= 20 ? 1 : pa <= 27 ? 0 : pa <= 34 ? -1 : -4;
      out[T[t].dst] = D.sk + 2 * D.int + 2 * D.fr + 6 * D.td + 2 * D.sf + 2 * D.blk + tier;
    }
  }
  if (Z && Z.add) for (let i = 0; i < n; i++) out[i] += Z.add[i] || 0;
  return S;
}

/* ---------------- optimizer (Showdown: 1 CPT 1.5x + 5 FLEX, cap, both teams) ---------------- */
function makeOptimizer(G, opts) {
  // eligible: indices of players allowed in lineups; salC/salF arrays; team 0/1
  const P = G.P; const el = opts.eligible; const cap = opts.cap || 50000;
  const salF = Float64Array.from(P.map((p) => p.salF || 0)), salC = Float64Array.from(P.map((p) => p.salC || 0));
  const team = Int8Array.from(P.map((p) => p.team === G.T[0].ab ? 0 : 1));
  const tb = opts.tiebreak || new Float64Array(P.length);
  const minSal = opts.minSal || 0;
  const lockCpt = opts.lockCpt; // optional
  const cptOk = opts.cptOk || el;
  return function best(pts) {
    const ord = el.slice().sort((a, b) => (pts[b] - pts[a]) || (tb[b] - tb[a]));
    const m = ord.length; const v = new Float64Array(m), s = new Float64Array(m), tm = new Int8Array(m);
    for (let j = 0; j < m; j++) { v[j] = pts[ord[j]] + tb[ord[j]] * 1e-6; s[j] = salF[ord[j]]; tm[j] = team[ord[j]]; }
    // minimal salary suffix for feasibility: min sum of k cheapest among remaining is costly; use global cheapest
    const cheap = Array.from(s).sort((a, b) => a - b);
    let bestV = -1e9, bestL = null;
    const cur = new Int32Array(5);
    const cptList = cptOk.slice().sort((a, b) => (pts[b] - pts[a]) || (tb[b] - tb[a]));
    for (const c of cptList) {
      const cv = 1.5 * (pts[c] + tb[c] * 1e-6); const cs = salC[c];
      // bound: cv + top5 flex
      let ub = cv, cnt = 0; for (let j = 0; j < m && cnt < 5; j++) if (ord[j] !== c) { ub += v[j]; cnt++; }
      if (ub <= bestV) continue;
      const rem = cap - cs; const ct = team[c];
      (function dfs(start, k, val, sal, t0, t1) {
        if (k === 5) {
          if (!(t0 && t1)) return; if (sal + cs < minSal) return;
          if (val > bestV) { bestV = val; bestL = [c, ...Array.from(cur).map((j) => ord[j])]; } return;
        }
        // remaining slots need at least cheapest salaries
        let lb = 0; for (let q = 0; q < 5 - k; q++) lb += cheap[q]; if (sal + lb > rem) return;
        let ubb = val, cnt2 = 0; for (let j = start; j < m && cnt2 < 5 - k; j++) if (ord[j] !== c) { ubb += v[j]; cnt2++; }
        if (cnt2 < 5 - k || ubb <= bestV) return;
        for (let j = start; j < m; j++) {
          if (ord[j] === c) continue;
          if (sal + s[j] > rem) continue;
          // bound with this choice
          let ub2 = val + v[j], c3 = 0; for (let q = j + 1; q < m && c3 < 4 - k; q++) if (ord[q] !== c) { ub2 += v[q]; c3++; }
          if (c3 < 4 - k) break; if (ub2 <= bestV) break;
          cur[k] = j;
          dfs(j + 1, k + 1, val + v[j], sal + s[j], t0 || tm[j] === 0, t1 || tm[j] === 1);
        }
      })(0, 0, cv, 0, ct === 0, ct === 1);
    }
    return bestL ? { L: bestL, v: bestV } : null;
  };
}
function lineupKey(L) { return L[0] + '|' + L.slice(1).sort((a, b) => a - b).join(','); }
// k-best lineups by a fixed projection vector (for "highest projected" lists)
function topK(G, opts, pts, K) {
  const P = G.P; const el = opts.eligible.slice().sort((a, b) => pts[b] - pts[a]); const cap = opts.cap || 50000;
  const salF = P.map((p) => p.salF), salC = P.map((p) => p.salC), team = P.map((p) => p.team === G.T[0].ab ? 0 : 1);
  const heap = []; let floor = -1e9;
  const push = (v, L) => { heap.push({ v: v, L: L }); heap.sort((a, b) => b.v - a.v); if (heap.length > K) heap.pop(); if (heap.length === K) floor = heap[K - 1].v; };
  const cptOk = (opts.cptOk || opts.eligible).slice().sort((a, b) => pts[b] - pts[a]);
  for (const c of cptOk) {
    const cv = 1.5 * pts[c]; const rem = cap - salC[c];
    const cur = [];
    (function dfs(start, k, val, sal, t0, t1) {
      if (k === 5) { if (t0 && t1 && val > floor) push(val, [c].concat(cur)); return; }
      let ub = val, cnt = 0; for (let j = start; j < el.length && cnt < 5 - k; j++) if (el[j] !== c) { ub += pts[el[j]]; cnt++; }
      if (cnt < 5 - k || ub <= floor) return;
      for (let j = start; j < el.length; j++) {
        const pj = el[j]; if (pj === c || sal + salF[pj] > rem) continue;
        let ub2 = val + pts[pj], c3 = 0; for (let q = j + 1; q < el.length && c3 < 4 - k; q++) if (el[q] !== c) { ub2 += pts[el[q]]; c3++; }
        if (c3 < 4 - k || ub2 <= floor) break;
        cur.push(pj); dfs(j + 1, k + 1, val + pts[pj], sal + salF[pj], t0 || team[pj] === 0, t1 || team[pj] === 1); cur.pop();
      }
    })(0, 0, cv, 0, team[c] === 0, team[c] === 1);
  }
  return heap;
}
function calibrate(G, implied, opts) {
  opts = opts || {}; const N = opts.n || 1500; const R = makeRng(opts.seed || 12345);
  const out = new Float32Array(G.n); const S = new Float64Array(2 * NS);
  const run = (s) => { let a = 0, b = 0; for (let i = 0; i < N; i++) { simGame(G, R, s, out, S); a += S[0]; b += S[NS]; } return [a / N, b / N]; };
  let s0 = [0, 0], m0 = run(s0); let s1 = [0.3, 0.3], m1 = run(s1); const hist = [[s0, m0], [s1, m1]];
  for (let it = 0; it < (opts.iters || 4); it++) {
    const ns = [0, 1].map((t) => { let sl = (m1[t] - m0[t]) / ((s1[t] - s0[t]) || 1e-6); if (!(sl > 2)) sl = 8; let v = s1[t] + (implied[t] - m1[t]) / sl; return Math.max(-2.5, Math.min(3, v)); });
    s0 = s1; m0 = m1; s1 = ns; m1 = run(s1); hist.push([s1, m1]);
    if (Math.abs(m1[0] - implied[0]) < 0.25 && Math.abs(m1[1] - implied[1]) < 0.25) break;
  }
  return { s: s1, m: m1, hist: hist };
}
// per-player box-score stats for prop comparisons: [passYds, passTD, passAtt, comp, rushAtt, rushYds, rec, recYds, rush+rec TD, rush+rec yds]
const PSTAT = ['py', 'ptd', 'pa', 'pc', 'ra', 'ry', 'rec', 'recy', 'td', 'rry'];
function statSim(G0, s, N, seed, variants) {
  const n = G0.n, K = PSTAT.length, data = new Float32Array(N * n * K), R = makeRng(seed || 4242), out = new Float32Array(n), S = new Float64Array(2 * NS);
  let tot = 0; const cum = variants ? variants.map((v) => (tot += v.p)) : null;
  for (let i = 0; i < N; i++) {
    const u = variants ? R() * tot : 0; const G = variants ? variants[Math.max(0, cum.findIndex((x) => u <= x))].G : G0; const B = G.buf;
    simGame(G, R, s, out, S); const o = i * n * K;
    for (let j = 0; j < n; j++) { const b = o + j * K; data[b] = B.pY[j]; data[b + 1] = B.pTD[j]; data[b + 2] = B.pA[j]; data[b + 3] = B.pC[j]; data[b + 4] = B.rA[j]; data[b + 5] = B.rY[j]; data[b + 6] = B.rec[j]; data[b + 7] = B.recY[j]; data[b + 8] = B.rTD[j] + B.recTD[j]; data[b + 9] = B.rY[j] + B.recY[j]; }
  }
  return { n: N, np: n, K, data };
}
const API = { statSim, PSTAT, calibrate, makeRng, prepLeague, prepGame, simGame, makeOptimizer, topK, lineupKey, NS };
if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.ENGINE = API;
})(typeof self !== 'undefined' ? self : this);
