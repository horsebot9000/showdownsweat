from config import *
import pandas as pd, numpy as np, json, os
D=os.environ.get('SDS_DATA',D+'')
P=pd.read_pickle(D+'pbp_prep.pkl'); P=P[P.season_type=='REG'].copy()
ro=pd.concat([pd.read_parquet(f'{D}roster_{y}.parquet') for y in (Y0,Y1,Y2)]).sort_values(['season','week'])
info=ro.drop_duplicates('gsis_id',keep='last').set_index('gsis_id')[['full_name','team','position']]
r26=set(ro[ro.season==Y2].gsis_id)
sn=pd.concat([pd.read_parquet(f'{D}snaps_{y}.parquet') for y in (Y0,Y1,Y2)]); sn=sn[sn.game_type=='REG']
pfr2g=ro.dropna(subset=['pfr_id']).drop_duplicates('pfr_id',keep='last').set_index('pfr_id').gsis_id
sn['pid']=sn.pfr_player_id.map(pfr2g)
gm=P.drop_duplicates('game_id').set_index('game_id')[['season','week','home_team','away_team']]
def opp(gid,tm): r=gm.loc[gid]; return (r.away_team,1) if r.home_team==tm else (r.home_team,0)
# ---------- xFP lookup tables ----------
AYB=[-99,0,5,10,15,20,30,99]; YLB=[0,5,10,20,40,100]; RYB=[0,1,2,5,10,20,40,60,100]
sc=P[P.play_type.isin(['pass','run'])&(P.two_point_attempt==0)].copy()
tg=sc[sc.receiver_player_id.notna()&(sc.sack==0)].copy()
tg['ab']=pd.cut(tg.air_yards.fillna(0),AYB,labels=False); tg['yb']=pd.cut(tg.yardline_100,YLB,labels=False)
tg['dkr']=tg.complete_pass*(1+0.1*tg.yards_gained.fillna(0))+6*(tg.pass_touchdown==1)
tg['dkp']=0.04*tg.passing_yards.fillna(0)+4*(tg.pass_touchdown==1)-tg.interception
tg['xr']=tg.groupby(['ab','yb']).dkr.transform('mean'); tg['xp']=tg.groupby(['ab','yb']).dkp.transform('mean')
ru=sc[(sc.rush_attempt==1)&sc.rusher_player_id.notna()].copy()
ru['yb']=pd.cut(ru.yardline_100,RYB,labels=False); ru['dk']=0.1*ru.rushing_yards.fillna(0)+6*(ru.rush_touchdown==1)
ru['x']=ru.groupby('yb').dk.transform('mean')
db=sc[(sc.qb_dropback==1)].copy(); db['qb']=db.passer_player_id.fillna(db.rusher_player_id)
# ---------- per player-game aggregation ----------
K=['game_id','pid']
pas=db[db.qb.notna()].assign(pid=db.qb).groupby(K).agg(pc=('complete_pass','sum'),pa=('pass_attempt','sum'),py=('passing_yards','sum'),ptd=('pass_touchdown','sum'),
    pint=('interception','sum'),sk=('sack','sum'),depa=('qb_epa','sum'),dn=('play_id','size'))
pxp=tg[tg.passer_player_id.notna()].assign(pid=tg.passer_player_id).groupby(K).xp.sum().rename('pxfp')
pas['ptd']=pas.ptd  # passing tds only counted for passer
rus=ru.assign(pid=ru.rusher_player_id).groupby(K).agg(ra=('rush_attempt','sum'),ry=('rushing_yards','sum'),rtd=('rush_touchdown','sum'),repa=('epa','sum'),rx=('x','sum'))
rec=tg.assign(pid=tg.receiver_player_id).groupby(K).agg(tg=('play_id','size'),rec=('complete_pass','sum'),recy=('receiving_yards','sum'),rectd=('pass_touchdown','sum'),
    ay=('air_yards','sum'),tepa=('epa','sum'),tx=('xr','sum'))
A=pd.concat([pas,pxp,rus,rec],axis=1).fillna(0).reset_index()
# receiving TD only if receiver; passer ptd fine
# team context
tt=tg.groupby(['game_id','posteam']).size().rename('TT'); tr=ru[ru.qb_scramble==0].groupby(['game_id','posteam']).size().rename('TR')
tdb=db.groupby(['game_id','posteam']).size().rename('TDB')
# team of player in game
side=pd.concat([db[['game_id','posteam','qb']].rename(columns={'qb':'pid'}),ru[['game_id','posteam','rusher_player_id']].rename(columns={'rusher_player_id':'pid'}),
     tg[['game_id','posteam','receiver_player_id']].rename(columns={'receiver_player_id':'pid'})]).dropna().drop_duplicates(['game_id','pid'])
A=A.merge(side,on=['game_id','pid'],how='left')
# snaps (includes zero-touch games)
s=sn[sn.pid.notna()&(sn.offense_snaps>0)][['game_id','pid','team','offense_pct']].rename(columns={'team':'tm2'})
A=A.merge(s,on=['game_id','pid'],how='outer')
A['posteam']=A.posteam.fillna(A.tm2); A=A[A.posteam.notna()&A.game_id.isin(gm.index)]
A=A.fillna(0)
A=A.join(tt,on=['game_id','posteam']).join(tr,on=['game_id','posteam']).join(tdb,on=['game_id','posteam'])
# routes: participation 2024-25 (players on field on dropbacks, non-QB non-OL)
routes=[]
for y in (Y0,Y1):
    pt=pd.read_parquet(f'{D}part_{y}.parquet')[['nflverse_game_id','play_id','offense_players','offense_positions']]
    d=db[db.season==y][['game_id','play_id']].merge(pt,left_on=['game_id','play_id'],right_on=['nflverse_game_id','play_id'])
    d=d.assign(pl=d.offense_players.str.split(';'),ps=d.offense_positions.str.split(';')).explode(['pl','ps'])
    d=d[d.ps.isin(['WR','TE','RB','FB'])]
    routes.append(d.groupby(['game_id','pl']).size().rename('routes'))
RT=pd.concat(routes); RT.index.names=['game_id','pid']
A=A.join(RT,on=['game_id','pid']); A['est']=A.routes.isna().astype(int)
A=A.join(gm[['season','week']],on='game_id')
# estimate 2026 routes: snap% * team dropbacks * player's route/snap ratio from 2025 (pos default)
pos=A.pid.map(info.position).replace({'FB':'RB'})
hist=A[(A.est==0)&(A.offense_pct>0)&(A.TDB>0)]
ratio=(hist.routes/hist.TDB/hist.offense_pct).groupby(hist.pid).median().clip(0.3,1.1)
dflt=pos.map({'WR':0.97,'TE':0.72,'RB':0.55}).fillna(0)
rr=A.pid.map(ratio).fillna(dflt)
A.loc[A.est==1,'routes']=(A.offense_pct*A.TDB*rr).where(pos.isin(['WR','TE','RB']),0)
A['routes']=A.routes.fillna(0)
# DK points actual (reuse logic)
import importlib.util,sys
sys.argv=['x']
spec=importlib.util.spec_from_file_location('bte',HERE+'bt_export.py')
DKP={}
from bt_export import dk_actual
for gid in gm.index:
    for k,v in dk_actual(gid).items(): DKP[(gid,k)]=v
A['dk']=[DKP.get((g,p),0.0) for g,p in zip(A.game_id,A.pid)]
A['xfp']=A.rx+A.tx+np.where(pos=='QB',A.pxfp,0)
A['plays']=A.dn+A.ra.where(pos!='QB',A.ra-0)+A.tg
A['epa_sum']=np.where(pos=='QB',A.depa+A.repa,A.repa+A.tepa)
A['nplays']=np.where(pos=='QB',A.dn+(A.ra),A.ra+A.tg)
keep=A[A.pid.isin(r26)|A.pid.isin(set(A[A.season==Y2].pid))]
out={}
cols=['wk','opp','ha','snap','dk','xfp','epa','pc','pa','py','ptd','pint','sk','ra','ry','rtd','tg','rec','recy','rectd','ay','routes','tdb','tt','tr','est']
for r in keep.itertuples():
    p=r.pid
    if p not in info.index: continue
    ps=info.position[p]; ps='RB' if ps in ('FB','HB') else ps
    if ps not in ('QB','RB','WR','TE'): continue
    o,ha=opp(r.game_id,r.posteam)
    e=out.setdefault(p,{'n':info.full_name[p],'tm':info.team[p],'pos':ps,'g':{}})
    row=[int(r.week),o,ha,round(float(r.offense_pct)*100),round(r.dk,2),round(r.xfp,2),round(r.epa_sum/r.nplays,3) if r.nplays else None,
         int(r.pc),int(r.pa),int(r.py),int(r.ptd),int(r.pint),int(r.sk),int(r.ra),int(r.ry),int(r.rtd),int(r.tg),int(r.rec),int(r.recy),int(r.rectd),int(r.ay),
         round(float(r.routes),1),int(r.TDB or 0),int(r.TT or 0),int(r.TR or 0),int(r.est)]
    e['g'].setdefault(str(int(r.season)),[]).append(row)
for e in out.values():
    for y in e['g']: e['g'][y].sort(key=lambda x:x[0])
# kickers
kk=P[P.play_type.isin(['field_goal','extra_point'])&P.kicker_player_id.notna()].copy()
kk['fgm']=(kk.field_goal_result=='made'); kk['fga']=kk.play_type=='field_goal'; kk['xpm']=kk.extra_point_result=='good'; kk['xpa']=kk.play_type=='extra_point'
kk['lng']=np.where(kk.fgm,kk.kick_distance,0)
KG=kk.groupby(['game_id','kicker_player_id','posteam']).agg(fgm=('fgm','sum'),fga=('fga','sum'),lng=('lng','max'),xpm=('xpm','sum'),xpa=('xpa','sum')).reset_index().join(gm,on='game_id')
for r in KG.itertuples():
    p=r.kicker_player_id; o,ha=opp(r.game_id,r.posteam)
    e=out.setdefault(p,{'n':info.full_name.get(p,p) if p in info.index else p,'tm':info.team[p] if p in info.index else r.posteam,'pos':'K','g':{}})
    e['g'].setdefault(str(int(r.season)),[]).append([int(r.week),o,ha,round(DKP.get((r.game_id,p),0),1),int(r.fgm),int(r.fga),int(r.lng),int(r.xpm),int(r.xpa)])
# DST
for gid,row in gm.iterrows():
    q=P[P.game_id==gid]
    for tm,op in ((row.home_team,row.away_team),(row.away_team,row.home_team)):
        d=q[q.defteam==tm]; ha=1 if tm==row.home_team else 0
        pa=int(q.home_score.iloc[0] if tm==row.away_team else q.away_score.iloc[0])
        tds=int(((q.return_touchdown==1)&(q.td_team==tm)).sum())
        e=out.setdefault(tm,{'n':tm+' DST','tm':tm,'pos':'DST','g':{}})
        e['g'].setdefault(str(int(row.season)),[]).append([int(row.week),op,ha,round(DKP.get((gid,'DST_'+tm),0),1),int(d.sack.sum()),int(d.interception.sum()),int(d.fumble_lost.sum()),tds,pa])
for e in out.values():
    for y in e['g']: e['g'][y].sort(key=lambda x:x[0])
json.dump(dict(cols=cols,p=out),open(D+'logs.json','w'),separators=(',',':'))
print(len(out), os.path.getsize(D+'logs.json')/1e6,'MB')
L=out['00-0036358']; print(L['n'],L['g']['2026']); print(out['00-0033077']['g']['2026'][:2]); print(out['DAL']['g']['2026'][:2])
