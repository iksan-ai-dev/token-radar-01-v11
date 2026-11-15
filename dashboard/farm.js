// Farm-plan generator for token-radar-01 v11. One shared source for the
// entry program (lib/ledger.ts writes board.json from it) and the dashboard
// page (which renders the same plan from data.js), so the plan a reader sees
// is the plan in board.json. Gas 90 days is DEFINED as the sum of the 8 step
// gas costs, so the strip always equals the steps added up. Hands-on minutes
// are totals over the 90-day window per step; hands_on_min is their sum.
// Step text is assembled from clause pools picked by a deterministic hash of
// the slug, so plans vary structurally per protocol. Nothing here promises
// an airdrop: a plan positions a farmer, it does not guarantee a token.
(function () {
  'use strict';
  function hash(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }
  function pick(arr, seed) { return arr[seed % arr.length]; }
  var GAS = {
    Ethereum: 320, Bitcoin: 150, Tron: 90, Avalanche: 12, Binance: 8,
    Solana: 2, Base: 5, Arbitrum: 5, Optimism: 5, Polygon: 5, Unichain: 5,
    'zkSync Era': 6, Linea: 6, Scroll: 6, Blast: 5, Mode: 5, Mantle: 5,
    Celo: 3, Sui: 2, Aptos: 2, Near: 2, Sonic: 4, Berachain: 5,
    'Hyperliquid L1': 2, 'Robinhood Chain': 5, Ink: 5, Katana: 5, Monad: 5,
    Plasma: 5, Stable: 5, Tempo: 5, Morph: 5, Sei: 3, Soneium: 5,
  };
  function gasCents(chain) {
    return chain && Object.prototype.hasOwnProperty.call(GAS, chain) ? GAS[chain] : 15;
  }
  function dollars(cents) { return '$' + (cents / 100).toFixed(2); }
  function ticketFor(tvl) {
    if (tvl >= 2e9) return 350;
    if (tvl >= 1e9) return 250;
    if (tvl >= 2.5e8) return 200;
    if (tvl >= 5e7) return 150;
    if (tvl >= 1e7) return 100;
    return 50;
  }
  function holdFor(ageDays) {
    if (!(ageDays >= 0)) return 45;
    if (ageDays >= 730) return 28;
    if (ageDays >= 365) return 45;
    return 60;
  }
  var ARCH = {
    'Risk Curators': 'vault', 'Onchain Capital Allocator': 'vault', Yield: 'vault',
    'Yield Aggregator': 'vault', 'Liquidity Manager': 'vault', 'Leveraged Farming': 'vault',
    Farm: 'vault', 'Options Vault': 'vault',
    Dexs: 'dex', Synthetics: 'dex', DOR: 'dex',
    Derivatives: 'perps', Options: 'perps', 'Basis Trading': 'perps',
    Lending: 'lending', CDP: 'lending', 'CDP Manager': 'lending',
    'Collateral Management': 'lending', 'Collateral Markets': 'lending',
    'Uncollateralized Lending': 'lending', 'Interest Rate Derivatives': 'lending',
    'Algo-Stables': 'stable', 'Stablecoin Issuer': 'stable', 'Dual-Token Stablecoin': 'stable',
    'Stablecoin Wrapper': 'stable', 'Reserve Currency': 'stable',
    RWA: 'rwa', CeDeFi: 'rwa',
    'Prediction Market': 'prediction',
    Payments: 'payments', 'Crypto Card Issuer': 'payments', 'OTC Marketplace': 'payments',
    Chain: 'chain', 'Cross Chain Bridge': 'chain', Bridge: 'chain', 'Canonical Bridge': 'chain',
    'Liquid Staking': 'staking', 'Liquid Restaking': 'staking', Restaking: 'staking',
    'Staking Pool': 'staking', 'Restaked BTC': 'staking',
    Indexes: 'funds', Launchpad: 'funds', 'Governance Incentives': 'funds', 'Token Locker': 'funds',
    'Anchor BTC': 'btc', 'Decentralized BTC': 'btc',
  };
  function archetype(category) { return ARCH[category] || 'other'; }
  var WALLETS = [
    'Open a fresh wallet only for {N}; keep its seed phrase offline on paper',
    'Set up a separate {N} wallet in your hardware wallet and label it',
    'Create a new address inside your wallet, reserved for {N} alone',
    'Open a fresh browser-profile wallet for {N}, apart from trading',
    'Use a dedicated farming wallet for {N}, funded from one clean source',
    'Start a new {N} wallet with a small test deposit before the full ticket',
    'Prepare a fresh wallet for {N} and note its address in your farm log',
    'Open a wallet just for {N} on a device you control; store the seed offline',
  ];
  var FUNDS = [
    'fund it with ${T} of USDC bridged from Ethereum to {C}',
    'fund it with ${T} of USDC withdrawn from MEXC straight to {C}',
    'fund it with ${T} of USDC swapped on {C} from the native asset',
    'fund it with ${T} of USDC moved from your main wallet to {C}',
    'fund it with ${T} of USDC bought on your exchange and withdrawn to {C}',
    'fund it with ${T} of USDC bridged to {C} via the protocol\'s own bridge page',
  ];
  var TIMINGS = [
    'before the next weekly snapshot, so week one already counts',
    'this week, so the position starts seasoning at once',
    'ahead of the weekend, when gas on {C} is usually cheapest',
    'today, while the position is small enough to unwind cheaply',
    'before the current points season closes, so no week is lost',
  ];
  var CHECKS = [
    'then confirm the balance on {C}\'s block explorer first',
    'then check the deposit landed by reading the balance in the {N} app',
    'then verify the address once more against the {N} app',
    'then save the transaction hash in your farm log as the starting point',
    'then confirm the funds show and the network matches {C}',
  ];
  var CORE = {
    vault: [
      'Deposit ${T} of USDC into the largest {N} vault on {C}',
      'Place ${T} of USDC in {N}\'s flagship vault on {C}',
    ],
    dex: [
      'Swap ${T} of USDC for the base asset in {N}\'s main pool on {C}',
      'Provide ${T} of liquidity to {N}\'s deepest pool on {C}',
    ],
    perps: [
      'Deposit ${T} of USDC as margin on {N} on {C}; open one small 1x hedge',
      'Fund a {N} margin account with ${T} on {C}; place one low-leverage trade',
    ],
    lending: [
      'Supply ${T} of USDC to {N} on {C} and keep the position open',
      'Lend ${T} of USDC through {N} on {C} at the market rate',
    ],
    stable: [
      'Mint ${T} of the stable asset through {N} on {C}',
      'Deposit ${T} of USDC into {N} on {C}; hold the minted stable asset',
    ],
    rwa: [
      'Mint ${T} of {N}\'s yield-bearing asset on {C} and hold it',
      'Buy ${T} of the {N} tokenised asset on {C}',
    ],
    prediction: [
      'Fund {N} with ${T} on {C}; place one position in its most liquid market',
      'Put ${T} behind one {N} market outcome on {C}',
    ],
    payments: [
      'Route ${T} of USDC through {N} on {C} for a real payment',
      'Pay ${T} through {N} on {C} using the farming wallet',
    ],
    chain: [
      'Bridge ${T} of USDC to {C} through {N}; use the bridged funds in its app',
      'Move ${T} of USDC across {N} to {C} and hold the bridged balance',
    ],
    staking: [
      'Stake ${T} of the staking asset through {N} on {C}; keep the receipt token',
      'Deposit ${T} into {N} staking on {C}',
    ],
    funds: [
      'Buy ${T} of the {N} index on {C} and hold it',
      'Deposit ${T} of USDC into {N} on {C}',
    ],
    btc: [
      'Deposit ${T} of BTC-backed collateral through {N} on {C}',
      'Mint ${T} of {N}\'s BTC-anchored asset on {C} and hold it',
    ],
    other: [
      'Deposit ${T} of USDC into {N} on {C} and keep the position open',
      'Open a ${T} position in {N}\'s main product on {C}',
    ],
  };
  var SIZINGS = [
    'in one go',
    'split across two deposits a day apart',
    'after checking the fee and slippage first',
    'in a single transaction, easy to trace',
  ];
  var SECOND = {
    vault: [
      'Add a smaller deposit to a second {N} vault on {C2}',
      'Move a quarter of the position to {N} on {C2}, covering a second chain',
    ],
    dex: [
      'Add liquidity to a second {N} pool on {C2}',
      'Swap a small amount on {N} on {C2} to cover the second chain',
    ],
    perps: [
      'Place a second small trade on {N} on {C2} in the opposite direction',
      'Open a hedge on {N} on {C2} with a quarter of the margin',
    ],
    lending: [
      'Borrow a small amount against the {N} collateral on {C}; repay within the week',
      'Supply a second asset to {N} on {C2}',
    ],
    stable: [
      'Redeem a small part of the {N} stable asset on {C} and mint it again',
      'Hold the {N} stable asset on {C2} as well as {C}',
    ],
    rwa: [
      'Try a second {N} asset on {C2} with a quarter of the ticket',
      'Redeem a small slice of the {N} asset and re-mint it on {C}',
    ],
    prediction: [
      'Place a second {N} position on {C} in a different market',
      'Take the other side of a {N} market on {C} with a small stake',
    ],
    payments: [
      'Make a second {N} payment on {C2} for a different amount',
      'Route a smaller payment through {N} on {C2}',
    ],
    chain: [
      'Bridge a smaller amount back through {N} to confirm the return path works',
      'Bridge a second amount through {N} to {C2}',
    ],
    staking: [
      'Stake a second, smaller amount through {N} on {C2}',
      'Restake the {N} receipt token once it is claimable',
    ],
    funds: [
      'Add a second {N} product on {C2} with a quarter of the ticket',
      'Rebalance the {N} position on {C} once during the first month',
    ],
    btc: [
      'Mint a smaller second {N} position on {C2}',
      'Redeem a small slice of the {N} asset and re-mint it',
    ],
    other: [
      'Use a second {N} feature on {C2} with a quarter of the ticket',
      'Repeat the main {N} action on {C2}',
    ],
  };
  var CADENCES = [
    'Repeat the core action weekly for 12 weeks, varying the amount between ${A1} and ${A2}',
    'Do the core action every 10 days, 9 times, alternating between ${A1} and ${A2}',
    'Repeat the core action twice a month for 6 sessions, amounts between ${A1} and ${A2}',
    'Top the position up weekly for 12 weeks, never the same amount twice in a row',
    'Repeat the core action every week for 12 weeks, skipping no week in the middle',
    'Do one qualifying action each week for 12 weeks, rotating deposit, swap and borrow',
  ];
  var CADENCE_ACTS = [
    'topping the position up', 'adding a little more', 'rebalancing slightly',
    'using the product again', 'repeating the main action', 'adjusting the position',
  ];
  var CADENCE_WHY = [
    'so no single week dominates the snapshot',
    'to build a history across many snapshots, not one day',
    'to average in rather than lump in',
    'to keep the position seasoned across the whole window',
  ];
  var PROGRAMS = [
    'Check whether {N} runs a points, quest or rewards program; join from its own page',
    'Look for a {N} season or points page; enrol the farming wallet if one is live',
    'Open {N}\'s rewards page; claim any weekly quest the wallet qualifies for',
    'Search {N}\'s official announcements for a points season; enrol before it closes',
    'Check {N} for a leaderboard or season pass; register the wallet if open',
    'Look for {N} quests on its official site; do the one matching the position',
  ];
  var PROGRAM_ACTS = [
    'complete one quest a week',
    'claim the weekly points once they post',
    'check the season progress every Sunday',
    'finish the onboarding quest first',
    'track the points balance after each action',
  ];
  var PROGRAM_NOTES = [
    'and keep the same wallet throughout the season',
    'without ever paying to join a program',
    'and note the season end date in the farm log',
    'so program activity matches the on-chain position',
  ];
  var EXITS = [
    'Set the exit rule now: withdraw if {N}\'s TVL falls more than {X}% in a week',
    'Set the exit rule now: halve the position if the {N} yield halves from entry',
    'Set the exit rule now: withdraw if {N} pauses deposits or changes contracts',
    'Set the exit rule now: unwind if the position drops {X}% below the ticket',
    'Set the exit rule now: exit if {N}\'s TVL falls {X}% in a week or yield turns negative',
  ];
  var EXIT_THRESHOLDS = [30, 25, 20, 15];
  var EXIT_ACTS = [
    'and write the rule in the farm log before the first deposit',
    'then stick to it instead of deciding under stress',
    'and check the trigger with every weekly action',
  ];
  var LOG_WHATS = [
    'Log every {N} action: date, transaction hash, amount and chain',
    'Record each {N} step in the farm log with date, hash and amount',
    'Write down every {N} transaction: when, what it cost, which chain',
    'Keep a dated log of the {N} position: deposits, rewards and gas paid',
    'Note each {N} action with its hash, size and wallet',
  ];
  var LOG_WHERES = [
    'in a plain spreadsheet',
    'in a notebook only you control',
    'in a notes app on the farming device',
    'in a text file beside the wallet backup',
    'in the same place as the wallet address list',
  ];
  var LOG_VERIFYS = [
    'and verify each hash on {C}\'s block explorer',
    'and compare the shares or balance after every step',
    'and screenshot the balance once a month as backup',
    'and re-check the totals before any claim window opens',
    'and keep the hashes until the season is fully settled',
  ];
  var CLAIMS = [
    'When a claim window opens, claim only from the link the {N} app itself publishes',
    'Watch for {N}\'s claim announcement; claim from its own app, never a message link',
    'At claim time, open {N}\'s official app and follow its claim flow',
    'If {N} announces a distribution, claim through its own site; check the amount',
  ];
  var CLAIM_CHANNELS = [
    'through the app\'s claim page',
    'from the protocol\'s own site',
    'via the claim flow in the {N} app',
  ];
  var CLAIM_SAFETYS = [
    'a real airdrop never asks for a seed phrase or a payment to claim',
    'never approve a claim asking for unlimited spending',
    'check the claim contract against the official announcement first',
    'if a claim link arrives by message, ignore it and open the app directly',
  ];
  function fill(tpl, ctx) {
    return tpl
      .replaceAll('{N}', ctx.name)
      .replaceAll('{C2}', ctx.chain2)
      .replaceAll('{C}', ctx.chain)
      .replaceAll('{T}', String(ctx.ticket))
      .replaceAll('{A1}', String(ctx.amt1))
      .replaceAll('{A2}', String(ctx.amt2))
      .replaceAll('{X}', String(ctx.threshold));
  }
  function planFor(ctx) {
    var ticket = ticketFor(ctx.tvl);
    var holdDays = holdFor(ctx.ageDays);
    var arch = archetype(ctx.category);
    var h = function (step, k) { return hash(ctx.slug + '|' + step + ':' + k + ':'); };
    var g1 = gasCents(ctx.chain);
    var g2 = gasCents(ctx.chain2);
    var amt1 = Math.max(10, Math.round(ticket * 0.1));
    var amt2 = Math.max(25, Math.round(ticket * 0.3));
    var threshold = pick(EXIT_THRESHOLDS, h(6, 0));
    var base = {
      name: ctx.name, chain: ctx.chain, chain2: ctx.chain2, ticket: ticket,
      amt1: amt1, amt2: amt2, threshold: threshold,
    };
    var steps = [];
    steps.push({
      text: fill(pick(WALLETS, h(1, 0)) + ', ' + pick(FUNDS, h(1, 1)) + ' ' + pick(TIMINGS, h(1, 2)) + ', ' + pick(CHECKS, h(1, 3)) + '.', base),
      gasCents: g1 * 2 + 25,
      minutes: 12 + (h(1, 4) % 19),
    });
    steps.push({
      text: fill(pick(CORE[arch], h(2, 0)) + ' ' + pick(SIZINGS, h(2, 1)) + '.', base),
      gasCents: g1,
      minutes: 18 + (h(2, 2) % 23),
    });
    steps.push({
      text: fill(pick(SECOND[arch], h(3, 0)) + '.', base),
      gasCents: g2,
      minutes: 12 + (h(3, 1) % 19),
    });
    steps.push({
      text: fill(pick(CADENCES, h(4, 0)) + ', ' + pick(CADENCE_ACTS, h(4, 1)) + ' each time, ' + pick(CADENCE_WHY, h(4, 2)) + '.', base),
      gasCents: g1 * 12,
      minutes: 60 + (h(4, 3) % 421),
    });
    steps.push({
      text: fill(pick(PROGRAMS, h(5, 0)) + '; ' + pick(PROGRAM_ACTS, h(5, 1)) + ' ' + pick(PROGRAM_NOTES, h(5, 2)) + '.', base),
      gasCents: 0,
      minutes: 8 + (h(5, 3) % 13),
    });
    steps.push({
      text: fill(pick(EXITS, h(6, 1)) + ', ' + pick(EXIT_ACTS, h(6, 2)) + '.', base),
      gasCents: 0,
      minutes: 8 + (h(6, 3) % 8),
    });
    steps.push({
      text: fill(pick(LOG_WHATS, h(7, 0)) + ' ' + pick(LOG_WHERES, h(7, 1)) + ' ' + pick(LOG_VERIFYS, h(7, 2)) + '.', base),
      gasCents: 0,
      minutes: 8 + (h(7, 3) % 13),
    });
    steps.push({
      text: fill(pick(CLAIMS, h(8, 0)) + ' ' + pick(CLAIM_CHANNELS, h(8, 1)) + '; at the board\'s implied value the slice is about ' + dollars(Math.round(ctx.slice * 100)) + ' per $1,000 farmed, but ' + pick(CLAIM_SAFETYS, h(8, 2)) + '.', base),
      gasCents: g1,
      minutes: 12 + (h(8, 3) % 19),
    });
    var gas90 = 0;
    var handsOn = 0;
    for (var i = 0; i < steps.length; i++) { gas90 += steps[i].gasCents; handsOn += steps[i].minutes; }
    return { steps: steps, ticket: ticket, holdDays: holdDays, gas90Cents: gas90, handsOn: handsOn };
  }
  function stepText(step) {
    return step.text + ' Cost: ' + dollars(step.gasCents) + ' gas. Time: ' + step.minutes + ' min.';
  }
  globalThis.FARM = {
    hash: hash, gasCents: gasCents, dollars: dollars,
    ticketFor: ticketFor, holdFor: holdFor, archetype: archetype,
    planFor: planFor, stepText: stepText,
  };
})();
