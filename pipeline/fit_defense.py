from config import *
# Defensive funnel terms, CURRENT SEASON ONLY (coaching/personnel turnover makes prior seasons misleading).
# Constants come from bt_funnel.py + fit_funnel_eval.py (2024/2025, current-season-only data, cross-validated by season):
#   PROE allowed: shrink K=400 plays, carryover 0.92 (OOS R2 for game PROE 0.125 -> 0.153 when added to offense PROE)
#   Run defense : yards per designed carry allowed, shrink K=200 carries, carryover 0.64 (OOS R2 for game YPC 0.023 -> 0.036)
#   Pass defense: tested (YPA and EPA) and adds ~nothing out of sample, so it is NOT used.
# Opponent adjustment: each play is measured against the offense's own season-to-date average.
# Engine units: dproe in pass-probability (same as offense proe); drun in efficiency-tilt units, 2.4 YPC per 1.0 (measured in engine).
import pandas as pd, numpy as np, json

K_PROE, B_PROE, K_RUN, B_RUN, YPC_PER_S = 400, 0.92, 200, 0.64, 2.4
cols=['season','week','season_type','posteam','defteam','play_type','pass_oe','yards_gained','qb_scramble','qb_kneel','qb_spike','two_point_attempt']
p=pd.read_parquet(D+f'pbp_{SEASON}.parquet',columns=cols)
p=p[(p.season_type=='REG')&p.play_type.isin(['pass','run'])&(p.qb_kneel==0)&(p.qb_spike==0)&(p.two_point_attempt==0)].copy()
p['po']=p.pass_oe/100; dr=(p.play_type=='run')&(p.qb_scramble==0)
offPo=p.groupby('posteam').po.mean(); offYpc=p[dr].groupby('posteam').yards_gained.mean()
p['rpo']=p.po-p.posteam.map(offPo); p['rypc']=np.where(dr,p.yards_gained-p.posteam.map(offYpc),np.nan)
out={}
for tm,d in p.groupby('defteam'):
    a=d.rpo.dropna(); r=d.rypc.dropna(); g=d.week.nunique()
    dproe=B_PROE*a.sum()/(len(a)+K_PROE); dypc=B_RUN*r.sum()/(len(r)+K_RUN)
    out[tm]=dict(dproe=round(float(dproe),4),drun=round(float(dypc/YPC_PER_S),4),proeAllowed=round(float(a.mean()),4),ypcAllowed=round(float(r.mean()),3),ypcEff=round(float(dypc),3),plays=int(len(a)),carries=int(len(r)),games=int(g))
meta=dict(season=SEASON,weeks=int(p.week.max()),K_PROE=K_PROE,B_PROE=B_PROE,K_RUN=K_RUN,B_RUN=B_RUN,YPC_PER_S=YPC_PER_S)
json.dump(dict(teams=out,meta=meta),open(D+'defense.json','w'),indent=0)
s=pd.DataFrame(out).T.sort_values('dproe')
print(s[['dproe','proeAllowed','plays']].head(5)); print(s[['dproe','proeAllowed','plays']].tail(5))
s=s.sort_values('ypcEff'); print(s[['ypcEff','ypcAllowed','carries','drun']].head(5)); print(s[['ypcEff','ypcAllowed','carries','drun']].tail(5))
