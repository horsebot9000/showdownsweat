let MODEL=null;
onmessage=function(e){const m=e.data;
 try{
  if(m.type==='init'){MODEL=m.model; ENGINE.prepLeague(MODEL.league); return;}
  if(m.type==='calib'){const G=ENGINE.prepGame(MODEL,m.slate); const c=ENGINE.calibrate(G,m.implied,{n:m.n,iters:5,seed:m.seed}); postMessage({type:'calib',s:c.s,m:c.m}); return;}
  if(m.type==='pstats'){ const G=ENGINE.prepGame(MODEL,m.slate); const r=ENGINE.statSim(G,m.s,m.n,m.seed,m.variants?m.variants.map(v=>({p:v.p,G:ENGINE.prepGame(MODEL,v.slate)})):null); postMessage({type:'pstats',games:[{gi:0,n:r.n,np:r.np,K:r.K,data:r.data}]},[r.data.buffer]); return; }
  if(m.type==='sim'){
    const G=ENGINE.prepGame(MODEL,m.slate); if(m.start) G.start=m.start; const n=G.n,N=m.n;
    // questionable players: one prepared game per scenario, each sim draws a scenario by its probability
    const VG=m.variants?m.variants.map(v=>{ const g=ENGINE.prepGame(MODEL,v.slate); if(m.start) g.start=m.start; return g; }):null; const cum=[]; if(VG){ let c=0; m.variants.forEach(v=>{ c+=v.p; cum.push(c); }); }
    const pts=new Float32Array(N*n), sm=new Float32Array(N*8), sf=new Float32Array(N*(2*ENGINE.NS+1)), opt=new Int16Array(N*6).fill(-1), ov=new Float32Array(N);
    const R=ENGINE.makeRng(m.seed), out=new Float32Array(n), S=new Float64Array(2*ENGINE.NS); const NS=ENGINE.NS;
    const best=ENGINE.makeOptimizer(G,{eligible:m.eligible,tiebreak:Float64Array.from(m.tb),cap:50000});
    for(let i=0;i<N;i++){
      const u=VG?R()*cum[cum.length-1]:0; const Gi=VG?VG[Math.max(0,cum.findIndex(x=>u<=x))]:G; ENGINE.simGame(Gi,R,m.s,out,S); pts.set(out,i*n);
      sm[i*8]=S[0]; sm[i*8+1]=S[NS]; sm[i*8+2]=S[5]; sm[i*8+3]=S[6]; sm[i*8+4]=S[NS+5]; sm[i*8+5]=S[NS+6]; sm[i*8+6]=S[1]; sm[i*8+7]=S[NS+1];
      const W2=2*NS+1; for(let k=0;k<2*NS;k++) sf[i*W2+k]=S[k]; sf[i*W2+2*NS]=G._ot||0;
      const r=best(out); if(r){for(let k=0;k<6;k++) opt[i*6+k]=r.L[k]; ov[i]=r.v;}
      if(i%250===0) postMessage({type:'prog',done:i});
    }
    postMessage({type:'sim',n:N,pts,sm,sf,opt,ov},[pts.buffer,sm.buffer,sf.buffer,opt.buffer,ov.buffer]);
  }
 }catch(err){postMessage({type:'err',msg:String(err&&err.stack||err)});}
};
