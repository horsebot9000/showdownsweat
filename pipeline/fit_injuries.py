from config import *
import pandas as pd, numpy as np, json
s=pd.concat([pd.read_parquet(f'{D}snaps_{y}.parquet') for y in (Y0,Y1,Y2)])
s=s[(s.game_type=='REG')&s.position.isin(['QB','RB','WR','TE'])].copy()
s['t']=(s.season-Y0)*18+s.week; s=s.sort_values(['pfr_player_id','t']); g=s.groupby('pfr_player_id')
s['prev']=g.offense_pct.transform(lambda x: x.shift(1).rolling(3,min_periods=2).mean())
s['nxt_t']=g.t.shift(-1); s['nxt_pct']=g.offense_pct.shift(-1)
tg=s.groupby(['team','season']).t.apply(lambda x: np.array(sorted(set(x))))
def nxt(r):
    a=tg[(r.team,r.season)]; k=a[a>r.t]; return k[0] if len(k) else np.nan
reg=s[s.prev>=0.7].copy(); reg['tn']=reg.apply(nxt,axis=1); reg=reg[reg.tn.notna()]
reg['exit']=(reg.offense_pct<0.45)&((reg.nxt_t!=reg.tn)|(reg.nxt_pct<0.2))
out={ps:dict(perGame=round(float(d.exit.mean()),4),n=len(d)) for ps,d in reg.groupby('position')}
print(out); json.dump(out,open(D+'inj_snaps.json','w'))
