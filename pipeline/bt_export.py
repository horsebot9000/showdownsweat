from config import *
import pandas as pd, numpy as np, json, time, sys
from build_players import build, P, SN, RO
g=pd.read_csv(D+'games.csv')
def dk_actual(gid):
    q=P[P.game_id==gid]
    pts={}
    def add(pid,v):
        if isinstance(pid,str): pts[pid]=pts.get(pid,0)+v
    st={}
    for r in q.itertuples():
        if r.two_point_attempt==1:
            if r.two_point_conv_result=='success':
                for pid in (r.passer_player_id,r.receiver_player_id,r.rusher_player_id): add(pid,2)
            continue
        if r.play_type in ('pass','run') or r.qb_scramble==1:
            if r.passer_player_id and r.pass_attempt==1 and r.sack==0:
                add(r.passer_player_id,(r.passing_yards or 0)*0.04 if not np.isnan(r.passing_yards or 0) else 0)
                st.setdefault(r.passer_player_id,[0,0,0])[0]+= (0 if np.isnan(r.passing_yards) else r.passing_yards)
                if r.pass_touchdown==1 and r.td_team==r.posteam: add(r.passer_player_id,4)
                if r.interception==1: add(r.passer_player_id,-1)
            if isinstance(r.receiver_player_id,str) and r.complete_pass==1:
                y=0 if np.isnan(r.receiving_yards) else r.receiving_yards
                add(r.receiver_player_id,1+0.1*y); st.setdefault(r.receiver_player_id,[0,0,0])[2]+=y
                if r.pass_touchdown==1 and r.td_player_id==r.receiver_player_id: add(r.receiver_player_id,6)
            if isinstance(r.rusher_player_id,str) and r.rush_attempt==1:
                y=0 if np.isnan(r.rushing_yards) else r.rushing_yards
                add(r.rusher_player_id,0.1*y); st.setdefault(r.rusher_player_id,[0,0,0])[1]+=y
                if r.rush_touchdown==1 and r.td_player_id==r.rusher_player_id: add(r.rusher_player_id,6)
        if r.fumble_lost==1 and isinstance(r.fumbled_1_player_id,str): add(r.fumbled_1_player_id,-1)
        if r.return_touchdown==1 and r.play_type in ('punt','kickoff') and isinstance(r.td_player_id,str): add(r.td_player_id,6)
    for pid,(py,ry,rcy) in st.items():
        add(pid,3*(py>=300)+3*(ry>=100)+3*(rcy>=100))
    # kickers
    for r in q[q.play_type.isin(['field_goal','extra_point'])].itertuples():
        if r.play_type=='extra_point' and r.extra_point_result=='good': add(r.kicker_player_id,1)
        if r.play_type=='field_goal' and r.field_goal_result=='made': d=r.kick_distance; add(r.kicker_player_id,3 if d<40 else 4 if d<50 else 5)
    # DST
    home,away=q.home_team.iloc[0],q.away_team.iloc[0]
    hs,as_=q.home_score.iloc[0],q.away_score.iloc[0]
    for tm,opp,oppscore in ((home,away,as_),(away,home,hs)):
        d=q[q.defteam==tm]; o=q[q.posteam==tm]
        v=d.sack.sum()+2*d.interception.sum()
        v+=2*((d.fumble_lost==1)).sum()
        dtd=((d.return_touchdown==1)&(d.td_team==tm)&d.play_type.isin(['pass','run'])).sum()
        stt=((q.return_touchdown==1)&(q.td_team==tm)&q.play_type.isin(['punt','kickoff'])).sum()
        v+=6*(dtd+stt)+2*(d.safety==1).sum()
        v+=2*((d.punt_blocked==1).sum()+(d.field_goal_result=='blocked').sum())
        # PA excludes opp defensive TDs (approx 7 each)
        odtd=((o.return_touchdown==1)&(o.td_team==opp)&o.play_type.isin(['pass','run'])).sum()
        pa=oppscore-7*odtd
        v+= 10 if pa==0 else 7 if pa<=6 else 4 if pa<=13 else 1 if pa<=20 else 0 if pa<=27 else -1 if pa<=34 else -4
        pts['DST_'+tm]=v
    return pts
def export(season,week,cut_t,maxg=None):
    out,T=build(cut_t,season)
    gs=g[(g.season==season)&(g.week==week)&(g.game_type=='REG')]
    if maxg: gs=gs.head(maxg)
    res=[]
    rw=RO[(RO.season==season)&(RO.week==week)]
    for r in gs.itertuples():
        sn=SN[SN.game_id==r.game_id]
        hi=(r.total_line+r.spread_line)/2; ai=r.total_line-hi
        act=dk_actual(r.game_id)
        pl=[]
        q=P[P.game_id==r.game_id]
        for tm in (r.away_team,r.home_team):
            s=sn[(sn.team==tm)&(sn.offense_snaps>0)&sn.position.isin(['QB','RB','WR','TE','FB'])]
            qbs=s[s.position=='QB'].sort_values('offense_snaps',ascending=False)
            for x in s.itertuples():
                pid=x.pid
                if not isinstance(pid,str): continue
                e=out.get(pid,{})
                pos='RB' if x.position=='FB' else x.position
                pl.append(dict(name=x.player,team=tm,pos=pos,mid=pid,active=True,rs=e.get('rs',{'QB':0.05,'RB':0.04}.get(pos,0.005)),ts=e.get('ts',{'QB':0}.get(pos,0.015)),
                    rsz=e.get('rsz',e.get('rs',0.02)),tsz=e.get('tsz',e.get('ts',0.015)),rsy=e.get('rsy',e.get('rs',0.02)),tpd=e.get('tpd',e.get('ts',0.015)),nr=e.get('nr',0),nt=e.get('nt',0),isStarterQB=int(pos=='QB' and pid==(qbs.pid.iloc[0] if len(qbs) else None)),
                    act=round(act.get(pid,0),2),snaps=int(x.offense_snaps)))
            kk=q[(q.posteam==tm)&q.kicker_player_id.notna()].kicker_player_id
            if len(kk): pl.append(dict(name='K_'+tm,team=tm,pos='K',mid=kk.iloc[0],active=True,act=act.get(kk.iloc[0],0)))
            pl.append(dict(name='DST_'+tm,team=tm,pos='DST',mid=tm,active=True,act=act.get('DST_'+tm,0)))
        res.append(dict(game=r.game_id,teams=[r.away_team,r.home_team],implied=[ai,hi],actual=[r.away_score,r.home_score],players=pl))
    return out,T,res
if __name__=='__main__':
    from assemble import assemble
    weeks=[(Y1,w) for w in (6,8,10,12,14,16)]+[(Y2,w) for w in (2,3,4)]
    allg=[]
    for i,(S,W) in enumerate(weeks):
        t0=time.time(); cut=(S-Y0)*18+W
        out,T,res=export(S,W,cut)
        assemble(dict(players=out,teams=T),D+f'bt_model_{S}_{W}.json')
        for r in res: r['model']=f'bt_model_{S}_{W}.json'
        allg+=res; print(S,W,len(res),round(time.time()-t0,1),flush=True)
    json.dump(allg,open(D+'bt_games.json','w'))
