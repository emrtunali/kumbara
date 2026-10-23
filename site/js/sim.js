// The rent-or-buy screen: reads the form, runs the Monte Carlo, draws the answer.

import { el, fmt, histogram, lineChart, niceTicks, short, TL } from "./charts.js";
import { parseAmount } from "./parse.js";
import { history, sensitivity, simulate } from "./simulate.js";

const $ = (s) => document.querySelector(s);
const form = $("#sim-form");
let hist = null, macroRows = null, budget = null, timer = null, ready = false;

const PCT = new Set(["mortgageRate", "upkeepPct", "taxInsPct", "sellCostPct", "withholding"]);

function read() {
  const f = new FormData(form);
  const num = (k) => parseAmount(f.get(k));
  const p = {
    price: num("price"), rent: num("rent"),
    downPct: +f.get("downPct"), buyCostPct: +f.get("buyCostPct"), years: +f.get("years"), houseAdj: +f.get("houseAdj"),
    termMonths: +f.get("termMonths"), invest: f.get("invest"), source: f.get("source"),
    custom: Object.fromEntries(["inflation", "houseReal", "rentReal", "depositReal", "usdReal"].map((k) => [k, num("c_" + k) / 100])),
  };
  for (const k of PCT) p[k] = num(k) / 100;
  return p;
}

function labels() {
  const v = (n) => form.elements[n].value;
  const out = { downPct: `%${fmt(v("downPct") * 100)}`, buyCostPct: `%${fmt(v("buyCostPct") * 100, 1)}`, years: `${v("years")} yıl`, houseAdj: v("houseAdj") == 0 ? "geçmiş gibi" : `${v("houseAdj") > 0 ? "+" : "−"}${fmt(Math.abs(v("houseAdj")) * 100)} puan/yıl` };
  form.querySelectorAll("output[data-for]").forEach((o) => (o.textContent = out[o.dataset.for] ?? ""));
  $("#custom").hidden = v("source") !== "custom";
}

function valid(p) {
  return p.price > 0 && p.rent > 0 && p.mortgageRate >= 0 && p.mortgageRate < 0.2;
}

function run() {
  labels();
  if (!hist) return;
  const p = read();
  if (!valid(p)) { $("#verdict").innerHTML = `<p class="note">Ev fiyatı, kira ve faiz alanlarını kontrol et.</p>`; return; }
  const r = simulate(hist, p);
  const years = Array.from({ length: p.years }, (_, i) => i + 1);
  const buy = r.buyWins >= 0.5;
  const single = r.sims === 1;
  const diff = r.diff.p50;
  const share = buy ? r.buyWins : 1 - r.buyWins;

  // the answer in one sentence, then the numbers behind it
  const head = single
    ? `${p.years} yıl sonunda ${diff >= 0 ? "ev alan" : "kirada kalan"} <b>${TL(Math.abs(diff))}</b> daha zengin.`
    : `${p.years} yıl sonunda ${buy ? "ev almak" : "kirada kalmak"} senaryoların <b>%${fmt(share * 100)}</b>'${suffix(share)} daha kazançlı.`;
  const owner = r.first.owner, affordable = budget && budget.rent ? budget.rent + Math.max(0, budget.monthlySavings) : null;
  $("#verdict").innerHTML = `
    <div class="big">${head}</div>
    <div class="stats">
      ${single ? "" : `<div class="stat"><div class="label">Medyan fark (bugünün parasıyla)</div><div class="value">${diff >= 0 ? "Ev alan +" : "Kiracı +"}${TL(Math.abs(diff))}</div></div>
      <div class="stat"><div class="label">%80 aralık</div><div class="value">${signed(r.diff.p10)} … ${signed(r.diff.p90)}</div></div>`}
      <div class="stat"><div class="label">Ev almanın öne geçtiği yıl</div><div class="value">${r.breakevenYear ? (single ? "" : "medyan ") + fmt(r.breakevenYear) + ". yıl" : `${p.years} yıl içinde değil`}</div></div>
      <div class="stat"><div class="label">Kredi taksidi</div><div class="value">${TL(r.payment)}/ay</div></div>
      <div class="stat"><div class="label">Başta gereken nakit</div><div class="value">${TL(r.upfront)}</div></div>
    </div>
    ${affordable != null && owner > affordable ? `<div class="warn-box">⚠ Ev sahibi olarak ilk ay <b>${TL(owner)}</b> ödersin; ekstrene göre bugünkü kiran ve birikimin toplamı <b>${TL(affordable)}</b>. Fark ayda ${TL(owner - affordable)}: bu bütçeyle taksit zorlayıcı.</div>` : ""}
    ${affordable != null && owner <= affordable ? `<div class="warn-box" style="background:color-mix(in oklab,var(--accent) 14%,var(--surface))">✓ İlk ayın ${TL(owner)} maliyeti, ekstrene göre bugünkü kira ve birikim toplamına (${TL(affordable)}) sığıyor.</div>` : ""}`;

  lineChart($("#c-wealth"), {
    aria: "Ev alan ve kirada kalanın net serveti", x: years, xfmt: (y) => `${y}. yıl`, height: 300,
    series: [
      ...(single ? [] : [{ kind: "band", lo: r.renter.map((b) => b.p10), hi: r.renter.map((b) => b.p90), color: "--rent-band", label: "Kiracı %80" },
        { kind: "band", lo: r.buyer.map((b) => b.p10), hi: r.buyer.map((b) => b.p90), color: "--buy-band", label: "Ev alan %80" }]),
      { kind: "line", y: r.buyer.map((b) => b.p50), color: "--buy", label: "Ev alan" },
      { kind: "line", y: r.renter.map((b) => b.p50), color: "--rent", label: "Kirada kalan" },
    ],
  });

  if (single) {
    $("#hist-sub").textContent = "Kendi varsayımlarınla tek bir gelecek hesaplandı; dağılım için geçmiş verisini seç.";
    $("#c-hist").innerHTML = "";
  } else {
    $("#hist-sub").textContent = `${fmt(r.sims)} senaryoda ${p.years}. yılın sonundaki fark (ev alan − kiracı). Sağdaki mavi çubuklarda ev almak, soldaki turuncularda kirada kalmak kazanıyor.`;
    histogram($("#c-hist"), { aria: "Sonuç dağılımı", values: r.diffs, pos: "--buy", neg: "--rent" });
  }

  const f = r.first, diffM = f.owner - f.rent;
  $("#cash").innerHTML = `<table class="cash"><tbody>
    <tr><td>Kredi taksidi</td><td class="num">${TL(f.mortgage)}</td></tr>
    <tr><td>Bakım, vergi, sigorta</td><td class="num">${TL(f.owner - f.mortgage)}</td></tr>
    <tr><th>Ev sahibinin aylık gideri</th><th class="num">${TL(f.owner)}</th></tr>
    <tr><th>Kiracının aylık kirası</th><th class="num">${TL(f.rent)}</th></tr>
    <tr><td>${diffM >= 0 ? "Kiracının her ay yatırdığı fark" : "Ev sahibinin her ay yatırdığı fark"}</td><td class="num">${TL(Math.abs(diffM))}</td></tr>
    <tr><td>Kredi boyunca ödenecek toplam faiz</td><td class="num">${TL(r.interest)}</td></tr>
  </tbody></table>
  <p class="note" style="margin-top:8px">Kira her yıl yenilenir; kredi taksidi sabit kalır. Enflasyon yüksekken taksidin gerçek yükü her yıl azalır, kira ise artar.</p>`;

  // sensitivity is heavier: compute after the main result has painted
  clearTimeout(run._t);
  run._t = setTimeout(() => tornado(sensitivity(hist, p), p), 30);
}

function tornado(s, p) {
  const vals = s.rows.flatMap((r) => [r.low, r.high]).concat(s.base);
  const t = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals), 4);
  const host = $("#c-tornado");
  host.innerHTML = `<div class="tornado"></div>`;
  const box = host.firstChild;
  const W = Math.max(200, box.clientWidth - 220);
  const X = (v) => 30 + ((v - t.lo) / (t.hi - t.lo)) * (W - 60);
  for (const r of s.rows.sort((a, b) => Math.abs(b.high - b.low) - Math.abs(a.high - a.low))) {
    const row = document.createElement("div");
    row.className = "trow";
    row.innerHTML = `<span>${r.label}</span>`;
    const svg = el("svg", { viewBox: `0 0 ${W} 26`, role: "img", "aria-label": `${r.label}: ${short(r.low)} ile ${short(r.high)} TL arası` });
    const a = Math.min(r.low, r.high), b = Math.max(r.low, r.high);
    el("line", { x1: X(0), x2: X(0), y1: 0, y2: 26, style: "stroke:var(--axis)" }, svg);
    el("rect", { x: X(a), y: 6, width: Math.max(2, X(b) - X(a)), height: 14, rx: 4, style: `fill:var(${(a + b) / 2 >= 0 ? "--buy" : "--rent"});opacity:.85` }, svg);
    el("line", { x1: X(s.base), x2: X(s.base), y1: 3, y2: 23, style: "stroke:var(--ink)", "stroke-width": 2 }, svg);
    el("text", { x: X(a) - 4, y: 17, "text-anchor": "end" }, svg).textContent = short(a);
    el("text", { x: X(b) + 4, y: 17 }, svg).textContent = short(b);
    row.appendChild(svg);
    box.appendChild(row);
  }
  const note = document.createElement("p");
  note.className = "note";
  note.style.margin = "8px 0 0";
  note.textContent = `Siyah çizgi bugünkü varsayımlarla medyan fark (${signed(s.base)}). Mavi ev almayı, turuncu kirada kalmayı öne çıkarır.`;
  host.appendChild(note);
}

const signed = (v) => (v >= 0 ? "+" : "−") + short(Math.abs(v));
// Turkish locative suffix after a percentage: %80'inde, %60'ında, %95'inde …
function suffix(share) {
  const n = Math.round(share * 100) % 100;
  const last = n % 10, tens = Math.floor(n / 10);
  const word = n === 0 ? "yüz" : last ? ["", "bir", "iki", "üç", "dört", "beş", "altı", "yedi", "sekiz", "dokuz"][last] : ["", "on", "yirmi", "otuz", "kırk", "elli", "altmış", "yetmiş", "seksen", "doksan"][tens];
  const v = [...word].reverse().find((c) => "aeıioöuü".includes(c));
  const harmony = "aı".includes(v) ? "ında" : "ou".includes(v) ? "unda" : "öü".includes(v) ? "ünde" : "inde";
  return harmony;
}

export function setBudget(b) {
  budget = b;
  if (b.rent && !form.dataset.touchedRent) form.elements.rent.value = fmt(b.rent);
}

export function show() {
  if (!ready) return;
  run();
}

export function init(rows) {
  macroRows = rows;
  hist = rows ? history(rows) : null;
  if (rows) {
    const first = rows[0].month, last = rows[rows.length - 1].month;
    $("#data-src").textContent = `Veri: Eurostat uyumlaştırılmış TÜFE ve kira endeksi, BIS konut fiyat endeksi, OECD bankalararası faiz ve USD/TRY; FRED üzerinden, ${first} – ${last} (${rows.length} ay).`;
  }
  form.addEventListener("input", (e) => {
    if (e.target.name === "rent") form.dataset.touchedRent = "1";
    clearTimeout(timer);
    timer = setTimeout(run, 120);
  });
  form.addEventListener("submit", (e) => e.preventDefault());
  ready = true;
  labels();
}
