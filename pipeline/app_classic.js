(function(){
'use strict';
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
const MODEL=JSON.parse($('#model-data').textContent);
const ENGINE_SRC=$('#engine-src').textContent, SLATE_SRC=$('#slate-src').textContent, WORKER_SRC=$('#worker-src').textContent;
new Function(ENGINE_SRC).call(window); new Function(SLATE_SRC).call(window);
const E=window.ENGINE, SL=window.SLATE;
E.prepLeague(MODEL.league);
const fmt=(v,d=1)=>(v==null||isNaN(v))?'-':Number(v).toFixed(d);
const pct=(v,d=1)=>(v==null||isNaN(v))?'-':(v*100).toFixed(d)+'%';
const esc=(s)=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function toast(msg){const t=document.createElement('div');t.className='toast';t.textContent=msg;document.body.appendChild(t);setTimeout(()=>t.remove(),2200);}
const store={get(k,d){try{const v=localStorage.getItem('cls_'+k);return v?JSON.parse(v):d;}catch(e){return d;}},set(k,v){try{localStorage.setItem('cls_'+k,JSON.stringify(v));}catch(e){}}};
const POS=['QB','RB','WR','TE','DST'], PCODE={QB:0,RB:1,WR:2,TE:3,DST:4}, SLOTS=['QB','RB','RB','WR','WR','WR','TE','FLEX','DST'];

/* ---------------- team colors (official; dark mode lifts near-black colors) ---------------- */
/*TEAMCOL*/
function teamColorCSS(){
  const rgb=(h)=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)); const lum=(h)=>{const c=rgb(h).map(v=>{v/=255; return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);}); return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2];};
  const hex=(c)=>'#'+c.map(v=>Math.round(v).toString(16).padStart(2,'0')).join('');
  const lift=(h)=>{ const c=rgb(h); let t=0, out=h; while(lum(out)<0.09&&t<0.9){ t+=0.05; out=hex(c.map(v=>v+(255-v)*t)); } return out; };
  let L='', D=''; for(const t in TEAM_COL){ L+=`.t-${t}{--tc:${TEAM_COL[t][0]}}`; D+=`.t-${t}{--tc:${lift(TEAM_COL[t][0])}}`; }
  const s=document.createElement('style'); s.textContent=`${L}@media (prefers-color-scheme: dark){${D}}`; document.head.appendChild(s);
}
const tdot=(tm)=>`<span class="tm t-${esc(TEAM_ALIAS[tm]||tm)}" style="background:var(--tc)"></span>`;

/* ---------------- state ---------------- */
const ST={players:[],games:[],res:null,own:null,portExcl:new Set(),view:{projSort:'mean',projDir:-1,pos:'ALL',game:'ALL',slatePos:'ALL',slateGame:'ALL'},entries:null,port:null,assign:null};
let workers=[]; const NW=Math.max(1,Math.min(4,(navigator.hardwareConcurrency||4)-1));
function makeWorkers(){
  if(workers.length) return;
  const url=URL.createObjectURL(new Blob([ENGINE_SRC,'\n',WORKER_SRC],{type:'text/javascript'}));
  for(let i=0;i<NW;i++){const w=new Worker(url); w.postMessage({type:'init',model:MODEL}); workers.push(w);}
}
function call(w,msg,onProg){return new Promise((res,rej)=>{w.onmessage=(e)=>{const d=e.data; if(d.type==='prog'){onProg&&onProg(d.done);return;} if(d.type==='err'){rej(new Error(d.msg));return;} if(d.type===msg.type) res(d);}; w.onerror=(e)=>rej(new Error(e.message||'worker error')); w.postMessage(msg);});}

/* ---------------- slate load ---------------- */
function parseClassic(text){
  if(text.charCodeAt(0)===0xFEFF) text=text.slice(1);
  const rows=SL.parseCSV(text); const h=rows[0].map(x=>x.trim()); const ix=(n)=>h.indexOf(n);
  const iPos=ix('Position'), iName=ix('Name'), iId=ix('ID'), iRP=ix('Roster Position'), iSal=ix('Salary'), iGI=ix('Game Info'), iTm=ix('TeamAbbrev'), iAvg=ix('AvgPointsPerGame'), iSt=ix('Status');
  if(iName<0||iSal<0||iGI<0) throw new Error('Not a DraftKings salary CSV');
  if(rows.slice(1).some(r=>(r[iRP]||'').toUpperCase()==='CPT')) throw new Error('This is a Showdown file. Use the Showdown lab for single games.');
  const games=new Map(), players=[];
  for(const r of rows.slice(1)){ if(!r[iName]) continue; const m=/([A-Z]{2,4})@([A-Z]{2,4})\s+(\S+)\s+(\S+)/.exec(r[iGI]||''); if(!m) continue;
    const key=m[1]+'@'+m[2]; if(!games.has(key)) games.set(key,{key,away:SL.nflTeam(m[1]),home:SL.nflTeam(m[2]),dkA:m[1],dkH:m[2],date:m[3],time:m[4]});
    players.push({name:r[iName],team:r[iTm],pos:r[iPos],salF:+r[iSal],salC:0,idF:r[iId],idC:'',avg:parseFloat(r[iAvg])||0,status:(iSt>=0?r[iSt]:'')||'',gkey:key}); }
  const tmin=(t)=>{const m=/(\d+):(\d+)(AM|PM)/.exec(t)||[0,0,0,'AM']; return ((+m[1])%12+(m[3]==='PM'?12:0))*60+(+m[2]);};
  const G=Array.from(games.values()).sort((a,b)=>tmin(a.time)-tmin(b.time)||a.away.localeCompare(b.away));
  return {players,games:G,teams:Array.from(new Set(players.map(p=>p.team)))};
}
function loadCSV(text,label){
  let dk; try{ dk=parseClassic(text); }catch(e){ toast(e.message||'Could not read that CSV'); return false; }
  if(!dk.players.length){ toast('No players found'); return false; }
  const matched=SL.matchSlate(MODEL,{players:dk.players,teams:dk.teams});
  dk.games.forEach((g,gi)=>{ g.gi=gi; const ln=(MODEL.meta.lines||[]).find(l=>l[0]===g.away&&l[1]===g.home); const sv=store.get('imp_'+g.key+'_'+g.date,null);
    if(sv) { g.implied=sv; g.src='saved'; } else if(ln){ const home=(ln[3]+ln[2])/2; g.implied=[+(ln[3]-home).toFixed(2),+home.toFixed(2)]; g.src='nflverse line'; } else { g.implied=[22,22]; g.src='default'; } g.line=ln||null; });
  const gIdx=new Map(dk.games.map(g=>[g.key,g.gi]));
  ST.players=matched.map((p,k)=>Object.assign(p,{gi:gIdx.get(dk.players[k].gkey),sal:p.salF,base:{rs:p.rs,ts:p.ts,rsz:p.rsz,tsz:p.tsz,rsy:p.rsy,tpd:p.tpd}}))
    .sort((a,b)=>a.gi-b.gi||(a.team===dk.games[a.gi].away?0:1)-(b.team===dk.games[b.gi].away?0:1)||b.salF-a.salF);
  ST.games=dk.games; ST.games.forEach(g=>{ const ids=ST.players.map((p,j)=>p.gi===g.gi?j:-1).filter(j=>j>=0); g.off=ids[0]; g.n=ids.length; });
  ST.res=null; ST.port=null; ST.assign=null; ST.label=label||'Uploaded CSV';
  ST.games.forEach(g=>{ g.venue=venueOf(g.away,g.home); g.wx=store.get('wx_'+g.key+'_'+g.date,null)||{rain:'',snow:'',wind:'',temp:'',open:false,auto:true}; });
  loadExcl(); loadRoles(); loadOverrides(); loadQ(); loadCaps(); renderHeader(); renderSlate(); ST.wxPromise=pullWeatherAll(true); ST.props=null; ST.kxMsg=''; ST.slateOrd=null; ST.kxPromise=kxPull(()=>{ renderSlate(); renderPropsTab(propGames()); }); renderEmpty(); if(ST.projMap) applyProjRoles(); if(ST.own) applyOwnership(); return true;
}
const oppOf=(p)=>{const g=ST.games[p.gi]; return p.team===g.away?g.home:g.away;};
function renderHeader(){
  const G=ST.games; const d=G[0]?G[0].date:''; const dt=d?new Date(d.replace(/(\d+)\/(\d+)\/(\d+)/,'$3-$1-$2T12:00')):null;
  $('#matchup').innerHTML=`<span>Main slate</span><span class="at">·</span><span>${G.length} games</span>`;
  $('#gameinfo').textContent=`${dt?dt.toLocaleDateString([], {weekday:'short',month:'short',day:'numeric'}):''} · ${G.map(g=>g.time).filter((v,i,a)=>a.indexOf(v)===i).join(', ')} ET · ${ST.players.length} players`;
  $('#srcLabel').textContent=ST.label; { const mn=$('#modelNote'); if(mn) mn.textContent=(MODEL.meta&&MODEL.meta.data)||''; }
}
function markStale(){ if(ST.res) $('#stale').hidden=false; }
const exclKey=()=>'excl_'+(ST.games[0]?ST.games[0].date:'');
function saveExcl(){ store.set(exclKey(),Array.from(ST.portExcl).map(j=>ST.players[j].name+'|'+ST.players[j].team)); }
function loadExcl(){ ST.portExcl=new Set(); const v=store.get(exclKey(),[]); const ix=new Map(ST.players.map((p,j)=>[p.name+'|'+p.team,j])); v.forEach(k=>{ const j=ix.get(k); if(j!=null) ST.portExcl.add(j); }); }
function onExclChange(){ saveExcl(); if(!$('#pane-slate').hidden) renderSlate(); }
function saveImplied(g){ store.set('imp_'+g.key+'_'+g.date,g.implied); }

/* ---------------- slate inputs ---------------- */
/* team total row: each share column summed over active players (run columns: RBs/WRs/TEs plus the starting QB; target columns: non-QBs).
   The engine rescales shares to 100% at sim time, so a total away from 100% means every player in that column is scaled by the same factor. */
function teamTotRow(off,cols,lead,trail){
  const runF=new Set(['rs','rsz','rsy']); const sum=(f)=>off.filter(p=>runF.has(f)?(p.pos!=='QB'||p.isStarterQB):p.pos!=='QB').reduce((a,p)=>a+(+p[f]||0),0);
  const cell=(f)=>{ const v=sum(f)*100; const far=Math.abs(v-100)>10; return `<td class="n"><b style="${far?'color:var(--warn)':''}" title="${far?'Far from 100%: the sim rescales this column, so each player\'s share becomes his value / '+v.toFixed(0)+'%':'Sums to about 100%'}">${v.toFixed(0)}%</b></td>`; };
  return `<tr class="tot"><td colspan="${lead}" class="small muted">Team total (active players)</td>${cols.map(cell).join('')}${trail?`<td colspan="${trail}"></td>`:''}</tr>`;
}
/* position order, then workload: expected designed runs + targets per game from shares (starting QB first; K/DST by salary); inactive players sink within their position */
const POSO={QB:0,RB:1,WR:2,TE:3,DST:4,K:5};
const workload=(p)=>p.pos==='QB'?(p.isStarterQB?1000:0)+p.salF/1e4:(p.pos==='RB'||p.pos==='WR'||p.pos==='TE')?(+p.rs||0)*25+(+p.ts||0)*33:p.salF/1e4;
const byPosLoad=(a,b)=>((POSO[a.pos]??9)-(POSO[b.pos]??9))||((b.active?1:0)-(a.active?1:0))||(workload(b)-workload(a))||(b.salF-a.salF);
const teamOpts=(sel)=>Array.from(new Set(ST.players.map(p=>p.team))).sort().map(t=>`<option ${t===sel?'selected':''}>${esc(t)}</option>`).join('');
function wxCells(g){ const v=g.venue||{}, w=g.wx||{}; const z=wxParams(Object.assign({roof:v.roof},w)); const covered=(v.roof==='dome'||v.roof==='retract')&&!w.open;
  const box=(f,lab,ph)=>`<input class="wxin" data-wg="${g.gi}" data-wf="${f}" type="number" step="1" value="${w[f]??''}" placeholder="${ph}" title="${lab}" aria-label="${lab}" ${covered?'disabled':''}>`;
  const roof=v.roof==='dome'?'Dome':v.roof==='retract'?'Retractable roof':'Outdoors';
  const tip=`${esc(v.name||'Unknown stadium')} · ${roof}${w.detail?' · '+esc(w.detail):''}${w.gust?' · gusts '+w.gust+' mph':''}${w.at?' · pulled '+esc(w.at):''}`;
  const ti=wxImplied(g.implied,z,wxTotOn()), dT=ti[0]+ti[1]-g.implied[0]-g.implied[1];
  return `<td class="small" title="${tip}">${v.roof==='out'?'':`<span class="chip">${roof==='Dome'?'Dome':'Roof'}</span> `}${v.roof==='retract'?`<label class="small muted"><input type="checkbox" data-wopen="${g.gi}" ${w.open?'checked':''}> open</label>`:''}${box('rain','Rain chance x intensity, 0-100','rain')} ${box('snow','Snow chance x intensity, 0-100','snow')} ${box('wind','Sustained wind, mph','wind')} ${box('temp','Temperature, F','°F')}</td>
    <td class="small" title="${esc(wxSummary(z))}">${covered?'<span class="muted">none</span>':z.active?`<span class="chip ex">${Math.abs(dT)>=0.05?(dT>0?'+':'')+dT.toFixed(1)+' pts':'mix only'}</span>`:'<span class="muted">none</span>'}</td>`; }
function renderSlate(){ keepScroll($('#pane-slate'),_renderSlate); }
const kxGamesAll=()=>ST.games.map(g=>({away:g.away,home:g.home,imp:g.implied}));
const teamSeq=()=>ST.games.flatMap(g=>[g.away,g.home]);
function _renderSlate(){
  const el=$('#pane-slate'); const P=ST.players, G=ST.games, R=ST.res;
  const gameRows=G.map(g=>{ const sp=g.implied[1]-g.implied[0]; const sim=R&&R.gstat[g.gi];
    return `<tr><td>${tdot(g.away)}<b>${esc(g.away)}</b> <span class="muted">@</span> ${tdot(g.home)}<b>${esc(g.home)}</b></td><td class="small">${esc(g.time)}</td>
      <td class="n"><input class="imp" data-g="${g.gi}" data-t="0" type="number" step="0.25" value="${g.implied[0]}" style="width:72px" aria-label="${esc(g.away)} implied"></td>
      <td class="n"><input class="imp" data-g="${g.gi}" data-t="1" type="number" step="0.25" value="${g.implied[1]}" style="width:72px" aria-label="${esc(g.home)} implied"></td>
      <td class="n num">${fmt(g.implied[0]+g.implied[1],1)}</td><td class="n num">${sp>0?esc(g.home)+' -'+fmt(sp,1):sp<0?esc(g.away)+' -'+fmt(-sp,1):'PK'}</td>
      <td class="small muted">${esc(g.src||'')}</td>${wxCells(g)}${R?`<td class="n num">${fmt(sim.mean[0])} - ${fmt(sim.mean[1])}</td>`:''}</tr>`; }).join('');
  const fP=ST.view.slatePos, fG=ST.view.slateGame, fT=ST.view.slateTeam||(G[0]?G[0].away:'ALL');
  const rows=stableSort(P.map((p,j)=>({p,j})).filter(({p})=>(fP==='ALL'||p.pos===fP)&&(fG==='ALL'||String(p.gi)===fG)&&(fT==='ALL'||p.team===fT)),'cl|'+fP+'|'+fG+'|'+fT,(x,y)=>byPosLoad(x.p,y.p));
  const inp=(j,f,dis)=>dis?'<span class="muted">-</span>':`<input class="share" type="number" step="0.5" min="0" data-f="${f}" data-i="${j}" value="${fmt((+ST.players[j][f]||0)*100,1)}" aria-label="${f}">`;
  // market props card covers every game; the game of the team you're viewing is listed first
  const kxG=G.slice().sort((a,b)=>((b.away===fT||b.home===fT||String(b.gi)===fG)?1:0)-((a.away===fT||a.home===fT||String(a.gi)===fG)?1:0)).map(g=>({away:g.away,home:g.home,imp:g.implied}));
  el.innerHTML=vacatedCard()+propsCard(kxG)+`<div class="card"><div class="row" style="justify-content:space-between"><h3>Games and implied totals</h3><div class="row"><button id="useLines" class="small">Use nflverse lines</button><button id="pullLines" class="small">Pull live lines (ESPN)</button><button id="pullWx" class="small">Pull weather</button><label class="small"><input type="checkbox" id="wxTot" ${wxTotOn()?'checked':''}> Adjust totals for weather</label><span id="lineSrc" class="small muted"></span><span id="wxSrc" class="small muted">${esc(ST.wxMsg||'')}</span></div></div>
    <p class="small muted">Each game is calibrated so its simulated scoring matches these team totals. Edits are saved per game.</p>
    <div class="tw" style="border:0"><table><thead><tr><th>Game</th><th>Kickoff</th><th class="n">Away</th><th class="n">Home</th><th class="n">Total</th><th class="n">Spread</th><th>Source</th><th title="Rain and snow are 0-100 (chance x intensity over the game), wind mph, temp F. Pulled from Open-Meteo for the stadium at kickoff; edit any value.">Weather (rain · snow · wind · °F)</th><th title="Change to the game total from weather (if adjusting totals) plus the run/pass, fumble and kicking shifts. Hover a cell for details.">Weather adj</th>${R?'<th class="n">Sim mean</th>':''}</tr></thead><tbody>${gameRows}</tbody></table></div></div>
    <div class="card" style="margin-top:16px;padding:0"><div class="row" style="padding:12px 14px;justify-content:space-between"><h3>Players</h3><div class="row small">
      <label>Position <select id="sPos">${['ALL',...POS].map(x=>`<option ${x===fP?'selected':''}>${x}</option>`).join('')}</select></label>
      <span class="row" style="gap:4px"><button id="sPrev" class="small" title="Previous team" aria-label="Previous team">◀</button><label>Team <select id="sTeam"><option value="ALL" ${fT==='ALL'?'selected':''}>All teams</option>${teamSeq().map(t=>`<option ${t===fT?'selected':''}>${esc(t)}</option>`).join('')}</select></label><button id="sNext" class="small" title="Next team" aria-label="Next team">▶</button></span>
      <label>Game <select id="sGame"><option value="ALL">All games</option>${G.map(g=>`<option value="${g.gi}" ${String(g.gi)===fG?'selected':''}>${esc(g.away)} @ ${esc(g.home)}</option>`).join('')}</select></label>
      <button id="resetShares" class="small">Reset shares</button></div></div>
      <p class="small muted" style="padding:0 14px">Shares are each player's cut of his team's designed runs and targets in competitive game states, blended from 2026 with lighter 2025/2024 weight. Inactive players' shares go to active teammates at sim time. Plays = in or out this week (out moves his work to teammates). Use = allowed in your lineups. Edit shares or pick the starting QB, then run. Sorted by position, then workload (expected runs plus targets from the shares). Pick a game or team to see share totals.</p>
      <div class="tw" style="border:0;border-top:1px solid var(--line);border-radius:0;max-height:640px;overflow:auto"><table><thead><tr><th title="Playing this week. Off = out: his carries and targets go to his teammates">Plays</th><th title="Allowed in your lineups (portfolio and cash). Off = excluded; he still plays in the sims">Use</th><th>Player</th><th title="Set usage from a league role profile (for players with no data or a new role)">Role</th><th>Team</th><th class="n">Salary</th><th class="n">DK avg</th><th class="n">Run %</th><th class="n">Tgt %</th><th class="n">RZ run %</th><th class="n">RZ tgt %</th><th class="n">Gms 26/all</th></tr></thead><tbody>
      ${rows.map(({p,j})=>{ const sk=['QB','RB','WR','TE'].includes(p.pos); const st=p.status?`<span class="chip ${SL.INACTIVE.has(p.status.toUpperCase())?'bad':'ex'}">${esc(p.status)}</span>`:''; const flag=(p.forceIn&&(SL.INACTIVE.has((p.status||'').toUpperCase())||(ST.projMap&&(ST.projMap.get(SL.norm(p.name))||0)<=0.05))?'<span class="chip ok" title="You turned him on: overrides his DK status or 0 projection">in (you)</span> ':'')+(p.role?`<span class="chip ok" title="Usage set from the ${esc(ROLES[p.role].label)} profile">role</span> `:'')+(p.mkt?'<span class="chip ok" title="Share set from the Kalshi market split">market</span> ':'')+(p.noGame?`<span class="chip ex" title="No games yet this season while his team has played: his share from a prior role or team is cut to depth level${p.noGameRestored?' (restored: your projections give him a role)':'. Raise it if he is back from injury, or load projections'}">${p.noGameRestored?'restored':'no 2026 games'}</span> `:'')+(p.nextUp?`<span class="chip ok" title="Projected 0 in your file, but ${esc(p.nextUp)} is out and still projected: treated as next man up">next up</span> `:'')+(p.noProj?'<span class="chip bad" title="Projected for 0 points in your projections file: no carries or targets">0 proj</span> ':'')+(!p.matched&&p.pos!=='DST'?'<span class="chip ex" title="No NFL play-by-play history found; default share used">no data</span>':'');
        const qb=p.pos==='QB'?`<label class="small muted"><input type="radio" name="qb${esc(p.team)}" data-q="${j}" ${p.isStarterQB?'checked':''}> start</label>`:'';
        return `<tr class="${p.active?'':'off'}"><td><input type="checkbox" data-act="${j}" ${p.active?'checked':''} aria-label="Playing"></td><td><input type="checkbox" data-use="${j}" ${ST.portExcl.has(j)?'':'checked'} ${p.active?'':'disabled'} aria-label="Use in lineups"></td><td><button class="pname plink" data-pc="${j}">${esc(p.name)}</button><span class="pos">${p.pos}</span> ${st} ${flag} ${qb} ${qCell(p,j)}</td><td>${roleSelect(p,j)}</td><td>${tdot(p.team)}${esc(p.team)} <span class="muted small">v ${esc(oppOf(p))}</span></td><td class="n">${p.salF.toLocaleString()}</td><td class="n">${fmt(p.avg,1)}</td>
          ${sk?`<td class="n">${inp(j,'rs')}</td><td class="n">${inp(j,'ts',p.pos==='QB')}</td><td class="n">${inp(j,'rsz')}</td><td class="n">${inp(j,'tsz',p.pos==='QB')}</td><td class="n">${p.gc||0}/${p.g||0}</td>`:`<td colspan="5" class="muted small">Sacks, turnovers, return TDs, points allowed</td>`}</tr>`; }).join('')}${(fT!=='ALL'?[fT]:fG!=='ALL'?[G[+fG].away,G[+fG].home]:[]).map(tm=>teamTotRow(P.filter(p=>p.team===tm&&['QB','RB','WR','TE'].includes(p.pos)&&p.active),['rs','ts','rsz','tsz'],7,1).replace('Team total (active players)',esc(tm)+' total (active players)')).join('')}</tbody></table></div></div>`;
  $$('.imp',el).forEach(i=>i.onchange=()=>{ const g=ST.games[+i.dataset.g]; g.implied[+i.dataset.t]=+i.value||g.implied[+i.dataset.t]; g.src='edited'; saveImplied(g); markStale(); renderSlate(); });
  $('#sPos').onchange=(e)=>{ST.view.slatePos=e.target.value; renderSlate();}; $('#sGame').onchange=(e)=>{ST.view.slateGame=e.target.value; renderSlate();}; $('#sTeam').onchange=(e)=>{ST.view.slateTeam=e.target.value; renderSlate();};
  { const seq=teamSeq(); const step=(d)=>{ const i=seq.indexOf(fT); ST.view.slateTeam=seq[((i<0?(d>0?-1:0):i)+d+seq.length)%seq.length]; renderSlate(); }; $('#sPrev').onclick=()=>step(-1); $('#sNext').onclick=()=>step(1); }
  $$('input[data-f]',el).forEach(i=>i.onchange=()=>{ ST.players[+i.dataset.i][i.dataset.f]=Math.max(0,(+i.value||0)/100); markStale(); });
  $$('input[data-act]',el).forEach(i=>i.onchange=()=>{ const p=ST.players[+i.dataset.act]; setPlays(p,i.checked); if(p.pos==='QB') fixQB(p.team); if(ST.projMap) applyProjRoles(); markStale(); renderSlate(); });
  $$('input[data-q]',el).forEach(i=>i.onchange=()=>{ const p=ST.players[+i.dataset.q]; ST.players.filter(q=>q.team===p.team&&q.pos==='QB').forEach(q=>q.isStarterQB=0); p.isStarterQB=1; p.active=true; markStale(); renderSlate(); });
  bindVacated(el);
  $$('input[data-use]',el).forEach(i=>i.onchange=()=>{ const j=+i.dataset.use; if(i.checked) ST.portExcl.delete(j); else ST.portExcl.add(j); saveExcl(); const n=ST.portExcl.size; const e=$('#exclNote'); if(e) e.textContent=n?`${n} excluded from lineups`:''; });
  bindQ(el,renderSlate);
  bindProps(el,kxG,()=>renderSlate());
  bindRoles(el);
  $('#resetShares').onclick=()=>{ ST.slateOrd=null; ST.players.forEach(p=>{ applyRole(p,''); Object.assign(p,p.base); delete p.mkt; delete p.mktGrp; }); kxResetMarket(); saveRoles(); markStale(); renderSlate(); };
  $('#useLines').onclick=()=>{ ST.games.forEach(g=>{ if(g.line){ const home=(g.line[3]+g.line[2])/2; g.implied=[+(g.line[3]-home).toFixed(2),+home.toFixed(2)]; g.src='nflverse line'; saveImplied(g);} }); markStale(); renderSlate(); };
  $('#pullLines').onclick=pullLines;
  $('#pullWx').onclick=()=>{ ST.games.forEach(g=>{ if(g.wx) g.wx.auto=true; }); pullWeatherAll(false); };
  $('#wxTot').onchange=(e)=>{ store.set('wxTot',e.target.checked); markStale(); renderSlate(); };
  $$('input[data-wf]',el).forEach(i=>i.onchange=()=>{ const g=ST.games[+i.dataset.wg]; g.wx=Object.assign({},g.wx,{[i.dataset.wf]:i.value===''?'':+i.value,auto:false,detail:'edited by you'}); saveWx(g); markStale(); renderSlate(); });
  $$('input[data-wopen]',el).forEach(i=>i.onchange=()=>{ const g=ST.games[+i.dataset.wopen]; g.wx=Object.assign({},g.wx,{open:i.checked}); saveWx(g); markStale(); renderSlate(); });
}
function fixQB(tm){const qbs=ST.players.filter(q=>q.team===tm&&q.pos==='QB');if(!qbs.some(q=>q.isStarterQB&&q.active)){qbs.forEach(q=>q.isStarterQB=0);const a=qbs.filter(q=>q.active).sort((x,y)=>y.salF-x.salF)[0];if(a)a.isStarterQB=1;}}
/* weather per game: forecast pull (auto on slate load, button to refresh), manual edits saved per game */
const wxTotOn=()=>store.get('wxTot',true);
function saveWx(g){ store.set('wx_'+g.key+'_'+g.date,g.wx); }
async function pullWeatherAll(silent){
  const G=ST.games.filter(g=>g.venue&&g.venue.roof==='out'||g.wx&&g.wx.open); const note=$('#wxSrc'); if(note) note.textContent=G.length?'Pulling forecasts…':'All games are under a roof';
  let ok=0, bad=0, msg='';
  await Promise.all(G.map(async g=>{ if(silent&&g.wx&&!g.wx.auto) return; try{ const f=await fetchForecast(g.venue,g.date,g.time); g.wx=Object.assign({},g.wx,{rain:f.rain,snow:f.snow,wind:f.wind,temp:f.temp,detail:f.detail,gust:f.gust,at:f.at,auto:true}); saveWx(g); ok++; }catch(e){ bad++; msg=e.message; } }));
  ST.wxMsg=ok?`Forecasts pulled for ${ok} outdoor game${ok>1?'s':''} (Open-Meteo)${bad?`; ${bad} failed: ${msg}`:''}`:bad?`Forecast pull failed: ${msg}. Enter conditions by hand.`:(silent?'':'All outdoor games already have conditions you entered');
  if(note) note.textContent=ok?`Forecasts pulled for ${ok} outdoor game${ok>1?'s':''} (Open-Meteo)${bad?`; ${bad} failed: ${msg}`:''}`:bad?`Forecast pull failed: ${msg}. Enter conditions by hand.`:'';
  if(ok){ markStale(); if(!$('#pane-slate').hidden) renderSlate(); }
}
async function pullLines(){
  const btn=$('#pullLines'), note=$('#lineSrc'); btn.disabled=true; note.textContent='Pulling from ESPN…';
  const AB={WSH:'WAS',LAR:'LA',JAC:'JAX'}; const d=ST.games[0]&&/(\d{2})\/(\d{2})\/(\d{4})/.exec(ST.games[0].date);
  try{ const r=await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard${d?`?dates=${d[3]}${d[1]}${d[2]}`:''}`,{cache:'no-store'}); if(!r.ok) throw new Error('ESPN returned '+r.status); const js=await r.json(); let n=0;
    for(const ev of js.events||[]){ const c=ev.competitions&&ev.competitions[0]; if(!c||!c.odds||!c.odds.length) continue; const tm={}; c.competitors.forEach(x=>tm[x.homeAway]=AB[x.team.abbreviation]||x.team.abbreviation);
      const g=ST.games.find(g=>g.away===tm.away&&g.home===tm.home); if(!g) continue; const o=c.odds[0]; const tot=+o.overUnder; let sp=null; const m=/([A-Z]{2,4})\s*(-?\d+(\.\d+)?)/.exec(o.details||'');
      if(/EVEN|PK/i.test(o.details||'')) sp=0; else if(m){ const fav=AB[m[1]]||m[1]; const v=Math.abs(+m[2]); sp=fav===g.home?v:-v; } if(!(tot>0)||sp==null) continue;
      const home=(tot+sp)/2; g.implied=[+(tot-home).toFixed(2),+home.toFixed(2)]; g.src='ESPN '+(o.provider&&o.provider.name||''); saveImplied(g); n++; }
    note.textContent=`${n} of ${ST.games.length} games updated from ESPN`; markStale(); renderSlate();
  }catch(e){ note.textContent=/Failed to fetch|NetworkError|Load failed|Content Security/i.test(String(e))?'Could not reach ESPN. The claude.ai viewer blocks outside requests: use the downloaded HTML file.':String(e.message||e); }
  btn.disabled=false;
}

/* ---------------- run ---------------- */
function gameSlate(g,VA){ const ps=ST.players.slice(g.off,g.off+g.n); VA=VA||adjustVacated().sh;
  return {weather:wxParams(Object.assign({roof:g.venue&&g.venue.roof},g.wx)),teams:[g.away,g.home],teamAdj:[{proe:kxTiltOf(g.away)},{proe:kxTiltOf(g.home)}],players:ps.map((p,k)=>({name:p.name,team:p.team,pos:p.pos,mid:p.mid,active:p.active,rs:VA[g.off+k].rs,ts:VA[g.off+k].ts,rsz:VA[g.off+k].rsz,tsz:VA[g.off+k].tsz,rsy:VA[g.off+k].rsy,tpd:VA[g.off+k].tpd,isStarterQB:p.isStarterQB||0,sal:p.salF,salF:p.salF,salC:0}))}; }
const propGames=()=>ST.games.map(g=>({away:g.away,home:g.home,ps:ST.res&&ST.res.ps&&ST.res.ps[g.gi],psM:ST.res&&ST.res.psM&&ST.res.psM[g.gi],idx:(j)=>(j>=g.off&&j<g.off+g.n)?j-g.off:null}));
async function runPstats(list){ const tok=ST.psTok=(ST.psTok||0)+1; const chunks=workers.map(()=>[]); list.forEach((x,i)=>chunks[i%NW].push(x));
  try{ const res=await Promise.all(workers.map((w,k)=>chunks[k].length?call(w,{type:'pstats',games:chunks[k],n:2000,seed:991+k*31}):null)); if(tok!==ST.psTok||!ST.res) return;
    ST.res.ps={}; res.forEach(r=>r&&r.games.forEach(g=>{ ST.res.ps[g.gi]={np:g.np,K:g.K,n:g.n,data:g.data}; })); ST.res.psM=null; renderPropsTab(propGames());
    // Model sim: the same box-score sims with every Kalshi input removed, so Props vs sim is not graded against itself
    if(!kxAnyMarket()){ ST.res.psM=ST.res.ps; renderPropsTab(propGames()); return; }
    const sByGi=new Map(list.map(x=>[x.gi,x.s])); const mlist=kxModelSwap(()=>{ const VA=adjustVacated().sh; return ST.games.map(g=>{ const v=qSlates(ST.players.slice(g.off,g.off+g.n),()=>gameSlate(g)); return {gi:g.gi,slate:gameSlate(g,VA),s:sByGi.get(g.gi),variants:v.length>1?v:null}; }); });
    const mch=workers.map(()=>[]); mlist.forEach((x,i)=>mch[i%NW].push(x));
    const mres=await Promise.all(workers.map((w,k)=>mch[k].length?call(w,{type:'pstats',games:mch[k],n:2000,seed:1291+k*31}):null)); if(tok!==ST.psTok||!ST.res) return;
    ST.res.psM={}; mres.forEach(r=>r&&r.games.forEach(g=>{ ST.res.psM[g.gi]={np:g.np,K:g.K,n:g.n,data:g.data}; })); renderPropsTab(propGames()); }catch(e){ console.error(e); } }
// quick sim of the current setup for the QB props: calibrated, 1,200 box scores per game
async function kxMeasure(){ const G=ST.games; const VA=adjustVacated().sh; const slates=G.map(g=>gameSlate(g,VA));
  const chunks=workers.map(()=>[]); G.forEach((g,i)=>chunks[i%NW].push({gi:g.gi,slate:slates[i],implied:wxImplied(g.implied,slates[i].weather,wxTotOn())}));
  const cal=new Map(); (await Promise.all(workers.map((w,k)=>chunks[k].length?call(w,{type:'calib',games:chunks[k],n:800,seed:17+k}):null))).forEach(r=>r&&r.res.forEach(x=>cal.set(x.gi,x.s)));
  const pch=workers.map(()=>[]); G.forEach((g,i)=>pch[i%NW].push({gi:g.gi,slate:slates[i],s:cal.get(g.gi)}));
  const res=await Promise.all(workers.map((w,k)=>pch[k].length?call(w,{type:'pstats',games:pch[k],n:1200,seed:577+k}):null)); const out={};
  res.forEach(r=>r&&r.games.forEach(x=>{ const g=G.find(y=>y.gi===x.gi); const idxs=[]; for(let k=0;k<g.n;k++) idxs.push([g.off+k,k]); Object.assign(out,kxPsTeamMeans(x,idxs,ST.players)); }));
  return out; }
async function run(){
  { const ps=[ST.wxPromise,ST.kxPromise].filter(Boolean); ST.wxPromise=ST.kxPromise=null; if(ps.length) await Promise.race([Promise.all(ps),new Promise(r=>setTimeout(r,6000))]); } // let the forecast and props land before the first run
  if(!ST.players.length) return; makeWorkers();
  const N=Math.max(500,Math.min(30000,+$('#nsims').value||10000)); const btn=$('#runBtn'); btn.disabled=true; $('#stale').hidden=true;
  const bar=$('#prog>div'), stat=$('#status'); bar.style.width='0%';
  try{
    if(kxQbOn()){ stat.textContent='Setting each team\'s pass rate and QB designed runs from the QB props…'; try{ await kxQbApply(kxGamesAll(),kxMeasure); }catch(e){ console.error(e); } }
    const G=ST.games; const VA=adjustVacated().sh; const slates=G.map(g=>gameSlate(g,VA));
    stat.textContent=`Calibrating ${G.length} games to their implied totals…`;
    const chunks=workers.map(()=>[]); G.forEach((g,i)=>chunks[i%NW].push({gi:g.gi,slate:slates[i],implied:wxImplied(g.implied,slates[i].weather,wxTotOn())}));
    const cal=new Array(G.length); (await Promise.all(workers.map((w,k)=>chunks[k].length?call(w,{type:'calib',games:chunks[k],n:1200,seed:7+k}):null))).forEach(r=>r&&r.res.forEach(x=>cal[x.gi]=x));
    const pos=ST.players.map(p=>p.active&&p.salF>0?PCODE[p.pos]:-1), sal=ST.players.map(p=>p.salF);
    stat.textContent=`Simulating ${G.length} games ${N.toLocaleString()} times and solving each slate's optimal lineup…`;
    const games=G.map((g,i)=>{ const v=qSlates(ST.players.slice(g.off,g.off+g.n),()=>gameSlate(g)); return {slate:slates[i],off:g.off,s:cal[i].s,variants:v.length>1?v:null}; }); const nT=ST.players.length;
    const per=Math.ceil(N/NW), done=new Array(NW).fill(0);
    const parts=(await Promise.all(workers.map((w,k)=>{ const n=Math.min(per,N-k*per); if(n<=0) return null;
      return call(w,{type:'sim',games,nTotal:nT,n,seed:(Date.now()+k*7919)>>>0,opt:{pos,sal}},(d)=>{done[k]=d; bar.style.width=(100*done.reduce((a,b)=>a+b,0)/N).toFixed(1)+'%';}); }))).filter(Boolean);
    bar.style.width='100%'; stat.textContent='Summarizing…'; await new Promise(r=>setTimeout(r,20));
    analyze(parts,cal);
    const mt=G.reduce((a,g)=>a+ST.res.gstat[g.gi].mean[0]+ST.res.gstat[g.gi].mean[1],0), it=G.reduce((a,g)=>a+g.implied[0]+g.implied[1],0);
    stat.textContent=`${ST.res.N.toLocaleString()} slate sims · ${G.length} games · sim points per game ${fmt(mt/G.length)} vs implied ${fmt(it/G.length)}`;
    renderAll();
    runPstats(games.map((x,i)=>({gi:G[i].gi,slate:x.slate,s:x.s,variants:x.variants})));
  }catch(e){ console.error(e); stat.textContent='Run failed: '+e.message; }
  btn.disabled=false;
}
function analyze(parts,cal){
  const P=ST.players, n=P.length, G=ST.games, nG=G.length; let N=0; parts.forEach(p=>N+=p.n);
  const pts=new Float32Array(N*n), sc=new Float32Array(N*nG*2), opt=new Int16Array(N*9), ov=new Float32Array(N); let o=0;
  for(const p of parts){ pts.set(p.pts,o*n); sc.set(p.sc,o*nG*2); opt.set(p.opt,o*9); ov.set(p.ov,o); o+=p.n; }
  const optCnt=new Float64Array(n); const lu=new Map();
  for(let i=0;i<N;i++){ if(opt[i*9]<0) continue; const L=Array.from(opt.subarray(i*9,i*9+9)); L.forEach(j=>optCnt[j]++); const k=L.slice().sort((a,b)=>a-b).join(','); const x=lu.get(k); if(x) x.n++; else lu.set(k,{L,n:1,key:k}); }
  const stats=P.map((p,j)=>{ const col=new Float32Array(N); let s=0; for(let i=0;i<N;i++){ const v=pts[i*n+j]; col[i]=v; s+=v; } col.sort(); const q=(x)=>col[Math.min(N-1,Math.max(0,Math.round(x*(N-1))))];
    return {mean:s/N,pc:[0,.1,.2,.3,.4,.5,.6,.7,.8,.9,1].map(q),p99:q(.99),opt:optCnt[j]/N}; });
  const gstat=G.map((g,k)=>{ let a=0,b=0,w=0; const tot=new Float32Array(N); for(let i=0;i<N;i++){ const x=sc[(i*nG+k)*2], y=sc[(i*nG+k)*2+1]; a+=x; b+=y; if(x>y) w++; else if(x===y) w+=0.5; tot[i]=x+y; } tot.sort(); const q=(f)=>tot[Math.round(f*(N-1))];
    return {mean:[a/N,b/N],w0:w/N,tot:[q(.1),q(.5),q(.9)],s:cal[k].s}; });
  ST.res={N,n,pts,sc,opt,ov,stats,gstat,lineups:Array.from(lu.values()).sort((a,b)=>b.n-a.n)};
}

/* ---------------- render: projections, games, stacks, optimal ---------------- */
function renderEmpty(){ setTimeout(()=>renderPropsTab(propGames()),0); ['games','proj','cmp','stacks','lineups','cash','port'].forEach(t=>{ const el=$('#pane-'+t); if(el) el.innerHTML='<p class="note">Run the simulation to see results.</p>'; }); }
function renderAll(){ renderSlate(); renderGames(); renderProj(); renderPropsTab(propGames()); renderCompare(); renderStacks(); $('#pane-lineups').innerHTML=''; ST.cash=null; renderCash(); renderPortfolioSetup(); }
const heat=(v,mx,tok,mn=0)=>{const f=Math.max(0,Math.min(1,(v-mn)/((mx-mn)||1))); return `style="background:color-mix(in srgb, var(${tok}) ${Math.round(Math.pow(f,0.75)*58+(f>0?4:0))}%, var(--panel))"`;};
/* 3-color column scale (Excel style): green above the column median, red below; top end clipped near the 98th pct so one outlier doesn't wash out the rest */
const colScale=(vals)=>{ const s=vals.filter(v=>isFinite(v)).sort((a,b)=>a-b); if(!s.length) return ()=>''; const lo=s[0], mid=s[s.length>>1], hi=s[Math.max(0,s.length-1-Math.max(1,Math.floor(s.length*0.02)))]||s[s.length-1];
  return (v)=>{ if(!(s[s.length-1]>lo)||!isFinite(v)) return ''; if(v>mid){ const f=Math.min(1,hi>mid?(v-mid)/(hi-mid):1); return `style="background:color-mix(in srgb, var(--good) ${Math.round(12+Math.pow(f,0.8)*50)}%, var(--panel))"`; }
    if(v<mid){ const f=Math.min(1,mid>lo?(mid-v)/(mid-lo):1); return `style="background:color-mix(in srgb, var(--bad) ${Math.round(6+f*30)}%, var(--panel))"`; } return ''; }; };

const hasOwn=()=>ST.players.some(p=>p.own!=null);
/* opposing-defense funnel (current season only, fit_defense.py): applied pass-rate shift and run-efficiency shift for an offense facing defense `dt` */
function funnelOf(dt){ const m=(MODEL.teams||{})[dt]||{}; const f=m.dfun; if(!f) return null; const pp=(m.dproe||0)*100, yp=f[2]; const lean=pp/1.0-yp/0.1;
  return {pp,yp,raw:f[0]*100,rawY:f[1],plays:f[3],car:f[4],lab:(lean>2||(pp>0.5&&yp<=0.03))?'Pass funnel':(lean<-2||(pp<-0.5&&yp>=-0.03))?'Run funnel':'Neutral'}; }
const funnelTitle=(dt,F)=>`${dt} defense this season (opponent-adjusted): offenses pass ${Math.abs(F.raw).toFixed(1)} pts ${F.raw>=0?'more':'less'} often than their norm and gain ${Math.abs(F.rawY).toFixed(2)} ${F.rawY>=0?'more':'fewer'} yards per carry than their norm (${F.plays} plays, ${F.car} carries). After shrinking for sample size the sim applies ${F.pp>=0?'+':''}${F.pp.toFixed(1)} pts pass rate and ${F.yp>=0?'+':''}${F.yp.toFixed(2)} YPC. Team totals still match the implied totals.`;
function wxShort(g){ const v=g.venue||{}, w=g.wx||{}; if((v.roof==='dome'||v.roof==='retract')&&!w.open) return '<span class="muted">Roof</span>'; const z=wxParams(Object.assign({roof:v.roof},w));
  const parts=[]; if(+w.rain>=5) parts.push('rain '+w.rain); if(+w.snow>=5) parts.push('snow '+w.snow); if(w.wind!==''&&w.wind!=null) parts.push(w.wind+' mph'); if(w.temp!==''&&w.temp!=null) parts.push(w.temp+'°F');
  return (z.active?'<span class="chip ex">'+parts.join(' · ')+'</span>':'<span class="muted">'+(parts.join(' · ')||'no data')+'</span>'); }
function renderGames(){
  const el=$('#pane-games'); const R=ST.res; if(!R) return;
  el.innerHTML=`<div class="card"><h3>Games</h3><p class="small muted">Each game simulated play by play ${R.N.toLocaleString()} times, calibrated to its implied totals. Stack rate = share of optimal lineups with 3 or more players from this game.</p><div class="tw" style="border:0"><table><thead><tr><th>Game</th><th>Kickoff</th><th>Weather</th><th class="n">Implied</th><th class="n">Sim mean</th><th class="n">Away win</th><th class="n">Total p10 / p50 / p90</th><th class="n">Players in optimal (avg)</th><th class="n">Stack rate</th></tr></thead><tbody>
    ${ST.games.map(g=>{ const s=R.gstat[g.gi]; let pl=0, st=0, cnt=0; for(let i=0;i<R.N;i++){ if(R.opt[i*9]<0) continue; cnt++; let c=0; for(let k=0;k<9;k++) if(ST.players[R.opt[i*9+k]].gi===g.gi) c++; pl+=c; if(c>=3) st++; }
      return `<tr><td>${tdot(g.away)}${esc(g.away)} <span class="muted">@</span> ${tdot(g.home)}${esc(g.home)}</td><td class="small">${esc(g.time)}</td><td class="small" title="${esc(wxSummary(wxParams(Object.assign({roof:g.venue&&g.venue.roof},g.wx))))}">${wxShort(g)}</td><td class="n num">${fmt(g.implied[0])} - ${fmt(g.implied[1])}</td><td class="n num">${fmt(s.mean[0])} - ${fmt(s.mean[1])}</td><td class="n">${pct(s.w0,0)}</td><td class="n num">${fmt(s.tot[0],0)} / ${fmt(s.tot[1],0)} / ${fmt(s.tot[2],0)}</td><td class="n">${fmt(pl/cnt,2)}</td><td class="n">${pct(st/cnt,0)}</td></tr>`; }).join('')}</tbody></table></div></div>
    <div class="card" style="margin-top:16px"><h3>Defensive funnels</h3><p class="small muted">How offenses attack each defense this season, measured against what those offenses do against everyone else (${(MODEL.league.defMeta||{}).season||''} only, through week ${(MODEL.league.defMeta||{}).weeks||'?'}). Raw = what the defense has allowed so far; Applied = what the sim uses after shrinking for sample size (backtested on 2024 and 2025 with current-season data only). Pass defense quality is not split out: it did not predict anything out of sample beyond what the Vegas total already carries. Each team's points still match its implied total; the funnel moves the run/pass mix and how yards split between backs and receivers.</p>
    <div class="tw" style="border:0"><table><thead><tr><th>Offense</th><th>Facing</th><th class="n">Pass rate allowed vs norm (raw)</th><th class="n">Applied pass rate</th><th class="n">YPC allowed vs norm (raw)</th><th class="n">Applied YPC</th><th class="n">Sample</th><th>Lean</th></tr></thead><tbody>
    ${ST.games.flatMap(g=>[[g.away,g.home],[g.home,g.away]]).map(([o,d])=>{ const F=funnelOf(d); if(!F) return `<tr><td>${tdot(o)}${esc(o)}</td><td>${tdot(d)}${esc(d)} D</td><td colspan="6" class="muted small">No current-season data</td></tr>`;
      const sg=(v,dg)=>(v>=0?'+':'')+v.toFixed(dg);
      return `<tr><td>${tdot(o)}<b>${esc(o)}</b></td><td>${tdot(d)}${esc(d)} D</td><td class="n">${sg(F.raw,1)} pts</td><td class="n"><b>${sg(F.pp,1)} pts</b></td><td class="n">${sg(F.rawY,2)}</td><td class="n"><b>${sg(F.yp,2)}</b></td><td class="n small muted">${F.plays} plays · ${F.car} carries</td><td>${F.lab==='Neutral'?'<span class="muted small">Neutral</span>':`<span class="chip ${F.lab==='Pass funnel'?'ex':'ok'}">${F.lab}</span>`}</td></tr>`; }).join('')}</tbody></table></div></div>`;
}
function renderProj(){
  const el=$('#pane-proj'); const R=ST.res; if(!R) return; const P=ST.players; const own=hasOwn();
  const fP=ST.view.pos, fG=ST.view.game, fT=ST.view.team||'ALL'; const key=ST.view.projSort, dir=ST.view.projDir;
  let rows=P.map((p,j)=>({p,j,s:R.stats[j]})).filter(r=>r.p.active&&(fP==='ALL'||r.p.pos===fP)&&(fG==='ALL'||String(r.p.gi)===fG)&&(fT==='ALL'||r.p.team===fT)&&(r.s.mean>=0.5||r.s.opt>0));
  rows.forEach(r=>{ r.mean=r.s.mean; r.p10=r.s.pc[1]; r.p50=r.s.pc[5]; r.p90=r.s.pc[9]; r.p99=r.s.p99; r.val=r.s.mean/(r.p.salF/1000); r.optr=r.s.opt; r.sal=r.p.salF; r.own=r.p.own; r.lev=r.p.own!=null?r.s.opt-r.p.own:null; });
  rows.sort((a,b)=>dir*(((a[key]??-1e9))-((b[key]??-1e9))));
  const mx=(k)=>Math.max(...rows.map(r=>r[k]||0),1e-9);
  const M={mean:mx('mean'),p90:mx('p90'),val:mx('val'),optr:mx('optr'),p99:mx('p99')}; const CS={}; ['mean','p10','p50','p90','p99'].forEach(k=>CS[k]=colScale(rows.map(r=>r[k])));
  const sh=(k,l,t)=>`<th class="sort n psort" data-k="${k}" ${t?`title="${t}"`:''}>${l}${key===k?(dir<0?' ▾':' ▴'):''}</th>`;
  el.innerHTML=`<div class="row" style="justify-content:space-between;margin-bottom:8px"><div class="row small"><label>Position <select id="pPos">${['ALL',...POS].map(x=>`<option ${x===fP?'selected':''}>${x}</option>`).join('')}</select></label>
      <label>Team <select id="pTeam"><option value="ALL">All teams</option>${teamOpts(fT)}</select></label>
      <label>Game <select id="pGame"><option value="ALL">All games</option>${ST.games.map(g=>`<option value="${g.gi}" ${String(g.gi)===fG?'selected':''}>${esc(g.away)} @ ${esc(g.home)}</option>`).join('')}</select></label></div>
      <span class="small muted">${rows.length} players · optimal % = share of sims where the player is in that sim's top-scoring legal lineup</span></div>
    <div class="tw"><table><thead><tr><th>Player</th><th>Team</th>${sh('sal','Salary')}${sh('mean','Mean')}${sh('p10','p10')}${sh('p50','Median')}${sh('p90','p90')}${sh('p99','p99')}${sh('val','Pts/$1K')}${sh('optr','Optimal %')}${own?sh('own','Proj own')+sh('lev','Opt minus own','Optimal rate minus projected ownership'):''}</tr></thead><tbody>
    ${rows.map(r=>`<tr><td><button class="pname plink" data-pc="${r.j}">${esc(r.p.name)}</button><span class="pos">${r.p.pos}</span></td><td>${tdot(r.p.team)}${esc(r.p.team)} <span class="muted small">v ${esc(oppOf(r.p))}</span></td><td class="n">${r.sal.toLocaleString()}</td>
      <td class="n" ${CS.mean(r.mean)}><b>${fmt(r.mean)}</b></td><td class="n" ${CS.p10(r.p10)}>${fmt(r.p10)}</td><td class="n" ${CS.p50(r.p50)}>${fmt(r.p50)}</td><td class="n" ${CS.p90(r.p90)}>${fmt(r.p90)}</td><td class="n" ${CS.p99(r.p99)}>${fmt(r.p99)}</td><td class="n" ${heat(r.val,M.val,'--flex')}>${fmt(r.val,2)}</td><td class="n" ${heat(r.optr,M.optr,'--cpt')}><b>${pct(r.optr,1)}</b></td>
      ${own?`<td class="n">${r.own!=null?pct(r.own,1):'-'}</td><td class="n" style="${r.lev==null?'':`color:var(${r.lev>=0?'--good':'--bad'});font-weight:600`}">${r.lev==null?'-':(r.lev>=0?'+':'')+(r.lev*100).toFixed(1)}</td>`:''}</tr>`).join('')}</tbody></table></div>`;
  $('#pPos').onchange=(e)=>{ST.view.pos=e.target.value; renderProj();}; $('#pGame').onchange=(e)=>{ST.view.game=e.target.value; renderProj();}; $('#pTeam').onchange=(e)=>{ST.view.team=e.target.value; renderProj();};
  $$('th.psort',el).forEach(t=>t.onclick=()=>{ const k=t.dataset.k; if(ST.view.projSort===k) ST.view.projDir=-ST.view.projDir; else { ST.view.projSort=k; ST.view.projDir=-1; } renderProj(); });
}
/* stack shape of a lineup around its QB */
function stackInfo(L){ const P=ST.players; const q=L.find(j=>P[j].pos==='QB'); if(q==null) return {qb:-1,n:0,bb:0,rb:0}; const t=P[q].team, opp=oppOf(P[q]);
  let n=0,bb=0,rb=0; for(const j of L){ if(j===q) continue; const p=P[j]; if(p.team===t&&(p.pos==='WR'||p.pos==='TE')) n++; if(p.team===t&&p.pos==='RB') rb++; if(p.team===opp&&p.pos!=='DST') bb++; } return {qb:q,n,bb,rb}; }
function renderStacks(){
  const el=$('#pane-stacks'); const R=ST.res; if(!R) return; const P=ST.players;
  const by=new Map(); let tot=0; const shape=new Map();
  for(let i=0;i<R.N;i++){ if(R.opt[i*9]<0) continue; tot++; const L=Array.from(R.opt.subarray(i*9,i*9+9)); const s=stackInfo(L); if(s.qb<0) continue;
    let o=by.get(s.qb); if(!o){ o={j:s.qb,n:0,k:[0,0,0,0],bb:0,partners:new Map()}; by.set(s.qb,o); } o.n++; o.k[Math.min(3,s.n)]++; if(s.bb) o.bb++;
    const t=P[s.qb].team; L.forEach(j=>{ if(j!==s.qb&&P[j].team===t&&(P[j].pos==='WR'||P[j].pos==='TE')) o.partners.set(j,(o.partners.get(j)||0)+1); });
    const sk=`QB + ${Math.min(3,s.n)}${s.n>=3?'+':''} pass catcher${s.n===1?'':'s'}${s.bb?' + bring-back':''}`; shape.set(sk,(shape.get(sk)||0)+1); }
  const rows=Array.from(by.values()).sort((a,b)=>b.n-a.n);
  el.innerHTML=`<div class="grid2" style="grid-template-columns:minmax(0,3fr) minmax(0,2fr)"><div class="card"><h3>QB stacks in optimal lineups</h3><p class="small muted">For each QB: how often he is in the optimal lineup, and when he is, how many of his own pass catchers come with him and how often an opponent comes back.</p>
    <div class="tw" style="border:0"><table><thead><tr><th>QB</th><th class="n">Optimal %</th><th class="n">Naked</th><th class="n">+1</th><th class="n">+2</th><th class="n">+3</th><th class="n">Bring-back</th><th>Most common partners</th></tr></thead><tbody>
    ${rows.map(o=>`<tr><td>${tdot(P[o.j].team)}<button class="plink" data-pc="${o.j}">${esc(P[o.j].name)}</button> <span class="muted small">${esc(P[o.j].team)}</span></td><td class="n"><b>${pct(o.n/tot,1)}</b></td>${o.k.map(x=>`<td class="n">${pct(x/o.n,0)}</td>`).join('')}<td class="n">${pct(o.bb/o.n,0)}</td>
      <td class="small">${Array.from(o.partners.entries()).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([j,c])=>`<button class="plink" data-pc="${j}">${esc(P[j].name)}</button> ${pct(c/o.n,0)}`).join(' · ')}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="card"><h3>Stack shapes</h3><p class="small muted">Share of all optimal lineups.</p><table><thead><tr><th>Shape</th><th class="n">Share</th></tr></thead><tbody>${Array.from(shape.entries()).sort((a,b)=>b[1]-a[1]).map(([k,c])=>`<tr><td class="small">${esc(k)}</td><td class="n">${pct(c/tot,1)}</td></tr>`).join('')}</tbody></table></div></div>`;
}
/* ---------------- simulated contest field (for ROI) ----------------
   Field lineups are drawn from projected ownership (or, without an ownership file, an estimate from optimal rate),
   with typical field habits: QB plus 1-2 of his pass catchers most of the time, some bring-backs, salary $48,000-50,000.
   ROI uses a projected DK GPP payout curve (about 22% paid, min cash 2x fee, prize ~ C / rank) for the chosen contest size. */
function ownEst(){ const P=ST.players, R=ST.res; const tgt={QB:1,RB:2.35,WR:3.35,TE:1.3,DST:1};
  const w=P.map((p,j)=>p.active&&p.salF>0?(p.own!=null?p.own:Math.pow(R.stats[j].opt+0.002,0.75)):0);
  if(hasOwn()) return w; const sum={}; P.forEach((p,j)=>sum[p.pos]=(sum[p.pos]||0)+w[j]); return w.map((v,j)=>sum[P[j].pos]?v*tgt[P[j].pos]/sum[P[j].pos]:0); }
/* Field lineup: QB by ownership, 0-2 of his pass catchers, maybe a bring-back, the rest by ownership; then, like a user tweaking an
   optimizer build, swap unlocked players for higher-projected ones (picked by ownership) until the lineup reaches its target
   projection, drawn around 93% of the best possible projection. */
function buildField(F,vmax){
  const P=ST.players, w=ownEst(), Rn=E.makeRng(4242); const mu=ST.res.stats.map(s=>s.mean);
  // weighted samplers with cumulative sums (fast), keyed by position and by team+position
  const mk=(list)=>{ const c=new Float64Array(list.length); let t=0; list.forEach((j,k)=>{ t+=w[j]; c[k]=t; }); return {list,c,t}; };
  const by={}, byT={}; P.forEach((p,j)=>{ if(w[j]<=0) return; (by[p.pos]=by[p.pos]||[]).push(j); const k=p.team+'|'+p.pos; (byT[k]=byT[k]||[]).push(j); });
  const S={}; for(const k in by) S[k]=mk(by[k]); const ST2={}; for(const k in byT) ST2[k]=mk(byT[k]);
  const draw=(sm,excl)=>{ if(!sm||sm.t<=0) return -1; for(let a=0;a<12;a++){ const u=Rn()*sm.t; let lo=0,hi=sm.c.length-1; while(lo<hi){ const m=(lo+hi)>>1; if(sm.c[m]<u) lo=m+1; else hi=m; } const j=sm.list[lo]; if(!excl.has(j)) return j; } return -1; };
  const drawAny=(sms,excl)=>{ const t=sms.reduce((a,x)=>a+(x?x.t:0),0); if(t<=0) return -1; let u=Rn()*t; for(const x of sms){ if(!x) continue; if(u<x.t) return draw(x,excl); u-=x.t; } return -1; };
  const gauss=()=>{ let u=0; while(u===0) u=Rn(); return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*Rn()); };
  const out=new Int32Array(F*9); let n=0, tries=0;
  while(n<F&&tries<F*15){ tries++; const L=new Set(), lock=new Set(); const q=draw(S.QB,L); if(q<0) break; L.add(q); lock.add(q); const t=P[q].team, op=oppOf(P[q]);
    const ns=Rn()<0.18?0:Rn()<0.62?1:2; for(let k=0;k<ns;k++){ const j=drawAny([ST2[t+'|WR'],ST2[t+'|TE']],L); if(j>=0){ L.add(j); lock.add(j); } }
    if(Rn()<0.35){ const j=drawAny([ST2[op+'|WR'],ST2[op+'|TE'],ST2[op+'|RB']],L); if(j>=0){ L.add(j); lock.add(j); } }
    const cnt={QB:1,RB:0,WR:0,TE:0,DST:0}; for(const j of L) if(P[j].pos!=='QB') cnt[P[j].pos]++; if(cnt.WR>4||cnt.TE>2||(cnt.WR>3&&cnt.TE>1)) continue;
    let ok=true; for(const [pos,k] of [['RB',2],['WR',3],['TE',1]]) while(cnt[pos]<k){ const j=draw(S[pos],L); if(j<0){ok=false;break;} L.add(j); cnt[pos]++; }
    if(!ok) continue; if(L.size<8){ const opts=[cnt.RB<3?S.RB:null,cnt.WR<4?S.WR:null,cnt.TE<2?S.TE:null]; const j=drawAny(opts,L); if(j<0) continue; L.add(j); }
    if(L.size!==8) continue; const d=draw(S.DST,L); if(d<0) continue; L.add(d);
    const arr=Array.from(L); let sal=0, pj=0; for(const j of arr){ sal+=P[j].salF; pj+=mu[j]; }
    const target=vmax?vmax*Math.max(0.84,Math.min(0.99,SHARP[0]+SHARP[1]*gauss())):0;
    for(let it=0;it<90&&(sal>50000||(vmax&&pj<target));it++){ const k=Math.floor(Rn()*9), a=arr[k]; if(lock.has(a)) continue; const cand=draw(S[P[a].pos],L); if(cand<0) continue;
      const ns2=sal-P[a].salF+P[cand].salF, np=pj-mu[a]+mu[cand]; if(!(sal>50000?ns2<sal:(ns2<=50000&&np>pj))) continue; L.delete(a); L.add(cand); arr[k]=cand; sal=ns2; pj=np; }
    if(sal>50000||sal<47500) continue; if(vmax&&pj<target*0.97) continue;
    out.set(arr,n*9); n++; }
  return out.subarray(0,n*9);
}
const SHARP=[0.93,0.025];
function payCurve(M,fee){ const HN=(x)=>x<1?0:Math.log(x)+0.5772+1/(2*x); const pool=M*fee*0.85, Pd=Math.max(1,Math.round(0.22*M)); let mc=2*fee; if(Pd*mc>pool*0.6) mc=pool*0.6/Pd;
  const tot=(C)=>{const Rs=Math.min(Pd,Math.floor(C/mc)); return C*HN(Rs)+(Pd-Rs)*mc;}; let lo=mc,hi=pool; for(let it=0;it<60;it++){const mid=(lo+hi)/2; if(tot(mid)>pool) hi=mid; else lo=mid;} const C=(lo+hi)/2;
  const pre=new Float64Array(Pd+1); for(let r=1;r<=Pd;r++) pre[r]=pre[r-1]+Math.max(mc,C/r);
  const f=(rank)=>rank>Pd?0:Math.max(mc,C/Math.max(1,rank));
  f.avg=(lo,hi)=>{ lo=Math.max(1,Math.floor(lo)); hi=Math.max(lo,Math.floor(hi)); if(lo>Pd) return 0; const h=Math.min(hi,Pd); return (pre[h]-pre[lo-1])/(hi-lo+1); };
  return f; }
/* per-sim sorted field scores on a sample of sims; returns an ROI function for any lineup */
async function contestModel(M,prog){
  const R=ST.res; const key=M+'|'+(hasOwn()?'own':'est'); if(ST.cm&&ST.cm.key===key&&ST.cm.res===R) return ST.cm;
  const mu=R.stats.map(s=>s.mean); makeWorkers(); const pos=ST.players.map(p=>p.active&&p.salF>0?PCODE[p.pos]:-1), sal=ST.players.map(p=>p.salF);
  const vo=await call(workers[0],{type:'opt',pts:Float32Array.from(mu),nT:R.n,n:1,pos,sal,meta:null,rules:null}); let vmax=0; for(let q=0;q<9;q++) if(vo.opt[q]>=0) vmax+=mu[vo.opt[q]];
  // bigger contests need a bigger field sample to tell 1st from 500th: aim for about 50 real entries per sampled lineup, 2,000 to 20,000 lineups
  const want=Math.max(2000,Math.min(20000,Math.round(M/50)));
  let FL=buildField(want,vmax); if(FL.length/9<want*0.4) FL=buildField(want,vmax*0.95); if(FL.length/9<300) FL=buildField(want,0);
  const nF=FL.length/9, S=Math.min(R.N,nF>6000?1500:2500), n=R.n; const sims=new Int32Array(S); for(let k=0;k<S;k++) sims[k]=Math.floor(k*R.N/S);
  // per sim keep the top K field scores exactly (descending) plus 201 quantiles of the rest
  const K=Math.min(nF,1000), NQ=201; const top=new Float32Array(S*K), qs=new Float32Array(S*NQ), tmp=new Float32Array(nF);
  for(let k=0;k<S;k++){ const o=sims[k]*n; for(let u=0;u<nF;u++){ let v=0; const b=u*9; for(let q=0;q<9;q++) v+=R.pts[o+FL[b+q]]; tmp[u]=v; } tmp.sort();
    for(let a=0;a<K;a++) top[k*K+a]=tmp[nF-1-a]; for(let a=0;a<NQ;a++) qs[k*NQ+a]=tmp[Math.min(nF-1,Math.round(a*(nF-1)/(NQ-1)))];
    if(prog&&k%100===99){ prog(k/S); await new Promise(r=>setTimeout(r,0)); } }
  const pay=payCurve(M,1); const capR=Math.max(1,Math.round(M*0.0005)), capPay=pay(capR); const bw=M/nF;
  const aboveOf=(k,x)=>{ const b=k*K; if(x>=top[b+K-1]){ let lo=0,hi=K; while(lo<hi){ const m=(lo+hi)>>1; if(top[b+m]>x) lo=m+1; else hi=m; } return lo; } // exact among the top K
    const qb=k*NQ; let lo=0,hi=NQ-1; while(lo<hi){ const m=(lo+hi)>>1; if(qs[qb+m]<=x) lo=m+1; else hi=m; } const a=Math.max(1,lo); const f=(a-1+(x-qs[qb+a-1])/Math.max(1e-6,qs[qb+a]-qs[qb+a-1]))/(NQ-1); return Math.max(K,Math.round((1-Math.min(1,Math.max(0,f)))*nF)); };
  const payAt=(k,x)=>{ const above=aboveOf(k,x);
    if(above===0&&bw>1){ // beat every sampled field lineup: place it within the top bucket from its margin over the best, using an exponential tail fit to the field's top 20
      const xm=top[k*K], x20=top[k*K+Math.min(K-1,19)], beta=Math.max(0.5,(xm-x20)/Math.log(20)); const r=Math.max(1,Math.min(bw,bw*Math.exp(-(x-xm)/beta))); return pay.avg(Math.max(1,r*0.5),Math.max(1,r*1.5)); }
    return pay.avg(above*bw+1,(above+1)*bw); };
  const roi=(L,both)=>{ let s=0, sc=0, sb=0; for(let k=0;k<S;k++){ const o=sims[k]*n; let x=0; for(let q=0;q<9;q++) x+=R.pts[o+L[q]]; const py=payAt(k,x); s+=py; if(k&1) sb+=py; else sc+=Math.min(capPay,py); }
    const h=S>>1; return both?{roi:s/S-1,roiC:sc/(S-h)-1,roiOut:sb/h-1}:s/S-1; };
  ST.cm={key,res:R,roi,S,nF,M,capR}; return ST.cm;
}
/* ---------------- players: optimal stats, lineup-mates, ROI, percentile strip ---------------- */
async function renderPlayers(){
  const el=$('#pane-lineups'); const R=ST.res; if(!R) return; const P=ST.players, n=R.n; const M=ST.contestSize||store.get('csize',20000);
  const tok=ST.plTok=(ST.plTok||0)+1; const stale=()=>tok!==ST.plTok;
  if(!R.mates){ const mates=new Map(); const cnt=new Float64Array(n); for(let i=0;i<R.N;i++){ if(R.opt[i*9]<0) continue; for(let a=0;a<9;a++){ const x=R.opt[i*9+a]; cnt[x]++; let m=mates.get(x); if(!m){ m=new Map(); mates.set(x,m);} for(let b=0;b<9;b++) if(b!==a){ const y=R.opt[i*9+b]; m.set(y,(m.get(y)||0)+1); } } } R.mates=mates; R.optCnt=cnt; }
  if(!R.proi||R.proiM!==M||R.proiOwn!==hasOwn()){
    el.innerHTML='<p class="note" id="plNote">Simulating a contest field to price ROI…</p>'; const cm=await contestModel(M,(f)=>{ const e=$('#plNote'); if(e) e.textContent=`Simulating a contest field to price ROI… ${Math.round(f*100)}%`; });
    const pool=[]; for(let i=0;i<R.N&&pool.length<1500;i+=Math.max(1,Math.floor(R.N/1500))) if(R.opt[i*9]>=0) pool.push(Array.from(R.opt.subarray(i*9,i*9+9)));
    const sum=new Float64Array(n), c=new Float64Array(n);
    for(let k=0;k<pool.length;k++){ const r=cm.roi(pool[k]); pool[k].forEach(j=>{ sum[j]+=r; c[j]++; }); if(k%100===99){ const e=$('#plNote'); if(e) e.textContent=`Pricing sim-optimal lineups in the contest… ${Math.round(100*k/pool.length)}%`; await new Promise(r=>setTimeout(r,0)); if(stale()) return; } }
    if(stale()) return; R.proi=Array.from(sum,(v,j)=>c[j]>=3?v/c[j]:null); R.proiN=c; R.proiM=M; R.proiOwn=hasOwn(); }
  const rows=P.map((p,j)=>({p,j,s:R.stats[j]})).filter(r=>r.p.active&&r.s.opt>0).sort((a,b)=>b.s.opt-a.s.opt);
  const mx=Math.max(...rows.map(r=>r.s.pc[9]),10);
  const strip=(p,s)=>{ const W=220,H=18, x=(v)=>4+(W-8)*Math.max(0,Math.min(1,v/mx)); const tc=`t-${esc(TEAM_ALIAS[p.team]||p.team)}`;
    return `<svg class="${tc}" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="10th to 90th percentile ${fmt(s.pc[1])} to ${fmt(s.pc[9])}"><line x1="${x(s.pc[0])}" x2="${x(s.pc[10]>mx?mx:s.pc[10])}" y1="9" y2="9" stroke="var(--line)"/><rect x="${x(s.pc[1])}" y="4" width="${Math.max(1,x(s.pc[9])-x(s.pc[1]))}" height="10" rx="2" fill="var(--tc)" opacity="0.28"/><rect x="${x(s.pc[3])}" y="4" width="${Math.max(1,x(s.pc[7])-x(s.pc[3]))}" height="10" rx="2" fill="var(--tc)" opacity="0.6"/><line x1="${x(s.pc[5])}" x2="${x(s.pc[5])}" y1="2" y2="16" stroke="var(--ink)" stroke-width="2"/><circle cx="${x(s.mean)}" cy="9" r="2.5" fill="var(--panel)" stroke="var(--ink)"/></svg>`; };
  const mate=(j)=>{ const m=R.mates.get(j); if(!m) return ''; return Array.from(m.entries()).sort((a,b)=>b[1]-a[1]).slice(0,2).map(([k,c])=>`<button class="plink" data-pc="${k}">${esc(P[k].name)}</button> <span class="muted">${pct(c/R.optCnt[j],0)}</span>`).join(' · '); };
  const own=hasOwn();
  el.innerHTML=`<div class="card"><h3>Player optimals</h3><p class="small muted">Optimal % = share of sims where the player is in that sim's best legal lineup. Lineup-mates = who he most often shares those optimal lineups with. Avg ROI = average expected ROI of the sim-optimal lineups he appears in, priced against a simulated ${M.toLocaleString()}-entry field built from ${own?'your projected ownership':'an ownership estimate (load an ownership file for a real one)'}. (${ST.cm?ST.cm.nF.toLocaleString():'?'} field lineups priced over ${ST.cm?ST.cm.S.toLocaleString():'?'} sims.) Chart: light band 10th-90th percentile, dark band 30th-70th, tick = median, dot = mean, line = min to max (scale 0 to ${fmt(mx,0)}).</p>
    <div class="row small" style="margin-bottom:8px"><label>Contest size for ROI <input id="plM" type="number" step="1000" min="100" value="${M}" style="width:90px"></label></div>
    <div class="tw" style="border:0"><table><thead><tr><th>Player</th><th>Team</th><th class="n">Salary</th><th class="n">Mean</th><th class="n">Optimal %</th>${own?'<th class="n">Proj own</th>':''}<th class="n">Avg ROI</th><th>Most common lineup-mates</th><th class="nosortcol">Percentiles</th></tr></thead><tbody>
    ${rows.map(r=>{ const ro=R.proi[r.j]; return `<tr><td><button class="pname plink" data-pc="${r.j}">${esc(r.p.name)}</button><span class="pos">${r.p.pos}</span></td><td>${tdot(r.p.team)}${esc(r.p.team)}</td><td class="n">${r.p.salF.toLocaleString()}</td><td class="n">${fmt(r.s.mean)}</td><td class="n"><b>${pct(r.s.opt,1)}</b></td>${own?`<td class="n">${r.p.own!=null?pct(r.p.own,1):'-'}</td>`:''}
      <td class="n" style="${ro==null?'':`color:var(${ro>=0?'--good':'--bad'});font-weight:600`}">${ro==null?'-':(ro>=0?'+':'')+(ro*100).toFixed(0)+'%'}</td><td class="small">${mate(r.j)}</td><td>${strip(r.p,r.s)}</td></tr>`; }).join('')}</tbody></table></div></div>`;
  $('#plM').onchange=(e)=>{ ST.contestSize=Math.max(100,+e.target.value||20000); store.set('csize',ST.contestSize); renderPlayers(); };
}
/* ---------------- compare: two players head to head, from the same sims (so correlation is real) ---------------- */
function renderCompare(){
  const el=$('#pane-cmp'); const R=ST.res; if(!el||!R) return; const P=ST.players, n=R.n, N=R.N, nG=ST.games.length;
  const pool=P.map((p,j)=>j).filter(j=>P[j].active&&(R.stats[j].mean>=0.3||R.stats[j].opt>0)).sort((a,b)=>R.stats[b].mean-R.stats[a].mean);
  if(pool.length<2){ el.innerHTML='<p class="note">Not enough active players.</p>'; return; }
  const lab=(j)=>`${P[j].name} · ${P[j].pos} ${P[j].team} · $${P[j].salF.toLocaleString()}`;
  const byLab=new Map(pool.map(j=>[lab(j),j])); const key=(j)=>P[j].name+'|'+P[j].team; const find=(k)=>k?P.findIndex(p=>p.name+'|'+p.team===k):-1;
  let A=find(ST.view.cmpA), B=find(ST.view.cmpB);
  if(!pool.includes(A)) A=pool.find(j=>P[j].pos==='RB')??pool[0];
  if(!pool.includes(B)||B===A) B=pool.find(j=>j!==A&&P[j].pos===P[A].pos)??pool.find(j=>j!==A);
  ST.view.cmpA=key(A); ST.view.cmpB=key(B);
  // slate value rate: what sim-optimal lineups score per $1K (what saved salary is worth elsewhere in a lineup)
  // value of salary: slope of sim mean on salary across active skill players (what each extra $1K buys on this slate)
  if(R.optRate==null){ let sx=0,sy=0,sxx=0,sxy=0,k=0; P.forEach((p,j)=>{ if(!p.active||!['QB','RB','WR','TE'].includes(p.pos)||R.stats[j].mean<1) return; const x=p.salF/1000, y=R.stats[j].mean; sx+=x; sy+=y; sxx+=x*x; sxy+=x*y; k++; });
    const sl=k>5?(k*sxy-sx*sy)/(k*sxx-sx*sx):3; R.optRate=Math.round(10*Math.max(0.5,Math.min(6,sl)))/10; }
  const rate=ST.view.cmpRate??R.optRate;
  const side=(j)=>P[j].team===ST.games[P[j].gi].away?0:1;
  const a=new Float32Array(N), b=new Float32Array(N), ta=new Float32Array(N); const gA=P[A].gi, sA=side(A);
  for(let i=0;i<N;i++){ a[i]=R.pts[i*n+A]; b[i]=R.pts[i*n+B]; ta[i]=R.sc[(i*nG+gA)*2+sA]; }
  const gap=(P[A].salF-P[B].salF)/1000, need=gap*rate; // A must outscore B by this to pay for his extra salary (negative = A is cheaper)
  let wA=0, tie=0, wAdj=0, ma=0, mb=0, oA=0, oB=0, oAB=0; for(let i=0;i<N;i++){ ma+=a[i]; mb+=b[i]; } ma/=N; mb/=N;
  let cab=0, va=0, vb=0; const taS=Float32Array.from(ta).sort(), tMed=taS[N>>1]; let hiN=0, hiW=0, loN=0, loW=0;
  for(let i=0;i<N;i++){ const d=a[i]-b[i]; if(d>0) wA++; else if(d===0) tie++; if(d>need) wAdj++; else if(d===need) wAdj+=0.5;
    cab+=(a[i]-ma)*(b[i]-mb); va+=(a[i]-ma)**2; vb+=(b[i]-mb)**2;
    if(ta[i]>tMed){ hiN++; if(d>0) hiW++; else if(d===0) hiW+=0.5; } else { loN++; if(d>0) loW++; else if(d===0) loW+=0.5; }
    if(R.opt[i*9]>=0){ let ia=false, ib=false; for(let q=0;q<9;q++){ const x=R.opt[i*9+q]; if(x===A) ia=true; else if(x===B) ib=true; } if(ia) oA++; if(ib) oB++; if(ia&&ib) oAB++; } }
  const pA=(wA+tie/2)/N, pAdj=wAdj/N, corr=cab/Math.sqrt(va*vb||1);
  const sa=R.stats[A], sb=R.stats[B]; const hit=(c,t)=>{ let k=0; for(let i=0;i<N;i++) if(c[i]>=t) k++; return k/N; };
  const x3=(j,c,m)=>hit(c,m*P[j].salF/1000);
  const implied=(j)=>ST.games[P[j].gi].implied[side(j)], simTm=(j)=>R.gstat[P[j].gi].mean[side(j)];
  const own=hasOwn(); const roi=R.proi||null;
  const rows=[
    ['Salary',P[A].salF,P[B].salF,v=>'$'+v.toLocaleString(),'lo'],
    ['Mean',sa.mean,sb.mean,v=>fmt(v),'hi'],['Median',sa.pc[5],sb.pc[5],v=>fmt(v),'hi'],
    ['Floor (10th pct)',sa.pc[1],sb.pc[1],v=>fmt(v),'hi'],['20th pct',sa.pc[2],sb.pc[2],v=>fmt(v),'hi'],
    ['80th pct',sa.pc[8],sb.pc[8],v=>fmt(v),'hi'],['Ceiling (90th pct)',sa.pc[9],sb.pc[9],v=>fmt(v),'hi'],['99th pct',sa.p99,sb.p99,v=>fmt(v),'hi'],
    ['Pts per $1K',sa.mean/(P[A].salF/1000),sb.mean/(P[B].salF/1000),v=>fmt(v,2),'hi'],
    ['Hits 3x salary',x3(A,a,3),x3(B,b,3),v=>pct(v,1),'hi'],['Hits 4x salary',x3(A,a,4),x3(B,b,4),v=>pct(v,1),'hi'],['Hits 5x salary',x3(A,a,5),x3(B,b,5),v=>pct(v,1),'hi'],
    ['20+ pts',hit(a,20),hit(b,20),v=>pct(v,1),'hi'],['30+ pts',hit(a,30),hit(b,30),v=>pct(v,1),'hi'],
    ['Optimal %',sa.opt,sb.opt,v=>pct(v,1),'hi'],
    ...(own?[['Proj own',P[A].own,P[B].own,v=>v==null?'-':pct(v,1),null],['Optimal minus own',P[A].own!=null?sa.opt-P[A].own:null,P[B].own!=null?sb.opt-P[B].own:null,v=>v==null?'-':(v>=0?'+':'')+(v*100).toFixed(1),'hi']]:[]),
    ['Avg ROI of his optimal lineups',roi?roi[A]:null,roi?roi[B]:null,v=>v==null?'-':(v>=0?'+':'')+(v*100).toFixed(0)+'%','hi'],
    ...(['QB','RB','WR','TE'].includes(P[A].pos)||['QB','RB','WR','TE'].includes(P[B].pos)?[
      ['Run share',P[A].rs,P[B].rs,v=>v==null?'-':pct(v,1),'hi'],['Target share',P[A].pos==='QB'?null:P[A].ts,P[B].pos==='QB'?null:P[B].ts,v=>v==null?'-':pct(v,1),'hi'],
      ['RZ run share',P[A].rsz,P[B].rsz,v=>v==null?'-':pct(v,1),'hi'],['RZ target share',P[A].pos==='QB'?null:P[A].tsz,P[B].pos==='QB'?null:P[B].tsz,v=>v==null?'-':pct(v,1),'hi']]:[]),
    ['Team implied total',implied(A),implied(B),v=>fmt(v,2),'hi'],['Team sim mean',simTm(A),simTm(B),v=>fmt(v),'hi']];
  const good='style="background:color-mix(in srgb, var(--good) 22%, var(--panel));font-weight:700"';
  const tr=([l,x,y,f,dir])=>{ const ok=x!=null&&y!=null&&isFinite(x)&&isFinite(y)&&dir&&Math.abs(x-y)>1e-9; const aw=ok&&(dir==='hi'?x>y:x<y), bw=ok&&!aw;
    const d=ok||(x!=null&&y!=null&&!dir)?(x-y):null; const df=d==null?'':(l==='Salary'?(d>=0?'+$':'-$')+Math.abs(d).toLocaleString():/%|own|Hits|pts$|share|ROI/i.test(l)&&!/Pts per/.test(l)?(d>=0?'+':'')+(d*100).toFixed(1):(d>=0?'+':'')+fmt(d,/Pts per|implied/.test(l)?2:1));
    return `<tr><td>${l}</td><td class="n" ${aw?good:''}>${f(x)}</td><td class="n" ${bw?good:''}>${f(y)}</td><td class="n muted">${df}</td></tr>`; };
  // charts
  const C={a:'var(--flex)',b:'var(--cpt)'};
  const lo=Math.min(sa.pc[0],sb.pc[0],0), hi=Math.max(sa.p99,sb.p99)*1.08+1, NB=48, bw=(hi-lo)/NB;
  const hist=(c)=>{ const h=new Float64Array(NB); for(let i=0;i<N;i++){ const k=Math.floor((c[i]-lo)/bw); if(k>=0&&k<NB) h[k]++; } const s=new Float64Array(NB); for(let k=0;k<NB;k++){ let t=0,w=0; for(let d=-2;d<=2;d++){ const kk=k+d; if(kk<0||kk>=NB) continue; const ww=3-Math.abs(d); t+=h[kk]*ww; w+=ww; } s[k]=t/w/N; } return s; };
  const hA=hist(a), hB=hist(b), hm=Math.max(...hA,...hB)||1, W=640, H=210, pl=34, pb=24, X=(v)=>pl+(W-pl-8)*(v-lo)/(hi-lo), Y=(v)=>H-pb-(H-pb-10)*v/hm;
  const path=(h)=>{ let d=`M${X(lo)},${Y(0)}`; for(let k=0;k<NB;k++) d+=` L${X(lo+(k+0.5)*bw).toFixed(1)},${Y(h[k]).toFixed(1)}`; return d+` L${X(hi)},${Y(0)} Z`; };
  const ticks=[]; const st=hi-lo>60?10:5; for(let t=Math.ceil(lo/st)*st;t<=hi;t+=st) ticks.push(t);
  const dens=`<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px" role="img" aria-label="Score distributions">
    ${ticks.map(t=>`<line x1="${X(t)}" x2="${X(t)}" y1="10" y2="${H-pb}" stroke="var(--line)" stroke-width="0.6"/><text x="${X(t)}" y="${H-8}" text-anchor="middle" font-size="10" fill="var(--muted)" font-family="var(--f-data)">${t}</text>`).join('')}
    <path d="${path(hA)}" fill="${C.a}" fill-opacity="0.22" stroke="${C.a}" stroke-width="1.6"/><path d="${path(hB)}" fill="${C.b}" fill-opacity="0.22" stroke="${C.b}" stroke-width="1.6"/>
    <line x1="${X(ma)}" x2="${X(ma)}" y1="10" y2="${H-pb}" stroke="${C.a}" stroke-dasharray="4 3" stroke-width="1.4"/><line x1="${X(mb)}" x2="${X(mb)}" y1="10" y2="${H-pb}" stroke="${C.b}" stroke-dasharray="4 3" stroke-width="1.4"/>
    <text x="${W-10}" y="22" text-anchor="end" font-size="11" fill="var(--muted)">FPTS (dashed = mean)</text></svg>`;
  const S=300, sp=28, mxs=Math.max(sa.p99,sb.p99)*1.05+1, mns=Math.min(sa.pc[0],sb.pc[0],0), XS=(v)=>sp+(S-sp-6)*(Math.min(mxs,v)-mns)/(mxs-mns), YS=(v)=>S-sp-(S-sp-6)*(Math.min(mxs,v)-mns)/(mxs-mns);
  let dots=''; const stp=Math.max(1,Math.floor(N/1400)); for(let i=0;i<N;i+=stp) dots+=`<circle cx="${XS(a[i]).toFixed(1)}" cy="${YS(b[i]).toFixed(1)}" r="1.7"/>`;
  const sct=`<svg viewBox="0 0 ${S} ${S}" width="100%" style="max-width:${S}px" role="img" aria-label="Sim by sim scores">
    <line x1="${XS(mns)}" y1="${YS(mns)}" x2="${XS(mxs)}" y2="${YS(mxs)}" stroke="var(--ink)" stroke-width="1" stroke-dasharray="3 3"/>
    <g fill="var(--accent)" fill-opacity="0.35">${dots}</g>
    <text x="${S-8}" y="${S-sp+16}" text-anchor="end" font-size="10" fill="${C.a}" font-weight="600">${esc(P[A].name)} →</text>
    <text x="10" y="14" font-size="10" fill="${C.b}" font-weight="600">↑ ${esc(P[B].name)}</text>
</svg>`;
  const lad=['Min','10','20','30','40','50','60','70','80','90','Max'].map((l,k)=>{ const x=sa.pc[k], y=sb.pc[k], d=x-y; return `<tr><td>${l}</td><td class="n" ${d>0.05?good:''}>${fmt(x)}</td><td class="n" ${d<-0.05?good:''}>${fmt(y)}</td><td class="n" style="color:var(${d>=0?'--flex':'--cpt'})">${d>=0?'+':''}${fmt(d)}</td></tr>`; }).join('');
  const card=(j,c)=>{ const p=P[j], g=ST.games[p.gi]; const st=p.status?` <span class="chip ${SL.INACTIVE.has(p.status.toUpperCase())?'bad':'ex'}">${esc(p.status)}</span>`:'';
    return `<div class="card" style="border-top:3px solid ${c}"><div class="row" style="justify-content:space-between"><h3 style="margin:0">${tdot(p.team)}<button class="pname plink" data-pc="${j}" style="font-size:18px">${esc(p.name)}</button><span class="pos">${p.pos}</span>${st}</h3><b class="num">$${p.salF.toLocaleString()}</b></div>
      <p class="small muted" style="margin:6px 0 0">${esc(p.team)} ${side(j)?'vs':'@'} ${esc(oppOf(p))} · ${esc(g.time)} · team implied ${fmt(implied(j),2)}${own&&p.own!=null?' · proj own '+pct(p.own,1):''}</p></div>`; };
  const ac=(id,j)=>`<input id="${id}" list="cmpList" value="${esc(lab(j))}" style="width:340px;max-width:100%" aria-label="Player" autocomplete="off">`;
  const verdict=(l,v,sub)=>`<div><span class="lbl">${l}</span><b class="num" style="font-size:22px"><span style="color:${C.a}">${pct(v,0)}</span> <span class="muted" style="font-size:14px">vs</span> <span style="color:${C.b}">${pct(1-v,0)}</span></b><span class="small muted">${sub}</span></div>`;
  const cheap=gap>0?P[B].name:P[A].name, rich=gap>0?P[A].name:P[B].name;
  el.innerHTML=`<div class="card"><div class="row" style="gap:12px;align-items:flex-end"><label class="small" style="display:grid;gap:4px"><span style="color:${C.a};font-weight:700">Player A</span>${ac('cmpA',A)}</label>
      <button id="cmpSwap" class="small" title="Swap A and B">⇄ Swap</button><label class="small" style="display:grid;gap:4px"><span style="color:${C.b};font-weight:700">Player B</span>${ac('cmpB',B)}</label>
      <label class="small" style="display:grid;gap:4px" title="What $1K of salary buys elsewhere in a lineup. Default = this slate\'s salary slope: how many more sim points each extra $1K of salary gets you across active players">Pts per $1K saved<input id="cmpRate" type="number" step="0.1" min="0" value="${rate}" style="width:80px"></label>
      <datalist id="cmpList">${pool.map(j=>`<option value="${esc(lab(j))}"></option>`).join('')}</datalist></div>
      <p class="small muted" style="margin:8px 0 0">Type to search any active player. Every number comes from the same ${N.toLocaleString()} slate sims, so teammates and game stacks keep their real correlation.</p></div>
    <div class="grid2" style="margin-top:14px">${card(A,C.a)}${card(B,C.b)}</div>
    <div class="card kpis" style="margin-top:14px;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px">
      ${verdict('Outscores the other',pA,'raw points, same sim')}
      ${verdict('Outscores, salary adjusted',pAdj,Math.abs(gap)<0.05?'same salary':`${esc(rich)} must win by ${fmt(Math.abs(need))} pts to cover the $${Math.abs(gap*1000).toLocaleString()} saved by ${esc(cheap)}`)}
      ${verdict('Wins when A\'s team scores above its median',hiN?hiW/hiN:0.5,`below its median: ${pct(loN?loW/loN:0.5,0)} vs ${pct(loN?1-loW/loN:0.5,0)}`)}
      <div><span class="lbl">Correlation</span><b class="num" style="font-size:22px">${(corr>=0?'+':'')+corr.toFixed(2)}</b><span class="small muted">${corr>0.25?'rise and fall together (stackable)':corr<-0.1?'compete for the same work':'mostly independent'}</span></div>
      <div><span class="lbl">Both in the optimal</span><b class="num" style="font-size:22px">${pct(oAB/N,1)}</b><span class="small muted">${oA?`when A is optimal, B is too ${pct(oAB/oA,0)}`:'A never optimal'}</span></div></div>
    <div class="grid2" style="margin-top:14px;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr)">
      <div class="card"><h3>Side by side</h3><p class="small muted">Green = the better number. Diff is A minus B.</p><div class="tw" style="border:0"><table class="nosort"><thead><tr><th>Stat</th><th class="n" style="color:${C.a}">${esc(P[A].name)}</th><th class="n" style="color:${C.b}">${esc(P[B].name)}</th><th class="n">Diff</th></tr></thead><tbody>${rows.map(tr).join('')}</tbody></table></div>
        ${roi?'':'<p class="small muted">Avg ROI fills in once the Player optimals tab has priced the contest. <button id="cmpRoi" class="small">Price it now</button></p>'}</div>
      <div style="display:grid;gap:14px;align-content:start">
        <div class="card"><h3>Score distributions</h3><p class="small"><span style="color:${C.a};font-weight:700">■ ${esc(P[A].name)}</span> &nbsp; <span style="color:${C.b};font-weight:700">■ ${esc(P[B].name)}</span></p>${dens}</div>
        <div class="grid2"><div class="card"><h3>Sim by sim</h3><p class="small muted">Each dot is one sim. Below the dashed line = A scored more (<b style="color:${C.a}">${pct(pA,0)}</b> of sims), above = B (<b style="color:${C.b}">${pct(1-pA,0)}</b>).</p>${sct}</div>
          <div class="card"><h3>Percentile ladder</h3><div class="tw" style="border:0"><table class="nosort"><thead><tr><th>Pct</th><th class="n" style="color:${C.a}">A</th><th class="n" style="color:${C.b}">B</th><th class="n">A minus B</th></tr></thead><tbody>${lad}</tbody></table></div></div></div></div></div>`;
  const pick=(id,which)=>{ const i=$('#'+id,el); i.onchange=()=>{ const j=byLab.get(i.value); if(j==null){ const q=i.value.trim().toLowerCase(); const m=pool.find(x=>P[x].name.toLowerCase().includes(q)); if(m==null){ toast('No matching player'); return; } ST.view[which]=key(m); } else ST.view[which]=key(j); renderCompare(); }; i.onfocus=()=>i.select(); };
  pick('cmpA','cmpA'); pick('cmpB','cmpB');
  $('#cmpSwap',el).onclick=()=>{ const t=ST.view.cmpA; ST.view.cmpA=ST.view.cmpB; ST.view.cmpB=t; renderCompare(); };
  $('#cmpRate',el).onchange=(e)=>{ const v=parseFloat(e.target.value); ST.view.cmpRate=isFinite(v)&&v>=0?v:null; renderCompare(); };
  const pr=$('#cmpRoi',el); if(pr) pr.onclick=async()=>{ pr.disabled=true; pr.textContent='Pricing…'; await renderPlayers(); renderCompare(); };
}
/* ---------------- ownership ---------------- */

/* ---------------- roles: set a player's usage from a league role profile ----------------
   For players with no data (or a new role) when there is official word on how they will be used. Each profile is the median usage of
   players in the model who fill that role (2024-26 shares): e.g. "Lead back" = backs with 55%+ of designed runs. Shares are a starting
   point you can still edit. When any player at a position on a team has a role set, that team's position group is taken as you set it:
   work from players out is not redistributed on top of it. */
const ROLES={"RB_lead": {"pos": "RB", "label": "Lead back / workhorse", "rs": 0.691, "ts": 0.109, "rsz": 0.677, "tsz": 0.1, "rsy": 0.606, "tpd": 0.091}, "RB_1a": {"pos": "RB", "label": "1A in a split backfield", "rs": 0.45, "ts": 0.071, "rsz": 0.456, "tsz": 0.061, "rsy": 0.415, "tpd": 0.062}, "RB_early": {"pos": "RB", "label": "Early-down back, split carries", "rs": 0.41, "ts": 0.053, "rsz": 0.409, "tsz": 0.048, "rsy": 0.329, "tpd": 0.026}, "RB_1b": {"pos": "RB", "label": "1B / committee back", "rs": 0.277, "ts": 0.034, "rsz": 0.28, "tsz": 0.031, "rsy": 0.24, "tpd": 0.031}, "RB_pass": {"pos": "RB", "label": "Passing-down back", "rs": 0.185, "ts": 0.082, "rsz": 0.161, "tsz": 0.074, "rsy": 0.187, "tpd": 0.096}, "RB_power": {"pos": "RB", "label": "Short-yardage / power back / FB", "rs": 0.101, "ts": 0.006, "rsz": 0.099, "tsz": 0.006, "rsy": 0.21, "tpd": 0.003}, "RB_depth": {"pos": "RB", "label": "Depth (spot carries)", "rs": 0.061, "ts": 0.029, "rsz": 0.057, "tsz": 0.026, "rsy": 0.06, "tpd": 0.033}, "WR_1": {"pos": "WR", "label": "WR1", "rs": 0.001, "ts": 0.262, "rsz": 0.001, "tsz": 0.269, "rsy": 0.001, "tpd": 0.262}, "WR_2": {"pos": "WR", "label": "WR2", "rs": 0.002, "ts": 0.191, "rsz": 0.003, "tsz": 0.191, "rsy": 0.001, "tpd": 0.191}, "WR_3": {"pos": "WR", "label": "WR3 / slot", "rs": 0.0, "ts": 0.125, "rsz": 0.0, "tsz": 0.117, "rsy": 0.0, "tpd": 0.125}, "WR_4": {"pos": "WR", "label": "WR4 / rotational", "rs": 0.0, "ts": 0.065, "rsz": 0.0, "tsz": 0.069, "rsy": 0.0, "tpd": 0.065}, "WR_gadget": {"pos": "WR", "label": "Gadget (some designed runs)", "rs": 0.042, "ts": 0.137, "rsz": 0.035, "tsz": 0.14, "rsy": 0.033, "tpd": 0.137}, "TE_1": {"pos": "TE", "label": "TE1, receiving", "rs": 0.0, "ts": 0.187, "rsz": 0.0, "tsz": 0.202, "rsy": 0.0, "tpd": 0.187}, "TE_1b": {"pos": "TE", "label": "TE1, in-line", "rs": 0.0, "ts": 0.113, "rsz": 0.0, "tsz": 0.119, "rsy": 0.0, "tpd": 0.113}, "TE_2": {"pos": "TE", "label": "TE2 / blocking", "rs": 0.0, "ts": 0.04, "rsz": 0.0, "tsz": 0.039, "rsy": 0.0, "tpd": 0.04}};
const RF=['rs','ts','rsz','tsz','rsy','tpd'];
const roleKey=()=>'roles_'+(ST.games&&ST.games[0]?ST.games[0].date:(ST.dk?ST.dk.gameInfo:''));
function applyRole(p,key){ if(!p) return;
  if(!key){ if(p.preRole){ Object.assign(p,p.preRole); p.preRole=null; } p.role=null; return; }
  const R=ROLES[key]; if(!R||R.pos!==p.pos) return;
  if(!p.preRole){ p.preRole={active:p.active,noProj:p.noProj,noGame:p.noGame}; RF.forEach(f=>p.preRole[f]=p[f]); }
  RF.forEach(f=>p[f]=R[f]); p.role=key; p.active=true; p.noProj=false; p.noGame=false; }
function saveRoles(){ const o={}; ST.players.forEach(p=>{ if(p.role) o[p.name+'|'+p.team]=p.role; }); store.set(roleKey(),o); }
function loadRoles(){ const o=store.get(roleKey(),{}); ST.players.forEach(p=>{ const k=o[p.name+'|'+p.team]; if(k) applyRole(p,k); }); }
function roleSelect(p,j){ if(!['RB','WR','TE'].includes(p.pos)) return ''; const opts=Object.entries(ROLES).filter(([,r])=>r.pos===p.pos);
  return `<select class="roleSel" data-role="${j}" aria-label="Role for ${esc(p.name)}" title="Set usage from a league role profile"><option value="">${p.role?'Model shares':'Model'}</option>${opts.map(([k,r])=>`<option value="${k}" ${p.role===k?'selected':''}>${esc(r.label)} (run ${Math.round(r.rs*100)}%, tgt ${Math.round(r.ts*100)}%)</option>`).join('')}</select>`; }
function bindRoles(el){ $$('.roleSel',el).forEach(s=>s.onchange=()=>{ const p=ST.players[+s.dataset.role]; applyRole(p,s.value); saveRoles(); if(ST.projMap) applyProjRoles(); markStale(); renderSlate(); }); }
const roleSet=(team,pos)=>ST.players.some(p=>(p.role||p.mkt||p.mktGrp)&&p.active&&p.team===team&&p.pos===pos);
/* your Plays checkbox is an override: kept per slate, and the projections / DK-status rules do not undo it */
const ovrKey=()=>'ovr_'+roleKey();
function saveOverrides(){ const o={}; ST.players.forEach(p=>{ if(p.forceIn) o[p.name+'|'+p.team]=1; else if(p.forceOut) o[p.name+'|'+p.team]=0; }); store.set(ovrKey(),o); }
function loadOverrides(){ const o=store.get(ovrKey(),{}); ST.players.forEach(p=>{ const v=o[p.name+'|'+p.team]; if(v===1){ p.forceIn=true; p.forceOut=false; p.active=true; } else if(v===0){ p.forceOut=true; p.forceIn=false; p.active=false; } }); }
function setPlays(p,on){ p.forceIn=!!on; p.forceOut=!on; if(on&&p.noProj){ Object.assign(p,p.base); p.noProj=false; } p.active=!!on; saveOverrides(); }


/* ---------------- players out: where their work goes ----------------
   Fit on 2024-26 games where a regular RB/WR/TE missed time (fit_vacated.py, 391 run and 619 target absences):
   vacated work stays inside the position. About 45% goes to established backups (RBs: concentrated on the top backup, weight ~share^1.5;
   targets: split evenly), about 55% to depth players who had no role before. Other positions gain almost nothing.
   Applied to copies of the shares at sim time, so the model shares on the slate table stay as they are. */
const VAC={run:{gamma:1.5,est:0.43,thr:0.05,f:['rs','rsz','rsy']},tgt:{gamma:0,est:0.45,thr:0.03,f:['ts','tsz','tpd']}};
const vacOn=()=>store.get('vacOn',true);
function vacStale(p){ return !!(ST.projMap&&!p.active&&!p.noProj&&(ST.projMap.get(SL.norm(p.name))||0)>0.05); }
function adjustVacated(){
  if(typeof qApplyLoad==='function') qApplyLoad(); const P=ST.players; const out=P.map(p=>({rs:+p.rs||0,ts:+p.ts||0,rsz:+p.rsz||0,tsz:+p.tsz||0,rsy:p.rsy!=null?+p.rsy:+p.rs||0,tpd:p.tpd!=null?+p.tpd:+p.ts||0}));
  const moves=[]; if(!vacOn()) return {sh:out,moves};
  const base=(p,f)=>{ const b=p.base||{}; const v=b[f]!=null?b[f]:p[f]; return +v||0; };
  for(const A of P){ const lim=A.active?(A.lim!=null?+A.lim:1):0; if((A.active&&lim>=0.999)||!['RB','WR','TE'].includes(A.pos)) continue;
    const ai=P.indexOf(A); const mates=P.map((p,j)=>j).filter(j=>j!==ai&&P[j].team===A.team&&P[j].pos===A.pos&&P[j].active&&(!P[j].noGame||P[j].nextUp||P[j].noGameRestored||!ST.projMap));
    const mv={j:ai,gain:new Map(),lim:A.active?lim:null};
    // out: teammates' 2026 shares already include the games he missed, so only the part from games he played moves. limited: the part of his work he won't take moves
    let sc; if(A.active){ sc=1-lim; ['rs','ts','rsz','tsz','rsy','tpd'].forEach(f=>{ out[ai][f]*=lim; }); } else { const teamN=Math.max(1,...P.filter(p=>p.team===A.team).map(p=>+p.gc||0)); sc=Math.max(0,Math.min(1,(+A.gc||0)/teamN)); } if(sc<=0) continue; mv.scale=sc;
    if(roleSet(A.team,A.pos)) continue; // you set this position group's roles yourself
    for(const kind of ['run','tgt']){ const K=VAC[kind]; const main=K.f[0]; const V0=base(A,main)*sc; if(V0<K.thr) continue;
      const est=mates.filter(j=>base(P[j],main)>=K.thr), dep=mates.filter(j=>base(P[j],main)<K.thr&&(!P[j].noGame||P[j].nextUp||P[j].noGameRestored)).sort((a,b)=>P[b].salF-P[a].salF).slice(0,2); // depth = active this season (no-game players are likely inactive or practice squad)
      const wE=est.map(j=>Math.pow(Math.max(1e-4,base(P[j],main)),K.gamma)), sE=wE.reduce((a,b)=>a+b,0);
      const fE=dep.length?(est.length?K.est:0):1; // no depth player active: established backups take it all (and vice versa)
      // a projections file that already has him at 0 knows this week's pecking order: follow the teammates' projected points instead
      const pj=ST.projMap&&!vacStale(A)?mates.map(j=>Math.max(0,ST.projMap.get(SL.norm(P[j].name))||0)):null; const pjS=pj?pj.reduce((a,b)=>a+b,0):0;
      if(pj&&pjS>0){ mv.byProj=true; for(const f of K.f){ const V=base(A,f)*sc; if(V<=0) continue; mates.forEach((j,k)=>{ const g=V*pj[k]/pjS; out[j][f]+=g; if(f===main) mv.gain.set(j,(mv.gain.get(j)||0)+g*(kind==='tgt'?1.6:1)); }); } continue; }
      for(const f of K.f){ const V=base(A,f)*sc; if(V<=0) continue;
        // a depth player never gains more than the top established backup; any excess goes to the established backups
        const gE=est.map((j,k)=>V*fE*wE[k]/sE); let gD=dep.length?V*(1-fE)/dep.length:0; const capD=gE.length?Math.max(...gE):Infinity;
        if(gD>capD){ const ex=(gD-capD)*dep.length; gD=capD; est.forEach((j,k)=>{ gE[k]+=ex*wE[k]/sE; }); }
        est.forEach((j,k)=>{ out[j][f]+=gE[k]; if(f===main) mv.gain.set(j,(mv.gain.get(j)||0)+gE[k]*(kind==='tgt'?1.6:1)); });
        dep.forEach(j=>{ out[j][f]+=gD; if(f===main) mv.gain.set(j,(mv.gain.get(j)||0)+gD*(kind==='tgt'?1.6:1)); }); } }
    if(mv.gain.size) moves.push(mv); }
  return {sh:out,moves};
}
/* stale projections: a starter is out but the projections file still has him, so his 0-projected backups would be benched. Un-bench the
   top two same-position depth players by salary (the next men up). */
function nextManUp(){ const P=ST.players; const up=[];
  for(const A of P){ if(!vacStale(A)||!['RB','WR','TE'].includes(A.pos)) continue;
    const have=P.filter(p=>p!==A&&p.active&&p.team===A.team&&p.pos===A.pos).length; const need=Math.max(0,2-have);
    P.filter(p=>p.noProj&&!p.forceOut&&p.team===A.team&&p.pos===A.pos&&!SL.INACTIVE.has((p.status||'').toUpperCase())).sort((a,b)=>b.salF-a.salF).slice(0,need)
      .forEach(p=>{ p.noProj=false; p.active=true; p.nextUp=A.name; Object.assign(p,p.base); up.push(p.name); }); }
  return up; }
/* public projections for the cash field: an out player still projected moves his points to teammates in line with their usage gains */
function publicProj(base){ if(!vacOn()) return base; const P=ST.players, out=base.slice(); const {moves}=adjustVacated();
  for(const mv of moves){ const A=P[mv.j]; const ap=out[mv.j]; if(!(ap>0)) continue; let tot=0; mv.gain.forEach(g=>tot+=g); if(tot<=0) continue;
    mv.gain.forEach((g,j)=>{ out[j]+=ap*g/tot; }); out[mv.j]=0; }
  return out; }
function vacatedCard(){
  const {moves}=adjustVacated(); const P=ST.players; const stale=P.filter(vacStale); const ups=P.filter(p=>p.nextUp);
  if(!moves.length&&!stale.length) return `<div class="row small" style="margin:0 0 10px"><label><input type="checkbox" id="vacOn" ${vacOn()?'checked':''}> Move work from players out to their backups using the fitted pattern</label><span class="muted">No skill players with a role are out.</span></div>`;
  return `<div class="card" style="margin-bottom:12px"><div class="row" style="justify-content:space-between"><h3>Players out</h3><label class="small"><input type="checkbox" id="vacOn" ${vacOn()?'checked':''}> Move their work to backups (fitted pattern)</label></div>
    <p class="small muted">Fit on 1,010 games where a regular RB/WR/TE missed time: vacated work stays in the position, about 45% to established backups (RBs: mostly the top backup; targets: split evenly) and 55% to depth players who had no role. Turn a player off on the slate to apply it. When your projections file already has the player at 0, his work is split by his teammates' projected points instead (they know this week's pecking order).${stale.length?` <b>Projections look stale for ${esc(stale.map(p=>p.name).join(', '))}</b> (out, but still projected in your file): ${ups.length?`next men up un-benched: ${esc(ups.map(p=>p.name).join(', '))}; `:''}${typeof runCash==='function'?'their projected points move to teammates in the cash field.':''}`:''}</p>
    ${vacOn()&&moves.length?`<div class="tw" style="border:0"><table class="nosort"><thead><tr><th>Out</th><th>Gains (designed-run + target share, pts of team)</th></tr></thead><tbody>${moves.map(mv=>`<tr><td>${esc(P[mv.j].name)} <span class="pos">${P[mv.j].pos}</span> <span class="muted small">${esc(P[mv.j].team)}${mv.lim!=null?` · limited to ${Math.round(mv.lim*100)}% of his work if he plays, so ${Math.round((1-mv.lim)*100)}% moves`:mv.scale<0.99?` · played ${Math.round(mv.scale*100)}% of team's 2026 games, so ${Math.round(mv.scale*100)}% of his share moves`:''}${mv.byProj?' · split by your projections':''}</span></td><td class="small">${Array.from(mv.gain.entries()).sort((a,b)=>b[1]-a[1]).map(([j,g])=>`${esc(P[j].name)} <b>+${(g*100).toFixed(1)}</b>`).join(' · ')}</td></tr>`).join('')}</tbody></table></div>`:''}</div>`;
}
function bindVacated(el){ const c=$('#vacOn',el); if(c) c.onchange=()=>{ store.set('vacOn',c.checked); markStale(); renderSlate(); }; }

/* Projections in the ownership file decide roles: a skill player projected for 0 points gets no carries or targets
   (practice-squad and inactive guys the model would otherwise give a small default share). */
function readProjCol(rows){ const h=rows[0].map(x=>x.trim().toLowerCase()); const i=h.findIndex(x=>(x==='points'||x==='proj'||x==='projection'||x==='fpts'||x==='projected points'||(x.includes('proj')&&!x.includes('own')&&!x.includes('ceil'))));
  if(i<0) return null; const iN=h.findIndex(x=>x==='name'||x==='player'||x.includes('name')); const m=new Map(); for(const r of rows.slice(1)){ const nm=SL.norm(r[iN]||''); const v=parseFloat(r[i]); if(nm&&!isNaN(v)) m.set(nm,v); } return m; }
function applyProjRoles(){
  const M=ST.projMap; let n=0; const names=[];
  // a file that covers the slate: skill players missing from it with no NFL history are treated as projected for 0 too
  const cover=M&&ST.players.filter(p=>M.has(SL.norm(p.name))).length>=0.9*ST.players.length;
  ST.players.forEach(p=>{ if(p.noProj){ Object.assign(p,p.base); p.active=p.noProjWasActive; p.noProj=false; }
    if(p.role||p.forceIn||!M||!['QB','RB','WR','TE'].includes(p.pos)) return; const v=M.get(SL.norm(p.name)); if(v==null&&!(cover&&!(p.g>0))) return; if(v!=null&&v>0.05) return;
    p.noProjWasActive=p.active; p.noProj=true; p.active=false; ['rs','ts','rsz','tsz','rsy','tpd'].forEach(f=>p[f]=0); n++; if(names.length<8) names.push(p.name); });
  ST.players.forEach(p=>{ p.nextUp=null; }); nextManUp(); n=ST.players.filter(p=>p.noProj).length;
  // no 2026 games yet (share dropped to depth level), but your projections give him a real role: restore his prior-role share
  ST.players.forEach(p=>{ if(p.noGameRestored){ Object.assign(p,p.base); p.noGameRestored=false; }
    if(p.role||!M||!p.noGame||!p.active||!p.noGameRaw) return; const v=M.get(SL.norm(p.name))||0; const mx=Math.max(0,...ST.players.filter(q=>q.team===p.team&&q.pos===p.pos&&q!==p).map(q=>M.get(SL.norm(q.name))||0));
    if(v>=3&&v>=0.4*mx){ Object.assign(p,p.noGameRaw); p.noGameRestored=true; } });
  const teams=new Set(ST.players.filter(p=>p.pos==='QB').map(p=>p.team)); teams.forEach(t=>fixQB(t));
  ST.projBench={n,names}; if(n) markStale(); return n; }
function loadOwnership(text,label){
  const rows=SL.parseCSV(text.replace(/^﻿/,'')); if(!rows.length){toast('Empty ownership file');return;}
  const h=rows[0].map(x=>x.trim().toLowerCase()); const iN=h.findIndex(x=>x==='name'||x==='player'||x.includes('name')); let iO=h.findIndex(x=>x.includes('own')&&!x.includes('cpt')&&!x.includes('capt')); if(iO<0) iO=h.findIndex(x=>x.includes('own')); // a Showdown file has CPT and FLEX columns: use FLEX
  if(iN<0||iO<0){toast('Need a Name column and an ownership column');return;}
  ST.cm=null; if(ST.res){ ST.res.proi=null; $('#pane-lineups').innerHTML=''; } ST.own=new Map(); const vals=[]; for(const r of rows.slice(1)){ const nm=SL.norm(r[iN]||''); const v=parseFloat(String(r[iO]).replace('%','')); if(nm&&!isNaN(v)) vals.push([nm,v]); }
  const pctScale=vals.some(([,v])=>v>1.5)||rows.slice(1).some(r=>/%/.test(r[iO]||'')); vals.forEach(([nm,v])=>ST.own.set(nm,pctScale?v/100:v)); // one scale for the whole column (0.4 means 0.4% when others are like 25)
  ST.ownLabel=label; ST.projMap=readProjCol(rows); applyProjRoles(); applyOwnership(); if(ST.projBench&&ST.projBench.n){ renderSlate(); toast(`${ST.projBench.n} players projected for 0 points get no role. Re-run to apply.`); }
}
function applyOwnership(){ if(!ST.own) return; let hit=0; ST.players.forEach(p=>{ const v=ST.own.get(SL.norm(p.name)); p.own=v!=null?v:null; if(v!=null) hit++; });
  $('#ownStatus').textContent=`${ST.ownLabel||'ownership'}: ${hit} of ${ST.players.length} players matched${ST.projBench&&ST.projBench.n?` · ${ST.projBench.n} players projected for 0 points benched`:''}`; if(ST.res){ renderProj(); renderPortfolioSetup(); } }

/* ---------------- portfolio builder (sim-driven) ---------------- */
const CFG0={N:20,rank:'top',M:20000,maxExp:0.4,qbExp:0.3,dstExp:0.3,teamStack:0.3,minSal:49000,stack:1,bring:'any',gameStack:0,maxGame:9,noVsDst:true,noRBwithQB:false,maxTeam:5,uniq:3,flex:{RB:1,WR:1,TE:1},ownW:0.3,maxOwn:0};
function readCfg(){ const v=(id,d)=>{const e=$('#'+id); return e?e.value:d;}; const ck=(id,d)=>{const e=$('#'+id); return e?e.checked:d;};
  return {N:Math.max(1,+v('cN',20)),rank:v('cRank','top'),M:Math.max(100,+v('cM',20000)),maxExp:Math.max(1,+v('cExp',40))/100,qbExp:Math.max(1,+v('cQbExp',30))/100,dstExp:Math.max(1,+v('cDstExp',30))/100,teamStack:Math.max(1,+v('cTeamStack',30))/100,
    minSal:+v('cSal',49000),stack:+v('cStack',1),bring:v('cBring','any'),gameStack:+v('cGame',0),maxGame:+v('cMaxGame',9),noVsDst:ck('cDst',true),noRBwithQB:ck('cRbQb',false),maxTeam:+v('cTeam',5),uniq:+v('cUniq',3),
    flex:{RB:ck('cFxRB',true)?1:0,WR:ck('cFxWR',true)?1:0,TE:ck('cFxTE',true)?1:0},ownW:+v('cOwn',30)/100,maxOwn:+v('cMaxOwn',0)/100}; }
function saveCfg(){ store.set('cfg2',readCfg()); }
function renderPortfolioSetup(){
  const el=$('#pane-port'); const R=ST.res; if(!R) return; const P=ST.players; const c=Object.assign({},CFG0,store.get('cfg2',{}));
  if(ST.entries){ const thr=store.get('dupThr',0.25); const n=ST.entries.rows.filter(e=>!e.pre&&e.fee>thr+1e-9).length; if(n) c.N=n; }
  const pool=P.map((p,j)=>({p,j,s:R.stats[j]})).filter(r=>r.s.opt>=0.003).sort((a,b)=>b.s.opt-a.s.opt).slice(0,80);
  const num=(id,lab,val,w,extra='',title='')=>`<label ${title?`title="${title}"`:''}>${lab} <input id="${id}" type="number" value="${val}" style="width:${w}px" ${extra}></label>`;
  const sel=(id,lab,val,opts)=>`<label>${lab} <select id="${id}">${opts.map(([v,l])=>`<option value="${v}" ${String(v)===String(val)?'selected':''}>${l}</option>`).join('')}</select></label>`;
  const cb=(id,lab,on)=>`<label><input type="checkbox" id="${id}" ${on?'checked':''}> ${lab}</label>`;
  el.innerHTML=`<div class="grid2"><div class="card"><h3>Build a portfolio</h3><p class="small muted">Each sim's best lineup under your rules is a candidate, so lineups come from many different game scripts. Candidates are then ranked and picked under your exposure and uniqueness limits.</p>
    <div class="pgrp"><span class="lbl">Size and ranking</span><div class="row small">${num('cN','Lineups',c.N,64,'min="1" max="500"')}
      ${sel('cRank','Rank by',c.rank,[['top','Top 1% rate'],['roi','Expected ROI'],['blend','ROI + top 1% blend'],['mean','Mean points']])}<span class="muted" title="ROI ranking uses half of the priced sims with any finish better than the top 0.05% paid as that rank, so a lineup that happened to win a handful of sims does not jump to the top. The Exp ROI column is measured on the other half of the sims, so it is not inflated by the selection.">(?)</span>
      ${num('cM','Contest size (for ROI)',c.M,84,'step="1000" min="100"')}
      ${num('cUniq','Min unique players per lineup',c.uniq,46,'min="1" max="9"','Every lineup must differ from every other lineup by at least this many players')}</div></div>
    <div class="pgrp"><span class="lbl">Exposure caps (% of lineups)</span><div class="row small">${num('cExp','Any player',Math.round(c.maxExp*100),56,'min="1" max="100"')}${num('cQbExp','Any one QB',Math.round(c.qbExp*100),56,'min="1" max="100"')}${num('cDstExp','Any one DST',Math.round(c.dstExp*100),56,'min="1" max="100"')}${num('cTeamStack','Any one team\'s QB stack',Math.round(c.teamStack*100),56,'min="1" max="100"')}</div></div>
    <div class="pgrp"><span class="lbl">Stacking</span><div class="row small">${sel('cStack','QB + own pass catchers',c.stack,[[0,'any'],[1,'at least 1'],[2,'at least 2'],[3,'at least 3']])}
      ${sel('cBring','Bring-back',c.bring,[['any','optional'],['req','required'],['none','not allowed']])}
      ${sel('cGame','Players from QB\'s game',c.gameStack,[[0,'any'],[3,'at least 3'],[4,'at least 4'],[5,'at least 5']])}
      ${cb('cRbQb','No RB with his own QB',c.noRBwithQB)}</div></div>
    <div class="pgrp"><span class="lbl">Construction</span><div class="row small">${num('cSal','Min salary',c.minSal,84,'step="100" min="40000" max="50000"')}${num('cTeam','Max per team',c.maxTeam,46,'min="2" max="8"')}${sel('cMaxGame','Max per game',c.maxGame,[[9,'no limit'],[4,'4'],[5,'5'],[6,'6']])}
      <span>FLEX: ${cb('cFxRB','RB',c.flex.RB)} ${cb('cFxWR','WR',c.flex.WR)} ${cb('cFxTE','TE',c.flex.TE)}</span>${cb('cDst','No offense against your DST',c.noVsDst)}</div></div>
    ${hasOwn()?`<div class="pgrp"><span class="lbl">Ownership</span><div class="row small"><label>Leverage weight <input id="cOwn" type="range" min="0" max="100" value="${Math.round(c.ownW*100)}"></label>${num('cMaxOwn','Max total ownership % (0 = off)',Math.round(c.maxOwn*100),60,'min="0" max="900"')}</div></div>`:''}
    ${capsCard()}
    <div class="row" style="margin-top:10px"><button class="primary" id="buildBtn">Build portfolio</button><span id="pStatus" class="small muted"></span></div>
    <p class="small muted" style="margin-top:6px">Exclude players by unchecking <b>Use</b> on Slate inputs. <span id="exclNote">${ST.portExcl.size?ST.portExcl.size+' excluded from lineups':''}</span></p></div>
    <div class="card"><h3>DraftKings entries</h3>${entriesCard()}</div></div>
    <div id="portOut" style="margin-top:16px"></div>`;
  $$('input,select',el).forEach(i=>{ if(i.closest('#entCard')) return; i.addEventListener('change',saveCfg); });
  $('#buildBtn').onclick=buildPortfolio; bindEntries(el); bindCaps(el,renderPortfolioSetup); if(ST.port) renderPortfolioResult();
}
function rulesOK(L,c){ const P=ST.players; let sal=0; const tc=new Map(); for(const j of L){ sal+=P[j].salF; tc.set(P[j].team,(tc.get(P[j].team)||0)+1); if(ST.portExcl.has(j)) return false; }
  if(sal<c.minSal||sal>50000) return false; for(const v of tc.values()) if(v>c.maxTeam) return false;
  if(new Set(L.map(j=>P[j].gi)).size<2) return false;
  const s=stackInfo(L); if(s.n<c.stack) return false; if(c.bring==='req'&&!s.bb) return false; if(c.bring==='none'&&s.bb) return false;
  if(c.noVsDst){ const d=L.find(j=>P[j].pos==='DST'); const vs=oppOf(P[d]); if(L.some(j=>P[j].team===vs&&P[j].pos!=='DST')) return false; }
  const gc=new Map(); L.forEach(j=>gc.set(P[j].gi,(gc.get(P[j].gi)||0)+1)); for(const v of gc.values()) if(v>c.maxGame) return false;
  if(s.qb>=0&&c.gameStack&&(gc.get(P[s.qb].gi)||0)<c.gameStack) return false;
  if(c.noRBwithQB&&s.qb>=0&&L.some(j=>P[j].pos==='RB'&&P[j].team===P[s.qb].team)) return false;
  const pc={RB:0,WR:0,TE:0}; L.forEach(j=>{ if(pc[P[j].pos]!=null) pc[P[j].pos]++; }); if((!c.flex.RB&&pc.RB>2)||(!c.flex.WR&&pc.WR>3)||(!c.flex.TE&&pc.TE>1)) return false;
  if(c.maxOwn>0&&hasOwn()&&L.reduce((a,j)=>a+(P[j].own||0),0)>c.maxOwn) return false;
  return true; }
async function buildPortfolio(){
  const R=ST.res; const P=ST.players; const c=readCfg(); saveCfg(); const st=$('#pStatus'); const btn=$('#buildBtn'); btn.disabled=true;
  try{
    // 1. rule-constrained optimal lineup in every sim (in the workers: the optimizer checks rules at each complete lineup)
    st.textContent='Finding the best lineup under your rules in every sim…'; await new Promise(r=>setTimeout(r,0));
    const pos=P.map((p,j)=>p.active&&p.salF>0&&!ST.portExcl.has(j)?PCODE[p.pos]:-1), sal=P.map(p=>p.salF);
    const meta={team:P.map(p=>p.team),opp:P.map(p=>oppOf(p)),gi:P.map(p=>p.gi)};
    const N=R.N, n=R.n, per=Math.ceil(N/NW); makeWorkers();
    const parts=await Promise.all(workers.map((w,k)=>{ const a=k*per, b=Math.min(N,a+per); if(b<=a) return null; const chunk=R.pts.slice(a*n,b*n);
      return call(w,{type:'opt',pts:chunk,nT:n,n:b-a,pos,sal,meta,rules:c},null); }));
    const cand=new Map(); parts.forEach(p=>{ if(!p) return; for(let i=0;i<p.n;i++){ if(p.opt[i*9]<0) continue; const L=Array.from(p.opt.subarray(i*9,i*9+9)); const k=L.slice().sort((x,y)=>x-y).join(','); const o=cand.get(k); if(o) o.f++; else cand.set(k,{L,key:k,f:1}); } });
    const C=Array.from(cand.values()).filter(o=>rulesOK(o.L,c)); if(!C.length){ st.textContent='No lineups fit these rules. Loosen the stack, salary or team limits.'; btn.disabled=false; return; }
    // 2. score every candidate in every sim: top-1% rate among candidates, mean
    const nc=C.length, Ls=new Int32Array(nc*9); C.forEach((o,i)=>Ls.set(o.L,i*9)); const top=new Float64Array(nc), sum=new Float64Array(nc); const s=new Float32Array(nc), tmp=new Float32Array(nc); const kth=Math.max(1,Math.floor(nc*0.01));
    for(let i=0;i<N;i++){ const o=i*n; for(let u=0;u<nc;u++){ let v=0; const b=u*9; for(let k=0;k<9;k++) v+=R.pts[o+Ls[b+k]]; s[u]=v; sum[u]+=v; }
      tmp.set(s); const thr=kthLargest(tmp,kth); for(let u=0;u<nc;u++) if(s[u]>=thr) top[u]++;
      if(i%500===499){ st.textContent=`Scoring ${nc.toLocaleString()} candidate lineups across sims… ${Math.round(100*i/N)}%`; await new Promise(r=>setTimeout(r,0)); } }
    const own=hasOwn(); C.forEach((o,i)=>{ o.mean=sum[i]/N; o.top=top[i]/N; o.sal=o.L.reduce((a,j)=>a+P[j].salF,0); o.st=stackInfo(o.L);
      if(own){ const ow=o.L.map(j=>Math.max(0.002,P[j].own!=null?P[j].own:0.01)); o.ownSum=ow.reduce((a,b)=>a+b,0); o.geo=Math.exp(ow.reduce((a,b)=>a+Math.log(b),0)/9); } });
    if(c.rank==='roi'||c.rank==='blend'){ // price the strongest candidates in a simulated contest
      ST.contestSize=c.M; const cm=await contestModel(c.M,(f)=>{st.textContent=`Simulating a ${c.M.toLocaleString()}-entry field… ${Math.round(f*100)}%`;});
      const pre=C.slice().sort((a,b)=>b.top-a.top||b.mean-a.mean).slice(0,Math.min(C.length,Math.max(600,c.N*12)));
      for(let k=0;k<pre.length;k++){ const r=cm.roi(pre[k].L,true); pre[k].roi=r.roiOut; pre[k].roiC=r.roiC; if(k%50===49){ st.textContent=`Pricing lineups in the contest… ${Math.round(100*k/pre.length)}%`; await new Promise(r=>setTimeout(r,0)); } } }
    const g0=own?Math.exp(C.reduce((a,o)=>a+Math.log(o.geo),0)/nc):1; const topMax=Math.max(...C.map(o=>o.top),1e-9);
    const base=(o)=>c.rank==='mean'?o.mean:c.rank==='roi'?(o.roiC==null?-9:o.roiC+1):c.rank==='blend'?(o.roiC==null?-9:(o.roiC+1)*(0.5+0.5*o.top/topMax)):(o.top+0.2/N);
    C.forEach(o=>{ const b=base(o); o.score=own&&b>0?b*Math.pow(o.geo/g0,-c.ownW):b; });
    // greedy pick: exposure caps (any player, per QB, per DST, per team stack) and minimum unique players between any two lineups
    C.sort((a,b)=>b.score-a.score); const capOf=(f)=>Math.max(1,Math.ceil(f*c.N)); const capAll=capOf(c.maxExp), capQB=capOf(Math.min(c.maxExp,c.qbExp)), capD=capOf(Math.min(c.maxExp,c.dstExp)), capT=capOf(c.teamStack);
    const caps=ST.caps||new Map(); const capFor=(j)=>{ const o=caps.get(j); if(o&&o.max!=null) return Math.floor(o.max*c.N+1e-9); const d=P[j].pos==='QB'?capQB:P[j].pos==='DST'?capD:capAll; return o&&o.min!=null?Math.max(d,Math.ceil(o.min*c.N-1e-9)):d; }; // a minimum above the global cap lifts his cap
    const mins=Array.from(caps.entries()).filter(([j,o])=>o.min!=null&&o.min>0).map(([j,o])=>[j,Math.min(c.N,Math.ceil(o.min*c.N-1e-9))]);
    let picked=[], uniq=c.uniq;
    while(true){ picked=[]; const cnt=new Map(), tst=new Map(); const inP=new Set();
      const ok=(o)=>{ if(o.score<=-9||inP.has(o)) return false; if(o.L.some(j=>(cnt.get(j)||0)>=capFor(j))) return false; const qt=o.st.qb>=0?P[o.st.qb].team:null; if(qt&&(tst.get(qt)||0)>=capT) return false;
        const set=new Set(o.L); return !picked.some(q=>9-q.L.reduce((a,j)=>a+(set.has(j)?1:0),0)<uniq); };
      const add=(o)=>{ picked.push(o); inP.add(o); o.L.forEach(j=>cnt.set(j,(cnt.get(j)||0)+1)); const qt=o.st.qb>=0?P[o.st.qb].team:null; if(qt) tst.set(qt,(tst.get(qt)||0)+1); };
      // minimums first: best lineups that include each player until his minimum is met
      for(const [j,need] of mins){ for(const o of C){ if(picked.length>=c.N||(cnt.get(j)||0)>=need) break; if(o.L.includes(j)&&ok(o)) add(o); } }
      for(const o of C){ if(picked.length>=c.N) break; if(ok(o)) add(o); }
      if(picked.length>=c.N||uniq<=1) break; uniq--; }
    const short=mins.filter(([j,need])=>picked.filter(o=>o.L.includes(j)).length<need).map(([j])=>P[j].name);
    const over=uniq;
    ST.port=picked; ST.portInfo={nc,uniq,cfg:c}; ST.assign=null; if(ST.entries) assignEntries();
    st.textContent=`${picked.length} of ${c.N} lineups from ${nc.toLocaleString()} rule-legal sim optimals${uniq<c.uniq?` (min unique players relaxed to ${uniq} to fill)`:''}${picked.length<c.N?' · raise the exposure caps or loosen the rules to fill the rest':''}${short.length?` · minimum not reachable under your rules for ${short.join(', ')}`:''}`;
    renderPortfolioResult();
  }catch(e){ console.error(e); st.textContent='Build failed: '+e.message; }
  btn.disabled=false;
}
function kthLargest(a,k){ // quickselect for the k-th largest value (1-based)
  let lo=0, hi=a.length-1; const t=k-1;
  while(lo<hi){ const pv=a[(lo+hi)>>1]; let i=lo, j=hi; while(i<=j){ while(a[i]>pv) i++; while(a[j]<pv) j--; if(i<=j){ const x=a[i]; a[i]=a[j]; a[j]=x; i++; j--; } } if(t<=j) hi=j; else if(t>=i) lo=i; else break; }
  return a[t]; }
function renderPortfolioResult(){
  const el=$('#portOut'); const L=ST.port; if(!el||!L) return; const P=ST.players, R=ST.res; const n=L.length;
  const exp=new Map(); L.forEach(o=>o.L.forEach(j=>exp.set(j,(exp.get(j)||0)+1)));
  const ex=Array.from(exp.entries()).sort((a,b)=>b[1]-a[1]);
  const key=ST.view.portSort||'score', dir=ST.view.portDir||-1; const rows=L.slice().sort((a,b)=>dir*((a[key]||0)-(b[key]||0)));
  const sh=(k,l)=>`<th class="sort n ptsort" data-k="${k}">${l}${key===k?(dir<0?' ▾':' ▴'):''}</th>`;
  const teams=new Map(); L.forEach(o=>{ if(o.st.qb>=0){ const t=P[o.st.qb].team; teams.set(t,(teams.get(t)||0)+1); } });
  el.innerHTML=`<div><div class="card"><div class="row" style="justify-content:space-between"><h3>Portfolio (${n})</h3><div class="row"><button id="dlLineups">Download lineups CSV</button>${ST.assign?'<button class="primary" id="dlEntries">Download DK entries CSV</button>':''}</div></div>
    ${(()=>{ const r=L.filter(o=>o.roi!=null).map(o=>o.roi); if(r.length<2) return ''; const m=r.reduce((a,b)=>a+b,0)/r.length; const sd=Math.sqrt(r.reduce((a,b)=>a+(b-m)*(b-m),0)/(r.length-1)); return `<p class="small"><b>Portfolio expected ROI ${m>=0?'+':''}${(m*100).toFixed(0)}%</b> <span class="muted">(±${(100*sd/Math.sqrt(r.length)).toFixed(0)} pts; measured on sims not used to pick the lineups, ${(ST.cm&&ST.cm.M||0).toLocaleString()}-entry simulated field). A single lineup's ROI swings a lot because a few first-place finishes drive it; read the portfolio number, not each row.</span></p>`; })()}<div class="tw" style="border:0;max-height:620px;overflow:auto"><table><thead><tr>${ST.assign?'<th>Contest</th>':''}${sh('top','Top 1%')}${L.some(o=>o.roi!=null)?sh('roi','Exp ROI'):''}${sh('mean','Mean')}${sh('sal','Salary')}${hasOwn()?sh('ownSum','Total own'):''}<th>Stack</th>${SLOTS.map(s=>`<th>${s}</th>`).join('')}</tr></thead><tbody>
    ${rows.map(o=>`<tr>${ST.assign?`<td class="small">${o._ct?`<b>$${o._ct.fee.toFixed(2)}</b> ${esc(o._ct.short)}`:'-'}</td>`:''}<td class="n"><b>${pct(o.top,2)}</b></td>${L.some(x=>x.roi!=null)?`<td class="n" style="color:var(${(o.roi||0)>=0?'--good':'--bad'})">${o.roi==null?'-':(o.roi>=0?'+':'')+(o.roi*100).toFixed(0)+'%'}</td>`:''}<td class="n">${fmt(o.mean)}</td><td class="n">${o.sal.toLocaleString()}</td>${hasOwn()?`<td class="n">${pct(o.ownSum||0,0)}</td>`:''}
      <td class="small">${o.st.qb>=0?`${esc(P[o.st.qb].team)} QB+${o.st.n}${o.st.bb?' +BB':''}`:'-'}</td>${dkSlots(o.L).map(j=>`<td class="small">${tdot(P[j].team)}<button class="plink" data-pc="${j}">${esc(P[j].name)}</button></td>`).join('')}</tr>`).join('')}</tbody></table></div></div>
    <div class="card" style="margin-top:16px"><h3>Exposure</h3><p class="small muted">QB stacks: ${Array.from(teams.entries()).sort((a,b)=>b[1]-a[1]).map(([t,c])=>`${tdot(t)}${esc(t)} ${c}`).join(' · ')}</p><div class="tw" style="border:0;max-height:560px;overflow:auto"><table><thead><tr><th>Player</th><th class="n">Exposure</th><th class="n">Optimal %</th>${hasOwn()?'<th class="n">Proj own</th>':''}<th class="n" title="Your limit for this player (blank = the global cap). Rebuild to apply.">Max %</th><th class="n" title="Force at least this share of lineups. Rebuild to apply.">Min %</th></tr></thead><tbody>
      ${ex.map(([j,c])=>`<tr><td>${tdot(P[j].team)}<button class="plink" data-pc="${j}">${esc(P[j].name)}</button><span class="pos">${P[j].pos}</span></td><td class="n"><b>${pct(c/n,0)}</b></td><td class="n">${pct(R.stats[j].opt,1)}</td>${hasOwn()?`<td class="n">${P[j].own!=null?pct(P[j].own,1):'-'}</td>`:''}${['max','min'].map(k=>{ const v=(ST.caps&&ST.caps.get(j)||{})[k]; return `<td class="n"><input class="capin" data-capj="${j}" data-capk="${k}" type="number" min="0" max="100" value="${v!=null?Math.round(v*100):''}" placeholder="-" style="width:52px"></td>`; }).join('')}</tr>`).join('')}</tbody></table></div><div class="row small" style="margin-top:8px"><button id="rebuildBtn" class="small">Rebuild with these limits</button><span class="muted">Limits are saved per slate.</span></div></div></div>
    ${ST.assign?entriesResult():''}`;
  bindCaps(el,()=>{}); { const rb=$('#rebuildBtn',el); if(rb) rb.onclick=()=>{ renderPortfolioSetup(); buildPortfolio(); }; }
  $$('th.ptsort',el).forEach(t=>t.onclick=()=>{ const k=t.dataset.k; if(ST.view.portSort===k) ST.view.portDir=-(ST.view.portDir||-1); else { ST.view.portSort=k; ST.view.portDir=-1; } renderPortfolioResult(); });
  $('#dlLineups').onclick=()=>{ const csv=SLOTS.join(',')+'\n'+L.map(o=>dkSlots(o.L).map(j=>P[j].idF).join(',')).join('\n')+'\n'; saveText(csv,'classic_lineups.csv',`${L.length} lineups`); };
  const de=$('#dlEntries'); if(de) de.onclick=()=>saveText(entriesCSV(),'DKEntries_filled.csv',`${ST.entries.rows.length} entries`);
}

/* ---------------- DK entries (classic: QB RB RB WR WR WR TE FLEX DST) ---------------- */
const ckey=(e)=>e.cid||e.cname; const shortName=(n)=>(n||'').replace(/^NFL\s*/,'').replace(/\s*\[.*?\]\s*/g,' ').trim();
function loadEntries(text,label){
  const rows=SL.parseCSV(text); if(!rows.length){toast('Empty entries file');return;}
  const h=rows[0].map(x=>x.trim().replace(/^﻿/,'')); const iE=h.indexOf('Entry ID'), iN=h.indexOf('Contest Name'), iC=h.indexOf('Contest ID'), iF=h.indexOf('Entry Fee'), iQ=h.indexOf('QB');
  if(iE<0||iF<0||iQ<0){ toast(h.includes('CPT')?'That is a Showdown entries file. Use the Showdown lab.':'Not a DK Classic entries CSV (needs Entry ID, Entry Fee, QB columns)'); return; }
  const out=[]; for(const r of rows.slice(1)){ const id=(r[iE]||'').trim(); if(!/^\d+$/.test(id)) continue; const cells=r.slice(iQ,iQ+9).map(x=>(x||'').trim());
    out.push({id,cname:r[iN]||'',cid:r[iC]||'',fee:parseFloat((r[iF]||'0').replace(/[$,]/g,''))||0,cells,pre:cells.some(x=>x)}); }
  ST.entries={rows:out,label,raw:rows,iE,iQ,bom:text.charCodeAt(0)===0xFEFF,eol:/\r\n/.test(text)?'\r\n':'\n'}; ST.assign=null;
  if(ST.port) assignEntries(); renderPortfolioSetup(); toast(`${out.length} entries loaded`);
}
function entriesCard(){
  const EN=ST.entries; const thr=store.get('dupThr',0.25);
  if(!EN) return `<div id="entCard"><p class="small muted">Upload the Classic entries CSV from DraftKings (Lineups, Edit Entries, Download). The lineup count is set to your open entries above the dupe threshold; lineups are spread across fees so each player's dollar exposure matches his lineup exposure; entries at or below the threshold get copies, going down the portfolio list and starting back at the top only after every lineup has been used. Preloaded entries are left alone.</p>
    <div class="drop" id="dropEnt" role="button" tabindex="0"><b>Upload DKEntries.csv</b><input type="file" id="fileEnt" accept=".csv,.zip,text/csv" hidden></div></div>`;
  const g=new Map(); EN.rows.forEach(e=>{const k=ckey(e); if(!g.has(k)) g.set(k,{name:e.cname,fee:e.fee,n:0,pre:0}); const x=g.get(k); x.n++; if(e.pre) x.pre++;});
  const open=EN.rows.filter(e=>!e.pre); const uniq=open.filter(e=>e.fee>thr+1e-9).length;
  return `<div id="entCard"><div class="row small"><label>Entries at or below $<input id="dupThr" type="number" step="0.05" min="0" value="${thr}" style="width:64px"></label><span class="muted">reuse lineups from bigger contests</span><button id="clearEnt" class="small">Remove</button></div>
    <p class="small"><b>${uniq}</b> unique lineups needed · ${open.length-uniq} dupe entries · $${open.reduce((a,e)=>a+e.fee,0).toFixed(2)} in fees${EN.rows.length-open.length?` · ${EN.rows.length-open.length} preloaded left alone`:''}</p>
    <div class="tw" style="border:0"><table><thead><tr><th>Contest</th><th class="n">Fee</th><th class="n">Entries</th><th class="n">Preloaded</th></tr></thead><tbody>${Array.from(g.values()).sort((a,b)=>b.fee-a.fee).map(x=>`<tr><td class="small" style="white-space:normal">${esc(shortName(x.name))}</td><td class="n">$${x.fee.toFixed(2)}</td><td class="n">${x.n}</td><td class="n">${x.pre||''}</td></tr>`).join('')}</tbody></table></div></div>`;
}
function bindEntries(el){
  const fe=$('#fileEnt',el), d=$('#dropEnt',el);
  if(fe){ fe.onchange=()=>{const f=fe.files[0]; if(f) readUploadSafe(f).then(t=>loadEntries(t,f.name));}; d.onclick=(e)=>{if(e.target.tagName!=='INPUT') fe.click();};
    d.ondragover=(e)=>{e.preventDefault();d.classList.add('over');}; d.ondragleave=()=>d.classList.remove('over'); d.ondrop=(e)=>{e.preventDefault();d.classList.remove('over');const f=e.dataTransfer.files[0]; if(f) readUploadSafe(f).then(t=>loadEntries(t,f.name));}; }
  const ce=$('#clearEnt',el); if(ce) ce.onclick=()=>{ST.entries=null; ST.assign=null; renderPortfolioSetup();};
  const dt=$('#dupThr',el); if(dt) dt.onchange=()=>{ store.set('dupThr',Math.max(0,+dt.value||0)); renderPortfolioSetup(); };
}
/* greedy fee-balanced assignment + swap polish: each player's share of entry dollars matches his share of lineups */
function assignEntries(){
  if(!ST.entries||!ST.port||!ST.port.length) return null;
  const thr=store.get('dupThr',0.25); const L=ST.port; const nL=L.length;
  const open=ST.entries.rows.filter(e=>!e.pre); const main=open.filter(e=>e.fee>thr+1e-9).sort((a,b)=>b.fee-a.fee); const low=open.filter(e=>e.fee<=thr+1e-9);
  const share=new Map(); L.forEach(c=>c.L.forEach(j=>share.set(j,(share.get(j)||0)+1/nL)));
  const players=Array.from(share.keys()); const D=new Map(players.map(p=>[p,0])); let Dt=0;
  const errAdd=(c,f)=>{let e=0; const set=new Set(c.L); for(const p of players){const d=D.get(p)+(set.has(p)?f:0)-share.get(p)*(Dt+f); e+=d*d;} return e;};
  const take=(c,f)=>{c.L.forEach(p=>D.set(p,D.get(p)+f)); Dt+=f;};
  const asg=new Map(); const used=new Set();
  for(const e of main){ let best=null,bv=1e18; const pool=L.filter(c=>!used.has(c.key)); const cand=pool.length?pool:L;
    for(const c of cand){ const v=errAdd(c,e.fee); if(v<bv){bv=v;best=c;} } asg.set(e.id,best); used.add(best.key); take(best,e.fee); if(used.size>=nL) used.clear(); }
  const R=E.makeRng(99); let cur=0; for(const p of players){const d=D.get(p)-share.get(p)*Dt; cur+=d*d;}
  for(let it=0;it<30000&&main.length>1;it++){ const a=main[Math.floor(R()*main.length)], b=main[Math.floor(R()*main.length)]; if(a.fee===b.fee) continue;
    const la=asg.get(a.id), lb=asg.get(b.id); const df=a.fee-b.fee; const sa=new Set(la.L), sb=new Set(lb.L);
    const ch=new Map(); la.L.forEach(p=>{if(!sb.has(p)) ch.set(p,-df);}); lb.L.forEach(p=>{if(!sa.has(p)) ch.set(p,(ch.get(p)||0)+df);});
    let nv=cur; for(const [p,dd] of ch){const d0=D.get(p)-share.get(p)*Dt; const d1=d0+dd; nv+=d1*d1-d0*d0;}
    if(nv<cur-1e-12){ for(const [p,dd] of ch) D.set(p,D.get(p)+dd); asg.set(a.id,lb); asg.set(b.id,la); cur=nv; } }
  // dupe entries: walk down the portfolio list, one lineup per entry, and only start over at the top once every lineup has been duped
  const ord=L.slice().sort((a,b)=>(b.score||0)-(a.score||0)); let q=[]; const usedBy=new Map();
  const lowS=low.slice().sort((a,b)=>b.fee-a.fee||String(ckey(a)).localeCompare(String(ckey(b))));
  for(const e of lowS){ const k=ckey(e); if(!usedBy.has(k)) usedBy.set(k,new Set()); const u=usedBy.get(k);
    if(!q.length) q=ord.slice(); let i=q.findIndex(c=>!u.has(c.key));
    if(i<0&&u.size<nL){ q=q.concat(ord); i=q.findIndex(c=>!u.has(c.key)); } if(i<0) i=0;
    const c=q.splice(i,1)[0]; asg.set(e.id,c); u.add(c.key); take(c,e.fee); }
  L.forEach(c=>c._ct=null); for(const e of main){ const c=asg.get(e.id); if(c&&(!c._ct||e.fee>c._ct.fee)) c._ct={fee:e.fee,short:shortName(e.cname)}; }
  ST.assign={map:asg,D,Dt,share,main:main.length,low:low.length}; return ST.assign;
}
function entriesResult(){
  const A=ST.assign; const P=ST.players; const fees=Array.from(new Set(ST.entries.rows.filter(e=>!e.pre).map(e=>e.fee))).sort((a,b)=>b-a);
  const tier=new Map(fees.map(f=>[f,{n:0,cnt:new Map()}])); ST.entries.rows.forEach(e=>{ if(e.pre) return; const c=A.map.get(e.id); if(!c) return; const t=tier.get(e.fee); t.n++; c.L.forEach(j=>t.cnt.set(j,(t.cnt.get(j)||0)+1)); });
  const pl=Array.from(A.share.entries()).sort((a,b)=>b[1]-a[1]);
  return `<div class="card" style="margin-top:16px"><h3>Exposure by entry fee</h3><p class="small muted">${A.main} entries got unique lineups and ${A.low} dupe entries got copies, walking down the portfolio list (best score first) and only repeating a lineup after every lineup has been duped. $ exposure is each player's share of your entry fees.</p>
    <div class="tw" style="border:0;max-height:520px;overflow:auto"><table><thead><tr><th>Player</th><th class="n">Lineups</th><th class="n">$ exposure</th>${hasOwn()?'<th class="n">Proj own</th>':''}${fees.map(f=>`<th class="n">$${f.toFixed(2)} (${tier.get(f).n})</th>`).join('')}</tr></thead><tbody>
    ${pl.map(([j,s])=>`<tr><td>${tdot(P[j].team)}<button class="plink" data-pc="${j}">${esc(P[j].name)}</button><span class="pos">${P[j].pos}</span></td><td class="n">${pct(s,0)}</td><td class="n"><b>${pct(A.D.get(j)/A.Dt,0)}</b></td>${hasOwn()?`<td class="n">${P[j].own!=null?pct(P[j].own,1):'-'}</td>`:''}${fees.map(f=>{const t=tier.get(f); return `<td class="n">${t.n?pct((t.cnt.get(j)||0)/t.n,0):'-'}</td>`;}).join('')}</tr>`).join('')}</tbody></table></div></div>`;
}
/* DK slot order with late swap in mind: QB RB RB WR WR WR TE FLEX DST, and the FLEX is the latest-kickoff player among the
   positions that have an extra (so FLEX can be swapped for any RB/WR/TE until that game starts) */
function kickT(gi){ const g=ST.games[gi]; if(!g) return 0; const d=/(\d+)\/(\d+)\/(\d+)/.exec(g.date||''), t=/(\d+):(\d+)\s*(AM|PM)/i.exec(g.time||''); return (d?((+d[3])*400+(+d[1])*32+(+d[2]))*1440:0)+(t?((+t[1])%12+(/pm/i.test(t[3])?12:0))*60+(+t[2]):0); }
function dkSlots(L){
  const P=ST.players; const by=(ps)=>L.filter(j=>P[j].pos===ps); const need={RB:2,WR:3,TE:1};
  const rb=by('RB'), wr=by('WR'), te=by('TE'), qb=by('QB'), d=by('DST'); if(qb.length!==1||d.length!==1||rb.length+wr.length+te.length!==7) return L;
  const grp={RB:rb,WR:wr,TE:te}; const cand=[...rb,...wr,...te].filter(j=>grp[P[j].pos].length>need[P[j].pos]);
  if(!cand.length) return L; cand.sort((a,b)=>kickT(P[b].gi)-kickT(P[a].gi)||P[a].salF-P[b].salF); const fx=cand[0];
  const rest=(arr)=>arr.filter(j=>j!==fx).sort((a,b)=>kickT(P[a].gi)-kickT(P[b].gi)||P[b].salF-P[a].salF);
  const R=rest(rb), W=rest(wr), T=rest(te); return [qb[0],R[0],R[1],W[0],W[1],W[2],T[0],fx,d[0]];
}
function entriesCSV(){ // mirror DraftKings' file exactly; only the 9 lineup cells of open entries change
  const A=ST.assign, EN=ST.entries, P=ST.players; const q=(x)=>/[,"\r\n]/.test(x)?`"${String(x).replace(/"/g,'""')}"`:x;
  const byId=new Map(EN.rows.map(e=>[e.id,e]));
  const lines=EN.raw.map((r,ri)=>{ const row=r.slice(); const e=ri>0?byId.get((row[EN.iE]||'').trim()):null;
    if(e&&!e.pre){ const c=A.map.get(e.id); if(c){ const L=dkSlots(c.L); for(let k=0;k<9;k++) row[EN.iQ+k]=P[L[k]].idF; } }
    return row.map(x=>q(x==null?'':String(x))).join(','); });
  return (EN.bom?'﻿':'')+lines.join(EN.eol)+EN.eol;
}
async function saveText(csv,fn,count){
  try{ if(window.claude&&window.claude.use){const dl=await window.claude.use('downloads'); if(dl){await dl.save({filename:fn,data:csv}); toast('Saved '+count); return;}} }catch(e){ if(e&&e.code==='declined') return; }
  try{const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'})); a.download=fn; document.body.appendChild(a); a.click(); a.remove(); toast('Downloaded '+count);}catch(e){toast('Download blocked here');}
}

/* ---------------- cash games ----------------
   The cash field is simulated as people optimizing off public projections: each field lineup is the optimal lineup on the projections
   with a little per-player disagreement noise. That reproduces cash-game habits (chalk value plays, near-max salary, few contrarian spots)
   without needing cash ownership. With a projections file loaded the field uses those numbers; otherwise it uses the sim means.
   Candidate lineups are optimized on a blend of mean and floor (20th percentile), then scored against the field in every sim. */
const CASH0={type:'du',paid:44,mult:2,hpay:1.8,noise:12,F:2000};
function cashCfg(){ const v=(id,d)=>{const e=$('#'+id); return e?e.value:d;}; return {type:v('kType','du'),paid:Math.max(1,Math.min(99,+v('kPaid',44))),mult:Math.max(1,+v('kMult',2)),hpay:Math.max(1,+v('kHpay',1.8)),noise:Math.max(0,+v('kNoise',12)),F:2000}; }
function renderCash(){
  const el=$('#pane-cash'); const R=ST.res; if(!R) return; const c=Object.assign({},CASH0,store.get('cash',{}));
  const src=ST.projMap?`your projections file (${esc(ST.ownLabel||'uploaded')})`:'the sim means (upload a projections file to model the public\'s numbers)';
  el.innerHTML=`<div class="card"><h3>Cash game sim</h3><p class="small muted">The field is simulated as cash players running optimizers off public projections, each with a little disagreement, which reproduces chalk-heavy, floor-chasing cash ownership without needing cash ownership numbers. Field projections: ${src}. Your candidate lineups are optimized on a blend of mean and floor (players unchecked under Use on Slate inputs are left out), then every one is scored against the field in every sim.</p>
    <div class="row small" style="gap:12px;flex-wrap:wrap">
      <label>Contest <select id="kType"><option value="du" ${c.type==='du'?'selected':''}>Double Up / 50-50</option><option value="h2h" ${c.type==='h2h'?'selected':''}>Head-to-head</option></select></label>
      <label title="Share of the field that gets paid">Paid % <input id="kPaid" type="number" min="1" max="99" value="${c.paid}" style="width:56px"></label>
      <label title="Payout as a multiple of the entry fee">Double Up pays <input id="kMult" type="number" step="0.05" min="1" value="${c.mult}" style="width:60px">x</label>
      <label>H2H pays <input id="kHpay" type="number" step="0.05" min="1" value="${c.hpay}" style="width:60px">x</label>
      <label title="How much field players' projections differ from each other. Lower = more concentrated chalk">Field disagreement <input id="kNoise" type="number" min="0" max="40" value="${c.noise}" style="width:52px">%</label>
      <button class="primary" id="kGo">Run cash sim</button><span id="kStatus" class="muted"></span></div>
    <p class="small muted" style="margin-top:6px">Defaults are typical DK numbers (Double Ups pay about the top 44% at 2x; H2H pays 1.8x). Check them against your contest.</p></div>
    <div id="cashOut" style="margin-top:16px"></div>`;
  $$('input,select',el).forEach(i=>i.addEventListener('change',()=>store.set('cash',cashCfg())));
  $('#kGo').onclick=runCash; if(ST.cash&&ST.cash.res===R) renderCashOut();
}
async function runCash(){
  const R=ST.res, P=ST.players, n=R.n, c=cashCfg(); store.set('cash',c); const st=$('#kStatus'); const btn=$('#kGo'); btn.disabled=true;
  try{
    makeWorkers(); const pos=P.map((p,j)=>p.active&&p.salF>0?PCODE[p.pos]:-1), sal=P.map(p=>p.salF);
    const mu=R.stats.map(s=>s.mean), fl=R.stats.map(s=>s.pc[2]);
    const pub=publicProj(P.map((p,j)=>{ if(ST.projMap){ const v=ST.projMap.get(SL.norm(p.name)); if(v!=null) return p.active||vacStale(p)?v:0; } return mu[j]; }));
    const Rn=E.makeRng(777); const gauss=()=>{ let u=0; while(u===0) u=Rn(); return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*Rn()); };
    const optRows=async(rows,label)=>{ const per=Math.ceil(rows.length/NW); const parts=await Promise.all(workers.map((w,k)=>{ const a=k*per, b=Math.min(rows.length,a+per); if(b<=a) return null; const buf=new Float32Array((b-a)*n); for(let i=a;i<b;i++) buf.set(rows[i],(i-a)*n);
        return call(w,{type:'opt',pts:buf,nT:n,n:b-a,pos,sal,meta:null,rules:null,pool:{K:[3,6,8,4,3],KV:[2,3,4,2,2],MX:34}},(d)=>{}); })); const out=[]; parts.forEach(p=>{ if(!p) return; for(let i=0;i<p.n;i++) if(p.opt[i*9]>=0) out.push(Array.from(p.opt.subarray(i*9,i*9+9))); }); return out; };
    // 1. field: optimal lineups on public projections with per-player disagreement noise
    st.textContent='Building the cash field…'; await new Promise(r=>setTimeout(r,0)); const sd=c.noise/100;
    const fieldRows=[]; for(let f=0;f<c.F;f++){ const row=new Float32Array(n); for(let j=0;j<n;j++) row[j]=pub[j]>0?pub[j]*Math.exp(sd*gauss()-sd*sd/2):0; fieldRows.push(row); }
    const FL=await optRows(fieldRows); const nF=FL.length;
    // 2. candidates: optimize on mean/floor blends with light noise, plus the field's own lineups
    st.textContent='Building candidate lineups…'; await new Promise(r=>setTimeout(r,0));
    const candRows=[]; for(const lam of [0,0.35,0.7,1]) for(let k=0;k<150;k++){ const row=new Float32Array(n); for(let j=0;j<n;j++){ const b=(1-lam)*mu[j]+lam*fl[j]; row[j]=ST.portExcl.has(j)?-1e4:(b>0?b*Math.exp(0.06*gauss()):0); } candRows.push(row); }
    const fKeys=new Map(); FL.forEach(L=>{ const k=L.slice().sort((a,b)=>a-b).join(','); fKeys.set(k,(fKeys.get(k)||0)+1); });
    const cand=new Map(); const add=(L)=>{ if(L.some(j=>ST.portExcl.has(j))) return; const k=L.slice().sort((a,b)=>a-b).join(','); if(!cand.has(k)) cand.set(k,{L,key:k}); };
    (await optRows(candRows)).forEach(add); Array.from(fKeys.entries()).sort((a,b)=>b[1]-a[1]).slice(0,200).forEach(([k])=>add(k.split(',').map(Number))); const C=Array.from(cand.values()); const nc=C.length;
    // 3. score field and candidates in every sim
    const S=Math.min(R.N,4000), sims=new Int32Array(S); for(let k=0;k<S;k++) sims[k]=Math.floor(k*R.N/S);
    const fs=new Float32Array(nF), kPaid=Math.max(1,Math.round(nF*c.paid/100));
    const cash=new Float64Array(nc), win=new Float64Array(nc), sum=new Float64Array(nc), scores=C.map(()=>new Float32Array(S)); const lineAvg=[];
    for(let k=0;k<S;k++){ const o=sims[k]*n;
      for(let u=0;u<nF;u++){ let v=0; const L=FL[u]; for(let q=0;q<9;q++) v+=R.pts[o+L[q]]; fs[u]=v; } fs.sort(); const line=fs[nF-kPaid]; lineAvg.push(line);
      for(let u=0;u<nc;u++){ let v=0; const L=C[u].L; for(let q=0;q<9;q++) v+=R.pts[o+L[q]]; scores[u][k]=v; sum[u]+=v; if(v>line) cash[u]++; else if(v===line) cash[u]+=0.5;
        let lo=0,hi=nF; while(lo<hi){ const m=(lo+hi)>>1; if(fs[m]<v) lo=m+1; else hi=m; } let hi2=lo; while(hi2<nF&&fs[hi2]===v) hi2++; win[u]+=(lo+0.5*(hi2-lo))/nF; }
      if(k%400===399){ st.textContent=`Scoring ${nc} lineups against ${nF.toLocaleString()} field lineups… ${Math.round(100*k/S)}%`; await new Promise(r=>setTimeout(r,0)); } }
    C.forEach((o,u)=>{ const sc=scores[u].slice().sort(); const q=(x)=>sc[Math.min(S-1,Math.round(x*(S-1)))]; o.mean=sum[u]/S; o.p10=q(0.1); o.p20=q(0.2); o.p50=q(0.5); o.cash=cash[u]/S; o.win=win[u]/S;
      o.sal=o.L.reduce((a,j)=>a+P[j].salF,0); o.roiDU=o.cash*c.mult-1; o.roiH=o.win*c.hpay-1; o.field=fKeys.has(o.key); });
    const fOwn=new Float64Array(n); FL.forEach(L=>L.forEach(j=>fOwn[j]++)); for(let j=0;j<n;j++) fOwn[j]/=nF;
    lineAvg.sort((a,b)=>a-b);
    ST.cash={res:R,C,fOwn,nF,cfg:c,S,line:[lineAvg[Math.round(0.1*(S-1))],lineAvg[Math.round(0.5*(S-1))],lineAvg[Math.round(0.9*(S-1))]],pub:!!ST.projMap}; ST.cashSel=new Set();
    st.textContent=`${nc} candidate lineups vs a ${nF.toLocaleString()}-lineup cash field over ${S.toLocaleString()} sims`; renderCashOut();
  }catch(e){ console.error(e); st.textContent='Cash sim failed: '+e.message; }
  btn.disabled=false;
}
function renderCashOut(){
  const el=$('#cashOut'); const K=ST.cash; if(!el||!K) return; const P=ST.players, R=ST.res, c=K.cfg; const du=c.type!=='h2h';
  const top=K.C.slice().sort((a,b)=>du?(b.roiDU-a.roiDU||b.p20-a.p20):(b.roiH-a.roiH||b.p20-a.p20)).slice(0,30); const best=top[0];
  const r=(v)=>`<span style="color:var(${v>=0?'--good':'--bad'});font-weight:600">${v>=0?'+':''}${(v*100).toFixed(1)}%</span>`;
  const fieldTop=P.map((p,j)=>({p,j,o:K.fOwn[j]})).filter(x=>x.o>=0.01).sort((a,b)=>b.o-a.o);
  const inBest=new Set(best?best.L:[]);
  el.innerHTML=`<div class="pc-tiles"><div><span class="lbl">Cash line (top ${c.paid}%)</span><b class="num">${fmt(K.line[1],1)}</b><span class="small muted">10th-90th pct of sims: ${fmt(K.line[0],0)} to ${fmt(K.line[2],0)}</span></div>
      <div><span class="lbl">Best ${du?'Double Up':'H2H'} lineup</span><b class="num">${best?(du?pct(best.cash,1)+' cash':pct(best.win,1)+' win'):'-'}</b><span class="small muted">${best?'ROI '+((du?best.roiDU:best.roiH)*100).toFixed(1)+'%':''}</span></div>
      <div><span class="lbl">Field</span><b class="num">${K.nF.toLocaleString()}</b><span class="small muted">built from ${K.pub?'your projections':'sim means'}</span></div></div>
    <div class="card" style="margin-top:12px"><div class="row" style="justify-content:space-between"><h3>Top cash lineups</h3><button id="kDl">Download selected lineups CSV</button></div>
      <p class="small muted">Ranked by ${du?'Double Up':'head-to-head'} ROI. Cash % = share of sims beating the top-${c.paid}% line of the simulated field; H2H win % = chance of beating one random field lineup. Floor = 20th percentile score. "Field" marks a lineup that also appears in the simulated cash field.</p>
      <div class="tw" style="border:0;max-height:620px;overflow:auto"><table><thead><tr><th></th><th class="n">Cash %</th><th class="n">DU ROI</th><th class="n">H2H win %</th><th class="n">H2H ROI</th><th class="n">Mean</th><th class="n">Floor</th><th class="n">p10</th><th class="n">Salary</th>${SLOTS.map(s=>`<th>${s}</th>`).join('')}</tr></thead><tbody>
      ${top.map((o,i)=>`<tr><td><input type="checkbox" class="kSel" data-i="${i}" ${ST.cashSel.has(o.key)?'checked':''} aria-label="Select lineup"></td><td class="n"><b>${pct(o.cash,1)}</b></td><td class="n">${r(o.roiDU)}</td><td class="n">${pct(o.win,1)}</td><td class="n">${r(o.roiH)}</td><td class="n">${fmt(o.mean)}</td><td class="n">${fmt(o.p20)}</td><td class="n">${fmt(o.p10)}</td><td class="n">${o.sal.toLocaleString()}${o.field?' <span class="chip ex">field</span>':''}</td>
        ${dkSlots(o.L).map(j=>`<td class="small">${tdot(P[j].team)}<button class="plink" data-pc="${j}">${esc(P[j].name)}</button></td>`).join('')}</tr>`).join('')}</tbody></table></div></div>
    <div class="card" style="margin-top:16px"><h3>Simulated cash field ownership</h3><p class="small muted">Share of field lineups using each player. Checkmark = in the top-ranked lineup above. Compare with your sense of real cash ownership; lower the field disagreement for more concentrated chalk.</p>
      <div class="tw" style="border:0;max-height:520px;overflow:auto"><table><thead><tr><th>Player</th><th>Team</th><th class="n">Salary</th><th class="n">Field own</th><th class="n">Mean</th><th class="n">Floor</th><th class="n">Pts/$1K</th><th class="n">Top lineup</th></tr></thead><tbody>
      ${fieldTop.map(x=>`<tr><td><button class="pname plink" data-pc="${x.j}">${esc(x.p.name)}</button><span class="pos">${x.p.pos}</span></td><td>${tdot(x.p.team)}${esc(x.p.team)}</td><td class="n">${x.p.salF.toLocaleString()}</td><td class="n"><b>${pct(x.o,1)}</b></td><td class="n">${fmt(R.stats[x.j].mean)}</td><td class="n">${fmt(R.stats[x.j].pc[2])}</td><td class="n">${fmt(R.stats[x.j].mean/(x.p.salF/1000),2)}</td><td class="n">${inBest.has(x.j)?'✓':''}</td></tr>`).join('')}</tbody></table></div></div>`;
  $$('.kSel',el).forEach(b=>b.onchange=()=>{ const o=top[+b.dataset.i]; if(b.checked) ST.cashSel.add(o.key); else ST.cashSel.delete(o.key); });
  $('#kDl').onclick=()=>{ const sel=K.C.filter(o=>ST.cashSel.has(o.key)); if(!sel.length){ toast('Tick at least one lineup'); return; } const csv=SLOTS.join(',')+'\n'+sel.map(o=>dkSlots(o.L).map(j=>P[j].idF).join(',')).join('\n')+'\n'; saveText(csv,'classic_cash_lineups.csv',`${sel.length} lineups`); };
}

/* ---------------- player cards (shared with the Showdown lab) ---------------- */
/*CARDS*/

/* ---------------- boot ---------------- */
function initTabs(){ $$('#tabs button').forEach(b=>b.onclick=()=>{ $$('#tabs button').forEach(x=>x.setAttribute('aria-selected',x===b)); $$('.pane').forEach(p=>p.hidden=p.id!=='pane-'+b.dataset.tab); if(b.dataset.tab==='lineups'&&ST.res&&!$('#pane-lineups').innerHTML) renderPlayers(); if(b.dataset.tab==='live') renderLiveClassic(); }); }
function boot(){
  teamColorCSS(); initTabs();
  const fi=$('#file'), drop=$('#drop');
  const take=(f)=>readUploadSafe(f).then(t=>{ if(loadCSV(t,f.name)) run(); });
  fi.onchange=()=>{const f=fi.files[0]; if(f) take(f);}; drop.onclick=(e)=>{if(e.target.tagName!=='INPUT') fi.click();};
  drop.ondragover=(e)=>{e.preventDefault();drop.classList.add('over');}; drop.ondragleave=()=>drop.classList.remove('over'); drop.ondrop=(e)=>{e.preventDefault();drop.classList.remove('over');const f=e.dataTransfer.files[0]; if(f) take(f);};
  const fo=$('#fileOwn'), dOwn=$('#dropOwn'); fo.onchange=()=>{const f=fo.files[0]; if(f) readUploadSafe(f).then(t=>loadOwnership(t,f.name));};
  dOwn.onclick=(e)=>{if(e.target.tagName!=='INPUT') fo.click();}; dOwn.ondragover=(e)=>{e.preventDefault();dOwn.classList.add('over');}; dOwn.ondragleave=()=>dOwn.classList.remove('over');
  dOwn.ondrop=(e)=>{e.preventDefault();dOwn.classList.remove('over');const f=e.dataTransfer.files[0]; if(f) readUploadSafe(f).then(t=>loadOwnership(t,f.name));};
  $('#runBtn').onclick=run;
  loadCSV($('#sample-csv').textContent.trim(),'Example: DKSalaries.csv (main slate, Oct 11 2026)');
  $('#tabs button[data-tab=slate]').click(); run();
}
boot();
})();
