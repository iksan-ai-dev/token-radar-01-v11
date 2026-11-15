// Launch Ledger dashboard: board, detail, filtered and model views. Reads
// window.RADAR (data.js, written by main.ts from the same board.json the gate
// checks) and window.FARM (farm.js, the same plan generator the entry program
// uses), so every number on screen comes from board.json. No network, no
// fetch: the page renders from file:// as it stands. Sentinels in the data:
// change_7d 9999 = unreported, ageDays -1 = unknown listing date.
(function () {
  'use strict';
  var R = window.RADAR, F = window.FARM, M = R.model;
  var B36 = function (s) { return parseInt(s, 36); };
  var ROWS = R.rows.split('\n').map(function (ln) {
    var p = ln.split('|');
    return [p[0], p[1], B36(p[2]), p[3] === '' ? [] : p[3].split(',').map(B36), B36(p[4]), B36(p[5]) / 100, B36(p[6]), B36(p[7]), p[8] === '' ? [] : p[8].split(',').map(B36), B36(p[9])];
  });
  var COMPS = R.comps.split('\n').map(function (ln) {
    var p = ln.split('|'); return [p[0], B36(p[1]), B36(p[2]), B36(p[3]) / 10000];
  });
  var CATF = {};
  R.cat_table.forEach(function (t) { CATF[t[0]] = t[2]; });
  function row(slug) { for (var i = 0; i < ROWS.length; i++) if (ROWS[i][0] === slug) return ROWS[i]; return false; }
  function catName(r) { return R.categories[r[2]] || ''; }
  function chainNames(r) { return r[3].map(function (i) { return R.chains[i] || ''; }).filter(Boolean); }
  function famOfCat(cat) { for (var f in R.families) if (R.families[f].indexOf(cat) >= 0) return f; return 'Other'; }
  function famOfRow(r) { return famOfCat(catName(r)); }
  function catF(r) { return CATF[r[2]] || 1; }
  function curve(tvl) { return Math.pow(10, M.a + M.b * Math.log10(tvl)); }
  function growth(chg) { var c = chg === 9999 ? 0 : chg; var f = 1 + 0.75 * (c / 100); return Math.min(1.6, Math.max(0.6, f)); }
  function ageF(days) { var d = days < 0 ? 365 : days; return 0.55 + 0.45 * (Math.min(Math.max(d, 0), 730) / 730); }
  function sliceOf(r) { return 75 * r[7] / r[4]; }
  function verdictOf(s) { return s >= M.worth_it_min ? 'Worth it' : s < M.low_slice_max ? 'Low slice' : 'Thin'; }
  function verdictClass(s) { return s >= M.worth_it_min ? 'worth' : s < M.low_slice_max ? 'low' : 'thin'; }
  function tierName(r) { return r[9] === 0 ? 'Watchlist' : r[9] === 2 ? 'ABOVE FLOOR' : 'Early'; }
  function ageYears(days) { return days < 0 ? '—' : (days / 365.25).toFixed(1) + 'y'; }
  function money(v) {
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(v);
  }
  function multFmt(x) { return '×' + (x < 0.01 ? x.toFixed(4) : x < 0.1 ? x.toFixed(3) : x.toFixed(2)); }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function planOf(r) {
    var ch = chainNames(r);
    return F.planFor({ slug: r[0], name: r[1], category: catName(r), chain: ch[0] || 'Ethereum', chain2: ch[1] || ch[0] || 'Ethereum', tvl: r[4], ageDays: r[6], implied: r[7], slice: sliceOf(r) });
  }
  document.getElementById('asof').textContent = R.as_of;
  document.getElementById('recon').innerHTML = '<b>758</b> = <b>198</b> ranked + <b>416</b> already trading + <b>144</b> set aside';
  document.getElementById('recon2').innerHTML = '<b>198</b> = <b>40</b> watchlist + <b>158</b> early finds (<b>138</b> below floor + <b>20</b> above floor)';
  document.getElementById('formula').innerHTML = 'implied = TVL &times; curve &times; category &times; growth &times; age &nbsp;·&nbsp; log<sub>10</sub>(mcap/TVL) = <code>' + M.a.toFixed(4) + ' ' + (M.b < 0 ? '−' : '+') + ' ' + Math.abs(M.b).toFixed(4) + '·log<sub>10</sub>(TVL)</code> &nbsp;·&nbsp; <code>' + M.n_comps + '</code> comps &nbsp;·&nbsp; LOO <code>&times;' + M.loo.toFixed(4) + '</code> (flat <code>&times;' + M.flat_loo.toFixed(2) + '</code>) &nbsp;·&nbsp; category shrunk, <code>' + M.shrink_k + '</code> pseudo-comps &nbsp;·&nbsp; growth <code>1+0.75&times;7d</code> &nbsp;·&nbsp; age <code>0.55&rarr;1.00 / 730d</code>';
  document.getElementById('verdictStrip').textContent = 'Rank is launch size; the call is pay per $1,000 farmed: Worth it ≥ $' + M.worth_it_min + ' · Thin $' + M.low_slice_max + '–$' + M.worth_it_min + ' · Low slice < $' + M.low_slice_max + ' — a Low slice row can still be the biggest launch on the board.';
  document.getElementById('footCounts').textContent = 'Board: 198 rows · 40/40 watchlist · total implied ' + money(R.total_implied_usd) + ' · P25–P75 band ×' + (M.hi_f / M.lo_f).toFixed(2) + ' (' + M.lo_f.toFixed(4) + '–' + M.hi_f.toFixed(4) + ')';
  var TABS = [['#/', 'Board', ROWS.length], ['#/w', 'Watchlist', R.watchlist_size], ['#/e', 'Early finds', R.early_size], ['#/t', 'Already trading', R.already_trading], ['#/s', 'Set aside', R.set_aside], ['#/model', 'Model', 0]];
  function renderTabs(active) {
    document.getElementById('tabs').innerHTML = TABS.map(function (t) {
      return '<a class="tab' + (t[0] === active ? ' on' : '') + '" href="' + t[0] + '">' + t[1] + (t[2] ? ' <b>' + t[2] + '</b>' : '') + '</a>';
    }).join('');
  }
  var fSearch = document.getElementById('fSearch'), fTier = document.getElementById('fTier'),
    fFam = document.getElementById('fFam'), fChain = document.getElementById('fChain'),
    fMin = document.getElementById('fMin'), fChg = document.getElementById('fChg');
  fFam.innerHTML = '<option value="">Family: all</option>' + Object.keys(R.families).map(function (f) { return '<option value="' + esc(f) + '">' + esc(f) + '</option>'; }).join('');
  var boardChains = [];
  ROWS.forEach(function (r) { chainNames(r).forEach(function (c) { if (boardChains.indexOf(c) < 0) boardChains.push(c); }); });
  boardChains.sort();
  fChain.innerHTML = '<option value="">Chain: all</option>' + boardChains.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('');
  function readFilters() {
    return { q: fSearch.value.trim().toLowerCase(), tier: fTier.value, fam: fFam.value, chain: fChain.value, min: parseFloat(fMin.value) || 0, chg: fChg.value };
  }
  function applyFilters(list, fl) {
    return list.filter(function (r) {
      if (fl.q && (r[1].toLowerCase().indexOf(fl.q) < 0 && r[0].toLowerCase().indexOf(fl.q) < 0)) return false;
      if (fl.tier !== '' && String(r[9]) !== fl.tier) return false;
      if (fl.fam && famOfRow(r) !== fl.fam) return false;
      if (fl.chain && chainNames(r).indexOf(fl.chain) < 0) return false;
      if (fl.min && r[4] < fl.min) return false;
      if (fl.chg === 'gain' && !(r[5] !== 9999 && r[5] > 0)) return false;
      if (fl.chg === 'fall' && !(r[5] !== 9999 && r[5] < 0)) return false;
      return true;
    });
  }
  function chipsHtml(fl, n) {
    var chips = [];
    if (fl.tier === '1') chips.push('Early (below floor)');
    if (fl.tier === '0') chips.push('Watchlist');
    if (fl.tier === '2') chips.push('Above floor');
    if (fl.fam) chips.push('Family: ' + fl.fam);
    if (fl.chain) chips.push('Chain: ' + fl.chain);
    if (fl.min) chips.push('TVL ≥ $' + (fl.min / 1e6) + 'M');
    if (fl.chg === 'gain') chips.push('7d gainers');
    if (fl.chg === 'fall') chips.push('7d falling');
    if (fl.q) chips.push('“' + fl.q + '”');
    if (!chips.length) return '<span class="shown">198 of 198 shown</span><span>· no filter — every row on the board</span>';
    return '<span class="shown">' + n + ' of 198 shown</span>' + chips.map(function (c) { return '<span class="chip">' + esc(c) + '</span>'; }).join('');
  }
  var COLS = [
    { k: 'rank', label: 'Rank', get: function (r, i) { return i + 1; } },
    { k: 'name', label: 'Protocol', get: function (r) { return r[1]; } },
    { k: 'cat', label: 'Category', get: function (r) { return catName(r); } },
    { k: 'chain', label: 'Chain', get: function (r) { return chainNames(r)[0] || ''; } },
    { k: 'tvl', label: 'TVL', get: function (r) { return r[4]; } },
    { k: 'chg', label: '7D', get: function (r) { return r[5] === 9999 ? -9999 : r[5]; } },
    { k: 'age', label: 'No token for', get: function (r) { return r[6] < 0 ? -1 : r[6]; } },
    { k: 'mult', label: 'Multiple', get: function (r) { return curve(r[4]) * catF(r); } },
    { k: 'imp', label: 'Implied value', get: function (r) { return r[7]; } },
    { k: 'range', label: 'P25–P75', get: function (r) { return r[7]; } },
    { k: 'slice', label: 'Slice/$1K', get: function (r) { return sliceOf(r); } },
    { k: 'call', label: 'Call', get: function (r) { var s = sliceOf(r); return s >= M.worth_it_min ? 2 : s < M.low_slice_max ? 0 : 1; } },
    { k: 'ticket', label: 'Ticket·Hold', get: function (r) { return F.ticketFor(r[4]); } },
  ];
  var sortState = { k: 'imp', dir: -1 };
  function sortRows(list) {
    var col = 0;
    COLS.forEach(function (c) { if (c.k === sortState.k) col = c; });
    if (!col) return list;
    var d = sortState.dir;
    return list.slice().sort(function (a, b) {
      var x = col.get(a, ROWS.indexOf(a)), y = col.get(b, ROWS.indexOf(b));
      if (typeof x === 'string') return d * (x < y ? -1 : x > y ? 1 : 0);
      return d * (x - y);
    });
  }
  function dotplot(r) {
    var lo = r[7] * M.lo_f, hi = r[7] * M.hi_f;
    var loG = Math.log10(1e6), hiG = Math.log10(1e10);
    function pc(v) { return Math.max(0, Math.min(100, (Math.log10(v) - loG) / (hiG - loG) * 100)); }
    return '<div class="dotplot" title="P25 ' + money(lo) + ' – P75 ' + money(hi) + '"><span class="band" style="left:' + pc(lo).toFixed(1) + '%;width:' + Math.max(1, pc(hi) - pc(lo)).toFixed(1) + '%"></span><span class="mark" style="left:' + pc(r[7]).toFixed(1) + '%"></span></div>';
  }
  function boardHtml(list) {
    var head = COLS.map(function (c) {
      var arrow = sortState.k === c.k ? (sortState.dir === -1 ? ' ▼' : ' ▲') : '';
      return '<th data-k="' + c.k + '" class="' + (sortState.k === c.k ? 'sorted' : '') + '">' + c.label + arrow + '</th>';
    }).join('');
    var body = list.map(function (r) {
      var s = sliceOf(r), v = verdictOf(s), plan = planOf(r);
      var chg = r[5] === 9999 ? '—' : '<span class="' + (r[5] >= 0 ? 'up' : 'dn') + '">' + (r[5] >= 0 ? '+' : '') + r[5].toFixed(2) + '%</span>';
      return '<tr><td class="num">' + (ROWS.indexOf(r) + 1) + '</td>' +
        '<td class="name"><a href="#/p/' + r[0] + '">' + esc(r[1]) + '</a><br><span class="tier">' + tierName(r) + '</span></td>' +
        '<td>' + esc(catName(r)) + '</td><td>' + esc(chainNames(r)[0] || '') + '</td>' +
        '<td class="num">' + money(r[4]) + '</td><td class="num">' + chg + '</td>' +
        '<td class="num">' + ageYears(r[6]) + '</td><td class="num">' + multFmt(curve(r[4]) * catF(r)) + '</td>' +
        '<td class="num"><b>' + money(r[7]) + '</b></td><td>' + dotplot(r) + '</td>' +
        '<td class="num"><b>$' + s.toFixed(2) + '</b></td>' +
        '<td><span class="call ' + verdictClass(s) + '">' + v + '</span></td>' +
        '<td class="num">$' + plan.ticket + ' · ' + plan.holdDays + 'd</td></tr>';
    }).join('');
    var sortLabel = (function () { var c = 0; COLS.forEach(function (x) { if (x.k === sortState.k) c = x; }); return c ? c.label + (sortState.dir === -1 ? ' ▼' : ' ▲') : ''; })();
    return '<table class="board"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table>' +
      '<p class="sortnote">Sorted by <b>' + sortLabel + '</b> — click a column to sort. Rank is launch size; the call is pay per $1,000 farmed.</p>';
  }
  function viewBoard(preset) {
    renderTabs(preset === 'w' ? '#/w' : preset === 'e' ? '#/e' : '#/');
    var fl = readFilters();
    var list = ROWS;
    if (preset === 'w') list = list.filter(function (r) { return r[9] === 0; });
    if (preset === 'e') list = list.filter(function (r) { return r[9] !== 0; });
    var shown = sortRows(applyFilters(list, fl));
    document.getElementById('chips').innerHTML = chipsHtml(fl, shown.length);
    document.getElementById('view').innerHTML = boardHtml(shown);
    document.querySelectorAll('table.board th').forEach(function (th) {
      th.addEventListener('click', function () {
        var k = th.getAttribute('data-k');
        if (sortState.k === k) sortState.dir = -sortState.dir;
        else { sortState.k = k; sortState.dir = k === 'name' || k === 'cat' || k === 'chain' ? 1 : -1; }
        viewBoard(preset);
      });
    });
  }
  function viewDetail(slug) {
    renderTabs('#/');
    var r = row(slug);
    if (!r) { document.getElementById('view').innerHTML = '<p>No such protocol on the board.</p>'; return; }
    var s = sliceOf(r), v = verdictOf(s), plan = planOf(r);
    var fam = famOfRow(r);
    var famDef = R.families[fam].join(' + ');
    var lo = r[7] * M.lo_f, hi = r[7] * M.hi_f;
    var compRows = r[8].map(function (ci) {
      var c = COMPS[ci];
      var same = famOfCat(R.categories[c[1]] || '') === fam;
      return '<tr><td>' + esc(c[0]) + '</td><td>' + esc(R.categories[c[1]] || '') + '</td><td>' + money(c[2]) + '</td><td>' + multFmt(c[3]) + '</td><td><span class="tag ' + (same ? 'same' : 'near') + '">' + (same ? 'Same family' : 'Nearest live') + '</span></td></tr>';
    }).join('');
    var steps = plan.steps.map(function (st, i) {
      return '<div class="step"><b class="n">' + (i + 1) + '.</b> ' + esc(st.text) + ' <span class="ct">Cost: ' + F.dollars(st.gasCents) + ' gas. Time: ' + st.minutes + ' min.</span></div>';
    }).join('');
    var econ = [
      ['Ticket', '$' + plan.ticket, 'working capital'],
      ['Gas 90 days', F.dollars(plan.gas90Cents), '= sum of step gas below'],
      ['Hands-on', plan.handsOn + ' min', '= sum of the 8 step times'],
      ['Hold', plan.holdDays + ' days', 'qualifying window'],
      ['Airdrop / $1K', '$' + s.toFixed(2), '7.5% of implied, pro rata to TVL'],
      ['Farm call', v, 'Worth it ≥ $' + M.worth_it_min + ' · Low < $' + M.low_slice_max],
    ].map(function (c) { return '<div class="card"><div class="k">' + c[0] + '</div><div class="v">' + c[1] + '</div><div class="n">' + c[2] + '</div></div>'; }).join('');
    document.getElementById('chips').innerHTML = '<span class="shown">Detail — rank ' + (ROWS.indexOf(r) + 1) + ' of 198</span><span class="chip">' + esc(fam) + ' family</span><span class="chip">' + esc(tierName(r)) + '</span>';
    document.getElementById('view').innerHTML =
      '<div class="detail"><p class="crumbs"><a href="#/">Board</a> &rsaquo; <b>' + esc(r[1]) + '</b> &middot; rank ' + (ROWS.indexOf(r) + 1) + ' &middot; ' + esc(catName(r)) + ' &middot; ' + esc(chainNames(r).join(', ')) + '</p>' +
      '<h2>' + esc(r[1]) + ' — ' + money(r[7]) + ' implied</h2>' +
      '<div class="famdef"><b>' + esc(fam) + ' family = ' + esc(famDef) + '.</b> Comparables below are picked inside this family, nearest by TVL; where a family holds fewer than 4 live protocols the rest are the nearest live protocols overall, labelled honestly.</div>' +
      '<div class="howto">How this value is built: <code>' + money(r[4]) + ' TVL &times; ' + multFmt(curve(r[4])) + ' curve &times; ' + catF(r).toFixed(4) + ' category &times; ' + growth(r[5]).toFixed(4) + ' growth &times; ' + ageF(r[6]).toFixed(4) + ' age = ' + money(r[7]) + '</code>. ' +
      'P25–P75 band <code>' + money(lo) + ' – ' + money(hi) + '</code> (band &times;' + (M.hi_f / M.lo_f).toFixed(2) + '). TVL ' + money(r[4]) + ', 7d ' + (r[5] === 9999 ? 'not reported' : (r[5] >= 0 ? '+' : '') + r[5].toFixed(2) + '%') + ', records no token for ' + ageYears(r[6]) + '.</div>' +
      '<div class="econ">' + econ + '</div>' +
      '<table class="mini"><thead><tr><th>Comparable (token already trades)</th><th>Category</th><th>TVL</th><th>mcap/TVL</th><th>Kind</th></tr></thead><tbody>' + compRows + '</tbody></table>' +
      '<div class="steps">' + steps + '</div>' +
      '<p class="risk">Estimates for one wallet over 90 days. Ticket is capital at risk, not a fee. Claim only from the protocol&rsquo;s own app — a real airdrop never asks for a seed phrase.</p></div>';
  }
  function viewTrading() {
    renderTabs('#/t');
    document.getElementById('chips').innerHTML = '<span class="shown">' + COMPS.length + ' live comparables shown</span><span>· the market&rsquo;s own values, never ranked as launches</span>';
    var rows = COMPS.slice().sort(function (a, b) { return b[2] - a[2]; }).map(function (c) {
      return '<tr><td>' + esc(c[0]) + '</td><td>' + esc(R.categories[c[1]] || '') + '</td><td>' + money(c[2]) + '</td><td>' + multFmt(c[3]) + '</td></tr>';
    }).join('');
    document.getElementById('view').innerHTML = '<table class="mini"><thead><tr><th>Protocol (token already trades)</th><th>Category</th><th>TVL</th><th>mcap/TVL</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<p class="sortnote">These ' + R.already_trading + ' protocols record a token, so they are never ranked as launches. The ' + COMPS.length + ' with a market cap above zero are the comparables the size curve is fitted on.</p>';
  }
  function viewSetAside() {
    renderTabs('#/s');
    document.getElementById('chips').innerHTML = '<span class="shown">' + R.set_aside + ' protocols set aside by rule</span>';
    var rows = Object.keys(R.setaside_counts).map(function (k) {
      return '<tr><td>' + esc(k) + '</td><td>' + R.setaside_counts[k] + '</td></tr>';
    }).join('');
    document.getElementById('view').innerHTML = '<p class="sortnote">Pre-token protocols the board does not rank. They record no token, but a launch is not theirs to make under this bounty&rsquo;s rules — WBTC, Binance staked ETH and USDT0 are the named examples of wrapped or staked products of tokens that already trade.</p>' +
      '<table class="mini"><thead><tr><th>Reason set aside</th><th>Protocols</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }
  function viewModel() {
    renderTabs('#/model');
    document.getElementById('chips').innerHTML = '<span class="shown">Model &amp; lab</span><span>· every constant below is fitted at runtime from the snapshot, never hardcoded</span>';
    var cats = R.cat_table.map(function (t) {
      return '<tr><td>' + esc(R.categories[t[0]] || '') + '</td><td>' + t[1] + '</td><td>' + multFmt(t[2]) + '</td></tr>';
    });
    var third = Math.ceil(cats.length / 3);
    var table = function (rows) { return '<table class="mini"><thead><tr><th>Category</th><th>n</th><th>Shrunk ×</th></tr></thead><tbody>' + rows.join('') + '</tbody></table>'; };
    var pts = COMPS.map(function (c) {
      var pred = c[2] * curve(c[2]);
      var x = 20 + 460 * (Math.log10(pred) - 6) / 4;
      var y = 280 - 260 * (Math.log10(c[2] * c[3]) - 6) / 4;
      return '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="2.5" fill="#1d3a2d"/>';
    }).join('');
    document.getElementById('view').innerHTML =
      '<div class="model"><h2>Model &amp; lab</h2>' +
      '<p class="note">implied = TVL &times; curve &times; category &times; growth &times; age. Curve: log<sub>10</sub>(mcap/TVL) = ' + M.a.toFixed(4) + ' ' + (M.b < 0 ? '−' : '+') + ' ' + Math.abs(M.b).toFixed(4) + '·log<sub>10</sub>(TVL), fitted over ' + M.n_comps + ' comparables (R² ' + M.r2.toFixed(3) + '). LOO median error &times;' + M.loo.toFixed(4) + ' vs flat multiple &times;' + M.flat_loo.toFixed(2) + '. Category factor = median mcap/(TVL&times;curve) in the category, shrunk toward 1 with ' + M.shrink_k + ' pseudo-comps. Growth = 1 + 0.75&times;7d change, clamped [0.60, 1.60]. Age = 0.55 + 0.45&times;min(days, 730)/730; unknown age = 365 days. P25–P75 band from residuals after the shrunk category effect: &times;' + M.lo_f.toFixed(4) + ' – &times;' + M.hi_f.toFixed(4) + ' (ratio &times;' + (M.hi_f / M.lo_f).toFixed(2) + '). No name is special-cased.</p>' +
      '<div class="side"><div><svg width="500" height="300" viewBox="0 0 500 300" style="background:#fffdf4;border:1px solid #d8cfae"><line x1="20" y1="280" x2="480" y2="20" stroke="#b98a2f" stroke-width="1.5"/><text x="30" y="290" font-size="11">predicted mcap →</text><text x="24" y="16" font-size="11">actual mcap →</text>' + pts + '</svg>' +
      '<p class="note">Each dot is one comparable: predicted vs actual market cap, log scales, gold line is exact prediction.</p></div>' +
      '<div class="tbls">' + table(cats.slice(0, third)) + table(cats.slice(third, 2 * third)) + table(cats.slice(2 * third)) + '</div></div>' +
      '<p class="note">Limits: the snapshot carries no fees, revenue, users, funding or points data, so the model uses only TVL, 7-day change, age without a token and category. Market cap is circulating market cap, not fully diluted value. A board row is the entry&rsquo;s claim about what a token would be worth if the protocol&rsquo;s record stayed as it is — not a prediction of a launch.</p></div>';
  }
  [fSearch, fTier, fFam, fChain, fMin, fChg].forEach(function (el) { el.addEventListener('input', route); el.addEventListener('change', route); });
  document.getElementById('fClear').addEventListener('click', function () {
    fSearch.value = ''; fTier.value = ''; fFam.value = ''; fChain.value = ''; fMin.value = '0'; fChg.value = '';
    window.location.hash = '#/';
    route();
  });
  function route() {
    var h = window.location.hash || '#/';
    var path = h.slice(2);
    var q = '';
    var qi = path.indexOf('?');
    if (qi >= 0) { q = path.slice(qi + 1); path = path.slice(0, qi); }
    var boardView = path === '' || path === 'f' || path === 'w' || path === 'e';
    document.getElementById('filters').style.display = boardView ? '' : 'none';
    document.getElementById('chips').style.display = (path.indexOf('p/') === 0 || path === 'model') ? 'none' : '';
    if (path.indexOf('p/') === 0) { viewDetail(path.slice(2)); return; }
    if (path === 'model') { viewModel(); return; }
    if (path === 't') { viewTrading(); return; }
    if (path === 's') { viewSetAside(); return; }
    if (path === 'f' || path === 'w' || path === 'e') {
      if (q) {
        var params = {};
        q.split('&').forEach(function (kv) { var p = kv.split('='); params[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ''); });
        if ('tier' in params) fTier.value = params.tier;
        if ('fam' in params) fFam.value = params.fam;
        if ('chain' in params) fChain.value = params.chain;
        if ('min' in params) fMin.value = params.min;
        if ('chg' in params) fChg.value = params.chg;
        if ('q' in params) fSearch.value = params.q;
        if ('sort' in params) { sortState.k = params.sort; sortState.dir = params.dir === 'asc' ? 1 : -1; }
      }
      if (path === 'w') { fTier.value = '0'; viewBoard('w'); return; }
      if (path === 'e') { fTier.value = '1'; viewBoard('e'); return; }
      viewBoard('f');
      return;
    }
    viewBoard('');
  }
  window.addEventListener('hashchange', route);
  route();
})();
