/**
 * Relay for the NFL Sim Lab and Showdown Sweat (one-time setup, about 3 minutes).
 * Kalshi's API and DraftKings' contest API do not allow requests from web pages, so the tools ask this tiny
 * Google Apps Script web app instead; it fetches the public data server-side and hands it back.
 * No login or key needed: Kalshi public market data, and DraftKings public contest details (name, fee, payouts).
 * Already set up the Kalshi relay? Paste this newer version over it, then Deploy > Manage deployments > edit > Version: New version.
 *
 * Setup:
 *  1. Go to script.google.com > New project. Paste this whole file over the starter code. Save.
 *  2. Deploy > New deployment > type "Web app". Execute as: Me. Who has access: Anyone. Deploy, allow access.
 *  3. Copy the Web app URL (ends in /exec) and paste it into the lab: Market props > Relay URL > Save.
 */
var BASE = 'https://api.elections.kalshi.com/trade-api/v2/markets';
var KEEP = ['ticker', 'event_ticker', 'yes_sub_title', 'floor_strike', 'yes_bid_dollars', 'yes_ask_dollars', 'last_price_dollars', 'volume_fp', 'yes_bid', 'yes_ask', 'last_price', 'volume'];
// shared cache so a public page with many visitors makes few upstream calls (values split into 90 KB pieces)
function cached(key, ttl, fn) {
  var c = CacheService.getScriptCache(); key = Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, key));
  try { var n = c.get(key + ':n'); if (n) { var ks = []; for (var i = 0; i < +n; i++) ks.push(key + ':' + i); var got = c.getAll(ks), s = '';
    for (var i = 0; i < +n; i++) { if (got[key + ':' + i] == null) { s = null; break; } s += got[key + ':' + i]; } if (s != null) return s; } } catch (e) {}
  var r = fn(); if (!r.ok) return r.text;
  try { var parts = {}, k = 0; for (var p = 0; p < r.text.length; p += 90000) { parts[key + ':' + k] = r.text.substr(p, 90000); k++; }
    if (k <= 60) { parts[key + ':n'] = String(k); c.putAll(parts, ttl); } } catch (e) {}
  return r.text;
}
function json(s) { return ContentService.createTextOutput(s).setMimeType(ContentService.MimeType.JSON); }
function slim(m) { var o = {}; KEEP.forEach(function (k) { if (m[k] !== undefined) o[k] = m[k]; }); return o; }
function doGet(e) {
  var dk = e && e.parameter && e.parameter.dk;
  if (dk) {   // DraftKings public contest details or draft group players, by numeric id only
    var id = String(e.parameter.id || ''); if (!/^\d{4,12}$/.test(id)) return json('{"error":"bad id"}');
    var url = dk === 'contest' ? 'https://api.draftkings.com/contests/v1/contests/' + id + '?format=json'
      : dk === 'draftables' ? 'https://api.draftkings.com/draftgroups/v1/draftgroups/' + id + '/draftables?format=json' : null;
    if (!url) return json('{"error":"bad kind"}');
    return json(cached(dk + id, 600, function () { var r = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      return r.getResponseCode() === 200 ? { ok: true, text: r.getContentText() } : { ok: false, text: JSON.stringify({ error: 'DraftKings returned ' + r.getResponseCode() }) }; }));
  }
  var series = String((e && e.parameter && e.parameter.series) || '').split(',').filter(function (s) { return /^KXNFL[A-Z0-9]+$/.test(s); });
  return json(cached('kx' + series.join(','), 90, function () {
    var out = [], pending = series.map(function (s) { return { s: s, cursor: '' }; });
    for (var round = 0; round < 10 && pending.length; round++) {   // all series in parallel, follow cursors
      var reqs = pending.map(function (p) { return { url: BASE + '?series_ticker=' + p.s + '&status=open&limit=1000' + (p.cursor ? '&cursor=' + encodeURIComponent(p.cursor) : ''), muteHttpExceptions: true }; });
      var res = UrlFetchApp.fetchAll(reqs), next = [];
      res.forEach(function (r, i) {
        if (r.getResponseCode() !== 200) return;
        var j = JSON.parse(r.getContentText()); (j.markets || []).forEach(function (m) { out.push(slim(m)); });
        if (j.cursor) next.push({ s: pending[i].s, cursor: j.cursor });
      });
      pending = next;
    }
    return { ok: true, text: JSON.stringify({ pulled: new Date().toISOString(), markets: out }) };
  }));
}
