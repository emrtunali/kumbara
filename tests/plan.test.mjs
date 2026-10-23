import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { classify, train } from "../site/js/learn.js";
import { detectColumns, parseCSV, toTransactions } from "../site/js/parse.js";
import { duplicates, monthlyByCat, monthsToGoal, newRecurring, plan } from "../site/js/plan.js";

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const demo = () => {
  const rows = parseCSV(read("../site/demo/ornek-hesap-hareketleri.csv"));
  const txs = toTransactions(rows, detectColumns(rows));
  return classify(txs, {}, train(txs, {}));
};

test("plan adds what cuts and cancellations free up", () => {
  const p = plan({ income: 100_000, spend: 90_000 }, { food: 10_000, shopping: 6_000 }, { food: 0.5, shopping: 0.25, rent: 1 }, [{ monthly: 300 }]);
  assert.equal(p.now, 10_000);
  assert.equal(p.freedCats, 6_500); // a cut on a category with no spending frees nothing
  assert.equal(p.after, 16_800);
  assert.equal(p.yearly, 6_800 * 12);
});

test("months to goal: plain, with interest, against inflation, out of reach", () => {
  assert.equal(monthsToGoal(120_000, 10_000), 12);
  assert.ok(monthsToGoal(120_000, 10_000, { rate: 0.03 }) < 12);
  assert.ok(monthsToGoal(120_000, 10_000, { inflation: 0.03 }) > 12);
  assert.equal(monthsToGoal(120_000, 0), Infinity);
  assert.equal(monthsToGoal(100, 0, { start: 200 }), 1);
  assert.equal(monthsToGoal(1e12, 1, { inflation: 0.05 }), Infinity);
});

test("demo: the double card charge is caught, everyday repeats are not", () => {
  const d = duplicates(demo());
  assert.equal(d.length, 1);
  assert.equal(d[0].first.merchant, "ikea umraniye");
  assert.equal(d[0].amount, 4380);
});

test("demo: the subscription that started recently is flagged, old ones are not", () => {
  const n = newRecurring(demo());
  assert.deepEqual(n.map((x) => x.merchant), ["disney plus"]);
});

test("monthly averages per category exclude income and card payments", () => {
  const by = monthlyByCat(demo(), 12);
  assert.ok(!("income" in by) && !("card" in by));
  assert.ok(by.housing > 25_000 && by.housing < 40_000);
});
