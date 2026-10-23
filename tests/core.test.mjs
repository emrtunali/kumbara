import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { categoryTotals, cpiIndex, leaks, monthly, subscriptions, summary } from "../site/js/analysis.js";
import { categorize, categorizeAll, merchantKey } from "../site/js/categorize.js";
import { detectColumns, fromTextLines, merge, parseAmount, parseCSV, parseDate, toTransactions } from "../site/js/parse.js";
import { history, payment, simulate } from "../site/js/simulate.js";

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const macro = JSON.parse(read("../site/data/macro.json")).rows;

test("amounts in Turkish and other formats", () => {
  assert.equal(parseAmount("1.234,56"), 1234.56);
  assert.equal(parseAmount("-1.234,56 TL"), -1234.56);
  assert.equal(parseAmount("1,234.56"), 1234.56);
  assert.equal(parseAmount("(123,45)"), -123.45);
  assert.equal(parseAmount("123,45-"), -123.45);
  assert.equal(parseAmount("+500"), 500);
  assert.equal(parseAmount("1.250"), 1250);
  assert.equal(parseAmount("12.50"), 12.5);
  assert.ok(Number.isNaN(parseAmount("bakiye")));
});

test("dates in Turkish and other formats", () => {
  assert.equal(parseDate("12.10.2025"), "2025-10-12");
  assert.equal(parseDate("1/2/26"), "2026-02-01");
  assert.equal(parseDate("2025-10-12T00:00"), "2025-10-12");
  assert.equal(parseDate("12 Ekim 2025"), "2025-10-12");
  assert.equal(parseDate("3 Şubat 2026"), "2026-02-03");
  assert.equal(parseDate(45940), "2025-10-10"); // Excel serial (45658 = 1 Jan 2025)
  assert.equal(parseDate("32.13.2025"), "");
});

test("bank export: header found below title lines, spending made positive", () => {
  const rows = parseCSV(read("../site/demo/ornek-hesap-hareketleri.csv"));
  const det = detectColumns(rows);
  assert.equal(det.header[det.mapping.date], "Tarih");
  assert.equal(det.header[det.mapping.amount], "Tutar");
  assert.equal(det.header[det.mapping.desc], "Açıklama");
  const txs = toTransactions(rows, det);
  assert.ok(txs.length > 600);
  const salary = txs.find((t) => t.desc.startsWith("MAAS"));
  assert.ok(salary.amount < 0, "money in is negative");
  assert.ok(txs.find((t) => t.desc.startsWith("NETFLIX")).amount > 0, "spending is positive");
});

test("card statement with quotes and commas reads the same", () => {
  const rows = parseCSV(read("./fixtures/kart-ekstresi.csv"));
  const txs = toTransactions(rows, detectColumns(rows));
  assert.equal(txs.length, 200);
  assert.ok(txs.find((t) => t.desc.startsWith("YEMEKSEPETI")).amount > 0);
});

test("separate Borç/Alacak columns", () => {
  const rows = parseCSV("Tarih;Açıklama;Borç;Alacak;Bakiye\n01.03.2026;MIGROS;500,00;;10.000,00\n02.03.2026;MAAS;;40.000,00;50.000,00\n");
  const det = detectColumns(rows);
  const txs = toTransactions(rows, det);
  assert.deepEqual(txs.map((t) => t.amount), [500, -40000]);
});

test("PDF text lines: date first, amount last, balance ignored", () => {
  const txs = fromTextLines([
    "HESAP ÖZETİ",
    "05.03.2026 05.03.2026 MIGROS 4521 KADIKOY 1.234,56 15.000,00",
    "07.03.2026 NETFLIX.COM 299,99",
    "Toplam 1.534,55",
  ]);
  assert.deepEqual(txs.map((t) => [t.date, t.desc, t.amount]), [["2026-03-05", "MIGROS 4521 KADIKOY", 1234.56], ["2026-03-07", "NETFLIX.COM", 299.99]]);
});

test("merging overlapping statements keeps real repeats", () => {
  const a = [{ date: "2026-03-01", desc: "STARBUCKS", amount: 150 }, { date: "2026-03-01", desc: "STARBUCKS", amount: 150 }];
  const b = [{ date: "2026-03-01", desc: "STARBUCKS", amount: 150 }, { date: "2026-03-02", desc: "MIGROS", amount: 800 }];
  assert.equal(merge([a, b]).length, 3);
});

test("categories from Turkish merchant names", () => {
  const cases = {
    "MIGROS 4521 KADIKOY ISTANBUL TR": "grocery", "BİM BİRLEŞİK MAĞAZALAR": "grocery", "TRENDYOL YEMEK ISTANBUL": "food",
    "TRENDYOL.COM": "shopping", "GETIRYEMEK": "food", "NETFLIX.COM ISTANBUL TR": "subs", "APPLE.COM/BILL ISTANBUL TR": "subs",
    "ENERJISA ISTANBUL ANADOLU YAKASI": "bills", "SHELL KADIKOY 3": "fuel", "ISTANBULKART BELBIM": "transport",
    "EFT - KIRA ODEMESI AYSE YILMAZ": "housing", "ECZANE MERKEZ KADIKOY": "health", "ATM PARA CEKME ZIRAAT": "cash",
    "YILLIK KART UCRETI": "fees", "BILINMEYEN DUKKAN": "other",
  };
  for (const [desc, cat] of Object.entries(cases)) assert.equal(categorize(desc, 100), cat, desc);
  assert.equal(categorize("MAAS ODEMESI ACME", -85000), "income");
  assert.equal(categorize("MIGROS", 100, { [merchantKey("MIGROS")]: "food" }), "food", "user override wins");
});

test("merchant key drops numbers and places", () => {
  assert.equal(merchantKey("MIGROS 4521 KADIKOY ISTANBUL TR"), "migros");
  assert.equal(merchantKey("SPOTIFY P0A8B1 STOCKHOLM SE"), "spotify");
  assert.equal(merchantKey("APPLE.COM/BILL ISTANBUL TR"), "apple");
  assert.equal(merchantKey("A101 YENI MAGAZACILIK"), "a101 yeni magazacilik");
});

const demo = () => {
  const rows = parseCSV(read("../site/demo/ornek-hesap-hareketleri.csv"));
  return categorizeAll(toTransactions(rows, detectColumns(rows)));
};

test("demo: subscriptions found, with Netflix's price rise", () => {
  const subs = subscriptions(demo());
  const names = subs.map((s) => s.merchant);
  for (const m of ["netflix", "spotify", "youtube premium google", "apple"]) assert.ok(names.includes(m), m);
  const netflix = subs.find((s) => s.merchant === "netflix");
  assert.equal(netflix.last, 299.99);
  assert.ok(Math.abs(netflix.rise - (299.99 / 229.99 - 1)) < 1e-9);
  assert.ok(!names.includes("migros"), "groceries are not a subscription");
});

test("demo: totals add up and income is separate", () => {
  const txs = demo();
  const m = monthly(txs);
  assert.equal(m.months.length, 12);
  const cats = categoryTotals(txs);
  const total = cats.reduce((s, c) => s + c.amount, 0);
  const direct = txs.filter((t) => !["income", "card"].includes(t.cat)).reduce((s, t) => s + t.amount, 0);
  assert.ok(Math.abs(total - direct) < 1e-6);
  const s = summary(txs, cpiIndex(macro));
  assert.ok(s.income > 1_000_000 && s.savingsRate > 0 && s.savingsRate < 0.6);
  assert.ok(leaks(txs).some((l) => l.merchant.startsWith("starbucks")));
});

test("annuity payment", () => {
  assert.ok(Math.abs(payment(1000, 0.01, 12) - 88.8488) < 1e-3);
  assert.equal(payment(1200, 0, 12), 100);
});

test("rent-or-buy accounting matches a hand calculation in a flat world", () => {
  // no inflation, no growth, no interest: the buyer ends with the house (less selling costs),
  // the renter with the down payment, purchase costs and the monthly difference
  const flat = { inflation: 0, houseReal: 0, rentReal: 0, depositReal: 0, usdReal: 0 };
  const r = simulate(history(macro), {
    source: "custom", custom: flat, mortgageRate: 0, withholding: 0, years: 10, termMonths: 120,
    price: 6_000_000, downPct: 0.4, buyCostPct: 0.045, rent: 30_000, upkeepPct: 0.005, taxInsPct: 0.0015, sellCostPct: 0.04,
  });
  const owner = (6_000_000 * 0.6) / 120 + (6_000_000 * 0.0065) / 12; // 33,250 a month
  const renter = 6_000_000 * (0.4 + 0.045) + (owner - 30_000) * 120;
  const buyer = 6_000_000 * 0.96;
  assert.ok(Math.abs(r.diff.p50 - (buyer - renter)) < 1);
});

test("history bootstrap is reproducible and sane", () => {
  const h = history(macro);
  const a = simulate(h, { sims: 300 }), b = simulate(h, { sims: 300 });
  assert.equal(a.diff.p50, b.diff.p50);
  assert.ok(a.buyWins >= 0 && a.buyWins <= 1);
  assert.ok(a.diff.p10 <= a.diff.p50 && a.diff.p50 <= a.diff.p90);
  // where housing earns no more than deposits, a dearer house for the same rent must make buying
  // look worse (in Türkiye's history houses beat deposits, so there it can go the other way)
  const world = { source: "custom", withholding: 0, custom: { inflation: 0.25, houseReal: 0, rentReal: 0, depositReal: 0.05, usdReal: 0 } };
  assert.ok(simulate(h, { ...world, price: 15_000_000 }).diff.p50 < simulate(h, { ...world, price: 6_000_000 }).diff.p50);
});
