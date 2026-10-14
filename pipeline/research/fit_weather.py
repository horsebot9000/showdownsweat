# Weather effects from nflfastR 2014-2026 outdoor games (fit once; constants go into samples/weather.json).
# Each team-game is compared with that offense's and that defense's same-season averages in their OTHER games,
# so team quality is controlled. Rain/snow come from the gamebook weather text at kickoff; wind from the wind field
# (or parsed from the text when missing).
import pandas as pd, numpy as np, re, json, sys, os
WX=sys.argv[1] if len(sys.argv)>1 else 'wx/'; LIVE=sys.argv[2] if len(sys.argv)>2 else '../data/'
cols=['game_id','season','season_type','posteam','defteam','play_type','pass_oe','yards_gained','qb_scramble','sack','complete_pass','interception',
      'pass_attempt','fumble','fumble_lost','qb_kneel','qb_spike','two_point_attempt','field_goal_result','kick_distance','weather','roof','temp','wind','total_home_score','total_away_score','epa']
fr=[]
for y in range(2014,2027):
    f=(WX if y<2024 else LIVE)+f'pbp_{y}.parquet'
    if os.path.exists(f): fr.append(pd.read_parquet(f,columns=cols))
P=pd.concat(fr,ignore_index=True); P=P[P.season_type.isin(['REG','POST'])]
G=P.drop_duplicates('game_id')[['game_id','season','weather','roof','temp','wind']].copy()
t=G.weather.fillna('').str.lower()
G['rain']=(t.str.contains(r'rain|shower|drizzle|thunder|storm')&~t.str.contains(r'possible|chance|later|probability|0%')).astype(int)
G['heavy']=t.str.contains(r'heavy rain|downpour|steady rain|thunder|storm').astype(int)&G.rain
G['snow']=t.str.contains(r'snow|flurr|sleet|wintry').astype(int)
pw=t.str.extract(r'wind:\s*[a-z\- ]*?(\d+)')[0].astype(float)
G['windv']=G.wind.fillna(pw)
G['out']=G.roof.isin(['outdoors','open']).astype(int)
G.loc[G.out==0,['rain','heavy','snow']]=0; G.loc[G.out==0,'windv']=0
G['w15']=((G.windv>=15)&(G.windv<20)).astype(int); G['w20']=(G.windv>=20).astype(int)
G['wnd']=np.clip(G.windv.fillna(0)-10,0,None)/10   # per 10 mph above 10
G['cold']=((G.temp<=25)&(G.out==1)).astype(int)
sc=P[P.play_type.isin(['pass','run'])&(P.qb_kneel==0)&(P.qb_spike==0)&(P.two_point_attempt==0)].copy()
sc['dr']=(sc.play_type=='run')&(sc.qb_scramble==0); sc['pa']=(sc.play_type=='pass')&(sc.sack==0)&(sc.qb_scramble==0)
agg=sc.groupby(['game_id','season','posteam','defteam']).apply(lambda d: pd.Series(dict(
    proe=d.pass_oe.mean()/100, n=len(d), ypc=d.loc[d.dr,'yards_gained'].mean(), nr=d.dr.sum(),
    ypa=d.loc[d.pa,'yards_gained'].mean(), cmp=d.loc[d.pa,'complete_pass'].mean(), npa=d.pa.sum(),
    intr=d.loc[d.pa,'interception'].mean(), fum=d.fumble.mean(), fuml=d.fumble_lost.mean(),
    pepa=d.loc[d.play_type=='pass','epa'].mean(), repa=d.loc[d.dr,'epa'].mean()))).reset_index()
agg=agg.merge(G,on=['game_id','season'])
def loo(df,col,key):  # same-season average in the team's other games
    s=df.groupby(['season',key])[col].transform('sum'); c=df.groupby(['season',key])[col].transform('count')
    return (s-df[col])/(c-1)
X=['rain','snow','wnd','cold']
out={}
for m in ['proe','ypc','ypa','cmp','intr','fum','fuml','pepa','repa']:
    d=agg.dropna(subset=[m]).copy()
    d['o']=loo(d,m,'posteam'); d['dd']=loo(d,m,'defteam'); lg=d.groupby('season')[m].transform('mean')
    d=d.dropna(subset=['o','dd'])
    y=d[m]-(d.o+d.dd-lg)   # expected = offense + defense - league
    A=np.c_[np.ones(len(d)),d[X].values]; w=d['n'].values
    W=np.sqrt(w); c,*_=np.linalg.lstsq(A*W[:,None],y.values*W,rcond=None)
    r=y.values-A@c; s2=np.sum(w*r*r)/(len(w)-A.shape[1]); cov=s2*np.linalg.inv((A*w[:,None]).T@A); se=np.sqrt(np.diag(cov))
    out[m]={x:[round(float(c[i+1]),4),round(float(se[i+1]),4)] for i,x in enumerate(X)}
    print(f'{m:5s}',' '.join(f'{x}={c[i+1]:+.4f}({se[i+1]:.4f})' for i,x in enumerate(X)))
# field goals: make rate vs distance curve
fg=P[(P.play_type=='field_goal')&P.kick_distance.notna()].merge(G[['game_id']+X+['out']],on='game_id')
fg['m']=(fg.field_goal_result=='made').astype(int)
from sklearn.linear_model import LogisticRegression
Z=np.c_[fg.kick_distance,fg.kick_distance**2,fg[X].values]
lr=LogisticRegression(C=1e4,max_iter=2000).fit(Z,fg.m)
print('FG logit coefs (per weather flag):',dict(zip(X,np.round(lr.coef_[0][2:],3))),'n',len(fg),'flags',fg[X].sum().to_dict())
out['fg_logit']={x:round(float(v),3) for x,v in zip(X,lr.coef_[0][2:])}
# market check: actual total minus closing total
gm=pd.read_csv(LIVE+'games.csv')[['game_id','total_line','home_score','away_score']].dropna()
gm=gm.merge(G,on='game_id'); gm['err']=gm.home_score+gm.away_score-gm.total_line
A=np.c_[np.ones(len(gm)),gm[X].values]; c,*_=np.linalg.lstsq(A,gm.err.values,rcond=None); r=gm.err.values-A@c; se=np.sqrt(np.diag(np.sum(r*r)/(len(gm)-A.shape[1])*np.linalg.inv(A.T@A)))
print('points vs closing total:',' '.join(f'{x}={c[i+1]:+.2f}({se[i+1]:.2f})' for i,x in enumerate(X)),'n',len(gm))
out['market']={x:[round(float(c[i+1]),2),round(float(se[i+1]),2)] for i,x in enumerate(X)}
out['counts']={x:int(G[x].sum()) for x in X}
json.dump(out,open('weather_fit.json','w'),indent=1)
