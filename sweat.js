/* ---------------- Showdown Sweat: the live sweat as its own page ----------------
   Type your DraftKings username, paste contest links and/or drop each contest's standings (.zip). Everything else is
   automatic: contest name, fee and full payout table (DraftKings' public contest API, read from the visitor's browser), the players
   (DraftKings' public draft group), the line (ESPN), the pregame sim, then live ESPN stats every 60 seconds with the
   rest of the game simmed and every contest re-ranked after each pull. Showdown lineups lock at kickoff, so one
   standings download per contest covers the whole game. */
const SWEAT = true;
const SW = { info: new Map(), files: new Map(), dg: null, msg: '', busy: false };
// contest numbers from links or bare numbers; other numbers in a link (the ?uc= entry key) are ignored
function swIds(text) { const out = new Set();
  for (const tok of String(text || '').split(/[\s,]+/)) { if (!tok) continue;
    const m = /(?:contests?\/(?:gamecenter\/|draft\/)?|contestId=|standings-)(\d{6,12})/i.exec(tok); if (m) { out.add(m[1]); continue; }
    if (/^\d{6,12}$/.test(tok)) out.add(tok); }
  return Array.from(out); }
// DraftKings' contest API blocks other sites from reading it (and blocks Google's servers), but it answers JSONP, which a page
// can load as a script straight from the visitor's own browser: no relay, no server
function swJsonp(url, ms) { return new Promise((resolve, reject) => { const cb = 'swcb' + Math.random().toString(36).slice(2); const s = document.createElement('script'); let done = false;
  const end = (f, v) => { if (done) return; done = true; try { delete window[cb]; } catch (e) { window[cb] = undefined; } s.remove(); f(v); };
  window[cb] = (d) => end(resolve, d); s.onerror = () => end(reject, new Error('DraftKings did not answer')); setTimeout(() => end(reject, new Error('DraftKings timed out')), ms || 12000);
  s.src = url + (url.includes('?') ? '&' : '?') + 'callback=' + cb; document.head.appendChild(s); }); }
async function swRelayGet(kind, id) {
  if (!/^\d{4,12}$/.test(String(id))) throw new Error('bad contest number');
  const u = kind === 'contest' ? `https://api.draftkings.com/contests/v1/contests/${id}?format=jsonp` : `https://api.draftkings.com/draftgroups/v1/draftgroups/${id}/draftables?format=jsonp`;
  const j = await swJsonp(u); if (!j || (kind === 'contest' && !j.contestDetail)) throw new Error('contest not found'); return j;
}
const swMoney = (s) => { const m = /\$?\s*([\d,]+(?:\.\d+)?)/.exec(String(s || '')); return m ? parseFloat(m[1].replace(/,/g, '')) : 0; };
async function swContest(cid) {
  if (SW.info.has(cid) && SW.info.get(cid).ok) return SW.info.get(cid);
  try { const j = await swRelayGet('contest', cid); const c = j.contestDetail || j;
    const tiers = (c.payoutSummary || []).map((t) => { const d = t.tierPayoutDescriptions || {}; const cash = d.Cash != null ? swMoney(d.Cash) : Object.values(d).reduce((a, v) => a + (/ticket/i.test(String(v)) ? 0 : swMoney(v)), 0); return [+t.minPosition, +t.maxPosition, cash]; }).filter((t) => t[0] > 0 && t[1] >= t[0]).sort((a, b) => a[0] - b[0]);
    const x = { ok: true, cid, name: c.name || `contest ${cid}`, fee: +c.entryFee || 0, dg: c.draftGroupId, size: +c.maximumEntries || null, entries: +c.entries || null, start: c.contestStartTime, tiers };
    SW.info.set(cid, x); ST.dkInfo = ST.dkInfo || {}; ST.dkInfo[cid] = x; if (tiers.length) setPayout(cid, tiers);
    const f = levFees(); f[cid] = x.fee; ST.levFeeMem = f; store.set('levFees', f); return x;
  } catch (e) { const x = { ok: false, cid, err: e.message }; SW.info.set(cid, x); return x; }
}
// DraftKings draft group -> the same CSV the salary download gives, so the normal loader matches players to the model
async function swPlayers(dg) {
  let j; try { const r = await fetch(`https://api.draftkings.com/draftgroups/v1/draftgroups/${dg}/draftables?format=json`, { cache: 'no-store' }); if (!r.ok) throw new Error(r.status); j = await r.json(); }
  catch (e) { j = await swRelayGet('draftables', dg); }
  const D = j.draftables || []; if (!D.length) throw new Error('DraftKings returned no players for this contest');
  const byP = new Map(); D.forEach((d) => { const k = d.playerId + '|' + d.teamAbbreviation; if (!byP.has(k)) byP.set(k, []); byP.get(k).push(d); });
  const comp = D[0].competition || {}; const gm = /([A-Z]{2,4})\s*@\s*([A-Z]{2,4})/.exec(comp.name || ''); if (!gm) throw new Error('This draft group is not a single game');
  if (new Set(D.map((d) => (d.competition || {}).competitionId)).size > 1) throw new Error('This is a multi-game contest. Showdown Sweat handles single-game Showdown contests.');
  const t = new Date(comp.startTime); const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true }).formatToParts(t).map((p) => [p.type, p.value]));
  const gi = `${gm[1]}@${gm[2]} ${parts.month}/${parts.day}/${parts.year} ${parts.hour}:${parts.minute}${(parts.dayPeriod || 'PM').toUpperCase()} ET`;
  const q = (v) => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  const rows = ['Position,Name + ID,Name,ID,Roster Position,Salary,Game Info,TeamAbbrev,AvgPointsPerGame,Status'];
  for (const list of byP.values()) { list.sort((a, b) => a.salary - b.salary); const fl = list[0], cp = list.length > 1 ? list[list.length - 1] : null;
    const avg = ((fl.draftStatAttributes || []).find((a) => a.id === 90) || {}).value || 0; const st = fl.status && fl.status !== 'None' ? fl.status : '';
    const row = (d, rp) => [d.position, `${d.displayName} (${d.draftableId})`, d.displayName, d.draftableId, rp, d.salary, gi, d.teamAbbreviation, avg, st].map(q).join(',');
    if (cp && cp.salary > fl.salary) rows.push(row(cp, 'CPT')); rows.push(row(fl, 'FLEX')); }
  return { csv: rows.join('\n'), label: `${gm[1]} @ ${gm[2]} · DraftKings draft group ${dg}` };
}
// a standings file straight into the loaded contests (fee and payouts come from the contest API, so no confirm step)
async function swStandings(file) {
  const txt = await readStandingsFile(file); const S = parseStandings(txt); const cid = (/standings-(\d+)/i.exec(file.name) || /(\d{6,})/.exec(file.name) || [])[1] || file.name;
  const nameIx = new Map(ST.players.map((p, j) => [SL.norm(p.name), j])); const unk = new Map(); const L = []; const rankCnt = new Map();
  for (const r of S.rows) { const parts = splitLineup(r.lineup); if (parts.length !== 6) continue; let cpt = -1; const fl = []; let bad = false;
    for (const [slot, nm] of parts) { const j = nameIx.get(SL.norm(nm)); if (j == null) { unk.set(nm, (unk.get(nm) || 0) + 1); bad = true; continue; } if (slot === 'CPT') cpt = j; else fl.push(j); }
    if (bad || cpt < 0 || fl.length !== 5) continue; L.push({ id: r.id, user: r.name.replace(/\s*\(\d+\/\d+\)\s*$/, ''), rank: r.rank, pts: r.pts, cpt, fl }); rankCnt.set(r.rank, (rankCnt.get(r.rank) || 0) + 1); }
  if (!ST.levs) ST.levs = new Map(); const V = { cid, file: file.name, L, drafted: S.drafted, unk, total: S.rows.length, rankCnt, at: Date.now() }; ST.levs.set(cid, V); ST.lev = V; ST.levSel = ST.levs.size > 1 ? 'all' : cid;
  return V;
}
function swStatus(t) { SW.msg = t; const el = $('#swStatus'); if (el) el.textContent = t; }
async function swProcess() {
  if (SW.busy) { SW.again = true; return; } SW.busy = true;
  try {
    const user = ($('#swUser').value || '').trim(); if (user) { ST.dkUser = user; store.set('dkUser', user); }
    const ids = new Set([...swIds($('#swLinks').value), ...SW.files.keys()]); if (!ids.size) { swStatus('Paste a contest link or drop a standings file to start.'); return; }
    swStatus('Reading contest details from DraftKings…'); await Promise.all(Array.from(ids).map(swContest));
    const okC = Array.from(ids).map((c) => SW.info.get(c)).filter((x) => x && x.ok); const dgs = new Set(okC.map((x) => x.dg));
    if (dgs.size > 1) { swStatus('These contests are for different games. Showdown Sweat follows one game at a time: remove the other links.'); return; }
    const dg = okC.length ? okC[0].dg : null;
    if (dg && dg !== SW.dg) { swStatus('Loading the players from DraftKings…'); const pl = await swPlayers(dg); loadCSV(pl.csv, pl.label); SW.dg = dg; SW.ran = false; ST.levs = new Map(); }
    if (!ST.players.length || (!SW.dg && !SW.csv)) { renderSweat(); swStatus('Could not read the contest from DraftKings: ' + ((Array.from(SW.info.values()).find((x) => !x.ok) || {}).err || 'check the link') + '. You can also drop this game\'s DKSalaries.csv here and type each fee.'); return; }
    if (!SW.ran) { swStatus('Pulling the line from ESPN…'); try { await pullLines(); } catch (e) {} swStatus('Running the pregame sim (calibrated to the line)…'); await run(); SW.ran = !!ST.res; }
    if (ST.res) { document.body.classList.add('sw-ready'); const ms = ST.res.meanScore; const pg = $('#swPre'); if (pg && ms) pg.textContent = `Pregame sim: ${ST.teams[0]} ${fmt(ms[0])}, ${ST.teams[1]} ${fmt(ms[1])} (line ${$('#impA').value} / ${$('#impB').value}, ${ST.res.N.toLocaleString()} sims)`; }
    for (const [cid, f] of SW.files) { if (!ST.levs || !ST.levs.has(cid) || ST.levs.get(cid).file !== f.name || ST.levs.get(cid).at < f.t) { swStatus(`Reading ${f.name}…`); try { await swStandings(f.file); } catch (e) { toast(`${f.name}: ${e.message}`); } } }
    ST.mid = null; renderSweat();
    const n = ST.levs ? ST.levs.size : 0; const mine = n ? Array.from(ST.levs.values()).reduce((a, V) => a + levMine(V).length, 0) : 0;
    swStatus(n ? `${n} contest${n > 1 ? 's' : ''} loaded, ${mine} of your entries${!mine ? ' (check the username)' : ''}. Live stats refresh every 60 seconds and the rest of the game re-sims after each pull.` : 'Drop the contest standings (.zip) for each contest to sweat it.');
    if (n && !SW.live) { SW.live = true; ST.midAuto = true; ST.midFollow = true; renderMidCard(); const la = $('#liveAuto'); if (la) { la.checked = true; la.dispatchEvent(new Event('change')); } }
    else if (n && ST.live) runMid();
  } catch (e) { console.error(e); swStatus(String(e.message || e)); }
  finally { SW.busy = false; if (SW.again) { SW.again = false; swProcess(); } }
}
function renderSweat() {
  const el = $('#swContests'); if (!el) return; const ids = new Set([...swIds($('#swLinks').value), ...SW.files.keys()]);
  const rows = Array.from(ids).map((cid) => { const x = SW.info.get(cid) || {}; const V = ST.levs && ST.levs.get(cid); const mine = V ? levMine(V).length : 0;
    return `<tr><td class="small" style="white-space:normal">${x.ok ? esc(shortName(x.name)) : `contest ${esc(cid)}${x.err ? ` <span style="color:var(--bad)">(${esc(x.err)})</span>` : ''}`}</td><td class="n">${x.ok ? '$' + x.fee.toFixed(2) : (V ? `<input class="swFee" data-cid="${esc(cid)}" type="number" min="0" step="0.01" placeholder="fee" style="width:70px" value="${levFees()[cid] ?? ''}">` : '-')}</td>
      <td class="n">${(x.entries || (V && V.total) || 0).toLocaleString() || '-'}</td><td class="n">${x.tiers && x.tiers.length ? x.tiers[x.tiers.length - 1][1].toLocaleString() + ' paid' : '<span class="muted">projected</span>'}</td>
      <td>${V ? `<span class="chip ok">standings loaded</span>${V.unk.size ? ` <span class="small muted">${V.unk.size} names not matched</span>` : ''}` : '<span class="small" style="color:var(--bad)">drop its standings .zip</span>'}</td><td class="n">${V ? (mine || '<span style="color:var(--bad)">0</span>') : '-'}</td></tr>`; }).join('');
  el.innerHTML = rows ? `<div class="tw" style="border:0;margin-top:10px"><table class="nosort"><thead><tr><th>Contest</th><th class="n">Fee</th><th class="n">Entries</th><th class="n">Payouts</th><th>Standings</th><th class="n">Yours</th></tr></thead><tbody>${rows}</tbody></table></div>` : '';
  $$('.swFee', el).forEach((i) => i.onchange = () => { const f = levFees(); f[i.dataset.cid] = Math.max(0, +i.value || 0); ST.levFeeMem = f; store.set('levFees', f); ST.mid = null; if (ST.live) runMid(); });
  const hdr = $('#swGame'); if (hdr) hdr.textContent = ST.teams && ST.teams[0] && SW.dg ? `${ST.teams[0]} @ ${ST.teams[1]}` : '';
}
function sweatBoot() {
  document.body.classList.add('sweat'); document.title = 'Showdown Sweat';
  const pane = $('#pane-live'); pane.hidden = false;
  const box = document.createElement('div'); box.id = 'swBox'; box.className = 'card'; box.style.marginBottom = '16px';
  box.innerHTML = `<div class="row" style="justify-content:space-between;align-items:baseline"><h3 style="font-size:22px">Showdown Sweat <span id="swGame" class="muted" style="font-size:16px"></span></h3><span class="small muted">${esc((MODEL.meta && MODEL.meta.data) || '')}</span></div>
    <div class="row" style="gap:16px;align-items:flex-start;flex-wrap:wrap;margin-top:8px">
      <label class="small" style="display:flex;flex-direction:column;gap:4px">DraftKings username<input id="swUser" type="text" value="${esc(store.get('dkUser', '') || '')}" placeholder="username" style="width:200px"></label>
      <label class="small" style="display:flex;flex-direction:column;gap:4px;flex:1;min-width:280px">Contest links (one per line)<textarea id="swLinks" rows="3" placeholder="https://www.draftkings.com/draft/contest/196403751" style="width:100%">${esc(store.get('swLinks', '') || '')}</textarea></label>
      <div class="drop" id="swDrop" role="button" tabindex="0" style="flex:1;min-width:260px"><b>Drop each contest's standings (.zip)</b><span class="small muted">Contest page → Export standings (after lock). Showdown lineups lock at kickoff, so once per contest is enough.</span><input type="file" id="swFile" accept=".zip,.csv" multiple hidden></div></div>
    <p class="small" id="swStatus" style="margin-top:8px"></p><p class="small muted" id="swPre"></p><div id="swContests"></div>`;
  pane.parentNode.insertBefore(box, pane);
  renderLiveTab();
  const go = () => { store.set('swLinks', $('#swLinks').value); swProcess(); };
  $('#swUser').onchange = () => { ST.dkUser = $('#swUser').value.trim(); store.set('dkUser', ST.dkUser); ST.mid = null; renderSweat(); renderLive(); if (ST.live && ST.levs && ST.levs.size) runMid(); };
  $('#swLinks').onchange = go; $('#swLinks').onpaste = () => setTimeout(go, 50);
  const fi = $('#swFile'), d = $('#swDrop'); const take = async (files) => {
    for (const f of files) { let head = ''; try { head = (await readUpload(f)).slice(0, 400); } catch (e) { toast(`${f.name}: ${e.message}`); continue; }
      if (/Roster Position/i.test(head) && !/EntryId/i.test(head)) { const txt = await readUpload(f); loadCSV(txt, f.name); SW.csv = true; SW.dg = null; SW.ran = false; ST.levs = new Map(); continue; } // salary CSV fallback (no relay)
      const cid = (/standings-(\d+)/i.exec(f.name) || /(\d{6,})/.exec(f.name) || [])[1]; if (!cid) { toast(`${f.name}: no contest number in the file name`); continue; } SW.files.set(cid, { file: f, name: f.name, t: Date.now() }); }
    go(); };
  fi.onchange = () => { const f = Array.from(fi.files); fi.value = ''; if (f.length) take(f); }; d.onclick = (e) => { if (e.target.tagName !== 'INPUT') fi.click(); };
  d.ondragover = (e) => { e.preventDefault(); d.classList.add('over'); }; d.ondragleave = () => d.classList.remove('over'); d.ondrop = (e) => { e.preventDefault(); d.classList.remove('over'); const f = Array.from(e.dataTransfer.files); if (f.length) take(f); };
  swStatus($('#swLinks').value.trim() ? 'Starting…' : 'Type your username, paste your contest links, and drop each contest\'s standings (.zip).');
  if ($('#swLinks').value.trim()) go();
}
