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
const store={get(k,d){try{const v=localStorage.getItem('sds_'+k);return v?JSON.parse(v):d;}catch(e){return d;}},set(k,v){try{localStorage.setItem('sds_'+k,JSON.stringify(v));}catch(e){}}};

/* ---------------- state ---------------- */
const ST={dk:null,players:[],teams:['',''],implied:[21,21],teamAdj:[{proe:0},{proe:0}],res:null,sel:new Set(),port:null,view:{proj:'chart',mult:1,lineups:'freq'}};
let workers=[]; const NW=Math.max(1,Math.min(4,(navigator.hardwareConcurrency||4)-1));
function makeWorkers(){
  if(workers.length) return;
  const url=URL.createObjectURL(new Blob([ENGINE_SRC,'\n',WORKER_SRC],{type:'text/javascript'}));
  for(let i=0;i<NW;i++){const w=new Worker(url); w.postMessage({type:'init',model:MODEL}); workers.push(w);}
}
function call(w,msg,onProg){return new Promise((res,rej)=>{w.onmessage=(e)=>{const d=e.data; if(d.type==='prog'){onProg&&onProg(d.done);return;} if(d.type==='err'){rej(new Error(d.msg));return;} if(d.type===msg.type) res(d);}; w.onerror=(e)=>rej(new Error(e.message||'worker error')); w.postMessage(msg);});}

/* ---------------- slate load ---------------- */
function loadCSV(text,label){
  let dk; try{dk=SL.parseDK(text);}catch(e){toast('Could not read that CSV');return;}
  if(!dk.players.length){toast('No players found. Use the DraftKings Showdown salary CSV.');return;}
  ST.dk=dk; ST.teams=dk.teams.map(SL.nflTeam);
  ST.players=SL.matchSlate(MODEL,dk).map(p=>Object.assign(p,{sal:p.salF,excl:false,base:{rs:p.rs,ts:p.ts,rsz:p.rsz,tsz:p.tsz,rsy:p.rsy,tpd:p.tpd}}));
  ST.teamAdj=[{proe:0},{proe:0}]; ST.res=null; ST.sel.clear(); ST.port=null;
  const ln=(MODEL.meta.lines||[]).find(l=>l[0]===ST.teams[0]&&l[1]===ST.teams[1]);
  if(ln){const home=(ln[3]+ln[2])/2; ST.implied=[+(ln[3]-home).toFixed(2),+home.toFixed(2)]; ST.line=ln;} else ST.line=null;
  $('#srcLabel').textContent=label||'Uploaded CSV'; { const mn=$('#modelNote'); if(mn) mn.textContent=(MODEL.meta&&MODEL.meta.data)||''; }
  ST.venue=venueOf(ST.teams[0],ST.teams[1]); ST.wx=store.get(wxKey(),null)||{rain:'',snow:'',wind:'',temp:'',open:false,auto:true};
  loadRoles(); loadOverrides(); loadQ(); loadCaps(); renderHeader(); renderWx(); ST.wxPromise=pullWeather(true); ST.props=null; ST.kxMsg=''; ST.slateOrd=null; ST.view.sdTeam=0; ST.kxPromise=kxPull(()=>{ renderSlate(); renderPropsTab(propGames()); }); renderSlate(); renderEmptyResults(); if(ST.projMap) applyProjRoles(); if(ST.own) applyOwnership();
}
/* official team colors: [primary, secondary]; dark mode lifts near-black colors so they show; team 2 switches to its secondary if the two clash */
const TEAM_COL={ARI:['#97233F','#FFB612'],ATL:['#A71930','#A5ACAF'],BAL:['#241773','#9E7C0C'],BUF:['#00338D','#C60C30'],CAR:['#0085CA','#BFC0BF'],CHI:['#0B162A','#C83803'],
  CIN:['#FB4F14','#000000'],CLE:['#311D00','#FF3C00'],DAL:['#003594','#869397'],DEN:['#FB4F14','#002244'],DET:['#0076B6','#B0B7BC'],GB:['#203731','#FFB612'],
  HOU:['#03202F','#A71930'],IND:['#002C5F','#A2AAAD'],JAX:['#006778','#D7A22A'],KC:['#E31837','#FFB81C'],LV:['#000000','#A5ACAF'],LAC:['#0080C6','#FFC20E'],
  LA:['#003594','#FFA300'],MIA:['#008E97','#FC4C02'],MIN:['#4F2683','#FFC62F'],NE:['#002244','#C60C30'],NO:['#D3BC8D','#101820'],NYG:['#0B2265','#A71930'],
  NYJ:['#125740','#000000'],PHI:['#004C54','#A5ACAF'],PIT:['#FFB612','#101820'],SF:['#AA0000','#B3995D'],SEA:['#002244','#69BE28'],TB:['#D50A0A','#34302B'],
  TEN:['#0C2340','#4B92DB'],WAS:['#5A1414','#FFB612']};
const TEAM_ALIAS={LAR:'LA',WSH:'WAS',JAC:'JAX',OAK:'LV',SD:'LAC',STL:'LA'};
function applyTeamColors(){
  const rgb=(h)=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)); const lum=(h)=>{const c=rgb(h).map(v=>{v/=255; return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);}); return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2];};
  const dist=(x,y)=>{const a=rgb(x),b=rgb(y); return Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);};
  const cands=ST.teams.map(t=>TEAM_COL[TEAM_ALIAS[t]||t]); if(!cands[0]||!cands[1]) return;
  // dark mode keeps each team's hue: very dark colors are lifted toward white until they read on the dark panel
  const lift=(h)=>{ let c=rgb(h), t=0; const hex=(c)=>'#'+c.map(v=>Math.round(v).toString(16).padStart(2,'0')).join('').toUpperCase(); let out=h;
    while(lum(out)<0.09&&t<0.9){ t+=0.05; out=hex(c.map(v=>v+(255-v)*t)); } return out; };
  const pick=(dark)=>{ const cs=cands.map(c=>dark?c.map(lift):c); const ok=(h)=>dark||lum(h)<=0.8; const c0=cs[0].find(ok)||cs[0][0];
    const c1=cs[1].filter(ok).sort((x,y)=>(dist(y,c0)>=90)-(dist(x,c0)>=90))[0]||cs[1][0]; return [c0,c1]; };
  const L=pick(false), D=pick(true); let s=$('#teamcol'); if(!s){ s=document.createElement('style'); s.id='teamcol'; document.head.appendChild(s); }
  s.textContent=`:root{--t0:${L[0]};--t1:${L[1]}}@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--t0:${D[0]};--t1:${D[1]}}}:root[data-theme="dark"]{--t0:${D[0]};--t1:${D[1]}}`;
}
function renderHeader(){
  applyTeamColors();
  const [a,b]=ST.teams; const gi=ST.dk?ST.dk.gameInfo.replace(/^[A-Z]+@[A-Z]+\s*/,''):'';
  $('#matchup').innerHTML=`<span class="t0">${esc(a)}</span><span class="at">@</span><span class="t1">${esc(b)}</span>`;
  $('#gameinfo').textContent=gi;
  $('#impA').value=ST.implied[0]; $('#impB').value=ST.implied[1];
  $('#labA').textContent=a+' implied'; $('#labB').textContent=b+' implied';
  $('#vegas').hidden=!ST.line;
  if(ST.line){const sp=ST.line[2]; $('#vegas').textContent=`Vegas: ${sp>=0?b:a} −${Math.abs(sp)}, O/U ${ST.line[3]}`;}
  updateLineNote();
}
function updateLineNote(){
  const a=+$('#impA').value,b=+$('#impB').value; const [ta,tb]=ST.teams;
  $('#lineNote').textContent=`Total ${fmt(a+b,1)} · ${b>=a?tb:ta} −${fmt(Math.abs(b-a),1)}`;
  if($('#wxNote')&&ST.venue!==undefined) renderWx();
}

/* ---------------- Slate tab ---------------- */
function teamIdx(p){return p.team===ST.teams[0]?0:1;}
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
/* opposing-defense funnel (current season only, fit_defense.py): applied pass-rate shift and run-efficiency shift for an offense facing defense `dt` */
function funnelOf(dt){ const m=(MODEL.teams||{})[dt]||{}; const f=m.dfun; if(!f) return null; const pp=(m.dproe||0)*100, yp=f[2]; const lean=pp/1.0-yp/0.1;
  return {pp,yp,raw:f[0]*100,rawY:f[1],plays:f[3],car:f[4],lab:(lean>2||(pp>0.5&&yp<=0.03))?'Pass funnel':(lean<-2||(pp<-0.5&&yp>=-0.03))?'Run funnel':'Neutral'}; }
const funnelTitle=(dt,F)=>`${dt} defense this season (opponent-adjusted): offenses pass ${Math.abs(F.raw).toFixed(1)} pts ${F.raw>=0?'more':'less'} often than their norm and gain ${Math.abs(F.rawY).toFixed(2)} ${F.rawY>=0?'more':'fewer'} yards per carry than their norm (${F.plays} plays, ${F.car} carries). After shrinking for sample size the sim applies ${F.pp>=0?'+':''}${F.pp.toFixed(1)} pts pass rate and ${F.yp>=0?'+':''}${F.yp.toFixed(2)} YPC. Team totals still match the implied totals.`;
function renderSlate(){ keepScroll($('#pane-slate'),_renderSlate); }
const kxGamesAll=()=>[{away:ST.teams[0],home:ST.teams[1],imp:[+$('#impA').value||ST.implied[0],+$('#impB').value||ST.implied[1]]}];
function _renderSlate(){
  const el=$('#pane-slate'); const P=ST.players; const vT=ST.view.sdTeam??0;
  const kxG=[{away:ST.teams[0],home:ST.teams[1],imp:[+$('#impA').value||ST.implied[0],+$('#impB').value||ST.implied[1]]}];
  let html=vacatedCard()+propsCard(kxG)+`<div class="bar"><p class="note small">Shares are each player's cut of his team's designed runs and targets in competitive game states (garbage time excluded), blended from 2026 games with lighter 2025/2024 weight. Short-yardage and pass-down columns are role splits used in those situations. RBs rotate by series: lead duty concentrates on the top backs, and backups mostly get scattered carries rather than whole drives. Inactive players' shares get redistributed to active teammates in proportion at sim time. Edit any value, toggle players, or pick the starting QB, then run.</p>
  <div class="row"><div class="seg" role="group" aria-label="Team">${ST.teams.map((tm,t)=>`<button data-sdt="${t}" aria-pressed="${vT===t}">${esc(tm)}</button>`).join('')}<button data-sdt="both" aria-pressed="${vT==='both'}">Both</button></div><button id="resetShares">Reset to model shares</button></div></div>
  <div class="card" style="padding:0"><div class="tw" style="border:0;border-radius:0"><table class="slateTab"><thead><tr><th>On</th><th>Player</th><th title="Set usage from a league role profile (for players with no data or a new role)">Role</th><th class="n">FLEX $</th><th class="n" title="DraftKings season average from the CSV">DK szn avg</th><th class="n" title="Share of designed runs in normal situations">Run %</th><th class="n" title="Share of targets in normal situations">Tgt %</th><th class="n" title="Inside the 10">RZ run %</th><th class="n" title="Inside the 10">RZ tgt %</th><th class="n" title="3rd/4th and 2 or less">Short-yd run %</th><th class="n" title="3rd/4th and 5+, or two-minute drill">Pass-down tgt %</th><th class="n">Gms 26/all</th></tr></thead>`;
  ST.teams.forEach((tm,t)=>{ if(vT!=='both'&&vT!==t) return;
    const rows=stableSort(P.map((p,j)=>({p,j})).filter(x=>x.p.team===tm),'sd|'+tm,(a,b)=>byPosLoad(a.p,b.p)).map(x=>x.p);
    const off=rows.filter(p=>['QB','RB','WR','TE'].includes(p.pos)&&p.active);
    const sr=off.filter(p=>p.pos!=='QB'||p.isStarterQB).reduce((s,p)=>s+(+p.rs||0),0), st=off.filter(p=>p.pos!=='QB').reduce((s,p)=>s+(+p.ts||0),0);
    const tmm=MODEL.teams[tm]||{};
    html+=`<tbody><tr class="teamhead"><td colspan="12"><div class="row"><h3><span class="tm ${t?'b':'a'}"></span>${esc(tm)}</h3>
      <span class="chip">Pass rate vs expected ${fmt((tmm.proe||0)*100,1)} pts</span>
      ${(()=>{ const od=ST.teams[1-t]; const F=funnelOf(od); return F?`<span class="chip ${F.lab==='Pass funnel'?'ex':F.lab==='Run funnel'?'ok':''}" title="${esc(funnelTitle(od,F))}">vs ${esc(od)} D: pass rate ${F.pp>=0?'+':''}${fmt(F.pp,1)} pts · YPC ${F.yp>=0?'+':''}${fmt(F.yp,2)} · ${F.lab}</span>`:''; })()}
      <label class="small muted" for="tilt${t}">Extra pass tilt</label><input id="tilt${t}" type="number" step="1" value="${(ST.teamAdj[t].proe*100)||0}" title="Percentage points added to pass rate over expected">
      <span class="small muted">Run sum ${fmt(sr*100,0)}% · Tgt sum ${fmt(st*100,0)}%</span></div></td></tr>`;
    for(const p of rows){
      const i=P.indexOf(p); const sk=['QB','RB','WR','TE'].includes(p.pos);
      const flag=(p.forceIn&&(SL.INACTIVE.has((p.status||'').toUpperCase())||(ST.projMap&&(ST.projMap.get(SL.norm(p.name))||0)<=0.05))?'<span class="chip ok" title="You turned him on: overrides his DK status or 0 projection">in (you)</span> ':'')+(p.role?`<span class="chip ok" title="Usage set from the ${esc(ROLES[p.role].label)} profile">role</span> `:'')+(p.mkt?'<span class="chip ok" title="Share set from the Kalshi market split">market</span> ':'')+(p.noGame?`<span class="chip ex" title="No games yet this season while his team has played: his share from a prior role or team is cut to depth level${p.noGameRestored?' (restored: your projections give him a role)':'. Raise it if he is back from injury, or load projections'}">${p.noGameRestored?'restored':'no 2026 games'}</span> `:'')+(p.nextUp?`<span class="chip ok" title="Projected 0 in your file, but ${esc(p.nextUp)} is out and still projected: treated as next man up">next up</span> `:'')+(p.noProj?'<span class="chip bad" title="Projected for 0 points in your projections file: no carries or targets">0 proj</span> ':'')+(!p.matched&&p.pos!=='DST'?'<span class="chip ex" title="No NFL play-by-play history found; default share used">no data</span>':'');
      const st2=p.status?`<span class="chip ${SL.INACTIVE.has(p.status.toUpperCase())?'bad':'ex'}">${esc(p.status)}</span>`:'';
      const qb=p.pos==='QB'?`<label class="small muted" title="Starting QB"><input type="radio" name="qb${t}" data-i="${i}" ${p.isStarterQB?'checked':''}> start</label>`:'';
      html+=`<tr class="${p.active?'':'off'}"><td><input type="checkbox" data-act="${i}" ${p.active?'checked':''} aria-label="Active"></td>
        <td><button class="pname plink" data-pc="${i}">${esc(p.name)}</button><span class="pos">${p.pos}</span> ${st2} ${flag} ${qb} ${qCell(p,i)}</td><td>${roleSelect(p,i)}</td>
        <td class="n">${p.salF.toLocaleString()}</td><td class="n">${fmt(p.avg,1)}</td>`;
      if(sk){for(const f of ['rs','ts','rsz','tsz','rsy','tpd']){ const dis=(p.pos==='QB'&&(f==='ts'||f==='tsz'||f==='tpd'));
          html+=`<td class="n">${dis?'<span class="muted">-</span>':`<input class="share" type="number" step="0.5" min="0" data-f="${f}" data-i="${i}" value="${fmt((+p[f]||0)*100,1)}" aria-label="${f}">`}</td>`;}
        html+=`<td class="n">${p.gc||0}/${p.g||0}</td>`;
      } else html+=`<td colspan="7" class="muted small">${p.pos==='K'?'FG/XP model with kicker accuracy adjustment':'Sacks, turnovers, return TDs, points allowed'}</td>`;
      html+='</tr>';
    }
    html+=teamTotRow(off,['rs','ts','rsz','tsz','rsy','tpd'],5,1);
    html+='</tbody>';
  });
  html+='</table></div></div>';
  el.innerHTML=html; bindProps(el,kxG,()=>renderSlate());
  $$('input[data-f]',el).forEach(inp=>inp.addEventListener('change',()=>{const p=ST.players[+inp.dataset.i]; p[inp.dataset.f]=Math.max(0,(+inp.value||0)/100); markStale();
    // update the team total in place (no full re-render, so your place and the next field you tabbed to are kept)
    const tr=inp.closest('tbody')&&inp.closest('tbody').querySelector('tr.tot'); if(tr){ const off=ST.players.filter(q=>q.team===p.team&&['QB','RB','WR','TE'].includes(q.pos)&&q.active); tr.outerHTML=teamTotRow(off,['rs','ts','rsz','tsz','rsy','tpd'],5,1); } }));
  $$('input[data-act]',el).forEach(inp=>inp.addEventListener('change',()=>{const p=ST.players[+inp.dataset.act]; setPlays(p,inp.checked); if(p.pos==='QB') fixQB(p.team); if(ST.projMap) applyProjRoles(); markStale(); renderSlate();}));
  $$('input[type=radio]',el).forEach(inp=>inp.addEventListener('change',()=>{const p=ST.players[+inp.dataset.i]; ST.players.filter(q=>q.team===p.team&&q.pos==='QB').forEach(q=>q.isStarterQB=0); p.isStarterQB=1; p.active=true; markStale(); renderSlate();}));
  [0,1].forEach(t=>{const inp=$('#tilt'+t,el); inp&&inp.addEventListener('change',()=>{ST.teamAdj[t].proe=(+inp.value||0)/100; markStale();});});
  bindVacated(el);
  $$('button[data-sdt]',el).forEach(b=>b.onclick=()=>{ ST.view.sdTeam=b.dataset.sdt==='both'?'both':+b.dataset.sdt; ST.slateOrd=null; renderSlate(); });
  bindRoles(el); bindQ(el,renderSlate);
  $('#resetShares').onclick=()=>{ST.slateOrd=null; ST.players.forEach(p=>{ applyRole(p,''); Object.assign(p,p.base); delete p.mkt; delete p.mktGrp; }); kxResetMarket(); saveRoles(); markStale(); renderSlate();};
}
function fixQB(tm){const qbs=ST.players.filter(q=>q.team===tm&&q.pos==='QB');if(!qbs.some(q=>q.isStarterQB&&q.active)){qbs.forEach(q=>q.isStarterQB=0);const a=qbs.filter(q=>q.active).sort((x,y)=>y.salF-x.salF)[0];if(a)a.isStarterQB=1;}}
function markStale(){if(ST.res) $('#stale').hidden=false;}

/* ---------------- weather (one game): forecast pull on slate load, manual edits saved per game ---------------- */
const wxKey=()=>'wx_'+(ST.dk?ST.dk.gameInfo:ST.teams.join('@'));
const wxTotOn=()=>store.get('wxTot',true);
const wxNow=()=>wxParams(Object.assign({roof:ST.venue&&ST.venue.roof},ST.wx));
function renderWx(){ const w=ST.wx||{}, v=ST.venue||{}; const covered=(v.roof==='dome'||v.roof==='retract')&&!w.open;
  ['rain','snow','wind','temp'].forEach(f=>{ const i=$('#wx'+f[0].toUpperCase()+f.slice(1)); if(i){ i.value=w[f]??''; i.disabled=covered; } });
  $('#wxOpenL').hidden=v.roof!=='retract'; $('#wxOpen').checked=!!w.open; $('#wxTot').checked=wxTotOn();
  $('#wxVenue').textContent=v.name?`· ${v.name}${v.roof==='dome'?' (dome)':v.roof==='retract'?' (retractable, assumed closed)':''}`:'';
  const z=wxNow(); const imp=[+$('#impA').value||0,+$('#impB').value||0]; const ti=wxImplied(imp,z,wxTotOn());
  $('#wxNote').textContent=(z.covered?'Under a roof: no weather effect.':z.active?wxSummary(z)+(wxTotOn()&&Math.abs(ti[0]+ti[1]-imp[0]-imp[1])>=0.05?` → sims target ${ti[0]} / ${ti[1]}`:''):'No weather adjustment.')+(w.detail?` (${w.detail}${w.gust?', gusts '+w.gust+' mph':''})`:''); }
async function pullWeather(silent){ const v=ST.venue; if(!v||!ST.dk) return; if(silent&&ST.wx&&!ST.wx.auto) return; if((v.roof==='dome'||v.roof==='retract')&&!ST.wx.open){ renderWx(); return; }
  const m=/(\d{2}\/\d{2}\/\d{4})\s+(\d{1,2}:\d{2}\s*[AP]M)/i.exec(ST.dk.gameInfo||''); $('#wxNote').textContent='Pulling forecast…';
  try{ const f=await fetchForecast(v,m&&m[1],m&&m[2]); ST.wx=Object.assign({},ST.wx,{rain:f.rain,snow:f.snow,wind:f.wind,temp:f.temp,detail:f.detail,gust:f.gust,at:f.at,auto:true}); store.set(wxKey(),ST.wx); markStale(); renderWx(); }
  catch(e){ renderWx(); $('#wxNote').textContent=`Forecast pull failed: ${e.message}. Enter conditions by hand.`; } }
function bindWx(){
  $('#wxPull').onclick=()=>{ if(ST.wx) ST.wx.auto=true; pullWeather(false); };
  ['rain','snow','wind','temp'].forEach(f=>{ const i=$('#wx'+f[0].toUpperCase()+f.slice(1)); i.onchange=()=>{ ST.wx=Object.assign({},ST.wx,{[f]:i.value===''?'':+i.value,auto:false,detail:'edited by you'}); store.set(wxKey(),ST.wx); markStale(); renderWx(); }; });
  $('#wxOpen').onchange=(e)=>{ ST.wx=Object.assign({},ST.wx,{open:e.target.checked}); store.set(wxKey(),ST.wx); markStale(); renderWx(); };
  $('#wxTot').onchange=(e)=>{ store.set('wxTot',e.target.checked); markStale(); renderWx(); };
}
/* ---------------- run ---------------- */
function buildSlate(){
  const VA=adjustVacated().sh;
  return {weather:wxNow(),teams:ST.teams,teamAdj:ST.teamAdj.map((x,t)=>({proe:(x.proe||0)+kxTiltOf(ST.teams[t])})),players:ST.players.map((p,j)=>({name:p.name,team:p.team,pos:p.pos,mid:p.mid,active:p.active,rs:VA[j].rs,ts:VA[j].ts,rsz:VA[j].rsz,tsz:VA[j].tsz,rsy:VA[j].rsy,tpd:VA[j].tpd,isStarterQB:p.isStarterQB||0,sal:p.salF,salF:p.salF,salC:p.salC,avg:p.avg,ownC:p.ownC,ownF:p.ownF}))};
}
async function run(){
  if(!ST.players.length) return;
  { const ps=[ST.wxPromise,ST.kxPromise].filter(Boolean); ST.wxPromise=ST.kxPromise=null; if(ps.length) await Promise.race([Promise.all(ps),new Promise(r=>setTimeout(r,6000))]); } // let the forecast and props land before the first run
  makeWorkers();
  const N=Math.max(500,Math.min(50000,+$('#nsims').value||10000));
  ST.implied=[+$('#impA').value||20,+$('#impB').value||20]; ST.impliedWx=wxImplied(ST.implied,wxNow(),wxTotOn());
  const btn=$('#runBtn'); btn.disabled=true; $('#stale').hidden=true;
  const bar=$('#prog>div'); const stat=$('#status'); bar.style.width='0%';
  try{
    if(kxQbOn()){ stat.textContent='Setting each team\'s pass rate and QB designed runs from the QB props…'; try{ await kxQbApply(kxGamesAll(),kxMeasure); }catch(e){ console.error(e); } }
    const slate=buildSlate(); const variants=qSlates(ST.players,buildSlate); const vArg=variants.length>1?variants:null;
    stat.textContent='Calibrating team strength to implied totals…';
    const cal=await call(workers[0],{type:'calib',slate,implied:ST.impliedWx,n:1500,seed:Date.now()%100000});
    const elig=slate.players.map((p,i)=>i).filter(i=>slate.players[i].active&&slate.players[i].salF>0);
    const tb=slate.players.map(p=>(p.rs+p.ts)+(p.pos==='K'||p.pos==='DST'?0.1:0));
    stat.textContent=`Simulating ${N.toLocaleString()} games…`;
    const per=Math.ceil(N/NW); const done=new Array(NW).fill(0);
    const parts=await Promise.all(workers.map((w,k)=>{const n=Math.min(per,N-k*per); if(n<=0) return null;
      return call(w,{type:'sim',slate,variants:vArg,s:cal.s,n,seed:(Date.now()+k*7919)>>>0,eligible:elig,tb},(d)=>{done[k]=d;bar.style.width=(100*done.reduce((a,b)=>a+b,0)/N).toFixed(1)+'%';});}));
    bar.style.width='100%'; stat.textContent='Scoring lineups…';
    await new Promise(r=>setTimeout(r,20));
    analyze(parts.filter(Boolean),slate,cal);
    stat.textContent=`${ST.res.N.toLocaleString()} sims · mean score ${ST.teams[0]} ${fmt(ST.res.meanScore[0])} - ${ST.teams[1]} ${fmt(ST.res.meanScore[1])} (targets ${ST.impliedWx[0]} / ${ST.impliedWx[1]}${ST.impliedWx[0]+ST.impliedWx[1]!==ST.implied[0]+ST.implied[1]?', weather-adjusted':''})`;
    renderAll(); if(ST.kxQb&&Object.keys(ST.kxQb).length&&typeof renderSlate==='function') renderSlate();
    runPstats(slate,cal.s,vArg);
  }catch(e){console.error(e); stat.textContent='Run failed: '+e.message;}
  btn.disabled=false;
}
const propGames=()=>[{away:ST.teams[0],home:ST.teams[1],ps:ST.res&&ST.res.ps,psM:ST.res&&ST.res.psM,idx:(j)=>j}];
async function runPstats(slate,s,variants){ const tok=ST.psTok=(ST.psTok||0)+1; const per=Math.ceil(4000/NW);
  try{ const parts=await Promise.all(workers.map((w,k)=>call(w,{type:'pstats',slate,variants,s,n:per,seed:991+k*31}))); if(tok!==ST.psTok||!ST.res) return;
    const g0=parts[0].games[0]; let n=0; parts.forEach(p=>n+=p.games[0].n); const data=new Float32Array(n*g0.np*g0.K); let o=0; parts.forEach(p=>{ data.set(p.games[0].data,o); o+=p.games[0].data.length; });
    ST.res.ps={np:g0.np,K:g0.K,n,data}; ST.res.psM=null; renderPropsTab(propGames());
    // Model sim: the same box-score sims with every Kalshi input removed, so Props vs sim is not graded against itself
    if(!kxAnyMarket()){ ST.res.psM=ST.res.ps; renderPropsTab(propGames()); return; }
    const [mslate,mv]=kxModelSwap(()=>{ const v=qSlates(ST.players,buildSlate); return [buildSlate(),v.length>1?v:null]; });
    const mp=await Promise.all(workers.map((w,k)=>call(w,{type:'pstats',slate:mslate,variants:mv,s,n:per,seed:1291+k*31}))); if(tok!==ST.psTok||!ST.res) return;
    let mn=0; mp.forEach(p=>mn+=p.games[0].n); const md=new Float32Array(mn*g0.np*g0.K); let mo=0; mp.forEach(p=>{ md.set(p.games[0].data,mo); mo+=p.games[0].data.length; });
    ST.res.psM={np:g0.np,K:g0.K,n:mn,data:md}; renderPropsTab(propGames()); }catch(e){ console.error(e); } }
// quick sim of the current setup for the QB props: calibrated, 1,200 box scores
async function kxMeasure(){ const slate=buildSlate(); const imp=wxImplied([+$('#impA').value||ST.implied[0],+$('#impB').value||ST.implied[1]],wxNow(),wxTotOn());
  const cal=await call(workers[0],{type:'calib',slate,implied:imp,n:900,seed:4242}); const per=Math.ceil(1200/NW);
  const parts=await Promise.all(workers.map((w,k)=>call(w,{type:'pstats',slate,s:cal.s,n:per,seed:577+k})));
  const g0=parts[0].games[0]; let n=0; parts.forEach(p=>n+=p.games[0].n); const data=new Float32Array(n*g0.np*g0.K); let o=0; parts.forEach(p=>{ data.set(p.games[0].data,o); o+=p.games[0].data.length; });
  return kxPsTeamMeans({np:g0.np,K:g0.K,n,data},ST.players.map((p,j)=>[j,j]),ST.players); }

/* ---------------- analysis ---------------- */
function analyze(parts,slate,cal){
  const n=slate.players.length; let N=0; parts.forEach(p=>N+=p.n);
  const W2=2*E.NS+1; const pts=new Float32Array(N*n), sm=new Float32Array(N*8), sf=new Float32Array(N*W2), opt=new Int16Array(N*6), ov=new Float32Array(N);
  let o=0; for(const p of parts){pts.set(p.pts,o*n); sm.set(p.sm,o*8); sf.set(p.sf,o*W2); opt.set(p.opt,o*6); ov.set(p.ov,o); o+=p.n;}
  const P=slate.players;
  // per-player distribution
  const stats=P.map((p,j)=>{const col=new Float32Array(N); let s=0; for(let i=0;i<N;i++){const v=pts[i*n+j]; col[i]=v; s+=v;} col.sort();
    const q=(x)=>col[Math.min(N-1,Math.max(0,Math.round(x*(N-1))))];
    return {mean:s/N,pc:[0,.1,.2,.3,.4,.5,.6,.7,.8,.9,1].map(q),p95:q(.95),p99:q(.99),cpt:0,flex:0};});
  // optimal lineups
  const counts=new Map(); let okN=0;
  for(let i=0;i<N;i++){ if(opt[i*6]<0) continue; okN++; const L=Array.from(opt.subarray(i*6,i*6+6)); stats[L[0]].cpt++; for(let k=1;k<6;k++) stats[L[k]].flex++;
    const key=E.lineupKey(L); const c=counts.get(key); if(c) c.n++; else counts.set(key,{L,n:1}); }
  stats.forEach(s=>{s.cpt/=okN;s.flex/=okN;});
  // optimal score per sim (exact)
  const optV=new Float32Array(N); for(let i=0;i<N;i++){ if(opt[i*6]<0) continue; let v=1.5*pts[i*n+opt[i*6]]; for(let k=1;k<6;k++) v+=pts[i*n+opt[i*6+k]]; optV[i]=v; }
  // game scripts
  const tot=new Float32Array(N); let ms=[0,0]; for(let i=0;i<N;i++){tot[i]=sm[i*8]+sm[i*8+1]; ms[0]+=sm[i*8]; ms[1]+=sm[i*8+1];}
  const medT=Float32Array.from(tot).sort()[N>>1];
  const script=new Uint8Array(N);
  for(let i=0;i<N;i++){const a=sm[i*8],b=sm[i*8+1]; const w=b>a?1:(a>b?0:(i&1)); const mg=Math.abs(a-b); script[i]=w*4+(mg>=10?2:0)+(tot[i]>medT?1:0);}
  const scripts=[]; for(let k=0;k<8;k++){scripts.push({k,n:0,sa:0,sb:0,pm:new Float64Array(n),cpt:new Float64Array(n)});}
  for(let i=0;i<N;i++){const S=scripts[script[i]]; S.n++; S.sa+=sm[i*8]; S.sb+=sm[i*8+1]; for(let j=0;j<n;j++) S.pm[j]+=pts[i*n+j]; if(opt[i*6]>=0) S.cpt[opt[i*6]]++;}
  scripts.forEach(S=>{if(S.n){S.sa/=S.n;S.sb/=S.n;for(let j=0;j<n;j++){S.pm[j]/=S.n;S.cpt[j]/=S.n;}} const w=S.k>>2, bl=(S.k>>1)&1, hi=S.k&1;
    S.name=`${ST.teams[w]} ${bl?'by 10+':'by under 10'}, ${hi?'high':'low'} total`; S.p=S.n/N;});
  ST.res={implied:ST.impliedWx.slice(),N,n,P,pts,sm,sf,opt,ov:optV,stats,counts,scripts,script,medT,meanScore:[ms[0]/N,ms[1]/N],cal,slate};
  // lineup tables
  const freq=Array.from(counts.values()).sort((a,b)=>b.n-a.n).slice(0,250).map(c=>c.L);
  const meanV=Float64Array.from(stats.map(s=>s.mean));
  const elig=P.map((p,i)=>i).filter(i=>P[i].active&&P[i].salF>0);
  const G={P:P.map(p=>({salF:p.salF,salC:p.salC,team:p.team})),T:[{ab:ST.teams[0]},{ab:ST.teams[1]}]};
  const topMean=E.topK(G,{eligible:elig},meanV,120).map(h=>h.L);
  const ceilV=Float64Array.from(stats.map(s=>s.pc[9]));
  const topCeil=E.topK(G,{eligible:elig},ceilV,80).map(h=>h.L);
  ST.res.G=G; ST.res.elig=elig;
  const seen=new Map(); const add=(L,src)=>{const k=E.lineupKey(L); if(!seen.has(k)) seen.set(k,{L,key:k,src:new Set()}); seen.get(k).src.add(src);};
  freq.forEach(L=>add(L,'freq')); topMean.forEach(L=>add(L,'mean')); topCeil.forEach(L=>add(L,'ceil'));
  ST.res.lineups=Array.from(seen.values()).map(c=>evalLineup(c));
}
function evalLineup(c){
  const {N,n,pts,ov,counts,P}=ST.res; const L=c.L; const sc=new Float32Array(N); let s=0,near=0,mx=-1;
  for(let i=0;i<N;i++){let v=1.5*pts[i*n+L[0]]; for(let k=1;k<6;k++) v+=pts[i*n+L[k]]; sc[i]=v; s+=v; if(v>=0.9*ov[i]) near++; if(v>mx) mx=v;}
  sc.sort(); const cc=counts.get(c.key||E.lineupKey(L));
  return Object.assign(c,{key:c.key||E.lineupKey(L),mean:s/N,p90:sc[Math.floor(.9*(N-1))],p99:sc[Math.floor(.99*(N-1))],max:mx,opt:cc?cc.n/N:0,near:near/N,
    sal:P[L[0]].salC+L.slice(1).reduce((a,j)=>a+P[j].salF,0)});
}

/* ---------------- render: projections ---------------- */
function renderAll(){ST.pbp=null; ST.corrDone=false; renderProj(); renderPropsTab(propGames()); renderLineups(); renderPortfolioSetup(); renderScripts(); $('#pane-corr').innerHTML=''; $('#pane-pbp').innerHTML=''; $('#pane-cash').innerHTML=''; $('#pane-game').innerHTML=''; $('#tabs button[data-tab=proj]').click();}
function renderEmptyResults(){
  const msg='<p class="note">Run the simulation to fill this view.</p>';
  ['proj','lineups','port','scripts','corr','pbp','cash','game'].forEach(t=>$('#pane-'+t).innerHTML=msg); renderPropsTab(propGames());
}
function strip(pc,mean,max,w,c){
  const x=(v)=>4+Math.max(0,Math.min(1,v/max))*(w-8); const h=22;
  let s=`<svg class="strip" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Percentiles">`;
  s+=`<line x1="${x(pc[0])}" x2="${x(pc[10])}" y1="11" y2="11" stroke="var(--muted)" stroke-width="1"/>`;
  s+=`<rect x="${x(pc[1])}" y="6" width="${Math.max(1,x(pc[9])-x(pc[1]))}" height="10" fill="${c}" fill-opacity=".22"/>`;
  s+=`<rect x="${x(pc[3])}" y="6" width="${Math.max(1,x(pc[7])-x(pc[3]))}" height="10" fill="${c}" fill-opacity=".5"/>`;
  for(let k=1;k<10;k++) s+=`<line x1="${x(pc[k])}" x2="${x(pc[k])}" y1="${k===5?3:8}" y2="${k===5?19:14}" stroke="${k===5?'var(--ink)':c}" stroke-width="${k===5?2:1}"/>`;
  s+=`<circle cx="${x(mean)}" cy="11" r="2.6" fill="var(--ink)"/></svg>`; return s;
}
/* 3-color column scale (Excel style): green above the column median, red below; top end clipped near the 98th pct so one outlier doesn't wash out the rest */
const colScale=(vals)=>{ const s=vals.filter(v=>isFinite(v)).sort((a,b)=>a-b); if(!s.length) return ()=>''; const lo=s[0], mid=s[s.length>>1], hi=s[Math.max(0,s.length-1-Math.max(1,Math.floor(s.length*0.02)))]||s[s.length-1];
  return (v)=>{ if(!(s[s.length-1]>lo)||!isFinite(v)) return ''; if(v>mid){ const f=Math.min(1,hi>mid?(v-mid)/(hi-mid):1); return `style="background:color-mix(in srgb, var(--good) ${Math.round(12+Math.pow(f,0.8)*50)}%, var(--panel))"`; }
    if(v<mid){ const f=Math.min(1,mid>lo?(mid-v)/(mid-lo):1); return `style="background:color-mix(in srgb, var(--bad) ${Math.round(6+f*30)}%, var(--panel))"`; } return ''; }; };
function renderProj(){
  const R=ST.res, el=$('#pane-proj'); if(!R) return;
  const m=ST.view.mult; const P=R.P;
  const fP=ST.view.pf||'ALL', fT=ST.view.tf||'ALL';
  let rows=P.map((p,j)=>({p,j,s:R.stats[j]})).filter(r=>r.p.active&&(r.s.mean>0.05||r.s.cpt+r.s.flex>0)&&(fP==='ALL'||r.p.pos===fP)&&(fT==='ALL'||r.p.team===fT));
  const key=ST.view.projSort||'mean'; const dir=ST.view.projDir||-1;
  const val=(r)=>key==='ownc'?(r.p.ownC||0):key==='ownf'?(r.p.ownF||0):key==='levc'?r.s.cpt-(r.p.ownC||0):key==='levf'?r.s.flex-(r.p.ownF||0):key==='mean'?r.s.mean:key==='cpt'?r.s.cpt:key==='flex'?r.s.flex:key==='tot'?r.s.cpt+r.s.flex:key==='sal'?r.p.salF:key==='val'?r.s.mean/r.p.salF:key==='p90'?r.s.pc[9]:r.s.pc[5];
  rows.sort((a,b)=>dir*(val(a)-val(b)));
  const max=Math.max(1,...rows.map(r=>r.s.pc[10]*m)); const W=300;
  const ticks=[0,0.25,0.5,0.75,1].map(f=>Math.round(max*f));
  const axis=`<svg class="strip" width="${W}" height="14" viewBox="0 0 ${W} 14">${ticks.map(t=>`<text x="${4+(t/max)*(W-8)}" y="11" text-anchor="middle">${t}</text>`).join('')}</svg>`;
  const th=(k,l,cls='n')=>`<th class="sort ${cls}" data-k="${k}">${l}${key===k?(dir<0?' ▾':' ▴'):''}</th>`;
  let h=`<div class="bar"><div class="row"><div class="seg" role="group" aria-label="Points basis"><button data-m="1" aria-pressed="${m===1}">FLEX pts</button><button data-m="1.5" aria-pressed="${m===1.5}">CPT pts (1.5×)</button></div>
    <div class="seg" role="group" aria-label="View"><button data-v="chart" aria-pressed="${ST.view.proj==='chart'}">Chart</button><button data-v="table" aria-pressed="${ST.view.proj==='table'}">Percentile table</button></div>
    <label class="small">Team <select id="pTeam"><option value="ALL">Both</option>${ST.teams.map(t=>`<option ${t===fT?'selected':''}>${esc(t)}</option>`).join('')}</select></label>
    <label class="small">Position <select id="pPos">${['ALL','QB','RB','WR','TE','DST','K'].map(x=>`<option ${x===fP?'selected':''}>${x}</option>`).join('')}</select></label></div>
    <span class="small muted">Band = 10th-90th pct, dark band = 30th-70th, black tick = median, dot = mean, whisker = min-max. Click a name for the player card, anywhere else on the row for correlations.${hasOwn()?' Leverage = sim optimal rate minus projected ownership, in percentage points.':''}</span></div>
    <div class="tw"><table><thead><tr><th>Player</th>${th('sal','Sal FLEX / CPT')}${th('mean','Mean')}${th('med','Median')}${th('p90','90th')}${th('val','Pts/$1k')}${th('cpt','CPT opt %')}${th('flex','FLEX opt %')}${th('tot','Total opt %')}${hasOwn()?th('ownc','CPT own')+th('levc','CPT lev')+th('ownf','FLEX own')+th('levf','FLEX lev'):''}`;
  h+= ST.view.proj==='chart'? `<th>${axis}</th>` : ['Min','10','20','30','40','50','60','70','80','90','Max'].map(x=>`<th class="n">${x}</th>`).join('');
  h+='</tr></thead><tbody>';
  const mx=Math.max(...rows.map(r=>Math.max(r.s.cpt,r.s.flex)),0.01);
  const cmax=(f)=>Math.max(1e-9,...rows.map(f)); const valf=(r)=>r.s.mean*m/((m===1?r.p.salF:r.p.salC)/1000||1);
  const vals=rows.filter(r=>r.p.salF>0&&r.s.mean>1).map(valf); const vmin=vals.length?Math.min(...vals):0;
  const MX={mean:cmax(r=>r.s.mean),med:cmax(r=>r.s.pc[5]),p90:cmax(r=>r.s.pc[9]),val:cmax(r=>r.p.salF>0?valf(r):0),cpt:cmax(r=>r.s.cpt),flex:cmax(r=>r.s.flex),tot:cmax(r=>r.s.cpt+r.s.flex),pc:cmax(r=>r.s.pc[10])};
  const heat=(v,mx,tok,mn=0)=>{const f=Math.max(0,Math.min(1,(v-mn)/((mx-mn)||1))); return `style="background:color-mix(in srgb, var(${tok}) ${Math.round(Math.pow(f,0.75)*58+(f>0?4:0))}%, var(--panel))"`;};
  const CS={mean:colScale(rows.map(r=>r.s.mean)),pc:Array.from({length:11},(_,k)=>colScale(rows.map(r=>r.s.pc[k])))};
  for(const r of rows){const p=r.p,s=r.s; const c=teamIdx(p)?'var(--t1)':'var(--t0)';
    h+=`<tr data-j="${r.j}" style="cursor:pointer"><td class="tcell ${teamIdx(p)?'b':'a'}"><span class="tm ${teamIdx(p)?'b':'a'}"></span><button class="pname plink" data-pc="${r.j}">${esc(p.name)}</button><span class="pos">${p.pos}</span></td>
      <td class="n">${p.salF.toLocaleString()} / ${p.salC.toLocaleString()}</td><td class="n" ${CS.mean(s.mean)}><b>${fmt(s.mean*m)}</b></td><td class="n" ${CS.pc[5](s.pc[5])}>${fmt(s.pc[5]*m)}</td><td class="n" ${CS.pc[9](s.pc[9])}>${fmt(s.pc[9]*m)}</td><td class="n" ${p.salF>0&&r.s.mean>1?heat(valf(r),MX.val,'--flex',vmin):''}>${p.salF>0?fmt(valf(r),2):'-'}</td>
      <td class="n" ${heat(s.cpt,MX.cpt,'--cpt')}>${pct(s.cpt)}</td><td class="n" ${heat(s.flex,MX.flex,'--flex')}>${pct(s.flex)}</td><td class="n" ${heat(s.cpt+s.flex,MX.tot,'--accent')}><b>${pct(s.cpt+s.flex)}</b></td>`;
    if(hasOwn()){ const oc=p.ownC, of=p.ownF; const lc=oc!=null?s.cpt-oc:null, lf=of!=null?s.flex-of:null;
      const lv=(v)=>v==null?'<td class="n">-</td>':`<td class="n" style="background:color-mix(in srgb, var(${v>=0?'--good':'--bad'}) ${Math.round(Math.min(1,Math.abs(v)/0.15)*40)}%, var(--panel))">${v>=0?'+':''}${(v*100).toFixed(1)}</td>`;
      h+=`<td class="n">${oc!=null?pct(oc):'-'}</td>${lv(lc)}<td class="n">${of!=null?pct(of):'-'}</td>${lv(lf)}`; }
    h+= ST.view.proj==='chart'? `<td>${strip(s.pc.map(v=>v*m),s.mean*m,max,W,c)}</td>` : s.pc.map((v,k)=>`<td class="n" ${CS.pc[k](v)}>${fmt(v*m)}</td>`).join('');
    h+='</tr>';}
  h+='</tbody></table></div><div id="corrBox" class="card corr" hidden></div>';
  el.innerHTML=h;
  $$('.seg button[data-m]',el).forEach(b=>b.onclick=()=>{ST.view.mult=+b.dataset.m;renderProj();});
  $$('.seg button[data-v]',el).forEach(b=>b.onclick=()=>{ST.view.proj=b.dataset.v;renderProj();});
  $('#pTeam',el).onchange=(e)=>{ST.view.tf=e.target.value;renderProj();}; $('#pPos',el).onchange=(e)=>{ST.view.pf=e.target.value;renderProj();};
  $$('th.sort',el).forEach(t=>t.onclick=()=>{const k=t.dataset.k; if(ST.view.projSort===k) ST.view.projDir=-(ST.view.projDir||-1); else {ST.view.projSort=k;ST.view.projDir=-1;} renderProj();});
  $$('tbody tr',el).forEach(tr=>tr.onclick=()=>showCorr(+tr.dataset.j));
}
function showCorr(j){
  const R=ST.res,{N,n,pts,P}=R; const box=$('#corrBox'); const mean=R.stats.map(s=>s.mean);
  const sd=new Float64Array(n), cov=new Float64Array(n);
  for(let i=0;i<N;i++){const a=pts[i*n+j]-mean[j]; for(let k=0;k<n;k++){const b=pts[i*n+k]-mean[k]; cov[k]+=a*b; sd[k]+=b*b;}}
  const out=[]; for(let k=0;k<n;k++){ if(k===j||!P[k].active||mean[k]<0.5) continue; const r=cov[k]/Math.sqrt(sd[j]*sd[k]); if(isFinite(r)) out.push([k,r]); }
  out.sort((a,b)=>b[1]-a[1]);
  const li=(arr)=>arr.map(([k,r])=>`<div class="row" style="justify-content:space-between"><span><span class="tm ${teamIdx(P[k])?'b':'a'}"></span>${esc(P[k].name)} <span class="pos">${P[k].pos}</span></span><span class="num">${r>=0?'+':''}${r.toFixed(2)}</span></div>`).join('');
  box.innerHTML=`<h3>${esc(P[j].name)}: correlation with others across sims</h3><div class="grid2"><div><div class="lbl">Most positive</div>${li(out.slice(0,6))}</div><div><div class="lbl">Most negative</div>${li(out.slice(-6).reverse())}</div></div>`;
  box.hidden=false; box.scrollIntoView({behavior:'smooth',block:'nearest'});
}

/* ---------------- render: lineups ---------------- */
function lineupCells(L){const P=ST.res.P; return `<td><button class="cptc plink" data-pc="${L[0]}">${esc(P[L[0]].name)}</button></td><td class="small">${L.slice(1).map(j=>`<button class="plink" data-pc="${j}">${esc(P[j].name)}</button>`).join(' · ')}</td>`;}
function lineupRow(c,extra=''){
  const ck=ST.sel.has(c.key)?'checked':'';
  return `<tr><td><input type="checkbox" data-key="${esc(c.key)}" ${ck} aria-label="Select lineup"></td>${extra}${lineupCells(c.L)}<td class="n">${c.sal.toLocaleString()}</td><td class="n">${fmt(c.mean)}</td><td class="n">${fmt(c.p90)}</td><td class="n">${fmt(c.max)}</td><td class="n">${pct(c.opt,2)}</td><td class="n">${pct(c.near)}</td></tr>`;
}
const LHEAD='<th></th><th>Captain</th><th>Flex</th><th class="n">Salary</th><th class="n">Mean</th><th class="n">90th</th><th class="n">Max</th><th class="n">Optimal %</th><th class="n">Within 10% of optimal</th>';
function renderLineups(){
  const R=ST.res, el=$('#pane-lineups'); if(!R) return; const v=ST.view.lineups;
  let list=R.lineups.slice();
  if(v==='freq') list=list.filter(c=>c.opt>0).sort((a,b)=>b.opt-a.opt||b.mean-a.mean);
  else if(v==='mean') list.sort((a,b)=>b.mean-a.mean); else list.sort((a,b)=>b.p90-a.p90);
  list=list.slice(0,100);
  let h=`<div class="bar"><div class="seg" role="group" aria-label="Lineup list"><button data-l="freq" aria-pressed="${v==='freq'}">Most often optimal</button><button data-l="mean" aria-pressed="${v==='mean'}">Highest mean</button><button data-l="p90" aria-pressed="${v==='p90'}">Highest ceiling (90th)</button></div>
    <span class="small muted">${R.counts.size.toLocaleString()} different lineups were optimal in at least one sim. "Within 10% of optimal" = share of sims where the lineup scored at least 90% of that sim's best possible lineup.</span></div>
    <div class="tw"><table><thead><tr>${LHEAD}</tr></thead><tbody>${list.map(c=>lineupRow(c)).join('')}</tbody></table></div>${exportBar('sel')}`;
  el.innerHTML=h;
  $$('.seg button',el).forEach(b=>b.onclick=()=>{ST.view.lineups=b.dataset.l;renderLineups();});
  bindSel(el); bindExport(el,'sel');
}
function bindSel(el){$$('input[data-key]',el).forEach(cb=>cb.onchange=()=>{if(cb.checked) ST.sel.add(cb.dataset.key); else ST.sel.delete(cb.dataset.key); $$('.selCount').forEach(s=>s.textContent=ST.sel.size);});}
function exportBar(kind){
  const cnt=kind==='sel'?`<span><b class="selCount">${ST.sel.size}</b> selected</span><button data-clear>Clear selection</button>`:`<span><b>${ST.port?ST.port.length:0}</b> lineups in portfolio</span>`;
  return `<div class="sticky-foot">${cnt}<label class="small"><input type="checkbox" class="nameid" ${store.get('nameid',false)?'checked':''}> Name (ID) format</label>
    <button class="primary" data-exp="${kind}">${kind==='port'&&ST.entries&&ST.assign?'Download filled DK entries CSV':'Download lineups CSV (new-lineup upload page)'}</button><button data-copy="${kind}">Copy CSV</button>${kind==='port'&&ST.entries&&ST.assign?`<span class="small muted">${ST.entries.rows.length} entries from your file, lineups filled in, preloaded ones unchanged</span>`:''}</div>`;
}
function lineupsFor(kind){ if(kind==='port') return ST.port||[]; const m=new Map(ST.res.lineups.map(c=>[c.key,c])); if(ST.port) ST.port.forEach(c=>m.set(c.key,c)); return Array.from(ST.sel).map(k=>m.get(k)).filter(Boolean); }
function csvFor(list){
  const P=ST.res.P; const ni=store.get('nameid',false); const pl=ST.players;
  const cell=(j,cpt)=>{const p=pl[j]; const id=cpt?p.idC:p.idF; return ni?`${p.name} (${id})`:id;};
  return ['CPT,FLEX,FLEX,FLEX,FLEX,FLEX'].concat(list.map(c=>[cell(c.L[0],true)].concat(c.L.slice(1).map(j=>cell(j,false))).map(x=>/[,"]/.test(x)?`"${x.replace(/"/g,'""')}"`:x).join(','))).join('\n')+'\n';
}
function bindExport(el,kind){
  const nm=$('.nameid',el); nm&&(nm.onchange=()=>store.set('nameid',nm.checked));
  const clr=$('[data-clear]',el); clr&&(clr.onclick=()=>{ST.sel.clear(); renderLineups(); if(ST.port) renderPortfolioResult();});
  const entMode=()=>kind==='port'&&ST.entries&&ST.assign;
  $('[data-exp]',el).onclick=async()=>{ if(entMode()) return saveText(entriesCSV(),`DKEntries_filled_${ST.teams.join('_')}.csv`,ST.entries.rows.length+' entries');
    const list=lineupsFor(kind); if(!list.length){toast('Nothing selected yet');return;}
    const csv=csvFor(list); const fn=`DK_showdown_${ST.teams.join('_')}_${list.length}.csv`;
    try{ if(window.claude&&window.claude.use){const dl=await window.claude.use('downloads'); if(dl){await dl.save({filename:fn,data:csv}); toast('Saved '+list.length+' lineups'); return;}} }catch(e){ if(e&&e.code==='declined') return; }
    try{const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'})); a.download=fn; document.body.appendChild(a); a.click(); a.remove(); toast('Downloaded '+list.length+' lineups');}catch(e){toast('Download blocked here. Use Copy CSV.');}
  };
  $('[data-copy]',el).onclick=()=>{const list=entMode()?[1]:lineupsFor(kind); if(!list.length){toast('Nothing selected yet');return;} const csv=entMode()?entriesCSV():csvFor(list);
    navigator.clipboard.writeText(csv).then(()=>toast('Copied '+list.length+' lineups')).catch(()=>{const ta=document.createElement('textarea'); ta.value=csv; el.appendChild(ta); ta.select(); toast('Select-all and copy the text box');});};
}

/* ---------------- portfolio ---------------- */
function renderPortfolioSetup(){
  const R=ST.res, el=$('#pane-port'); if(!R) return; const cfg=Object.assign({n:20,uniq:2,maxExp:60,maxCpt:25,minSal:45000,mix:'prop',kdstCpt:false,stack:false,cptMode:'opt',obj:'ev',size:10000,sharp:2},store.get('port',{}),ST.portMem||{}); if(ST.entries&&!ST.nTouched){const nu=ST.entries.rows.filter(e=>!e.pre&&e.fee>store.get('dupThr',0.25)+1e-9).length; if(nu) cfg.n=nu;}
  ST.portCfg=cfg;
  const P=R.P; const pool=P.map((p,j)=>({p,j,s:R.stats[j]})).filter(r=>r.p.active&&r.s.cpt+r.s.flex>0.002).sort((a,b)=>(b.s.cpt+b.s.flex)-(a.s.cpt+a.s.flex));
  ST.portExcl=ST.portExcl||new Set();
  if(!ST.cptOff||ST.cptOffKey!==ST.teams.join('@')){ ST.cptOffKey=ST.teams.join('@'); ST.cptOff=new Set(); P.forEach((p,j)=>{ if(!p.active) return; const s=R.stats[j];
      if(p.pos==='K'||p.pos==='DST'||(p.pos==='QB'&&!p.isStarterQB)||s.cpt<0.003) ST.cptOff.add(j); }); }
  const cpool=P.map((p,j)=>({p,j,s:R.stats[j]})).filter(r=>r.p.active&&r.p.salC>0&&(r.s.mean>0.5||r.s.cpt>0)).sort((a,b)=>(b.s.cpt-a.s.cpt)||(b.s.mean-a.s.mean));
  let h=`<div class="grid2"><div class="card"><h3>Build a portfolio</h3>
    <p class="note small">${hasOwn()?'<b>Ownership loaded.</b> Beat the field builds a simulated contest from your projected ownership and scores each lineup by how often it beats the whole field in each sim, divided by its expected duplicates. ':'Upload projected ownership at the top to unlock the beat-the-field objective. '}Candidates are the lineups that were optimal in individual sims, plus the best lineups by mean and by ceiling, and the best lineups within each game script. Lineups are spread across game scripts in proportion to how often each script happened, ranked inside each script by how often they finished within 10% of that sim's optimal score, then filtered by your exposure and uniqueness rules.</p>
    <div class="controls" style="border:0;padding-block:6px">
      <div class="ctl"><label class="lbl" for="pN">Lineups</label><input id="pN" type="number" min="1" max="600" value="${cfg.n}"></div>
      <div class="ctl"><label class="lbl" for="pU">Min unique players</label><input id="pU" type="number" min="1" max="5" value="${cfg.uniq}"></div>
      <div class="ctl"><label class="lbl" for="pE">Max player exposure %</label><input id="pE" type="number" min="5" max="100" value="${cfg.maxExp}"></div>
      <div class="ctl"><label class="lbl" for="pC">Max one captain %</label><input id="pC" type="number" min="5" max="100" value="${cfg.maxCpt}"></div>
      <div class="ctl"><label class="lbl" for="pS">Min salary used</label><input id="pS" type="number" step="500" min="0" max="50000" value="${cfg.minSal}"></div>
      <div class="ctl"><label class="lbl" for="pO">Objective</label><select id="pO" ${hasOwn()?'':'disabled'}><option value="ev" ${cfg.obj==='ev'||!cfg.obj?'selected':''}>Expected winnings (uses ownership)</option><option value="field" ${cfg.obj==='field'?'selected':''}>Top 0.1% vs field (uses ownership)</option><option value="near" ${cfg.obj==='near'?'selected':''}>Near-optimal rate</option></select></div>
      <div class="ctl"><label class="lbl" for="pF">Field quality</label><select id="pF" ${hasOwn()?'':'disabled'}><option value="1" ${(cfg.sharp??1)==1?'selected':''}>Normal</option><option value="2" ${cfg.sharp==2?'selected':''}>Sharp</option><option value="0" ${cfg.sharp==0?'selected':''}>Soft (pure ownership draws)</option></select></div>
      <div class="ctl"><label class="lbl" for="pX">Captain mix</label><select id="pX"><option value="opt" ${cfg.cptMode!=='free'?'selected':''}>${hasOwn()?'Follow captain equity':'Match sim optimal CPT rates'}</option><option value="free" ${cfg.cptMode==='free'?'selected':''}>Best lineups, any captain</option></select></div>
      <div class="ctl"><label class="lbl" for="pM">Script mix</label><select id="pM"><option value="prop" ${cfg.mix==='prop'?'selected':''}>By script frequency</option><option value="even" ${cfg.mix==='even'?'selected':''}>Even across scripts</option></select></div>
    </div>
    <div class="row small">
      <label><input type="checkbox" id="pT" ${cfg.stack?'checked':''}> Captain must be stacked (QB with own pass catcher or pass catcher with own QB)</label></div>
    <div class="row" style="margin-top:12px"><button class="primary" id="buildPort">Build portfolio</button><span id="portStatus" class="small muted"></span></div></div>
    <div class="card"><h3>Exclude from portfolio</h3><p class="small muted">Tap a name to exclude or include it. Tap <b>i</b> for the player card. Shows sim mean · total optimal rate, sorted by optimal rate.</p><div class="card">${capsCard()}</div>
    <div class="row" id="exclChips">${pool.map(r=>`<span class="xchip ${ST.portExcl.has(r.j)?'on':''}"><button class="xbtn" data-x="${r.j}" aria-pressed="${ST.portExcl.has(r.j)}">${esc(r.p.name)} <span class="pos">${r.p.pos}</span> <span class="num" title="Sim mean (FLEX) · total optimal rate">${fmt(r.s.mean)} · ${pct(r.s.cpt+r.s.flex,0)}</span></button><button class="ibtn" data-pc="${r.j}" aria-label="Player card for ${esc(r.p.name)}" title="Player card">i</button></span>`).join('')}</div></div></div>
    <div class="card" style="margin-top:16px"><h3>Allowed captains</h3><p class="small muted">Tap to turn a captain on or off. Off by default: kickers, DSTs, non-starting QBs and anyone the sim makes optimal captain under 0.3% of the time. Sorted by sim optimal-captain rate.</p>
      <div class="row" id="cptChips">${cpool.map(r=>`<span class="xchip ${ST.cptOff.has(r.j)?'on':''}"><button class="xbtn cbtn" data-c="${r.j}" aria-pressed="${!ST.cptOff.has(r.j)}">${esc(r.p.name)} <span class="pos">${r.p.pos}</span> <span class="num" title="Sim mean as captain (1.5x) · captain optimal rate">${fmt(r.s.mean*1.5)} · ${pct(r.s.cpt,1)}</span></button><button class="ibtn" data-pc="${r.j}" aria-label="Player card" title="Player card">i</button></span>`).join('')}</div>
      <div class="row small" style="margin-top:8px"><button id="cptAll" class="small" style="padding:2px 8px">All on</button><button id="cptReset" class="small" style="padding:2px 8px">Reset defaults</button></div></div>
    <div style="margin-top:16px">${entriesCard()}</div>
    <div id="portOut"></div>`;
  el.innerHTML=h;
  $$('#exclChips .xbtn',el).forEach(b=>b.onclick=()=>{const j=+b.dataset.x; if(ST.portExcl.has(j)) ST.portExcl.delete(j); else ST.portExcl.add(j); b.parentElement.classList.toggle('on',ST.portExcl.has(j)); b.setAttribute('aria-pressed',ST.portExcl.has(j));});
  bindEntries(el);
  $$('#cptChips .cbtn',el).forEach(b=>b.onclick=()=>{const j=+b.dataset.c; if(ST.cptOff.has(j)) ST.cptOff.delete(j); else ST.cptOff.add(j); b.parentElement.classList.toggle('on',ST.cptOff.has(j)); b.setAttribute('aria-pressed',!ST.cptOff.has(j));});
  $('#cptAll',el).onclick=()=>{ST.cptOff.clear(); renderPortfolioSetup();}; $('#cptReset',el).onclick=()=>{ST.cptOffKey=null; renderPortfolioSetup();};
  $$('#pN,#pU,#pE,#pC,#pS,#pM,#pX,#pO,#pF,#pT',el).forEach(x=>x.addEventListener('change',()=>{ if(x.id==='pN') ST.nTouched=true; const c=readCfg(); ST.portMem=c; store.set('port',c); }));
  bindCaps(el,renderPortfolioSetup);
  $('#buildPort').onclick=()=>buildPortfolio().catch(e=>{console.error(e); $('#portStatus').textContent='Build failed: '+e.message;});
  if(ST.port) renderPortfolioResult();
}
function readCfg(){ return {n:+$('#pN').value||20,uniq:+$('#pU').value||2,maxExp:+$('#pE').value||60,maxCpt:+$('#pC').value||25,minSal:+$('#pS').value||0,mix:$('#pM').value,kdstCpt:false,stack:$('#pT').checked,cptMode:$('#pX').value,obj:hasOwn()?$('#pO').value:(ST.portMem&&ST.portMem.obj)||'ev',size:50000,sharp:+($('#pF')?$('#pF').value:1)}; }
async function buildPortfolio(){
  const R=ST.res; const cfg=readCfg();
  store.set('port',cfg); ST.portCfg=cfg; const st=$('#portStatus'); st.textContent='Scoring candidate lineups…'; await new Promise(r=>setTimeout(r,20));
  const {N,n,pts,ov,script,scripts,P,G,elig,counts}=R;
  // candidate generation
  const cand=new Map(); const add=(L)=>{const k=E.lineupKey(L); if(!cand.has(k)) cand.set(k,{L,key:k});};
  Array.from(counts.values()).sort((a,b)=>b.n-a.n).slice(0,3500).forEach(c=>add(c.L));
  R.lineups.forEach(c=>add(c.L));
  const el2=elig.filter(j=>!ST.portExcl.has(j));
  for(const S of scripts){ if(S.n<N*0.02) continue; E.topK(G,{eligible:el2},Float64Array.from(S.pm),cfg.n>60?150:60).forEach(h=>add(h.L)); }
  if(cfg.n>40){ // large portfolios: add the 4 best lineups from a sample of individual sims for more distinct, correlated builds
    const ns=Math.min(N,Math.round(Math.min(900,cfg.n*4))); const R2=E.makeRng(321); const buf=new Float64Array(n);
    for(let k=0;k<ns;k++){ const i=Math.floor(R2()*N); for(let j=0;j<n;j++) buf[j]=pts[i*n+j]; E.topK(G,{eligible:el2},buf,4).forEach(h=>add(h.L));
      if(k%100===0){st.textContent=`Generating candidates from individual sims… ${k}/${ns}`; await new Promise(r=>setTimeout(r,0));} } }
  const isPC=(p)=>['WR','TE','RB'].includes(p.pos);
  let C=Array.from(cand.values()).filter(c=>{const L=c.L; if(L.some(j=>ST.portExcl.has(j))) return false; const cp=P[L[0]];
    if(ST.cptOff&&ST.cptOff.has(L[0])) return false;
    const sal=cp.salC+L.slice(1).reduce((a,j)=>a+P[j].salF,0); if(sal<cfg.minSal||sal>50000) return false;
    if(cfg.stack){ const fl=L.slice(1).map(j=>P[j]);
      if(cp.pos==='QB'&&!fl.some(q=>q.team===cp.team&&(q.pos==='WR'||q.pos==='TE'||q.pos==='RB'))) return false;
      if((cp.pos==='WR'||cp.pos==='TE')&&!fl.some(q=>q.team===cp.team&&q.pos==='QB')) return false; }
    return true;});
  // contest field (ownership mode)
  ST.fieldSharp=cfg.sharp; const FM=(cfg.obj==='field'||cfg.obj==='ev')&&hasOwn(); const EVM=FM&&cfg.obj==='ev'; let thrW=null,thr1=null,dupMap=null,F2=40000;
  if(FM){ st.textContent='Building contest field from ownership…'; await new Promise(r=>setTimeout(r,0));
    const FLD=buildField(4000,13); const F=FLD.F, fl=FLD.L;
    // contest sizes: one per main contest when entries are loaded, else the single size box
    const thrE=store.get('dupThr',0.25); let SZ=[];
    if(ST.entries){ const g=new Map(); ST.entries.rows.forEach(e=>{ if(e.pre||e.fee<=thrE+1e-9) return; const k=ckey(e); if(!g.has(k)) g.set(k,{k,size:contestSize(k,e.cname,e.fee),prize:prizePool(e.cname),n:0,fee:e.fee}); g.get(k).n++; });
      SZ=Array.from(g.values()).map(c=>({size:c.size,fee:c.fee,prize:c.prize,w:c.n,keys:[c.k]})); }
    if(!SZ.length) SZ=[{size:cfg.size,fee:1,w:1,keys:[]}];
    const wt=SZ.reduce((s,x)=>s+x.w,0); SZ.forEach(x=>x.w/=wt); const prim=SZ.reduce((b,x,i)=>x.w>SZ[b].w?i:b,0);
    const KT=40, k1=Math.max(1,Math.round(F*0.01)); const kS=SZ.map(x=>Math.max(1,Math.ceil(F/Math.min(x.size,1000)))); const K2=Math.max(KT,k1,...kS);
    const thrS=SZ.map(()=>new Float32Array(N)); thrW=thrS[prim]; thr1=new Float32Array(N); const top=new Float32Array(K2);
    const GQ=48, gq=new Float64Array(GQ), gi=new Int32Array(GQ); for(let k=0;k<GQ;k++){ gq[k]=Math.exp(Math.log(1/F)+(Math.log(0.25)-Math.log(1/F))*k/(GQ-1)); gi[k]=Math.min(F-1,Math.max(0,Math.round(gq[k]*F)-1)); }
    const QV=EVM?new Float32Array(N*GQ):null; const fsc=EVM?new Float32Array(F):null;
    for(let i=0;i<N;i++){ top.fill(-1e9); const o=i*n;
      for(let f=0;f<F;f++){ const b=f*6; const v=1.5*pts[o+fl[b]]+pts[o+fl[b+1]]+pts[o+fl[b+2]]+pts[o+fl[b+3]]+pts[o+fl[b+4]]+pts[o+fl[b+5]];
        if(EVM) fsc[f]=v;
        if(v>top[K2-1]){ let q=K2-1; while(q>0&&top[q-1]<v){top[q]=top[q-1];q--;} top[q]=v; } }
      if(EVM){ fsc.sort(); for(let k=0;k<GQ;k++) QV[i*GQ+k]=fsc[F-1-gi[k]]; }
      thr1[i]=top[k1-1]; let ms=0; for(let q=0;q<KT;q++) ms+=top[q]; const beta=Math.max(0.5,ms/KT-top[KT-1]);
      for(let s=0;s<SZ.length;s++) thrS[s][i]=kS[s]?top[kS[s]-1]:top[KT-1]+beta*Math.log(KT*SZ[s].size/F);
      if(i%1000===0){st.textContent=`Scoring the field in each sim… ${i}/${N}`; await new Promise(r=>setTimeout(r,0));} }
    dupMap=new Map(); for(let k=0;k<F2;k++){const L=FLD.one(); if(!L) continue; const key=E.lineupKey(L); dupMap.set(key,(dupMap.get(key)||0)+1);}
    // generic DK-style payout curve per contest: 22% paid, min cash 2x fee, prize(r) = max(minCash, C/r), pool = size x fee x 0.85
    const HN=(x)=>x<1?0:Math.log(x)+0.5772+1/(2*x);
    const PT=getPayouts();
    const PAY=SZ.map(x=>{ const M=x.size, fee=x.fee||1; const tbl=x.keys.length===1?PT[x.keys[0]]:null; let Pd, pref;
      if(tbl&&tbl.length){ Pd=tbl[tbl.length-1][1]; pref=new Float64Array(Pd+1); let s=0, ti=0; for(let r=1;r<=Pd;r++){ while(ti<tbl.length&&tbl[ti][1]<r) ti++; s+=(ti<tbl.length&&tbl[ti][0]<=r)?tbl[ti][2]:0; pref[r]=s; } }
      else { const pool=x.prize||M*fee*0.85; Pd=Math.max(1,Math.round(0.22*M)); let mc=2*fee; if(Pd*mc>pool*0.6) mc=pool*0.6/Pd;
        const tot=(C)=>{const Rs=Math.min(Pd,Math.floor(C/mc)); return C*HN(Rs)+(Pd-Rs)*mc;}; let lo=mc,hi=pool; for(let it=0;it<60;it++){const mid=(lo+hi)/2; if(tot(mid)>pool) hi=mid; else lo=mid;} const C=(lo+hi)/2;
        pref=new Float64Array(Pd+1); let s=0; for(let r=1;r<=Pd;r++){ s+=Math.max(mc,C/r); pref[r]=s; } }
      const avg=(lo,hi)=>{ lo=Math.max(1,Math.round(lo)); hi=Math.max(lo,Math.round(hi)); if(lo>Pd) return 0; return (pref[Math.min(hi,Pd)]-pref[lo-1])/(hi-lo+1); };
      return {M,fee,Pd,avg,b:Math.max(1,M/F),real:!!(tbl&&tbl.length)}; });
    ST.fieldInfo={F,SZ,PAY}; var FSZ={SZ,thrS,prim,PAY,QV,gq,GQ};
  }
  // evaluate: overall + per-script near-optimal rate (and field wins)
  const K=8; const sn=scripts.map(s=>s.n);
  const nSZ=FM?FSZ.SZ.length:0; const lgq=EVM?Array.from(FSZ.gq,Math.log):null;
  for(let ci=0;ci<C.length;ci++){ const c=C[ci], L=c.L; const ns=new Float64Array(K), ws=new Float64Array(K); let near=0,s=0,opt=0,win=0,t1=0; const wb=new Float64Array(nSZ), evb=new Float64Array(nSZ), evS=new Float64Array(K);
    const fr0=FM?Math.max(dupMap.get(c.key)||0,0.25)/F2:0;
    for(let i=0;i<N;i++){let v=1.5*pts[i*n+L[0]]; for(let k=1;k<6;k++) v+=pts[i*n+L[k]]; s+=v; if(v>=0.9*ov[i]){near++; ns[script[i]]++;}
      if(FM){ if(v>thrW[i]){win++; ws[script[i]]++;} if(v>=thr1[i]) t1++; for(let s=0;s<nSZ;s++) if(v>FSZ.thrS[s][i]) wb[s]++;
        if(EVM){ const o=i*FSZ.GQ, Q=FSZ.QV; let q=-1;
          if(v>Q[o]) q=0; else if(v>Q[o+FSZ.GQ-1]){ let lo=1,hi=FSZ.GQ-1; while(lo<hi){const m=(lo+hi)>>1; if(v>Q[o+m]) hi=m; else lo=m+1;} const a0=Q[o+lo-1], a1=Q[o+lo]; const t=(a0-v)/Math.max(1e-6,a0-a1); q=Math.exp(lgq[lo-1]+(lgq[lo]-lgq[lo-1])*t); }
          if(q>=0) for(let s=0;s<nSZ;s++){ const py=FSZ.PAY[s]; const d=py.M*fr0; let pay;
            if(q===0) pay=py.avg(1,py.b+d); else { const r=Math.max(1,q*py.M); pay=r>py.Pd?0:py.avg(r,r+d); }
            evb[s]+=pay; if(s===FSZ.prim) evS[script[i]]+=pay; } } } }
    c.mean=s/N; c.near=near/N; c.ns=Array.from(ns,(x,k)=>sn[k]?x/sn[k]:0);
    c.own=(P[L[0]].ownC||0)+L.slice(1).reduce((a,j)=>a+(P[j].ownF||0),0);
    if(FM){ const fr=Math.max(dupMap.get(c.key)||0,0.25)/F2; c.dupBy=FSZ.SZ.map(x=>x.size*fr); c.winBy=Array.from(wb,x=>x/N); c.eqBy=c.winBy.map((w,s)=>w/(1+c.dupBy[s]));
      c.dup=c.dupBy[FSZ.prim]; c.win=c.winBy[FSZ.prim]; c.top1=t1/N; c.eq=c.eqBy.reduce((t,e,s)=>t+e*FSZ.SZ[s].w,0); c.ws=Array.from(ws,(x,k)=>sn[k]?x/sn[k]/(1+c.dup):0);
      if(EVM){ c.evBy=Array.from(evb,(x,s)=>x/N); c.roiBy=c.evBy.map((e,s)=>e/FSZ.PAY[s].fee-1); c.roi=c.roiBy[FSZ.prim];
        c.eqBy=c.evBy.map((e,s)=>e/FSZ.PAY[s].fee); c.eq=c.eqBy.reduce((t,e,s)=>t+e*FSZ.SZ[s].w,0); c.ws=Array.from(evS,(x,k)=>sn[k]?x/sn[k]:0); } } const cc=counts.get(c.key); c.opt=cc?cc.n/N:0;
    c.sal=P[L[0]].salC+L.slice(1).reduce((a,j)=>a+P[j].salF,0);
    let bk=0,bv=-1; for(let k=0;k<K;k++){ if(!sn[k]) continue; const lift=FM?c.ws[k]:c.ns[k]; if(lift>bv){bv=lift;bk=k;} } c.script=bk;
    if(ci%300===0){st.textContent=`Scoring candidate lineups… ${ci}/${C.length}`; await new Promise(r=>setTimeout(r,0));}
  }
  // allocation
  const live=scripts.filter(s=>s.n>=N*0.01);
  const quota=new Map(); let tot=0;
  live.forEach(s=>{const w=cfg.mix==='even'?1/live.length:s.p/live.reduce((a,x)=>a+x.p,0); const q=cfg.n*w; quota.set(s.k,q); tot+=q;});
  const want=new Map(); let assigned=0; const fr=[];
  live.forEach(s=>{const q=Math.floor(quota.get(s.k)); want.set(s.k,q); assigned+=q; fr.push([s.k,quota.get(s.k)-q]);});
  fr.sort((a,b)=>b[1]-a[1]); for(let i=0;assigned<cfg.n&&i<fr.length;i++,assigned++) want.set(fr[i][0],want.get(fr[i][0])+1);
  let expBump=0; let maxE=Math.max(1,Math.floor(cfg.n*cfg.maxExp/100+1e-9)), maxC=Math.max(1,Math.floor(cfg.n*cfg.maxCpt/100+1e-9));
  const expo=new Map(), cexp=new Map(); const chosen=[];
  const diff=(A,B)=>{const s=new Set(B.L); let d=0; for(const j of A.L) if(!s.has(j)) d++; if(d===0&&A.L[0]!==B.L[0]) d=1; return d;};
  // captain quotas: each allowed captain's share of the portfolio follows his sim optimal-CPT rate
  const capOk=(j)=>!ST.portExcl.has(j)&&!(ST.cptOff&&ST.cptOff.has(j));
  const cTot=R.stats.reduce((s,x,j)=>s+(capOk(j)&&P[j].active?x.cpt:0),0)||1;
  let qC=new Map(R.stats.map((x,j)=>[j,capOk(j)?cfg.n*x.cpt/cTot:0]));
  if(FM){ const top=C.slice().sort((x,y)=>y.eq-x.eq).slice(0,400); const eqC=new Map(); let et=0; top.forEach(c=>{if(capOk(c.L[0])){eqC.set(c.L[0],(eqC.get(c.L[0])||0)+c.eq); et+=c.eq;}});
    qC=new Map(R.stats.map((x,j)=>[j,et>0?cfg.n*(eqC.get(j)||0)/et:0])); }
  let capRelax=false; const capC=(j)=>cfg.cptMode==='free'||capRelax?maxC:Math.min(maxC,Math.max(1,Math.ceil(qC.get(j)+0.25)));
  const capsM=ST.caps||new Map(); const maxFor=(j)=>{ const o=capsM.get(j); if(o&&o.max!=null) return Math.floor(cfg.n*o.max+1e-9); return o&&o.min!=null?Math.max(maxE,Math.ceil(cfg.n*o.min-1e-9)):maxE; }; // a minimum lifts the default cap
  const mins=Array.from(capsM.entries()).filter(([j,o])=>o.min!=null&&o.min>0&&!ST.portExcl.has(j)).map(([j,o])=>[j,Math.min(cfg.n,Math.ceil(cfg.n*o.min-1e-9))]);
  const ok=(c,uniq)=>{ if((cexp.get(c.L[0])||0)>=capC(c.L[0])) return false; for(const j of c.L) if((expo.get(j)||0)>=maxFor(j)) return false; for(const o of chosen) if(diff(c,o)<uniq) return false; return true; };
  const take=(c,k)=>{chosen.push(Object.assign(c,{forScript:k})); c.L.forEach(j=>expo.set(j,(expo.get(j)||0)+1)); cexp.set(c.L[0],(cexp.get(c.L[0])||0)+1);};
  const mxN=Math.max(...C.map(c=>c.near),1e-9); const mxS=new Map(live.map(s=>[s.k,Math.max(...C.map(c=>c.ns[s.k]),1e-9)]));
  const mxE=FM?Math.max(...C.map(c=>c.eq),1e-12):1, mxW=FM?new Map(live.map(s=>[s.k,Math.max(...C.map(c=>c.ws[s.k]),1e-12)])):null;
  const sc=FM?(c,k)=>0.6*c.ws[k]/mxW.get(k)+0.4*c.eq/mxE:(c,k)=>0.65*c.ns[k]/mxS.get(k)+0.35*c.near/mxN;
  const ranked=new Map(live.map(s=>[s.k,C.slice().sort((a,b)=>(sc(b,s.k)-sc(a,s.k))||(b.mean-a.mean))]));
  const ptr=new Map(live.map(s=>[s.k,0]));
  // minimums first: the best-scoring lineups with each player (any script) until his minimum is met, charged to that script's quota
  for(const [j,need] of mins){ for(let u=cfg.uniq;u>=1&&(expo.get(j)||0)<need;u--){ const cands=[]; for(const s of live) for(const c of ranked.get(s.k)){ if(c.L.includes(j)) cands.push([sc(c,s.k),c,s.k]); }
      cands.sort((x,y)=>y[0]-x[0]); for(const [,c,k] of cands){ if((expo.get(j)||0)>=need||chosen.length>=cfg.n) break; if(chosen.includes(c)||!ok(c,u)) continue; take(c,k); want.set(k,Math.max(0,want.get(k)-1)); } } }
  ST.portShort=mins.filter(([j,need])=>(expo.get(j)||0)<need).map(([j])=>P[j].name);
  let progress=true, uniq=cfg.uniq;
  while(chosen.length<cfg.n&&progress){
    progress=false;
    const order=live.slice().sort((a,b)=>want.get(b.k)-want.get(a.k));
    for(const s of order){ if(chosen.length>=cfg.n) break; if(want.get(s.k)<=0) continue;
      const list=ranked.get(s.k); let p=ptr.get(s.k);
      if(cfg.cptMode==='free'){ while(p<list.length){const c=list[p++]; if(chosen.includes(c)) continue; if(ok(c,uniq)){take(c,s.k); want.set(s.k,want.get(s.k)-1); progress=true; break;}} }
      else { // best of the next 600 eligible by script score plus a bonus for captains still under their quota
        let best=null,bv=-1e9,seen=0; for(let q=p;q<list.length&&seen<600;q++){const c=list[q]; if(chosen.includes(c)||!ok(c,uniq)) continue; seen++;
          const j=c.L[0], need=qC.get(j)-(cexp.get(j)||0); const v=sc(c,s.k)+(need>0?0.35*Math.min(1,need/Math.max(1,qC.get(j))):-0.15); if(v>bv){bv=v;best=c;}}
        if(best){take(best,s.k); want.set(s.k,want.get(s.k)-1); progress=true;} else p=list.length; }
      ptr.set(s.k,p);
    }
    if(!progress&&chosen.length<cfg.n){ // redistribute leftover quota to any script, then relax uniqueness
      const left=cfg.n-chosen.length; const anyLeft=live.some(s=>ptr.get(s.k)<ranked.get(s.k).length);
      if(anyLeft&&live.every(s=>want.get(s.k)<=0||ptr.get(s.k)>=ranked.get(s.k).length)){ live.forEach(s=>want.set(s.k,left)); progress=true; }
      else if(!capRelax&&cfg.cptMode!=='free'){ capRelax=true; live.forEach(s=>{ptr.set(s.k,0); want.set(s.k,left);}); progress=true; }
      else if(uniq>1){ uniq--; live.forEach(s=>{ptr.set(s.k,0); want.set(s.k,left);}); progress=true; }
      else if(maxE<cfg.n){ const b=Math.max(1,Math.round(cfg.n*0.03)); maxE=Math.min(cfg.n,maxE+b); maxC=Math.min(cfg.n,maxC+b); expBump+=b; live.forEach(s=>{ptr.set(s.k,0); want.set(s.k,left);}); progress=true; }
    }
  }
  ST.port=chosen; ST.portUniq=uniq; ST.portQC=cfg.cptMode==='free'?null:qC; ST.portFM=FM; ST.portEV=EVM; ST.portSZ=FM?FSZ.SZ:null; if(ST.entries) assignEntries();
  st.textContent=`Built ${chosen.length} lineups from ${C.length.toLocaleString()} candidates${uniq<cfg.uniq?` (uniqueness relaxed to ${uniq} to fill the count)`:''}${expBump?`; max exposure raised to ${Math.round(maxE/cfg.n*100)}% to fill the count`:''}${ST.portShort&&ST.portShort.length?`; minimum not reachable under your caps and uniqueness for ${ST.portShort.join(', ')}`:''}.`;
  renderPortfolioResult();
}
function psh(k,l,cls='n'){const on=ST.view.portSort===k; return `<th class="sort psort ${cls}" data-k="${k}">${l}${on?(ST.view.portDir<0?' ▾':' ▴'):''}</th>`;}
function sortedPort(L){
  if(ST.assign){ const best=new Map(); const thr=store.get('dupThr',0.25);
    for(const e of ST.entries.rows){ if(e.pre||e.fee<=thr+1e-9) continue; const c=ST.assign.map.get(e.id); if(!c) continue; const b=best.get(c.key); if(!b||e.fee>b.fee) best.set(c.key,{fee:e.fee,short:e.cname.replace(/^NFL Showdown\s*/,'').replace(/\s*\([A-Z]+ @ [A-Z]+\)\s*$/,'')}); }
    L.forEach(c=>c._ct=best.get(c.key)||null);
    if(ST.portSZ&&ST.portEV){ const sIdx=new Map(); ST.portSZ.forEach((x,s)=>x.keys.forEach(k=>sIdx.set(k,s))); const bk=new Map(); for(const e of ST.entries.rows){ if(e.pre||e.fee<=thr+1e-9) continue; const c=ST.assign.map.get(e.id); if(!c||!c.roiBy) continue; const cur=bk.get(c.key); if(!cur||e.fee>cur) {bk.set(c.key,e.fee); const s=sIdx.get(ckey(e)); c._roi=s!=null?c.roiBy[s]:c.roi;} } } }
  const k=ST.view.portSort; if(!k) return L; const d=ST.view.portDir||-1;
  const v=(c)=>k==='contest'?(c._ct?c._ct.fee:0):k==='sal'?c.sal:k==='roi'?(c._roi!=null?c._roi:c.roi||0):(c[k]||0);
  return L.slice().sort((a,b)=>d*(v(a)-v(b)));
}
function renderPortfolioResult(){
  const R=ST.res, out=$('#portOut'); if(!out||!ST.port) return; const P=R.P; const L=ST.port; const nL=L.length;
  const ex=new Map(), cx=new Map(); L.forEach(c=>{c.L.forEach((j,k)=>{ex.set(j,(ex.get(j)||0)+1); if(k===0) cx.set(j,(cx.get(j)||0)+1);});});
  const rows=Array.from(ex.entries()).sort((a,b)=>b[1]-a[1]);
  L.forEach(c=>{ if(c.p90==null) evalLineup(c); });
  const scr=R.scripts; const scCount=new Array(8).fill(0); L.forEach(c=>scCount[c.forScript]++);
  let h=`<div class="grid2" style="margin-top:16px"><div class="card"><h3>Exposure</h3><div class="tw" style="border:0"><table><thead><tr><th>Player</th><th class="n">Total</th>${hasOwn()?'<th class="n" title="Projected FLEX + CPT ownership">Proj own</th><th class="n" title="Your total exposure minus projected ownership">vs field</th>':''}<th class="n">CPT</th>${hasOwn()?'<th class="n">Proj CPT own</th>':''}<th class="n">CPT target</th><th class="n">Sim optimal %</th></tr></thead><tbody>
    ${rows.map(([j,c])=>`<tr><td><span class="tm ${teamIdx(P[j])?'b':'a'}"></span><button class="plink" data-pc="${j}">${esc(P[j].name)}</button><span class="pos">${P[j].pos}</span></td><td class="n">${pct(c/nL,0)}<span class="meter f" style="width:${(c/nL*50).toFixed(1)}px"></span></td>${hasOwn()?(()=>{const po=P[j].ownF!=null?(P[j].ownF||0)+(P[j].ownC||0):null; const d=po==null?null:c/nL-po; return `<td class="n">${po==null?'-':pct(po,0)}</td><td class="n" ${d==null?'':`style="color:var(${d>=0?'--good':'--bad'});font-weight:600"`}>${d==null?'-':(d>=0?'+':'')+(d*100).toFixed(0)}</td>`;})():''}<td class="n">${pct((cx.get(j)||0)/nL,0)}<span class="meter c" style="width:${((cx.get(j)||0)/nL*50).toFixed(1)}px"></span></td>${hasOwn()?`<td class="n">${P[j].ownC!=null?pct(P[j].ownC,1):'-'}</td>`:''}<td class="n">${ST.portQC?pct(ST.portQC.get(j)/nL,0):'-'}</td><td class="n">${pct(R.stats[j].cpt+R.stats[j].flex,1)}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="card"><h3>Script coverage</h3><table><thead><tr><th>Game script</th><th class="n">Sim freq</th><th class="n">Lineups</th></tr></thead><tbody>
    ${scr.filter(s=>s.n).sort((a,b)=>b.p-a.p).map(s=>`<tr><td>${esc(s.name)}</td><td class="n">${pct(s.p,0)}</td><td class="n">${scCount[s.k]}</td></tr>`).join('')}</tbody></table></div></div>
    <h3 style="margin-top:16px">Portfolio lineups</h3><div class="tw"><table class="ptab"><thead><tr><th></th>${ST.assign?psh('contest','Contest',''):''}<th>Built for</th><th>Captain</th><th>Flex</th>${psh('sal','Salary')}${psh('mean','Mean')}${psh('p90','90th')}${psh('max','Max')}${psh('opt','Optimal %')}${psh('near','Within 10% of optimal')}${ST.portFM?psh('own','Own sum')+psh('win','Top 0.1%')+psh('dup','Exp. dupes'):''}${ST.portEV?psh('roi','Exp. ROI'):''}</tr></thead><tbody>
    ${sortedPort(L).map(c=>`<tr><td><input type="checkbox" data-key="${esc(c.key)}" ${ST.sel.has(c.key)?'checked':''} aria-label="Select"></td>${ST.assign?`<td class="small">${c._ct?`<b>$${c._ct.fee.toFixed(2)}</b> ${esc(c._ct.short)}`:'-'}</td>`:''}<td class="small">${esc(scr[c.forScript].name)}</td>${lineupCells(c.L)}<td class="n">${c.sal.toLocaleString()}</td><td class="n">${fmt(c.mean)}</td><td class="n">${c.p90?fmt(c.p90):'-'}</td><td class="n">${c.max?fmt(c.max):'-'}</td><td class="n">${pct(c.opt,2)}</td><td class="n">${pct(c.near)}</td>${ST.portFM?`<td class="n">${pct(c.own,0)}</td><td class="n">${pct(c.win,2)}</td><td class="n">${fmt(c.dup,1)}</td>`:''}${ST.portEV?`<td class="n" style="color:var(${(c._roi!=null?c._roi:c.roi)>=0?'--good':'--bad'})">${((c._roi!=null?c._roi:c.roi)*100>=0?'+':'')+fmt((c._roi!=null?c._roi:c.roi)*100,0)}%</td>`:''}</tr>`).join('')}</tbody></table></div>${entriesResult()}${ST.portFM&&ST.fieldInfo?`<p class="small muted">${ST.portEV?`Expected winnings: in each sim the lineup's finish is read off the ownership field and converted to dollars with ${ST.fieldInfo.PAY.some(p=>p.real)?`your pasted payout tables (${ST.fieldInfo.PAY.filter(p=>p.real).length} of ${ST.fieldInfo.PAY.length} contests; the rest use`:''} projected payouts built from the contest's prize pool, fee and field size: 22% paid, min cash 2x the fee, prizes falling as 1/rank${ST.fieldInfo.PAY.some(p=>p.real)?')':''}, then averaged; duplicates split the prizes of the places they share; ranks too high for the 4,000-lineup field sample to separate get the average payout of that whole top group. Exp. ROI is for the lineup's highest-fee contest. Field quality sets how close the simulated entrants build to optimal projections: Sharp keeps most field lineups within about 6% of the best projection, Normal within about 10%, Soft draws straight from ownership. Softer fields inflate ROI. Real payout tables are flatter or steeper by contest, so treat ROI as a ranking more than a forecast. `:''}Top 0.1% = share of sims where the lineup beats 99.9% of a field drawn from projected ownership (${ST.fieldInfo.F.toLocaleString()} field lineups per sim; contests under 1,000 entries use their own first-place line). First-place rates in 100K+ fields are too rare to measure cleanly in 10,000 sims, so ranking uses this rate divided by expected duplicates in each contest (sizes ${ST.fieldInfo.SZ.map(x=>x.size.toLocaleString()).join(' / ')}). Expected dupes come from 40,000 field draws. Click a column header to sort.</p>`:''}${exportBar('port')}`;
  out.innerHTML=h;
  $$('th.psort',out).forEach(t=>t.onclick=()=>{const k=t.dataset.k; if(ST.view.portSort===k) ST.view.portDir=-(ST.view.portDir||-1); else {ST.view.portSort=k; ST.view.portDir=-1;} renderPortfolioResult();});
  bindSel(out); bindExport(out,'port');
  const xe=$('#expEnt',out); if(xe) xe.onclick=()=>saveText(entriesCSV(),`DKEntries_filled_${ST.teams.join('_')}.csv`,ST.entries.rows.length+' entries');
}

/* ---------------- scripts ---------------- */
function renderScripts(){
  const R=ST.res, el=$('#pane-scripts'); if(!R) return; const P=R.P;
  const S=R.scripts.filter(s=>s.n).sort((a,b)=>b.p-a.p);
  const col=(s)=>{const w=s.k>>2; const base=w?'var(--t1)':'var(--t0)'; return `color-mix(in srgb, ${base} ${((s.k>>1)&1)?100:55}%, var(--panel))`;};
  let h=`<p class="note small">Each sim is sorted by who won, whether the margin was 10+ points, and whether the combined score beat the median simulated total (${fmt(R.medT,1)}). Use these to see which players and captains carry each kind of game.</p>
    <div class="scriptbar" aria-label="Script frequency">${S.map(s=>`<div title="${esc(s.name)} ${pct(s.p,0)}" style="width:${(s.p*100).toFixed(2)}%;background:${col(s)}${(s.k&1)?'':';opacity:.7'}"></div>`).join('')}</div>
    <div class="grid3" style="margin-top:12px">`;
  for(const s of S){
    const top=P.map((p,j)=>[j,s.pm[j]]).filter(x=>P[x[0]].active).sort((a,b)=>b[1]-a[1]).slice(0,6);
    const cp=P.map((p,j)=>[j,s.cpt[j]]).filter(x=>x[1]>0).sort((a,b)=>b[1]-a[1]).slice(0,5);
    h+=`<div class="card"><div class="row" style="justify-content:space-between"><h3>${esc(s.name)}</h3><span class="chip">${pct(s.p,1)} of sims</span></div>
      <div class="num" style="font-size:20px;margin-block:4px 8px"><span class="t0">${ST.teams[0]} ${fmt(s.sa,1)}</span> - <span class="t1">${ST.teams[1]} ${fmt(s.sb,1)}</span></div>
      <div class="grid2" style="gap:10px"><div><div class="lbl">Top scorers (avg pts)</div>${top.map(([j,v])=>`<div class="row" style="justify-content:space-between"><button class="plink" data-pc="${j}">${esc(P[j].name)}</button><span class="num">${fmt(v)}</span></div>`).join('')}</div>
      <div><div class="lbl">Optimal captains</div>${cp.map(([j,v])=>`<div class="row" style="justify-content:space-between"><button class="cptc plink" data-pc="${j}">${esc(P[j].name)}</button><span class="num">${pct(v,0)}</span></div>`).join('')}</div></div></div>`;
  }
  el.innerHTML=h+'</div>';
}

/* ---------------- correlation matrix ---------------- */
function renderCorr(){
  const R=ST.res, el=$('#pane-corr'); if(!R) return;
  const {N,n,pts,P,opt}=R; const minM=ST.view.corrMin!=null?ST.view.corrMin:2;
  const mean=R.stats.map(s=>s.mean);
  let ids=P.map((p,j)=>j).filter(j=>P[j].active&&mean[j]>=minM);
  ids.sort((a,b)=>(teamIdx(P[a])-teamIdx(P[b]))||(mean[b]-mean[a])); ids=ids.slice(0,30);
  const m=ids.length; const sd=new Float64Array(m); const C=new Float64Array(m*m);
  for(let i=0;i<N;i++){const o=i*n; for(let a=0;a<m;a++){const da=pts[o+ids[a]]-mean[ids[a]]; sd[a]+=da*da; for(let b=a+1;b<m;b++) C[a*m+b]+=da*(pts[o+ids[b]]-mean[ids[b]]);}}
  for(let a=0;a<m;a++) for(let b=a+1;b<m;b++){const r=C[a*m+b]/Math.sqrt(sd[a]*sd[b]); C[a*m+b]=C[b*m+a]=isFinite(r)?r:0;}
  // co-optimal: both in the sim-optimal lineup
  const pos=new Map(ids.map((j,k)=>[j,k])); const CO=new Float64Array(m*m); let okN=0;
  for(let i=0;i<N;i++){ if(opt[i*6]<0) continue; okN++; const ks=[]; for(let k=0;k<6;k++){const q=pos.get(opt[i*6+k]); if(q!=null) ks.push(q);} for(let x=0;x<ks.length;x++) for(let y=x+1;y<ks.length;y++){CO[ks[x]*m+ks[y]]++;CO[ks[y]*m+ks[x]]++;} }
  const col=(r)=>{const a=Math.min(1,Math.abs(r)/0.5); return r>=0?`color-mix(in srgb, var(--accent) ${Math.round(a*85)}%, var(--panel))`:`color-mix(in srgb, var(--cpt) ${Math.round(a*85)}%, var(--panel))`;};
  const split=ids.findIndex(j=>teamIdx(P[j])===1);
  let h=`<div class="bar"><p class="note small">Pearson correlation of DK points across all ${N.toLocaleString()} sims. Green moves together, orange moves opposite. Hover a cell for the pair, its correlation, and how often both landed in the same sim-optimal lineup.</p>
    <div class="row"><label class="small muted" for="corrMin">Min mean pts</label><input id="corrMin" type="number" step="0.5" min="0" value="${minM}"></div></div>
    <div class="tw corrwrap"><table class="cmx"><thead><tr><th class="rowh"></th>${ids.map((j,k)=>`<th class="colh${k===split?' sep':''}"><span><span class="tm ${teamIdx(P[j])?'b':'a'}"></span>${esc(P[j].name)}</span></th>`).join('')}</tr></thead><tbody>`;
  ids.forEach((j,a)=>{
    h+=`<tr class="${a===split?'sepr':''}"><th class="rowh"><span class="tm ${teamIdx(P[j])?'b':'a'}"></span><button class="plink" data-pc="${j}">${esc(P[j].name)}</button> <span class="pos">${P[j].pos}</span></th>`;
    ids.forEach((k,b)=>{ if(a===b){h+=`<td class="diag${b===split?' sep':''}"></td>`;return;} const r=C[a*m+b];
      h+=`<td class="${b===split?'sep':''}" style="background:${col(r)};color:${Math.abs(r)>0.38?'var(--accent-ink)':'var(--ink)'}" title="${esc(P[j].name)} + ${esc(P[k].name)}: r = ${r.toFixed(2)}; both optimal in ${pct(CO[a*m+b]/okN,1)} of sims">${Math.round(r*100)}</td>`;});
    h+='</tr>';});
  h+='</tbody></table></div>';
  const pairs=[]; for(let a=0;a<m;a++) for(let b=a+1;b<m;b++) pairs.push({a:ids[a],b:ids[b],r:C[a*m+b],co:CO[a*m+b]/okN,same:P[ids[a]].team===P[ids[b]].team});
  const li=(arr)=>`<div class="tw" style="border:0"><table><thead><tr><th>Pair</th><th class="n">r</th><th class="n">Both optimal</th></tr></thead><tbody>${arr.map(x=>`<tr><td style="white-space:normal"><span class="tm ${teamIdx(P[x.a])?'b':'a'}"></span>${esc(P[x.a].name)} + <span class="tm ${teamIdx(P[x.b])?'b':'a'}"></span>${esc(P[x.b].name)}</td><td class="n">${x.r>=0?'+':''}${x.r.toFixed(2)}</td><td class="n">${pct(x.co,1)}</td></tr>`).join('')}</tbody></table></div>`;
  h+=`<div class="grid3" style="margin-top:16px">
    <div class="card"><h3>Strongest same-team stacks</h3>${li(pairs.filter(x=>x.same).sort((x,y)=>y.r-x.r).slice(0,10))}</div>
    <div class="card"><h3>Strongest bring-backs</h3><p class="small muted">Opposing players who score together, usually shootout scripts.</p>${li(pairs.filter(x=>!x.same).sort((x,y)=>y.r-x.r).slice(0,10))}</div>
    <div class="card"><h3>Most negative pairs</h3><p class="small muted">Usually players competing for the same touches, or an offense against the defense facing it.</p>${li(pairs.slice().sort((x,y)=>x.r-y.r).slice(0,10))}</div></div>`;
  el.innerHTML=h;
  $('#corrMin').onchange=(e)=>{ST.view.corrMin=Math.max(0,+e.target.value||0); renderCorr();};
}

/* ---------------- single game play-by-play ---------------- */
function clk(e){const q=e.q; let c=e.c; if(q===1||q===3) c-=900; c=Math.max(0,Math.round(c)); return `${Math.floor(c/60)}:${String(c%60).padStart(2,'0')}`;}
function spotOf(t,y){const T=ST.teams; if(y===50) return '50'; return y>50?`${T[t]} ${100-y}`:`${T[1-t]} ${y}`;}
const ORD=['1st','2nd','3rd','4th'];
function scriptOfScores(a,b){const R=ST.res; const w=b>a?1:(a>b?0:-1); if(w<0) return -1; return w*4+(Math.abs(a-b)>=10?2:0)+((a+b)>R.medT?1:0);}
function renderPBP(){
  const R=ST.res, el=$('#pane-pbp'); if(!R) return;
  const opts=R.scripts.filter(s=>s.n).sort((a,b)=>b.p-a.p).map(s=>`<option value="${s.k}">${esc(s.name)} (${pct(s.p,0)})</option>`).join('');
  el.innerHTML=`<div class="bar"><div class="row"><button class="primary" id="pbpGo">Simulate one game</button>
      <label class="small muted" for="pbpScript">Game script</label><select id="pbpScript"><option value="any">Any outcome</option>${opts}</select>
      <label class="small muted" for="pbpSeed">Seed</label><input id="pbpSeed" type="number" style="width:110px" placeholder="random">
      <button id="pbpReplay" title="Replay the game for this seed">Replay seed</button></div>
      <p class="note small">Runs one game with the same calibrated inputs as the main simulation and prints every snap with the model's call: pass probability on each play, go/punt/FG odds on 4th down, sack and FG make rates, injuries, flags and timeouts.</p></div><div id="pbpOut"></div>`;
  $('#pbpGo').onclick=()=>simOne(null); $('#pbpReplay').onclick=()=>{const s=+$('#pbpSeed').value; if(s) simOne(s);};
  if(ST.pbp) drawPBP(); else simOne(null);
}
function simOne(seed){
  const R=ST.res; if(!ST.pbpG||ST.pbpG._res!==R){ST.pbpG=E.prepGame(MODEL,R.slate); ST.pbpG._res=R;}
  const G=ST.pbpG; const out=new Float32Array(G.n); const want=$('#pbpScript')?$('#pbpScript').value:'any';
  if(seed==null){ seed=(Math.random()*2147483647)>>>0||1;
    if(want!=='any'){ for(let k=0;k<3000;k++){ G.log=null; const S=E.simGame(G,E.makeRng(seed),R.cal.s,out); if(scriptOfScores(S[0],S[E.NS])===+want) break; seed=(seed*16807+11)%2147483647||1; } } }
  G.log=[]; const S=Float64Array.from(E.simGame(G,E.makeRng(seed),R.cal.s,out));
  const B={}; for(const k in G.buf) B[k]=Float64Array.from(G.buf[k]);
  const log=G.log; G.log=null;
  const best=E.makeOptimizer(G,{eligible:R.elig,cap:50000})(out);
  ST.pbp={seed,S,B,log,pts:Float32Array.from(out),best,meta:log.meta};
  $('#pbpSeed').value=seed; drawPBP();
}
function statLine(j){
  const p=ST.res.P[j], B=ST.pbp.B; const f=(v)=>Math.round(v);
  if(p.pos==='DST'||p.pos==='K') return p.pos==='K'?'FG/XP':'';
  const parts=[];
  if(B.pA[j]||B.pC[j]) parts.push(`${f(B.pC[j])}/${f(B.pA[j])}, ${f(B.pY[j])} yds${B.pTD[j]?`, ${f(B.pTD[j])} TD`:''}${B.pInt[j]?`, ${f(B.pInt[j])} INT`:''}`);
  if(B.rA[j]) parts.push(`${f(B.rA[j])} rush ${f(B.rY[j])} yds${B.rTD[j]?`, ${f(B.rTD[j])} TD`:''}`);
  if(B.tg[j]) parts.push(`${f(B.rec[j])}/${f(B.tg[j])} rec ${f(B.recY[j])} yds${B.recTD[j]?`, ${f(B.recTD[j])} TD`:''}`);
  if(B.fl[j]) parts.push(`${f(B.fl[j])} fum lost`); if(B.two[j]) parts.push(`${f(B.two[j])} 2-pt`); if(B.ret[j]) parts.push(`${f(B.ret[j])} return TD`);
  return parts.join(' · ');
}
function drawPBP(){
  const R=ST.res, X=ST.pbp, out=$('#pbpOut'); const P=R.P, T=ST.teams, NS=E.NS, S=X.S;
  const flt=ST.view.pbpFilter||'all';
  // drives
  const drives=[]; let cur=null;
  for(const e of X.log){ if(e.ko){cur=null; continue;} if(!cur||cur.id!==e.drive){cur={id:e.drive,off:e.off,q:e.q,c:e.c,clk:clk(e),yl:e.yl,plays:0,ev:[]}; drives.push(cur);} cur.ev.push(e); if(e.t!=='pen'&&e.t!=='kneel'&&e.t!=='info'&&e.t) cur.plays++; }
  drives.forEach((d,i)=>{const last=d.ev[d.ev.length-1]; const tx=last.x.join(' ');
    d.res=/TOUCHDOWN/.test(tx)?(last.flags.includes('to')?'Turnover, returned for TD':'Touchdown'):/FG GOOD/.test(tx)?'Field goal':/FG MISSED/.test(tx)?'Missed FG':/BLOCKED/.test(tx)?'Blocked kick':/Turnover on downs/.test(tx)?'Downs':last.flags.includes('to')?'Turnover':last.t==='punt'?'Punt':/SAFETY/.test(tx)?'Safety':/kneels/.test(tx)?'Kneel':/Final/.test(tx)?'End of game':'End of half';
    const nx=X.log[X.log.indexOf(last)+1]; d.dur=Math.max(0,Math.round(d.c-(nx&&nx.h===last.h?nx.c:0)));});
  const m=X.meta; const ord=P.map((p,j)=>j).filter(j=>P[j].active&&(X.pts[j]!==0||statLine(j))).sort((a,b)=>X.pts[b]-X.pts[a]);
  const bestL=X.best?X.best.L:[]; const bestV=X.best?(1.5*X.pts[bestL[0]]+bestL.slice(1).reduce((s,j)=>s+X.pts[j],0)):0;
  const box=[['Points',0],['Offensive plays',1],['Pass attempts',2],['Pass yards',5],['Sacks taken',3],['Rush attempts',4],['Rush yards',6],['Turnovers',11],['4th-down tries',8],['FG attempts',9],['Punts',10],['Penalties (no play)',7],['Drives',13]];
  const sc=scriptOfScores(S[0],S[NS]); const scName=sc>=0?R.scripts[sc].name:'Tie';
  let h=`<div class="pbphead"><div class="final"><span class="t0">${T[0]} ${S[0]}</span> <span class="muted">-</span> <span class="t1">${T[1]} ${S[NS]}</span></div>
    <div class="small muted">Seed ${X.seed} · script: ${esc(scName)} · ${X.log.length} logged snaps</div>
    <div class="small">This game's random draws: offense efficiency ${T[0]} ${m.s[0]>=0?'+':''}${m.s[0].toFixed(2)}, ${T[1]} ${m.s[1]>=0?'+':''}${m.s[1].toFixed(2)} (calibrated base ${R.cal.s.map(x=>x.toFixed(2)).join(' / ')}); pass-rate tilt ${m.proe.map(x=>(x>=0?'+':'')+x.toFixed(2)).join(' / ')} logit; pace ×${m.pace.toFixed(2)}.</div></div>
    <div class="grid2" style="margin-top:12px"><div class="card"><h3>Box score</h3><table><thead><tr><th></th><th class="n">${T[0]}</th><th class="n">${T[1]}</th></tr></thead><tbody>${box.map(([l,k])=>`<tr><td>${l}</td><td class="n">${Math.round(S[k])}</td><td class="n">${Math.round(S[NS+k])}</td></tr>`).join('')}</tbody></table></div>
    <div class="card"><h3>DK points this game</h3><p class="small">Optimal lineup in this game: <span class="cptc">${bestL.length?esc(P[bestL[0]].name):''}</span> ${bestL.slice(1).map(j=>esc(P[j].name)).join(' · ')} <b class="num">${fmt(bestV)}</b></p>
      <div class="tw" style="border:0;max-height:420px;overflow:auto"><table><thead><tr><th>Player</th><th>Line</th><th class="n">FLEX</th><th class="n">CPT</th></tr></thead><tbody>${ord.map(j=>`<tr${bestL.includes(j)?' class="hl"':''}><td><span class="tm ${teamIdx(P[j])?'b':'a'}"></span><button class="plink" data-pc="${j}">${esc(P[j].name)}</button><span class="pos">${P[j].pos}</span></td><td class="small">${statLine(j)}</td><td class="n">${fmt(X.pts[j])}</td><td class="n">${fmt(X.pts[j]*1.5)}</td></tr>`).join('')}</tbody></table></div></div></div>
    <div class="card" style="margin-top:16px"><h3>Drives</h3><div class="tw" style="border:0"><table><thead><tr><th>#</th><th>Team</th><th>Start</th><th>Field</th><th class="n">Plays</th><th class="n">Time</th><th>Result</th></tr></thead><tbody>${drives.map((d,i)=>`<tr><td class="num">${i+1}</td><td><span class="tm ${d.off?'b':'a'}"></span>${T[d.off]}</td><td class="num">Q${d.q>4?'OT':d.q} ${d.clk}</td><td class="num">${spotOf(d.off,d.yl)}</td><td class="n">${d.plays}</td><td class="n">${Math.floor(d.dur/60)}:${String(d.dur%60).padStart(2,'0')}</td><td>${d.res==='Touchdown'||d.res==='Field goal'?`<b>${d.res}</b>`:d.res}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="bar" style="margin-top:16px"><h3>Play by play</h3><div class="seg" role="group" aria-label="Filter plays">${[['all','All snaps'],['key','Key plays'],['0',T[0]+' offense'],['1',T[1]+' offense']].map(([v,l])=>`<button data-f="${v}" aria-pressed="${flt===v}">${esc(l)}</button>`).join('')}</div></div>
    <div class="tw"><table class="pbp"><thead><tr><th>Qtr</th><th>Clock</th><th>Off</th><th>Situation</th><th>Model call</th><th>Play</th><th class="n">Score</th></tr></thead><tbody>`;
  let lastDrive=-1;
  for(const e of X.log){
    if(e.info&&flt==='key') continue;
    const key=e.flags.length||(!e.ko&&e.down===4)||e.t==='fg'||e.t==='fgx'||e.t==='pen'||/Timeout|Two-minute|End of|Final|backup/.test(e.x.join(' '));
    if(flt==='key'&&!key) continue; if((flt==='0'||flt==='1')&&(e.ko||e.off!==+flt)) continue;
    if(!e.ko&&e.drive!==lastDrive&&flt!=='key'){lastDrive=e.drive; h+=`<tr class="drv"><td colspan="7"><span class="tm ${e.off?'b':'a'}"></span>${T[e.off]} ball at ${spotOf(e.off,e.yl)}${e.info?' · '+esc(e.x[0]):''}</td></tr>`; if(e.info) continue;}
    const cls=e.info?'inforow':e.flags.includes('td')||e.t==='fg'||e.flags.includes('sf')?'sc':e.flags.includes('to')?'tov':e.flags.includes('inj')?'injr':e.t==='pen'?'penr':'';
    const sit=e.info?'':e.ko?'Kickoff':`${ORD[e.down-1]||e.down+'th'} & ${e.yl<=e.togo?'Goal':e.togo} at ${spotOf(e.off,e.yl)}`;
    const call=e.dec?esc(e.dec):e.pp!=null?`P(pass) ${Math.round(e.pp*100)}% → ${['pass','sack','scr'].includes(e.t)?'pass':e.t==='run'?'run':e.t==='pen'?'flag':'-'}`:'';
    const chg=e.a0!==e.s0||e.a1!==e.s1;
    h+=`<tr class="${cls}"><td class="num">${e.q>4?'OT':e.q}</td><td class="num">${clk(e)}</td><td><span class="tm ${e.off?'b':'a'}"></span>${T[e.off]}</td><td class="num small">${sit}</td><td class="small muted">${call}</td><td class="wrapc">${e.x.map(esc).join(' · ')}</td><td class="n${chg?' strong':''}">${e.a0}-${e.a1}</td></tr>`;
  }
  h+='</tbody></table></div>';
  out.innerHTML=h;
  $$('.seg button[data-f]',out).forEach(b=>b.onclick=()=>{ST.view.pbpFilter=b.dataset.f; drawPBP();});
}

/* ---------------- player cards ---------------- */
let LOGS=null; const getLogs=()=>LOGS||(LOGS=JSON.parse($('#logs-data').textContent));
const CI={}; ['wk','opp','ha','snap','dk','xfp','epa','pc','pa','py','ptd','pint','sk','ra','ry','rtd','tg','rec','recy','rectd','ay','routes','tdb','tt','tr','est'].forEach((k,i)=>CI[k]=i);
function logKey(p){ if(p.pos==='DST') return p.team; return p.mid; }
function openCard(j,yr){
  const p=ST.players[j]; if(!p) return; const L=getLogs(); const e=L.p[logKey(p)];
  const years=e?Object.keys(e.g).sort().reverse():[]; const y=yr||ST.cardYear&&years.includes(ST.cardYear)&&ST.cardYear||years[0];
  ST.cardJ=j; const box=$('#pcard');
  const R=ST.res; const s=R&&R.stats[j];
  const proj=s?`<div class="pc-proj"><div><span class="lbl">Sim mean</span><b class="num">${fmt(s.mean)}</b></div><div><span class="lbl">10th / 50th / 90th</span><span class="num">${fmt(s.pc[1])} / ${fmt(s.pc[5])} / ${fmt(s.pc[9])}</span></div>
     <div><span class="lbl">CPT opt</span><span class="num cptc">${pct(s.cpt)}</span></div><div><span class="lbl">FLEX opt</span><span class="num">${pct(s.flex)}</span></div>
     ${['QB','RB','WR','TE'].includes(p.pos)?`<div><span class="lbl">Slate run / tgt share</span><span class="num">${fmt((p.rs||0)*100)}% / ${fmt((p.ts||0)*100)}%</span></div>`:''}</div>`:'';
  const excl=ST.portExcl&&ST.res?`<button id="pcExcl" class="${ST.portExcl.has(j)?'':'primary'}">${ST.portExcl.has(j)?'Include in portfolio':'Exclude from portfolio'}</button>`:'';
  let body='';
  if(!e) body=`<p class="note">No NFL game logs found for this player in 2024-2026 play-by-play${p.matched?'':' (name not matched to nflverse)'}.</p>`;
  else { const rows=e.g[y]||[]; const cur=String(MODEL.meta&&MODEL.meta.season||'2026');
    const note=y!==cur?(years.includes(cur)?'':` <span class="chip ex">No ${cur} games yet</span>`):'';
    body=`<div class="row" style="justify-content:space-between;align-items:center;margin:4px 0 8px"><h3 class="pc-yr" style="margin:0">${y} game logs <span class="small muted" style="font-family:var(--f-body);font-weight:400">regular season · ${rows.length} game${rows.length===1?'':'s'}</span>${note}</h3><div class="seg" role="group" aria-label="Season">${years.map(x=>`<button data-yr="${x}" aria-pressed="${x===y}">${x}</button>`).join('')}</div></div>`+cardSeason(p.pos==='DST'?'DST':e.pos,rows,y); }
  box.innerHTML=`<div class="pc-in" role="dialog" aria-modal="true" aria-label="${esc(p.name)} player card"><div class="pc-head"><div><div class="lbl">${p.pos} · ${esc(p.team)}${e&&e.tm&&e.tm!==p.team?' (data last with '+esc(e.tm)+')':''}</div><h2>${esc(p.name)}</h2>
    <div class="small muted">FLEX $${(p.salF||0).toLocaleString()} · CPT $${(p.salC||0).toLocaleString()} · DK season avg ${fmt(p.avg)} (from the CSV) ${p.status?`<span class="chip bad">${esc(p.status)}</span>`:''}</div></div>
    <div class="row">${excl}<button id="pcClose" aria-label="Close">Close</button></div></div>${proj}${body}</div>`;
  box.hidden=false; document.body.style.overflow='hidden';
  $('#pcClose').onclick=closeCard; $$('[data-yr]',box).forEach(b=>b.onclick=()=>{ST.cardYear=b.dataset.yr; openCard(j,b.dataset.yr);});
  const ex=$('#pcExcl'); if(ex) ex.onclick=()=>{ if(ST.portExcl.has(j)) ST.portExcl.delete(j); else ST.portExcl.add(j); const c=$(`#exclChips .xbtn[data-x="${j}"]`); if(c){c.parentElement.classList.toggle('on',ST.portExcl.has(j)); c.setAttribute('aria-pressed',ST.portExcl.has(j));} if(typeof onExclChange==='function') onExclChange(); openCard(j,y); };
  $('#pcClose').focus();
}
function closeCard(){ $('#pcard').hidden=true; document.body.style.overflow=''; }
function cardSeason(pos,rows,y){
  if(!rows.length) return '<p class="note">No games this season.</p>';
  const sum=(k)=>rows.reduce((a,r)=>a+(+r[CI[k]]||0),0), g=rows.length;
  const hm=(v,mx)=>{const f=Math.max(0,Math.min(1,v/mx)); return `style="background:color-mix(in srgb, var(--accent) ${Math.round(f*f*50+(f>0?3:0))}%, var(--panel))"`;};
  const dkmx=Math.max(...rows.map(r=>pos==='K'||pos==='DST'?r[3]:r[CI.dk]),1);
  const chart=(vals,xs,labels)=>{ // DK bars with xFP ticks
    const W=Math.max(320,vals.length*34), H=120, mx=Math.max(...vals,...(xs||[0]),1), bw=Math.min(22,(W-30)/vals.length-6);
    let s=`<svg viewBox="0 0 ${W} ${H+18}" width="${W}" height="${H+18}" class="pc-chart" role="img" aria-label="DK points by game">`;
    [0.5,1].forEach(f=>{const yy=H-(H-14)*f; s+=`<line x1="24" x2="${W}" y1="${yy}" y2="${yy}" stroke="var(--line)"/><text x="20" y="${yy+3}" text-anchor="end">${Math.round(mx*f)}</text>`;});
    vals.forEach((v,i)=>{const x=28+i*((W-30)/vals.length); const h=(H-14)*Math.max(0,v)/mx;
      s+=`<rect x="${x}" y="${H-h}" width="${bw}" height="${Math.max(1,h)}" fill="var(--accent)" rx="2"><title>${labels[i]}: ${fmt(v)} DK${xs?` · xFP ${fmt(xs[i])}`:''}</title></rect>`;
      if(xs){const yy=H-(H-14)*Math.max(0,xs[i])/mx; s+=`<line x1="${x-2}" x2="${x+bw+2}" y1="${yy}" y2="${yy}" stroke="var(--cpt)" stroke-width="2.5"/>`;}
      s+=`<text x="${x+bw/2}" y="${H+13}" text-anchor="middle">${labels[i].split(' ')[0]}</text>`;});
    return `<div class="pc-chartwrap">${s}</svg><div class="small muted">${xs?'Bars = DK points, orange tick = expected DK points (xFP) from the player\'s opportunities':'Bars = DK points'}</div></div>`;
  };
  const lab=rows.map(r=>`W${r[0]} ${r[2]?'vs':'@'} ${r[1]} (${y})`);
  if(pos==='K'){
    const t=[y+' wk','Opp','FG','Long','XP','DK'];
    return chart(rows.map(r=>r[3]),null,lab)+`<div class="tw"><table><thead><tr>${t.map((x,i)=>`<th class="${i>1?'n':''}">${x}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr><td>${r[0]}</td><td>${r[2]?'':'@'}${r[1]}</td><td class="n">${r[4]}/${r[5]}</td><td class="n">${r[6]||'-'}</td><td class="n">${r[7]}/${r[8]}</td><td class="n" ${hm(r[3],dkmx)}><b>${fmt(r[3])}</b></td></tr>`).join('')}
      <tr class="tot"><td colspan="2">Per game</td><td class="n">${fmt(rows.reduce((a,r)=>a+r[4],0)/g)}/${fmt(rows.reduce((a,r)=>a+r[5],0)/g)}</td><td class="n">${Math.max(...rows.map(r=>r[6]))}</td><td class="n">${fmt(rows.reduce((a,r)=>a+r[7],0)/g)}</td><td class="n"><b>${fmt(rows.reduce((a,r)=>a+r[3],0)/g)}</b></td></tr></tbody></table></div>`;
  }
  if(pos==='DST'){
    const t=[y+' wk','Opp','Sacks','INT','Fum rec','TD','Pts allowed','DK'];
    return chart(rows.map(r=>r[3]),null,lab)+`<div class="tw"><table><thead><tr>${t.map((x,i)=>`<th class="${i>1?'n':''}">${x}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr><td>${r[0]}</td><td>${r[2]?'':'@'}${r[1]}</td>${[4,5,6,7,8].map(k=>`<td class="n">${r[k]}</td>`).join('')}<td class="n" ${hm(r[3],dkmx)}><b>${fmt(r[3])}</b></td></tr>`).join('')}
      <tr class="tot"><td colspan="2">Per game</td>${[4,5,6,7,8].map(k=>`<td class="n">${fmt(rows.reduce((a,r)=>a+r[k],0)/g)}</td>`).join('')}<td class="n"><b>${fmt(rows.reduce((a,r)=>a+r[3],0)/g)}</b></td></tr></tbody></table></div>`;
  }
  const v=(r,k)=>+r[CI[k]]||0; const est=rows.some(r=>v(r,'est'));
  const routePct=(r)=>v(r,'tdb')?v(r,'routes')/v(r,'tdb'):0;
  const cols={
    QB:[['Snap %',r=>v(r,'snap')+'%'],['Cmp/Att',r=>v(r,'pc')+'/'+v(r,'pa')],['Pass yds',r=>v(r,'py')],['TD',r=>v(r,'ptd')],['INT',r=>v(r,'pint')],['Sk',r=>v(r,'sk')],['Rush',r=>v(r,'ra')],['R yds',r=>v(r,'ry')],['R TD',r=>v(r,'rtd')],['EPA/play',r=>r[CI.epa]==null?'-':(+r[CI.epa]).toFixed(2)]],
    RB:[['Snap %',r=>v(r,'snap')+'%'],['Rush',r=>v(r,'ra')],['Rush share',r=>v(r,'tr')?pct(v(r,'ra')/v(r,'tr'),0):'-'],['R yds',r=>v(r,'ry')],['R TD',r=>v(r,'rtd')],['Tgt',r=>v(r,'tg')],['Rec',r=>v(r,'rec')],['Rec yds',r=>v(r,'recy')],['Rec TD',r=>v(r,'rectd')],['Route %',r=>(v(r,'est')?'~':'')+pct(routePct(r),0)],['EPA/play',r=>r[CI.epa]==null?'-':(+r[CI.epa]).toFixed(2)]],
    WR:[['Snap %',r=>v(r,'snap')+'%'],['Route %',r=>(v(r,'est')?'~':'')+pct(routePct(r),0)],['Tgt',r=>v(r,'tg')],['Tgt share',r=>v(r,'tt')?pct(v(r,'tg')/v(r,'tt'),0):'-'],['Rec',r=>v(r,'rec')],['Yds',r=>v(r,'recy')],['TD',r=>v(r,'rectd')],['aDOT',r=>v(r,'tg')?fmt(v(r,'ay')/v(r,'tg')):'-'],['Air yds',r=>v(r,'ay')],['YPRR',r=>v(r,'routes')?(v(r,'recy')/v(r,'routes')).toFixed(2):'-'],['Rush',r=>v(r,'ra')?v(r,'ra')+' for '+v(r,'ry'):'-'],['EPA/play',r=>r[CI.epa]==null?'-':(+r[CI.epa]).toFixed(2)]]
  }; cols.TE=cols.WR;
  const C=cols[pos]||cols.WR;
  // season totals
  const T={snap:sum('snap')/g,pc:sum('pc'),pa:sum('pa'),py:sum('py'),ptd:sum('ptd'),pint:sum('pint'),sk:sum('sk'),ra:sum('ra'),ry:sum('ry'),rtd:sum('rtd'),tg:sum('tg'),rec:sum('rec'),recy:sum('recy'),rectd:sum('rectd'),ay:sum('ay'),routes:sum('routes'),tdb:sum('tdb'),tt:sum('tt'),tr:sum('tr'),dk:sum('dk'),xfp:sum('xfp')};
  const epaN=rows.filter(r=>r[CI.epa]!=null); const epa=epaN.length?epaN.reduce((a,r)=>a+(+r[CI.epa]),0)/epaN.length:null;
  const tiles=[['Games',g],['DK pts / g',fmt(T.dk/g)],['xFP / g',fmt(T.xfp/g)],['DK minus xFP / g',(T.dk-T.xfp>=0?'+':'')+fmt((T.dk-T.xfp)/g)],['Snap %',fmt(T.snap,0)+'%']];
  if(pos==='QB') tiles.push(['Pass yds / g',fmt(T.py/g,0)],['TD-INT',T.ptd+'-'+T.pint],['Rush yds / g',fmt(T.ry/g,0)],['EPA / play',epa==null?'-':epa.toFixed(2)]);
  else tiles.push(['Route %',(est?'~':'')+pct(T.tdb?T.routes/T.tdb:0,0)],['Target share',pct(T.tt?T.tg/T.tt:0,1)],['YPRR',T.routes?(T.recy/T.routes).toFixed(2):'-'],['aDOT',T.tg?fmt(T.ay/T.tg):'-'],...(pos==='RB'?[['Rush share',pct(T.tr?T.ra/T.tr:0,1)],['Yds / carry',T.ra?fmt(T.ry/T.ra):'-']]:[]),['EPA / play',epa==null?'-':epa.toFixed(2)]);
  const xmx=Math.max(...rows.map(r=>v(r,'xfp')),1);
  let h=`<div class="pc-tiles">${tiles.map(([l,x])=>`<div><span class="lbl">${l}</span><b class="num">${x}</b></div>`).join('')}</div>`+chart(rows.map(r=>v(r,'dk')),rows.map(r=>v(r,'xfp')),lab);
  h+=`<div class="tw"><table class="pclog"><thead><tr><th>${y} wk</th><th>Opp</th>${C.map(c=>`<th class="n">${c[0]}</th>`).join('')}<th class="n">xFP</th><th class="n">DK</th></tr></thead><tbody>`;
  h+=rows.map(r=>`<tr><td>${r[0]}</td><td>${r[2]?'':'@'}${r[1]}</td>${C.map(c=>`<td class="n">${c[1](r)}</td>`).join('')}<td class="n" ${hm(v(r,'xfp'),Math.max(xmx,dkmx))}>${fmt(v(r,'xfp'))}</td><td class="n" ${hm(v(r,'dk'),dkmx)}><b>${fmt(v(r,'dk'))}</b></td></tr>`).join('');
  const tr={snap:T.snap,pc:T.pc,pa:T.pa,py:T.py,ptd:T.ptd,pint:T.pint,sk:T.sk,ra:T.ra,ry:T.ry,rtd:T.rtd,tg:T.tg,rec:T.rec,recy:T.recy,rectd:T.rectd,ay:T.ay,routes:T.routes,tdb:T.tdb,tt:T.tt,tr:T.tr,est:est?1:0,epa:epa};
  const tot=[]; tot[CI.epa]=epa; for(const k in tr) if(k!=='epa') tot[CI[k]]=Math.round(tr[k]);
  h+=`<tr class="tot"><td colspan="2">${y} season (${g} g)</td>${C.map(c=>`<td class="n">${c[1](tot)}</td>`).join('')}<td class="n">${fmt(T.xfp/g)}/g</td><td class="n"><b>${fmt(T.dk/g)}/g</b></td></tr></tbody></table></div>`;
  h+=`<p class="small muted">Snap % from PFR snap counts. Route % = share of team dropbacks with the player on the field as a WR/TE/RB${y==='2026'||est?'; ~ marks an estimate from snap share (2026 participation data is not published yet)':''}. YPRR = receiving yards per route. xFP = league-average DK points for each target (by air yards and field position), carry (by field position) and, for QBs, pass attempt. EPA/play = nflfastR EPA per dropback or rush (QB) or per carry and target.</p>`;
  return h;
}
document.addEventListener('click',(ev)=>{const t=ev.target.closest('[data-pc]'); if(t){ev.stopPropagation(); ev.preventDefault(); openCard(+t.dataset.pc);} else if(ev.target.id==='pcard') closeCard();},true);
document.addEventListener('keydown',(ev)=>{if(ev.key==='Escape'&&!$('#pcard').hidden) closeCard();});

/* ---------------- live lines (ESPN public scoreboard) ---------------- */
async function pullLines(){
  const btn=$('#pullLines'); const note=$('#lineSrc'); btn.disabled=true; note.textContent='Pulling from ESPN…';
  const ESPN={WSH:'WAS',LAR:'LA',JAC:'JAX'}; const m=(ST.dk&&/(\d{2})\/(\d{2})\/(\d{4})/.exec(ST.dk.gameInfo))||null;
  const urls=[]; if(m) urls.push(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${m[3]}${m[1]}${m[2]}`); urls.push('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard');
  try{
    let found=null;
    for(const u of urls){ const r=await fetch(u,{cache:'no-store'}); if(!r.ok) continue; const js=await r.json();
      for(const ev of js.events||[]){ const c=ev.competitions&&ev.competitions[0]; if(!c) continue; const tm={}; c.competitors.forEach(x=>{tm[x.homeAway]=ESPN[x.team.abbreviation]||x.team.abbreviation;});
        if(tm.away===ST.teams[0]&&tm.home===ST.teams[1]&&c.odds&&c.odds.length){found={o:c.odds[0],name:ev.shortName};break;} }
      if(found) break; }
    if(!found) throw new Error('This game has no ESPN line posted.');
    const o=found.o; const tot=+o.overUnder; let sp=null; const d=/([A-Z]{2,4})\s*(-?\d+(\.\d+)?)/.exec(o.details||'');
    if(/EVEN|PK/i.test(o.details||'')) sp=0; else if(d){ const fav=ESPN[d[1]]||d[1]; const v=Math.abs(+d[2]); sp=fav===ST.teams[1]?-v:v; } else if(o.spread!=null) sp=+o.spread;
    if(!(tot>0)||sp==null) throw new Error('ESPN returned an incomplete line.');
    const home=(tot-sp)/2; $('#impA').value=+(tot-home).toFixed(2); $('#impB').value=+home.toFixed(2); updateLineNote(); markStale();
    note.textContent=`ESPN (${o.provider&&o.provider.name||'consensus'}): ${o.details}, O/U ${tot} · pulled ${new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}`;
  }catch(err){
    note.textContent=/Failed to fetch|NetworkError|Load failed|Content Security/i.test(String(err))?'Could not reach ESPN. The claude.ai viewer blocks outside requests, so use the downloaded HTML file (and check your connection).':String(err.message||err);
  }
  btn.disabled=false;
}

/* ---------------- projected ownership + contest field ---------------- */

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
  const rows=SL.parseCSV(text); if(!rows.length){toast('Empty ownership file');return;}
  const h=rows[0].map(x=>x.trim().toLowerCase());
  const iN=h.findIndex(x=>x==='name'||x==='player'||x==='player name'||x.includes('name'));
  const iC=h.findIndex(x=>x.includes('own')&&(x.includes('cpt')||x.includes('capt')));
  const iF=h.findIndex(x=>x.includes('own')&&(x.includes('flex')||x.includes('util')));
  const iO=h.findIndex(x=>x.includes('own'));
  if(iN<0||(iC<0&&iF<0&&iO<0)){toast('Need a Name column and ownership columns (e.g. ProjOwnCPT, ProjOwnFLEX)');return;}
  const map=new Map();
  for(const r of rows.slice(1)){ const nm=SL.norm(r[iN]||''); if(!nm) continue; const c=iC>=0?parseFloat(r[iC]):NaN, f=iF>=0?parseFloat(r[iF]):(iO>=0?parseFloat(r[iO]):NaN);
    map.set(nm,{c:isNaN(c)?null:c/100,f:isNaN(f)?null:f/100}); }
  ST.own=map; ST.ownLabel=label||'ownership CSV'; ST.projMap=readProjCol(rows); applyProjRoles(); applyOwnership(); toast(ST.projBench&&ST.projBench.n?`Ownership loaded · ${ST.projBench.n} players with a 0-point projection get no role (re-run)`:'Ownership loaded'); if(ST.projBench&&ST.projBench.n) renderSlate();
}
function applyOwnership(){
  if(!ST.own) return; let hit=0, miss=[];
  ST.players.forEach(p=>{ const o=ST.own.get(SL.norm(p.name)); if(o){p.ownC=o.c; p.ownF=o.f; hit++;} else {p.ownC=null; p.ownF=null; if(p.active&&p.salF>0&&(p.rs+p.ts>0.03||p.pos==='K'||p.pos==='DST')) miss.push(p.name);} });
  // fill missing CPT ownership from FLEX if only one column given
  const sc=ST.players.reduce((a,p)=>a+(p.ownC||0),0), sf=ST.players.reduce((a,p)=>a+(p.ownF||0),0);
  if(sc===0&&sf>0) ST.players.forEach(p=>{p.ownC=(p.ownF||0)/5;});
  if(ST.res) ST.res.P.forEach((q,j)=>{q.ownC=ST.players[j].ownC; q.ownF=ST.players[j].ownF;});
  ST.ownSum={c:ST.players.reduce((a,p)=>a+(p.ownC||0),0),f:ST.players.reduce((a,p)=>a+(p.ownF||0),0)};
  $('#ownStatus').innerHTML=`<span class="chip ok">${hit} players matched</span> <span class="small muted">CPT own sums to ${fmt(ST.ownSum.c*100,0)}%, FLEX to ${fmt(ST.ownSum.f*100,0)}%${miss.length?`. Not in file: ${esc(miss.slice(0,6).join(', '))}${miss.length>6?'…':''}`:''}${ST.projBench&&ST.projBench.n?`. ${ST.projBench.n} players projected for 0 points get no carries or targets: ${esc(ST.projBench.names.join(', '))}${ST.projBench.n>8?'…':''}`:''}</span>`;
  if(ST.res){ renderProj(); renderLineups(); renderPortfolioSetup(); }
}
const hasOwn=()=>!!ST.own;
/* Synthetic contest field: lineups drawn from projected ownership, raked so realized CPT/FLEX rates match the projections. */
function buildField(F,seed){
  const P=ST.res.P, R=E.makeRng(seed||7); const ids=P.map((p,j)=>j).filter(j=>P[j].active&&P[j].salF>0&&((P[j].ownC||0)>0||(P[j].ownF||0)>0));
  const m0=ids.length; const tC=new Float64Array(m0), tF=new Float64Array(m0);
  ids.forEach((j,k)=>{tC[k]=Math.max(0,P[j].ownC||0); tF[k]=Math.max(0,P[j].ownF||0);});
  const sC=tC.reduce((a,b)=>a+b,0)||1, sF=tF.reduce((a,b)=>a+b,0)||1; for(let k=0;k<m0;k++){tC[k]/=sC; tF[k]=tF[k]/sF*5;}
  const wC=Float64Array.from(tC), wF=Float64Array.from(tF); const T0=ST.teams[0];
  const salC=ids.map(j=>P[j].salC), salF=ids.map(j=>P[j].salF), tm=ids.map(j=>P[j].team===T0?0:1);
  // field realism: real entrants build near-optimal-projection lineups, so draws are accepted in proportion to projected points
  const mu=ids.map(j=>ST.res.stats[j].mean); const top=Math.max(...ST.res.lineups.map(c=>c.mean),1); const SHARP=ST.fieldSharp!=null?ST.fieldSharp:1;
  const keep=(L)=>{ if(!SHARP) return true; let pr=1.5*mu[L[0]]; for(let q=1;q<6;q++) pr+=mu[L[q]]; const c0=SHARP===2?0.94:0.90, sc0=SHARP===2?0.02:0.03; if(pr<(SHARP===2?0.80:0.72)*top) return false; return R()<Math.min(1,Math.exp((pr-c0*top)/(sc0*top))); };
  let cumC,cumF; const cum=(w)=>{const c=new Float64Array(m0); let s=0; for(let k=0;k<m0;k++){s+=w[k]; c[k]=s;} return c;};
  const draw=(c)=>{const u=R()*c[m0-1]; let lo=0,hi=m0-1; while(lo<hi){const mid=(lo+hi)>>1; if(c[mid]<u) lo=mid+1; else hi=mid;} return lo;};
  const one=()=>{ for(let tries=0;tries<400;tries++){ const c=draw(cumC); const L=[c]; let sal=salC[c], t0=tm[c]===0, t1=tm[c]===1, bad=false;
      for(let k=0;k<5;k++){ let f, g=0; do{f=draw(cumF); g++;}while(L.includes(f)&&g<50); if(L.includes(f)){bad=true;break;} L.push(f); sal+=salF[f]; if(tm[f]) t1=true; else t0=true; }
      if(bad||sal>50000||sal<45500||!t0||!t1||!keep(L)) continue; return L.map(k=>ids[k]); } return null; };
  for(let it=0;it<4;it++){ cumC=cum(wC); cumF=cum(wF); const rc=new Float64Array(m0), rf=new Float64Array(m0); let m=0; const pos=new Map(ids.map((j,k)=>[j,k]));
    for(let k=0;k<3000;k++){const L=one(); if(!L) continue; m++; rc[pos.get(L[0])]++; for(let q=1;q<6;q++) rf[pos.get(L[q])]++;}
    if(!m) break;
    for(let k=0;k<m0;k++){ if(tC[k]>0) wC[k]*=Math.min(4,Math.max(0.25,Math.pow(tC[k]/Math.max(rc[k]/m,1e-4),0.8))); if(tF[k]>0) wF[k]*=Math.min(4,Math.max(0.25,Math.pow(tF[k]/Math.max(rf[k]/m,1e-4),0.8))); } }
  cumC=cum(wC); cumF=cum(wF);
  const out=new Int16Array(F*6); let m=0, fails=0; while(m<F&&fails<2000){const L=one(); if(!L){fails++;continue;} out.set(L,m*6); m++;}
  return {L:out,F:m,one};
}

/* ---------------- DK entries: assign portfolio lineups to contest entries ---------------- */
function loadEntries(text,label){
  const rows=SL.parseCSV(text); if(!rows.length){toast('Empty entries file');return;}
  const h=rows[0].map(x=>x.trim()); const iE=h.indexOf('Entry ID'), iN=h.indexOf('Contest Name'), iC=h.indexOf('Contest ID'), iF=h.indexOf('Entry Fee'), iP=h.indexOf('CPT');
  if(iE<0||iF<0||iP<0){toast('That does not look like a DK entries CSV (needs Entry ID, Entry Fee, CPT columns)');return;}
  const out=[]; for(const r of rows.slice(1)){ const id=(r[iE]||'').trim(); if(!/^\d+$/.test(id)) continue;
    const cells=r.slice(iP,iP+6).map(x=>(x||'').trim()); out.push({id,cname:r[iN]||'',cid:r[iC]||'',feeTxt:r[iF]||'',fee:parseFloat((r[iF]||'0').replace(/[$,]/g,''))||0,cells,pre:cells.some(x=>x)}); }
  ST.entries={rows:out,label:label||'entries CSV',raw:rows,iE,iP,bom:text.charCodeAt(0)===0xFEFF,eol:/\r\n/.test(text)?'\r\n':'\n'}; ST.assign=null; ST.nTouched=false;
  const thr=store.get('dupThr',0.25); const nUnique=out.filter(e=>!e.pre&&e.fee>thr+1e-9).length;
  if(ST.res){ renderPortfolioSetup(); const pn=$('#pN'); if(pn&&nUnique) pn.value=nUnique; }
  if(ST.port&&ST.port.length){ assignEntries(); renderPortfolioResult(); } // portfolio built before the entries file: fill the entries from it now
  toast(`${out.length} entries loaded${ST.port&&ST.port.length?`, filled from your ${ST.port.length}-lineup portfolio`:''}`);
}
const ckey=(e)=>e.cid||e.cname;
function prizePool(name){ const m=/\$([\d.]+)\s*([KkMm])?/.exec(name||''); return m?parseFloat(m[1])*(m[2]?(/k/i.test(m[2])?1e3:1e6):1):null; }
function estSize(name,fee){ const m=/\$([\d.]+)\s*([KkMm])?/.exec(name||''); if(!m||!fee) return null; const v=parseFloat(m[1])*(m[2]?(/k/i.test(m[2])?1e3:1e6):1); return Math.max(2,Math.round(v/(fee*0.85))); }
function getPayouts(){ return Object.assign({},ST.payMem||{},store.get('payouts',{})); }
function setPayout(k,tbl){ const p=getPayouts(); if(tbl&&tbl.length) p[k]=tbl; else delete p[k]; ST.payMem=p; store.set('payouts',p); }
function contestSize(k,name,fee){ const s=Object.assign({},ST.csizeMem||{},store.get('csizes',{})); return s[k]||estSize(name,fee)||10000; }
function entriesCard(){
  const E2=ST.entries; const thr=store.get('dupThr',0.25);
  if(!E2) return `<div class="card"><h3>DraftKings entries</h3><p class="small muted">Upload the entries CSV from DraftKings (Lineups, Edit Entries, Download). Field sizes and payouts start as projections from each contest's prize pool and fee; type an exact field size or paste the exact payout table to override them. The portfolio size is set to your open entries above the dupe threshold, lineups are spread across entry fees so each player's dollar exposure matches his lineup exposure, and entries at or below the threshold get copies of those lineups. Entries that already have a lineup are left alone and not counted.</p>
    <div class="drop" id="dropEnt" role="button" tabindex="0"><b>Upload DKEntries.csv</b><input type="file" id="fileEnt" accept=".csv,.zip,text/csv" hidden></div></div>`;
  const g=new Map(); E2.rows.forEach(e=>{const k=ckey(e); if(!g.has(k)) g.set(k,{k,name:e.cname,fee:e.fee,n:0,pre:0}); const x=g.get(k); x.n++; if(e.pre) x.pre++;});
  const C=Array.from(g.values()).sort((a,b)=>b.fee-a.fee);
  const open=E2.rows.filter(e=>!e.pre); const uniq=open.filter(e=>e.fee>thr+1e-9).length, dup=open.length-uniq; const dollars=open.reduce((a,e)=>a+e.fee,0);
  return `<div class="card"><div class="row" style="justify-content:space-between"><h3>DraftKings entries</h3><button id="clearEnt" class="small">Remove</button></div>
    <div class="row small"><label for="dupThr" class="muted">Entries at or below</label><input id="dupThr" type="number" step="0.05" min="0" value="${thr}" style="width:70px"><span class="muted">reuse lineups from bigger contests</span></div>
    <p class="small"><b>${uniq}</b> unique lineups needed · <b>${dup}</b> dupe entries · ${open.length} open entries, $${dollars.toFixed(2)} in fees${E2.rows.length-open.length?` · <b>${E2.rows.length-open.length}</b> preloaded entries left alone`:''}</p>
    <div class="tw" style="border:0"><table><thead><tr><th>Contest</th><th class="n">Fee</th><th class="n">Entries</th><th class="n">Preloaded</th><th>Role</th><th class="n" title="Projected from prize pool / (fee x 0.85); type the exact number to override">Field size</th><th title="Projected from the prize pool, fee and field size (22% paid, min cash 2x fee) until you paste the exact table">Payouts</th></tr></thead><tbody>
    ${C.map(c=>`<tr><td class="small" style="white-space:normal">${esc(c.name.replace(/\s*\([A-Z]+ @ [A-Z]+\)\s*$/,''))}</td><td class="n">$${c.fee.toFixed(2)}</td><td class="n">${c.n}</td><td class="n">${c.pre||''}</td><td class="small">${c.fee>thr+1e-9?'unique lineups':'dupes'}</td><td class="n">${c.fee>thr+1e-9?`<input class="csz" data-ck="${esc(c.k)}" type="number" min="2" step="100" style="width:96px" value="${contestSize(c.k,c.name,c.fee)}" title="${(Object.assign({},ST.csizeMem||{},store.get('csizes',{})))[c.k]?'exact (set by you)':'projected from prize pool'}"> <span class="small muted">${(Object.assign({},ST.csizeMem||{},store.get('csizes',{})))[c.k]?'exact':'proj'}</span>`:'<span class="muted">-</span>'}</td><td>${c.fee>thr+1e-9?(()=>{const t=getPayouts()[c.k]; return `<button class="small paybtn" data-ck="${esc(c.k)}" data-cn="${esc(c.name)}" data-fee="${c.fee}" style="padding:2px 8px">${t?`Exact: ${t.length} tiers · ${t[t.length-1][1].toLocaleString()} paid`:'Projected · paste exact'}</button>`;})():''}</td></tr>`).join('')}</tbody></table></div><div id="payEdit"></div></div>`;
}
function bindEntries(el){
  const fe=$('#fileEnt',el), d=$('#dropEnt',el);
  if(fe){ fe.onchange=()=>{const f=fe.files[0]; if(f) readUploadSafe(f).then(t=>loadEntries(t,f.name));}; d.onclick=(e)=>{if(e.target.tagName!=='INPUT') fe.click();};
    d.ondragover=(e)=>{e.preventDefault();d.classList.add('over');}; d.ondragleave=()=>d.classList.remove('over'); d.ondrop=(e)=>{e.preventDefault();d.classList.remove('over');const f=e.dataTransfer.files[0]; if(f) readUploadSafe(f).then(t=>loadEntries(t,f.name));}; }
  $$('.csz',el).forEach(i=>i.onchange=()=>{const s=store.get('csizes',{}); s[i.dataset.ck]=Math.max(2,+i.value||2); store.set('csizes',s); ST.csizeMem=s; });
  $$('.paybtn',el).forEach(b=>b.onclick=()=>{ const k=b.dataset.ck, fee=+b.dataset.fee; const box=$('#payEdit'); const cur=getPayouts()[k];
    box.innerHTML=`<div class="card" style="margin-top:10px"><h3 style="font-size:16px">Payouts: ${esc(b.dataset.cn.replace(/\s*\([A-Z]+ @ [A-Z]+\)\s*$/,''))}</h3><p class="small muted">Paste the payout table from the contest info (lines like "7th - 8th  $500.00").</p>
      <textarea id="payTxt" placeholder="1st&#9;$10,000.00">${cur?cur.map(([lo,hi,v])=>`${lo}${hi>lo?' - '+hi:''}\t$${v.toFixed(2)}`).join('\n'):''}</textarea>
      <div class="row" style="margin-top:8px"><button class="primary" id="paySave">Save payouts</button><button id="payClear">Clear</button><span id="payNote" class="small muted"></span></div></div>`;
    const ta=$('#payTxt'); const note=()=>{const t=parsePayouts(ta.value); if(!t.length){$('#payNote').textContent='No payout lines recognized yet.';return;} const tot=payTotal(t); $('#payNote').textContent=`${t.length} tiers, ${t[t.length-1][1].toLocaleString()} places paid, $${tot.toLocaleString()} total. Implied field: ${Math.round(tot/(fee*0.85)).toLocaleString()} entries (prize pool / fee x 0.85).`;};
    ta.oninput=note; note(); ta.focus();
    $('#paySave').onclick=()=>{ const t=parsePayouts(ta.value); if(!t.length){toast('No payout lines recognized');return;} setPayout(k,t);
      const sz=store.get('csizes',{}); if(!sz[k]&&!(ST.csizeMem||{})[k]){ const s=Object.assign({},sz,{[k]:Math.round(payTotal(t)/(fee*0.85))}); store.set('csizes',s); ST.csizeMem=s; }
      toast('Payouts saved'); renderPortfolioSetup(); };
    $('#payClear').onclick=()=>{ setPayout(k,null); renderPortfolioSetup(); };
  });
  const ce=$('#clearEnt',el); if(ce) ce.onclick=()=>{ST.entries=null; ST.assign=null; renderPortfolioSetup();};
  const dt=$('#dupThr',el); if(dt) dt.onchange=()=>{store.set('dupThr',Math.max(0,+dt.value||0)); renderPortfolioSetup(); const n=ST.entries.rows.filter(e=>!e.pre&&e.fee>store.get('dupThr',0.25)+1e-9).length; if(n) $('#pN').value=n;};
}
/* Greedy fee-balanced assignment + swap polishing. Target: each player's share of entry dollars equals his share of lineups. */
function assignEntries(){
  if(!ST.entries||!ST.port||!ST.port.length) return null;
  const thr=store.get('dupThr',0.25); const L=ST.port; const nL=L.length;
  const open=ST.entries.rows.filter(e=>!e.pre); const main=open.filter(e=>e.fee>thr+1e-9).sort((a,b)=>b.fee-a.fee); const low=open.filter(e=>e.fee<=thr+1e-9);
  const share=new Map(); L.forEach(c=>c.L.forEach(j=>share.set(j,(share.get(j)||0)+1/nL)));
  const players=Array.from(share.keys()); const D=new Map(players.map(p=>[p,0])); let Dt=0;
  const errAdd=(c,f)=>{let e=0; const set=new Set(c.L); for(const p of players){const d=D.get(p)+(set.has(p)?f:0)-share.get(p)*(Dt+f); e+=d*d;} return e;};
  const take=(c,f)=>{c.L.forEach(p=>D.set(p,D.get(p)+f)); Dt+=f;};
  const asg=new Map(); const used=new Set();
  // main entries: each portfolio lineup once (cycle if the portfolio is smaller than the entry count)
  for(const e of main){ let best=null,bv=1e18; const pool=L.filter(c=>!used.has(c.key)); const cand=pool.length?pool:L;
    for(const c of cand){ const v=errAdd(c,e.fee); if(v<bv){bv=v;best=c;} } asg.set(e.id,best); used.add(best.key); take(best,e.fee); if(used.size>=nL) used.clear(); }
  // swap polish between entries with different fees
  const totalErr=()=>{let s=0; for(const p of players){const d=D.get(p)-share.get(p)*Dt; s+=d*d;} return s;};
  const R=E.makeRng(99); let cur=totalErr();
  for(let it=0;it<30000&&main.length>1;it++){ const a=main[Math.floor(R()*main.length)], b=main[Math.floor(R()*main.length)]; if(a.fee===b.fee) continue;
    const la=asg.get(a.id), lb=asg.get(b.id); const df=a.fee-b.fee; const sa=new Set(la.L), sb=new Set(lb.L);
    const ch=new Map(); la.L.forEach(p=>{if(!sb.has(p)) ch.set(p,-df);}); lb.L.forEach(p=>{if(!sa.has(p)) ch.set(p,(ch.get(p)||0)+df);});
    let nv=cur; for(const [p,dd] of ch){const d0=D.get(p)-share.get(p)*Dt; const d1=d0+dd; nv+=d1*d1-d0*d0;}
    if(nv<cur-1e-12){ for(const [p,dd] of ch) D.set(p,D.get(p)+dd); asg.set(a.id,lb); asg.set(b.id,la); cur=nv; } }
  // stage 2: swap lineups between contests when it raises fee-weighted field equity without losing dollar balance (within 3%)
  const SZ=ST.portSZ; if(SZ&&L[0].eqBy){ const sIdx=new Map(); SZ.forEach((x,s)=>x.keys.forEach(k=>sIdx.set(k,s)));
    const eqOf=(c,e)=>{const s=sIdx.get(ckey(e)); return s==null?0:c.eqBy[s]*e.fee;}; const base=cur;
    for(let it=0;it<40000&&main.length>1;it++){ const a=main[Math.floor(R()*main.length)], b=main[Math.floor(R()*main.length)]; if(ckey(a)===ckey(b)) continue;
      const la=asg.get(a.id), lb=asg.get(b.id); const dEq=eqOf(la,b)+eqOf(lb,a)-eqOf(la,a)-eqOf(lb,b); if(dEq<=0) continue;
      const df=a.fee-b.fee; let nv=cur; const ch=new Map();
      if(df){ const sa=new Set(la.L), sb=new Set(lb.L); la.L.forEach(p=>{if(!sb.has(p)) ch.set(p,-df);}); lb.L.forEach(p=>{if(!sa.has(p)) ch.set(p,(ch.get(p)||0)+df);});
        for(const [p,dd] of ch){const d0=D.get(p)-share.get(p)*Dt; const d1=d0+dd; nv+=d1*d1-d0*d0;} }
      if(nv<=base*1.03+1e-9){ for(const [p,dd] of ch) D.set(p,D.get(p)+dd); asg.set(a.id,lb); asg.set(b.id,la); cur=nv; } } }
  // dupe entries: walk down the portfolio list, one lineup per entry, and only start over at the top once every lineup has been duped
  const ord=L; let q=[]; const usedBy=new Map();
  const lowS=low.slice().sort((a,b)=>b.fee-a.fee||String((x=>x.cid||x.cname)(a)).localeCompare(String((x=>x.cid||x.cname)(b))));
  for(const e of lowS){ const k=(x=>x.cid||x.cname)(e); if(!usedBy.has(k)) usedBy.set(k,new Set()); const u=usedBy.get(k);
    if(!q.length) q=ord.slice(); let i=q.findIndex(c=>!u.has(c.key));
    if(i<0&&u.size<nL){ q=q.concat(ord); i=q.findIndex(c=>!u.has(c.key)); } if(i<0) i=0;
    const c=q.splice(i,1)[0]; asg.set(e.id,c); u.add(c.key); take(c,e.fee); }
  ST.assign={map:asg,D,Dt,share,main:main.length,low:low.length};
  return ST.assign;
}
function entriesResult(){
  const A=ST.assign; if(!A) return ''; const P=ST.res.P; const rows=ST.entries.rows; const fees=Array.from(new Set(rows.filter(e=>!e.pre).map(e=>e.fee))).sort((a,b)=>b-a);
  const tier=new Map(fees.map(f=>[f,{n:0,cnt:new Map()}])); rows.forEach(e=>{ if(e.pre) return; const c=A.map.get(e.id); if(!c) return; const t=tier.get(e.fee); t.n++; c.L.forEach(j=>t.cnt.set(j,(t.cnt.get(j)||0)+1)); });
  const pl=Array.from(A.share.entries()).sort((a,b)=>b[1]-a[1]);
  return `<div class="card" style="margin-top:16px"><div class="row" style="justify-content:space-between"><h3>Exposure by entry fee</h3><button class="primary" id="expEnt">Download DK entries CSV</button></div>
    ${ST.portEV?(()=>{ const sIdx=new Map(); ST.portSZ.forEach((x,s)=>x.keys.forEach(k=>sIdx.set(k,s))); let ev=0,fees=0,cnt=0; for(const e of ST.entries.rows){ if(e.pre) continue; const c=A.map.get(e.id); if(!c||!c.evBy) continue; const s=sIdx.get(ckey(e)); if(s==null) continue; ev+=c.evBy[s]; fees+=e.fee; cnt++; } return fees?`<p class="small"><b>Expected return on the ${cnt} tournament entries above the dupe line: $${ev.toFixed(2)} on $${fees.toFixed(2)} (${((ev/fees-1)*100>=0?'+':'')+((ev/fees-1)*100).toFixed(0)}% ROI)</b> ${ST.fieldInfo&&ST.fieldInfo.PAY.every(p=>p.real)?'using your pasted payouts':'with projected payouts for contests without a pasted table'}. Dupe contests are left out.</p>`:''; })():''}
    <p class="small muted">${A.main} entries got unique lineups and ${A.low} dupe entries got copies, walking down the portfolio list and only repeating a lineup after every lineup has been duped. Dollar exposure is each player's share of your entry fees; the fee columns show his exposure inside each fee level.</p>
    <div class="tw" style="border:0"><table><thead><tr><th>Player</th><th class="n">Lineups</th><th class="n">$ exposure</th>${hasOwn()?'<th class="n">Proj own CPT</th><th class="n">Proj own FLEX</th>':''}${fees.map(f=>`<th class="n">$${f.toFixed(2)} (${tier.get(f).n})</th>`).join('')}</tr></thead><tbody>
    ${pl.map(([j,s])=>`<tr><td><span class="tm ${teamIdx(P[j])?'b':'a'}"></span><button class="plink" data-pc="${j}">${esc(P[j].name)}</button><span class="pos">${P[j].pos}</span></td><td class="n">${pct(s,0)}</td><td class="n"><b>${pct(A.D.get(j)/A.Dt,0)}</b></td>${hasOwn()?`<td class="n">${P[j].ownC!=null?pct(P[j].ownC,1):'-'}</td><td class="n">${P[j].ownF!=null?pct(P[j].ownF,1):'-'}</td>`:''}${fees.map(f=>{const t=tier.get(f); return `<td class="n">${t.n?pct((t.cnt.get(j)||0)/t.n,0):'-'}</td>`;}).join('')}</tr>`).join('')}</tbody></table></div></div>`;
}
function entriesCSV(){
  const A=ST.assign; const ni=store.get('nameid',false); const pl=ST.players; const EN=ST.entries;
  if(EN.raw){ // mirror DraftKings' own file: every original row and column, only the 6 lineup cells replaced
    const q=(x)=>/[,"\r\n]/.test(x)?`"${String(x).replace(/"/g,'""')}"`:x; const cell=(j,cpt)=>{const p=pl[j]; const id=cpt?p.idC:p.idF; return ni?`${p.name} (${id})`:id;};
    const byId=new Map(EN.rows.map(e=>[e.id,e])); const width=Math.max(...EN.raw.map(r=>r.length));
    const lines=EN.raw.map((r,ri)=>{ const row=r.slice();
      const e=ri>0?byId.get((row[EN.iE]||'').trim()):null;
      if(e&&!e.pre){ const c=A.map.get(e.id); if(c){ const cells=[cell(c.L[0],true)].concat(c.L.slice(1).map(j=>cell(j,false))); for(let k=0;k<6;k++) row[EN.iP+k]=cells[k]; } }
      return row.map(x=>q(x==null?'':String(x))).join(','); });
    return (EN.bom?'\uFEFF':'')+lines.join(EN.eol)+EN.eol; }
  const cell=(j,cpt)=>{const p=pl[j]; const id=cpt?p.idC:p.idF; return ni?`${p.name} (${id})`:id;};
  const q=(x)=>/[,"]/.test(x)?`"${String(x).replace(/"/g,'""')}"`:x;
  const lines=['Entry ID,Contest Name,Contest ID,Entry Fee,CPT,FLEX,FLEX,FLEX,FLEX,FLEX'];
  for(const e of ST.entries.rows){ const c=A.map.get(e.id); const cells=e.pre||!c?e.cells:[cell(c.L[0],true)].concat(c.L.slice(1).map(j=>cell(j,false)));
    lines.push([e.id,q(e.cname),e.cid,e.feeTxt].concat(cells.map(q)).join(',')); }
  return lines.join('\n')+'\n';
}
async function saveText(csv,fn,count){
  try{ if(window.claude&&window.claude.use){const dl=await window.claude.use('downloads'); if(dl){await dl.save({filename:fn,data:csv}); toast('Saved '+count); return;}} }catch(e){ if(e&&e.code==='declined') return; }
  try{const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'})); a.download=fn; document.body.appendChild(a); a.click(); a.remove(); toast('Downloaded '+count);}catch(e){toast('Download blocked here');}
}

/* ---------------- cash game research ---------------- */
async function renderCash(){
  const R=ST.res, el=$('#pane-cash'); if(!R) return; el.innerHTML='<p class="note">Scoring cash candidates…</p>'; await new Promise(r=>setTimeout(r,20));
  const {N,n,pts,P,G,elig}=R;
  const cand=new Map(); const add=(L)=>{const k=E.lineupKey(L); if(!cand.has(k)) cand.set(k,{L,key:k});};
  R.lineups.forEach(c=>add(c.L));
  E.topK(G,{eligible:elig},Float64Array.from(R.stats.map(s=>s.mean)),250).forEach(h=>add(h.L));
  E.topK(G,{eligible:elig},Float64Array.from(R.stats.map(s=>s.pc[3])),200).forEach(h=>add(h.L));
  E.topK(G,{eligible:elig},Float64Array.from(R.stats.map(s=>s.pc[2])),150).forEach(h=>add(h.L));
  const C=Array.from(cand.values()).filter(c=>c.L.every(j=>P[j].active));
  // cash line per sim: 56th percentile of a field (ownership-drawn if loaded, else the 300 best lineups by mean)
  let fl, F, src;
  if(hasOwn()){ const FLD=buildField(2000,21); fl=FLD.L; F=FLD.F; src=`${F.toLocaleString()} lineups drawn from your projected ownership`; }
  else { const top=E.topK(G,{eligible:elig},Float64Array.from(R.stats.map(s=>s.mean)),300); F=top.length; fl=new Int16Array(F*6); top.forEach((h,i)=>fl.set(h.L,i*6)); src='the 300 highest-mean lineups (upload ownership for a field drawn from projected ownership)'; }
  const cut=new Float32Array(N); const fs=new Float32Array(F); const kq=Math.floor(F*0.56);
  for(let i=0;i<N;i++){ const o=i*n; for(let f=0;f<F;f++){const b=f*6; fs[f]=1.5*pts[o+fl[b]]+pts[o+fl[b+1]]+pts[o+fl[b+2]]+pts[o+fl[b+3]]+pts[o+fl[b+4]]+pts[o+fl[b+5]];} fs.sort(); cut[i]=fs[kq];
    if(i%2000===0){ el.innerHTML=`<p class="note">Scoring the cash line in each sim… ${i}/${N}</p>`; await new Promise(r=>setTimeout(r,0)); } }
  const sc=new Float32Array(N);
  for(const c of C){ let s=0,cash=0; for(let i=0;i<N;i++){const o=i*n; let v=1.5*pts[o+c.L[0]]; for(let k=1;k<6;k++) v+=pts[o+c.L[k]]; sc[i]=v; s+=v; if(v>=cut[i]) cash++;}
    const srt=Float32Array.from(sc).sort(); const q=(x)=>srt[Math.floor(x*(N-1))]; c.mean=s/N; c.p10=q(.1); c.p20=q(.2); c.p30=q(.3); c.p50=q(.5); c.cash=cash/N; c.sal=P[c.L[0]].salC+c.L.slice(1).reduce((a,j)=>a+P[j].salF,0);
    c.own=(P[c.L[0]].ownC||0)+c.L.slice(1).reduce((a,j)=>a+(P[j].ownF||0),0); }
  C.sort((a,b)=>(b.cash-a.cash)||(b.p20-a.p20)); const top=C.slice(0,40); ST.cash=top;
  el.innerHTML=`<p class="note small">Double-ups pay roughly the top 44%, so the cash line in each sim is the 56th percentile score of ${src}. Lineups are ranked by how often they clear that line, then by 20th-percentile score. All candidates use active players only.</p>
    <div class="tw"><table><thead><tr><th></th><th>Captain</th><th>Flex</th><th class="n">Salary</th><th class="n">Cash rate</th><th class="n">10th</th><th class="n">20th</th><th class="n">30th</th><th class="n">Median</th><th class="n">Mean</th>${hasOwn()?'<th class="n">Own sum</th>':''}</tr></thead><tbody>
    ${top.map(c=>`<tr><td><input type="checkbox" data-key="${esc(c.key)}" ${ST.sel.has(c.key)?'checked':''} aria-label="Select"></td>${lineupCells(c.L)}<td class="n">${c.sal.toLocaleString()}</td><td class="n" style="background:color-mix(in srgb, var(--accent) ${Math.round(Math.max(0,(c.cash-top[top.length-1].cash)/((top[0].cash-top[top.length-1].cash)||1))*45)}%, var(--panel))"><b>${pct(c.cash,1)}</b></td><td class="n">${fmt(c.p10)}</td><td class="n">${fmt(c.p20)}</td><td class="n">${fmt(c.p30)}</td><td class="n">${fmt(c.p50)}</td><td class="n">${fmt(c.mean)}</td>${hasOwn()?`<td class="n">${pct(c.own,0)}</td>`:''}</tr>`).join('')}</tbody></table></div>${exportBar('sel')}`;
  bindSel(el); bindExport(el,'sel');
}

/* ---------------- game breakdown ---------------- */
function renderGame(){
  const R=ST.res, el=$('#pane-game'); if(!R||!R.sf) return; const N=R.N, NS=E.NS, W2=2*NS+1, sf=R.sf; const T=ST.teams;
  const col=(t,k)=>{const a=new Float32Array(N); for(let i=0;i<N;i++) a[i]=sf[i*W2+t*NS+k]; return a;};
  const s0=col(0,0), s1=col(1,0); const imp=R.implied||ST.implied; const vSpread=imp[1]-imp[0], vTot=imp[0]+imp[1];
  let w0=0,w1=0,tie=0,ot=0; const marg=new Int32Array(N), tot=new Float32Array(N); const scoreC=new Map();
  for(let i=0;i<N;i++){ const d=s1[i]-s0[i]; marg[i]=d; tot[i]=s0[i]+s1[i]; if(d>0) w1++; else if(d<0) w0++; else tie++; if(sf[i*W2+2*NS]) ot++; const k=s0[i]+'-'+s1[i]; scoreC.set(k,(scoreC.get(k)||0)+1); }
  const mean=(a)=>a.reduce((x,y)=>x+y,0)/a.length; const q=(a,p)=>{const s=Float32Array.from(a).sort(); return s[Math.floor(p*(s.length-1))];};
  const cover=marg.reduce((c,d)=>c+(d>vSpread?1:0),0)/N, push=marg.reduce((c,d)=>c+(d===vSpread?1:0),0)/N, over=tot.reduce((c,t)=>c+(t>vTot?1:0),0)/N;
  const fav=vSpread>=0?1:0, favAb=T[fav], line=Math.abs(vSpread);
  const tiles=[[`${T[0]} win`,pct(w0/N,1)],[`${T[1]} win`,pct(w1/N,1)],['Overtime',pct(ot/N,1)+(tie?` · tie ${pct(tie/N,1)}`:'')],['Median margin',`${favAb} ${q(Array.from(marg).map(x=>fav?x:-x),0.5)>=0?'by ':'loses by '}${Math.abs(q(Array.from(marg).map(x=>fav?x:-x),0.5))}`],
    [`${favAb} covers ${line?'-'+line:'PK'}`,pct(fav?cover:1-cover-push,1)],['Avg total',fmt(mean(tot),1)],[`Over ${vTot}`,pct(over,1)],[`${T[0]} / ${T[1]} avg`,`${fmt(mean(s0),1)} / ${fmt(mean(s1),1)}`]];
  // margin histogram
  const lo=-35, hi=35, bins=new Float64Array(hi-lo+1); for(const d of marg){ const k=Math.max(lo,Math.min(hi,d))-lo; bins[k]++; }
  const W=900,H=200,bw=W/(hi-lo+1), mx=Math.max(...bins);
  let svg=`<svg viewBox="0 0 ${W} ${H+34}" width="100%" class="gchart" role="img" aria-label="Final margin distribution">`;
  for(let k=0;k<bins.length;k++){ const d=k+lo, h=(H-10)*bins[k]/mx, x=k*bw; const key=[3,7,10,14].includes(Math.abs(d));
    svg+=`<rect x="${x+1}" y="${H-h}" width="${bw-2}" height="${Math.max(0,h)}" fill="var(${d>0?'--t1':d<0?'--t0':'--muted'})" fill-opacity="${key?1:0.55}"><title>${d===0?'Tie':(d>0?T[1]:T[0])+' by '+Math.abs(d)}: ${pct(bins[k]/N,1)}</title></rect>`;
    if(d%7===0||Math.abs(d)===3||Math.abs(d)===10) svg+=`<text x="${x+bw/2}" y="${H+14}" text-anchor="middle">${d===0?'0':(d>0?'+':'')+d}${Math.abs(d)===35?'+':''}</text>`; }
  const vx=(vSpread-lo+0.5)*bw; svg+=`<line x1="${vx}" x2="${vx}" y1="0" y2="${H}" stroke="var(--ink)" stroke-dasharray="4 3"/><text x="${vx+4}" y="12">Line ${favAb} ${line?'-'+line:'PK'}</text>`;
  svg+=`<text x="4" y="${H+30}">◀ ${T[0]} wins</text><text x="${W-4}" y="${H+30}" text-anchor="end">${T[1]} wins ▶</text></svg>`;
  // exact margins table
  const ex=(t,m)=>{let c=0; for(const d of marg) if((t?d:-d)===m) c++; return c/N;}; const exP=(t,m)=>{let c=0; for(const d of marg) if((t?d:-d)>=m) c++; return c/N;};
  const mrows=[1,2,3,4,5,6,7,8,9,10,11,12,13,14].map(m=>`<tr><td class="num">${m}</td><td class="n" ${[3,7,10,14].includes(m)?'style="font-weight:700"':''}>${pct(ex(0,m),1)}</td><td class="n" ${[3,7,10,14].includes(m)?'style="font-weight:700"':''}>${pct(ex(1,m),1)}</td></tr>`).join('')+`<tr class="tot"><td>15+</td><td class="n">${pct(exP(0,15),1)}</td><td class="n">${pct(exP(1,15),1)}</td></tr>`;
  // total histogram + ladder
  const tlo=10, thi=90, tb=new Float64Array((thi-tlo)/2+1); for(const t of tot){ const k=Math.floor((Math.max(tlo,Math.min(thi,t))-tlo)/2); tb[k]++; } const tmx=Math.max(...tb); const tbw=W/tb.length;
  let svg2=`<svg viewBox="0 0 ${W} ${H+20}" width="100%" class="gchart" role="img" aria-label="Total points distribution">`;
  tb.forEach((c,k)=>{const h=(H-10)*c/tmx, v=tlo+k*2; svg2+=`<rect x="${k*tbw+1}" y="${H-h}" width="${tbw-2}" height="${h}" fill="var(--accent)" fill-opacity="${v+1>vTot?0.85:0.45}"><title>${v}-${v+1} pts: ${pct(c/N,1)}</title></rect>`; if(v%10===0) svg2+=`<text x="${k*tbw+tbw/2}" y="${H+14}" text-anchor="middle">${v}</text>`;});
  const tvx=(vTot-tlo)/2*tbw; svg2+=`<line x1="${tvx}" x2="${tvx}" y1="0" y2="${H}" stroke="var(--ink)" stroke-dasharray="4 3"/><text x="${tvx+4}" y="12">O/U ${vTot}</text></svg>`;
  const ladder=[-10,-7,-3.5,0,3.5,7,10].map(d=>{const L=Math.round((vTot+d)*2)/2; const o=tot.reduce((c,t)=>c+(t>L?1:0),0)/N; return `<tr><td class="num">${L}</td><td class="n">${pct(o,1)}</td><td class="n">${pct(1-o-tot.reduce((c,t)=>c+(t===L?1:0),0)/N,1)}</td></tr>`;}).join('');
  // common scores
  const top=Array.from(scoreC.entries()).sort((a,b)=>b[1]-a[1]).slice(0,18);
  const sc=top.map(([k,c])=>{const [a,b]=k.split('-').map(Number); const w=b>a?1:a>b?0:-1; return `<tr><td>${w<0?'Tie':`<span class="tm ${w?'b':'a'}"></span>${T[w]}`} <b class="num">${Math.max(a,b)}-${Math.min(a,b)}</b></td><td class="num small muted">${T[0]} ${a}, ${T[1]} ${b}</td><td class="n">${pct(c/N,2)}</td></tr>`;}).join('');
  // team stat table
  const stat=(k)=>[mean(col(0,k)),mean(col(1,k))];
  const pts0=s0, pts1=s1; const plays=stat(1), pa=stat(2), sk=stat(3), ra=stat(4), py=stat(5), ry=stat(6), pen=stat(7), fo=stat(8), fga=stat(9), pu=stat(10), to=stat(11), td=stat(12), dr=stat(13), scr=stat(14), it=stat(15);
  const rowsT=[['Points (mean)',[mean(pts0),mean(pts1)],1],['Points 10th / 50th / 90th',[`${q(pts0,.1)} / ${q(pts0,.5)} / ${q(pts0,.9)}`,`${q(pts1,.1)} / ${q(pts1,.5)} / ${q(pts1,.9)}`],-1],
    ['Scores 30+',[pts0.reduce((c,x)=>c+(x>=30),0)/N,pts1.reduce((c,x)=>c+(x>=30),0)/N],'%'],['Held under 14',[pts0.reduce((c,x)=>c+(x<14),0)/N,pts1.reduce((c,x)=>c+(x<14),0)/N],'%'],
    ['Touchdowns',td,2],['FG attempts',fga,2],['Drives',dr,1],['Points per drive',[mean(pts0)/dr[0],mean(pts1)/dr[1]],2],['Plays per drive',[plays[0]/dr[0],plays[1]/dr[1]],1],
    ['Offensive plays',plays,1],['Pass attempts',pa,1],['Sacks taken',sk,2],['QB scrambles',scr,2],['Designed runs + scrambles',ra,1],['Pass rate (dropbacks)',[(pa[0]+sk[0]+scr[0])/plays[0],(pa[1]+sk[1]+scr[1])/plays[1]],'%'],
    ['Pass yards',py,0],['Rush yards',ry,0],['Yards per play',[(py[0]+ry[0])/plays[0],(py[1]+ry[1])/plays[1]],2],['Interceptions',it,2],['Turnovers (incl. on downs)',to,2],['4th-down tries',fo,2],['Punts',pu,2],['Accepted penalties (no play)',pen,2]];
  const fv=(v,d)=>d==='%'?pct(v,1):d===-1?v:fmt(v,d);
  const totPlays=mean(col(0,1).map((x,i)=>x+sf[i*W2+NS+1]));
  el.innerHTML=`<div class="pc-tiles">${tiles.map(([l,v])=>`<div><span class="lbl">${esc(l)}</span><b class="num">${v}</b></div>`).join('')}</div>
    <div class="grid2" style="margin-top:16px;grid-template-columns:minmax(0,2fr) minmax(0,1fr)">
      <div class="card"><h3>Final margin</h3><p class="small muted">Share of ${N.toLocaleString()} sims by final margin. Key numbers (3, 7, 10, 14) are solid; the end bars hold every margin of 35 or more; dashed line = the spread from your implied totals.</p><div class="pc-chartwrap">${svg}</div></div>
      <div class="card"><h3>Wins by exactly</h3><table><thead><tr><th>Pts</th><th class="n"><span class="tm a"></span>${T[0]}</th><th class="n"><span class="tm b"></span>${T[1]}</th></tr></thead><tbody>${mrows}</tbody></table></div></div>
    <div class="grid2" style="margin-top:16px;grid-template-columns:minmax(0,2fr) minmax(0,1fr)">
      <div class="card"><h3>Total points</h3><p class="small muted">Two-point bins; darker bars are over your implied total of ${vTot}. Average ${fmt(mean(tot),1)}, median ${q(tot,.5)}, 10th to 90th ${q(tot,.1)} to ${q(tot,.9)}.</p><div class="pc-chartwrap">${svg2}</div></div>
      <div class="card"><h3>Total ladder</h3><table><thead><tr><th>Line</th><th class="n">Over</th><th class="n">Under</th></tr></thead><tbody>${ladder}</tbody></table></div></div>
    <div class="grid2" style="margin-top:16px">
      <div class="card"><h3>Team breakdown</h3><p class="small muted">Per-game averages across all sims. ${fmt(totPlays,1)} combined offensive plays per game.</p><div class="tw" style="border:0"><table><thead><tr><th></th><th class="n"><span class="tm a"></span>${T[0]}</th><th class="n"><span class="tm b"></span>${T[1]}</th></tr></thead><tbody>
        ${rowsT.map(([l,v,d])=>`<tr><td>${l}</td><td class="n">${fv(v[0],d)}</td><td class="n">${fv(v[1],d)}</td></tr>`).join('')}</tbody></table></div></div>
      <div class="card"><h3>Most common final scores</h3><div class="tw" style="border:0"><table><thead><tr><th>Result</th><th>Score</th><th class="n">Share</th></tr></thead><tbody>${sc}</tbody></table></div></div></div>`;
}

/* ---------------- post-lock: contest standings, one or many contests ---------------- */
const readStandingsFile=readUpload;
function parseStandings(text){
  if(text.charCodeAt(0)===0xFEFF) text=text.slice(1);
  const lines=text.split(/\r?\n/); const h=SL.parseCSV(lines[0])[0]||[]; const ix=(nm)=>h.findIndex(x=>x.trim().toLowerCase()===nm);
  const iR=ix('rank'), iE=ix('entryid'), iN=ix('entryname'), iP=ix('points'), iL=ix('lineup'), iPl=ix('player'), iRP=ix('roster position'), iD=ix('%drafted'), iF=ix('fpts');
  if(iL<0||iE<0) throw new Error('This does not look like a DraftKings contest standings file');
  const rows=[], drafted=[];
  for(let k=1;k<lines.length;k++){ const ln=lines[k]; if(!ln) continue; const r=ln.indexOf('"')>=0?(SL.parseCSV(ln)[0]||[]):ln.split(',');
    if(r[iE]) rows.push({rank:+r[iR]||0,id:r[iE].trim(),name:r[iN]||'',pts:+r[iP]||0,lineup:r[iL]||''});
    if(iPl>=0&&r[iPl]) drafted.push({player:r[iPl].trim(),pos:(r[iRP]||'').trim(),pct:parseFloat(r[iD])/100||0,fpts:+r[iF]||0}); }
  return {rows,drafted};
}
function splitLineup(s){ const out=[]; const re=/(CPT|FLEX)\s+(.+?)(?=\s+(?:CPT|FLEX)\s|\s*$)/g; let m; while((m=re.exec(s))) out.push([m[1],m[2].trim()]); return out; }
function levKey(x){ return x.cpt+'|'+x.fl.slice().sort((a,b)=>a-b).join(','); }
const shortName=(n)=>(n||'').replace(/^NFL Showdown\s*/,'').replace(/\s*\([A-Z]+ @ [A-Z]+\)\s*$/,'');
function levFees(){ return Object.assign({},ST.levFeeMem||{},store.get('levFees',{})); }
function levMeta(V){
  const e=ST.entries?ST.entries.rows.find(r=>r.cid===V.cid):null; const lf=levFees();
  const ci=ST.dkInfo&&ST.dkInfo[V.cid]; const fee=lf[V.cid]!=null&&lf[V.cid]!==''?+lf[V.cid]:(e?e.fee:ci?ci.fee:null);
  return {fee,fromEntries:!!e,cname:e?e.cname:ci?ci.name:'',label:(fee!=null?`$${fee.toFixed(2)} `:'')+(e?shortName(e.cname):ci?shortName(ci.name):`contest ${V.cid||V.file}`)};
}
function levUser(){ return (($('#levUser')&&$('#levUser').value.trim())||ST.dkUser||store.get('dkUser','')).toLowerCase(); }
function levMine(V){ const ids=new Set((ST.entries?ST.entries.rows:[]).map(e=>e.id)); const u=levUser(); return V.L.filter(x=>ids.has(x.id)||(u&&x.user.toLowerCase()===u)); }
/* payout per rank: the pasted table when there is one, else DK-style projection (22% paid, min cash 2x fee, prize ~ C/rank) */
function payFor(V){
  const meta=levMeta(V); const tbl=getPayouts()[V.cid]; const M=V.total; let Pd,pref;
  if(tbl&&tbl.length){ Pd=tbl[tbl.length-1][1]; pref=new Float64Array(Pd+1); let s=0,ti=0; for(let r=1;r<=Pd;r++){ while(ti<tbl.length&&tbl[ti][1]<r) ti++; s+=(ti<tbl.length&&tbl[ti][0]<=r)?tbl[ti][2]:0; pref[r]=s; } }
  else { const fee=meta.fee; if(!fee) return null; const HN=(x)=>x<1?0:Math.log(x)+0.5772+1/(2*x);
    const pool=Math.min(prizePool(meta.cname)||Infinity,M*fee*0.85); Pd=Math.max(1,Math.round(0.22*M)); let mc=2*fee; if(Pd*mc>pool*0.6) mc=pool*0.6/Pd;
    const tot=(C)=>{const Rs=Math.min(Pd,Math.floor(C/mc)); return C*HN(Rs)+(Pd-Rs)*mc;}; let lo=mc,hi=pool; for(let it=0;it<60;it++){const mid=(lo+hi)/2; if(tot(mid)>pool) hi=mid; else lo=mid;} const C=(lo+hi)/2;
    pref=new Float64Array(Pd+1); let s=0; for(let r=1;r<=Pd;r++){ s+=Math.max(mc,C/r); pref[r]=s; } }
  const avg=(lo,hi)=>{ lo=Math.max(1,Math.round(lo)); hi=Math.max(lo,Math.round(hi)); if(lo>Pd) return 0; return (pref[Math.min(hi,Pd)]-pref[lo-1])/(hi-lo+1); };
  return {Pd,avg,real:!!(tbl&&tbl.length)};
}
async function loadStandingsFiles(files){
  const st=$('#levStatus'); const nameIx=new Map(ST.players.map((p,j)=>[SL.norm(p.name),j])); let ok=0; const errs=[];
  if(!ST.levs) ST.levs=new Map();
  for(const file of files){
    st.textContent=`Reading ${file.name}…`; await new Promise(r=>setTimeout(r,20));
    try{
      const txt=await readStandingsFile(file); const S=parseStandings(txt); const cid=(/(\d{6,})/.exec(file.name)||[])[1]||file.name;
      const unk=new Map(); const L=[]; const rankCnt=new Map();
      for(const r of S.rows){ const parts=splitLineup(r.lineup); if(parts.length!==6) continue; let cpt=-1; const fl=[]; let bad=false;
        for(const [slot,nm] of parts){ const j=nameIx.get(SL.norm(nm)); if(j==null){unk.set(nm,(unk.get(nm)||0)+1); bad=true; continue;} if(slot==='CPT') cpt=j; else fl.push(j); }
        if(bad||cpt<0||fl.length!==5) continue; L.push({id:r.id,user:r.name.replace(/\s*\(\d+\/\d+\)\s*$/,''),rank:r.rank,pts:r.pts,cpt,fl}); rankCnt.set(r.rank,(rankCnt.get(r.rank)||0)+1); }
      const V={cid,file:file.name,L,drafted:S.drafted,unk,total:S.rows.length,rankCnt,at:Date.now()};
      ST.levPend=(ST.levPend||[]).filter(x=>x.cid!==cid).concat([V]); ok++;
      const ids=new Set((ST.entries?ST.entries.rows:[]).map(e=>e.id)); const m=L.find(x=>ids.has(x.id)); if(m&&!ST.dkUser){ ST.dkUser=m.user; store.set('dkUser',m.user); if($('#levUser')) $('#levUser').value=m.user; }
    }catch(e){ console.error(e); errs.push(`${file.name}: ${e.message}`); }
  }
  st.textContent=errs.length?`Could not read ${errs.join('; ')}`:''; renderLevConfirm();
}
/* every imported contest needs a confirmed entry fee: winnings, ROI and the all-contests weighting depend on it */
function renderLevConfirm(){
  const el=$('#levConfirm'); if(!el) return; const pend=ST.levPend||[]; if(!pend.length){ el.innerHTML=''; return; }
  const lf=levFees();
  const rows=pend.map(V=>{ const e=ST.entries?ST.entries.rows.find(r=>r.cid===V.cid):null; const fee=lf[V.cid]!=null&&lf[V.cid]!==''?+lf[V.cid]:(e?e.fee:null);
    return {V,e,fee,mine:levMine(V).length,had:ST.levs&&ST.levs.has(V.cid)}; });
  el.innerHTML=`<div class="card" style="border:2px solid var(--accent)"><h3>Confirm entry fees before importing</h3><p class="small muted">Standings files do not include the fee. Fees found in your DK entries file are filled in; check them and type the rest. Use 0 for free contests.</p>
    <div class="tw" style="border:0"><table><thead><tr><th>Contest</th><th class="n">Field</th><th class="n">Yours</th><th class="n">Entry fee</th><th>Fee from</th><th></th></tr></thead><tbody>
    ${rows.map(r=>`<tr><td class="small" style="white-space:normal">${esc(r.e?shortName(r.e.cname):'contest '+r.V.cid)}${r.had?' <span class="muted">(replaces the loaded file)</span>':''}<br><span class="muted">${esc(r.V.file)}</span></td><td class="n">${r.V.total.toLocaleString()}</td><td class="n">${r.mine}</td>
      <td class="n">$ <input class="pendFee" data-cid="${esc(r.V.cid)}" type="number" step="0.01" min="0" style="width:84px" value="${r.fee!=null?r.fee:''}" placeholder="required"></td><td class="small muted">${lf[r.V.cid]!=null&&lf[r.V.cid]!==''?'you, earlier':r.e?'DK entries file':'<b style="color:var(--bad)">not found</b>'}</td>
      <td><button class="small pendRm" data-cid="${esc(r.V.cid)}" aria-label="Skip this contest">×</button></td></tr>`).join('')}</tbody></table></div>
    <div class="row" style="margin-top:8px"><button class="primary" id="pendGo">Import ${pend.length} contest${pend.length>1?'s':''}</button><button id="pendCancel">Cancel</button><span id="pendNote" class="small muted"></span></div></div>`;
  const check=()=>{ const miss=$$('.pendFee',el).filter(i=>i.value===''||!(+i.value>=0)).length; $('#pendGo').disabled=miss>0; $('#pendNote').textContent=miss?`${miss} fee${miss>1?'s':''} still needed`:''; };
  $$('.pendFee',el).forEach(i=>i.oninput=check); check();
  $$('.pendRm',el).forEach(b=>b.onclick=()=>{ ST.levPend=ST.levPend.filter(V=>V.cid!==b.dataset.cid); renderLevConfirm(); });
  $('#pendCancel').onclick=()=>{ ST.levPend=[]; renderLevConfirm(); };
  $('#pendGo').onclick=()=>{ const f=levFees(); $$('.pendFee',el).forEach(i=>f[i.dataset.cid]=Math.max(0,+i.value)); ST.levFeeMem=f; store.set('levFees',f);
    if(!ST.levs) ST.levs=new Map(); const n=pend.length; pend.forEach(V=>{ V.at=Date.now(); ST.levs.set(V.cid,V); ST.lev=V; }); ST.levPend=[];
    ST.levSel=ST.levs.size>1?'all':(ST.lev?ST.lev.cid:null); ST.mid=null; renderLevConfirm(); renderLevContests(); renderLev();
    toast(`${n} contest${n>1?'s':''} imported, ${ST.levs.size} total`); };
}
function levSummary(V){
  const meta=levMeta(V); const M=levMine(V); const pay=payFor(V); const rk=M.map(x=>x.rank).sort((a,b)=>a-b);
  let won=0, cash=0; const cashRank=pay?pay.Pd:Math.round(V.total*0.22);
  M.forEach(x=>{ if(x.rank<=cashRank) cash++; if(pay) won+=pay.avg(x.rank,x.rank+(V.rankCnt.get(x.rank)||1)-1); });
  return {meta,M,pay,rk,won,cash,fees:meta.fee!=null?meta.fee*M.length:null};
}
function payEditor(box,key,label,fee,after){
  const cur=getPayouts()[key];
  box.innerHTML=`<div class="card" style="margin-top:10px"><h3 style="font-size:16px">Payouts: ${esc(label)}</h3><p class="small muted">Paste the payout table from the contest info (lines like "7th - 8th  $500.00").</p>
    <textarea id="lpTxt" placeholder="1st&#9;$10,000.00">${cur?cur.map(([lo,hi,v])=>`${lo}${hi>lo?' - '+hi:''}\t$${v.toFixed(2)}`).join('\n'):''}</textarea>
    <div class="row" style="margin-top:8px"><button class="primary" id="lpSave">Save payouts</button><button id="lpClear">Clear</button><button id="lpClose">Close</button><span id="lpNote" class="small muted"></span></div></div>`;
  const ta=$('#lpTxt',box); const note=()=>{const t=parsePayouts(ta.value); $('#lpNote',box).textContent=t.length?`${t.length} tiers, ${t[t.length-1][1].toLocaleString()} places paid, $${payTotal(t).toLocaleString()} total`:'No payout lines recognized yet.';};
  ta.oninput=note; note(); ta.focus();
  $('#lpSave',box).onclick=()=>{ const t=parsePayouts(ta.value); if(!t.length){toast('No payout lines recognized');return;} setPayout(key,t); box.innerHTML=''; toast('Payouts saved'); after(); };
  $('#lpClear',box).onclick=()=>{ setPayout(key,null); box.innerHTML=''; after(); };
  $('#lpClose',box).onclick=()=>{ box.innerHTML=''; };
}
function renderLevContests(){
  const el=$('#levContests'); if(!el) return; if(!ST.levs||!ST.levs.size){ el.innerHTML=''; return; }
  const Vs=Array.from(ST.levs.values()).map(V=>({V,s:levSummary(V)})).sort((a,b)=>(b.s.meta.fee||0)-(a.s.meta.fee||0)||b.V.total-a.V.total);
  const tot={n:0,won:0,fees:0,cash:0,payAll:true}; Vs.forEach(({s})=>{tot.n+=s.M.length; tot.won+=s.won; tot.fees+=s.fees||0; tot.cash+=s.cash; if(!s.pay) tot.payAll=false;});
  const sel=ST.levSel;
  el.innerHTML=`<div class="card"><div class="row" style="justify-content:space-between"><h3>Contests loaded (${Vs.length})</h3><button id="levClearAll" class="small">Remove all</button></div>
    <p class="small muted">Standings as of each file's download. Fees are the ones you confirmed at import; edit them here. Winnings use the pasted payout table, or a projection from fee and field size (marked proj).</p>
    <div class="tw" style="border:0"><table><thead><tr><th></th><th>Contest</th><th class="n">Fee</th><th class="n">Field</th><th class="n">Yours</th><th class="n">Best rank</th><th class="n">Median rank</th><th class="n">Cashing</th><th class="n">Winnings now</th><th>Payouts</th><th></th></tr></thead><tbody>
    ${Vs.length>1?`<tr class="${sel==='all'?'selrow':''}"><td><input type="radio" name="levPick" value="all" ${sel==='all'?'checked':''} aria-label="All contests"></td><td><b>All contests</b> <span class="small muted">exposure weighted by your entry dollars</span></td><td class="n">${tot.fees?'$'+tot.fees.toFixed(2):'-'}</td><td></td><td class="n"><b>${tot.n}</b></td><td></td><td></td><td class="n">${tot.cash}</td><td class="n"><b>$${tot.won.toFixed(2)}</b>${tot.payAll?'':' <span class="small muted">partial</span>'}</td><td></td><td></td></tr>`:''}
    ${Vs.map(({V,s})=>`<tr class="${sel===V.cid?'selrow':''}"><td><input type="radio" name="levPick" value="${esc(V.cid)}" ${sel===V.cid?'checked':''} aria-label="Show this contest"></td><td class="small" style="white-space:normal">${esc(s.meta.fromEntries?shortName(s.meta.cname):'contest '+V.cid)}${V.unk.size?` <span class="muted" title="${esc(Array.from(V.unk.keys()).slice(0,10).join(', '))}">(${V.total-V.L.length} lineups skipped)</span>`:''}</td>
      <td class="n">${`<input class="levFee" data-cid="${esc(V.cid)}" type="number" step="0.01" min="0" style="width:70px" value="${s.meta.fee!=null?s.meta.fee:''}" placeholder="fee">`}</td>
      <td class="n">${V.total.toLocaleString()}</td><td class="n">${s.M.length||'<span class="muted">0</span>'}</td><td class="n">${s.rk.length?s.rk[0].toLocaleString():'-'}</td><td class="n">${s.rk.length?s.rk[Math.floor(s.rk.length/2)].toLocaleString():'-'}</td>
      <td class="n">${s.M.length?s.cash:'-'}</td><td class="n">${s.pay&&s.M.length?`$${s.won.toFixed(2)}${s.pay.real?'':' <span class="small muted">proj</span>'}`:'-'}</td>
      <td><button class="small levPay" data-cid="${esc(V.cid)}">${s.pay&&s.pay.real?'Edit':'Paste'}</button></td><td><button class="small levRm" data-cid="${esc(V.cid)}" aria-label="Remove contest">×</button></td></tr>`).join('')}
    </tbody></table></div><div id="levPayBox"></div></div>`;
  $$('input[name=levPick]',el).forEach(r=>r.onchange=()=>{ ST.levSel=r.value; renderLevContests(); renderLev(); });
  $$('.levFee',el).forEach(i=>i.onchange=()=>{ const f=levFees(); f[i.dataset.cid]=i.value===''?'':Math.max(0,+i.value); ST.levFeeMem=f; store.set('levFees',f); renderLevContests(); renderLev(); });
  $$('.levRm',el).forEach(b=>b.onclick=()=>{ ST.levs.delete(b.dataset.cid); if(ST.levSel===b.dataset.cid) ST.levSel=ST.levs.size>1?'all':(ST.levs.size?ST.levs.keys().next().value:null); ST.lev=Array.from(ST.levs.values()).sort((a,b)=>b.at-a.at)[0]||null; ST.mid=null; renderLevContests(); renderLev(); });
  $$('.levPay',el).forEach(b=>b.onclick=()=>{ const V=ST.levs.get(b.dataset.cid); const m=levMeta(V); payEditor($('#levPayBox'),V.cid,m.label,m.fee,()=>{renderLevContests(); renderLev();}); });
  $('#levClearAll').onclick=()=>{ ST.levs=new Map(); ST.lev=null; ST.levSel=null; ST.mid=null; renderLevContests(); renderLev(); };
}
function renderLev(){
  const el=$('#levOut'); if(!el) return; if(!ST.levs||!ST.levs.size||!ST.levSel){el.innerHTML='';return;}
  const P=ST.players; const T=ST.teams; const all=ST.levSel==='all';
  const pick=all?Array.from(ST.levs.values()):[ST.levs.get(ST.levSel)].filter(Boolean);
  // groups with weights: single contest -> plain shares; all -> each contest weighted by your entry dollars in it
  let G=pick.map(V=>({V,s:levSummary(V)})).filter(g=>g.s.M.length);
  if(!G.length){ const nF=pick.reduce((a,V)=>a+V.L.length,0); el.innerHTML=`<p class="note">${nF.toLocaleString()} lineups loaded. None matched you: load your DK entries file on Portfolio builder or type your DraftKings username above.</p>`; return; }
  const feeKnown=G.every(g=>g.s.meta.fee!=null); let wt=0; G.forEach(g=>{g.w=(feeKnown?Math.max(0.01,g.s.meta.fee):1)*g.s.M.length; wt+=g.w;}); G.forEach(g=>g.w/=wt);
  const cf={c:new Float64Array(P.length),f:new Float64Array(P.length)}, cm={c:new Float64Array(P.length),f:new Float64Array(P.length)};
  const add=(o,x,w)=>{o.c[x.cpt]+=w; for(const j of x.fl) o.f[j]+=w;};
  G.forEach(g=>{ const wf=g.w/g.V.L.length, wm=g.w/g.s.M.length; g.V.L.forEach(x=>add(cf,x,wf)); g.s.M.forEach(x=>add(cm,x,wm)); });
  const nM=G.reduce((a,g)=>a+g.s.M.length,0), nF=G.reduce((a,g)=>a+g.V.total,0);
  const lv=(v)=>`<td class="n" style="background:color-mix(in srgb, var(${v>=0?'--good':'--bad'}) ${Math.round(Math.min(1,Math.abs(v)/0.25)*45)}%, var(--panel));font-weight:600">${v>=0?'+':''}${(v*100).toFixed(1)}</td>`;
  let tiles, extra='';
  if(!all){ const g=G[0], V=g.V, M=g.s.M; const keyC=new Map(); for(const x of V.L){const k=levKey(x); keyC.set(k,(keyC.get(k)||0)+1);} const myKeys=new Map(); M.forEach(x=>{const k=levKey(x); myKeys.set(k,(myKeys.get(k)||0)+1);});
    const dup=M.map(x=>keyC.get(levKey(x))-myKeys.get(levKey(x))); const uniq=dup.filter(d=>d===0).length; const rk=g.s.rk;
    tiles=[['Field entries',V.total.toLocaleString()],['Your entries',M.length],['Best rank',rk[0].toLocaleString()],['Median rank',rk[Math.floor(rk.length/2)].toLocaleString()],
      [g.s.pay?'Winnings now':'Top 22%',g.s.pay?`$${g.s.won.toFixed(2)}${g.s.fees?` on $${g.s.fees.toFixed(2)}`:''}`:`${g.s.cash} of ${M.length}`],['Unique lineups',`${uniq} of ${M.length}`],['Avg dupes per lineup',fmt(dup.reduce((a,b)=>a+b,0)/M.length,1)]];
    const myL=M.map((x,i)=>({x,d:dup[i]})).sort((a,b)=>b.d-a.d);
    const lrow=(o)=>`<tr><td class="num">${o.x.rank.toLocaleString()}</td><td class="num">${fmt(o.x.pts,2)}</td><td><button class="cptc plink" data-pc="${o.x.cpt}">${esc(P[o.x.cpt].name)}</button></td><td class="small">${o.x.fl.map(j=>esc(P[j].name)).join(' · ')}</td><td class="n">${o.d}</td></tr>`;
    extra=`<div class="card" style="margin-top:16px"><h3>Your lineups by duplicates in this contest</h3><div class="tw" style="border:0;max-height:420px;overflow:auto"><table><thead><tr><th>Rank</th><th>Pts</th><th>Captain</th><th>Flex</th><th class="n">Field copies</th></tr></thead><tbody>${myL.map(lrow).join('')}</tbody></table></div></div>`;
  } else { const won=G.reduce((a,g)=>a+g.s.won,0), fees=G.reduce((a,g)=>a+(g.s.fees||0),0); const ul=new Set(); G.forEach(g=>g.s.M.forEach(x=>ul.add(levKey(x))));
    tiles=[['Contests with your entries',`${G.length} of ${ST.levs.size}`],['Your entries',nM],['Distinct lineups',ul.size],['Field entries faced',nF.toLocaleString()],['Entry fees',feeKnown?'$'+fees.toFixed(2):'some unknown'],['Winnings now','$'+won.toFixed(2)],['Cashing',G.reduce((a,g)=>a+g.s.cash,0)]]; }
  // player table
  const rows=P.map((p,j)=>({p,j,fc:cf.c[j],ff:cf.f[j],mc:cm.c[j],mf:cm.f[j]})).filter(r=>r.fc+r.ff>0.001||r.mc+r.mf>0);
  rows.forEach(r=>{r.ft=r.fc+r.ff; r.mt=r.mc+r.mf; r.lt=r.mt-r.ft; r.lc=r.mc-r.fc; r.lf=r.mf-r.ff;});
  const key=ST.view.levSort||'lt', dir=ST.view.levDir||-1; rows.sort((a,b)=>dir*((a[key]??0)-(b[key]??0)));
  const sh=(k,l)=>`<th class="sort n lsort" data-k="${k}">${l}${key===k?(dir<0?' ▾':' ▴'):''}</th>`;
  const ptab=`<div class="tw"><table><thead><tr><th>Player</th>${sh('ft','Field own')}${sh('mt','Your exp')}${sh('lt','Leverage')}${sh('fc','Field CPT')}${sh('mc','Your CPT')}${sh('lc','CPT lev')}${sh('ff','Field FLEX')}${sh('mf','Your FLEX')}${sh('lf','FLEX lev')}${hasOwn()?'<th class="n">Proj own (CPT+FLEX)</th>':''}</tr></thead><tbody>
    ${rows.map(r=>`<tr><td><span class="tm ${teamIdx(r.p)?'b':'a'}"></span><button class="plink" data-pc="${r.j}">${esc(r.p.name)}</button><span class="pos">${r.p.pos}</span></td><td class="n">${pct(r.ft,1)}</td><td class="n">${pct(r.mt,1)}</td>${lv(r.lt)}<td class="n">${pct(r.fc,1)}</td><td class="n">${pct(r.mc,1)}</td>${lv(r.lc)}<td class="n">${pct(r.ff,1)}</td><td class="n">${pct(r.mf,1)}</td>${lv(r.lf)}${hasOwn()?`<td class="n">${r.p.ownF!=null?pct((r.p.ownC||0)+(r.p.ownF||0),1):'-'}</td>`:''}</tr>`).join('')}</tbody></table></div>`;
  // stack types
  const isPC=(p)=>p.pos==='WR'||p.pos==='TE'; const isRB=(p)=>p.pos==='RB';
  const types={
    'Team split (captain\'s team first)':(x)=>{const c=[0,0]; [x.cpt,...x.fl].forEach(j=>c[teamIdx(P[j])]++); const ct=teamIdx(P[x.cpt]); return `${T[ct]} ${c[ct]} · ${T[1-ct]} ${c[1-ct]}`;},
    'Captain':(x)=>`${T[teamIdx(P[x.cpt])]} ${P[x.cpt].pos}`,
    'Captain stack':(x)=>{const c=P[x.cpt], fl=x.fl.map(j=>P[j]); const own=fl.filter(q=>q.team===c.team), opp=fl.filter(q=>q.team!==c.team);
      if(c.pos==='QB'){const n=own.filter(isPC).length; return n?`QB CPT + ${n} own pass catcher${n>1?'s':''}${opp.some(isPC)?' + bring-back':''}`:'QB CPT, no own pass catcher';}
      if(isPC(c)) return own.some(q=>q.pos==='QB')?`${c.pos} CPT with own QB${opp.some(q=>q.pos==='QB')?' + opp QB':''}`:`${c.pos} CPT without own QB`;
      if(isRB(c)) return own.some(q=>q.pos==='QB')?'RB CPT with own QB':'RB CPT without own QB';
      return `${c.pos} CPT`;},
    'QBs rostered':(x)=>{const q=[x.cpt,...x.fl].filter(j=>P[j].pos==='QB').map(j=>T[teamIdx(P[j])]); return q.length===2?'Both QBs':q.length===1?`${q[0]} QB only`:'No QB';},
    'K / DST':(x)=>{const ps=[x.cpt,...x.fl].map(j=>P[j].pos); const k=ps.filter(p=>p==='K').length, d=ps.filter(p=>p==='DST').length; return k&&d?'Kicker and DST':k?(k>1?'Both kickers':'Kicker'):d?(d>1?'Both DSTs':'DST'):'Neither';},
    'Salary left':(x)=>{const s=P[x.cpt].salC+x.fl.reduce((a,j)=>a+P[j].salF,0); const l=50000-s; return l===0?'$0':l<=500?'$100-500':l<=1500?'$600-1,500':l<=3000?'$1,600-3,000':'$3,100+';}
  };
  const stackTabs=Object.entries(types).map(([nm,fn])=>{ const f=new Map(), m=new Map();
    G.forEach(g=>{ const wf=g.w/g.V.L.length, wm=g.w/g.s.M.length; g.V.L.forEach(x=>{const k=fn(x); f.set(k,(f.get(k)||0)+wf);}); g.s.M.forEach(x=>{const k=fn(x); m.set(k,(m.get(k)||0)+wm);}); });
    const ks=Array.from(new Set([...f.keys(),...m.keys()])).sort((a,b)=>(f.get(b)||0)-(f.get(a)||0)).slice(0,12);
    return `<div class="card"><h3>${nm}</h3><table><thead><tr><th>Type</th><th class="n">Field</th><th class="n">You</th><th class="n">Lev</th></tr></thead><tbody>${ks.map(k=>{const a=f.get(k)||0, b=m.get(k)||0; return `<tr><td class="small" style="white-space:normal">${esc(k)}</td><td class="n">${pct(a,1)}</td><td class="n">${pct(b,1)}</td>${lv(b-a)}</tr>`;}).join('')}</tbody></table></div>`; }).join('');
  el.innerHTML=`<div class="pc-tiles">${tiles.map(([l,v])=>`<div><span class="lbl">${l}</span><b class="num">${v}</b></div>`).join('')}</div>
    <p class="small muted">${all?`${G.length} contests combined. Field ownership is each contest's ownership weighted by your entry ${feeKnown?'dollars':'count (some fees unknown)'} in that contest, so it is the field you are actually up against; your exposure is weighted the same way`:`${esc(G[0].V.file)} · contest ${esc(G[0].V.cid)}`}${!all&&G[0].V.unk.size?` · ${G[0].V.unk.size} player names not on this slate were skipped`:''}. Leverage = your exposure minus field ownership, in percentage points.</p>
    <h3 style="margin-top:12px">Players</h3>${ptab}
    <h3 style="margin-top:16px">Lineup construction</h3><div class="grid3">${stackTabs}</div>${extra}`;
  $$('th.lsort',el).forEach(t=>t.onclick=()=>{const k=t.dataset.k; if(ST.view.levSort===k) ST.view.levDir=-(ST.view.levDir||-1); else {ST.view.levSort=k; ST.view.levDir=-1;} renderLev();});
}
function renderLevTab(){
  const el=$('#pane-lev'); if(el.dataset.ready){ renderLevContests(); renderLev(); return; } el.dataset.ready='1';
  el.innerHTML=`<div class="grid2"><div class="card"><h3>Contest standings</h3><p class="small muted">After lock, download the standings for each contest you are in (the .zip from each contest page) and drop them all here at once. Upload a newer file for the same contest to replace it. Your lineups are found by Entry ID from your DK entries file, or by your DraftKings username.</p>
    <div class="drop" id="dropLev" role="button" tabindex="0"><b>Upload contest-standings .zip or .csv files</b><input type="file" id="fileLev" accept=".zip,.csv" multiple hidden></div>
    <div class="row small" style="margin-top:8px"><label for="levUser" class="muted">DraftKings username</label><input id="levUser" type="text" value="${esc(ST.dkUser||store.get('dkUser',''))}" style="width:160px"></div><span id="levStatus" class="small muted"></span></div></div>
    <div id="levConfirm" style="margin-top:16px"></div><div id="levContests" style="margin-top:16px"></div><div id="levOut" style="margin-top:16px"></div>`;
  const fi=$('#fileLev'), d=$('#dropLev'); fi.onchange=()=>{const f=Array.from(fi.files); if(f.length) loadStandingsFiles(f); fi.value='';};
  d.onclick=(e)=>{if(e.target.tagName!=='INPUT') fi.click();}; d.ondragover=(e)=>{e.preventDefault();d.classList.add('over');}; d.ondragleave=()=>d.classList.remove('over');
  d.ondrop=(e)=>{e.preventDefault();d.classList.remove('over');const f=Array.from(e.dataTransfer.files); if(f.length) loadStandingsFiles(f);};
  $('#levUser').onchange=(e)=>{ST.dkUser=e.target.value.trim(); store.set('dkUser',ST.dkUser); ST.mid=null; renderLevContests(); renderLev();};
  renderLevConfirm(); renderLevContests(); renderLev();
}

/* ---------------- live scoring (ESPN public game summary, or DK standings FPTS) ---------------- */
/*LIVEFN-START*/const ESPN_AB={WSH:'WAS',LAR:'LA',JAC:'JAX'};
function espnDateUrls(){ const m=(ST.dk&&/(\d{2})\/(\d{2})\/(\d{4})/.exec(ST.dk.gameInfo))||null; const urls=[];
  if(m) urls.push(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${m[3]}${m[1]}${m[2]}`); urls.push('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard'); return urls; }
async function espnScoreboardComp(){
  for(const u of espnDateUrls()){ const r=await fetch(u,{cache:'no-store'}); if(!r.ok) continue; const js=await r.json();
    for(const ev of js.events||[]){ const c=ev.competitions&&ev.competitions[0]; if(!c) continue; const tm={}; c.competitors.forEach(x=>tm[x.homeAway]=ESPN_AB[x.team.abbreviation]||x.team.abbreviation);
      if(tm.away===ST.teams[0]&&tm.home===ST.teams[1]){ ST.liveEvent={id:ev.id,teams:ST.teams.join('@')}; return {id:ev.id,comp:c}; } } }
  throw new Error('ESPN has no game for these teams on this date');
}
/* game state from ESPN (competition.status + situation) in the sim's terms */
function espnState(comp,sit,LV,T){
  if(!comp) return null; const ab=(x)=>ESPN_AB[x]||x; T=T||ST.teams; const st=comp.status||{}; const ty=(st.type||{});
  const idT={}; (comp.competitors||[]).forEach(x=>idT[x.team.id]=T.indexOf(ab(x.team.abbreviation)));
  const sc=[0,0]; (comp.competitors||[]).forEach(x=>{const t=T.indexOf(ab(x.team.abbreviation)); if(t>=0) sc[t]=+x.score||0;});
  const s=sit||comp.situation||{}; const per=+st.period||1; const S={q:per>4?5:per,clk:st.displayClock||'15:00',s0:sc[0],s1:sc[1],to:[s.awayTimeouts!=null?+s.awayTimeouts:3,s.homeTimeouts!=null?+s.homeTimeouts:3],recv:LV&&LV.recv!=null?LV.recv:0,final:!!ty.completed,detail:ty.detail||''};
  if(LV&&LV.score) { S.s0=LV.score[0]; S.s1=LV.score[1]; }
  if(ty.state==='pre'){ S.q=1; S.clk='15:00'; S.pos='k'+(1-S.recv); S.to=[3,3]; return S; }
  if(/HALFTIME/i.test(ty.name||'')){ S.q=3; S.clk='15:00'; S.pos='k'+S.recv; S.to=[3,3]; return S; }
  const pt=s.possession!=null?idT[s.possession]:-1; const m=/^([A-Z]{2,3})\s+(\d+)$/.exec((s.possessionText||'').trim());
  if(pt>=0&&+s.down>0){ S.pos='o'+pt; S.down=+s.down; S.togo=+s.distance||10; if(m){ S.side=T.indexOf(ab(m[1])); S.yd=+m[2]; } else { S.side=pt; S.yd=s.yardLine!=null?Math.min(50,+s.yardLine):25; } }
  else { const last=s.lastPlay&&s.lastPlay.team?idT[s.lastPlay.team.id]:-1; S.pos='k'+(last>=0?last:0); }
  return S;
}
function dkFromEspn(js,P,T){
  P=P||ST.players; T=T||ST.teams; const nameIx=new Map(P.map((p,j)=>[SL.norm(p.name),j]));
  const ab=(x)=>ESPN_AB[x]||x; const st=P.map(()=>({py:0,ptd:0,pint:0,pc:0,pa:0,sk:0,qbr:null,ra:0,ry:0,rtd:0,rec:0,tg:0,recy:0,rectd:0,fl:0,ret:0,two:0,fg:[],xp:0,xpa:0,fga:0,kpts:0}));
  const team={}; const unk=new Set();
  const num=(v)=>{const x=parseFloat(String(v).replace(/[^\d.\-]/g,'')); return isNaN(x)?0:x;};
  for(const tp of (js.boxscore&&js.boxscore.players)||[]){
    for(const cat of tp.statistics||[]){ const K=cat.keys||[]; const g=(row,k)=>{const i=K.indexOf(k); return i<0?null:row[i];};
      for(const a of cat.athletes||[]){ const j=nameIx.get(SL.norm(a.athlete.displayName)); const row=a.stats||[]; if(j==null){ unk.add(a.athlete.displayName); continue; } const s=st[j];
        if(cat.name==='passing'){ const ca=(g(row,'completions/passingAttempts')||'0/0').split('/'); s.pc=num(ca[0]); s.pa=num(ca[1]); s.py=num(g(row,'passingYards')); s.ptd=num(g(row,'passingTouchdowns')); s.pint=num(g(row,'interceptions')); s.sk=num((g(row,'sacks-sackYardsLost')||'0').split('-')[0]); const q=g(row,'adjQBR'); s.qbr=q!=null&&q!=='--'?num(q):null; }
        if(cat.name==='rushing'){ s.ra=num(g(row,'rushingAttempts')); s.ry=num(g(row,'rushingYards')); s.rtd=num(g(row,'rushingTouchdowns')); }
        if(cat.name==='receiving'){ s.rec=num(g(row,'receptions')); s.recy=num(g(row,'receivingYards')); s.rectd=num(g(row,'receivingTouchdowns')); s.tg=num(g(row,'receivingTargets')); }
        if(cat.name==='fumbles'){ s.fl=num(g(row,'fumblesLost')); }
        if(cat.name==='kickReturns') s.ret+=num(g(row,'kickReturnTouchdowns')); if(cat.name==='puntReturns') s.ret+=num(g(row,'puntReturnTouchdowns'));
        if(cat.name==='kicking'){ const xp=(g(row,'extraPointsMade/extraPointAttempts')||'0/0').split('/'); s.xp=num(xp[0]); s.xpa=num(xp[1]); s.fga=num((g(row,'fieldGoalsMade/fieldGoalAttempts')||'0/0').split('/')[1]); }
      } } }
  for(const tt of (js.boxscore&&js.boxscore.teams)||[]){ const o={}; (tt.statistics||[]).forEach(x=>o[x.name]=x); team[ab(tt.team.abbreviation)]={raw:tt.statistics||[],o}; }
  // plays: field-goal distances, two-point conversions, safeties, blocks, latest score, opening kickoff
  const drv=((js.drives&&js.drives.previous)||[]).concat(js.drives&&js.drives.current?[js.drives.current]:[]);
  const plays=[]; for(const d of drv) for(const p of d.plays||[]) plays.push({p,team:ab(d.team&&d.team.abbreviation||'')});
  let recv=null; if(drv.length&&drv[0].team){ const t=T.indexOf(ab(drv[0].team.abbreviation)); if(t>=0) recv=t; }
  let score=null; const abbr=(s)=>{ const m=/^([A-Z][a-z]?)\.\s?([A-Za-z'\-]+)/.exec(s.trim()); return m?[m[1],m[2]]:null; };
  const byAbbr=(tm,s)=>{ const a=abbr(s); if(!a) return -1; const c=P.map((p,j)=>j).filter(j=>P[j].team===tm&&P[j].name.startsWith(a[0])&&SL.norm(P[j].name).split(' ').includes(SL.norm(a[1]))); return c.length===1?c[0]:-1; };
  const extra={safety:{},blk:{}};
  for(const {p,team:tm} of plays){ const tx=p.text||''; if(p.awayScore!=null) score=[p.awayScore,p.homeScore];
    const fg=/(\d+)\s*yard field goal is GOOD/i.exec(tx); if(fg){ const k=P.findIndex(q=>q.pos==='K'&&q.team===tm); if(k>=0) st[k].fg.push(+fg[1]); }
    if(/TWO-POINT CONVERSION ATTEMPT/i.test(tx)&&/ATTEMPT SUCCEEDS/i.test(tx)){ const seg=tx.split(/TWO-POINT CONVERSION ATTEMPT\.?/i)[1]||''; const pm=/([A-Z]\.\s?[A-Za-z'\-]+) pass to ([A-Z]\.\s?[A-Za-z'\-]+)/.exec(seg), rm=/([A-Z]\.\s?[A-Za-z'\-]+) (?:rushes|right|left|up)/.exec(seg);
      if(pm){ [pm[1],pm[2]].forEach(n=>{const j=byAbbr(tm,n); if(j>=0) st[j].two++;}); } else if(rm){ const j=byAbbr(tm,rm[1]); if(j>=0) st[j].two++; } }
    if(/SAFETY/i.test(tx)&&p.scoringPlay){ const def=T[0]===tm?T[1]:T[0]; extra.safety[def]=(extra.safety[def]||0)+1; }
    if(/BLOCKED/i.test(tx)&&/(punt|field goal|extra point)/i.test(tx)){ const def=T[0]===tm?T[1]:T[0]; extra.blk[def]=(extra.blk[def]||0)+1; } }
  // injuries from play text: "J.Williams was injured during the play", "(J.Williams injured)", "has been ruled out".
  // A skill player who was hurt and has not appeared in any of his team's plays since is flagged likely out.
  const NM="([A-Z][a-z]?\\.\\s?[A-Z][A-Za-z'\\-]+)"; const reInj=new RegExp(NM+"\\s+(?:was\\s+)?injured","g"), reOut=new RegExp(NM+"\\s+(?:has been ruled out|is out for the (?:game|remainder)|will not return)","gi"), reBack=new RegExp(NM+"\\s+(?:has returned|returned to the game|is back)","gi");
  const injMap=new Map();
  plays.forEach(({p,team:tm},ix)=>{ const tx=p.text||''; const when=(p.period&&p.period.number?`Q${p.period.number>4?'OT':p.period.number} `:'')+(p.clock&&p.clock.displayValue?p.clock.displayValue:'');
    const hit=(tok,kind)=>{ let j=-1; for(const t of [tm,T[0]===tm?T[1]:T[0]]){ const k=byAbbr(t,tok); if(k>=0){ j=k; break; } } if(j<0||!['QB','RB','WR','TE','K'].includes(P[j].pos)) return;
      const o=injMap.get(j)||{j,tok:tok.replace(/\s/g,''),when,ix,ruled:false,back:false}; if(kind==='inj'&&!injMap.has(j)){ o.ix=ix; o.when=when; } if(kind==='out') o.ruled=true; if(kind==='back') o.back=true; injMap.set(j,o); };
    let m; reInj.lastIndex=0; while((m=reInj.exec(tx))) hit(m[1],'inj'); reOut.lastIndex=0; while((m=reOut.exec(tx))) hit(m[1],'out'); reBack.lastIndex=0; while((m=reBack.exec(tx))) hit(m[1],'back'); });
  const inj=Array.from(injMap.values()).map(o=>{ const tm=P[o.j].team; let since=0, seen=0;
    plays.forEach(({p,team:t2},ix)=>{ if(ix<=o.ix) return; const tx=p.text||''; if(t2===tm&&!/kicks|punts|extra point|field goal|Timeout|END (?:QUARTER|GAME)|Two-Minute/i.test(tx)) since++; if(tx.includes(o.tok)&&!/injured/.test(tx.split(o.tok)[1]||'')) seen++; });
    const status=o.ruled?'out':o.back||seen?'returned':since>=6?'likely out':'watch'; return {...o,since,seen,status}; });
  if(js.header&&js.header.competitions&&js.header.competitions[0]){ const c=js.header.competitions[0]; const sc={}; (c.competitors||[]).forEach(x=>sc[ab(x.team.abbreviation)]=num(x.score)); if(sc[T[0]]!=null&&sc[T[1]]!=null) score=[sc[T[0]],sc[T[1]]]; if(!arguments[1]) ST.liveStatus=c.status&&c.status.type?c.status.type.detail:''; }
  // DK points
  const pts=new Float64Array(P.length);
  P.forEach((p,j)=>{ const s=st[j]; if(p.pos==='K'){ s.kpts=s.xp+s.fg.reduce((a,d)=>a+(d<40?3:d<50?4:5),0); pts[j]=s.kpts; return; } if(p.pos==='DST') return;
    pts[j]=s.py*0.04+s.ptd*4-s.pint+(s.py>=300?3:0)+s.ry*0.1+s.rtd*6+(s.ry>=100?3:0)+s.rec+s.recy*0.1+s.rectd*6+(s.recy>=100?3:0)-s.fl+2*s.two+6*s.ret; });
  const retTD=[0,1].map(t=>P.reduce((a,p,j)=>a+(p.team===T[t]?st[j].ret:0),0));
  [0,1].forEach(t=>{ const d=P.findIndex(p=>p.pos==='DST'&&p.team===T[t]); if(d<0) return; const me=team[T[t]]||{o:{}}, op=team[T[1-t]]||{o:{}}; const ov=(o,k)=>o[k]?num(String(o[k].displayValue).split('-')[0]):0;
    const sk=ov(op.o,'sacksYardsLost'), it=ov(op.o,'interceptions'), fr=ov(op.o,'fumblesLost'), td=ov(me.o,'defensiveTouchdowns'), optd=ov(op.o,'defensiveTouchdowns');
    const paX=7*(optd+retTD[1-t]); const pa=score?Math.max(0,score[1-t]-paX):0; const tier=!score?0:pa===0?10:pa<=6?7:pa<=13?4:pa<=20?1:pa<=27?0:pa<=34?-1:-4;
    const sf=extra.safety[T[t]]||0, blk=extra.blk[T[t]]||0;
    pts[d]=sk+2*it+2*fr+6*td+2*sf+2*blk+tier; st[d].dst={sk,it,fr,td,sf,blk,pa,paX}; });
  return {pts,st,team,score,unk,recv,inj,src:'ESPN live box score'};
}
/*LIVEFN-END*/
function dkFromStandings(){
  const V=ST.levs&&ST.levs.size?Array.from(ST.levs.values()).sort((a,b)=>b.at-a.at)[0]:ST.lev; if(!V||!V.drafted.length) return null; const P=ST.players; const pts=new Float64Array(P.length);
  for(const d of V.drafted){ if(d.pos!=='FLEX') continue; const j=P.findIndex(p=>SL.norm(p.name)===SL.norm(d.player)); if(j>=0) pts[j]=d.fpts; }
  return {pts,st:null,team:null,score:null,unk:new Set(),src:`DraftKings FPTS from ${V.file}`};
}
async function pullLive(){
  const btn=$('#liveGo'), note=$('#liveStatus'); btn.disabled=true; note.textContent='Pulling from ESPN…';
  try{ const sb=await espnScoreboardComp(); const r=await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${sb.id}`,{cache:'no-store'}); if(!r.ok) throw new Error('ESPN returned '+r.status);
    const js=await r.json(); ST.live=dkFromEspn(js); ST.live.at=new Date(); ST.live.state=espnState(sb.comp,js.situation,ST.live);
    if(ST.live.state&&$('#mFollow')&&$('#mFollow').checked) ST.midForm=Object.assign({},ST.midForm||{},ST.live.state);
    note.textContent=`Updated ${ST.live.at.toLocaleTimeString([],{hour:'numeric',minute:'2-digit',second:'2-digit'})}${ST.liveStatus?' · '+ST.liveStatus:''}`; renderLive();
    if($('#mAuto')&&$('#mAuto').checked&&ST.res&&!ST.midBusy) runMid();
  }catch(e){ note.textContent=/Failed to fetch|NetworkError|Load failed|Content Security/i.test(String(e))?'Could not reach ESPN. The claude.ai viewer blocks outside requests: use the downloaded HTML file, or use DraftKings points from your contest standings files.':String(e.message||e); }
  btn.disabled=false;
}
/* live standings: re-rank every loaded contest with the current points */
function liveContests(pts){
  const out=[]; if(!ST.levs) return out;
  for(const V of ST.levs.values()){ const meta=levMeta(V); const pay=payFor(V); const mine=new Set(levMine(V));
    const sc=new Float64Array(V.L.length); V.L.forEach((x,i)=>{ let s=1.5*pts[x.cpt]; for(const j of x.fl) s+=pts[j]; sc[i]=Math.round(s*100)/100; });
    const srt=Float64Array.from(sc).sort(); const nF=srt.length;
    const gt=(s)=>{ let lo=0,hi=nF; while(lo<hi){const m=(lo+hi)>>1; if(srt[m]<=s) lo=m+1; else hi=m;} return nF-lo; }; // count strictly greater
    const eq=(s)=>{ let lo=0,hi=nF; while(lo<hi){const m=(lo+hi)>>1; if(srt[m]<s) lo=m+1; else hi=m;} return nF-lo-gt(s); };
    const M=[]; V.L.forEach((x,i)=>{ if(!mine.has(x)) return; const a=gt(sc[i]), t=eq(sc[i]); M.push({x,score:sc[i],rank:a+1,won:pay?pay.avg(a+1,a+t):0}); });
    const cashLine=pay?pay.Pd:Math.round(V.total*0.22);
    out.push({V,meta,pay,sc,M,cashLine,best:M.length?Math.min(...M.map(m=>m.rank)):null,cash:M.filter(m=>m.rank<=cashLine).length,won:M.reduce((a,m)=>a+m.won,0),fees:meta.fee!=null?meta.fee*M.length:null,gt}); }
  return out.sort((a,b)=>(b.meta.fee||0)-(a.meta.fee||0)||b.V.total-a.V.total);
}
function myLineupsForLive(LC){
  const out=new Map(); const add=(L,c)=>{ const k=E.lineupKey(L); if(!out.has(k)) out.set(k,{L,key:k,contests:[]}); if(c) out.get(k).contests.push(c); };
  const loaded=new Set(LC.map(c=>c.V.cid));
  LC.forEach(c=>c.M.forEach(m=>add([m.x.cpt,...m.x.fl],{label:c.meta.label,fee:c.meta.fee||0,rank:m.rank,won:m.won,pay:!!c.pay,n:c.V.total})));
  if(ST.entries){ const idIx=new Map(ST.players.map((p,j)=>[String(p.idC),j]).concat(ST.players.map((p,j)=>[String(p.idF),j])));
    for(const e of ST.entries.rows){ if(loaded.has(e.cid)) continue; let L=null;
      if(e.pre){ const ids=e.cells.map(x=>(/\((\d+)\)/.exec(x)||[null,x])[1]); const LL=ids.map(x=>idIx.get(String(x))); if(LL.every(x=>x!=null)) L=LL; }
      else if(ST.assign){ const c=ST.assign.map.get(e.id); if(c) L=c.L; }
      if(L) add(L,{label:`$${e.fee.toFixed(2)} ${shortName(e.cname)}`,fee:e.fee,rank:null}); } }
  if(!out.size&&ST.port) ST.port.forEach(c=>add(c.L,null));
  return Array.from(out.values());
}
function renderLive(){
  const el=$('#liveOut'); if(!el) return; const LV=ST.live; if(!LV){ el.innerHTML=''; renderMidCard(); return; }
  const P=ST.players, T=ST.teams, R=ST.res; const pts=LV.pts;
  const LC=liveContests(pts); ST.liveLC=LC;
  const lus=myLineupsForLive(LC).map(o=>({...o,score:1.5*pts[o.L[0]]+o.L.slice(1).reduce((a,j)=>a+pts[j],0)})).sort((a,b)=>b.score-a.score);
  const ord=P.map((p,j)=>j).filter(j=>P[j].active&&(pts[j]!==0||(LV.st&&(LV.st[j].pa||LV.st[j].ra||LV.st[j].tg)))).sort((a,b)=>pts[b]-pts[a]);
  const tt=(t,k)=>{const s=LV.st; let v=0; P.forEach((p,j)=>{ if(p.team===T[t]) v+=s[j][k]||0; }); return v;};
  const line=(j)=>{ if(!LV.st) return ''; const s=LV.st[j], p=P[j]; const t=teamIdx(p); const parts=[];
    if(p.pos==='K') return `FG ${s.fg.length}/${s.fga}${s.fg.length?' ('+s.fg.join(', ')+')':''} · XP ${s.xp}/${s.xpa}`;
    if(p.pos==='DST'&&s.dst) return `${s.dst.sk} sk · ${s.dst.it} INT · ${s.dst.fr} FR · ${s.dst.td} TD · ${s.dst.pa} PA`;
    if(s.pa) parts.push(`${s.pc}/${s.pa}, ${s.py} yds, ${s.ptd} TD, ${s.pint} INT${s.qbr!=null?`, QBR ${s.qbr}`:''}`);
    if(s.ra) parts.push(`${s.ra}-${s.ry} rush${s.rtd?`, ${s.rtd} TD`:''} (${pct(s.ra/Math.max(1,tt(t,'ra')),0)} of team carries, ${fmt(s.ry/s.ra,1)} ypc)`);
    if(s.tg) parts.push(`${s.rec}/${s.tg} rec ${s.recy} yds${s.rectd?`, ${s.rectd} TD`:''} (${pct(s.tg/Math.max(1,tt(t,'tg')),0)} tgt share, ${fmt(s.recy/s.tg,1)} y/tgt)`);
    if(s.fl) parts.push(`${s.fl} fum lost`); if(s.two) parts.push(`${s.two} 2-pt`); if(s.ret) parts.push(`${s.ret} return TD`); return parts.join(' · '); };
  const teamTab=LV.team?`<div class="card"><h3>Team stats</h3><div class="tw" style="border:0"><table><thead><tr><th></th><th class="n">${T[0]}</th><th class="n">${T[1]}</th></tr></thead><tbody>${(LV.team[T[0]]?LV.team[T[0]].raw:[]).map(x=>`<tr><td>${esc(x.label)}</td><td class="n">${esc(x.displayValue)}</td><td class="n">${esc(((LV.team[T[1]]||{o:{}}).o[x.name]||{}).displayValue||'')}</td></tr>`).join('')}</tbody></table></div></div>`:'';
  // contests now
  const tot=LC.reduce((a,c)=>({won:a.won+c.won,fees:a.fees+(c.fees||0),n:a.n+c.M.length,cash:a.cash+c.cash}),{won:0,fees:0,n:0,cash:0});
  const ctab=LC.length?`<div class="card" style="margin-top:16px"><h3>Your contests now</h3><p class="small muted">Every loaded contest re-ranked with these points. Field lineups come from each standings file.</p><div class="tw" style="border:0"><table><thead><tr><th>Contest</th><th class="n">Field</th><th class="n">Yours</th><th class="n">Best rank</th><th class="n">Cash line</th><th class="n">Cashing</th><th class="n">Fees</th><th class="n">Winnings</th><th class="n">Profit</th></tr></thead><tbody>
    ${LC.map(c=>`<tr><td class="small" style="white-space:normal">${esc(c.meta.label)}</td><td class="n">${c.V.total.toLocaleString()}</td><td class="n">${c.M.length}</td><td class="n">${c.best?c.best.toLocaleString():'-'}</td><td class="n">${c.cashLine.toLocaleString()}</td><td class="n">${c.M.length?c.cash:'-'}</td><td class="n">${c.fees!=null?'$'+c.fees.toFixed(2):'-'}</td><td class="n">${c.pay?`<b>$${c.won.toFixed(2)}</b>${c.pay.real?'':' <span class="small muted">proj</span>'}`:'-'}</td><td class="n">${c.pay&&c.fees!=null&&c.M.length?`<span style="color:var(${c.won>=c.fees?'--good':'--bad'});font-weight:600">${c.won>=c.fees?'+':'-'}$${Math.abs(c.won-c.fees).toFixed(2)}</span>`:'-'}</td></tr>`).join('')}
    <tr><td><b>Total</b></td><td></td><td class="n"><b>${tot.n}</b></td><td></td><td></td><td class="n"><b>${tot.cash}</b></td><td class="n"><b>$${tot.fees.toFixed(2)}</b></td><td class="n"><b>$${tot.won.toFixed(2)}</b></td><td class="n"><b style="color:var(${tot.won>=tot.fees?'--good':'--bad'})">${tot.won>=tot.fees?'+':'-'}$${Math.abs(tot.won-tot.fees).toFixed(2)}</b></td></tr></tbody></table></div></div>`
    :`<p class="note" style="margin-top:16px">Load your contest-standings files on the Leverage tab to see live ranks against the real field in every contest.</p>`;
  el.innerHTML=`${LV.score?`<div class="final" style="margin-bottom:8px"><span class="t0">${T[0]} ${LV.score[0]}</span> <span class="muted">-</span> <span class="t1">${T[1]} ${LV.score[1]}</span> <span class="small muted" style="font-family:var(--f-body);font-size:13px">${esc(ST.liveStatus||'')}</span></div>`:''}
    <p class="small muted">Source: ${esc(LV.src)}.${LV.unk&&LV.unk.size?` Not on this slate: ${esc(Array.from(LV.unk).slice(0,8).join(', '))}.`:''} ${LV.st?'DK points are computed from the box score: 2-point conversions, blocked kicks and safeties come from play text and may lag; DST points allowed remove opponent defensive and return TDs at 7 each.':''}</p>
    ${ctab}
    <div class="card" style="margin-top:16px"><h3>Your highest-scoring lineups</h3><p class="small muted">${lus.length} distinct lineups. Each contest shows the live rank${LC.some(c=>c.pay)?' and winnings':''} for that entry; contests without a standings file show the name only.</p>
      <div class="tw" style="border:0;max-height:560px;overflow:auto"><table><thead><tr><th class="n">Live pts</th><th>Captain</th><th>Flex</th><th>Contests</th></tr></thead><tbody>
      ${lus.slice(0,100).map(o=>`<tr><td class="n"><b>${fmt(o.score,2)}</b></td><td><button class="cptc plink" data-pc="${o.L[0]}">${esc(P[o.L[0]].name)}</button></td><td class="small">${o.L.slice(1).map(j=>`<button class="plink" data-pc="${j}">${esc(P[j].name)}</button>`).join(' · ')}</td><td class="small" style="white-space:normal">${o.contests.length?o.contests.sort((a,b)=>b.fee-a.fee).map(c=>`${esc(c.label)}${c.rank?`: <b>#${c.rank.toLocaleString()}</b>${c.pay&&c.won>0?` <span style="color:var(--good)">$${c.won.toFixed(2)}</span>`:''}`:''}`).join('<br>'):'<span class="muted">portfolio (not assigned)</span>'}</td></tr>`).join('')}</tbody></table></div></div>
    ${renderOpp(LC,pts)}
    <div class="${teamTab?'grid2':''}" style="${teamTab?'grid-template-columns:minmax(0,3fr) minmax(0,2fr);':''}margin-top:16px">
      <div class="card"><h3>Live DK points</h3><div class="tw" style="border:0"><table><thead><tr><th>Player</th><th class="n">FLEX</th><th class="n">CPT</th>${R?'<th class="n">Pregame mean</th>':''}<th>Line</th></tr></thead><tbody>
        ${ord.map(j=>`<tr><td><span class="tm ${teamIdx(P[j])?'b':'a'}"></span><button class="plink" data-pc="${j}">${esc(P[j].name)}</button><span class="pos">${P[j].pos}</span></td><td class="n"><b>${fmt(pts[j],2)}</b></td><td class="n">${fmt(pts[j]*1.5,2)}</td>${R?`<td class="n">${fmt(R.stats[j].mean)}</td>`:''}<td class="small" style="white-space:normal">${line(j)}</td></tr>`).join('')}</tbody></table></div></div>
      ${teamTab}</div>`;
  const os=$('#oppSel',el); if(os) os.onchange=()=>{ ST.oppSel=os.value; renderLive(); };
  renderMidCard();
}
/* opponents in one contest: leaderboard and what the entries ahead of you have */
function renderOpp(LC,pts){
  const cs=LC.filter(c=>c.V.L.length); if(!cs.length) return ''; const P=ST.players;
  const c=cs.find(x=>x.V.cid===ST.oppSel)||cs[0]; const V=c.V; const mineSet=new Set(c.M.map(m=>m.x));
  const ordx=V.L.map((x,i)=>i).sort((a,b)=>c.sc[b]-c.sc[a]); const top=ordx.slice(0,15);
  const keyC=new Map(); V.L.forEach(x=>{const k=levKey(x); keyC.set(k,(keyC.get(k)||0)+1);});
  const bestSc=c.M.length?Math.max(...c.M.map(m=>m.score)):null; const ahead=bestSc==null?ordx.slice(0,Math.max(10,Math.round(V.L.length*0.01))):ordx.filter(i=>c.sc[i]>bestSc&&!mineSet.has(V.L[i]));
  const nA=ahead.length; const ca=new Float64Array(P.length), cc=new Float64Array(P.length); ahead.forEach(i=>{const x=V.L[i]; cc[x.cpt]++; ca[x.cpt]++; x.fl.forEach(j=>ca[j]++);});
  const my=new Float64Array(P.length); c.M.forEach(m=>{my[m.x.cpt]++; m.x.fl.forEach(j=>my[j]++);});
  const prow=P.map((p,j)=>({j,a:nA?ca[j]/nA:0,c:nA?cc[j]/nA:0,m:c.M.length?my[j]/c.M.length:0})).filter(r=>r.a>0.02||r.m>0.02).sort((a,b)=>(b.a-b.m)-(a.a-a.m)).slice(0,14);
  const pr=(i)=>{const x=V.L[i]; const mine=mineSet.has(x); return `<tr${mine?' class="selrow"':''}><td class="num">${(c.gt(c.sc[i])+1).toLocaleString()}</td><td class="small">${esc(x.user)}${mine?' <b>(you)</b>':''}</td><td class="num"><b>${fmt(c.sc[i],2)}</b></td><td><button class="cptc plink" data-pc="${x.cpt}">${esc(P[x.cpt].name)}</button></td><td class="small">${x.fl.map(j=>esc(P[j].name)).join(' · ')}</td><td class="n">${keyC.get(levKey(x))}</td></tr>`;};
  return `<div class="card" style="margin-top:16px"><div class="row" style="justify-content:space-between"><h3>Opponents</h3><select id="oppSel" aria-label="Contest">${cs.map(x=>`<option value="${esc(x.V.cid)}" ${x===c?'selected':''}>${esc(x.meta.label)} (${x.V.total.toLocaleString()})</option>`).join('')}</select></div>
    <div class="grid2" style="grid-template-columns:minmax(0,3fr) minmax(0,2fr)"><div><h3 style="font-size:15px">Leaderboard</h3><div class="tw" style="border:0"><table><thead><tr><th>Rank</th><th>User</th><th>Pts</th><th>Captain</th><th>Flex</th><th class="n">Copies</th></tr></thead><tbody>${top.map(pr).join('')}</tbody></table></div></div>
    <div><h3 style="font-size:15px">${bestSc==null?'Top 1% of the field':nA?`The ${nA.toLocaleString()} entries ahead of your best lineup`:'Nobody is ahead of your best lineup'}</h3>${nA?`<p class="small muted">Players they have more of than you (any slot). Points these players score widen the gap.</p><div class="tw" style="border:0"><table><thead><tr><th>Player</th><th class="n">Pts</th><th class="n">Them</th><th class="n">Their CPT</th><th class="n">You here</th></tr></thead><tbody>
      ${prow.map(r=>`<tr><td><span class="tm ${teamIdx(P[r.j])?'b':'a'}"></span><button class="plink" data-pc="${r.j}">${esc(P[r.j].name)}</button><span class="pos">${P[r.j].pos}</span></td><td class="n">${fmt(pts[r.j],1)}</td><td class="n">${pct(r.a,0)}</td><td class="n">${pct(r.c,0)}</td><td class="n">${pct(r.m,0)}</td></tr>`).join('')}</tbody></table></div>`:''}</div></div></div>`;
}

/* ---------------- mid-game sim: start from the live state, finish the game N times, score every contest ---------------- */
/* In-game usage blend, fit by backtest on 2024-26 regular-season games (bt_live_usage.py): the rest-of-game share is
   (k x pregame share + tonight's count) / (k + team count so far). Best k was stable at Q1, half and Q3 cutoffs:
   about 5 for designed runs (tonight's backfield split is very informative) and about 20 for targets. */
const LIVE_K={run:5.5,tgt:20.5};
function midDefaults(){
  const LV=ST.live; const s=(LV&&LV.state)||{}; const sc=(LV&&LV.score)||[0,0];
  return Object.assign({q:1,clk:'15:00',s0:sc[0],s1:sc[1],pos:'o0',side:0,yd:25,down:1,togo:10,to:[3,3],recv:0,n:10000,out:[],keepIn:[],blend:true,autoInj:true},s,ST.midForm||{});
}
function autoOutSet(F){ const LV=ST.live; const s=new Set(); if(F.autoInj!==false&&LV&&LV.inj) LV.inj.forEach(o=>{ if(o.status==='out'||o.status==='likely out') s.add(o.j); }); return s; }
function effectiveOut(F){ const keep=new Set(F.keepIn||[]); const s=new Set([...(F.out||[]),...autoOutSet(F)]); keep.forEach(j=>s.delete(j)); return s; }
/* rest-of-game shares: pregame shares (normalized among active, not-out players) blended with tonight's ESPN carries and targets */
function blendUsage(F){
  const LV=ST.live; if(!ST.res||!LV||!LV.st) return null; const T=ST.teams; const out=effectiveOut(F);
  const SP=ST.res.slate.players.map(p=>Object.assign({},p)); const rows=[]; let nR=0,nT=0;
  for(let t=0;t<2;t++){
    const ids=SP.map((p,j)=>j).filter(j=>SP[j].team===T[t]&&SP[j].active&&!out.has(j)&&['QB','RB','WR','TE'].includes(SP[j].pos));
    const runIds=ids.filter(j=>SP[j].pos!=='QB'||SP[j].isStarterQB), tgtIds=ids.filter(j=>SP[j].pos!=='QB');
    const go=(list,f,fz,fx,obsKey,k)=>{ const tot=list.reduce((a,j)=>a+(+SP[j][f]||0),0); const n=list.reduce((a,j)=>a+(LV.st[j][obsKey]||0),0); const R={};
      list.forEach(j=>{ const pre=tot>0?(+SP[j][f]||0)/tot:0, o=LV.st[j][obsKey]||0, b=(k*pre+o)/(k+n); R[j]={pre,o,b};
        if(F.blend!==false){ if(pre>0){ const r=b/pre; SP[j][fz]=(+SP[j][fz]||0)*r; SP[j][fx]=(+SP[j][fx]||0)*r; } else { SP[j][fz]=b; SP[j][fx]=b; } SP[j][f]=b; } }); return {R,n}; };
    const r=go(runIds,'rs','rsz','rsy','ra',LIVE_K.run), g=go(tgtIds,'ts','tsz','tpd','tg',LIVE_K.tgt); nR+=r.n/2; nT+=g.n/2;
    ids.forEach(j=>{ const a=r.R[j], b=g.R[j]; if((a&&(a.pre>=0.01||a.o))||(b&&(b.pre>=0.01||b.o))) rows.push({j,t,run:a||null,tgt:b||null,nr:r.n,nt:g.n}); });
  }
  return {players:SP,rows,srMul:Math.sqrt(LIVE_K.run/(LIVE_K.run+nR)),stMul:Math.sqrt(LIVE_K.tgt/(LIVE_K.tgt+nT))};
}
function renderMidCard(){
  const el=$('#midCard'); if(!el) return; const T=ST.teams, P=ST.players; const F=midDefaults(); const LV=ST.live; const src=LV?(LV.st?'ESPN box score (exact stats, so 100-yard and 300-yard bonuses resolve correctly)':'DK FPTS (points so far are added as a block; yardage bonuses still to come are not credited)'):null;
  const opt=(v,l,cur)=>`<option value="${v}" ${String(cur)===String(v)?'selected':''}>${l}</option>`;
  const outSet=effectiveOut(F), auto=autoOutSet(F), keep=new Set(F.keepIn||[]);
  const cand=P.map((p,j)=>j).filter(j=>P[j].active&&!['K','DST'].includes(P[j].pos)&&((ST.res&&ST.res.stats[j].mean>=1)||outSet.has(j)||auto.has(j))).sort((a,b)=>teamIdx(P[a])-teamIdx(P[b])||P[b].salF-P[a].salF);
  const BU=blendUsage(F); const injs=(LV&&LV.inj)||[];
  const injNote=injs.length?`<div class="small" style="margin-top:8px"><b>Injury notes from the play-by-play:</b> ${injs.map(o=>`<span class="injn">${esc(P[o.j].name)} hurt ${esc(o.when||'')}: ${o.status==='out'?'<b style="color:var(--bad)">ruled out</b>':o.status==='likely out'?`<b style="color:var(--bad)">likely out</b> (not in any of ${o.since} ${esc(P[o.j].team)} plays since)`:o.status==='returned'?'<span style="color:var(--good)">back in</span>':`watching (${o.since} ${esc(P[o.j].team)} plays since)`}${keep.has(o.j)?' <span class="muted">(kept in by you)</span>':''}</span>`).join(' · ')}</div>`:'';
  const pc=(v)=>v==null?'<span class="muted">-</span>':pct(v,0);
  const usage=BU&&BU.rows.length?`<details style="margin-top:8px" ${ST.usageOpen?'open':''} id="usageDet"><summary class="small">Tonight's usage vs pregame shares (${F.blend!==false?'blended into the sim':'not used'})</summary>
    <div class="tw" style="border:0;margin-top:6px"><table><thead><tr><th>Player</th><th class="n">Carries</th><th class="n">Pregame run %</th><th class="n">Rest-of-game run %</th><th class="n">Targets</th><th class="n">Pregame tgt %</th><th class="n">Rest-of-game tgt %</th></tr></thead><tbody>
    ${BU.rows.sort((a,b)=>a.t-b.t||((b.run?b.run.b:0)+(b.tgt?b.tgt.b:0))-((a.run?a.run.b:0)+(a.tgt?a.tgt.b:0))).map(r=>{ const d=(x)=>x?`<td class="n" style="${Math.abs(x.b-x.pre)>=0.05?`color:var(${x.b>x.pre?'--good':'--bad'});font-weight:600`:''}">${pct(x.b,0)}</td>`:'<td class="n muted">-</td>';
      return `<tr><td><span class="tm ${r.t?'b':'a'}"></span><button class="plink" data-pc="${r.j}">${esc(P[r.j].name)}</button><span class="pos">${P[r.j].pos}</span></td><td class="n">${r.run?`${r.run.o} of ${r.nr}`:'-'}</td><td class="n">${pc(r.run&&r.run.pre)}</td>${d(r.run)}<td class="n">${r.tgt?`${r.tgt.o} of ${r.nt}`:'-'}</td><td class="n">${pc(r.tgt&&r.tgt.pre)}</td>${d(r.tgt)}</tr>`; }).join('')}</tbody></table></div>
    <p class="small muted">Rest-of-game share = (k x pregame share + tonight's count) / (k + team count so far), with k = ${LIVE_K.run} for carries and ${LIVE_K.tgt} for targets, fit on 2024-26 games. Carries include QB scrambles and kneels in ESPN's count.</p></details>`:'';
  el.innerHTML=`<h3>Sim from here</h3><p class="small muted">Finishes the game from the current state ${ST.res?'with the same team strengths as the pregame sim':''}, adds what each player has already scored, then ranks every entry in every loaded contest in every sim. ${src?`Points so far: ${src}.`:'<b>Load live points first</b> (ESPN, or DraftKings FPTS) so players start from what they already have.'}</p>
    <div class="row small" style="gap:10px;flex-wrap:wrap">
      <label>Quarter <select id="mQ">${[1,2,3,4,5].map(q=>opt(q,q===5?'OT':'Q'+q,F.q)).join('')}</select></label>
      <label>Clock <input id="mClk" type="text" value="${esc(F.clk)}" style="width:62px"></label>
      <label>${T[0]} <input id="mS0" type="number" min="0" value="${F.s0}" style="width:54px"></label>
      <label>${T[1]} <input id="mS1" type="number" min="0" value="${F.s1}" style="width:54px"></label>
      <label>Situation <select id="mPos">${opt('o0',T[0]+' ball',F.pos)}${opt('o1',T[1]+' ball',F.pos)}${opt('k0',T[0]+' kicking off',F.pos)}${opt('k1',T[1]+' kicking off',F.pos)}</select></label>
      <label>Ball on <select id="mSide">${opt(0,T[0],F.side)}${opt(1,T[1],F.side)}</select> <input id="mYd" type="number" min="1" max="50" value="${F.yd}" style="width:50px"></label>
      <label>Down <select id="mDown">${[1,2,3,4].map(d=>opt(d,d,F.down)).join('')}</select></label>
      <label>To go <input id="mTogo" type="number" min="1" max="99" value="${F.togo}" style="width:50px"></label>
      <label>TOs ${T[0]} <input id="mTO0" type="number" min="0" max="3" value="${F.to[0]}" style="width:44px"></label>
      <label>${T[1]} <input id="mTO1" type="number" min="0" max="3" value="${F.to[1]}" style="width:44px"></label>
      <label>Opening kick received by <select id="mRecv">${opt(0,T[0],F.recv)}${opt(1,T[1],F.recv)}</select></label>
      <label>Sims <input id="mN" type="number" min="200" max="20000" step="500" value="${F.n}" style="width:76px"></label></div>
    ${LV&&LV.st?`<div class="row small" style="margin-top:8px;gap:14px"><label><input type="checkbox" id="mBlend" ${F.blend!==false?'checked':''}> Blend tonight's carries and targets into the shares</label><label><input type="checkbox" id="mAutoInj" ${F.autoInj!==false?'checked':''}> Mark injured players out automatically</label></div>`:''}
    ${injNote}${usage}
    <details style="margin-top:8px"><summary class="small">Players out for the rest of the game${outSet.size?` (${outSet.size})`:''}</summary><div class="ochips" style="margin-top:6px">${cand.map(j=>`<button class="ochip mOut ${outSet.has(j)?'on':''}" data-j="${j}" aria-pressed="${outSet.has(j)}"><span class="tm ${teamIdx(P[j])?'b':'a'}"></span>${esc(P[j].name)} <span class="pos">${P[j].pos}</span>${auto.has(j)?' <span class="small">(injured)</span>':''}</button>`).join('')}</div></details>
    <div class="row" style="margin-top:10px"><button class="primary" id="mGo" ${ST.res?'':'disabled'}>Sim the rest of the game</button><label class="small"><input type="checkbox" id="mFollow" ${ST.midFollow!==false?'checked':''}> Fill the state from each ESPN pull</label><label class="small"><input type="checkbox" id="mAuto" ${ST.midAuto?'checked':''}> Re-sim on each pull</label><span id="mStatus" class="small muted" style="margin-left:8px">${ST.res?'':(typeof SWEAT!=='undefined'?'Starts by itself once a contest loads.':'Run the pregame sim first.')}</span></div>
    <div id="midOut" style="margin-top:12px"></div>`;
  const save=()=>{ ST.midForm=readMidForm(); };
  $$('input,select',el).forEach(i=>{ if(i.id==='mFollow'){ i.onchange=()=>{ST.midFollow=i.checked;}; return; } if(i.id==='mAuto'){ i.onchange=()=>{ST.midAuto=i.checked;}; return; }
    if(i.id==='mBlend'||i.id==='mAutoInj'){ i.onchange=()=>{ save(); renderMidCard(); }; return; } i.onchange=save; });
  const ud=$('#usageDet',el); if(ud) ud.ontoggle=()=>{ ST.usageOpen=ud.open; };
  $$('.mOut',el).forEach(b=>b.onclick=()=>{ const f=readMidForm(); const j=+b.dataset.j; const o=new Set(f.out), k=new Set(f.keepIn); const isOut=effectiveOut(f).has(j);
    if(isOut){ o.delete(j); if(autoOutSet(f).has(j)) k.add(j); } else { k.delete(j); o.add(j); } f.out=Array.from(o); f.keepIn=Array.from(k); ST.midForm=f; renderMidCard(); });
  $('#mGo').onclick=runMid; renderMidOut();
}
function readMidForm(){
  const v=(id)=>$('#'+id).value; const f=ST.midForm||{}; const cb=(id,d)=>{const e=$('#'+id); return e?e.checked:(f[id==='mBlend'?'blend':'autoInj']??d);};
  return {q:+v('mQ'),clk:v('mClk'),s0:+v('mS0')||0,s1:+v('mS1')||0,pos:v('mPos'),side:+v('mSide'),yd:Math.max(1,Math.min(50,+v('mYd')||25)),down:+v('mDown'),togo:Math.max(1,+v('mTogo')||10),to:[Math.max(0,Math.min(3,+v('mTO0'))),Math.max(0,Math.min(3,+v('mTO1')))],recv:+v('mRecv'),n:Math.max(200,Math.min(20000,+v('mN')||10000)),out:f.out||[],keepIn:f.keepIn||[],blend:cb('mBlend',true),autoInj:cb('mAutoInj',true)};
}
function buildStart(F){
  const P=ST.players, T=ST.teams, n=P.length; const m=/^(\d{1,2}):?(\d{2})?$/.exec(String(F.clk).trim()); const c=m?(+m[1])*60+(+(m[2]||0)):900;
  const half=F.q<=2?1:F.q<=4?2:3; const clock=half===3?Math.min(600,c):(F.q===1||F.q===3?900+Math.min(900,c):Math.min(900,c));
  const Z={half,clock,to:F.to.slice(),score:[F.s0,F.s1],recvFirst:F.recv,out:Array.from(effectiveOut(F))};
  if(F.pos[0]==='k'){ Z.phase=1; Z.kicker=+F.pos[1]; } else { const off=+F.pos[1]; Z.phase=0; Z.off=off; Z.yl=F.yd>=50?50:(F.side===off?100-F.yd:F.yd); Z.down=F.down; Z.togo=Math.min(F.togo,Z.yl); }
  const LV=ST.live; const z=()=>new Array(n).fill(0);
  if(LV&&LV.st){ const B={pY:z(),pTD:z(),pInt:z(),rY:z(),rTD:z(),rec:z(),recY:z(),recTD:z(),fl:z(),two:z(),ret:z(),kp:z(),rA:z(),tg:z(),pA:z(),pC:z()};
    P.forEach((p,j)=>{ const s=LV.st[j]; if(p.pos==='K'){ B.kp[j]=s.kpts||0; return; } if(p.pos==='DST') return;
      B.pY[j]=s.py; B.pTD[j]=s.ptd; B.pInt[j]=s.pint; B.rY[j]=s.ry; B.rTD[j]=s.rtd; B.rec[j]=s.rec; B.recY[j]=s.recy; B.recTD[j]=s.rectd; B.fl[j]=s.fl; B.two[j]=s.two; B.ret[j]=s.ret; B.rA[j]=s.ra; B.tg[j]=s.tg; B.pA[j]=s.pa; B.pC[j]=s.pc; });
    Z.buf=B; Z.dst=[0,1].map(t=>{ const d=P.findIndex(p=>p.pos==='DST'&&p.team===T[t]); const s=d>=0&&LV.st[d].dst; return s?{sk:s.sk,int:s.it,fr:s.fr,td:s.td,sf:s.sf||0,blk:s.blk||0,paX:s.paX||0}:{}; }); }
  else if(LV){ const add=z(), kp=z(); P.forEach((p,j)=>{ if(p.pos==='K') kp[j]=LV.pts[j]; else if(p.pos!=='DST') add[j]=LV.pts[j]; });
    [0,1].forEach(t=>{ const d=P.findIndex(p=>p.pos==='DST'&&p.team===T[t]); if(d<0) return; const pa=Z.score[1-t]; const tier=pa===0?10:pa<=6?7:pa<=13?4:pa<=20?1:pa<=27?0:pa<=34?-1:-4; add[d]=LV.pts[d]-tier; });
    Z.buf={kp}; Z.add=add; }
  return Z;
}
async function runMid(){
  if(!ST.res||ST.midBusy) return; const st=$('#mStatus'); const btn=$('#mGo'); ST.midBusy=true; if(btn) btn.disabled=true;
  try{
    makeWorkers(); const F=readMidForm(); ST.midForm=F; const start=buildStart(F); const N=F.n; const s=ST.res.cal.s;
    const BU=F.blend!==false?blendUsage(F):null; const slate=BU?Object.assign({},ST.res.slate,{players:BU.players}):ST.res.slate;
    if(BU){ start.srMul=BU.srMul; start.stMul=BU.stMul; }
    const elig=slate.players.map((p,i)=>i).filter(i=>slate.players[i].active&&slate.players[i].salF>0);
    const tb=ST.res.slate.players.map(p=>(p.rs+p.ts)+(p.pos==='K'||p.pos==='DST'?0.1:0));
    st.textContent=`Simulating the rest of the game ${N.toLocaleString()} times…`;
    const per=Math.ceil(N/NW); const parts=(await Promise.all(workers.map((w,k)=>{const nn=Math.min(per,N-k*per); if(nn<=0) return null; return call(w,{type:'sim',slate,s,n:nn,seed:(Date.now()+k*104729)>>>0,eligible:elig,tb,start});}))).filter(Boolean);
    const n=slate.players.length; let NN=0; parts.forEach(p=>NN+=p.n); const pts=new Float32Array(NN*n), sc=new Float32Array(NN*2); let o=0;
    for(const p of parts){ pts.set(p.pts,o*n); for(let i=0;i<p.n;i++){ sc[(o+i)*2]=p.sm[i*8]; sc[(o+i)*2+1]=p.sm[i*8+1]; } o+=p.n; }
    st.textContent='Ranking every contest in every sim…'; await new Promise(r=>setTimeout(r,0));
    const res=await scoreContestsMid(pts,NN,n,(d)=>{st.textContent=`Ranking every contest in every sim… ${Math.round(100*d)}%`;});
    ST.mid={N:NN,n,pts,sc,F,at:new Date(),...res}; const nOut=start.out.length;
    st.textContent=`${NN.toLocaleString()} sims from ${F.q===5?'OT':'Q'+F.q} ${F.clk}, ${ST.teams[0]} ${F.s0} - ${ST.teams[1]} ${F.s1}${BU?' · tonight\'s usage blended in':''}${nOut?` · ${nOut} player${nOut>1?'s':''} out`:''}`;
    renderMidOut();
  }catch(e){ console.error(e); st.textContent='Sim failed: '+e.message; }
  ST.midBusy=false; if($('#mGo')) $('#mGo').disabled=false;
}
async function scoreContestsMid(pts,N,n,prog){
  const W=0.1, NB=4000, CW=20, NC=NB/CW; const tot$=new Float64Array(N);
  const Cs=[]; for(const V of (ST.levs?ST.levs.values():[])){ const mine=levMine(V); if(!mine.length) continue; const pay=payFor(V); const meta=levMeta(V);
    const m=new Map(); for(const x of V.L){ const k=levKey(x); let u=m.get(k); if(!u){u={cpt:x.cpt,fl:x.fl,c:0,my:0}; m.set(k,u);} u.c++; } mine.forEach(x=>m.get(levKey(x)).my++);
    const U=Array.from(m.values()); const nu=U.length; const cpt=new Int32Array(nu), fl=new Int32Array(nu*5), cnt=new Float64Array(nu); const myU=[];
    U.forEach((u,i)=>{cpt[i]=u.cpt; for(let k=0;k<5;k++) fl[i*5+k]=u.fl[k]; cnt[i]=u.c; if(u.my) myU.push(i);});
    Cs.push({V,meta,pay,U,nu,cpt,fl,cnt,myU,myN:Float64Array.from(myU,i=>U[i].my),Pd:pay?pay.Pd:Math.round(V.total*0.22),scale:V.total/V.L.length,
      ev:0,p1:0,p1t:0,pc:0,ncash:0,bestR:new Float64Array(N),uev:new Float64Array(myU.length),ucash:new Float64Array(myU.length),u1:new Float64Array(myU.length)}); }
  const hist=new Float64Array(NB), coarse=new Float64Array(NC), above=new Float64Array(NC+1), s=new Float64Array(Cs.reduce((a,c)=>Math.max(a,c.nu),0)), bins=new Int32Array(s.length);
  for(let i=0;i<N;i++){ const o=i*n;
    for(const C of Cs){ const {nu,cpt,fl,cnt}=C;
      for(let u=0;u<nu;u++){ const f=u*5; const v=1.5*pts[o+cpt[u]]+pts[o+fl[f]]+pts[o+fl[f+1]]+pts[o+fl[f+2]]+pts[o+fl[f+3]]+pts[o+fl[f+4]]; s[u]=v; let b=Math.floor(v/W); b=b<0?0:b>=NB?NB-1:b; bins[u]=b; hist[b]+=cnt[u]; coarse[(b/CW)|0]+=cnt[u]; }
      above[NC-1]=0; for(let k=NC-2;k>=0;k--) above[k]=above[k+1]+coarse[k+1];
      let any1=0, any1t=0, anyC=0, best=1e12;
      for(let q=0;q<C.myU.length;q++){ const u=C.myU[q]; const b=bins[u]; const cb=(b/CW)|0; let a=above[cb]; for(let bb=cb*CW+CW-1;bb>b;bb--) a+=hist[bb]; a+=0.5*(hist[b]-cnt[u]);
        a*=C.scale; const t=cnt[u]; const rank=a+1; if(rank<best) best=rank;
        const won=C.pay?C.pay.avg(a+1,a+t)*C.myN[q]:0; C.uev[q]+=won; C.ev+=won; tot$[i]+=won;
        if(rank<=C.Pd){ C.ucash[q]++; anyC=1; C.ncash+=C.myN[q]; } if(a<0.5){ any1t=1; if(a===0&&t<=C.myN[q]){ C.u1[q]++; any1=1; } } } // first = nobody else's lineup at or above yours; ties with field duplicates count only in p1t
      C.p1+=any1; C.p1t+=any1t; C.pc+=anyC; C.bestR[i]=best;
      for(let u=0;u<nu;u++){ const b=bins[u]; hist[b]=0; coarse[(b/CW)|0]=0; } }
    if(i%50===49){ prog((i+1)/N); await new Promise(r=>setTimeout(r,0)); } }
  return {Cs,tot$};
}
function renderMidOut(){
  const el=$('#midOut'); if(!el) return; const M=ST.mid; if(!M){ el.innerHTML=''; return; }
  const P=ST.players, T=ST.teams, N=M.N, n=M.n; let w0=0,tie=0,m0=0,m1=0; for(let i=0;i<N;i++){const a=M.sc[i*2],b=M.sc[i*2+1]; m0+=a; m1+=b; if(a>b) w0++; else if(a===b) tie++;}
  const LV=ST.live; const cur=LV?LV.pts:new Float64Array(P.length);
  const col=(j)=>{const c=new Float32Array(N); for(let i=0;i<N;i++) c[i]=M.pts[i*n+j]; return c;};
  const pstat=(j)=>{const c=col(j); const sorted=Float32Array.from(c).sort(); const q=(x)=>sorted[Math.min(N-1,Math.round(x*(N-1)))]; let s=0; for(const v of c) s+=v; return {j,c,mean:s/N,p10:q(.1),p50:q(.5),p90:q(.9),q25:q(.25),q75:q(.75)};};
  const prow=P.map((p,j)=>j).filter(j=>P[j].active&&(ST.res.stats[j].mean>=1||cur[j])).map(pstat).sort((a,b)=>b.mean-a.mean);
  // contest outcomes
  const Cs=M.Cs; const ev=Cs.reduce((a,C)=>a+C.ev/N,0), fees=Cs.reduce((a,C)=>a+(C.meta.fee||0)*C.myN.reduce((x,y)=>x+y,0),0); const anyPay=Cs.some(C=>C.pay);
  const sgn=(v)=>`${v>=0?'+':'-'}$${Math.abs(v).toFixed(2)}`, roi=(w,f)=>f?`${w>=f?'+':''}${((w/f-1)*100).toFixed(0)}%`:'-', col$=(v)=>`color:var(${v>=0?'--good':'--bad'});font-weight:600`;
  // profit distribution across sims: total winnings in that sim minus all fees in loaded contests
  const prof=Float64Array.from(M.tot$,x=>x-fees).sort(); const pq=(x)=>prof[Math.min(N-1,Math.max(0,Math.round(x*(N-1))))]; let pUp=0; for(const v of prof) if(v>0) pUp++;
  const crow=Cs.map(C=>{ const br=Float64Array.from(C.bestR).sort(); return `<tr><td class="small" style="white-space:normal">${esc(C.meta.label)}</td><td class="n">${C.V.total.toLocaleString()}</td><td class="n">${C.myN.reduce((a,b)=>a+b,0)}</td><td class="n">${pct(C.p1/N,1)}${C.p1t>C.p1?`<span class="small muted" title="Including ties for first with other people's identical lineups (the prize is split)"> (${pct(C.p1t/N,1)} tied)</span>`:''}</td><td class="n">${pct(C.pc/N,0)}</td><td class="n">${fmt(C.ncash/N,1)}</td><td class="n">${Math.round(br[Math.floor(N/2)]).toLocaleString()}</td><td class="n">${C.meta.fee!=null?'$'+(C.meta.fee*C.myN.reduce((a,b)=>a+b,0)).toFixed(2):'-'}</td><td class="n">${C.pay?`<b>$${(C.ev/N).toFixed(2)}</b>${C.pay.real?'':' <span class="small muted">proj</span>'}`:'-'}</td>${(()=>{ const f=(C.meta.fee||0)*C.myN.reduce((a,b)=>a+b,0), w=C.ev/N; return C.pay?`<td class="n" style="${col$(w-f)}">${sgn(w-f)}</td><td class="n">${roi(w,f)}</td>`:'<td class="n">-</td><td class="n">-</td>'; })()}</tr>`; }).join('');
  // lineups by expected winnings (summed across contests)
  const LU=new Map(); Cs.forEach(C=>C.myU.forEach((u,q)=>{ const x=C.U[u]; const L=[x.cpt,...x.fl]; const k=E.lineupKey(L); if(!LU.has(k)) LU.set(k,{L,ev:0,cs:[]}); const o=LU.get(k); o.ev+=C.uev[q]/N; o.cs.push({label:C.meta.label,fee:C.meta.fee||0,n:C.myN[q],cash:C.ucash[q]/N,w1:C.u1[q]/N}); }));
  const lus=Array.from(LU.values()).map(o=>({...o,cur:1.5*cur[o.L[0]]+o.L.slice(1).reduce((a,j)=>a+cur[j],0)})).sort((a,b)=>b.ev-a.ev||b.cs.reduce((x,c)=>x+c.cash,0)-a.cs.reduce((x,c)=>x+c.cash,0));
  // root for: expected total winnings when the player finishes in his top quarter vs bottom quarter of outcomes
  // Swing from an OLS fit across every sim with capped winnings. Only hidden: under 3% for both you and the field and still at 0 points.
  let root=[], capped=true, pFirst=0; if(Cs.length){
    const myX=new Float64Array(n), fdX=new Float64Array(n); let wSum=0, myTot=0;
    Cs.forEach(C=>{ const w=Math.max(0.01,C.meta.fee||1)*C.myN.reduce((x,y)=>x+y,0); wSum+=w; const nF=C.V.L.length;
      C.U.forEach(u=>{ fdX[u.cpt]+=w*u.c/nF; u.fl.forEach(j=>fdX[j]+=w*u.c/nF); });
      C.myU.forEach((u,q)=>{ const x=C.U[u]; myX[x.cpt]+=C.myN[q]; x.fl.forEach(j=>myX[j]+=C.myN[q]); myTot+=C.myN[q]; }); });
    const srt=Float64Array.from(M.tot$).sort();
    // cap only while first place is rare (noise); once any entry wins in 2%+ of sims, winning is the signal and must count in full
    pFirst=1-Cs.reduce((a,C)=>a*(1-C.p1/N),1); capped=pFirst<0.02; const cap=capped?srt[Math.min(N-1,Math.floor(0.99*N))]:Infinity; const T$=Float64Array.from(M.tot$,x=>Math.min(x,cap));
    let mt=0; for(let i=0;i<N;i++) mt+=T$[i]; mt/=N; let vt=0; for(let i=0;i<N;i++) vt+=(T$[i]-mt)*(T$[i]-mt); vt/=N;
    // OLS slope of capped winnings on the player's final points (uses every sim), scaled to the gap between his top- and bottom-quarter outcomes
    const allP=P.map((p,j)=>j).filter(j=>P[j].active).map(j=>prow.find(r=>r.j===j)||pstat(j));
    root=allP.map(r=>{ let mx=0; for(let i=0;i<N;i++) mx+=r.c[i]; mx/=N; let sxy=0,sxx=0,hi=0,nh=0,lo=0,nl=0;
      for(let i=0;i<N;i++){ const dx=r.c[i]-mx; sxy+=dx*(T$[i]-mt); sxx+=dx*dx; if(r.c[i]>=r.q75){hi+=r.c[i];nh++;} if(r.c[i]<=r.q25){lo+=r.c[i];nl++;} }
      const b=sxx?sxy/sxx:0, gap=(nh?hi/nh:0)-(nl?lo/nl:0); const res=Math.max(0,vt-b*b*sxx/N); const seb=sxx?Math.sqrt(res/sxx):0;
      return {...r,sw:b*gap,se:seb*gap,my:myTot?myX[r.j]/myTot:0,fd:wSum?fdX[r.j]/wSum:0}; })
      .filter(r=>!(r.my<0.03&&r.fd<0.03&&!cur[r.j])&&r.sw!==0).sort((a,b)=>b.sw-a.sw); }
  const rootTab=(arr,h)=>`<div><h3 style="font-size:15px">${h}</h3><table><thead><tr><th>Player</th><th class="n">Now</th><th class="n">Proj final</th><th class="n">You</th><th class="n">Field</th><th class="n">${anyPay?'$ swing':'Swing'}</th></tr></thead><tbody>${arr.length?'':'<tr><td colspan="6" class="small muted">Nobody clears the bar yet.</td></tr>'}${arr.map(r=>`<tr><td><span class="tm ${teamIdx(P[r.j])?'b':'a'}"></span><button class="plink" data-pc="${r.j}">${esc(P[r.j].name)}</button><span class="pos">${P[r.j].pos}</span></td><td class="n">${fmt(cur[r.j],1)}</td><td class="n">${fmt(r.mean,1)}</td><td class="n">${pct(r.my,0)}</td><td class="n">${pct(r.fd,0)}</td><td class="n" style="color:var(${r.sw>=0?'--good':'--bad'});font-weight:600">${r.sw>=0?'+':'-'}$${Math.abs(r.sw).toFixed(2)}</td></tr>`).join('')}</tbody></table></div>`;
  el.innerHTML=`<div class="pc-tiles"><div><span class="lbl">${T[0]} win</span><b class="num">${pct((w0+tie/2)/N,0)}</b></div><div><span class="lbl">${T[1]} win</span><b class="num">${pct(1-(w0+tie/2)/N,0)}</b></div><div><span class="lbl">Proj final</span><b class="num">${fmt(m0/N,1)} - ${fmt(m1/N,1)}</b></div>
      ${Cs.length?`<div><span class="lbl">Entry fees</span><b class="num">${fees?'$'+fees.toFixed(2):'-'}</b></div><div><span class="lbl">Expected winnings</span><b class="num">${anyPay?'$'+ev.toFixed(2):'-'}</b></div>
      ${anyPay?`<div><span class="lbl">Exp. profit after fees</span><b class="num" style="${col$(ev-fees)}">${sgn(ev-fees)}</b></div><div><span class="lbl">ROI</span><b class="num" style="${col$(ev-fees)}">${roi(ev,fees)}</b></div><div><span class="lbl">Chance of profit</span><b class="num">${pct(pUp/N,0)}</b></div><div><span class="lbl">Profit p10 / p50 / p90</span><b class="num">${sgn(pq(.1))} / ${sgn(pq(.5))} / ${sgn(pq(.9))}</b></div>`:''}<div><span class="lbl">Any entry first</span><b class="num">${pct(1-Cs.reduce((a,C)=>a*(1-C.p1/N),1),1)}</b><span class="small muted">${pct(1-Cs.reduce((a,C)=>a*(1-C.p1t/N),1),1)} incl. ties</span></div>`:''}</div>
    ${Cs.length?`<div class="card" style="margin-top:12px"><h3>Contests from here</h3><p class="small muted">Each sim's final points re-rank the full field from your standings files. P(1st) and P(cash) are for any of your entries in that contest.</p><div class="tw" style="border:0"><table><thead><tr><th>Contest</th><th class="n">Field</th><th class="n">Yours</th><th class="n">P(1st)</th><th class="n">P(cash)</th><th class="n">Avg cashing</th><th class="n">Median best rank</th><th class="n">Fees</th><th class="n">Exp. winnings</th><th class="n">Exp. profit</th><th class="n">ROI</th></tr></thead><tbody>${crow}
      ${Cs.length>1&&anyPay?`<tr><td><b>Total</b></td><td></td><td class="n"><b>${Cs.reduce((a,C)=>a+C.myN.reduce((x,y)=>x+y,0),0)}</b></td><td></td><td></td><td></td><td></td><td class="n"><b>$${fees.toFixed(2)}</b></td><td class="n"><b>$${ev.toFixed(2)}</b></td><td class="n" style="${col$(ev-fees)}">${sgn(ev-fees)}</td><td class="n"><b>${roi(ev,fees)}</b></td></tr>`:''}</tbody></table></div></div>
    <div class="card" style="margin-top:12px"><h3>Who to root for</h3><p class="small muted">Your expected total winnings when the player lands in his top quarter of outcomes from here, minus when he lands in his bottom quarter. Swing is fit across every sim, then scaled to his top-quarter minus bottom-quarter outcome; ${capped?'winnings are capped at the 99th percentile sim so one rare first-place finish does not drive it':'winnings are not capped because one of your entries wins its contest in '+pct(pFirst,1)+' of sims, so those wins count in full'}. Hidden: players under 3% for both you and the field who have not scored yet.</p><div class="grid2">${rootTab(root.filter(r=>r.sw>0).slice(0,10),'Root for')}${rootTab(root.filter(r=>r.sw<0).slice(-10).reverse(),'Root against')}</div></div>
    <div class="card" style="margin-top:12px"><h3>Your lineups from here</h3><div class="tw" style="border:0;max-height:520px;overflow:auto"><table><thead><tr><th class="n">Now</th><th class="n">Fees</th><th class="n">Exp. winnings</th><th class="n">Exp. profit</th><th>Captain</th><th>Flex</th><th>Contests (P cash · P 1st)</th></tr></thead><tbody>
      ${lus.slice(0,80).map(o=>`<tr><td class="n">${fmt(o.cur,1)}</td>${(()=>{ const f=o.cs.reduce((x,c)=>x+c.fee*c.n,0); return `<td class="n">$${f.toFixed(2)}</td><td class="n"><b>${anyPay?'$'+o.ev.toFixed(2):'-'}</b></td><td class="n" style="${anyPay?col$(o.ev-f):''}">${anyPay?sgn(o.ev-f):'-'}</td>`; })()}<td><button class="cptc plink" data-pc="${o.L[0]}">${esc(P[o.L[0]].name)}</button></td><td class="small">${o.L.slice(1).map(j=>esc(P[j].name)).join(' · ')}</td><td class="small" style="white-space:normal">${o.cs.sort((a,b)=>b.fee-a.fee).map(c=>`${esc(c.label)}${c.n>1?` ×${c.n}`:''}: ${pct(c.cash,0)} · ${pct(c.w1,1)}`).join('<br>')}</td></tr>`).join('')}</tbody></table></div></div>`
    :'<p class="note" style="margin-top:12px">Load contest-standings files on the Leverage tab to get contest odds, expected winnings and who to root for.</p>'}
    <div class="card" style="margin-top:12px"><h3>Player finals from here</h3><div class="tw" style="border:0"><table><thead><tr><th>Player</th><th class="n">Now</th><th class="n">Mean</th><th class="n">p10</th><th class="n">p50</th><th class="n">p90</th><th class="n">CPT mean</th></tr></thead><tbody>
      ${prow.map(r=>`<tr><td><span class="tm ${teamIdx(P[r.j])?'b':'a'}"></span><button class="plink" data-pc="${r.j}">${esc(P[r.j].name)}</button><span class="pos">${P[r.j].pos}</span></td><td class="n">${fmt(cur[r.j],1)}</td><td class="n"><b>${fmt(r.mean,1)}</b></td><td class="n">${fmt(r.p10,1)}</td><td class="n">${fmt(r.p50,1)}</td><td class="n">${fmt(r.p90,1)}</td><td class="n">${fmt(r.mean*1.5,1)}</td></tr>`).join('')}</tbody></table></div></div>`;
}
function renderLiveTab(){
  const el=$('#pane-live'); if(el.dataset.ready){ renderLive(); if(!ST.live) renderMidCard(); return; } el.dataset.ready='1';
  el.innerHTML=`<div class="card"><div class="row"><button class="primary" id="liveGo">Pull live stats (ESPN)</button><label class="small"><input type="checkbox" id="liveAuto"> Refresh every 60 seconds</label><button id="liveDK">Use DraftKings points from contest standings</button><span id="liveStatus" class="small muted"></span></div>
    <p class="small muted">ESPN's public game summary supplies the box score, team stats, play text and game situation; DK points are calculated from it. The claude.ai viewer blocks outside requests, so ESPN pulls work in the downloaded HTML. In either place you can use the exact DraftKings FPTS from your newest contest-standings file (download fresh standings during the game for current points) and type the game state below.</p></div>
    <div id="liveOut" style="margin-top:16px"></div><div class="card" id="midCard" style="margin-top:16px"></div>`;
  $('#liveGo').onclick=pullLive;
  $('#liveAuto').onchange=(e)=>{ clearInterval(ST.liveTimer); if(e.target.checked){ pullLive(); ST.liveTimer=setInterval(pullLive,60000); } };
  $('#liveDK').onclick=()=>{ const d=dkFromStandings(); if(!d){ $('#liveStatus').textContent='Load a contest-standings file on the Leverage tab first.'; return; } ST.live=d; $('#liveStatus').textContent=''; renderLive(); };
  renderLive(); if(!ST.live) renderMidCard();
}

/* ---------------- model tab ---------------- */
function renderModel(){
  const L=MODEL.league, el=$('#pane-model'), bt=MODEL.meta.backtest||{};
  const TOGO=['1','2','3','4','5','6','7','8','9','10'];
  let heat='<div class="tw"><table class="heat"><thead><tr><th>To go</th>';
  const yls=[]; for(let yi=19;yi>=0;yi--) yls.push(yi);
  heat+=yls.map(yi=>{const y=yi*5+3; return `<th class="n" style="padding:4px">${y>50?'Own '+(100-y):y===50?'50':'Opp '+y}</th>`;}).join('')+'</tr></thead><tbody>';
  TOGO.forEach((tg,ti)=>{heat+=`<tr><td><b>${tg}</b></td>`+yls.map(yi=>{const g=L.fourthGrid[((ti*20+yi)*9+4)*9+0]; const go=g[0]/1000, pu=g[1]/1000, fg=1-go-pu;
    const bg=`color-mix(in srgb, var(--accent) ${Math.round(go*100)}%, var(--panel))`; return `<td style="background:${bg};color:${go>0.55?'var(--accent-ink)':'var(--ink)'}" title="Go ${pct(go,0)} · Punt ${pct(pu,0)} · FG ${pct(fg,0)}">${Math.round(go*100)}</td>`;}).join('')+'</tr>';});
  heat+='</tbody></table></div>';
  const fgp=(d)=>1/(1+Math.exp(-(L.fg.b0+L.fg.b1*d+L.fg.b2*d*d)));
  const n=MODEL.meta.notes||{};
  const btRows=(bt.team||[]).map(r=>`<tr><td>${esc(r[0])}</td><td class="n">${fmt(r[1],2)}</td><td class="n">${fmt(r[2],2)}</td><td class="n">${fmt(r[3],2)}</td><td class="n">${fmt(r[4],2)}</td></tr>`).join('');
  const posRows=(bt.pos||[]).map(r=>`<tr><td>${esc(r[0])}</td><td class="n">${r[1]}</td><td class="n">${fmt(r[2],2)}</td><td class="n">${fmt(r[3],2)}</td><td class="n">${fmt(r[4],3)}</td><td class="n">${pct(r[5],1)}</td></tr>`).join('');
  el.innerHTML=`<div class="grid2"><div class="card"><h3>How a sim runs</h3><p class="note small">Every sim plays a full game snap by snap from nflfastR play-by-play (2024, 2025, 2026 through week 4). Each snap: kneel or end-of-half checks, then the 4th-down decision, then pass or run from a gradient-boosted model of down, distance, field position, score and clock (log loss 0.527 on held-out 2026 plays vs 0.529 for nflfastR's own xpass). Then penalties, sacks, scrambles, throwaways and interceptions, then the ball carrier or target picked from usage shares (red-zone shares inside the 10). Yardage is drawn from real play outcomes for that player blended with his position's outcomes for that part of the field. Fumbles, return TDs, injuries that knock a player out (backup QB takes over), starters resting in blowouts, timeouts, the two-minute warning, onside kicks and 10-minute regular-season OT where both teams get the ball are all simulated. Before the main run, each offense's efficiency is calibrated so its average points match your implied total. The opposing defense also shapes each snap: how much more or less offenses pass against it this season, and the yards per carry it allows, both opponent-adjusted, current season only and shrunk for sample size (the chips on Slate inputs show the values). Points still match the implied total; the funnel moves the run/pass mix and the RB vs WR split.</p></div>
    <div class="card"><h3>Backtest on games the model had not seen</h3><p class="note small">${esc(bt.desc||'')}</p>
    <div class="tw" style="border:0"><table><thead><tr><th>Team stat per game</th><th class="n">Sim avg</th><th class="n">Actual avg</th><th class="n">Sim SD</th><th class="n">Actual SD vs sim</th></tr></thead><tbody>${btRows}</tbody></table></div>
    <div class="tw" style="border:0;margin-top:10px"><table><thead><tr><th>Position</th><th class="n">Player-games</th><th class="n">Proj avg</th><th class="n">Actual avg</th><th class="n">Corr</th><th class="n">In 10-90 band</th></tr></thead><tbody>${posRows}</tbody></table></div></div></div>
    <div class="card" style="margin-top:16px"><h3>4th-down go rate by distance and field position</h3><p class="small muted">Tied game, first three quarters, learned from 2024-2026 play-by-play (2026 weighted highest). Hover a cell for punt and FG rates. Team aggression adjustments apply on top, heavily shrunk because team go rates showed little stability (split-half reliability 0.12).</p>${heat}</div>
    <div class="grid3" style="margin-top:16px">
      <div class="card"><h3>Field goals</h3><div class="kv">${[30,35,40,45,50,55,60].map(d=>`<div>${d} yds</div><div class="num">${pct(fgp(d),0)}</div>`).join('')}<div>Blocked</div><div class="num">${pct(L.fg.blk,1)}</div><div>Extra point</div><div class="num">${pct(L.xp,1)}</div><div>2-pt success</div><div class="num">${pct(L.twoPt.succ,0)}</div></div><p class="small muted">Logistic fit on 2024-2026 kicks, plus a per-kicker adjustment shrunk toward league average.</p></div>
      <div class="card"><h3>Penalties</h3><div class="kv">${[1,2,3,4].map(d=>`<div>Down ${d}</div><div class="num">${pct(L.penRateDown[d],1)} of snaps</div>`).join('')}<div>Live-ball add-ons</div><div class="num">${pct(L.livePenRate,1)} of snaps</div></div><p class="small muted">${esc(n.penalties||'')}</p></div>
      <div class="card"><h3>In-game injuries</h3><div class="kv">${Object.entries(L.inj).map(([k,v])=>`<div>${k}</div><div class="num">${pct(v,1)} per game</div>`).join('')}</div><p class="small muted">Rate at which a regular (70%+ snaps in recent games) left a game early and missed the next one, from 2024-2026 snap counts. The exiting player's work moves to active teammates; a QB exit hands the offense to the backup.</p></div>
      <div class="card"><h3>Usage blending</h3><p class="small muted">Backtest of predicting next-game shares: rush shares weight each prior game 0.88× per week back with prior seasons at 0.25×; target shares 0.93× per week with prior seasons at 0.40×. Efficiency is mostly regressed to position: own yards-per-carry gets weight n/(n+217) carries, yards-per-target n/(n+62) targets.</p></div>
      <div class="card"><h3>DST vs opponent implied total</h3>${bt.dst?`<table><thead><tr><th>Opp implied</th><th class="n">Actual DK avg</th><th class="n">Games</th></tr></thead><tbody>${bt.dst.actual.map(r=>`<tr><td>${r[0]}</td><td class="n">${fmt(r[1],2)}</td><td class="n">${r[2]}</td></tr>`).join('')}</tbody></table>
        <p class="small muted" style="margin-top:8px">All 2024-2026 regular-season DSTs, bucketed by the opponent's closing implied total. Backtest sim vs actual:</p>
        <table><thead><tr><th>Opp implied</th><th class="n">Sim</th><th class="n">Actual</th><th class="n">n</th></tr></thead><tbody>${bt.dst.bt.map(r=>`<tr><td>${r[0]}</td><td class="n">${fmt(r[1],2)}</td><td class="n">${fmt(r[2],2)}</td><td class="n">${r[3]}</td></tr>`).join('')}</tbody></table>`:''}</div>
      <div class="card"><h3>Roles and rotation</h3><p class="small muted">Shares come from competitive game states only; garbage time is handled separately by flattening RB usage and rotating in backups. Each share is shrunk toward the typical share for the player's depth-chart rank among tonight's actives (k = 1 game for runs, 2 for targets), which cut share-prediction error 6 to 7%. Short-yardage (3rd/4th and 2 or less) run shares are role-specific because they predicted better than overall shares (k = 8 plays). Pass-down target shares are role-specific for RBs only (k = 30); for WRs and TEs the overall share predicted better. RBs rotate by series: each drive picks a lead back with probability proportional to run share raised to the 1.75 power, so lead duty concentrates on the top backs, and he gets 50% of that drive's carries outright. The rest of the drive's carries are spread so every back keeps his expected share, which means deep backups get scattered carries instead of whole drives. Both values are maximum-likelihood fits on 5,775 real drives (2024-26). Reweighting past games by how closely their active roster matched the target game was tested and made predictions worse, so injuries are handled by proportional redistribution plus the depth-rank prior.</p></div>
      <div class="card"><h3>Tuned from the backtest</h3><p class="small muted">Per-sim randomness for team strength, game plan pass rate, pace and player role (role spread 0.5 log-sd), plus small corrections to pass rate, sacks, interceptions and FG attempts, set so simulated ranges matched real outcomes.</p></div>
    </div>`;
}

/* ---------------- tabs & boot ---------------- */
function initTabs(){ $$('#tabs button').forEach(b=>b.onclick=()=>{ $$('#tabs button').forEach(x=>x.setAttribute('aria-selected',x===b)); $$('.pane').forEach(p=>p.hidden=p.id!=='pane-'+b.dataset.tab);
  const tb=b.dataset.tab; if(ST.res&&tb==='corr'&&!$('#pane-corr').innerHTML) renderCorr(); if(ST.res&&tb==='pbp'&&!$('#pane-pbp').innerHTML) renderPBP(); if(ST.res&&tb==='cash'&&!$('#pane-cash').innerHTML) renderCash(); if(ST.res&&tb==='game'&&!$('#pane-game').innerHTML) renderGame(); if(tb==='lev') renderLevTab(); if(tb==='live') renderLiveTab(); }); }
function boot(){
  initTabs(); renderModel();
  if(typeof SWEAT!=='undefined'&&SWEAT){ $('#runBtn').onclick=run; $('#pullLines').onclick=pullLines; bindWx(); sweatBoot(); return; } // standalone sweat page
  const fi=$('#file'), drop=$('#drop');
  fi.onchange=()=>{const f=fi.files[0]; if(!f) return; readUploadSafe(f).then(t=>{loadCSV(t,f.name); run();});};
  drop.onclick=(e)=>{if(e.target.tagName!=='INPUT') fi.click();};
  drop.ondragover=(e)=>{e.preventDefault();drop.classList.add('over');}; drop.ondragleave=()=>drop.classList.remove('over');
  drop.ondrop=(e)=>{e.preventDefault();drop.classList.remove('over');const f=e.dataTransfer.files[0]; if(f) readUploadSafe(f).then(t=>{loadCSV(t,f.name); run();});};
  $('#impA').oninput=$('#impB').oninput=()=>{updateLineNote(); markStale();};
  $('#vegas').onclick=()=>{if(!ST.line) return; const home=(ST.line[3]+ST.line[2])/2; $('#impA').value=+(ST.line[3]-home).toFixed(2); $('#impB').value=+home.toFixed(2); updateLineNote(); markStale();};
  $('#runBtn').onclick=run; $('#pullLines').onclick=pullLines; bindWx();
  const fo=$('#fileOwn'), dOwn=$('#dropOwn'); fo.onchange=()=>{const f=fo.files[0]; if(f) readUploadSafe(f).then(t=>loadOwnership(t,f.name));};
  dOwn.onclick=(e)=>{if(e.target.tagName!=='INPUT') fo.click();}; dOwn.ondragover=(e)=>{e.preventDefault();dOwn.classList.add('over');}; dOwn.ondragleave=()=>dOwn.classList.remove('over');
  dOwn.ondrop=(e)=>{e.preventDefault();dOwn.classList.remove('over');const f=e.dataTransfer.files[0]; if(f) readUploadSafe(f).then(t=>loadOwnership(t,f.name));};
  loadCSV($('#sample-csv').textContent.trim(),'Example: DKSalaries.csv (TB @ DAL, Oct 8 2026)');
  $('#tabs button[data-tab=slate]').click();
  run();
}
boot();
})();
