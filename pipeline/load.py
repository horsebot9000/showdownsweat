from config import *
import pandas as pd, numpy as np
COLS=None
def load_pbp(years=(Y0,Y1,Y2)):
    fs=[pd.read_parquet(f'{D}pbp_{y}.parquet') for y in years]
    p=pd.concat(fs,ignore_index=True)
    return p
def player_games(p):
    """per game per team per player: designed rushes, targets, team totals"""
    q=p[(p.season_type=='REG')]
    runs=q[(q.play_type=='run')&(q.qb_kneel==0)&(q.rush_attempt==1)&(q.qb_scramble==0)]
    tg=q[(q.play_type=='pass')&q.receiver_player_id.notna()&(q.sack==0)]
    r=runs.groupby(['season','week','game_id','posteam','rusher_player_id']).size().rename('rush').reset_index().rename(columns={'rusher_player_id':'pid'})
    t=tg.groupby(['season','week','game_id','posteam','receiver_player_id']).size().rename('tgt').reset_index().rename(columns={'receiver_player_id':'pid'})
    m=r.merge(t,how='outer',on=['season','week','game_id','posteam','pid']).fillna({'rush':0,'tgt':0})
    tr=runs.groupby(['game_id','posteam']).size().rename('team_rush')
    tt=tg.groupby(['game_id','posteam']).size().rename('team_tgt')
    m=m.join(tr,on=['game_id','posteam']).join(tt,on=['game_id','posteam'])
    m['rs']=m.rush/m.team_rush; m['ts']=m.tgt/m.team_tgt
    return m
