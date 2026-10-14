/* ---------------- questionable / limited players ----------------
   Each Q or D player gets two numbers: chance he plays, and his workload if he plays (share of his normal carries and
   targets). Sims are split by scenario: in the share of sims where he sits, his work moves to teammates exactly as for an
   OUT player; when he plays limited, the part of his work he does not take moves the same way. Defaults: Q plays 75% at
   full load, D plays 25% at 80%. Your edits are saved per slate. Up to 4 such players per game are mixed exactly. */
const Q_DEF = { Q: [0.75, 1], D: [0.25, 0.8] };
const qKey = () => 'q_' + roleKey();
function qOf(p) { // [plays prob, load] or null when he is simply in or out
  if (p.forceIn) return (p.status || p.qPlay != null || p.qLoad != null) ? [p.qPlay ?? 1, p.qLoad ?? 1] : null; // turned on by you despite a status: still adjustable
  if (p.forceOut) return null;
  const st = (p.status || '').toUpperCase(); const d = Q_DEF[st];
  if (p.qPlay != null || p.qLoad != null || d) return [p.qPlay != null ? p.qPlay : (d ? d[0] : 1), p.qLoad != null ? p.qLoad : (d ? d[1] : 1)];
  return null;
}
function saveQ() { const o = {}; ST.players.forEach((p) => { if (p.qPlay != null || p.qLoad != null) o[p.name + '|' + p.team] = [p.qPlay ?? null, p.qLoad ?? null]; }); store.set(qKey(), o); }
function loadQ() { const o = store.get(qKey(), {}); ST.players.forEach((p) => { const v = o[p.name + '|' + p.team]; p.qPlay = v ? v[0] : null; p.qLoad = v ? v[1] : null;
  if (!p.forceOut && Q_DEF[(p.status || '').toUpperCase()] && ['QB', 'RB', 'WR', 'TE'].includes(p.pos)) p.active = true; }); } // a D player is in the pool: the scenarios decide
// workload applied to the "plays" picture (p.lim read by adjustVacated)
function qApplyLoad() { ST.players.forEach((p) => { const q = qOf(p); p.lim = q && p.active ? q[1] : 1; }); }
// scenario variants for a set of players: [{p, set:[[player, plays]]}], at most 4 uncertain players (most work first)
function qVariants(players) {
  const U = players.filter((p) => { const q = qOf(p); return q && p.active && q[0] > 0.001 && q[0] < 0.999 && ['QB', 'RB', 'WR', 'TE'].includes(p.pos); })
    .sort((a, b) => ((+b.rs || 0) + (+b.ts || 0)) - ((+a.rs || 0) + (+a.ts || 0))).slice(0, 4);
  const out = [];
  for (let m = 0; m < (1 << U.length); m++) { let pr = 1; const set = U.map((p, k) => { const on = !!(m & (1 << k)); const q = qOf(p)[0]; pr *= on ? q : 1 - q; return [p, on]; }); if (pr > 1e-4) out.push({ p: pr, set }); }
  return out.length ? out : [{ p: 1, set: [] }];
}
// build one slate per scenario with fn() while the scenario's players are switched on/off, then restore
function qSlates(players, fn) {
  qApplyLoad(); const V = qVariants(players);
  if (V.length === 1 && !V[0].set.length) return [{ p: 1, slate: fn() }];
  return V.map((v) => { const keep = v.set.map(([p]) => [p, p.active, p.lim]); v.set.forEach(([p, on]) => { p.active = on; if (!on) p.lim = 1; });
    let slate; try { slate = fn(); } finally { keep.forEach(([p, a, l]) => { p.active = a; p.lim = l; }); } return { p: v.p, slate }; });
}
function qCell(p, j) {
  const q = qOf(p); if (!q || !['QB', 'RB', 'WR', 'TE'].includes(p.pos) || p.forceOut) return '';
  const loads = [[1, 'full load'], [0.85, '85% load'], [0.7, 'limited 70%'], [0.5, 'split 50%'], [0.35, 'part-time 35%']];
  return `<span class="qctl small" title="Chance he plays, and his share of his normal work if he does. The sims split by scenario; when he sits or is limited, his work moves to teammates."><label>plays <input class="qin" type="number" min="0" max="100" step="5" data-qp="${j}" value="${Math.round(q[0] * 100)}">%</label>
    <select data-ql="${j}" aria-label="Workload if he plays">${loads.map(([v, l]) => `<option value="${v}" ${Math.abs(v - q[1]) < 0.01 ? 'selected' : ''}>${l}</option>`).join('')}${loads.some(([v]) => Math.abs(v - q[1]) < 0.01) ? '' : `<option selected value="${q[1]}">${Math.round(q[1] * 100)}% load</option>`}</select></span>`;
}
function bindQ(el, rerender) {
  $$('input[data-qp]', el).forEach((i) => i.onchange = () => { const p = ST.players[+i.dataset.qp]; p.qPlay = Math.max(0, Math.min(1, (+i.value || 0) / 100)); saveQ(); markStale(); rerender(); });
  $$('select[data-ql]', el).forEach((s) => s.onchange = () => { const p = ST.players[+s.dataset.ql]; p.qLoad = +s.value; saveQ(); markStale(); rerender(); });
}

/* per-player exposure limits (override the global caps either way; min forces him into at least that share) */
const capKey=()=>'cap_'+roleKey();
function loadCaps(){ const o=store.get(capKey(),{}); ST.caps=new Map(); ST.players.forEach((p,j)=>{ const v=o[p.name+'|'+p.team]; if(v) ST.caps.set(j,{max:v[0],min:v[1]}); }); }
function saveCaps(){ const o={}; (ST.caps||new Map()).forEach((v,j)=>{ const p=ST.players[j]; if(v.max!=null||v.min!=null) o[p.name+'|'+p.team]=[v.max,v.min]; }); store.set(capKey(),o); }
function setCap(j,k,v){ if(!ST.caps) ST.caps=new Map(); const c=ST.caps.get(j)||{max:null,min:null}; c[k]=v; if(c.max==null&&c.min==null) ST.caps.delete(j); else ST.caps.set(j,c); saveCaps(); }
function capsCard(noMin){ const P=ST.players; const caps=ST.caps||new Map(); const pool=P.map((p,j)=>j).filter(j=>P[j].active&&P[j].salF>0&&!ST.portExcl.has(j)).sort((a,b)=>(ST.res&&ST.res.stats&&ST.res.stats[b]?((ST.res.stats[b].opt??(ST.res.stats[b].cpt+ST.res.stats[b].flex))-(ST.res.stats[a].opt??(ST.res.stats[a].cpt+ST.res.stats[a].flex))):0));
  const row=(j)=>{ const c=caps.get(j)||{}; return `<span class="chip" style="gap:4px;display:inline-flex;align-items:center">${esc(P[j].name)} <span class="pos">${P[j].pos}</span> max <input class="capin" data-capj="${j}" data-capk="max" type="number" min="0" max="100" value="${c.max!=null?Math.round(c.max*100):''}" placeholder="-" style="width:46px">% ${noMin?'':`min <input class="capin" data-capj="${j}" data-capk="min" type="number" min="0" max="100" value="${c.min!=null?Math.round(c.min*100):''}" placeholder="-" style="width:46px">%`} <button class="small" data-capx="${j}" aria-label="Remove">×</button></span>`; };
  return `<div class="pgrp"><span class="lbl">Player limits (override the caps above)</span><div class="row small"><input id="capAdd" list="capList" placeholder="Add a player…" style="width:200px" autocomplete="off"><datalist id="capList">${pool.map(j=>`<option value="${esc(P[j].name)} · ${P[j].pos} ${P[j].team}"></option>`).join('')}</datalist>
    <span class="muted">or edit Max / Min right in the Exposure table after a build</span></div><div class="row small" style="margin-top:6px;gap:6px;flex-wrap:wrap">${Array.from(caps.keys()).map(row).join('')}</div></div>`; }
function bindCaps(el,rerender){ const P=ST.players; const a=$('#capAdd',el); if(a) a.onchange=()=>{ const v=a.value; const j=P.findIndex(p=>v.startsWith(p.name+' · ')&&v.endsWith(' '+p.team)); if(j>=0){ if(!ST.caps) ST.caps=new Map(); if(!ST.caps.has(j)) ST.caps.set(j,{max:null,min:null}); rerender(); } };
  $$('input[data-capj]',el).forEach(i=>i.onchange=()=>{ const v=i.value===''?null:Math.max(0,Math.min(1,(+i.value||0)/100)); setCap(+i.dataset.capj,i.dataset.capk,v); if(!ST.caps.has(+i.dataset.capj)&&i.closest('.chip')) rerender(); });
  $$('button[data-capx]',el).forEach(b=>b.onclick=()=>{ ST.caps.delete(+b.dataset.capx); saveCaps(); rerender(); }); }

/* ---------------- uploads: CSV or the .zip DraftKings hands you (first CSV inside is used) ---------------- */
async function readUpload(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  if (!(buf[0] === 0x50 && buf[1] === 0x4b)) return new TextDecoder().decode(buf);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength); let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Could not read the zip file');
  const n = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
  for (let k = 0; k < n; k++) { if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nl)); p += 46 + nl + xl + cl;
    if (!/\.csv$/i.test(name) || /__MACOSX/.test(name)) continue;
    const start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true); const data = buf.subarray(start, start + csize);
    if (method === 0) return new TextDecoder().decode(data);
    if (method === 8) { if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot unzip files; unzip it and upload the CSV');
      return await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text(); }
    throw new Error('Unsupported zip compression'); }
  throw new Error('No CSV found inside the zip');
}
const readUploadSafe = (f) => readUpload(f).catch((e) => { toast(e.message || String(e)); throw e; });
/* payout table pasted from the DK contest details: "1st $1,000.00", "11th - 15th $20.00", place and prize on one line or two */
function parsePayouts(text) {
  const out = []; const t = (text || '').replace(/ /g, ' ');
  const re = /(?:^|\s)(\d{1,7})\s*(?:st|nd|rd|th)?(?:\s*[-–—]\s*(\d{1,7})\s*(?:st|nd|rd|th)?)?\s*:?\s+\$\s*([\d,]+(?:\.\d+)?)/gi; let m;
  while ((m = re.exec(t))) { const lo = +m[1], hi = +(m[2] || m[1]), v = parseFloat(m[3].replace(/,/g, '')); if (hi >= lo && v >= 0) out.push([lo, hi, v]); }
  return out.sort((x, y) => x[0] - y[0]);
}
function payTotal(t) { return t.reduce((s, [lo, hi, v]) => s + (hi - lo + 1) * v, 0); }
// prize lookup by rank range (ties share the prizes across the tied places)
function payTable(tbl) {
  const Pd = tbl[tbl.length - 1][1]; const pref = new Float64Array(Pd + 1); let s = 0, ti = 0;
  for (let r = 1; r <= Pd; r++) { while (ti < tbl.length && tbl[ti][1] < r) ti++; s += (ti < tbl.length && tbl[ti][0] <= r) ? tbl[ti][2] : 0; pref[r] = s; }
  return { Pd, avg: (lo, hi) => { lo = Math.max(1, Math.round(lo)); hi = Math.max(lo, Math.round(hi)); if (lo > Pd) return 0; return (pref[Math.min(hi, Pd)] - pref[lo - 1]) / (hi - lo + 1); } };
}
