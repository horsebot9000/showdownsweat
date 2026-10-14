from config import *
import pandas as pd, json
p=pd.read_pickle(D+'pbp_prep.pkl'); R=p[p.season_type=='REG']
ru=R[(R.play_type=='run')&(R.qb_kneel==0)&(R.qb_scramble==0)]; cp=R[(R.play_type=='pass')&(R.complete_pass==1)]; sc=R[R.qb_scramble==1]
M=json.load(open(D+'m_league2.json')); M.update(oobRun=float(ru.out_of_bounds.mean()),oobComp=float(cp.out_of_bounds.mean()),oobScr=float(sc.out_of_bounds.mean()))
json.dump(M,open(D+'m_league2.json','w'))
