/* ---------------- weather: forecast import (Open-Meteo, no key) and game adjustments ----------------
   Conditions per game: rain and snow as 0-100 (chance x intensity over the game window), wind mph, temp F.
   Effects (fit on 2014-2026 outdoor games, see samples/weather.json): pass rate, pass and run efficiency tilts,
   fumbles, FG accuracy, and optionally the game total (closing totals have run high in rain and wind).
   Domes and retractable roofs (assumed closed in bad weather) get no adjustment unless you mark the roof open. */
const WXC = () => (MODEL.league && MODEL.league.weather) || null;
function venueOf(away, home) {
  const V = (MODEL.meta && MODEL.meta.venues) || {};
  const v = V[away + '@' + home] || (V._home && V._home[home]) || null;
  return v ? { name: v[0], lat: v[1], lon: v[2], roof: v[3] } : null;
}
// x: {rain, snow, wind, temp, roof, open} -> engine weather params + total adjustment
function wxParams(x) {
  const C = WXC(); const z = { proe: 0, sp: 0, sr: 0, fum: 1, fg: 0, tot: 0, active: false };
  if (!C || !x) return z;
  const covered = (x.roof === 'dome' || x.roof === 'retract') && !x.open;
  if (covered) return Object.assign(z, { covered: true });
  const f = { rain: Math.max(0, Math.min(1, (+x.rain || 0) / 100)), snow: Math.max(0, Math.min(1, (+x.snow || 0) / 100)),
    wind: Math.max(0, ((+x.wind || 0) - 10) / 10), cold: x.temp == null || x.temp === '' ? 0 : Math.max(0, Math.min(1, (32 - x.temp) / 7)) };
  for (const k of ['rain', 'snow', 'wind', 'cold']) {
    z.proe += C.proe[k] * f[k]; z.sp += C.sp[k] * f[k]; z.sr += C.sr[k] * f[k]; z.fum += C.fum[k] * f[k]; z.fg += C.fg[k] * f[k]; z.tot += C.tot[k] * f[k];
  }
  z.active = Object.values(f).some(v => v > 0.05); z.f = f; return z;
}
function wxSummary(z) {
  if (!z) return '';
  if (z.covered) return 'Roof: no weather effect';
  if (!z.active) return 'No adjustment';
  const ypa = z.sp * 3.84, ypc = z.sr * 2.4;
  return `pass rate ${z.proe >= 0 ? '+' : ''}${(z.proe * 100).toFixed(1)} pts · YPA ${ypa >= 0 ? '+' : ''}${ypa.toFixed(2)} · YPC ${ypc >= 0 ? '+' : ''}${ypc.toFixed(2)} · fumbles ×${z.fum.toFixed(2)} · 45-yd FG ${(100 / (1 + Math.exp(-(Math.log(4) + z.fg))) - 80).toFixed(1)} pts · total ${z.tot >= 0 ? '+' : ''}${z.tot.toFixed(1)}`;
}
// implied totals after the optional weather total adjustment (split by each team's share of the total)
function wxImplied(imp, z, on) {
  if (!on || !z || !z.active || !z.tot) return imp.slice();
  const T = imp[0] + imp[1]; if (T <= 0) return imp.slice();
  return imp.map(v => +(v + z.tot * v / T).toFixed(2));
}
// DK game info date "10/11/2026" + time "01:00PM" (ET) -> forecast over kickoff hour + 3 hours
async function fetchForecast(v, date, time) {
  if (!v || v.lat == null) throw new Error('No stadium location for this game');
  const m = /(\d+)\/(\d+)\/(\d+)/.exec(date || ''); if (!m) throw new Error('No game date');
  const ymd = `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  const tm = /(\d+):(\d+)\s*(AM|PM)/i.exec(time || '1:00PM'); let h = +tm[1] % 12 + (/pm/i.test(tm[3]) ? 12 : 0);
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${v.lat}&longitude=${v.lon}&hourly=temperature_2m,precipitation_probability,rain,showers,snowfall,wind_speed_10m,wind_gusts_10m&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=mm&timezone=America%2FNew_York&start_date=${ymd}&end_date=${ymd}`;
  const r = await fetch(url); if (!r.ok) throw new Error('Forecast service returned ' + r.status);
  const j = await r.json(); const H = j.hourly; if (!H || !H.time) throw new Error('No forecast for that date yet (16-day range)');
  const idx = H.time.map((t, i) => [+t.slice(11, 13), i]).filter(([hr]) => hr >= h && hr <= h + 3).map(([, i]) => i);
  if (!idx.length) throw new Error('No forecast hours for kickoff');
  const avg = (a) => idx.reduce((s, i) => s + (+a[i] || 0), 0) / idx.length, mx = (a) => Math.max(...idx.map(i => +a[i] || 0));
  const prob = H.precipitation_probability ? avg(H.precipitation_probability) / 100 : 0.5;
  const wet = mx(H.rain) + mx(H.showers || H.rain.map(() => 0)), sn = mx(H.snowfall);
  return { rain: Math.round(100 * Math.min(1, prob * Math.min(1, wet / 0.3))), snow: Math.round(100 * Math.min(1, prob * Math.min(1, sn / 0.2))),
    wind: Math.round(avg(H.wind_speed_10m)), gust: Math.round(mx(H.wind_gusts_10m || [])), temp: Math.round(avg(H.temperature_2m)),
    detail: `${Math.round(prob * 100)}% precip chance · rain up to ${wet.toFixed(1)} mm/h · snow up to ${sn.toFixed(1)} cm/h`, at: new Date().toLocaleString() };
}
