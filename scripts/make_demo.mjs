// Synthetic but realistic statements for the demo button and the tests.
//
//   node scripts/make_demo.mjs
//
// One year of a young professional in İstanbul: salary, rent, groceries, delivery, coffee,
// subscriptions (one with a price rise), bills, fuel, transport, shopping and a few one-offs.
// Writes a bank account export (";" separated, spending negative, "1.234,56") and a credit card
// statement (spending positive), the two shapes Turkish banks use most.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rng } from "../site/js/simulate.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rand = rng(2026);
const pick = (a) => a[Math.floor(rand() * a.length)];
const between = (lo, hi) => lo + rand() * (hi - lo);
const tl = (v) => v.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const ddmmyyyy = (d) => `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`;

const start = Date.UTC(2025, 10, 1); // 1 Nov 2025
const days = 365;
const tx = []; // {date: Date, desc, amount (positive = spent)}
const add = (d, desc, amount) => tx.push({ date: new Date(d), desc, amount: Math.round(amount * 100) / 100 });

// monthly inflation of about 2.2 %: prices drift up through the year
const infl = (k) => 1.022 ** k;

for (let m = 0; m < 12; m++) {
  const first = Date.UTC(2025, 10 + m, 1);
  const day = (n) => first + (n - 1) * 864e5;
  add(day(1), "MAAS ODEMESI ACME TEKNOLOJI A.S.", -(m < 6 ? 85000 : 102000)); // raise in May
  add(day(3), "EFT - KIRA ODEMESI AYSE YILMAZ", m < 9 ? 28000 : 36400); // lease renewal in August
  add(day(5), "NETFLIX.COM ISTANBUL TR", m < 7 ? 229.99 : 299.99);
  add(day(7), "SPOTIFY P0A8B1 STOCKHOLM SE", 99.0);
  add(day(9), "YOUTUBE PREMIUM GOOGLE IST TR", 79.99);
  add(day(12), "APPLE.COM/BILL ISTANBUL TR", 39.99);
  add(day(14), "TURKCELL FATURA ODEME", 640 * infl(m));
  add(day(16), "ENERJISA ISTANBUL ANADOLU YAKASI", between(900, 1700) * infl(m) * (m >= 1 && m <= 3 ? 1.3 : 1));
  add(day(18), "IGDAS DOGALGAZ FATURA", between(400, 2600) * (m >= 0 && m <= 4 ? 2.2 : 0.5) * infl(m));
  add(day(20), "SUPERONLINE INTERNET", 749 * infl(m));
  add(day(25), "MACFIT KADIKOY ISTANBUL", 2900);
  add(day(2), "YILLIK KART UCRETI", m === 3 ? 1450 : 0);
}

for (let i = 0; i < days; i++) {
  const d = start + i * 864e5;
  const k = i / 30.4;
  const wd = new Date(d).getUTCDay();
  if (rand() < 0.42) add(d, pick(["MIGROS 4521 KADIKOY ISTANBUL TR", "A101 YENI MAGAZACILIK", "BIM BIRLESIK MAGAZALAR", "SOK MARKETLER TIC", "CARREFOURSA ATASEHIR"]), between(150, 1400) * infl(k));
  if (rand() < 0.3) add(d, pick(["STARBUCKS MODA ISTANBUL TR", "KAHVE DUNYASI KADIKOY", "SIMIT SARAYI BAHARIYE"]), between(95, 260) * infl(k));
  if ((wd === 5 || wd === 6 || rand() < 0.15) && rand() < 0.6) add(d, pick(["YEMEKSEPETI*ORDER", "TRENDYOL YEMEK ISTANBUL", "GETIRYEMEK"]), between(280, 900) * infl(k));
  if (rand() < 0.22) add(d, pick(["ISTANBULKART BELBIM", "UBER *TRIP HELP.UBER.COM", "MARTI SCOOTER"]), between(60, 420) * infl(k));
  if (rand() < 0.06) add(d, pick(["SHELL KADIKOY 3", "OPET MODA", "PETROL OFISI ATASEHIR"]), between(1200, 2600) * infl(k));
  if (rand() < 0.08) add(d, pick(["TRENDYOL.COM", "HEPSIBURADA.COM", "LC WAIKIKI KADIKOY", "WATSONS BAHARIYE", "DECATHLON ATASEHIR"]), between(250, 3200) * infl(k));
  if (rand() < 0.03) add(d, pick(["ECZANE MERKEZ KADIKOY", "ACIBADEM HASTANESI"]), between(150, 2400) * infl(k));
  if (rand() < 0.02) add(d, pick(["BILETIX", "CINEMAXIMUM CAPITOL", "STEAM PURCHASE"]), between(200, 1500) * infl(k));
  if (rand() < 0.015) add(d, "ATM PARA CEKME ZIRAAT", 2000);
  // small local businesses the brand rules do not know: the learning model's job
  if (rand() < 0.07) add(d, pick(["KOFTECI YUSUF BAKIRKOY", "CIGKOFTECI OMER HAN", "BALIKCI ALI USTA", "PIDECI ERCAN MODA"]), between(220, 780) * infl(k));
  if (rand() < 0.05) add(d, pick(["MANAV DOGAL GIDA", "SARKUTERI TARIHI", "KURUYEMISCI KOCABEY"]), between(140, 650) * infl(k));
  if (rand() < 0.025) add(d, pick(["ECZ DENIZ", "DISCI HEKIM CAN"]), between(180, 2600) * infl(k));
  if (rand() < 0.02) add(d, "KUAFOR SALON ELIF", between(450, 1200) * infl(k));
  if (rand() < 0.015) add(d, "YILDIZ PETROL LTD", between(1400, 2400) * infl(k));
}
// one-offs
add(Date.UTC(2026, 1, 14), "TEKNOSA ATASEHIR MAGAZA", 38499);
add(Date.UTC(2026, 6, 3), "PEGASUS HAVA YOLLARI", 6840);
add(Date.UTC(2026, 6, 4), "BOOKING.COM HOTEL", 14200);
add(Date.UTC(2026, 2, 20), "TRENDYOL.COM IADE", -1299);

const rows = tx.filter((t) => t.amount !== 0).sort((a, b) => a.date - b.date);

// bank account export: spending negative, running balance, header lines above the table
let balance = 50000;
const bank = ["Hesap Hareketleri;;;", "Müşteri: ÖRNEK KİŞİ;;;", ";;;", "Tarih;Açıklama;Tutar;Bakiye"];
for (const t of rows) {
  balance -= t.amount;
  bank.push(`${ddmmyyyy(t.date)};${t.desc};${tl(-t.amount)};${tl(balance)}`);
}
fs.mkdirSync(path.join(root, "site/demo"), { recursive: true });
fs.writeFileSync(path.join(root, "site/demo/ornek-hesap-hareketleri.csv"), "﻿" + bank.join("\n") + "\n");

// card statement: purchases positive, comma separated with quotes
const card = ['"İşlem Tarihi","Açıklama","Tutar (TL)"'];
for (const t of rows.slice(0, 200)) card.push(`"${ddmmyyyy(t.date)}","${t.desc}","${tl(t.amount)}"`);
fs.mkdirSync(path.join(root, "tests/fixtures"), { recursive: true });
fs.writeFileSync(path.join(root, "tests/fixtures/kart-ekstresi.csv"), card.join("\n") + "\n");

console.log(`${rows.length} transactions, ${ddmmyyyy(rows[0].date)}..${ddmmyyyy(rows[rows.length - 1].date)}`);
