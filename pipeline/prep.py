from config import *
# shared prep: load pbp 2024-2026, ordering, next-scrimmage info, tempo modes
from load import *
def prep():
    p=load_pbp()
    p=p[p.season_type.isin(['REG','POST'])].sort_values(['game_id','play_id']).reset_index(drop=True)
    p['is_to']=(p.timeout==1)&(p.play_type=='no_play')&p.desc.str.contains('Timeout',na=False)
    scrim=p.play_type.isin(['pass','run','qb_kneel','qb_spike','field_goal','punt'])|((p.play_type=='no_play')&~p.is_to)
    p['scrim']=scrim
    # next scrimmage posteam/yardline (strictly after)
    for c in ['posteam','yardline_100','game_seconds_remaining','qtr']:
        s=p[c].where(scrim)
        p['nx_'+c]=s.groupby(p.game_id).shift(-1)
        p['nx_'+c]=p.groupby('game_id')['nx_'+c].bfill() if False else p['nx_'+c]
    # proper bfill of next scrimmage within game
    tmp=p[['game_id']].copy()
    for c in ['posteam','yardline_100','game_seconds_remaining','qtr']:
        s=p[c].where(scrim)
        nxt=s.shift(-1).where(p.game_id.shift(-1)==p.game_id)
        # rows after may be non-scrim, need next scrim: bfill within game
        nn=s.copy(); nn=nn.groupby(p.game_id).bfill()  # current-or-later scrim value
        p['nx_'+c]=nn.groupby(p.game_id).shift(-1)
    # timeout immediately following a play (before next scrimmage)
    p['to_after']=p.is_to.shift(-1).fillna(False)&(p.game_id.shift(-1)==p.game_id)
    return p
