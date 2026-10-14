/* Classic slate worker: calibrate each game, sim every game per slate-sim, solve each sim's optimal DK Classic lineup. */
/* DK Classic: QB, RB, RB, WR, WR, WR, TE, FLEX (RB/WR/TE), DST; $50,000 cap. pos codes: 0 QB, 1 RB, 2 WR, 3 TE, 4 DST, -1 not eligible */
function makeClassicOpt(o){
  const pos=o.pos, sal=o.sal, cap=o.cap||50000, nT=pos.length;
  const byPos=[[],[],[],[],[]]; for(let j=0;j<nT;j++) if(pos[j]>=0&&sal[j]>0) byPos[pos[j]].push(j);
  const K=o.K||[8,20,26,10,8], KV=o.KV||[3,8,10,4,3];
  const MX=o.MX||140, iv=new Int32Array(MX), iS=new Float64Array(MX), iP=new Int8Array(MX), iV=new Float64Array(MX), pre=new Float64Array(MX+1);
  const cur=new Int32Array(9), best=new Int32Array(9);
  // optional portfolio rules, checked on each complete lineup (keeps the search exact under the rules)
  const RU=o.rules, MT=o.meta; let chk=null;
  const FX=(RU&&RU.flex)||{RB:1,WR:1,TE:1}; const CAPP=[1,FX.RB?3:2,FX.WR?4:3,FX.TE?2:1,1];
  if(RU&&MT){ const tc=new Map(); chk=(L)=>{ let s=0; tc.clear(); const gs=new Set(); let q=-1, d=-1;
      for(let k=0;k<9;k++){ const j=L[k]; s+=sal[j]; tc.set(MT.team[j],(tc.get(MT.team[j])||0)+1); gs.add(MT.gi[j]); if(pos[j]===0) q=j; if(pos[j]===4) d=j; }
      if(s<RU.minSal||gs.size<2) return false; for(const v of tc.values()) if(v>RU.maxTeam) return false;
      if(q>=0){ const t=MT.team[q], op=MT.opp[q]; let n=0, bb=0; for(let k=0;k<9;k++){ const j=L[k]; if(j===q) continue; if(MT.team[j]===t&&(pos[j]===2||pos[j]===3)) n++; if(MT.team[j]===op&&pos[j]!==4) bb++; }
        if(n<RU.stack) return false; if(RU.bring==='req'&&!bb) return false; if(RU.bring==='none'&&bb) return false; }
      if(RU.maxGame<9||RU.gameStack>0){ const gc=new Map(); for(let k=0;k<9;k++){ const g=MT.gi[L[k]]; gc.set(g,(gc.get(g)||0)+1); } for(const v of gc.values()) if(v>RU.maxGame) return false; if(q>=0&&(gc.get(MT.gi[q])||0)<RU.gameStack) return false; }
      if(RU.noRBwithQB&&q>=0){ for(let k=0;k<9;k++){ const j=L[k]; if(pos[j]===1&&MT.team[j]===MT.team[q]) return false; } }
      if(RU.noVsDst&&d>=0){ const vs=MT.opp[d]; for(let k=0;k<9;k++){ const j=L[k]; if(pos[j]!==4&&MT.team[j]===vs) return false; } }
      return true; }; }
  return function(pts){
    // candidate pool: top by points plus top by points per dollar at each position
    let m=0; const seen=new Set();
    for(let c=0;c<5;c++){ const L=byPos[c]; const a=L.slice().sort((x,y)=>pts[y]-pts[x]); const b=L.slice().sort((x,y)=>pts[y]/sal[y]-pts[x]/sal[x]);
      for(let k=0;k<Math.min(K[c],a.length);k++) seen.add(a[k]); for(let k=0;k<Math.min(KV[c],b.length);k++) seen.add(b[k]); }
    const items=Array.from(seen).sort((x,y)=>pts[y]-pts[x]); m=Math.min(MX,items.length);
    let minS=1e9; for(let k=0;k<m;k++){ const j=items[k]; iv[k]=j; iS[k]=sal[j]; iP[k]=pos[j]; iV[k]=pts[j]; if(sal[j]<minS) minS=sal[j]; }
    pre[m]=0; for(let k=m-1;k>=0;k--) pre[k]=pre[k+1]+Math.max(0,iV[k]);
    let bestV=-1e9; const cnt=[0,0,0,0,0];
    // position lists (indices into items, already in points order) with prefix sums, and for each item index the first list slot at or after it
    const lst=[[],[],[],[],[]]; for(let k=0;k<m;k++) lst[iP[k]].push(k);
    const lpre=lst.map(l=>{ const p=new Float64Array(l.length+1); for(let k=0;k<l.length;k++) p[k+1]=p[k]+Math.max(0,iV[l[k]]); return p; });
    const from=lst.map(l=>{ const f=new Int32Array(m+1); let q=l.length; for(let k=m;k>=0;k--){ while(q>0&&l[q-1]>=k) q--; f[k]=q; } return f; });
    const tc=new Map(); let dstOpp=null;
    const bound=(i,r)=>{ // best possible remaining points given the slots still required at each position
      const nd=[1-cnt[0],Math.max(0,2-cnt[1]),Math.max(0,3-cnt[2]),Math.max(0,1-cnt[3]),1-cnt[4]]; let b=0, used=0;
      for(let c=0;c<5;c++){ if(!nd[c]) continue; const f=from[c][i], L=lst[c].length; if(f+nd[c]>L) return -1e9; b+=lpre[c][f+nd[c]]-lpre[c][f]; used+=nd[c]; }
      let fl=r-used; if(fl<0) return -1e9;
      if(fl>0){ const ptr=[0,from[1][i]+nd[1],from[2][i]+nd[2],from[3][i]+nd[3]]; const capc=[0,CAPP[1]-cnt[1]-nd[1],CAPP[2]-cnt[2]-nd[2],CAPP[3]-cnt[3]-nd[3]];
        while(fl>0){ let bc=-1,bv=-1e9; for(let c=1;c<=3;c++) if(capc[c]>0&&ptr[c]<lst[c].length){ const v=iV[lst[c][ptr[c]]]; if(v>bv){bv=v;bc=c;} } if(bc<0) return -1e9; b+=Math.max(0,bv); ptr[bc]++; capc[bc]--; fl--; } }
      return b; };
    const used=new Uint8Array(m);
    function dfs(i,k,s,v){
      if(i<m&&used[i]) return dfs(i+1,k,s,v);
      if(k===9){ if(cnt[0]===1&&cnt[4]===1&&cnt[1]>=2&&cnt[2]>=3&&cnt[3]>=1&&v>bestV&&(!chk||chk(cur))){ bestV=v; best.set(cur); } return; }
      const r=9-k; if(i>=m||m-i<r) return;
      if(s+r*minS>cap) return;
      if(v+bound(i,r)<=bestV) return;
      const c=iP[i]; const flex=cnt[1]+cnt[2]+cnt[3]; const j=iv[i];
      let ok=(c===0?cnt[0]<1:c===4?cnt[4]<1:(flex<7&&(c===1?cnt[1]<CAPP[1]:c===2?cnt[2]<CAPP[2]:cnt[3]<CAPP[3])))&&s+iS[i]<=cap;
      if(ok&&RU&&MT){ const t=MT.team[j]; if((tc.get(t)||0)+1>RU.maxTeam) ok=false;
        else if(RU.noVsDst){ if(c===4){ for(let q=0;q<k;q++) if(MT.team[cur[q]]===MT.opp[j]) { ok=false; break; } } else if(dstOpp!==null&&t===dstOpp) ok=false; } }
      if(ok){ cnt[c]++; cur[k]=j; let pd=dstOpp; if(RU&&MT){ tc.set(MT.team[j],(tc.get(MT.team[j])||0)+1); if(c===4) dstOpp=MT.opp[j]; }
        dfs(i+1,k+1,s+iS[i],v+iV[i]); cnt[c]--; if(RU&&MT){ tc.set(MT.team[j],tc.get(MT.team[j])-1); dstOpp=pd; } }
      dfs(i+1,k,s,v);
    }
    if(RU&&MT&&(RU.stack>0||RU.bring==='req')&&!o.slowStack){
      // QB-first: fix each QB and each set of required own pass catchers, then search the rest (exact; shared best bound prunes most branches)
      const put=(k2,j,sv)=>{ const c=iP[k2]; cnt[c]++; cur[sv]=iv[k2]; used[k2]=1; tc.set(MT.team[iv[k2]],(tc.get(MT.team[iv[k2]])||0)+1); };
      const take=(k2)=>{ const c=iP[k2]; cnt[c]--; used[k2]=0; tc.set(MT.team[iv[k2]],tc.get(MT.team[iv[k2]])-1); };
      for(const qk of lst[0]){ const t=MT.team[iv[qk]]; const own=[]; for(let k2=0;k2<m;k2++) if((iP[k2]===2||iP[k2]===3)&&MT.team[iv[k2]]===t) own.push(k2); if(own.length<RU.stack) continue;
        const opp=[]; if(RU.bring==='req'){ const op=MT.opp[iv[qk]]; for(let k2=0;k2<m&&opp.length<10;k2++) if(iP[k2]>=1&&iP[k2]<=3&&MT.team[iv[k2]]===op) opp.push(k2); }
        const run=(ks)=>{ let sv=0, vv=0; ks.forEach((k2,x)=>{ put(k2,0,x); sv+=iS[k2]; vv+=iV[k2]; });
            const fx=cnt[1]+cnt[2]+cnt[3]; if(sv<=cap&&cnt[1]<=CAPP[1]&&cnt[2]<=CAPP[2]&&cnt[3]<=CAPP[3]&&fx<=7) dfs(0,ks.length,sv,vv); ks.forEach(take); };
        const combo=(start,need,acc)=>{ if(need===0){ if(RU.bring==='req'){ for(const b of opp) run([qk,...acc,b]); } else run([qk,...acc]); return; }
          for(let x=start;x<=own.length-need;x++){ combo(x+1,need-1,acc.concat(own[x])); } };
        combo(0,RU.stack,[]); }
    } else dfs(0,0,0,0);
    if(bestV<=-1e9) return null;
    // DK slot order: QB, RB, RB, WR, WR, WR, TE, FLEX, DST
    const L=Array.from(best); const g=(c)=>L.filter(j=>pos[j]===c).sort((a,b)=>pts[b]-pts[a]);
    const qb=g(0), rb=g(1), wr=g(2), te=g(3), d=g(4); const flex=rb.length>2?rb.pop():wr.length>3?wr.pop():te.pop();
    return {L:[qb[0],rb[0],rb[1],wr[0],wr[1],wr[2],te[0],flex,d[0]],v:bestV};
  };
}
let MODEL=null;
onmessage=function(e){const m=e.data;
 try{
  if(m.type==='init'){MODEL=m.model; ENGINE.prepLeague(MODEL.league); return;}
  if(m.type==='calib'){ const res=m.games.map(g=>{ const G=ENGINE.prepGame(MODEL,g.slate); const c=ENGINE.calibrate(G,g.implied,{n:m.n,iters:5,seed:m.seed}); return {gi:g.gi,s:c.s,m:c.m}; }); postMessage({type:'calib',res}); return; }
  if(m.type==='pstats'){ const res=m.games.map(g=>{ const G=ENGINE.prepGame(MODEL,g.slate); const r=ENGINE.statSim(G,g.s,m.n,m.seed,g.variants?g.variants.map(v=>({p:v.p,G:ENGINE.prepGame(MODEL,v.slate)})):null); return {gi:g.gi,n:r.n,np:r.np,K:r.K,data:r.data}; }); postMessage({type:'pstats',games:res},res.map(r=>r.data.buffer)); return; }
  if(m.type==='opt'){
    const best=makeClassicOpt(Object.assign({pos:Int8Array.from(m.pos),sal:Float64Array.from(m.sal),rules:m.rules,meta:m.meta},m.pool||{})); const nT=m.nT, row=new Float64Array(nT); const opt=new Int16Array(m.n*9).fill(-1);
    for(let i=0;i<m.n;i++){ for(let j=0;j<nT;j++) row[j]=m.pts[i*nT+j]; const r=best(row); if(r) for(let k=0;k<9;k++) opt[i*9+k]=r.L[k]; }
    postMessage({type:'opt',n:m.n,opt},[opt.buffer]); return; }
  if(m.type==='sim'){
    const Gs=m.games.map(g=>{ const o={G:ENGINE.prepGame(MODEL,g.slate),off:g.off,s:g.s,n:g.slate.players.length,fixed:g.fixed?Float32Array.from(g.fixed):null,score:g.score}; if(g.start) o.G.start=g.start; if(g.variants){ o.VG=g.variants.map(v=>ENGINE.prepGame(MODEL,v.slate)); let s=0; o.cum=g.variants.map(v=>(s+=v.p)); } return o; }); const nT=m.nTotal, N=m.n, nG=Gs.length;
    const pts=new Float32Array(N*nT), sc=new Float32Array(N*nG*2), opt=new Int16Array(N*9).fill(-1), ov=new Float32Array(N);
    const R=ENGINE.makeRng(m.seed), S=new Float64Array(2*ENGINE.NS), NS=ENGINE.NS; const outs=Gs.map(g=>new Float32Array(g.n));
    const best=m.opt?makeClassicOpt({pos:Int8Array.from(m.opt.pos),sal:Float64Array.from(m.opt.sal),cap:50000}):null; const row=new Float64Array(nT);
    for(let i=0;i<N;i++){
      for(let k=0;k<nG;k++){ const g=Gs[k]; if(g.fixed){ pts.set(g.fixed,i*nT+g.off); sc[(i*nG+k)*2]=g.score?g.score[0]:0; sc[(i*nG+k)*2+1]=g.score?g.score[1]:0; continue; } const u=g.VG?R()*g.cum[g.cum.length-1]:0; const Gk=g.VG?g.VG[Math.max(0,g.cum.findIndex(x=>u<=x))]:g.G; ENGINE.simGame(Gk,R,g.s,outs[k],S); pts.set(outs[k],i*nT+g.off); sc[(i*nG+k)*2]=S[0]; sc[(i*nG+k)*2+1]=S[NS]; }
      if(best){ for(let j=0;j<nT;j++) row[j]=pts[i*nT+j]; const r=best(row); if(r){ for(let k=0;k<9;k++) opt[i*9+k]=r.L[k]; ov[i]=r.v; } }
      if(i%100===0) postMessage({type:'prog',done:i});
    }
    postMessage({type:'sim',n:N,pts,sc,opt,ov},[pts.buffer,sc.buffer,opt.buffer,ov.buffer]);
  }
 }catch(err){postMessage({type:'err',msg:String(err&&err.stack||err)});}
};
if(typeof module!=='undefined') module.exports={makeClassicOpt};
