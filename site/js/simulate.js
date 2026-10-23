// Rent or buy? A Monte Carlo comparison of two households with the same monthly budget.
//
// The buyer pays the down payment and purchase costs, then the mortgage, upkeep, property tax and
// insurance. The renter invests what the buyer put down and pays rent. Every month, whoever pays
// less invests the difference, so both spend exactly the same; at the horizon the house is sold
// (minus selling costs and the remaining loan) and the two net worths are compared in today's lira.
//
// Futures are built by block bootstrap: 12-month stretches of Türkiye's own history (inflation,
// house prices, rents, the lira and interest rates of the same months) are strung together, which
// keeps the relationships between them (high inflation with high rates, rent catching up with
// house prices) instead of inventing them. A "custom" mode replaces history with fixed assumptions.

export const DEFAULTS = {
  price: 6_000_000, // TL
  downPct: 0.4,
  buyCostPct: 0.045, // title deed fee (tapu harcı), loan fees, appraisal
  mortgageRate: 0.025, // monthly, fixed (Turkish mortgages are fixed-rate)
  termMonths: 120,
  rent: 30_000, // TL a month for an equivalent home
  upkeepPct: 0.005, // a year, of the home's value
  taxInsPct: 0.0015, // property tax + DASK and home insurance, a year
  sellCostPct: 0.04, // agent + seller's share of the title deed fee
  years: 10,
  invest: "deposit", // "deposit" | "usd" | "mix"
  withholding: 0.15, // stopaj on deposit interest
  depositSpread: 0.0, // deposit rate minus the interbank rate, a year
  source: "history", // "history" | "recent" | "custom"
  houseAdj: 0, // shifts house price growth, %-points a year (stress test)
  custom: { inflation: 0.25, houseReal: 0.0, rentReal: 0.02, depositReal: 0.03, usdReal: 0.0 },
  sims: 2000,
  seed: 7,
};

/** Small fast seeded RNG (mulberry32) so results are reproducible. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Monthly growth factors from the macro history rows. */
export function history(rows) {
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    out.push({ month: b.month, cpi: b.cpi / a.cpi, rent: b.rent / a.rent, house: b.house / a.house, usd: b.usd / a.usd, rate: b.rate / 100 });
  }
  return out;
}

/** One future of `n` months: 12-month blocks drawn from history (or fixed assumptions). */
export function path(hist, n, rand, p) {
  if (p.source === "custom") {
    const c = p.custom, inf = (1 + c.inflation) ** (1 / 12);
    const m = {
      cpi: inf, house: inf * (1 + c.houseReal) ** (1 / 12), rent: inf * (1 + c.rentReal) ** (1 / 12),
      usd: inf * (1 + c.usdReal) ** (1 / 12), rate: (1 + c.inflation) * (1 + c.depositReal) - 1,
    };
    return Array.from({ length: n }, () => m);
  }
  const pool = p.source === "recent" ? hist.slice(-60) : hist;
  const block = Math.min(12, pool.length);
  const out = [];
  while (out.length < n) {
    const s = Math.floor(rand() * (pool.length - block + 1));
    for (let k = 0; k < block && out.length < n; k++) out.push(pool[s + k]);
  }
  return out;
}

export function payment(loan, r, n) {
  if (loan <= 0) return 0;
  return r === 0 ? loan / n : (loan * r) / (1 - (1 + r) ** -n);
}

/** One household pair along one path; returns yearly real net worths and the cost details. */
export function run(path_, p) {
  const n = path_.length;
  const loan = p.price * (1 - p.downPct);
  const A = payment(loan, p.mortgageRate, p.termMonths);
  const adj = (1 + p.houseAdj) ** (1 / 12);
  let value = p.price, balance = loan, rent = p.rent, rentIndex = 1;
  let buyerPf = 0, renterPf = p.price * p.downPct + p.price * p.buyCostPct;
  let deflator = 1, interest = 0;
  const yearly = [];
  let first = null;
  for (let t = 0; t < n; t++) {
    const m = path_[t];
    // costs this month
    const mortgage = t < p.termMonths ? A : 0;
    if (t < p.termMonths) {
      const i = balance * p.mortgageRate;
      interest += i;
      balance = Math.max(0, balance - (A - i));
    }
    const owner = mortgage + (value * (p.upkeepPct + p.taxInsPct)) / 12;
    if (!first) first = { mortgage, owner, rent };
    // the cheaper side invests the difference
    if (owner > rent) renterPf += owner - rent; else buyerPf += rent - owner;
    // markets move
    const dep = (1 + (m.rate + p.depositSpread) * (1 - p.withholding)) ** (1 / 12);
    const g = p.invest === "usd" ? m.usd : p.invest === "mix" ? 0.5 * dep + 0.5 * m.usd : dep;
    buyerPf *= g; renterPf *= g;
    value *= m.house * adj;
    rentIndex *= m.rent;
    deflator *= m.cpi;
    // leases renew once a year at the rent level of the market
    if ((t + 1) % 12 === 0) {
      rent = p.rent * rentIndex;
      const buyer = value * (1 - p.sellCostPct) - balance + buyerPf;
      yearly.push({ buyer: buyer / deflator, renter: renterPf / deflator });
    }
  }
  return { yearly, payment: A, loan, interest, first };
}

const q = (sorted, p) => {
  if (!sorted.length) return NaN;
  const i = (sorted.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
};

/** Run many futures and summarise: chance that buying wins, spread of outcomes, breakeven year. */
export function simulate(hist, params = {}) {
  const p = { ...DEFAULTS, ...params, custom: { ...DEFAULTS.custom, ...(params.custom || {}) } };
  const rand = rng(p.seed);
  const n = p.years * 12;
  const sims = p.source === "custom" ? 1 : p.sims;
  const years = p.years;
  const buyer = Array.from({ length: years }, () => []), renter = Array.from({ length: years }, () => []);
  const diffs = [], breakeven = [];
  let detail = null;
  for (let s = 0; s < sims; s++) {
    const r = run(path(hist, n, rand, p), p);
    detail ??= r;
    r.yearly.forEach((y, k) => { buyer[k].push(y.buyer); renter[k].push(y.renter); });
    const last = r.yearly[years - 1];
    diffs.push(last.buyer - last.renter);
    const be = r.yearly.findIndex((y) => y.buyer > y.renter);
    breakeven.push(be < 0 ? Infinity : be + 1);
  }
  const band = (arr) => arr.map((a) => { const s = [...a].sort((x, y) => x - y); return { p10: q(s, 0.1), p50: q(s, 0.5), p90: q(s, 0.9) }; });
  const ds = [...diffs].sort((a, b) => a - b);
  const bs = [...breakeven].sort((a, b) => a - b);
  return {
    params: p, sims,
    buyWins: diffs.filter((d) => d > 0).length / sims,
    diff: { p10: q(ds, 0.1), p50: q(ds, 0.5), p90: q(ds, 0.9) },
    diffs: ds,
    buyer: band(buyer), renter: band(renter),
    breakevenYear: Number.isFinite(q(bs, 0.5)) ? q(bs, 0.5) : null,
    payment: detail.payment, loan: detail.loan, interest: detail.interest, first: detail.first,
    upfront: p.price * (p.downPct + p.buyCostPct),
  };
}

/** Which assumption moves the answer most: the median outcome with each input nudged. */
export function sensitivity(hist, params = {}) {
  const base = simulate(hist, { ...params, sims: Math.min(params.sims ?? 600, 600) });
  const p = base.params;
  const tests = [
    ["Kredi faizi ±0,5 puan/ay", { mortgageRate: p.mortgageRate + 0.005 }, { mortgageRate: Math.max(0, p.mortgageRate - 0.005) }],
    ["Konut fiyat artışı ±5 puan/yıl", { houseAdj: p.houseAdj - 0.05 }, { houseAdj: p.houseAdj + 0.05 }],
    ["Kira ±%20", { rent: p.rent * 0.8 }, { rent: p.rent * 1.2 }],
    ["Peşinat %20 / %60", { downPct: 0.2 }, { downPct: 0.6 }],
    ["Süre 5 / 15 yıl", { years: 5 }, { years: 15 }],
  ];
  return {
    base: base.diff.p50,
    rows: tests.map(([label, lo, hi]) => ({
      label,
      low: simulate(hist, { ...params, ...lo, sims: 600 }).diff.p50,
      high: simulate(hist, { ...params, ...hi, sims: 600 }).diff.p50,
    })),
  };
}
