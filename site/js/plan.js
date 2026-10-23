// Savings planner and alerts.
//
// The planner answers "how long until I reach my goal, and what if I spent less here?": monthly
// savings now, plus what each category cut and each cancelled subscription frees up.
// Alerts catch money that may be leaving by mistake: the same charge twice in a few days, and
// new monthly payments (a free trial that quietly became a subscription).

import { NOT_SPENDING } from "./analysis.js";

// categories people can realistically trim; rent, bills and health are left out
export const FLEXIBLE = ["food", "shopping", "fun", "subs", "transport", "fuel", "grocery", "travel", "care"];

/**
 * Monthly savings after cuts.
 *   base: {income, spend} per month on average
 *   byCat: {cat: average monthly spend}
 *   cuts: {cat: share cut, 0..1}
 *   cancelled: [{monthly}] subscriptions to drop
 */
export function plan(base, byCat, cuts = {}, cancelled = []) {
  const freedCats = Object.entries(cuts).reduce((s, [c, k]) => s + (byCat[c] || 0) * Math.min(1, Math.max(0, k)), 0);
  const freedSubs = cancelled.reduce((s, x) => s + x.monthly, 0);
  const now = base.income - base.spend;
  const after = now + freedCats + freedSubs;
  return { now, after, freed: freedCats + freedSubs, freedCats, freedSubs, yearly: (freedCats + freedSubs) * 12 };
}

/**
 * Months to save `goal` lira at `monthly` a month. Savings kept in a deposit earning `rate` a
 * month (after tax) reach the goal sooner; prices rising `inflation` a month make the goal move.
 * Returns Infinity when the goal is out of reach.
 */
export function monthsToGoal(goal, monthly, { rate = 0, inflation = 0, start = 0 } = {}) {
  if (monthly <= 0 && start < goal) return Infinity;
  let bal = start, target = goal;
  for (let m = 1; m <= 600; m++) {
    bal = bal * (1 + rate) + monthly;
    target *= 1 + inflation;
    if (bal >= target) return m;
  }
  return Infinity;
}

/** Average monthly spend per category. */
export function monthlyByCat(txs, months) {
  const by = {};
  for (const t of txs) if (!NOT_SPENDING.has(t.cat)) by[t.cat] = (by[t.cat] || 0) + t.amount;
  for (const k of Object.keys(by)) by[k] /= months || 1;
  return by;
}

const day = (d) => Date.parse(d) / 864e5;

/**
 * The same merchant charged the same amount within `days` days. Small everyday purchases
 * (groceries, coffee, transport) repeat by nature and are left out.
 */
export function duplicates(txs, days = 3) {
  const skip = new Set(["grocery", "food", "transport", "fuel", "cash", "income", "card"]);
  const list = txs.filter((t) => t.amount >= 150 && !skip.has(t.cat)).sort((a, b) => a.date.localeCompare(b.date));
  const out = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length && day(list[j].date) - day(list[i].date) <= days; j++) {
      const a = list[i], b = list[j];
      if (a.merchant === b.merchant && Math.abs(a.amount - b.amount) < 0.005) out.push({ first: a, second: b, amount: a.amount });
    }
  }
  return out;
}

/**
 * Monthly payments that started recently: the same merchant, a steady amount, about a month
 * apart, seen only in the last few months of the statement.
 */
export function newRecurring(txs, recentMonths = 3) {
  const months = [...new Set(txs.map((t) => t.date.slice(0, 7)))].sort();
  if (months.length < recentMonths + 2) return [];
  const cutoff = months[months.length - recentMonths];
  const by = new Map();
  for (const t of txs) {
    if (t.amount <= 0 || NOT_SPENDING.has(t.cat) || ["cash", "grocery", "food", "transport", "fuel"].includes(t.cat)) continue;
    if (!by.has(t.merchant)) by.set(t.merchant, []);
    by.get(t.merchant).push(t);
  }
  const out = [];
  for (const [merchant, list] of by) {
    if (list[0].date < cutoff || list.length < 2 || list.length > recentMonths + 1) continue;
    const gaps = list.slice(1).map((t, i) => day(t.date) - day(list[i].date));
    const steady = list.every((t) => Math.abs(t.amount - list[0].amount) / list[0].amount < 0.15);
    if (steady && gaps.every((g) => g >= 25 && g <= 37)) out.push({ merchant, desc: list[0].desc, amount: list[list.length - 1].amount, since: list[0].date, count: list.length });
  }
  return out;
}
