// Personal inflation and next month's spending.
//
// Personal inflation: the official rate averages everyone's basket. Weighting the official price
// index of each spending category (Eurostat HICP for Türkiye) by *your* spending shares gives the
// inflation rate of your own basket, and which categories drive it.
//
// Forecast: next month's spending per category, in today's prices from the recent level and
// carried forward by recent inflation, with an 80 % range from how much each category has
// varied. A month still in progress is projected to its end from how spending usually
// accumulates through a month.

import { NOT_SPENDING } from "./analysis.js";

// spending category -> HICP index weights
export const HICP_MAP = {
  grocery: { food: 1 },
  food: { restaurants: 1 },
  travel: { restaurants: 1 },
  housing: { rent: 1 },
  bills: { electricity: 0.6, communication: 0.4 },
  fuel: { fuel: 1 },
  transport: { transport: 1 },
  health: { health: 1 },
  shopping: { clothing: 0.5, furnishings: 0.5 },
  fun: { recreation: 1 },
  subs: { recreation: 0.6, communication: 0.4 },
  edu: { education: 1 },
};

const sum = (a) => a.reduce((s, v) => s + v, 0);

/** Year-on-year change of each HICP index at its latest month (or at `month`). */
export function yearly(hicp, month) {
  const i = month ? Math.min(hicp.months.indexOf(month) >= 0 ? hicp.months.indexOf(month) : hicp.months.length - 1, hicp.months.length - 1) : hicp.months.length - 1;
  const out = {};
  for (const [k, v] of Object.entries(hicp.index)) out[k] = i >= 12 ? v[i] / v[i - 12] - 1 : NaN;
  return { month: hicp.months[i], rates: out };
}

/** Inflation of the user's own basket, the official rate, and each category's contribution. */
export function personalInflation(txs, hicp) {
  const by = new Map();
  for (const t of txs) if (t.amount > 0 && !NOT_SPENDING.has(t.cat)) by.set(t.cat, (by.get(t.cat) || 0) + t.amount);
  const total = sum([...by.values()]);
  if (!total) return null;
  const { month, rates } = yearly(hicp);
  const rows = [...by.entries()].map(([cat, amount]) => {
    const map = HICP_MAP[cat];
    const rate = map ? sum(Object.entries(map).map(([k, w]) => w * rates[k])) : rates.all;
    const weight = amount / total;
    return { cat, weight, rate, contribution: weight * rate, mapped: !!map };
  }).sort((a, b) => b.contribution - a.contribution);
  const personal = sum(rows.map((r) => r.contribution));
  return { month, personal, official: rates.all, gap: personal - rates.all, rows };
}

const daysIn = (ym) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate();

/** Is the last month of the statement complete? */
export function lastMonthPartial(txs) {
  const last = txs[txs.length - 1]?.date;
  if (!last) return false;
  return +last.slice(8, 10) < daysIn(last.slice(0, 7)) - 3;
}

/**
 * Next month per category (and in total) in lira, with an 80 % range.
 * `cpi(m)` gives the price level of a month; `monthlyInflation` carries prices one month on.
 */
export function forecast(m, cpi, monthlyInflation, partial = false) {
  const months = partial ? m.months.slice(0, -1) : m.months;
  if (months.length < 3) return null;
  const base = months[months.length - 1];
  const real = (series) => months.map((k) => ((series[k] || 0) * cpi(base)) / cpi(k));
  const W = [0.2, 0.3, 0.5]; // latest month weighs most
  const one = (vals) => {
    const last3 = vals.slice(-3);
    const level = sum(last3.map((v, i) => v * W[i]));
    // spread: typical absolute deviation of a month from the average of the three before it
    const dev = [];
    for (let i = 3; i < vals.length; i++) dev.push(Math.abs(vals[i] - (vals[i - 1] + vals[i - 2] + vals[i - 3]) / 3));
    const mad = dev.length ? [...dev].sort((a, b) => a - b)[Math.floor(dev.length / 2)] : level * 0.2;
    const g = 1 + monthlyInflation;
    return { mid: level * g, lo: Math.max(0, (level - 1.9 * mad) * g), hi: (level + 1.9 * mad) * g };
  };
  const cats = Object.fromEntries(Object.entries(m.byCat).map(([c, s]) => [c, one(real(s))]));
  const total = one(real(m.total));
  return { base, cats, total };
}

/**
 * Where a month in progress is heading: spending so far divided by the share of a month's
 * spending that has usually happened by this day (from the complete months).
 */
export function monthEnd(txs, partialMonth) {
  const spend = txs.filter((t) => t.amount > 0 && !NOT_SPENDING.has(t.cat));
  const today = Math.max(...spend.filter((t) => t.date.startsWith(partialMonth)).map((t) => +t.date.slice(8, 10)));
  const soFar = sum(spend.filter((t) => t.date.startsWith(partialMonth)).map((t) => t.amount));
  const others = [...new Set(spend.map((t) => t.date.slice(0, 7)))].filter((k) => k !== partialMonth);
  const shares = others.map((k) => {
    const list = spend.filter((t) => t.date.startsWith(k));
    const tot = sum(list.map((t) => t.amount));
    const scaled = Math.round((today / daysIn(partialMonth)) * daysIn(k));
    return tot ? sum(list.filter((t) => +t.date.slice(8, 10) <= scaled).map((t) => t.amount)) / tot : null;
  }).filter((s) => s > 0).sort((a, b) => a - b);
  if (!shares.length || !Number.isFinite(today)) return null;
  const mid = shares[Math.floor(shares.length / 2)];
  return {
    month: partialMonth, day: today, soFar,
    mid: soFar / mid, lo: soFar / shares[shares.length - 1], hi: soFar / shares[0],
  };
}

/** Average monthly inflation over the last `n` months of the CPI rows. */
export function recentMonthlyInflation(rows, n = 6) {
  const a = rows[rows.length - 1 - n].cpi, b = rows[rows.length - 1].cpi;
  return (b / a) ** (1 / n) - 1;
}
