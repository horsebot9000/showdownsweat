"""Build both single-file labs into output/. The page opens with an example slate: the newest DraftKings
salary CSV in slates/ of the right type (showdown has CPT rows), else the bundled sample."""
from config import *
import json, os, glob
M = json.load(open(D + 'model.json'))
try: M['meta']['backtest'] = json.load(open(D + 'bt_summary.json'))
except Exception: pass
MJ = json.dumps(M, separators=(',', ':')).replace('</', '<\\/')
LOGS = open(D + 'logs.json').read().replace('</', '<\\/')
rd = lambda f: open(HERE + f, encoding='utf-8').read()

def pick_slate(showdown):
    best = None
    for f in sorted(glob.glob(SLATES + '*.csv'), key=os.path.getmtime, reverse=True):
        try: txt = open(f, encoding='utf-8-sig').read()
        except Exception: continue
        if 'Roster Position' not in txt: continue
        is_sd = ',CPT,' in txt
        if is_sd == showdown: best = (f, txt); break
    if best: return best
    f = HERE + 'samples/' + ('showdown_sample.csv' if showdown else 'classic_sample.csv')
    return f, open(f, encoding='utf-8-sig').read()

MDEF = "const MODEL=JSON.parse($('#model-data').textContent);"
def withwx(src):  # weather helpers live inside the app's scope, right after MODEL is defined
    assert MDEF in src; return src.replace(MDEF, MDEF + '\n' + rd('weather.js') + '\n' + rd('qstatus.js') + '\n' + rd('props.js').replace("/*RELAYSRC*/''", json.dumps(open(os.path.join(ROOT, 'kalshi_relay.gs'), encoding='utf-8').read()).replace('</', '<\\/'), 1), 1)
def fill(t, rep):
    for k, v in rep.items(): t = t.replace(k, v, 1)
    return t
os.makedirs(OUT, exist_ok=True)
# showdown
f1, s1 = pick_slate(True)
sd = fill(rd('template.html'), {'/*CSS*/': rd('app.css'), '/*MODEL*/': MJ, '/*ENGINE*/': rd('engine.js'), '/*SLATE*/': rd('slate.js'), '/*WORKER*/': rd('worker.js'),
          '/*SAMPLE*/': s1.replace('</', '<\\/'), '/*APP*/': rd('table_sort.js') + '\n' + withwx(rd('app.js')), '/*LOGS*/': LOGS})
open(OUT + 'showdown-sim-lab.html', 'w', encoding='utf-8').write(sd)
# classic (player cards + team colors are shared from the showdown app)
a = rd('app.js')
cards = a[a.index('let LOGS=null'):a.index("document.addEventListener('keydown'")]
cards += "document.addEventListener('keydown',(ev)=>{if(ev.key==='Escape'&&!$('#pcard').hidden) closeCard();});\n"
cards = cards.replace("<div><span class=\"lbl\">CPT opt</span><span class=\"num cptc\">${pct(s.cpt)}</span></div><div><span class=\"lbl\">FLEX opt</span><span class=\"num\">${pct(s.flex)}</span></div>", "<div><span class=\"lbl\">Optimal</span><span class=\"num\">${pct(s.opt)}</span></div>${p.own!=null?`<div><span class=\"lbl\">Proj own</span><span class=\"num\">${pct(p.own)}</span></div>`:''}")
cards = cards.replace("FLEX $${(p.salF||0).toLocaleString()} · CPT $${(p.salC||0).toLocaleString()}", "$${(p.salF||0).toLocaleString()} · vs ${esc(oppOf(p))}")
assert 'pct(s.opt)' in cards and 'oppOf(p)' in cards
tc = a[a.index('const TEAM_COL='):a.index('function applyTeamColors')]
livefn = a[a.index('/*LIVEFN-START*/'):a.index('/*LIVEFN-END*/')]
app = rd('app_classic.js').replace('/*CARDS*/', cards, 1).replace('/*TEAMCOL*/', tc, 1)
END = 'boot();\n})();'; assert app.rstrip().endswith(END)
app = app.rstrip()[:-len(END)] + livefn + '\n' + rd('live_classic.js') + '\n' + END + '\n'  # live code inside the app's scope
f2, s2 = pick_slate(False)
cl = fill(rd('template_classic.html'), {'/*CSS*/': rd('app.css'), '/*MODEL*/': MJ, '/*ENGINE*/': rd('engine.js'), '/*SLATE*/': rd('slate.js'), '/*WORKER*/': rd('classic_worker.js'),
          '/*SAMPLE*/': s2.replace('</', '<\\/'), '/*APP*/': rd('table_sort.js') + '\n' + withwx(app), '/*LOGS*/': LOGS})
open(OUT + 'classic-sim-lab.html', 'w', encoding='utf-8').write(cl)
# Showdown Sweat: the showdown app with only the live sweat on screen
END = 'boot();\n})();'; sa = rd('app.js'); assert sa.rstrip().endswith(END)
sa = sa.rstrip()[:-len(END)] + rd('sweat.js') + '\n' + END + '\n'
SWCSS = 'body.sweat section.controls,body.sweat nav.tabs,body.sweat header.top,body.sweat .pane:not(#pane-live){display:none!important}body.sweat.sw-ready #pane-live{display:block!important}body.sweat:not(.sw-ready) #pane-live{display:none!important}'
sw = fill(rd('template.html'), {'/*CSS*/': rd('app.css') + SWCSS, '/*MODEL*/': MJ, '/*ENGINE*/': rd('engine.js'), '/*SLATE*/': rd('slate.js'), '/*WORKER*/': rd('worker.js'),
          '/*SAMPLE*/': s1.replace('</', '<\\/'), '/*APP*/': rd('table_sort.js') + '\n' + withwx(sa), '/*LOGS*/': LOGS}).replace('<title>Showdown Sim Lab</title>', '<title>Showdown Sweat</title>', 1)
open(OUT + 'showdown-sweat.html', 'w', encoding='utf-8').write(sw)
print(f'showdown-sweat.html   {len(sw)/1e6:.2f} MB')
print(f'showdown-sim-lab.html {len(sd)/1e6:.2f} MB (opens with {os.path.basename(f1)})')
print(f'classic-sim-lab.html  {len(cl)/1e6:.2f} MB (opens with {os.path.basename(f2)})')
