from config import *
import pandas as pd, numpy as np, json
P=pd.read_pickle(D+'pbp_prep.pkl'); P=P[P.season_type=='REG'].copy()
P['t']=(P.season-Y0)*18+P.week
RO=pd.concat([pd.read_parquet(f'{D}roster_{y}.parquet') for y in (Y0,Y1,Y2)])
RO['t']=(RO.season-Y0)*18+RO.week
SN=pd.concat([pd.read_parquet(f'{D}snaps_{y}.parquet') for y in (Y0,Y1,Y2)]); SN=SN[SN.game_type=='REG']
SN['t']=(SN.season-Y0)*18+SN.week
pfr2g=RO.dropna(subset=['pfr_id']).drop_duplicates('pfr_id',keep='last').set_index('pfr_id').gsis_id
SN['pid']=SN.pfr_player_id.map(pfr2g)
SEASON_W={0:1.0,1:0.35,2:0.1}
K=dict(rush_eff=217,tgt_eff=62,qb_sack=372,qb_scr=73,qb_int=891,proe=254,def_sack=1765,def_int=2626,rz=25)
def build(cut_t, season_now):
    p=P[P.t<cut_t]; sn=SN[SN.t<cut_t]
    blow=((p.qtr==4)&(p.score_differential.abs()>=17))|((p.qtr==4)&(p.score_differential.abs()>=14)&(p.game_seconds_remaining<420))
    hurry=((p.qtr==2)&(p.half_seconds_remaining<=120))|((p.qtr==4)&(p.score_differential<0)&(p.half_seconds_remaining<=300))
    p=p.assign(blow=blow,sy=p.down.isin([3,4])&(p.ydstogo<=2)&(p.yardline_100>10),pd_=(p.down.isin([3,4])&(p.ydstogo>=5))|hurry)
    p=p[~p.blow]
    sw=lambda s: s.map(lambda x: SEASON_W.get(season_now-x,0.0))
    runs=p[(p.play_type=='run')&(p.qb_kneel==0)&(p.qb_scramble==0)&p.rusher_player_id.notna()&(p.two_point_attempt==0)]
    tg=p[(p.play_type=='pass')&p.receiver_player_id.notna()&(p.sack==0)&(p.two_point_attempt==0)]
    # team totals per game
    tr=runs.groupby(['game_id','posteam']).size().rename('TR'); tt=tg.groupby(['game_id','posteam']).size().rename('TT')
    trs=runs[runs.sy].groupby(['game_id','posteam']).size().rename('TRS'); ttp=tg[tg.pd_].groupby(['game_id','posteam']).size().rename('TTP')
    rsy=runs[runs.sy].groupby(['game_id','posteam','rusher_player_id']).size().rename('rsy'); tpd=tg[tg.pd_].groupby(['game_id','posteam','receiver_player_id']).size().rename('tpd')
    trz=runs[runs.yardline_100<=10].groupby(['game_id','posteam']).size().rename('TRZ'); ttz=tg[tg.yardline_100<=10].groupby(['game_id','posteam']).size().rename('TTZ')
    r=runs.groupby(['game_id','posteam','rusher_player_id']).size().rename('r'); rz=runs[runs.yardline_100<=10].groupby(['game_id','posteam','rusher_player_id']).size().rename('rz')
    t=tg.groupby(['game_id','posteam','receiver_player_id']).size().rename('tg'); tz=tg[tg.yardline_100<=10].groupby(['game_id','posteam','receiver_player_id']).size().rename('tz')
    r.index.names=t.index.names=rz.index.names=tz.index.names=rsy.index.names=tpd.index.names=['game_id','posteam','pid']
    u=pd.concat([r,rz,t,tz,rsy,tpd],axis=1).fillna(0).reset_index()
    # add zero-usage games from snaps (offense snaps>0)
    s=sn[(sn.offense_snaps>0)&sn.pid.notna()][['game_id','team','pid']].rename(columns={'team':'posteam'})
    u=s.merge(u,how='outer',on=['game_id','posteam','pid']).fillna({'r':0,'rz':0,'tg':0,'tz':0,'rsy':0,'tpd':0})
    gi=p.drop_duplicates('game_id').set_index('game_id')[['t','season']]
    u=u.join(gi,on='game_id').join(tr,on=['game_id','posteam']).join(tt,on=['game_id','posteam']).join(trz,on=['game_id','posteam']).join(ttz,on=['game_id','posteam']).join(trs,on=['game_id','posteam']).join(ttp,on=['game_id','posteam'])
    u=u[u.t.notna()&u.TR.notna()&u.TT.notna()].fillna({'TRZ':0,'TTZ':0,'TRS':0,'TTP':0})
    age=cut_t-u.t; seasw=sw(u.season)
    u['wr']=0.88**age*np.where(u.season==season_now,1,0.25**(season_now-u.season))
    u['wt']=0.93**age*np.where(u.season==season_now,1,0.40**(season_now-u.season))
    u['rs']=u.r/u.TR; u['ts']=u.tg/u.TT
    def agg(d):
        wr=d.wr.sum(); wt=d.wt.sum()
        rs=(d.wr*d.rs).sum()/wr if wr>0 else 0; ts=(d.wt*d.ts).sum()/wt if wt>0 else 0
        # rz: pooled weighted counts
        rzn=(d.wr*d.TRZ).sum(); rzr=(d.wr*d.rz).sum(); tzn=(d.wt*d.TTZ).sum(); tzt=(d.wt*d.tz).sum()
        rsz=(rzr+K['rz']*rs)/(rzn+K['rz']); tsz=(tzt+K['rz']*ts)/(tzn+K['rz'])
        rsy_=((d.wr*d.rsy).sum()+8*rs)/((d.wr*d.TRS).sum()+8); tpd_=((d.wt*d.tpd).sum()+30*ts)/((d.wt*d.TTP).sum()+30)
        lastteam=d.sort_values('t').posteam.iloc[-1]
        return pd.Series(dict(nr=wr,nt=wt,rs=rs,ts=ts,rsz=rsz,tsz=tsz,rsy=rsy_,tpd=tpd_,g=len(d),gcur=int((d.season==season_now).sum()),lt=lastteam))
    S=u.groupby('pid').apply(agg,include_groups=False)
    # efficiency pools (open field, last N) & n_eff
    ro=RO[RO.t<cut_t+1].sort_values('t').drop_duplicates('gsis_id',keep='last').set_index('gsis_id')
    out={}
    of_r=runs[runs.yardline_100>20].sort_values('t'); of_t=tg[(tg.yardline_100>20)&(tg.interception==0)].sort_values('t')
    gr=of_r.groupby('rusher_player_id'); gt=of_t.groupby('receiver_player_id')
    rr_n=runs.assign(w=sw(runs.season)).groupby('rusher_player_id').w.sum()
    tt_n=tg.assign(w=sw(tg.season)).groupby('receiver_player_id').w.sum()
    for pid,row in S.iterrows():
        if pid not in ro.index: continue
        rr=ro.loc[pid]; pos=rr.position
        if pos in ('FB','HB'): pos='RB'
        if pos not in ('QB','RB','WR','TE'): continue
        e=dict(id=pid,n=rr.full_name,tm=rr.team if rr.team else row.lt,pos=pos,rs=round(row.rs,4),ts=round(row.ts,4),rsz=round(row.rsz,4),tsz=round(row.tsz,4),rsy=round(row.rsy,4),tpd=round(row.tpd if pos=='RB' else row.ts,4),nr=round(row.nr,2),nt=round(row.nt,2),g=int(row.g),gc=int(row.gcur))
        if pid in gr.groups:
            y=gr.get_group(pid).yards_gained.fillna(0).astype(int).values[-150:]; e['rp']=y.tolist(); e['rn']=round(float(rr_n.get(pid,0)),1)
        if pid in gt.groups:
            d=gt.get_group(pid).tail(150); e['tp']=d[['complete_pass','yards_gained','pass_touchdown']].fillna(0).astype(int).values.ravel().tolist(); e['tn']=round(float(tt_n.get(pid,0)),1)
        out[pid]=e
    # QB params
    db=p[((p.qb_dropback==1)&(p.play_type=='pass'))|(p.qb_scramble==1)].copy(); db['qb']=db.passer_player_id.fillna(db.rusher_player_id); db['w']=sw(db.season)
    db=db[db.two_point_attempt==0]
    L=dict(sack=db.sack.mean(),scr=db.qb_scramble.mean())
    att=db[(db.sack==0)&(db.qb_scramble==0)]; L['int']=att.interception.mean()
    for q,d in db.groupby('qb'):
        if q not in out: continue
        n=d.w.sum(); a=d[(d.sack==0)&(d.qb_scramble==0)]; na=a.w.sum()
        out[q]['sk']=round(((d.w*d.sack).sum()+K['qb_sack']*L['sack'])/(n+K['qb_sack']),4)
        out[q]['sc']=round(((d.w*d.qb_scramble).sum()+K['qb_scr']*L['scr'])/(n+K['qb_scr']),4)
        out[q]['it']=round(((a.w*a.interception).sum()+K['qb_int']*L['int'])/(na+K['qb_int']),4)
        out[q]['db']=round(float(n),1)
    # team params
    sc=p[p.play_type.isin(['pass','run'])&(p.qb_kneel==0)&(p.qb_spike==0)&p.pass_oe.notna()].copy(); sc['w']=sw(sc.season)
    T={}
    for tm,d in sc.groupby('posteam'):
        proe=(d.w*d.pass_oe/100).sum()/(d.w.sum()+K['proe'])
        T[tm]=dict(proe=round(proe,4))
    for tm,d in sc.groupby('defteam'):
        n=d.w.sum(); T[tm]['dsk']=round((((d.w*d.sack).sum()+K['def_sack']*sc.sack.mean())/(n+K['def_sack']))/sc.sack.mean(),3)
    at=p[(p.pass_attempt==1)&(p.sack==0)].copy(); at['w']=sw(at.season)
    for tm,d in at.groupby('defteam'):
        n=d.w.sum(); T[tm]['dint']=round((((d.w*d.interception).sum()+K['def_int']*at.interception.mean())/(n+K['def_int']))/at.interception.mean(),3)
    # returners (current season weighted)
    kr=p[(p.play_type=='kickoff')&p.kickoff_returner_player_id.notna()]; pr=p[(p.play_type=='punt')&p.punt_returner_player_id.notna()]
    for nm,d,col in (('kr',kr,'kickoff_returner_player_id'),('pr',pr,'punt_returner_player_id')):
        d=d.assign(w=sw(d.season)*0.9**(cut_t-d.t))
        for tm,dd in d.groupby('posteam'):
            s=dd.groupby(col).w.sum(); s=s/s.sum(); T.setdefault(tm,{})[nm]={k:round(v,3) for k,v in s.items() if v>0.08}
    # kickers: latest kicker per team
    k=p[p.play_type.isin(['field_goal','extra_point'])&p.kicker_player_id.notna()].sort_values('t')
    for tm,d in k.groupby('posteam'): T[tm]['k']=d.kicker_player_id.iloc[-1]
    return out,T
if __name__=='__main__':
    import sys
    out,T=build(cut_t=tidx(SEASON,WEEK), season_now=SEASON)
    print(len(out)); 
    for pid,e in out.items():
        if e['tm'] in ('DAL','TB') and (e['rs']>0.02 or e['ts']>0.03): print(e['n'],e['tm'],e['pos'],e['rs'],e['ts'],e['rsz'],e['tsz'],e['g'],e['gc'],e.get('sk'),e.get('sc'),e.get('it'))
    print(T['DAL'],T['TB'])
    json.dump(dict(players=out,teams=T),open(D+'players_live.json','w'))
