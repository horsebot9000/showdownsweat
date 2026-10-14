# Stadium coordinates (city-level accuracy is plenty for a weather forecast) and roof type.
# roof: 'out' open air, 'dome' fixed roof or canopy, 'retract' retractable (assumed closed in bad weather).
VENUES = {
 'AT&T Stadium': (32.7473, -97.0945, 'retract'), 'Acrisure Stadium': (40.4468, -80.0158, 'out'),
 'Allegiant Stadium': (36.0909, -115.1833, 'dome'), 'Bank of America Stadium': (35.2258, -80.8528, 'out'),
 'Caesars Superdome': (29.9511, -90.0812, 'dome'), 'Mercedes-Benz Superdome': (29.9511, -90.0812, 'dome'),
 'Empower Field at Mile High': (39.7439, -105.0201, 'out'), 'EverBank Stadium': (30.3239, -81.6373, 'out'),
 'TIAA Bank Stadium': (30.3239, -81.6373, 'out'), 'FedExField': (38.9078, -76.8645, 'out'), 'Northwest Stadium': (38.9078, -76.8645, 'out'),
 'FirstEnergy Stadium': (41.5061, -81.6995, 'out'), 'Huntington Bank Field': (41.5061, -81.6995, 'out'), 'Ford Field': (42.3400, -83.0456, 'dome'),
 'GEHA Field at Arrowhead Stadium': (39.0489, -94.4839, 'out'), 'Arrowhead Stadium': (39.0489, -94.4839, 'out'), 'Gillette Stadium': (42.0909, -71.2643, 'out'),
 'Hard Rock Stadium': (25.9580, -80.2389, 'out'), 'Highmark Stadium': (42.7738, -78.7870, 'out'), 'New Era Field': (42.7738, -78.7870, 'out'),
 'Lambeau Field': (44.5013, -88.0622, 'out'), "Levi's Stadium": (37.4030, -121.9700, 'out'), 'Lincoln Financial Field': (39.9008, -75.1675, 'out'),
 'Lucas Oil Stadium': (39.7601, -86.1639, 'retract'), 'Lumen Field': (47.5952, -122.3316, 'out'), 'M&T Bank Stadium': (39.2780, -76.6227, 'out'),
 'Mercedes-Benz Stadium': (33.7554, -84.4009, 'retract'), 'MetLife Stadium': (40.8135, -74.0745, 'out'), 'NRG Stadium': (29.6847, -95.4107, 'retract'),
 'Reliant Stadium': (29.6847, -95.4107, 'retract'), 'Nissan Stadium': (36.1665, -86.7713, 'out'), 'Paycor Stadium': (39.0955, -84.5161, 'out'),
 'Raymond James Stadium': (27.9759, -82.5033, 'out'), 'SoFi Stadium': (33.9535, -118.3392, 'dome'), 'Soldier Field': (41.8623, -87.6167, 'out'),
 'State Farm Stadium': (33.5276, -112.2626, 'retract'), 'U.S. Bank Stadium': (44.9737, -93.2581, 'dome'),
 # international / neutral sites
 'Tottenham Hotspur Stadium': (51.6043, -0.0664, 'out'), 'Wembley Stadium': (51.5560, -0.2796, 'out'), 'Bernabeu': (40.4531, -3.6883, 'retract'),
 'Santiago Bernabeu': (40.4531, -3.6883, 'retract'), 'Estadio Banorte': (19.3029, -99.1505, 'out'), 'Estadio Azteca': (19.3029, -99.1505, 'out'),
 'FC Bayern Munich Stadium': (48.2188, 11.6247, 'out'), 'Allianz Arena': (48.2188, 11.6247, 'out'), 'Deutsche Bank Park': (50.0686, 8.6455, 'out'),
 'Olympiastadion': (52.5147, 13.2395, 'out'), 'Stade de France': (48.9245, 2.3602, 'out'), 'Maracana Stadium': (-22.9122, -43.2302, 'out'),
 'Arena Corinthians': (-23.5453, -46.4742, 'out'), 'Neo Quimica Arena': (-23.5453, -46.4742, 'out'), 'Melbourne Cricket Ground': (-37.8200, 144.9834, 'out'),
 'Croke Park': (53.3607, -6.2511, 'out'),
}
# a team's usual home venue, used when the schedule names a stadium not in the table
HOME = {'ARI':'State Farm Stadium','ATL':'Mercedes-Benz Stadium','BAL':'M&T Bank Stadium','BUF':'Highmark Stadium','CAR':'Bank of America Stadium',
 'CHI':'Soldier Field','CIN':'Paycor Stadium','CLE':'Huntington Bank Field','DAL':'AT&T Stadium','DEN':'Empower Field at Mile High','DET':'Ford Field',
 'GB':'Lambeau Field','HOU':'NRG Stadium','IND':'Lucas Oil Stadium','JAX':'EverBank Stadium','KC':'GEHA Field at Arrowhead Stadium','LV':'Allegiant Stadium',
 'LAC':'SoFi Stadium','LA':'SoFi Stadium','MIA':'Hard Rock Stadium','MIN':'U.S. Bank Stadium','NE':'Gillette Stadium','NO':'Caesars Superdome',
 'NYG':'MetLife Stadium','NYJ':'MetLife Stadium','PHI':'Lincoln Financial Field','PIT':'Acrisure Stadium','SF':"Levi's Stadium",'SEA':'Lumen Field',
 'TB':'Raymond James Stadium','TEN':'Nissan Stadium','WAS':'Northwest Stadium'}
def venue(stadium, home):
    v = VENUES.get(stadium) if isinstance(stadium, str) else None
    name = stadium if v else HOME.get(home)
    if not v: v = VENUES.get(HOME.get(home, ''), (None, None, 'out'))
    return [name, v[0], v[1], v[2]]
