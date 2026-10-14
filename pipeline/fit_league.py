from config import *
import pandas as pd, numpy as np, json, warnings
warnings.filterwarnings('ignore')
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import log_loss
p=pd.read_pickle(D+'pbp_prep.pkl')
REG=p[p.season_type=='REG']
M={}; NOTES={}
rng=np.random.default_rng(1)
# ---------- bins shared with JS ----------
TOGO=[1,2,3,4,5,6,7,8,9,10,13,17,99]          # upper edges
YL=list(range(5,100,5))+[100]                   # upper edges, 20 bins
SD=[-17,-9,-4,-1,0,3,8,16,99]                   # upper edges of score diff (<=)
# time state: 0 Q1,1 Q2>120,2 Q2<=120,3 Q3,4 Q4>600,5 Q4 300-600,6 Q4 120-300,7 Q4<=120,8 OT
TS_REP=[(1,1800+450),(2,900+480),(2,60),(3,1350),(4,780),(4,450),(4,210),(4,60),(5,300)]
def bin_idx(v,edges): return int(np.searchsorted(edges,v,side='left'))
def tstate(qtr,hs):
    qtr=np.asarray(qtr); hs=np.asarray(hs)
    out=np.where(qtr==1,0,np.where(qtr==2,np.where(hs>120,1,2),np.where(qtr==3,3,np.where(qtr==4,np.select([hs>600,hs>300,hs>120],[4,5,6],7),8))))
    return out
M['bins']=dict(togo=TOGO,yl=YL,sd=SD)
def rep_vals(edges,lo):
    out=[];prev=lo
    for e in edges:
        out.append((prev+min(e,prev+12))/2 if e<99 else prev+3); prev=e+1
    return out
# representative values
TOGO_REP=[1,2,3,4,5,6,7,8,9,10,12,15,20]
YL_REP=[3]+[e-2 for e in YL[1:]]
SD_REP=[-21,-12,-6,-2,0,2,6,12,21]
# ---------- pass probability ----------
sc=p[p.play_type.isin(['pass','run'])&(p.qb_kneel==0)&(p.qb_spike==0)&p.down.notna()&(p.two_point_attempt==0)].copy()
sc['isp']=(sc.qb_dropback==1).astype(int)
sc['ts']=tstate(sc.qtr,sc.half_seconds_remaining)
F=['down','ydstogo','yardline_100','score_differential','ts','half_seconds_remaining']
tr=sc[sc.season<Y2]; te=sc[sc.season==Y2]
w=np.where(tr.season==Y1,1.0,0.6)
gb=HistGradientBoostingClassifier(max_iter=300,learning_rate=0.08,max_leaf_nodes=31,min_samples_leaf=80,categorical_features=[False,False,False,False,True,False])
gb.fit(tr[F],tr.isp,sample_weight=w)
ll=log_loss(te.isp,gb.predict_proba(te[F])[:,1]); ll0=log_loss(te.isp,np.full(len(te),te.isp.mean()))
llx=log_loss(te.isp,te.xpass.clip(0.01,0.99)) if te.xpass.notna().all() else None
NOTES['pass_model']=f'GBM log loss on 2026 holdout {ll:.4f} vs base {ll0:.4f} vs nflfastR xpass {llx:.4f}'
print(NOTES['pass_model'])
gb.fit(sc[F],sc.isp,sample_weight=np.where(sc.season==Y2,1.5,np.where(sc.season==Y1,1.0,0.6)))
# grid: down x togo x yl x sd x ts
grid=[]
rows=[]
for d in range(1,5):
  for ti,tg in enumerate(TOGO_REP):
    for yi,yl in enumerate(YL_REP):
      for si,sd in enumerate(SD_REP):
        for k,(q,hs) in enumerate(TS_REP):
          rows.append((d,min(tg,yl),yl,sd,k,hs))
G=pd.DataFrame(rows,columns=F)
pp=gb.predict_proba(G)[:,1]
M['passGrid']=[int(round(x*1000)) for x in pp]
# ---------- 4th down decision ----------
fd=REG[(REG.down==4)&REG.play_type.isin(['pass','run','punt','field_goal'])&(REG.qb_kneel==0)].copy()
fd['dec']=np.select([fd.play_type.isin(['pass','run']),fd.play_type=='punt'],[0,1],2)
fd['ts']=tstate(fd.qtr,fd.half_seconds_remaining)
F4=['ydstogo','yardline_100','score_differential','ts','half_seconds_remaining']
fd['go']=(fd.dec==0).astype(int)
nf=fd[fd.dec>0].copy(); nf['fg']=(nf.dec==2).astype(int)
def mk(mono): return HistGradientBoostingClassifier(max_iter=200,learning_rate=0.05,max_leaf_nodes=15,min_samples_leaf=120,l2_regularization=1.0,monotonic_cst=mono)
# features: ydstogo(-), yardline, score_diff(-), ts (treated numeric, no constraint), half_seconds
FG4=['ydstogo','yardline_100','score_differential','ts','half_seconds_remaining']
gw=mk([-1,0,-1,0,0]); gf=mk([0,-1,0,0,0])
tr=fd[fd.season<Y2]; te=fd[fd.season==Y2]
gw.fit(tr[FG4],tr.go,sample_weight=np.where(tr.season==Y1,1.0,0.6))
ll=log_loss(te.go,gw.predict_proba(te[FG4])[:,1])
NOTES['fourth_model']=f'4th-down go model (monotone GBM) 2026 holdout log loss {ll:.4f}; 2026 go-rate actual {te.go.mean():.3f} pred {gw.predict_proba(te[FG4])[:,1].mean():.3f}'
print(NOTES['fourth_model'])
for s_ in (Y0,Y1,Y2):
    d=fd[(fd.season==s_)&(fd.ydstogo<=2)&fd.yardline_100.between(30,70)]; print('go rate 4th&<=2 midfield',s_,round(d.go.mean(),3),len(d))
sw=np.where(fd.season==Y2,1.6,np.where(fd.season==Y1,1.0,0.6))
gw.fit(fd[FG4],fd.go,sample_weight=sw)
gf.fit(nf[FG4],nf.fg,sample_weight=np.where(nf.season==Y2,1.6,np.where(nf.season==Y1,1.0,0.6)))
fd['p_go']=gw.predict_proba(fd[FG4])[:,1]
rows=[]
for ti,tg in enumerate(TOGO_REP):
    for yi,yl in enumerate(YL_REP):
      for si,sd in enumerate(SD_REP):
        for k,(q,hs) in enumerate(TS_REP):
          rows.append((min(tg,yl),yl,sd,k,hs))
G=pd.DataFrame(rows,columns=FG4)
pg=gw.predict_proba(G)[:,1]; pf=gf.predict_proba(G)[:,1]
M['fourthGrid']=[[int(round(a*1000)),int(round((1-a)*(1-b)*1000))] for a,b in zip(pg,pf)]
# team go offsets (log-odds), shrunk k=117 eq. decisions, weighted by season
SW={Y2:1.0,Y1:0.35,Y0:0.1}
fd2=fd[(fd.p_go>0.05)&(fd.p_go<0.95)].copy(); fd2['w']=fd2.season.map(SW)
tg=fd2.groupby('posteam').apply(lambda d: pd.Series({'go':(d.w*(d.dec==0)).sum(),'exp':(d.w*d.p_go).sum(),'n':d.w.sum()}),include_groups=False)
K4=117
tg['rate']=(tg.go+K4*tg.exp/tg.n)/(tg.n+K4); tg['er']=tg.exp/tg.n
tg['off']=np.log(tg.rate/(1-tg.rate))-np.log(tg.er/(1-tg.er))
M['teamGo']=tg.off.round(3).to_dict()
print(tg.sort_values('off').off.round(2).to_dict())
# ---------- FG ----------
fg=p[(p.play_type=='field_goal')&p.kick_distance.notna()&(p.season>=Y0)].copy()
fg['m']=(fg.field_goal_result=='made').astype(int); fg['blk']=(fg.field_goal_result=='blocked').astype(int)
for s in (Y0,Y1,Y2):
    d=fg[fg.season==s]; print('FG',s,'50+',round(d[d.kick_distance>=50].m.mean(),3),len(d[d.kick_distance>=50]),'40-49',round(d[d.kick_distance.between(40,49)].m.mean(),3))
X=np.c_[fg.kick_distance,fg.kick_distance**2]
lr=LogisticRegression(C=100).fit(X,fg.m,sample_weight=fg.season.map({Y2:1.5,Y1:1.0,Y0:0.7}))
M['fg']=dict(b0=float(lr.intercept_[0]),b1=float(lr.coef_[0][0]),b2=float(lr.coef_[0][1]),blk=float(fg.blk.mean()))
for dist in (30,40,45,50,55,60,65): print('FG p',dist,round(lr.predict_proba([[dist,dist*dist]])[0,1],3))
# kicker adj (log-odds over expected) shrink k=135 attempts
fg['pe']=lr.predict_proba(X)[:,1]; fg['w']=fg.season.map(SW)
kk=fg.groupby('kicker_player_id').apply(lambda d: pd.Series({'m':(d.w*d.m).sum(),'e':(d.w*d.pe).sum(),'n':d.w.sum()}),include_groups=False)
kk['adj']=np.log(((kk.m+135*kk.e/kk.n)/(kk.n+135))/(1-(kk.m+135*kk.e/kk.n)/(kk.n+135)))-np.log((kk.e/kk.n)/(1-kk.e/kk.n))
M['kickerAdj']=kk.adj.round(3).to_dict()
# max attempted distance -> FG range handled by 4th grid; also longest
xp=p[(p.play_type=='extra_point')&(p.season>=Y0)]
M['xp']=float((xp.extra_point_result=='good').mean()); print('XP',M['xp'])
# 2pt decision & success
td=p[(p.extra_point_attempt==1)|(p.two_point_attempt==1)].copy()
td['go2']=(td.two_point_attempt==1).astype(int)
td['sd']=td.score_differential  # before conversion, posteam perspective (after TD)
td['late']=((td.qtr>=4)&(td.game_seconds_remaining<=900)).astype(int)
t2=td.groupby(['late',td.sd.clip(-20,20)]).go2.agg(['mean','size']).reset_index()
two={}
for _,r in t2.iterrows(): two[f"{int(r.late)}_{int(r.sd)}"]=round((r['mean']*r['size']+0.08*5)/(r['size']+5),3)
M['twoPtGo']=two
tp=p[p.two_point_attempt==1]
M['twoPt']=dict(succ=float((tp.two_point_conv_result=='success').mean()),passRate=float((tp.qb_dropback==1).mean()))
print('2pt',M['twoPt'],'base go rate early',td[td.late==0].go2.mean())
json.dump(M,open(D+'m_league1.json','w')); json.dump(NOTES,open(D+'notes1.json','w'))
