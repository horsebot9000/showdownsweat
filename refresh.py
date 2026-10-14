"""One-click refresh for the NFL Sim Lab (showdown + classic).

Double-click "Refresh (Windows).bat" or "Refresh (Mac).command", or run:  python refresh.py

What it does, start to finish:
  1. Installs any missing Python packages (first run only).
  2. Downloads the latest nflverse data (schedule, play-by-play, rosters, snap counts).
     Past seasons are downloaded once; the current season is refreshed every run.
  3. Detects the season and the next week to simulate from the schedule (no editing needed).
  4. Refits everything: league models (only if older than 6 days), player usage, game logs,
     injury exit rates, defensive funnels, then assembles the model.
  5. Builds output/showdown-sim-lab.html and output/classic-sim-lab.html.

Options:  --full   refit the league models even if they are recent
          --ci     no prompts, no opening folders (for scheduled runs)
"""
import os, sys, subprocess, time, shutil, urllib.request, importlib.util

ROOT = os.path.dirname(os.path.abspath(__file__))
PIPE = os.path.join(ROOT, 'pipeline')
DATA = os.path.join(ROOT, 'data')
OUT = os.path.join(ROOT, 'output')
LOG = os.path.join(ROOT, 'refresh.log')
BASE = 'https://github.com/nflverse/nflverse-data/releases/download'
PKGS = {'pandas': 'pandas', 'numpy': 'numpy', 'pyarrow': 'pyarrow', 'sklearn': 'scikit-learn', 'scipy': 'scipy'}
ARGS = set(sys.argv[1:])

def say(msg): print(msg, flush=True)

def ensure_packages():
    missing = [pip for mod, pip in PKGS.items() if importlib.util.find_spec(mod) is None]
    if not missing: return
    say(f'Installing Python packages (first run only): {", ".join(missing)}')
    cmd = [sys.executable, '-m', 'pip', 'install', '--upgrade'] + missing
    r = subprocess.run(cmd)
    if r.returncode != 0:  # some systems need --user or --break-system-packages
        r = subprocess.run(cmd + ['--user'])
    if r.returncode != 0:
        r = subprocess.run(cmd + ['--break-system-packages'])
    if r.returncode != 0: fail('Could not install Python packages: ' + ' '.join(missing))

def fetch(url, dest, required=True):
    tmp = dest + '.part'
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'nfl-sim-lab'})
            with urllib.request.urlopen(req, timeout=120) as r, open(tmp, 'wb') as f: shutil.copyfileobj(r, f)
            os.replace(tmp, dest); return True
        except Exception as e:
            if getattr(e, 'code', None) == 404: break
            time.sleep(2 + 3 * attempt)
    if os.path.exists(tmp): os.remove(tmp)
    if required and not os.path.exists(dest): fail(f'Download failed: {url}')
    return False

def download():
    os.makedirs(DATA, exist_ok=True)
    say('Downloading schedule…'); fetch(f'{BASE}/schedules/games.csv', os.path.join(DATA, 'games.csv'))
    sys.path.insert(0, PIPE)
    import config  # detects season/week from the schedule just downloaded
    say(f'Season {config.SEASON}, simulating week {config.WEEK}')
    files = lambda y: [(f'{BASE}/pbp/play_by_play_{y}.parquet', f'pbp_{y}.parquet', True),
                       (f'{BASE}/weekly_rosters/roster_weekly_{y}.parquet', f'roster_{y}.parquet', True),
                       (f'{BASE}/snap_counts/snap_counts_{y}.parquet', f'snaps_{y}.parquet', True),
                       (f'{BASE}/pbp_participation/pbp_participation_{y}.parquet', f'part_{y}.parquet', False)]
    for y in config.YEARS:
        current = y == config.SEASON
        for url, name, req in files(y):
            dest = os.path.join(DATA, name)
            if os.path.exists(dest) and os.path.getsize(dest) > 1000 and not current: continue
            say(f'  {name}'); fetch(url, dest, required=req)
    return config

def fresh(name, days=6):
    f = os.path.join(DATA, name)
    return os.path.exists(f) and time.time() - os.path.getmtime(f) < days * 86400

def run(script, label):
    t0 = time.time(); say(f'{label}…')
    with open(LOG, 'a', encoding='utf-8') as lg:
        lg.write(f'\n===== {script} =====\n'); lg.flush()
        r = subprocess.run([sys.executable, script], cwd=PIPE, stdout=lg, stderr=subprocess.STDOUT)
    if r.returncode != 0: fail(f'{script} failed. Details are at the end of refresh.log')
    say(f'  done in {time.time() - t0:.0f}s')

def fail(msg):
    say('\nREFRESH STOPPED: ' + msg)
    if '--ci' not in ARGS: input('Press Enter to close')
    sys.exit(1)

def main():
    t0 = time.time()
    open(LOG, 'w').close()
    ensure_packages()
    cfg = download()
    for f in ('hurry.json', 'bt_summary.json'):  # fixed fits that ship with the project
        if not os.path.exists(os.path.join(DATA, f)): shutil.copy(os.path.join(PIPE, 'samples', f), DATA)
    run('prep_run.py', 'Preparing play-by-play')
    league_ok = all(fresh(f) for f in ('m_league1.json', 'm_league2.json', 'inj_snaps.json'))
    if '--full' in ARGS or not league_ok:
        run('fit_league.py', 'Fitting league models (pass/run, 4th down, kicking; slowest step)')
        run('fit_league2.py', 'Fitting clock, penalties, yardage pools')
        run('add_oob.py', 'Out-of-bounds rates')
        run('fit_injuries.py', 'Injury exit rates')
    else:
        say('League models are less than 6 days old, reusing them (use --full to refit)')
    run('build_players.py', f'Player usage through week {cfg.WEEK - 1}')
    run('build_logs.py', 'Player card game logs')
    run('fit_defense.py', 'Defensive funnels (current season only)')
    run('assemble.py', 'Assembling model')
    run('build_web.py', 'Building the labs')
    say(f'\nDone in {(time.time() - t0) / 60:.1f} min. Open these in your browser:')
    for f in ('showdown-sim-lab.html', 'classic-sim-lab.html'): say('  ' + os.path.join(OUT, f))
    if '--ci' not in ARGS:
        try:
            if sys.platform.startswith('win'): os.startfile(OUT)
            elif sys.platform == 'darwin': subprocess.run(['open', OUT])
        except Exception: pass
        input('\nPress Enter to close')

if __name__ == '__main__':
    main()
