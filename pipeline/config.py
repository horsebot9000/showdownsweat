"""Shared paths and the season/week being simulated. Everything is relative to this project folder,
so the folder can live anywhere. The season and week are detected from the nflverse schedule:
WEEK = the earliest regular-season week of the current season that still has unplayed games.
Override with environment variables SIM_SEASON / SIM_WEEK if ever needed."""
import os, datetime
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(ROOT, 'data') + os.sep
OUT = os.path.join(ROOT, 'output') + os.sep
SLATES = os.path.join(ROOT, 'slates') + os.sep
HERE = os.path.dirname(os.path.abspath(__file__)) + os.sep

def season_week():
    s, w = os.environ.get('SIM_SEASON'), os.environ.get('SIM_WEEK')
    if s and w: return int(s), int(w)
    import pandas as pd
    g = pd.read_csv(D + 'games.csv'); g = g[g.game_type == 'REG']
    today = datetime.date.today().isoformat()
    started = g[g.gameday <= today]
    S = int(started.season.max()) if len(started) else int(g.season.max())
    if s: S = int(s)
    un = g[(g.season == S) & g.home_score.isna()]
    W = int(un.week.min()) if len(un) else 19
    return S, (int(w) if w else W)

SEASON, WEEK = season_week()
Y2, Y1, Y0 = SEASON, SEASON - 1, SEASON - 2          # the three seasons the models use
YEARS = (Y0, Y1, Y2)
def tidx(season, week): return (season - Y0) * 18 + week   # running week index used by the usage model
