from config import *
import json, pandas as pd, numpy as np, sys
def assemble(players_teams, out_path, meta=None):
    L=json.load(open(D+'m_league1.json')); L.update(json.load(open(D+'m_league2.json')))
    inj=json.load(open(D+'inj_snaps.json'))
    L['inj']={'QB':0.030,'RB':0.025,'WR':0.024,'TE':0.024}
    L['k']=dict(rush_eff=217,tgt_eff=62)
    L['rbRho']=0.80; L['rbGam']=1.75
    L['early']={'n':3,'lt':0.18,'lr':0.6,'gam1':3}  # opening-script concentration, fit by bt_firstdrive.py
    HU=json.load(open(D+'hurry.json')); L['oobHurry']=HU['oobHurry']; L['hail']=HU['hail']; L['hurry']=dict(offTO=HU['offTO'],spike=HU['spike'],spikeDt=HU['spikeDt'],dt=HU['dtB'])
    L['noise']=dict(s=0.1,proe=0.3,pace=0.08,shareR=0.5,shareT=0.32)
    L['adj']=dict(passLogit=0.1,int=1.05,sack=1.0,fg=1.4)
    teams=players_teams['teams']
    for tm,v in teams.items():
        v['pace']=L['teamPace'].get(tm,0); v['go']=L['teamGo'].get(tm,0)
    import os
    DF=json.load(open(D+'defense.json')) if os.path.exists(D+'defense.json') else {'teams':{}}  # fit_defense.py: current-season funnel terms
    for tm,v in teams.items():
        d=DF['teams'].get(tm)
        if d: v['dproe']=d['dproe']; v['drun']=d['drun']; v['dfun']=[d['proeAllowed'],d['ypcAllowed'],d['ypcEff'],d['plays'],d['carries']]
    if DF.get('meta'): L['defMeta']=DF['meta']
    WXF=os.path.join(os.path.dirname(os.path.abspath(__file__)),'samples','weather.json')
    if os.path.exists(WXF): L['weather']=json.load(open(WXF))
    kadj=L.pop('kickerAdj'); L.pop('teamPace'); L.pop('teamGo')
    ro=pd.read_parquet(D+'roster_2026.parquet'); ro=ro.sort_values('week').drop_duplicates('gsis_id',keep='last')
    ks=ro[ro.position=='K'][['gsis_id','full_name','team']]
    kick={r.gsis_id:[r.full_name,r.team] for r in ks.itertuples()}
    # compact player entries
    M=dict(league=L,players=players_teams['players'],teams=teams,kickerAdj=kadj,kickers=kick,meta=meta or {})
    json.dump(M,open(out_path,'w'),separators=(',',':'))
if __name__=='__main__':
    pt=json.load(open(D+'players_live.json'))
    g=pd.read_csv(D+'games.csv'); g=g[(g.season==Y2)&g.home_score.isna()&g.spread_line.notna()]
    lines=[[r.away_team,r.home_team,float(r.spread_line),float(r.total_line),r.gameday] for r in g.itertuples()][:64]
    from venues import venue, HOME
    gv=pd.read_csv(D+'games.csv'); gv=gv[(gv.season==Y2)&gv.home_score.isna()]
    venues={f'{r.away_team}@{r.home_team}':venue(r.stadium,r.home_team)+[r.gameday,str(r.gametime)] for r in gv.itertuples()}
    venues['_home']={t:venue(None,t) for t in HOME}
    notes={}; [notes.update(json.load(open(D+f))) for f in ('notes1.json','notes2.json')]
    assemble(pt,D+'model.json',meta=dict(built=__import__('datetime').date.today().isoformat(),data=f'nflfastR pbp {Y0}-{Y2} ({Y2} through wk{WEEK-1})',lines=lines,notes=notes,venues=venues))
    import os; print(os.path.getsize(D+'model.json')/1e6,'MB')
