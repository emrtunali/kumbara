// What a list of categorised transactions says: monthly spending by category, the same in
// today's lira, subscriptions and their price rises, biggest merchants, small daily leaks and
// unusual spending. Pure functions; the page draws the results.

import { byId } from "./categorize.js";

// card payments move money between your own accounts: counting them would count purchases twice
export const NOT_SPENDING = new Set(["income", "card"]);

const month = (d) => d.slice(0, 7);
const sum = (a) => a.reduce((s, v) => s + v, 0);
const median = (a) => {
  const s = [...a].sort((x, y) => x - y), n = s.length;
  return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0;
};

/** CPI lookup by "YYYY-MM"; months after the last published one use the last value. */
export function cpiIndex(macroRows) {
  const map = new Map(macroRows.map((r) => [r.month, r.cpi]));
  const last = macroRows[macroRows.length - 1];
  return (m) => map.get(m) ?? (m > last.month ? last.cpi : macroRows[0].cpi);
}

export function months(txs) {
  return [...new Set(txs.map((t) => month(t.date)))].sort();
}

/** Spending per month and category; refunds (negative amounts) reduce their category. */
export function monthly(txs) {
  const ms = months(txs);
  const cats = new Map();
  const income = Object.fromEntries(ms.map((m) => [m, 0]));
  for (const t of txs) {
    if (t.cat === "income") { income[month(t.date)] -= t.amount; continue; }
    if (NOT_SPENDING.has(t.cat)) continue;
    if (!cats.has(t.cat)) cats.set(t.cat, Object.fromEntries(ms.map((m) => [m, 0])));
    cats.get(t.cat)[month(t.date)] += t.amount;
  }
  const total = Object.fromEntries(ms.map((m) => [m, sum([...cats.values()].map((c) => c[m]))]));
  return { months: ms, byCat: Object.fromEntries(cats), total, income };
}

/** Express monthly amounts in the lira of the latest month (removes inflation). */
export function toReal(series, cpi, base) {
  const b = cpi(base);
  return Object.fromEntries(Object.entries(series).map(([m, v]) => [m, (v * b) / cpi(m)]));
}

/** Category totals over the whole period, largest first. */
export function categoryTotals(txs) {
  const by = new Map();
  for (const t of txs) {
    if (NOT_SPENDING.has(t.cat)) continue;
    by.set(t.cat, (by.get(t.cat) || 0) + t.amount);
  }
  const total = sum([...by.values()]);
  return [...by.entries()].filter(([, v]) => v > 0)
    .map(([id, v]) => ({ id, name: byId[id]?.name ?? id, amount: v, share: v / total }))
    .sort((a, b) => b.amount - a.amount);
}

/**
 * Recurring payments: the same merchant charged in at least three different months, about a
 * month apart, with steady amounts. Reports the latest price, yearly cost and any price rise.
 */
export function subscriptions(txs) {
  const groups = new Map();
  for (const t of txs) {
    if (t.amount <= 0 || NOT_SPENDING.has(t.cat) || t.cat === "cash") continue;
    if (!groups.has(t.merchant)) groups.set(t.merchant, []);
    groups.get(t.merchant).push(t);
  }
  const out = [];
  for (const [merchant, list] of groups) {
    list.sort((a, b) => a.date.localeCompare(b.date));
    const ms = new Set(list.map((t) => month(t.date)));
    if (ms.size < 3 || list.length > ms.size * 1.5) continue; // several a month is shopping, not a subscription
    const gaps = list.slice(1).map((t, i) => (Date.parse(t.date) - Date.parse(list[i].date)) / 864e5);
    const monthlyGaps = gaps.filter((g) => g >= 25 && g <= 37).length;
    if (monthlyGaps < Math.max(2, gaps.length * 0.6)) continue;
    const amounts = list.map((t) => t.amount);
    const med = median(amounts);
    // steady price: allow increases over time, but not wildly different bills
    const steady = amounts.filter((a) => Math.abs(a - med) / med < 0.35).length >= amounts.length * 0.7;
    const bill = ["bills", "housing"].includes(list[0].cat);
    if (!steady && !bill) continue;
    const first = list[0].amount, last = list[list.length - 1].amount;
    out.push({
      merchant, cat: list[0].cat, name: titleCase(list[list.length - 1].desc, merchant),
      count: list.length, last, yearly: last * 12, since: list[0].date,
      rise: first > 0 ? last / first - 1 : 0, kind: bill ? "bill" : "subscription",
    });
  }
  return out.sort((a, b) => b.yearly - a.yearly);
}

function titleCase(desc, merchant) {
  return merchant.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") || desc;
}

/** Merchants by total spending. */
export function topMerchants(txs, n = 10) {
  const by = new Map();
  for (const t of txs) {
    if (t.amount <= 0 || NOT_SPENDING.has(t.cat)) continue;
    const g = by.get(t.merchant) || { merchant: t.merchant, cat: t.cat, amount: 0, count: 0 };
    g.amount += t.amount; g.count += 1;
    by.set(t.merchant, g);
  }
  return [...by.values()].sort((a, b) => b.amount - a.amount).slice(0, n);
}

/** Small frequent purchases (coffee, delivery) that add up: count, total and yearly pace. */
export function leaks(txs) {
  const ms = months(txs).length || 1;
  const small = txs.filter((t) => t.amount > 0 && ["food"].includes(t.cat));
  const byMerchant = new Map();
  for (const t of small) {
    const g = byMerchant.get(t.merchant) || { merchant: t.merchant, count: 0, amount: 0 };
    g.count += 1; g.amount += t.amount;
    byMerchant.set(t.merchant, g);
  }
  return [...byMerchant.values()].filter((g) => g.count >= ms * 2)
    .map((g) => ({ ...g, perMonth: g.amount / ms, yearly: (g.amount / ms) * 12 }))
    .sort((a, b) => b.yearly - a.yearly).slice(0, 5);
}

/** Purchases far above what is usual for their category. */
export function unusual(txs) {
  const by = new Map();
  for (const t of txs) if (t.amount > 0 && !NOT_SPENDING.has(t.cat)) {
    if (!by.has(t.cat)) by.set(t.cat, []);
    by.get(t.cat).push(t.amount);
  }
  const med = new Map([...by].map(([c, a]) => [c, median(a)]));
  return txs.filter((t) => t.amount > 0 && by.get(t.cat)?.length >= 5 && t.amount > 5 * med.get(t.cat) && t.amount > 1000)
    .sort((a, b) => b.amount - a.amount).slice(0, 8);
}

/** Headline numbers for the summary strip. */
export function summary(txs, cpi) {
  const m = monthly(txs);
  const n = m.months.length;
  const spend = sum(Object.values(m.total));
  const inc = sum(Object.values(m.income));
  const real = cpi && n >= 2 ? toReal(m.total, cpi, m.months[n - 1]) : null;
  // real change between the first and last full quarter
  let realTrend = null;
  if (real && n >= 6) {
    const a = sum(m.months.slice(0, 3).map((k) => real[k])), b = sum(m.months.slice(-3).map((k) => real[k]));
    realTrend = b / a - 1;
  }
  return {
    months: n, from: m.months[0], to: m.months[n - 1],
    spend, perMonth: n ? spend / n : 0, income: inc, perMonthIncome: n ? inc / n : 0,
    savingsRate: inc > 0 ? (inc - spend) / inc : null, monthlySavings: n ? (inc - spend) / n : 0,
    realTrend,
  };
}
