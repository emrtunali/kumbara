import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { cpiIndex, monthly } from "../site/js/analysis.js";
import { categorize } from "../site/js/categorize.js";
import { forecast, lastMonthPartial, monthEnd, personalInflation, recentMonthlyInflation } from "../site/js/insight.js";
import { classify, features, NaiveBayes, reviewQueue, train } from "../site/js/learn.js";
import { detectColumns, parseCSV, toTransactions } from "../site/js/parse.js";

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const unseen = JSON.parse(read("./fixtures/unseen-merchants.json")).items;
const hicp = JSON.parse(read("../site/data/hicp.json"));
const cpiRows = hicp.months.map((m, i) => ({ month: m, cpi: hicp.index.all[i] }));

test("features: words and fragments survive Turkish letters and inflection", () => {
  const a = features("KÖFTECİ YUSUF"), b = features("kofteci");
  assert.ok(a.includes("w:kofteci") && b.includes("kof"));
  assert.ok(a.filter((f) => b.includes(f)).length >= 8);
  assert.ok(!features("4521 3344").length, "numbers alone carry nothing");
});

test("naive Bayes learns a toy problem", () => {
  const nb = new NaiveBayes(["a", "b"]);
  nb.add("elma armut", "a"); nb.add("kalem defter", "b");
  assert.equal(nb.predict("armutlu tatli")[0].cat, "a");
  assert.equal(nb.predict("defterler")[0].cat, "b");
});

test("unseen local merchants: the model adds what rules cannot, and is careful", () => {
  const txs = unseen.map(([desc]) => ({ date: "2026-01-01", desc, amount: 100 }));
  const rulesRight = unseen.filter(([d, c]) => categorize(d, 100) === c).length / unseen.length;
  const out = classify(txs, {});
  const right = out.filter((t, i) => t.cat === unseen[i][1]).length / unseen.length;
  const decided = out.map((t, i) => [t, unseen[i][1]]).filter(([t]) => t.source !== "unsure");
  const precision = decided.filter(([t, c]) => t.cat === c).length / decided.length;
  const top3 = out.filter((t, i) => (t.source === "rule" ? t.cat === unseen[i][1] : t.alt.some((a) => a.cat === unseen[i][1]))).length / unseen.length;
  // measured: rules 14 %, rules + model 79 %, precision 97 %, top-3 99 % (see README)
  assert.ok(rulesRight < 0.25, `rules ${rulesRight}`);
  assert.ok(right > 0.75, `rules+model ${right}`);
  assert.ok(precision > 0.93, `precision ${precision}`);
  assert.ok(top3 > 0.95, `top3 ${top3}`);
});

test("one correction teaches the model about similar names", () => {
  const txs = [{ date: "2026-01-01", desc: "ZEYTINCI HASAN", amount: 300 }, { date: "2026-01-05", desc: "ZEYTINCILIK AS", amount: 250 }];
  const before = classify(txs, {})[1];
  const after = classify(txs, { "zeytinci hasan": "grocery" });
  assert.equal(after[0].source, "you");
  assert.equal(after[1].cat, "grocery");
  assert.ok(after[1].conf > (before.cat === "grocery" ? before.conf : 0));
});

test("rules win over the model; money in stays income", () => {
  const out = classify([{ date: "2026-01-01", desc: "MIGROS KAHVE", amount: 100 }, { date: "2026-01-02", desc: "KAHVECI", amount: -50 }]);
  assert.equal(out[0].source, "rule");
  assert.equal(out[0].cat, "grocery");
  assert.equal(out[1].cat, "income");
});

test("review queue asks about the costliest uncertain merchants first", () => {
  const txs = [
    { date: "2026-01-01", desc: "QWERTY LTD", amount: 9000 },
    { date: "2026-01-02", desc: "ASDF TIC", amount: 50 },
    { date: "2026-01-03", desc: "MIGROS", amount: 800 },
  ];
  const q = reviewQueue(classify(txs, {}));
  assert.equal(q[0].merchant, "qwerty");
  assert.ok(!q.some((x) => x.merchant === "migros"));
});

const demo = () => {
  const rows = parseCSV(read("../site/demo/ornek-hesap-hareketleri.csv"));
  const txs = toTransactions(rows, detectColumns(rows));
  return classify(txs, {}, train(txs, {}));
};

test("personal inflation weights category prices by the basket", () => {
  const p = personalInflation(demo(), hicp);
  const w = p.rows.reduce((s, r) => s + r.weight, 0);
  assert.ok(Math.abs(w - 1) < 1e-9);
  assert.ok(Math.abs(p.personal - p.rows.reduce((s, r) => s + r.contribution, 0)) < 1e-12);
  // the demo basket is rent-heavy and rent rose faster than prices overall
  assert.equal(p.rows[0].cat, "housing");
  assert.ok(p.personal > p.official);
});

test("forecast and month-end projection are sane on the demo", () => {
  const txs = demo();
  const m = monthly(txs);
  const f = forecast(m, cpiIndex(cpiRows), recentMonthlyInflation(cpiRows), lastMonthPartial(txs));
  const lastTotal = m.total[m.months[m.months.length - 1]];
  assert.ok(f.total.lo <= f.total.mid && f.total.mid <= f.total.hi);
  assert.ok(f.total.mid > lastTotal * 0.6 && f.total.mid < lastTotal * 1.6);
  // cut the demo at 15 October: the projection must bracket what October really became
  const cut = txs.filter((t) => t.date <= "2026-10-15");
  const me = monthEnd(cut, "2026-10");
  const real = txs.filter((t) => t.date.startsWith("2026-10") && t.amount > 0 && !["income", "card"].includes(t.cat)).reduce((s, t) => s + t.amount, 0);
  assert.ok(me.lo <= me.mid && me.mid <= me.hi);
  assert.ok(real >= me.lo * 0.9 && real <= me.hi * 1.1, `real ${real} range ${me.lo}..${me.hi}`);
});
