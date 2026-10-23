// The rent-or-buy screen: reads the form, runs the Monte Carlo, draws the answer.

import { animateGauges, el, fmt, gauge, histogram, lineChart, niceTicks, short, TL } from "./charts.js";
import { parseAmount } from "./parse.js";
import { history, sensitivity, simulate } from "./simulate.js";

const $ = (s) => document.querySelector(s);
const form = $("#sim-form");
let hist = null, budget = null, timer = null, ready = false;

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
  const v = (n) => +form.elements[n].value;
  const out = {
    downPct: `%${fmt(v("downPct") * 100)} · ${short(parseAmount(form.elements.price.value) * v("downPct"))} TL`,
    mortgageRate: `%${fmt(v("mortgageRate"), 2)} / ay`,
    buyCostPct: `%${fmt(v("buyCostPct") * 100, 1)}`,
    years: `${v("years")} yıl`,
    houseAdj: v("houseAdj") === 0 ? "geçmiş gibi" : `${v("houseAdj") > 0 ? "+" : "−"}${fmt(Math.abs(v("houseAdj")) * 100)} puan / yıl`,
  };
  form.querySelectorAll("output[data-for]").forEach((o) => (o.textContent = out[o.dataset.for] ?? ""));
  // filled part of each slider track
  form.querySelectorAll('input[type="range"]').forEach((r) => r.style.setProperty("--p", `${((r.value - r.min) / (r.max - r.min)) * 100}%`));
  $("#custom").hidden = form.elements.source.value !== "custom";
}

const signed = (v) => (v >= 0 ? "+" : "−") + short(Math.abs(v));
// compact money for the headline numbers: "8,0 mn", "450 bin"
const mn = (v) => (Math.abs(v) >= 1e6 ? fmt(v / 1e6, Math.abs(v) >= 1e7 ? 0 : 1) + " mn" : short(v));
const smn = (v) => (v >= 0 ? "+" : "−") + mn(Math.abs(v));

function run() {
  labels();
  if (!hist) return;
  const p = read();
  if (!(p.price > 0 && p.rent > 0 && p.mortgageRate >= 0)) { $("#verdict").innerHTML = `<p class="note">Ev fiyatı ve kira alanlarını kontrol et.</p>`; return; }
  const r = simulate(hist, p);
  const years = Array.from({ length: p.years }, (_, i) => i + 1);
  const single = r.sims === 1;
  const buy = r.buyWins >= 0.5;
  const diff = r.diff.p50;
  const share = buy ? r.buyWins : 1 - r.buyWins;

  const head = single
    ? `${p.years} yıl sonra <b>${diff >= 0 ? "ev alan" : "kirada kalan"}</b> ${TL(Math.abs(diff))} daha zengin.`
    : `${p.years} yıl sonra <b>${buy ? "ev almak" : "kirada kalmak"}</b>, senaryoların %${fmt(share * 100)}'${suffix(share)} daha kazançlı.`;
  const owner = r.first.owner;
  const room = budget && budget.rent ? budget.rent + Math.max(0, budget.monthlySavings) : null;
  $("#verdict").innerHTML = `
    <div>${single ? gauge(diff >= 0 ? 1 : 0, "tek senaryo") : gauge(share, buy ? "ev almak kazanır" : "kiracı kazanır")}</div>
    <div>
      <div class="headline">${head}</div>
      <div class="stats">
        ${single ? "" : `<div class="stat"><div class="label">Medyan fark, ${diff >= 0 ? "ev alan lehine" : "kiracı lehine"}</div><div class="value">${mn(Math.abs(diff))} TL</div></div>
        <div class="stat"><div class="label">%80 aralık (ev alan − kiracı)</div><div class="value">${smn(r.diff.p10)} … ${smn(r.diff.p90)}</div></div>`}
        <div class="stat"><div class="label">Ev almanın öne geçtiği yıl</div><div class="value">${r.breakevenYear ? `${single ? "" : "≈ "}${fmt(r.breakevenYear)}. yıl` : `${p.years} yılda değil`}</div></div>
        <div class="stat"><div class="label">Kredi taksidi</div><div class="value">${TL(r.payment)}</div></div>
        <div class="stat"><div class="label">Başta gereken nakit</div><div class="value">${TL(r.upfront)}</div></div>
      </div>
      ${room == null ? "" : owner > room
        ? `<div class="fit bad">İlk ay ev sahibinin gideri <b>${TL(owner)}</b>. Ekstrene göre bugünkü kiran ve birikimin toplamı <b>${TL(room)}</b>; ayda ${TL(owner - room)} açık var.</div>`
        : `<div class="fit ok">İlk ayın ${TL(owner)} gideri, ekstrene göre kira ve birikim toplamına (${TL(room)}) sığıyor.</div>`}
    </div>`;
  animateGauges($("#verdict"));

  lineChart($("#c-wealth"), {
    aria: "Ev alan ve kirada kalanın net serveti", x: years, xfmt: (y) => `${y}. yıl`, height: 320,
    series: [
      ...(single ? [] : [{ kind: "band", lo: r.renter.map((b) => b.p10), hi: r.renter.map((b) => b.p90), color: "--rent-band", label: "Kiracı %80" },
        { kind: "band", lo: r.buyer.map((b) => b.p10), hi: r.buyer.map((b) => b.p90), color: "--buy-band", label: "Ev alan %80" }]),
      { kind: "line", y: r.buyer.map((b) => b.p50), color: "--buy", label: "Ev alan" },
      { kind: "line", y: r.renter.map((b) => b.p50), color: "--rent", label: "Kirada kalan" },
    ],
  });

  if (single) {
    $("#hist-sub").textContent = "Kendi varsayımlarınla tek bir gelecek hesaplandı. Dağılım için geçmiş verisini seç.";
    $("#c-hist").innerHTML = "";
  } else {
    $("#hist-sub").textContent = `${fmt(r.sims)} senaryoda ${p.years}. yılın sonundaki fark (ev alan − kiracı). Mavi: ev almak kazanır, turuncu: kirada kalmak.`;
    histogram($("#c-hist"), { aria: "Sonuç dağılımı", values: r.diffs, pos: "--buy", neg: "--rent" });
  }

  const f = r.first, d = f.owner - f.rent;
  $("#cash").innerHTML = `<table class="cash"><tbody>
    <tr><td>Kredi taksidi</td><td class="r">${TL(f.mortgage)}</td></tr>
    <tr><td>Bakım, vergi, sigorta</td><td class="r">${TL(f.owner - f.mortgage)}</td></tr>
    <tr><th>Ev sahibinin gideri</th><th class="r">${TL(f.owner)}</th></tr>
    <tr><th>Kiracının kirası</th><th class="r">${TL(f.rent)}</th></tr>
    <tr><td>${d >= 0 ? "Kiracının yatırdığı fark" : "Ev sahibinin yatırdığı fark"}</td><td class="r">${TL(Math.abs(d))}</td></tr>
    <tr><td>Kredi boyunca toplam faiz</td><td class="r">${TL(r.interest)}</td></tr></tbody></table>
    <p class="note" style="margin:10px 0 0">Kira yılda bir yenilenir, taksit sabit kalır. Enflasyon yüksekken taksidin gerçek yükü her yıl azalır.</p>`;

  clearTimeout(run._t);
  run._t = setTimeout(() => tornado(sensitivity(hist, p)), 40);
}

function tornado(s) {
  const vals = s.rows.flatMap((r) => [r.low, r.high]).concat(s.base);
  const t = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals), 4);
  const host = $("#c-tornado");
  host.innerHTML = `<div class="tornado"></div>`;
  const box = host.firstChild;
  const W = Math.max(200, box.clientWidth - 240);
  const X = (v) => 34 + ((v - t.lo) / (t.hi - t.lo)) * (W - 68);
  for (const r of s.rows.sort((a, b) => Math.abs(b.high - b.low) - Math.abs(a.high - a.low))) {
    const row = document.createElement("div");
    row.className = "trow";
    row.innerHTML = `<span>${r.label}</span>`;
    const svg = el("svg", { viewBox: `0 0 ${W} 28`, role: "img", "aria-label": `${r.label}: ${short(r.low)} ile ${short(r.high)} TL arası` });
    const a = Math.min(r.low, r.high), b = Math.max(r.low, r.high);
    el("line", { x1: X(0), x2: X(0), y1: 0, y2: 28, style: "stroke:var(--axis)" }, svg);
    el("rect", { x: X(a), y: 8, width: Math.max(3, X(b) - X(a)), height: 12, rx: 6, style: `fill:var(${(a + b) / 2 >= 0 ? "--buy" : "--rent"});opacity:.9` }, svg);
    el("line", { x1: X(s.base), x2: X(s.base), y1: 4, y2: 24, style: "stroke:var(--ink)", "stroke-width": 2, "stroke-linecap": "round" }, svg);
    el("text", { x: X(a) - 5, y: 18, "text-anchor": "end" }, svg).textContent = short(a);
    el("text", { x: X(b) + 5, y: 18 }, svg).textContent = short(b);
    row.appendChild(svg);
    box.appendChild(row);
  }
  host.insertAdjacentHTML("beforeend", `<p class="note" style="margin:10px 0 0">Beyaz çizgi bugünkü varsayımlarla medyan fark (${signed(s.base)} TL). Mavi ev almayı, turuncu kirada kalmayı öne çıkarır.</p>`);
}

// Turkish locative after a percentage: %80'inde, %60'ında, %99'unda, %100'ünde
function suffix(share) {
  const n = Math.round(share * 100);
  if (n === 100) return "ünde";
  const last = n % 10, tens = Math.floor(n / 10);
  const word = last ? ["", "bir", "iki", "üç", "dört", "beş", "altı", "yedi", "sekiz", "dokuz"][last] : ["", "on", "yirmi", "otuz", "kırk", "elli", "altmış", "yetmiş", "seksen", "doksan"][tens];
  const v = [...word].reverse().find((c) => "aeıioöuü".includes(c));
  return "aı".includes(v) ? "ında" : "ou".includes(v) ? "unda" : "öü".includes(v) ? "ünde" : "inde";
}

export function setBudget(b) {
  budget = b;
  if (b.rent && !form.dataset.touchedRent) form.elements.rent.value = fmt(b.rent);
}

export function show() {
  if (ready) run();
}

export function init(rows) {
  hist = rows ? history(rows) : null;
  if (rows) {
    $("#data-src").textContent = `Veri: Eurostat uyumlaştırılmış TÜFE ve kira endeksi, BIS konut fiyat endeksi, OECD bankalararası faiz ve USD/TRY (FRED), ${rows[0].month} – ${rows[rows.length - 1].month}, ${rows.length} ay.`;
  }
  form.addEventListener("input", (e) => {
    if (e.target.name === "rent") form.dataset.touchedRent = "1";
    labels();
    clearTimeout(timer);
    timer = setTimeout(run, 90);
  });
  form.addEventListener("submit", (e) => e.preventDefault());
  ready = true;
  labels();
}

