// The token radar's ledger: one sealed snapshot in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never
// a ceiling) plus the pre-token protocols below the floor the radar exists to
// find. A protocol is pre-token when its DefiLlama record carries no token
// (no market cap, no CoinGecko id, no symbol); the wording everywhere is
// "records no token", never "has no token", because the record is not proof.
//
// Implied value follows only from the snapshot's own figures, fitted at
// runtime from the 128 comparables that record a token:
//
//   curve       log10(mcap/TVL) = a + b*log10(TVL), OLS over the 128
//   category    raw factor = median of mcap/(TVL*curve) inside the category,
//               shrunk toward 1 with 4 pseudo-comps: factor^(n/(n+4))
//   growth      1 + 0.75*change_7d, clamped to [0.60, 1.60]
//   age         0.55 + 0.45*min(age_days,730)/730; unknown age = 365 days
//   implied     TVL * curve * category * growth * age, rounded to dollars
//
// There is NO maturity factor anywhere in this file. No protocol name is
// ever special-cased: the same function scores every row.
//
// The P25-P75 band comes from the residuals AFTER the shrunk category
// effect: ratios mcap/(TVL*curve*category) over the 128 comparables, type-7
// quartiles taken in ratio space (loF x0.3553, hiF x2.8871, ratio x8.13).
// The farm slice is 7.5% of the implied value shared pro rata to TVL:
// slice per $1,000 farmed = 75 * implied / TVL.

import './farm.js';

const FARM = (globalThis as unknown as { FARM: FarmApi }).FARM;

interface FarmApi {
  ticketFor(tvl: number): number;
  holdFor(ageDays: number | null): number;
  planFor(ctx: FarmCtx): FarmPlan;
  stepText(step: FarmStep): string;
}
interface FarmCtx {
  slug: string; name: string; category: string | null; chain: string; chain2: string;
  tvl: number; ageDays: number | null; implied: number; slice: number;
}
interface FarmStep { text: string; gasCents: number; minutes: number }
interface FarmPlan {
  steps: FarmStep[]; ticket: number; holdDays: number; gas90Cents: number; handsOn: number;
}

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null;
  listed_at: string | null; gecko_id: string | null; symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string; source: string; floor_usd: number;
  protocols: SnapshotProtocol[]; watchlist: string[];
}

/** Why the snapshot is not one this ledger can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
/** Pseudo-comps the category effect is shrunk with (toward a factor of 1). */
export const SHRINK_K = 4;
/** Days for the age factor to reach 1.00; unknown age is treated as this many days. */
export const AGE_FULL_DAYS = 730;
export const UNKNOWN_AGE_DAYS = 365;
/** Share of the implied value assumed to reach farmers, pro rata to TVL. */
export const SLICE_SHARE = 0.075;
/** Verdict thresholds on the slice per $1,000 farmed. */
export const WORTH_IT_MIN = 20.45;
export const LOW_SLICE_MAX = 5;

/** Families: each category belongs to exactly one family. Comps are picked
 *  inside the family, so a row's comparables are its own kind of protocol.
 *  A family is defined by its categories, printed in full on the dashboard.
 *  Payments is the one thin family: only 2 live comparables exist, so its
 *  rows show 2 same-family comps and 2 nearest live comps, labelled honestly. */
export const FAMILIES: Record<string, string[]> = {
  'Vaults': ['Risk Curators', 'Onchain Capital Allocator', 'Yield', 'Yield Aggregator', 'Liquidity Manager', 'Leveraged Farming', 'Farm', 'Options Vault'],
  'Trading': ['Dexs', 'Derivatives', 'Basis Trading', 'Prediction Market', 'OTC Marketplace'],
  'Lending': ['Lending', 'CDP', 'CDP Manager', 'Collateral Management', 'Collateral Markets', 'Uncollateralized Lending', 'Interest Rate Derivatives'],
  'Real World & Bitcoin': ['RWA', 'Dual-Token Stablecoin', 'Stablecoin Wrapper', 'Anchor BTC', 'Decentralized BTC', 'Algo-Stables', 'Stablecoin Issuer', 'Reserve Currency'],
  'Chains & Bridges': ['Chain', 'Cross Chain Bridge', 'Bridge', 'Canonical Bridge'],
  'Staking': ['Restaking', 'Staking Pool', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC'],
  'Funds & Launch': ['Indexes', 'Launchpad', 'Token Locker', 'Insurance', 'Governance Incentives'],
  'Payments': ['Payments', 'Crypto Card Issuer', 'CeDeFi'],
  'Exchanges': ['CEX'],
  'Other': ['AI Agents', 'Decentralized AI', 'NFT Marketplace', 'Privacy', 'Options', 'Synthetics', 'DOR'],
};

const CATEGORY_TO_FAMILY = new Map<string, string>();
for (const [fam, cats] of Object.entries(FAMILIES)) {
  for (const c of cats) CATEGORY_TO_FAMILY.set(c, fam);
}
/** A protocol's family: its category's family, or "Other" when DefiLlama names none. */
export function familyOf(category: string | null): string {
  if (category === null) return 'Other';
  return CATEGORY_TO_FAMILY.get(category) ?? 'Other';
}

const finite = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The age factor: 0.55 for a brand-new record, rising to 1.00 at 730 days. */
export function ageFactor(days: number | null): number {
  const d = days ?? UNKNOWN_AGE_DAYS;
  return 0.55 + 0.45 * (Math.min(Math.max(d, 0), AGE_FULL_DAYS) / AGE_FULL_DAYS);
}

/** The growth factor: 1 + 0.75 * 7-day change, clamped to [0.60, 1.60]. */
export function growthFactor(change7d: number | null): number {
  const f = 1 + 0.75 * (finite(change7d, 0) / 100);
  return Math.min(1.6, Math.max(0.6, f));
}

/** Median of numbers: the middle value, or the mean of the two middles. */
export function median(values: number[]): number {
  const x = [...values].sort((a, b) => a - b);
  const n = x.length;
  if (n === 0) throw new SnapshotError('median of no values');
  return n % 2 === 1 ? x[(n - 1) / 2]! : (x[n / 2 - 1]! + x[n / 2]!) / 2;
}

/** Type-7 quartile of sorted numbers, in the space the numbers are given in. */
export function quantile7(sorted: number[], q: number): number {
  const n = sorted.length;
  const h = (n - 1) * q;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (h - lo);
}

/** OLS fit of log10(mcap/TVL) = a + b*log10(TVL) over the comparables. */
export function fitCurve(comps: SnapshotProtocol[]): { a: number; b: number } {
  const xs = comps.map((p) => Math.log10(p.tvl_usd));
  const ys = comps.map((p) => Math.log10(p.mcap_usd! / p.tvl_usd));
  const n = xs.length;
  const mx = xs.reduce((t, v) => t + v, 0) / n;
  const my = ys.reduce((t, v) => t + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
  }
  const b = sxy / sxx;
  return { a: my - b * mx, b };
}

/** The curve's multiple at a TVL: mcap/TVL the size curve predicts. */
export function curveMultiple(tvl: number, fit: { a: number; b: number }): number {
  return Math.pow(10, fit.a + fit.b * Math.log10(tvl));
}

/** Leave-one-out median error factor of the size curve (refit without each comp). */
export function looError(comps: SnapshotProtocol[]): number {
  const errs: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const rest = comps.filter((_, j) => j !== i);
    const f = fitCurve(rest);
    const pred = comps[i]!.tvl_usd * curveMultiple(comps[i]!.tvl_usd, f);
    const actual = comps[i]!.mcap_usd!;
    errs.push(Math.max(pred / actual, actual / pred));
  }
  return median(errs);
}

/** Median error factor of a flat multiple (one median mcap/TVL for every comp). */
export function flatLooError(comps: SnapshotProtocol[]): number {
  const flat = median(comps.map((p) => p.mcap_usd! / p.tvl_usd));
  const errs = comps.map((p) => {
    const pred = p.tvl_usd * flat;
    const actual = p.mcap_usd!;
    return Math.max(pred / actual, actual / pred);
  });
  return median(errs);
}

/** The fitted model, computed once from the snapshot. */
export interface FittedModel {
  comps: SnapshotProtocol[];
  fit: { a: number; b: number };
  loo: number;
  flatLoo: number;
  /** Shrunk category factor per category (1 when the category has no comps). */
  categoryFactor: Map<string, number>;
  /** Raw (unshrunk) category factor and comp count, for the model view. */
  categoryRaw: Map<string, { raw: number; n: number }>;
  /** P25-P75 band factors from residuals after the shrunk category effect. */
  loF: number;
  hiF: number;
  /** R-squared of the log-log fit, for the model view. */
  r2: number;
}

export function fitModel(snapshot: Snapshot): FittedModel {
  const comps = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const fit = fitCurve(comps);
  const loo = looError(comps);
  const flatLoo = flatLooError(comps);
  // R-squared in log space.
  const ys = comps.map((p) => Math.log10(p.mcap_usd! / p.tvl_usd));
  const my = ys.reduce((t, v) => t + v, 0) / ys.length;
  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < comps.length; i++) {
    const pred = fit.a + fit.b * Math.log10(comps[i]!.tvl_usd);
    ssTot += (ys[i]! - my) ** 2;
    ssRes += (ys[i]! - pred) ** 2;
  }
  const r2 = 1 - ssRes / ssTot;
  // Raw category factor: median of mcap/(TVL*curve) inside the category.
  const byCat = new Map<string, number[]>();
  for (const p of comps) {
    const key = p.category ?? '';
    const arr = byCat.get(key) ?? [];
    arr.push(p.mcap_usd! / (p.tvl_usd * curveMultiple(p.tvl_usd, fit)));
    byCat.set(key, arr);
  }
  const categoryFactor = new Map<string, number>();
  const categoryRaw = new Map<string, { raw: number; n: number }>();
  for (const [cat, ratios] of byCat) {
    const raw = median(ratios);
    const n = ratios.length;
    categoryRaw.set(cat, { raw, n });
    categoryFactor.set(cat, Math.pow(raw, n / (n + SHRINK_K)));
  }
  // Residuals after the shrunk category effect, quartiles in ratio space.
  const residuals = comps
    .map((p) => {
      const cf = categoryFactor.get(p.category ?? '') ?? 1;
      return p.mcap_usd! / (p.tvl_usd * curveMultiple(p.tvl_usd, fit) * cf);
    })
    .sort((a, b) => a - b);
  const loF = quantile7(residuals, 0.25);
  const hiF = quantile7(residuals, 0.75);
  return { comps, fit, loo, flatLoo, categoryFactor, categoryRaw, loF, hiF, r2 };
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** Exchange names a protocol may not start with (the house list, plus other large CEXs). */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini|HTX|KuCoin)/;
/** Categories that are not a launch: exchanges, bridges and staking products. */
const EXCLUDED_CATEGORIES = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);
/** Whole-word wrapped / staked / staking in a name. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Whether a protocol is one the board may rank: pre-token, not an exchange,
 *  not a bridge or staking product, not a versioned pool, not a wrapped or
 *  staked product, not named after an exchange. */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !EXCLUDED_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !WRAPPED_WORD.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name)
  );
}

/** One row of board.json: the ranked board's row.
 *  Sentinels (so no row ever prints the words null/undefined/NaN): category
 *  '' when DefiLlama names none, change_7d 9999 when unreported, age_days -1
 *  when the listing date is unknown. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string;
  family: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number;
  age_days: number;
  implied_value_usd: number;
  model: {
    curve_multiple: number;
    category_factor: number;
    growth_factor: number;
    age_factor: number;
    lo_usd: number;
    hi_usd: number;
  };
  slice_per_1k: number;
  verdict: 'Worth it' | 'Thin' | 'Low slice';
  ticket_usd: number;
  hold_days: number;
  gas_90d_usd: number;
  hands_on_min: number;
  comps: { slug: string; name: string; category: string | null; tvl_usd: number; multiple: number; same_family: boolean }[];
  farm_steps: string[];
}

/** Four comparables for a row: the nearest live protocols by TVL inside its
 *  family; when the family holds fewer than four, the rest are the nearest
 *  live protocols overall and are labelled as such. */
export function pickComps(row: SnapshotProtocol, model: FittedModel): BoardRow['comps'] {
  const fam = familyOf(row.category);
  const byDist = (q: SnapshotProtocol): number => Math.abs(Math.log10(q.tvl_usd) - Math.log10(row.tvl_usd));
  const sorted = [...model.comps].sort((a, b) => byDist(a) - byDist(b) || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const same = sorted.filter((q) => familyOf(q.category) === fam);
  const chosen: SnapshotProtocol[] = same.slice(0, 4);
  if (chosen.length < 4) {
    for (const q of sorted) {
      if (chosen.length >= 4) break;
      if (!chosen.includes(q)) chosen.push(q);
    }
  }
  chosen.sort((a, b) => byDist(a) - byDist(b) || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  return chosen.map((q) => ({
    slug: q.slug,
    name: q.name,
    category: q.category,
    tvl_usd: q.tvl_usd,
    multiple: Math.round((q.mcap_usd! / q.tvl_usd) * 10000) / 10000,
    same_family: familyOf(q.category) === fam,
  }));
}

/** The verdict from the slice per $1,000 farmed. */
export function verdictFor(slice: number): BoardRow['verdict'] {
  if (slice >= WORTH_IT_MIN) return 'Worth it';
  if (slice < LOW_SLICE_MAX) return 'Low slice';
  return 'Thin';
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: FittedModel): BoardRow[] {
  const watch = new Set(snapshot.watchlist);
  const chosen = snapshot.protocols.filter((p) => watch.has(p.slug) || isRankable(p));
  const scored = chosen.map((p) => {
    const age = ageDays(snapshot.as_of, p.listed_at);
    const curve = curveMultiple(p.tvl_usd, model.fit);
    const catF = model.categoryFactor.get(p.category ?? '') ?? 1;
    const growth = growthFactor(p.change_7d);
    const ageF = ageFactor(age);
    const implied = Math.max(1, Math.round(p.tvl_usd * curve * catF * growth * ageF));
    const slice = (SLICE_SHARE * 1000 * implied) / p.tvl_usd;
    const chain = p.chains.length > 0 ? p.chains[0]! : 'Ethereum';
    const chain2 = p.chains.length > 1 ? p.chains[1]! : chain;
    const plan = FARM.planFor({
      slug: p.slug, name: p.name, category: p.category, chain, chain2,
      tvl: p.tvl_usd, ageDays: age, implied, slice,
    });
    return {
      p, age, curve, catF, growth, ageF, implied, slice, plan,
      comps: pickComps(p, model),
    };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category ?? '',
    family: familyOf(s.p.category),
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d ?? 9999,
    age_days: s.age ?? -1,
    implied_value_usd: s.implied,
    model: {
      curve_multiple: Math.round(s.curve * 10000) / 10000,
      category_factor: Math.round(s.catF * 1000000) / 1000000,
      growth_factor: Math.round(s.growth * 10000) / 10000,
      age_factor: Math.round(s.ageF * 10000) / 10000,
      lo_usd: Math.round(s.implied * model.loF),
      hi_usd: Math.round(s.implied * model.hiF),
    },
    slice_per_1k: Math.round(s.slice * 100) / 100,
    verdict: verdictFor(s.slice),
    ticket_usd: s.plan.ticket,
    hold_days: s.plan.holdDays,
    gas_90d_usd: Math.round(s.plan.gas90Cents) / 100,
    hands_on_min: s.plan.handsOn,
    comps: s.comps,
    farm_steps: s.plan.steps.map((step) => FARM.stepText(step)),
  }));
}

/** The dashboard's compact view of the board, for data.js. */
export interface RadarData {
  as_of: string;
  floor_usd: number;
  total_protocols: number;
  already_trading: number;
  set_aside: number;
  watchlist_size: number;
  early_size: number;
  early_below_floor: number;
  early_above_floor: number;
  total_implied_usd: number;
  model: {
    a: number; b: number; loo: number; flat_loo: number; r2: number;
    lo_f: number; hi_f: number; n_comps: number; shrink_k: number;
    worth_it_min: number; low_slice_max: number; slice_share: number;
  };
  categories: string[];
  families: Record<string, string[]>;
  chains: string[];
  /** rows, pipe-encoded, one per line (numbers base36, integers only):
   *  slug|name|catIdx|chainIdx,chainIdx|tvl|change_7d x100|ageDays|implied|compIdx,compIdx|tier
   *  (change_7d 999900 = unreported, ageDays -1 = unknown) */
  rows: string;
  /** comps, pipe-encoded, one per line: name|catIdx|tvl|multiple x10000 */
  comps: string;
  /** category table: [catIdx, nComps, shrunkFactor] for categories with comps */
  cat_table: unknown[][];
  /** set-aside pre-token protocols, by reason */
  setaside_counts: Record<string, number>;
}

export function buildRadar(snapshot: Snapshot, model: FittedModel, board: BoardRow[]): RadarData {
  const categories = [...new Set(snapshot.protocols.map((p) => p.category ?? ''))].sort();
  const catIdx = new Map(categories.map((c, i) => [c, i]));
  const chains = [...new Set(board.flatMap((r) => r.chains))].sort();
  const chainIdx = new Map(chains.map((c, i) => [c, i]));
  const compIdx = new Map(model.comps.map((p, i) => [p.slug, i]));
  const watch = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watch.has(r.slug));
  // Numbers are base36 (integers only, so the round trip is exact): tvl and
  // implied as dollars, change_7d in hundredths of a percent, multiples x10000.
  const b36 = (n: number): string => n.toString(36);
  const rows = board.map((r) => [
    r.slug,
    r.name,
    b36(catIdx.get(r.category) ?? -1),
    r.chains.map((c) => b36(chainIdx.get(c) ?? -1)).join(','),
    b36(r.tvl_usd),
    b36(Math.round(r.change_7d * 100)),
    b36(r.age_days),
    b36(r.implied_value_usd),
    r.comps.map((c) => b36(compIdx.get(c.slug) ?? -1)).join(','),
    b36(watch.has(r.slug) ? 0 : r.tvl_usd >= snapshot.floor_usd ? 2 : 1),
  ].join('|')).join('\n');
  const comps = model.comps.map((p) => [
    p.name, b36(catIdx.get(p.category ?? '') ?? -1), b36(p.tvl_usd),
    b36(Math.round((p.mcap_usd! / p.tvl_usd) * 10000)),
  ].join('|')).join('\n');
  const catTable = [...model.categoryRaw.entries()]
    .map(([cat, v]) => [
      catIdx.get(cat) ?? -1, v.n,
      Math.round((model.categoryFactor.get(cat) ?? 1) * 10000) / 10000,
    ])
    .sort((a, b) => (b[1] as number) - (a[1] as number) || ((a[0] as number) - (b[0] as number)));
  const alreadyTrading = snapshot.protocols.filter((p) => !isPreToken(p)).length;
  const boardSlugs = new Set(board.map((r) => r.slug));
  const setasideCounts: Record<string, number> = {};
  for (const p of snapshot.protocols) {
    if (!isPreToken(p) || boardSlugs.has(p.slug)) continue;
    const reason = EXCLUDED_CATEGORIES.has(p.category ?? '')
      ? 'excluded category (exchange, bridge or staking product)'
      : VERSIONED.test(p.name)
        ? 'versioned pool name'
        : WRAPPED_WORD.test(p.name)
          ? 'wrapped / staked product'
          : EXCHANGE_PREFIX.test(p.name)
            ? 'exchange name'
            : 'not rankable';
    setasideCounts[reason] = (setasideCounts[reason] ?? 0) + 1;
  }
  return {
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    total_protocols: snapshot.protocols.length,
    already_trading: alreadyTrading,
    set_aside: snapshot.protocols.length - board.length - alreadyTrading,
    watchlist_size: snapshot.watchlist.length,
    early_size: early.length,
    early_below_floor: early.filter((r) => r.tvl_usd < snapshot.floor_usd).length,
    early_above_floor: early.filter((r) => r.tvl_usd >= snapshot.floor_usd).length,
    total_implied_usd: board.reduce((t, r) => t + r.implied_value_usd, 0),
    model: {
      a: Math.round(model.fit.a * 10000) / 10000,
      b: Math.round(model.fit.b * 10000) / 10000,
      loo: Math.round(model.loo * 10000) / 10000,
      flat_loo: Math.round(model.flatLoo * 10000) / 10000,
      r2: Math.round(model.r2 * 1000) / 1000,
      lo_f: Math.round(model.loF * 10000) / 10000,
      hi_f: Math.round(model.hiF * 10000) / 10000,
      n_comps: model.comps.length,
      shrink_k: SHRINK_K,
      worth_it_min: WORTH_IT_MIN,
      low_slice_max: LOW_SLICE_MAX,
      slice_share: SLICE_SHARE,
    },
    categories,
    families: FAMILIES,
    chains,
    rows,
    comps,
    cat_table: catTable,
    setaside_counts: setasideCounts,
  };
}

/** The snapshot out of a file's text, refused unless it is the shape the ledger scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
      if (/undefined|null|NaN/.test(s)) return `${r.slug} has a farm step naming ${/undefined|null|NaN/.exec(s)?.[0]}`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
