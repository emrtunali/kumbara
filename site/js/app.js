// Page wiring: tabs, theme, statement upload and the spending screen.
// Statements never leave the browser: files are read with FileReader, parsed here, and only the
// user's category corrections are kept (in localStorage).

import { categoryTotals, cpiIndex, leaks, monthly, subscriptions, summary, toReal, topMerchants, unusual } from "./analysis.js";
import { byId, CATEGORIES, categorizeAll, OTHER } from "./categorize.js";
import { fmt, redrawAll, stackedBars, TL } from "./charts.js";
import { detectColumns, fromTextLines, merge, parseCSV, toTransactions } from "./parse.js";
import * as sim from "./sim.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const ymLabel = (m) => new Date(m + "-15").toLocaleDateString("tr-TR", { month: "short", year: "2-digit" });
const ymLong = (m) => new Date(m + "-15").toLocaleDateString("tr-TR", { month: "long", year: "numeric" });

let macro = null;
const files = []; // {name, rows?, det?, sign, txs}
let txs = [];
let overrides = store.get("kumbara-overrides", {});
let real = false, catFilter = "", query = "";

// ------------------------------------------------------------------ tabs and theme
function showTab() {
  const id = location.hash === "#kirala-al" ? "kirala-al" : "harcamalar";
  document.querySelectorAll(".tab").forEach((t) => (t.hidden = t.id !== id));
  document.querySelectorAll("nav [data-tab]").forEach((a) => a.setAttribute("aria-selected", a.dataset.tab === id));
  if (id === "kirala-al") sim.show();
  requestAnimationFrame(redrawAll);
}
addEventListener("hashchange", showTab);

(function theme() {
  const root = document.documentElement;
  const t = store.get("kumbara-theme", null);
  if (t) root.dataset.theme = t;
  $("#theme").addEventListener("click", () => {
    const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
    store.set("kumbara-theme", root.dataset.theme);
  });
})();

// ------------------------------------------------------------------ libraries, loaded only when needed
const CDN = "https://cdnjs.cloudflare.com/ajax/libs";
const loaded = {};
function script(src) {
  return (loaded[src] ??= new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = src; s.onload = ok; s.onerror = () => fail(new Error("Kütüphane yüklenemedi: " + src));
    document.head.appendChild(s);
  }));
}
async function xlsxRows(buf) {
  await script(`${CDN}/xlsx/0.18.5/xlsx.full.min.js`);
  const wb = window.XLSX.read(buf, { type: "array", cellDates: true });
  // the sheet with the most rows is the statement
  const sheets = wb.SheetNames.map((n) => window.XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: "" }));
  return sheets.sort((a, b) => b.length - a.length)[0];
}
async function pdfLines(buf) {
  await script(`${CDN}/pdf.js/3.11.174/pdf.min.js`);
  const lib = window.pdfjsLib;
  if (!lib.GlobalWorkerOptions.workerSrc) {
    // workers must be same-origin: wrap the CDN worker in a blob URL
    const code = await (await fetch(`${CDN}/pdf.js/3.11.174/pdf.worker.min.js`)).text();
    lib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
  }
  const doc = await lib.getDocument({ data: buf }).promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const items = (await (await doc.getPage(p)).getTextContent()).items;
    // group text pieces into lines by their vertical position, then read left to right
    const rows = new Map();
    for (const it of items) {
      const y = Math.round(it.transform[5] / 2) * 2;
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push(it);
    }
    [...rows.entries()].sort((a, b) => b[0] - a[0]).forEach(([, its]) => {
      lines.push(its.sort((a, b) => a.transform[4] - b.transform[4]).map((i) => i.str).join(" "));
    });
  }
  return lines;
}
function decode(buf) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch { return new TextDecoder("windows-1254").decode(buf); }
}

// ------------------------------------------------------------------ reading files
async function addFile(name, buf) {
  const ext = name.toLowerCase().split(".").pop();
  if (ext === "pdf") {
    const t = fromTextLines(await pdfLines(buf));
    files.push({ name, sign: "auto", txs: t, pdf: true });
  } else {
    const rows = ext === "xlsx" || ext === "xls" ? await xlsxRows(buf) : parseCSV(decode(buf));
    const det = detectColumns(rows);
    files.push({ name, rows, det, sign: "auto", txs: toTransactions(rows, det, "auto") });
  }
}

async function handle(list) {
  const status = $("#file-status");
  status.textContent = "Okunuyor…";
  try {
    for (const f of list) await addFile(f.name, await f.arrayBuffer());
    refresh();
    const last = files[files.length - 1];
    status.textContent = `${files.length} dosya · ${fmt(txs.length)} işlem` + (last.txs.length ? "" : ` · "${last.name}" içinde işlem bulunamadı; sütunları kontrol et`);
  } catch (e) {
    status.textContent = "Dosya okunamadı: " + e.message;
    console.error(e);
  }
}

const drop = $("#drop"), input = $("#file");
drop.addEventListener("click", () => input.click());
drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
input.addEventListener("change", () => { handle([...input.files]); input.value = ""; });
["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => handle([...e.dataTransfer.files]));
$("#demo").addEventListener("click", async () => {
  files.length = 0;
  const buf = await (await fetch("demo/ornek-hesap-hareketleri.csv")).arrayBuffer();
  await addFile("ornek-hesap-hareketleri.csv", buf);
  refresh();
  $("#file-status").textContent = `Örnek: bir yıllık uydurma hesap hareketleri · ${fmt(txs.length)} işlem`;
});

// ------------------------------------------------------------------ column mapping for the latest table
function mappingUI() {
  const f = [...files].reverse().find((x) => x.rows);
  const box = $("#mapping");
  if (!f) { box.hidden = true; return; }
  box.hidden = false;
  const header = f.det.headerRow >= 0 ? f.rows[f.det.headerRow] : f.rows[0].map((_, j) => `Sütun ${j + 1}`);
  const opts = (sel) => `<option value="-1">—</option>` + header.map((h, j) => `<option value="${j}" ${j === sel ? "selected" : ""}>${esc(h || `Sütun ${j + 1}`)}</option>`).join("");
  const fields = [["date", "Tarih"], ["desc", "Açıklama"], ["amount", "Tutar"], ["debit", "Borç (ayrı sütunsa)"], ["credit", "Alacak (ayrı sütunsa)"]];
  $("#mapping-controls").innerHTML = fields.map(([k, l]) => `<label>${l}<select data-k="${k}">${opts(f.det.mapping[k])}</select></label>`).join("") +
    `<label>Harcamalar nasıl görünüyor?<select data-k="sign">
      <option value="auto" ${f.sign === "auto" ? "selected" : ""}>Otomatik bul</option>
      <option value="negative" ${f.sign === "negative" ? "selected" : ""}>Eksi (hesap hareketi)</option>
      <option value="positive" ${f.sign === "positive" ? "selected" : ""}>Artı (kredi kartı ekstresi)</option></select></label>`;
  $("#mapping-note").textContent = `· ${f.name}: ${f.txs.length} işlem okundu`;
  $("#mapping-controls").querySelectorAll("select").forEach((s) => s.addEventListener("change", () => {
    if (s.dataset.k === "sign") f.sign = s.value; else f.det.mapping[s.dataset.k] = Number(s.value);
    f.txs = toTransactions(f.rows, f.det, f.sign);
    refresh();
  }));
}

// ------------------------------------------------------------------ the analysis
function colorsFor(cats) {
  const map = {};
  cats.forEach((c, i) => (map[c.id] = i < 7 ? `--c${i + 1}` : "--muted"));
  return map;
}

function refresh() {
  txs = categorizeAll(merge(files.map((f) => f.txs)), overrides);
  mappingUI();
  $("#results").hidden = !txs.length;
  if (txs.length) render();
}

function render() {
  const cpi = macro ? cpiIndex(macro) : null;
  const s = summary(txs, cpi);
  const cats = categoryTotals(txs);
  const colors = colorsFor(cats);
  const subs = subscriptions(txs);
  const lk = leaks(txs);

  // headline numbers
  const subsYear = subs.filter((x) => x.kind === "subscription").reduce((a, x) => a + x.yearly, 0);
  const kpi = (l, v, h = "") => `<div class="kpi"><div class="label">${l}</div><div class="value">${v}</div>${h ? `<div class="hint">${h}</div>` : ""}</div>`;
  $("#kpis").innerHTML = [
    kpi("Aylık ortalama harcama", TL(s.perMonth), `${s.months} ay · ${ymLong(s.from)} – ${ymLong(s.to)}`),
    s.income > 0 ? kpi("Aylık ortalama gelir", TL(s.perMonthIncome)) : "",
    s.savingsRate != null ? kpi("Tasarruf oranı", `%${fmt(s.savingsRate * 100)}`, `ayda ${TL(s.monthlySavings)}`) : "",
    cats[0] ? kpi("En büyük kalem", cats[0].name, `%${fmt(cats[0].share * 100)} · ${TL(cats[0].amount / s.months)}/ay`) : "",
    kpi("Abonelik ve üyelikler, yıllık", TL(subsYear), `${subs.filter((x) => x.kind === "subscription").length} düzenli ödeme`),
    s.realTrend != null ? kpi("Gerçek harcama değişimi", `${s.realTrend >= 0 ? "+" : "−"}%${fmt(Math.abs(s.realTrend) * 100)}`, "ilk 3 aya göre son 3 ay, enflasyondan arındırılmış") : "",
  ].join("");

  // plain-language findings
  const ins = [];
  const rises = subs.filter((x) => x.kind === "subscription" && x.rise > 0.05).sort((a, b) => b.rise - a.rise);
  if (subsYear > 0) ins.push(["", `Dijital abonelik ve üyeliklere <b>yılda yaklaşık ${TL(subsYear)}</b> ödüyorsun.` + (rises.length ? ` ${rises.slice(0, 3).map((x) => `<b>${esc(x.name)}</b> %${fmt(x.rise * 100)}`).join(", ")} zamlandı.` : "")]);
  for (const l of lk.slice(0, 2)) ins.push(["warn", `<b>${esc(cap(l.merchant))}</b>: ayda ortalama ${fmt(l.count / s.months, 1)} kez, ${TL(l.perMonth)}. Bu tempoda <b>yılda ${TL(l.yearly)}</b>.`]);
  if (s.realTrend != null) ins.push([s.realTrend > 0.05 ? "warn" : "", `Enflasyonu çıkarınca son üç aydaki harcaman ilk üç aya göre <b>%${fmt(Math.abs(s.realTrend) * 100)} ${s.realTrend >= 0 ? "daha fazla" : "daha az"}</b>.` + (macro && s.to > macro[macro.length - 1].month ? ` (${ymLong(macro[macro.length - 1].month)} sonrası için son açıklanan enflasyon kullanıldı.)` : "")]);
  const other = txs.filter((t) => t.cat === OTHER.id && t.amount > 0);
  const otherShare = other.reduce((a, t) => a + t.amount, 0) / Math.max(1, s.spend);
  if (otherShare > 0.1) ins.push(["warn", `Harcamaların %${fmt(otherShare * 100)}'i "Diğer" olarak kaldı. Aşağıdaki işlem listesinden düzeltirsen analiz netleşir.`]);
  $("#insights").innerHTML = ins.map(([c, h]) => `<div class="insight ${c}">${h}</div>`).join("");

  // categories as bars, clickable
  const max = cats[0]?.amount || 1;
  $("#c-cats").innerHTML = `<div class="cats">` + cats.map((c) => `
    <button type="button" class="catrow ${catFilter === c.id ? "on" : ""}" data-cat="${c.id}" aria-pressed="${catFilter === c.id}">
      <span class="name"><i class="sw" style="background:var(${colors[c.id]})"></i>${c.name}</span>
      <span class="track"><span class="fill" style="display:block;width:${(c.amount / max) * 100}%;background:var(${colors[c.id]})"></span></span>
      <span class="val">${TL(c.amount)}<small>%${fmt(c.share * 100)}</small></span>
    </button>`).join("") + `</div>`;
  $("#c-cats").querySelectorAll(".catrow").forEach((b) => b.addEventListener("click", () => {
    catFilter = catFilter === b.dataset.cat ? "" : b.dataset.cat;
    $("#cat-filter").value = catFilter;
    render();
    $("#txs").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }));

  // monthly stacked bars, nominal or in today's lira
  const m = monthly(txs);
  const top = cats.slice(0, 7).map((c) => c.id);
  const last = m.months[m.months.length - 1];
  const conv = (series) => (real && cpi ? toReal(series, cpi, last) : series);
  const groups = top.map((id) => ({ label: byId[id].name, color: colors[id], values: m.months.map((k) => conv(m.byCat[id] || {})[k] || 0) }));
  const restIds = Object.keys(m.byCat).filter((id) => !top.includes(id));
  if (restIds.length) groups.push({ label: "Diğer kalemler", color: "--muted", values: m.months.map((k) => restIds.reduce((a, id) => a + (conv(m.byCat[id])[k] || 0), 0)) });
  $("#monthly-sub").textContent = real ? `${ymLong(last)} fiyatlarıyla: enflasyon çıkarılınca gerçekte daha mı çok harcıyorsun?` : "Ekstredeki tutarlar.";
  stackedBars($("#c-monthly"), { aria: "Aylık harcama", labels: m.months.map(ymLabel), tipLabels: m.months.map(ymLong), groups });

  // subscriptions
  $("#subs").innerHTML = subs.length ? `<table><thead><tr><th>Ödeme</th><th>Kategori</th><th class="num">Son tutar</th><th class="num">Yıllık</th><th>Değişim</th></tr></thead><tbody>` +
    subs.map((x) => `<tr><td>${esc(x.name)}</td><td>${byId[x.cat]?.name ?? ""}</td><td class="num">${TL(x.last)}</td><td class="num">${TL(x.yearly)}</td>
      <td>${x.kind === "bill" ? `<span class="badge">fatura, tutar değişken</span>` : x.rise > 0.05 ? `<span class="badge up">▲ %${fmt(x.rise * 100)} zam</span>` : `<span class="badge">sabit</span>`}</td></tr>`).join("") +
    `</tbody></table>` : `<p class="note">Düzenli ödeme bulunamadı (en az üç ay gerekiyor).</p>`;

  $("#merchants").innerHTML = `<table><thead><tr><th>Yer</th><th class="num">İşlem</th><th class="num">Toplam</th></tr></thead><tbody>` +
    topMerchants(txs).map((x) => `<tr><td>${esc(cap(x.merchant))} <span class="badge">${byId[x.cat]?.name ?? ""}</span></td><td class="num">${x.count}</td><td class="num">${TL(x.amount)}</td></tr>`).join("") + `</tbody></table>`;
  const un = unusual(txs);
  $("#unusual").innerHTML = un.length ? `<table><thead><tr><th>Tarih</th><th>Açıklama</th><th class="num">Tutar</th></tr></thead><tbody>` +
    un.map((t) => `<tr><td>${dmy(t.date)}</td><td>${esc(t.desc)}</td><td class="num">${TL(t.amount)}</td></tr>`).join("") + `</tbody></table>` : `<p class="note">Olağan dışı bir harcama yok.</p>`;

  txTable();

  // hand-off to the simulator
  const rent = txs.filter((t) => t.cat === "housing" && t.amount > 0 && /kira/i.test(t.desc));
  const rentNow = rent.length ? rent[rent.length - 1].amount : null;
  sim.setBudget({ monthlySavings: s.monthlySavings, rent: rentNow });
  $("#cta-sub").textContent = rentNow
    ? `Ekstrene göre ayda ${TL(rentNow)} kira ödüyor ve ortalama ${TL(Math.max(0, s.monthlySavings))} biriktiriyorsun. Simülatör bu rakamlarla açılır ve kredi taksidinin bütçene sığıp sığmadığını da gösterir.`
    : `Ortalama aylık birikimin ${TL(s.monthlySavings)}. Simülatör kredi taksidinin buna sığıp sığmadığını da gösterir.`;
}

function txTable() {
  const sel = $("#cat-filter");
  const opts = [...CATEGORIES, OTHER];
  sel.innerHTML = `<option value="">Tüm kategoriler</option>` + opts.map((c) => `<option value="${c.id}" ${c.id === catFilter ? "selected" : ""}>${c.name}</option>`).join("");
  const qf = query.toLocaleLowerCase("tr");
  const list = txs.filter((t) => (!catFilter || t.cat === catFilter) && (!qf || t.desc.toLocaleLowerCase("tr").includes(qf))).slice().reverse();
  const shown = list.slice(0, 400);
  $("#txs").innerHTML = `<table><thead><tr><th>Tarih</th><th>Açıklama</th><th>Kategori</th><th class="num">Tutar</th></tr></thead><tbody>` +
    shown.map((t, i) => `<tr><td>${dmy(t.date)}</td><td>${esc(t.desc)}</td><td><select data-m="${esc(t.merchant)}" aria-label="Kategori">${opts.map((c) => `<option value="${c.id}" ${c.id === t.cat ? "selected" : ""}>${c.name}</option>`).join("")}</select></td>
      <td class="num ${t.amount < 0 ? "in" : ""}">${t.amount < 0 ? "+" : ""}${TL(Math.abs(t.amount))}</td></tr>`).join("") +
    `</tbody></table>` + (list.length > shown.length ? `<p class="note">İlk ${shown.length} işlem gösteriliyor (${list.length} eşleşme). Aramayla daralt.</p>` : "");
  $("#txs").querySelectorAll("select").forEach((s) => s.addEventListener("change", () => {
    overrides[s.dataset.m] = s.value;
    store.set("kumbara-overrides", overrides);
    refresh();
  }));
}

$("#q").addEventListener("input", (e) => { query = e.target.value; txTable(); });
$("#cat-filter").addEventListener("change", (e) => { catFilter = e.target.value; render(); });
document.querySelectorAll("[data-real]").forEach((b) => b.addEventListener("click", () => {
  real = b.dataset.real === "1";
  document.querySelectorAll("[data-real]").forEach((x) => x.classList.toggle("on", x === b));
  render();
}));

const cap = (s) => s.split(" ").map((w) => w.charAt(0).toLocaleUpperCase("tr") + w.slice(1)).join(" ");
const dmy = (d) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;

// ------------------------------------------------------------------ start
(async function start() {
  try {
    macro = (await (await fetch("data/macro.json")).json()).rows;
  } catch (e) {
    console.error("macro data", e);
  }
  sim.init(macro);
  showTab();
  // ?ornek opens the page with the demo statement loaded (for links and screenshots)
  if (new URLSearchParams(location.search).has("ornek")) $("#demo").click();
})();
