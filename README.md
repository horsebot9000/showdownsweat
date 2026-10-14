# Showdown Sweat

Live sweat for DraftKings NFL Showdown contests: enter your DraftKings username, paste contest links, drop each contest's
standings .zip after lock. Contest fee and payouts, players, the line and live ESPN stats load automatically, and the rest
of the game is simulated play by play with every contest re-ranked.

The page is `index.html` (self-contained; GitHub Pages serves it). Everything else rebuilds it.

## Weekly refresh
`.github/workflows/refresh.yml` runs every Tuesday at 7 AM Eastern: downloads nflverse data, refits the model,
rebuilds the page and commits the new `index.html`. Run it by hand from Actions > Refresh model > Run workflow.

## Setup (once)
1. Upload everything in this folder to a GitHub repo (keep the `.github` folder).
2. Settings > Pages: Deploy from a branch, `main`, `/ (root)`.
3. Settings > Actions > General > Workflow permissions: Read and write permissions.
4. Actions tab: enable workflows if asked, then Run workflow once to check it.

Local run: `python refresh.py` builds `output/showdown-sweat.html` (plus the Sim Labs).
