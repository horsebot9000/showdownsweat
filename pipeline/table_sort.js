/* Click any column header to sort a table (tables that already have their own sorting are left alone).
   Numbers sort numerically ($, %, +, commas, "x of y" handled); rows marked as totals stay at the bottom;
   grouped tables (several tbody blocks, team header rows) sort within each group. Sorts survive re-renders. */
(function(){
  const SORTS=new Map(); // header signature -> {col, dir}
  const sig=(t)=>Array.from(t.tHead?t.tHead.rows[t.tHead.rows.length-1].cells:[]).map(c=>c.textContent.replace(/[▾▴]/g,'').trim()).join('|');
  const val=(cell)=>{ if(!cell) return {n:null,s:''}; const inp=cell.querySelector('input:not([type=checkbox]):not([type=radio]),select'); let s=(inp?inp.value:cell.textContent).trim();
    const m=/^[^\d\-+.]*([-+]?\$?-?[\d,]*\.?\d+)/.exec(s.replace(/−/g,'-')); if(m&&!/^[A-Za-z]{2,}/.test(s)){ const neg=/^-\$|^\$?-|^-/.test(s.replace(/^[+]/,'')); let n=parseFloat(m[1].replace(/[$,+]/g,'')); if(neg&&n>0) n=-n; return {n,s}; }
    return {n:null,s:s.toLowerCase()}; };
  const isTotal=(r)=>r.classList.contains('tot')||r.classList.contains('teamhead')||/^(total|all contests)\b/i.test((r.cells[0]&&r.cells[0].textContent||'').trim())&&r.cells.length>1;
  function apply(t,col,dir){
    const hdr=t.tHead.rows[t.tHead.rows.length-1]; Array.from(hdr.cells).forEach((c,i)=>{ c.dataset.gsort=i===col?(dir<0?'d':'a'):''; });
    for(const tb of t.tBodies){ const rows=Array.from(tb.rows); const top=rows.filter(r=>r.classList.contains('teamhead')), bot=rows.filter(r=>!r.classList.contains('teamhead')&&isTotal(r)), body=rows.filter(r=>!isTotal(r));
      const k=body.map(r=>({r,v:val(r.cells[col])})); k.sort((a,b)=>{ const x=a.v, y=b.v; if(x.n!=null&&y.n!=null) return dir*(x.n-y.n); if(x.n!=null) return -1; if(y.n!=null) return 1; return dir*(x.s<y.s?-1:x.s>y.s?1:0); });
      [...top,...k.map(o=>o.r),...bot].forEach(r=>tb.appendChild(r)); }
    t.dataset.gsorted='1'; }
  document.addEventListener('click',(ev)=>{ const th=ev.target.closest('thead th'); if(!th||ev.target.closest('input,select,button,a')) return; const t=th.closest('table'); if(!t||t.querySelector('thead th.sort')||t.classList.contains('nosort')) return;
    const hdr=t.tHead.rows[t.tHead.rows.length-1]; const col=Array.from(hdr.cells).indexOf(th); if(col<0) return;
    const key=sig(t); const cur=SORTS.get(key); const first=val(t.tBodies[0]&&Array.from(t.tBodies[0].rows).find(r=>!isTotal(r))?.cells[col]).n!=null;
    const dir=cur&&cur.col===col?-cur.dir:(first?-1:1); SORTS.set(key,{col,dir}); apply(t,col,dir); });
  /* freeze the identity column (Player / Contest / Captain ...) plus any narrow checkbox columns before it, so names stay visible when a wide table scrolls sideways */
  const ID=/^(player|name|contest|user|opponent|captain|cpt|lineup|game|entry)$/i;
  function freeze(t){ if(!t.tHead||t.classList.contains('cmx')||!t.offsetParent) return; const hdr=t.tHead.rows[t.tHead.rows.length-1]; const H=Array.from(hdr.cells);
    if(H.some(c=>c.colSpan>1)) return; let idx=H.findIndex(c=>ID.test(c.textContent.replace(/[▾▴]/g,'').trim()));
    if(idx<0){ const r=t.tBodies[0]&&Array.from(t.tBodies[0].rows).find(r=>r.cells.length===H.length); if(r) idx=Array.from(r.cells).findIndex(c=>c.querySelector('.pname')); }
    const w=t.closest('.tw'); if(idx<0||idx>3||!w||t.scrollWidth<=w.clientWidth+2){ if(t.dataset.fz){ t.querySelectorAll('.fz').forEach(c=>{c.classList.remove('fz','fzl'); c.style.left='';}); delete t.dataset.fz; } return; }
    const L=H.slice(0,idx+1).map(c=>c.offsetLeft); t.dataset.fz='1';
    const set=(c,k)=>{ c.classList.add('fz'); c.classList.toggle('fzl',k===idx); c.style.left=L[k]+'px'; };
    H.slice(0,idx+1).forEach(set);
    for(const tb of t.tBodies) for(const r of tb.rows){ let col=0; for(const c of r.cells){ if(col>idx) break; if(c.colSpan===1) set(c,col); else if(c.classList.contains('fz')){ c.classList.remove('fz','fzl'); c.style.left=''; } col+=c.colSpan; } } }
  let fpend=false; const freezeAll=()=>{ if(fpend) return; fpend=true; requestAnimationFrame(()=>{ fpend=false; document.querySelectorAll('.tw table').forEach(freeze); }); };
  window.addEventListener('resize',freezeAll); document.addEventListener('click',()=>setTimeout(freezeAll,0)); document.addEventListener('change',()=>setTimeout(freezeAll,0));
  let pend=false; new MutationObserver(()=>{ if(pend) return; pend=true; requestAnimationFrame(()=>{ pend=false;
    document.querySelectorAll('table').forEach(t=>{ if(t.dataset.gsorted||!t.tHead||t.querySelector('thead th.sort')) return; const s=SORTS.get(sig(t)); if(s) apply(t,s.col,s.dir); }); freezeAll(); }); }).observe(document.body,{childList:true,subtree:true});
})();
