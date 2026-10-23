// Page wiring: navigation, theme, statement upload and the spending story.
// Statements never leave the browser. Files are read here, the category model is trained here,
// and only the user's own category answers are remembered (localStorage).

import { categoryTotals, cpiIndex, leaks, monthly, subscriptions, summary, toReal } from "./analysis.js";
import { byId, CATEGORIES, OTHER } from "./categorize.js";
import { countUp, fmt, rangeSVG, redrawAll, ring, sankey, short, sparkline, stackedBars, TL } from "./charts.js";
import { forecast, lastMonthPartial, monthEnd, personalInflation, recentMonthlyInflation } from "./insight.js";
import { classify, reviewQueue, train } from "./learn.js";
import { detectColumns, fromTextLines, merge, parseCSV, toTransactions } from "./parse.js";
import * as sim from "./sim.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const ym = (m, opt = { month: "short", year: "2-digit" }) => new Date(m + "-15").toLocaleDateString("tr-TR", opt);
const ymLong = (m) => ym(m, { month: "long", year: "numeric" });
const pct = (v, d = 0) => `%${fmt(Math.abs(v) * 100, d)}`;
const cap = (s) => s.split(" ").map((w) => w.charAt(0).toLocaleUpperCase("tr") + w.slice(1)).join(" ");
const dmy = (d) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
const ICON = {
  spark: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/></svg>',
  alert: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 8v5M12 16.5v.5"/><circle cx="12" cy="12" r="9"/></svg>',
  trend: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 17 6-6 4 4 8-8M15 7h6v6"/></svg>',
};

let macro = null, hicp = null, cpi = null;
const files = []; // {name, rows?, det?, sign, txs}
let txs = [];
let overrides = store.get("kumbara-overrides", {});
const skipped = new Set();
let real = false, catFilter = "", query = "", queue = [];

// ------------------------------------------------------------------ navigation and theme
function showTab() {
  const id = location.hash === "#kirala-al" ? "kirala-al" : "harcamalar";
  document.querySelectorAll(".tab").forEach((t) => (t.hidden = t.id !== id));
  document.querySelectorAll(".pill a").forEach((a) => a.setAttribute("aria-selected", a.dataset.tab === id));
  moveThumb();
  if (id === "kirala-al") sim.show();
  requestAnimationFrame(() => { redrawAll(); reveal(); });
}
function moveThumb() {
  const a = $(".pill a[aria-selected='true']"), t = $(".pill .thumb");
  if (!a || !t) return;
  t.style.left = a.offsetLeft + "px";
  t.style.width = a.offsetWidth + "px";
}
addEventListener("hashchange", showTab);
addEventListener("resize", moveThumb);
// the pill's highlight needs final text widths
document.fonts?.ready.then(moveThumb);
addEventListener("load", moveThumb);

(function theme() {
  const root = document.documentElement;
  const t = store.get("kumbara-theme", null);
  if (t) root.dataset.theme = t;
  $("#theme").addEventListener("click", () => {
    root.dataset.theme = root.dataset.theme === "light" ? "dark" : "light";
    store.set("kumbara-theme", root.dataset.theme);
  });
})();

// sections ease in as they scroll into view; anything already on screen shows at once
function reveal() {
  const limit = innerHeight * 0.94;
  document.querySelectorAll(".reveal:not(.in)").forEach((n) => {
    const r = n.getBoundingClientRect();
    if (r.height && r.top < limit) n.classList.add("in");
  });
}
let lastCheck = 0;
addEventListener("scroll", () => { const t = performance.now(); if (t - lastCheck > 80) { lastCheck = t; reveal(); } setTimeout(reveal, 120); }, { passive: true });
addEventListener("resize", reveal);

// ⌘K / Ctrl+K jumps to the transaction search
addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k" && txs.length) {
    e.preventDefault();
    location.hash = "#harcamalar";
    $("#q").focus();
    $("#q").scrollIntoView({ behavior: "smooth", block: "center" });
  }
});

// ------------------------------------------------------------------ libraries, loaded only when needed
const CDN = "https://cdnjs.cloudflare.com/ajax/libs";
const loaded = {};
function script(src) {
  return (loaded[src] ??= new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = src; s.onload = ok; s.onerror = () => fail(new Error("Kütüphane yüklenemedi"));
    document.head.appendChild(s);
  }));
}
async function xlsxRows(buf) {
  await script(`${CDN}/xlsx/0.18.5/xlsx.full.min.js`);
  const wb = window.XLSX.read(buf, { type: "array", cellDates: true });
  const sheets = wb.SheetNames.map((n) => window.XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: "" }));
  return sheets.sort((a, b) => b.length - a.length)[0];
}
async function pdfLines(buf) {
  await script(`${CDN}/pdf.js/3.11.174/pdf.min.js`);
  const lib = window.pdfjsLib;
  if (!lib.GlobalWorkerOptions.workerSrc) {
    // workers must be same-origin, so the CDN worker runs from a blob URL
    const code = await (await fetch(`${CDN}/pdf.js/3.11.174/pdf.worker.min.js`)).text();
    lib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
  }
  const doc = await lib.getDocument({ data: buf }).promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const items = (await (await doc.getPage(p)).getTextContent()).items;
    const rows = new Map();
    for (const it of items) {
      const y = Math.round(it.transform[5] / 2) * 2;
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push(it);
    }
    [...rows.entries()].sort((a, b) => b[0] - a[0]).forEach(([, its]) => lines.push(its.sort((a, b) => a.transform[4] - b.transform[4]).map((i) => i.str).join(" ")));
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
    files.push({ name, sign: "auto", txs: fromTextLines(await pdfLines(buf)) });
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
    refresh(true);
    const last = files[files.length - 1];
    status.textContent = `${files.length} dosya · ${fmt(txs.length)} işlem` + (last.txs.length ? "" : ` · "${last.name}" içinde işlem bulunamadı, sütunları kontrol et`);
  } catch (e) {
    status.textContent = "Dosya okunamadı: " + e.message;
    console.error(e);
  }
}

const drop = $("#drop"), input = $("#file");
drop.addEventListener("click", (e) => { if (!e.target.closest("#demo")) input.click(); });
drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
input.addEventListener("change", () => { handle([...input.files]); input.value = ""; });
["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => handle([...e.dataTransfer.files]));
$("#demo").addEventListener("click", async (e) => {
  e.stopPropagation();
  files.length = 0;
  await addFile("ornek-hesap-hareketleri.csv", await (await fetch("demo/ornek-hesap-hareketleri.csv")).arrayBuffer());
  refresh(true);
  $("#file-status").textContent = `Örnek veri · bir yıllık uydurma hesap hareketleri · ${fmt(txs.length)} işlem`;
});

function mappingUI() {
  const f = [...files].reverse().find((x) => x.rows);
  const box = $("#mapping");
  if (!f) { box.hidden = true; return; }
  box.hidden = false;
  const header = f.det.headerRow >= 0 ? f.rows[f.det.headerRow] : f.rows[0].map((_, j) => `Sütun ${j + 1}`);
  const opts = (sel) => `<option value="-1">—</option>` + header.map((h, j) => `<option value="${j}" ${j === sel ? "selected" : ""}>${esc(h || `Sütun ${j + 1}`)}</option>`).join("");
  const fields = [["date", "Tarih"], ["desc", "Açıklama"], ["amount", "Tutar"], ["debit", "Borç (ayrıysa)"], ["credit", "Alacak (ayrıysa)"]];
  $("#mapping-controls").innerHTML = fields.map(([k, l]) => `<label class="f">${l}<select data-k="${k}">${opts(f.det.mapping[k])}</select></label>`).join("") +
    `<label class="f">Harcamalar<select data-k="sign"><option value="auto" ${f.sign === "auto" ? "selected" : ""}>Otomatik</option><option value="negative" ${f.sign === "negative" ? "selected" : ""}>Eksi (hesap)</option><option value="positive" ${f.sign === "positive" ? "selected" : ""}>Artı (kart)</option></select></label>`;
  $("#mapping-note").textContent = `${f.name} · ${f.txs.length} işlem`;
  $("#mapping-controls").querySelectorAll("select").forEach((s) => s.addEventListener("change", () => {
    if (s.dataset.k === "sign") f.sign = s.value; else f.det.mapping[s.dataset.k] = Number(s.value);
    f.txs = toTransactions(f.rows, f.det, f.sign);
    refresh();
  }));
}

// ------------------------------------------------------------------ analysis
function refresh(scroll = false) {
  const merged = merge(files.map((f) => f.txs));
  txs = classify(merged, overrides, train(merged, overrides));
  mappingUI();
  $("#results").hidden = !txs.length;
  $("#harcamalar").classList.toggle("has-data", txs.length > 0);
  if (!txs.length) return;
  render();
  reveal();
  if (scroll) $("#results").scrollIntoView({ behavior: "smooth", block: "start" });
}

function colorsFor(cats) {
  const map = {};
  cats.forEach((c, i) => (map[c.id] = i < 8 ? `--c${i + 1}` : "--muted"));
  return map;
}

function render() {
  const s = summary(txs, cpi);
  const cats = categoryTotals(txs);
  const colors = colorsFor(cats);
  const subs = subscriptions(txs);
  const m = monthly(txs);
  const partial = lastMonthPartial(txs);
  const pi = hicp ? personalInflation(txs, hicp) : null;

  // ---- summary
  $("#period").textContent = `${ymLong(s.from)} – ${ymLong(s.to)} · ${s.months} ay`;
  countUp($("#avg"), s.perMonth, (v) => fmt(v));
  const chips = [];
  if (s.realTrend != null) chips.push(`<span class="chip ${s.realTrend > 0.02 ? "up" : s.realTrend < -0.02 ? "down" : ""}">Gerçek değişim <b>${s.realTrend >= 0 ? "+" : "−"}${pct(s.realTrend)}</b></span>`);
  if (cats[0]) chips.push(`<span class="chip">En büyük kalem <b>${cats[0].name}</b></span>`);
  chips.push(`<span class="chip"><b>${fmt(txs.length)}</b> işlem</span>`);
  $("#chips").innerHTML = chips.join("");
  const series = (o) => m.months.map((k) => o[k] || 0);
  const savings = m.months.map((k) => (m.income[k] || 0) - (m.total[k] || 0));
  const subsYear = subs.filter((x) => x.kind === "subscription").reduce((a, x) => a + x.yearly, 0);
  const tile = (label, value, hint, spark = "") => `<div class="tile"><div class="label">${label}</div><div class="value">${value}</div><div class="hint">${hint}</div>${spark}</div>`;
  $("#tiles").innerHTML = [
    s.income > 0 ? tile("Aylık gelir", short(s.perMonthIncome) + " TL", "ortalama", sparkline(series(m.income), "--mint")) : "",
    s.savingsRate != null ? tile("Tasarruf oranı", pct(s.savingsRate), `ayda ${short(s.monthlySavings)} TL`, sparkline(savings, "--blue")) : "",
    pi ? tile("Kişisel enflasyon", pct(pi.personal, 1), `resmî ${pct(pi.official, 1)} · ${ymLong(pi.month)}`, "") : "",
    tile("Abonelik ve üyelik", short(subsYear) + " TL", "yıllık", sparkline(series(m.byCat.subs || {}), "--violet")),
  ].join("");

  // ---- findings in plain words
  const ins = [];
  const rises = subs.filter((x) => x.kind === "subscription" && x.rise > 0.05).sort((a, b) => b.rise - a.rise);
  if (rises.length) ins.push(["warn", ICON.trend, `${rises.slice(0, 3).map((x) => `<b>${esc(x.name)}</b> ${pct(x.rise)}`).join(", ")} zamlandı. Abonelik ve üyeliklerin yılda <b>${TL(subsYear)}</b>.`]);
  for (const l of leaks(txs).slice(0, 2)) ins.push(["warn", ICON.alert, `<b>${esc(cap(l.merchant))}</b> ayda ${fmt(l.count / s.months, 1)} kez, ${TL(l.perMonth)}. Bu tempoda yılda <b>${TL(l.yearly)}</b>.`]);
  if (pi && Math.abs(pi.gap) > 0.005) ins.push(["", ICON.spark, `Senin sepetinin yıllık enflasyonu <b>${pct(pi.personal, 1)}</b>, resmî rakamın ${pct(pi.gap, 1)} ${pi.gap > 0 ? "üstünde" : "altında"}. En çok <b>${byId[pi.rows[0].cat]?.name.toLocaleLowerCase("tr")}</b> etkiliyor.`]);
  const q = reviewQueue(txs, skipped);
  if (q.length) ins.push(["", ICON.spark, `Model <b>${q.length}</b> yeri tam tanıyamadı. Aşağıda birkaç soruya cevap verirsen kategoriler netleşir.`]);
  $("#insights").innerHTML = ins.map(([c, ic, h]) => `<div class="insight ${c}"><span class="ic">${ic}</span><span>${h}</span></div>`).join("");

  // ---- money flow, per month on average
  const n = s.months || 1;
  const top = cats.slice(0, 8);
  const rest = cats.slice(8).reduce((a, c) => a + c.amount, 0);
  const targets = top.map((c) => ({ label: c.name, value: c.amount / n, color: colors[c.id] }));
  if (rest > 0) targets.push({ label: "Diğer kalemler", value: rest / n, color: "--muted" });
  const saved = s.perMonthIncome - s.perMonth;
  if (s.income > 0 && saved > 0) targets.push({ label: "Birikim", value: saved, color: "--mint" });
  $("#flow-note").textContent = s.income > 0 ? `Aylık ortalama · gelir ${TL(s.perMonthIncome)}` : "Aylık ortalama harcama (ekstrede gelir yok)";
  sankey($("#c-flow"), { aria: "Gelirin kategorilere dağılımı", source: { label: s.income > 0 ? "Gelir" : "Harcama", value: s.income > 0 ? Math.max(s.perMonthIncome, s.perMonth) : s.perMonth }, targets });

  // ---- ring and list
  const items = cats.map((c) => ({ id: c.id, label: c.name, value: c.amount, color: colors[c.id] }));
  ring($("#c-ring"), { aria: "Kategori payları", items, total: s.spend, caption: "dönem toplamı", onClick: (x) => filterCat(x.id) });
  $("#catlist").innerHTML = cats.slice(0, 10).map((c) => `<button type="button" class="catrow ${catFilter === c.id ? "on" : ""}" data-cat="${c.id}" aria-pressed="${catFilter === c.id}">
      <span class="n"><i class="sw" style="background:var(${colors[c.id]})"></i>${c.name}</span><span class="v">${TL(c.amount / n)}<span class="note">/ay</span></span><span class="s">${pct(c.share)}</span></button>`).join("");
  $("#catlist").querySelectorAll(".catrow").forEach((b) => b.addEventListener("click", () => filterCat(b.dataset.cat)));

  // ---- personal inflation
  if (pi) {
    $("#infl-sub").textContent = `${ymLong(pi.month)} itibarıyla son 12 ay. ${pi.gap > 0 ? "Harcama sepetin ortalamadan daha hızlı pahalanıyor." : "Harcama sepetin ortalamadan daha yavaş pahalanıyor."}`;
    $("#infl").innerHTML = `<div><div class="big grad">${pct(pi.personal, 1)}</div><div class="cap">senin enflasyonun</div></div><div><div class="mid">${pct(pi.official, 1)}</div><div class="cap">resmî (TÜFE)</div></div>`;
    const maxRate = Math.max(...pi.rows.map((r) => r.rate));
    $("#infl-bars").innerHTML = pi.rows.slice(0, 7).map((r, i) => `<div class="bar"><span>${byId[r.cat]?.name ?? r.cat}</span>
      <span class="track"><span class="fill" style="display:block;width:${(r.rate / maxRate) * 100}%;background:var(${colors[r.cat] || "--muted"});animation-delay:${i * 60}ms"></span></span>
      <span class="val">${pct(r.rate)}</span></div>`).join("") + `<p class="note" style="margin:6px 0 0">Çubuk: kategorinin yıllık fiyat artışı · sıralama: senin enflasyonuna katkısı</p>`;
  }

  // ---- forecast
  const mi = recentMonthlyInflation(cpiRows());
  const f = forecast(m, cpi, mi, partial);
  if (f) {
    const next = nextMonth(f.base);
    $("#fc-title").textContent = `${ymLong(next)} tahmini`;
    $("#fc-sub").innerHTML = `Toplam <b style="color:var(--ink)">${TL(f.total.mid)}</b>, büyük olasılıkla ${short(f.total.lo)} – ${short(f.total.hi)} TL arası. Son üç ayın seviyesi, aylık ${pct(mi, 1)} enflasyonla taşındı.`;
    const rows = cats.slice(0, 7).map((c) => ({ c, r: f.cats[c.id] })).filter((x) => x.r);
    const max = Math.max(...rows.map((x) => x.r.hi));
    $("#fc").innerHTML = rows.map(({ c, r }) => `<div class="range"><span>${c.name}</span>${rangeSVG(r.lo, r.mid, r.hi, max, colors[c.id])}<span class="val">${short(r.mid)} TL</span></div>`).join("");
    $("#fc-strip").innerHTML = forecastStrip(m, f, partial);
  }
  const me = partial ? monthEnd(txs, m.months[m.months.length - 1]) : null;
  $("#month-end").hidden = !me;
  if (me) $("#month-end").innerHTML = `<b>${ymLong(me.month)}</b> henüz bitmedi (son işlem: ayın ${me.day}. günü). Şu ana kadar ${TL(me.soFar)}; bu gidişle ay <b>${TL(me.mid)}</b> civarında kapanır (${short(me.lo)} – ${short(me.hi)} TL).`;

  renderModel();

  // ---- subscriptions
  const regular = subs.filter((x) => x.kind === "subscription");
  $("#subs-note").textContent = regular.length ? `${regular.length} abonelik · yılda ${TL(subsYear)}` : "";
  $("#subs").innerHTML = subs.length ? subs.map((x) => `<div class="sub-card"><span class="name">${esc(x.name)}</span><span class="price">${TL(x.last)}</span><span class="year">yılda ${TL(x.yearly)} · ${byId[x.cat]?.name ?? ""}</span>
      ${x.kind === "bill" ? `<span class="badge">tutar değişken</span>` : x.rise > 0.05 ? `<span class="badge up">▲ ${pct(x.rise)} zam</span>` : `<span class="badge">sabit</span>`}</div>`).join("")
    : `<p class="note">Düzenli ödeme bulunamadı. En az üç aylık ekstre gerekiyor.</p>`;

  // ---- months
  const last = m.months[m.months.length - 1];
  const conv = (o) => (real && cpi ? toReal(o, cpi, last) : o);
  const ids = cats.slice(0, 7).map((c) => c.id);
  const groups = ids.map((id) => ({ label: byId[id].name, color: colors[id], values: m.months.map((k) => conv(m.byCat[id] || {})[k] || 0) }));
  const restIds = Object.keys(m.byCat).filter((id) => !ids.includes(id));
  if (restIds.length) groups.push({ label: "Diğer kalemler", color: "--muted", values: m.months.map((k) => restIds.reduce((a, id) => a + (conv(m.byCat[id])[k] || 0), 0)) });
  $("#monthly-sub").textContent = real ? `${ymLong(last)} fiyatlarıyla. Enflasyon çıkınca gerçekte daha mı çok harcıyorsun?` : "Ekstredeki tutarlar.";
  stackedBars($("#c-monthly"), { aria: "Aylık harcama", labels: m.months.map((k) => ym(k)), tipLabels: m.months.map(ymLong), groups, height: 300 });

  txTable();

  // ---- hand-off to the simulator
  const rent = txs.filter((t) => t.cat === "housing" && t.amount > 0 && /kira/i.test(t.desc));
  const rentNow = rent.length ? rent[rent.length - 1].amount : null;
  sim.setBudget({ monthlySavings: s.monthlySavings, rent: rentNow });
  $("#cta-sub").textContent = rentNow
    ? `Ekstrene göre ayda ${TL(rentNow)} kira ödüyor, ortalama ${TL(Math.max(0, s.monthlySavings))} biriktiriyorsun. Simülatör bu rakamlarla açılır.`
    : `Ortalama aylık birikimin ${TL(s.monthlySavings)}. Simülatör kredi taksidinin buna sığıp sığmadığını gösterir.`;
}

function filterCat(id) {
  catFilter = catFilter === id ? "" : id;
  $("#cat-filter").value = catFilter;
  document.querySelectorAll(".catrow").forEach((b) => b.classList.toggle("on", b.dataset.cat === catFilter));
  txTable();
  $("#txs").scrollIntoView({ behavior: "smooth", block: "center" });
}

/** Monthly totals as slim bars, then next month as an outlined bar with its range. */
function forecastStrip(m, f, partial) {
  const months = partial ? m.months.slice(0, -1) : m.months;
  const vals = months.map((k) => m.total[k] || 0);
  const W = 520, H = 140, n = vals.length + 1, bw = W / n, max = Math.max(...vals, f.total.hi) * 1.05;
  const Y = (v) => H - 18 - (v / max) * (H - 30);
  const bars = vals.map((v, i) => `<rect x="${i * bw + bw * 0.22}" y="${Y(v)}" width="${bw * 0.56}" height="${H - 18 - Y(v)}" rx="3" fill="var(--ink)" opacity=".18"/>`).join("");
  const x = (n - 1) * bw + bw * 0.22, w = bw * 0.56, cx = x + w / 2;
  const fc = `<rect x="${x}" y="${Y(f.total.mid)}" width="${w}" height="${H - 18 - Y(f.total.mid)}" rx="3" fill="url(#fcg)" stroke="var(--blue)" stroke-width="1.2"/>
    <line x1="${cx}" x2="${cx}" y1="${Y(f.total.hi)}" y2="${Y(f.total.lo)}" stroke="var(--blue)" stroke-width="2" stroke-linecap="round"/>
    <line x1="${cx - 5}" x2="${cx + 5}" y1="${Y(f.total.hi)}" y2="${Y(f.total.hi)}" stroke="var(--blue)" stroke-width="2" stroke-linecap="round"/>
    <line x1="${cx - 5}" x2="${cx + 5}" y1="${Y(f.total.lo)}" y2="${Y(f.total.lo)}" stroke="var(--blue)" stroke-width="2" stroke-linecap="round"/>`;
  const lab = (i, k) => `<text x="${i * bw + bw / 2}" y="${H - 4}" text-anchor="middle">${k}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Son aylar ve gelecek ayın tahmini">
    <defs><linearGradient id="fcg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--blue)" stop-opacity=".45"/><stop offset="1" stop-color="var(--blue)" stop-opacity=".08"/></linearGradient></defs>
    ${bars}${fc}${lab(0, ym(months[0]))}${lab(vals.length - 1, ym(months[months.length - 1]))}${lab(n - 1, "tahmin")}</svg>`;
}

const nextMonth = (k) => { const [y, mo] = k.split("-").map(Number); return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`; };
const cpiRows = () => hicp.months.map((mm, i) => ({ month: mm, cpi: hicp.index.all[i] }));

// ------------------------------------------------------------------ the learning model, in view
const SRC = { rule: ["Bilinen marka", "--ink-2"], model: ["Model öğrendi", "--violet"], you: ["Senin cevabın", "--mint"], unsure: ["Emin değil", "--warn"] };

function renderModel() {
  const spend = txs.filter((t) => t.amount > 0 && t.cat !== "card");
  const tot = spend.reduce((a, t) => a + t.amount, 0) || 1;
  const by = Object.fromEntries(Object.keys(SRC).map((k) => [k, spend.filter((t) => t.source === k).reduce((a, t) => a + t.amount, 0) / tot]));
  $("#sources").innerHTML = Object.entries(SRC).map(([k, [, c]]) => `<span style="width:${by[k] * 100}%;background:var(${c})" title="${SRC[k][0]}"></span>`).join("");
  $("#srclegend").innerHTML = Object.entries(SRC).map(([k, [l, c]]) => `<span><i style="background:var(${c})"></i>${l} ${pct(by[k])}</span>`).join("");
  queue = reviewQueue(txs, skipped);
  drawQueue();
}

function drawQueue() {
  const box = $("#stack");
  if (!queue.length) {
    box.innerHTML = `<div class="done"><div><div style="font:650 20px var(--display);color:var(--ink)">Sorulacak bir şey kalmadı</div><p class="note">Bütün harcamalar sınıflandı. Bir kategoriyi değiştirmek istersen işlemler listesinden düzeltebilirsin.</p></div></div>`;
    return;
  }
  const [a, b] = queue;
  const card = (q, cls) => {
    const alt = (q.alt || []).filter((x) => byId[x.cat]).slice(0, 3);
    return `<div class="qcard ${cls}" data-m="${esc(q.merchant)}">
      <span class="q">${queue.length} soru · ${q.source === "model" ? "tahmin doğru mu?" : "bu ne?"}</span>
      <span class="desc">${esc(q.desc)}</span>
      <span class="meta">${q.count} işlem · toplam ${TL(q.amount)}</span>
      <div class="options">${alt.map((x, i) => `<button type="button" class="opt" data-cat="${x.cat}"><span class="k">${i + 1}</span><span>${byId[x.cat].name}</span><span class="p">${pct(x.p)}</span></button>`).join("")}</div>
      <div class="qfoot"><select aria-label="Başka bir kategori"><option value="">Başka kategori…</option>${[...CATEGORIES, OTHER].filter((c) => !["income", "card"].includes(c.id)).map((c) => `<option value="${c.id}">${c.name}</option>`).join("")}</select>
        <button type="button" class="btn ghost skip">Atla <span class="kbd">S</span></button></div></div>`;
  };
  box.innerHTML = (b ? card(b, "behind") : "") + card(a, "front");
  const front = box.querySelector(".front");
  front.querySelectorAll(".opt").forEach((o) => o.addEventListener("click", () => answer(o.dataset.cat)));
  front.querySelector("select").addEventListener("change", (e) => e.target.value && answer(e.target.value));
  front.querySelector(".skip").addEventListener("click", () => answer(null));
}

function answer(cat) {
  const q = queue[0];
  if (!q) return;
  const front = $("#stack .front");
  front?.classList.add("out");
  setTimeout(() => {
    if (cat) { overrides[q.merchant] = cat; store.set("kumbara-overrides", overrides); } else skipped.add(q.merchant);
    refresh(); // retrains the model with the new answer
  }, 260);
}

addEventListener("keydown", (e) => {
  if (!queue.length || e.metaKey || e.ctrlKey || e.altKey || /input|select|textarea/i.test(document.activeElement?.tagName)) return;
  const model = $("#model").getBoundingClientRect();
  if (model.bottom < 0 || model.top > innerHeight) return;
  if (/^[1-3]$/.test(e.key)) {
    const opt = document.querySelectorAll("#stack .front .opt")[+e.key - 1];
    if (opt) { e.preventDefault(); answer(opt.dataset.cat); }
  } else if (e.key.toLowerCase() === "s") { e.preventDefault(); answer(null); }
});

// ------------------------------------------------------------------ transactions
function txTable() {
  const sel = $("#cat-filter");
  const opts = [...CATEGORIES, OTHER];
  sel.innerHTML = `<option value="">Tüm kategoriler</option>` + opts.map((c) => `<option value="${c.id}" ${c.id === catFilter ? "selected" : ""}>${c.name}</option>`).join("");
  const qf = query.toLocaleLowerCase("tr");
  const list = txs.filter((t) => (!catFilter || t.cat === catFilter) && (!qf || t.desc.toLocaleLowerCase("tr").includes(qf))).slice().reverse();
  const shown = list.slice(0, 400);
  const badge = (t) => `<span class="badge src-${t.source}" title="${SRC[t.source]?.[0] ?? ""}">${{ rule: "marka", model: `model ${pct(t.conf)}`, you: "sen", unsure: "emin değil" }[t.source] ?? ""}</span>`;
  $("#txs").innerHTML = `<table><thead><tr><th>Tarih</th><th>Açıklama</th><th>Kategori</th><th>Kaynak</th><th class="r">Tutar</th></tr></thead><tbody>` +
    shown.map((t) => `<tr><td class="num">${dmy(t.date)}</td><td>${esc(t.desc)}</td><td><select data-m="${esc(t.merchant)}" aria-label="Kategori">${opts.map((c) => `<option value="${c.id}" ${c.id === t.cat ? "selected" : ""}>${c.name}</option>`).join("")}</select></td>
      <td>${badge(t)}</td><td class="r ${t.amount < 0 ? "in" : ""}">${t.amount < 0 ? "+" : ""}${TL(Math.abs(t.amount))}</td></tr>`).join("") +
    `</tbody></table>` + (list.length > shown.length ? `<p class="note" style="padding:10px">İlk ${shown.length} işlem gösteriliyor (${fmt(list.length)} eşleşme). Aramayla daralt.</p>` : "");
  $("#txs").querySelectorAll("select").forEach((s) => s.addEventListener("change", () => {
    overrides[s.dataset.m] = s.value;
    store.set("kumbara-overrides", overrides);
    refresh();
  }));
}
$("#q").addEventListener("input", (e) => { query = e.target.value; txTable(); });
$("#cat-filter").addEventListener("change", (e) => filterCat(e.target.value || catFilter));
document.querySelectorAll("[data-real]").forEach((b) => b.addEventListener("click", () => {
  real = b.dataset.real === "1";
  document.querySelectorAll("[data-real]").forEach((x) => x.classList.toggle("on", x === b));
  render();
}));
$("#pick").addEventListener("click", (e) => { e.stopPropagation(); input.click(); });

// ------------------------------------------------------------------ start
(async function start() {
  try {
    [macro, hicp] = await Promise.all([fetch("data/macro.json").then((r) => r.json()).then((d) => d.rows), fetch("data/hicp.json").then((r) => r.json())]);
    cpi = cpiIndex(cpiRows());
  } catch (e) {
    console.error("data", e);
  }
  sim.init(macro);
  showTab();
  if (new URLSearchParams(location.search).has("ornek")) $("#demo").click();
})();

