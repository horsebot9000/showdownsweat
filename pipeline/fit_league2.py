from config import *
import pandas as pd, numpy as np, json, warnings, re
warnings.filterwarnings('ignore')
p=pd.read_pickle(D+'pbp_prep.pkl')
M={}; NOTES={}
rng=np.random.default_rng(7)
def qs(x,n=60):
    x=np.asarray(x,dtype=float); x=x[~np.isnan(x)]
    if len(x)==0: return []
    return [round(float(v),1) for v in np.quantile(x,np.linspace(0,1,n))]
def sample(x,n,dec=0):
    x=np.asarray(x); 
    if len(x)>n: x=rng.choice(x,n,replace=False)
    return [round(float(v),dec) if dec else int(v) for v in x]
R=p[p.season_type=='REG']
# ---------- clock runoff ----------
sc=R[R.play_type.isin(['pass','run','qb_kneel','qb_spike','no_play'])&~R.is_to].copy()
sc['dt']=sc.game_seconds_remaining-sc.nx_game_seconds_remaining
sc=sc[(sc.nx_posteam==sc.posteam)&(sc.nx_qtr==sc.qtr)&sc.dt.between(0,60)&~sc.to_after]
sc['cat']=np.select([sc.play_type=='qb_kneel',sc.play_type=='qb_spike',sc.play_type=='no_play',
   (sc.play_type=='pass')&(sc.complete_pass==0)&(sc.sack==0)&(sc.qb_scramble==0),
   sc.out_of_bounds==1],['kneel','spike','pen','inc','oob'],'inb')
hs=sc.half_seconds_remaining; sd=sc.score_differential
late=((sc.qtr==2)&(hs<=120))|((sc.qtr==4)&(hs<=120))
sc['mode']=np.select([ (sc.qtr==4)&(sd<0)&(hs<=300) | ((sc.qtr==2)&(hs<=120)) | ((sc.qtr==4)&(sd<=0)&(hs<=120)),
                       (sc.qtr==4)&(sd>0)&(hs<=600)],['hurry','milk'],'norm')
# out of bounds in last 2/5 min stops clock: separate oob late
sc.loc[(sc.cat=='oob')&(((sc.qtr==2)&(hs<=120))|((sc.qtr==4)&(hs<=300))),'cat']='oobstop'
clock={}
for (c,m),d in sc.groupby(['cat','mode']):
    if len(d)>=40: clock[f'{c}_{m}']=qs(d.dt,40)
for c,d in sc.groupby('cat'): clock[f'{c}_all']=qs(d.dt,40)
M['clock']=clock
print({k:(v[20] if v else None) for k,v in clock.items()})
# team pace (neutral, inb plays) offset in seconds
ne=sc[(sc['mode']=='norm')&(sc['cat']=='inb')&(sc.qtr<=3)&(sc.score_differential.abs()<=10)].copy()
SW={Y2:1.0,Y1:0.35,Y0:0.1}; ne['w']=ne.season.map(SW)
lg=ne.dt.mean()
ne['wd']=ne.w*(ne.dt-lg)
tp=ne.groupby('posteam').agg(s=('wd','sum'),n=('w','sum'))
tp['off']=tp['s']/(tp['n']+424)
M['teamPace']=tp.off.round(2).to_dict(); print('pace offsets',tp.off.round(1).sort_values().to_dict())
# ---------- timeouts usage ----------
# defense trailing late uses TO after opponent inbounds play
dd=R[R.play_type.isin(['pass','run'])&(R.qtr==4)&(R.half_seconds_remaining<=180)&(R.score_differential>0)&(R.score_differential<=16)&(R.defteam_timeouts_remaining>0)]
dd=dd[(dd.out_of_bounds==0)&((dd.complete_pass==1)|(dd.play_type=='run'))]
M['defTOlate']=float(dd.to_after.mean()); print('def TO after inb late',M['defTOlate'],len(dd))
oo=R[R.play_type.isin(['pass','run'])&(R.half_seconds_remaining<=120)&(R.qtr.isin([2,4]))&(R.posteam_timeouts_remaining>0)&((R.qtr==2)|(R.score_differential<=0))]
oo=oo[(oo.out_of_bounds==0)&((oo.complete_pass==1)|(oo.play_type=='run'))&(oo.yardline_100<60)]
M['offTOlate']=float(oo.to_after.mean()); print('off TO after inb late',M['offTOlate'],len(oo))
# ---------- penalties ----------
snap=R[R.play_type.isin(['pass','run','no_play'])&~R.is_to&R.down.notna()&(R.two_point_attempt==0)]
pen=snap[(snap.play_type=='no_play')&(snap.penalty==1)&snap.penalty_yards.notna()]
pre=['False Start','Delay of Game','Defensive Offside','Neutral Zone Infraction','Illegal Formation','Illegal Shift','Encroachment','Defensive Too Many Men on Field','Offensive Offside','Illegal Motion','Offensive Too Many Men on Field','Defensive Delay of Game','Illegal Substitution']
pen=pen.assign(side=np.where(pen.penalty_team==pen.posteam,0,1),pre=pen.penalty_type.isin(pre).astype(int),
               fd=pen.first_down_penalty.fillna(0).astype(int),yd=pen.penalty_yards.astype(int),
               dpi=(pen.penalty_type=='Defensive Pass Interference').astype(int))
M['penRate']=float(len(pen)/len(snap))
# by down rate
M['penRateDown']={int(d):float(len(pen[pen.down==d])/len(snap[snap.down==d])) for d in (1,2,3,4)}
M['penPool']=pen[['side','pre','fd','yd']].sample(min(1500,len(pen)),random_state=1).values.tolist()
lv=snap[(snap.play_type.isin(['pass','run']))&(snap.penalty==1)&snap.penalty_yards.notna()&(snap.penalty_team.notna())]
lv=lv.assign(side=np.where(lv.penalty_team==lv.posteam,0,1),fd=lv.first_down_penalty.fillna(0).astype(int),yd=lv.penalty_yards.astype(int))
M['livePenRate']=float(len(lv)/len(snap)); M['livePenPool']=lv[['side','fd','yd']].sample(min(600,len(lv)),random_state=1).values.tolist()
NOTES['penalties']=f"Pre/post-snap penalties nullifying the play: {M['penRate']*100:.2f}% of snaps; penalties added onto live plays {M['livePenRate']*100:.2f}%. Team penalty rates show near-zero year-over-year and split-half reliability (within-season k~2100-3100 snaps), so league rates are used for all teams."
print(NOTES['penalties'], M['penRateDown'])
# ---------- dropback outcomes ----------
db=R[(R.qb_dropback==1)&R.down.notna()&(R.two_point_attempt==0)&(R.play_type=='pass')|((R.qb_scramble==1)&(R.two_point_attempt==0))].copy()
db['tg']=np.searchsorted([2,5,9,99],db.ydstogo)
sk=db.groupby(['down','tg']).sack.mean()
base_sack=db.sack.mean()
M['sackDT']={f'{int(a)}_{int(b)}':round(float(v/base_sack),3) for (a,b),v in sk.items() if a<=4}
M['sackBase']=float(base_sack); M['scrBase']=float(db.qb_scramble.mean())
sacks=db[db.sack==1]
M['sackYds']=sample(sacks.yards_gained.fillna(-6),800)
M['sackFumLost']=float(sacks.fumble_lost.mean())
M['sackFumTD']=float((sacks.return_touchdown==1).mean())
att=db[(db.sack==0)&(db.qb_scramble==0)&(db.pass_attempt==1)]
M['intBase']=float(att.interception.mean())
ints=att[att.interception==1]
M['intPool']=ints[['air_yards','return_yards']].fillna(0).clip(-10,110).astype(int).sample(min(600,len(ints)),random_state=2).values.tolist()
M['intTD']=float((ints.return_touchdown==1).mean())
M['throwaway']=float(((att.interception==0)&att.receiver_player_id.isna()).mean())
print('sack',base_sack,'scr',M['scrBase'],'int',M['intBase'],'pick6',M['intTD'],'throwaway',M['throwaway'],'sackFL',M['sackFumLost'])
# ---------- zone pools ----------
ZE=[2,5,10,20,100]  # zone upper edges: z0 1-2, z1 3-5, z2 6-10, z3 11-20, z4 21+
def zone(y): return np.searchsorted(ZE,y)
posmap=pd.concat([pd.read_parquet(f'{D}roster_{y}.parquet')[['gsis_id','position']] for y in (Y0,Y1,Y2)]).drop_duplicates('gsis_id',keep='last').set_index('gsis_id').position
pm=posmap.replace({'FB':'RB','HB':'RB'})
ru=R[(R.play_type=='run')&(R.qb_kneel==0)&(R.qb_scramble==0)&R.rusher_player_id.notna()&(R.two_point_attempt==0)].copy()
ru['pos']=ru.rusher_player_id.map(pm).fillna('RB'); ru.loc[~ru.pos.isin(['QB','RB','WR','TE']),'pos']='RB'
ru.loc[ru.pos=='TE','pos']='WR'
ru['z']=zone(ru.yardline_100); ru['td']=ru.rush_touchdown.fillna(0).astype(int); ru['y']=ru.yards_gained.fillna(0).astype(int)
pools={}
for (pos,z),d in ru.groupby(['pos','z']):
    pools[f'R_{pos}_{z}']=[[a,b] for a,b in zip(sample(d.y,600) if len(d)<=600 else d.y.sample(600,random_state=3).astype(int),[0]*0)] if False else d[['y','td']].sample(min(700,len(d)),random_state=3).values.tolist()
scr=db[db.qb_scramble==1].copy(); scr['z']=zone(scr.yardline_100); scr['td']=scr.rush_touchdown.fillna(0).astype(int); scr['y']=scr.yards_gained.fillna(0).astype(int)
for z,d in scr.groupby('z'): pools[f'S_{z}']=d[['y','td']].sample(min(500,len(d)),random_state=3).values.tolist()
tg=att[att.receiver_player_id.notna()&(att.interception==0)].copy()
tg['pos']=tg.receiver_player_id.map(pm).fillna('WR'); tg.loc[~tg.pos.isin(['RB','WR','TE']),'pos']='WR'
tg['z']=zone(tg.yardline_100); tg['c']=tg.complete_pass.astype(int); tg['y']=tg.yards_gained.fillna(0).astype(int); tg['td']=tg.pass_touchdown.fillna(0).astype(int)
for (pos,z),d in tg.groupby(['pos','z']):
    pools[f'T_{pos}_{z}']=d[['c','y','td']].sample(min(700,len(d)),random_state=3).values.tolist()
M['pools']=pools
print({k:len(v) for k,v in pools.items()})
# fumbles
M['rushFL']=float(ru.fumble_lost.mean()); M['recFL']=float(tg[tg.c==1].fumble_lost.mean())
fl=pd.concat([ru[ru.fumble_lost==1],tg[tg.fumble_lost==1]])
M['fumRetTD']=float((fl.return_touchdown==1).mean())
print('rushFL',M['rushFL'],'recFL',M['recFL'],'fumRetTD',M['fumRetTD'])
# rush fumbles by pos
# ---------- punts ----------
pu=R[(R.play_type=='punt')].copy()
pu['keep']=(pu.nx_posteam==pu.posteam).astype(int)
pu['td']=((pu.return_touchdown==1)&(pu.td_team!=pu.posteam)).astype(int)
pu['ktd']=((pu.touchdown==1)&(pu.td_team==pu.posteam)).astype(int)
pu['blk']=pu.punt_blocked.fillna(0).astype(int)
pu=pu[pu.nx_yardline_100.notna()|(pu.td==1)]
pu['ny']=pu.nx_yardline_100.fillna(0).astype(int)
pu['b']=np.minimum((pu.yardline_100//5).astype(int),19)
M['punt']={str(b):d[['ny','keep','td','blk']].sample(min(300,len(d)),random_state=4).values.tolist() for b,d in pu.groupby('b')}
print('punt bins',{k:len(v) for k,v in M['punt'].items()})
# ---------- kickoffs (2025+ rules) ----------
ko=R[(R.play_type=='kickoff')&(R.season>=2025)].copy()
ko['onside']=ko.desc.str.contains('onside',case=False).astype(int)
ko['keep']=(ko.nx_posteam!=ko.posteam).astype(int)  # kicking team keeps
ko['td']=((ko.return_touchdown==1)&(ko.td_team==ko.posteam)).astype(int)
ko['ktd']=((ko.touchdown==1)&(ko.td_team!=ko.posteam)).astype(int)
ko=ko[ko.nx_yardline_100.notna()|(ko.td==1)]; ko['ny']=ko.nx_yardline_100.fillna(0).astype(int)
reg=ko[ko.onside==0]; ons=ko[ko.onside==1]
M['kickoff']=reg[['ny','keep','td']].sample(min(1200,len(reg)),random_state=5).values.tolist()
M['onsideRec']=float(ons.keep.mean()) if len(ons) else 0.1
M['onside']=ons[['ny','keep']].values.tolist()
print('KO mean start',reg[reg.keep==0].ny.mean(),'retTD',reg.td.mean(),'onside n',len(ons),'rec',M['onsideRec'])
# onside usage: trailing in Q4 after score
json.dump(M,open(D+'m_league2.json','w')); json.dump(NOTES,open(D+'notes2.json','w'))
