// Reading bank and credit card statements into transactions.
//
// Turkish banks export statements in many shapes: CSV with ";" or ",", Excel, or PDF; amounts as
// "1.234,56" or "-1.234,56 TL"; spending as negative numbers (account) or positive (card); one
// amount column or separate Borç/Alacak columns. Everything here is pure and runs in the browser
// and in Node tests alike. A transaction is {date: "YYYY-MM-DD", desc, amount}, where a positive
// amount is money spent and a negative amount is money in (salary, refund, card payment).

const MONTHS_TR = ["ocak", "şubat", "mart", "nisan", "mayıs", "haziran", "temmuz", "ağustos", "eylül", "ekim", "kasım", "aralık"];

// fold Turkish letters so "İŞLEM TARİHİ" and "islem tarihi" compare equal
export function fold(s) {
  return String(s ?? "")
    .replace(/[İIı]/g, "i").replace(/[Şş]/g, "s").replace(/[Ğğ]/g, "g")
    .replace(/[Üü]/g, "u").replace(/[Öö]/g, "o").replace(/[Çç]/g, "c")
    .toLowerCase().trim();
}

/** "1.234,56" | "-1.234,56 TL" | "1,234.56" | "(123,45)" | "123,45-" | "+500" -> number, or NaN */
export function parseAmount(raw) {
  if (typeof raw === "number") return raw;
  let s = String(raw ?? "").trim();
  if (!s) return NaN;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/\s*(TL|TRY|₺)\s*/gi, "").replace(/\s/g, "");
  if (s.endsWith("-")) { neg = !neg; s = s.slice(0, -1); }
  if (s.startsWith("-")) { neg = !neg; s = s.slice(1); } else if (s.startsWith("+")) s = s.slice(1);
  if (!/^[\d.,]+$/.test(s)) return NaN;
  const lastComma = s.lastIndexOf(","), lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) {
    s = s.replace(/\./g, "").replace(",", "."); // 1.234,56
  } else if (lastDot > lastComma && lastComma >= 0) {
    s = s.replace(/,/g, ""); // 1,234.56
  } else if (lastDot >= 0 && lastComma < 0) {
    // only dots: "1.234" is thousands in Turkish exports, "12.50" a decimal
    const parts = s.split(".");
    if (parts.length > 2 || parts[parts.length - 1].length === 3) s = s.replace(/\./g, "");
  }
  const v = Number(s);
  return Number.isFinite(v) ? (neg ? -v : v) : NaN;
}

/** "12.10.2025" | "12/10/25" | "2025-10-12" | "12 Ekim 2025" | Excel serial -> "YYYY-MM-DD", or "" */
export function parseDate(raw) {
  if (raw instanceof Date && !isNaN(raw)) return raw.toISOString().slice(0, 10);
  if (typeof raw === "number" && raw > 20000 && raw < 80000) {
    // Excel serial day (1900 system)
    return new Date(Date.UTC(1899, 11, 30) + raw * 864e5).toISOString().slice(0, 10);
  }
  const s = String(raw ?? "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return valid(y, Number(m[2]), Number(m[1]));
  }
  m = fold(s).match(/^(\d{1,2})\s+([a-z]+)\s+(\d{4})/);
  if (m) {
    const k = MONTHS_TR.map(fold).indexOf(m[2]);
    if (k >= 0) return valid(Number(m[3]), k + 1, Number(m[1]));
  }
  return "";
}

function valid(y, mo, d) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return "";
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Split CSV text into rows, detecting the delimiter and honouring quotes. */
export function parseCSV(text) {
  text = String(text).replace(/^﻿/, "");
  const head = text.split(/\r?\n/).slice(0, 10).join("\n");
  const delim = [";", "\t", ",", "|"].map((d) => [d, (head.match(new RegExp(d === "|" ? "\\|" : d, "g")) || []).length])
    .sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim()));
}

const KEYS = {
  date: ["islem tarihi", "tarih", "date", "valor"],
  desc: ["aciklama", "islem aciklamasi", "detay", "isyeri", "uye isyeri", "description", "merchant", "islem"],
  amount: ["tutar", "islem tutari", "miktar", "amount", "tutar (tl)"],
  debit: ["borc", "cikis", "harcama", "debit"],
  credit: ["alacak", "giris", "yatan", "credit"],
};

function score(header, keys) {
  const h = fold(header);
  let best = 0;
  for (const k of keys) {
    if (h === k) best = Math.max(best, 3);
    else if (h.startsWith(k)) best = Math.max(best, 2);
    else if (h.includes(k)) best = Math.max(best, 1);
  }
  return best;
}

/** Find the header row and guess which column holds what. */
export function detectColumns(rows) {
  let best = { row: -1, hits: 0 };
  rows.slice(0, 40).forEach((r, i) => {
    const hits = ["date", "desc", "amount", "debit", "credit"].filter((k) => r.some((c) => score(c, KEYS[k]) > 0)).length;
    if (hits > best.hits) best = { row: i, hits };
  });
  if (best.row < 0 || best.hits < 2) return { headerRow: -1, mapping: guessByContent(rows) };
  const header = rows[best.row];
  const pick = (k, taken) => {
    let col = -1, s = 0;
    header.forEach((c, j) => { const v = score(c, KEYS[k]); if (v > s && !taken.includes(j)) { s = v; col = j; } });
    return col;
  };
  const taken = [];
  const mapping = {};
  for (const k of ["date", "amount", "debit", "credit", "desc"]) {
    mapping[k] = pick(k, taken);
    if (mapping[k] >= 0) taken.push(mapping[k]);
  }
  // "bakiye" (balance) is never the amount
  for (const k of ["amount", "debit", "credit"]) if (mapping[k] >= 0 && fold(header[mapping[k]]).includes("bakiye")) mapping[k] = -1;
  return { headerRow: best.row, header, mapping };
}

function guessByContent(rows) {
  // no header: the date column parses as dates, the amount column as numbers, desc is the longest text
  const n = Math.max(...rows.map((r) => r.length));
  const sample = rows.slice(0, 50);
  const rate = (j, f) => sample.filter((r) => f(r[j])).length / sample.length;
  const cols = [...Array(n).keys()];
  const date = cols.find((j) => rate(j, (v) => parseDate(v)) > 0.8) ?? -1;
  const nums = cols.filter((j) => j !== date && rate(j, (v) => Number.isFinite(parseAmount(v))) > 0.8);
  const desc = cols.filter((j) => j !== date && !nums.includes(j))
    .sort((a, b) => avgLen(sample, b) - avgLen(sample, a))[0] ?? -1;
  return { date, desc, amount: nums[0] ?? -1, debit: -1, credit: -1 };
}

const avgLen = (rows, j) => rows.reduce((s, r) => s + String(r[j] ?? "").length, 0) / rows.length;

/**
 * Rows + column mapping -> transactions. ``spendSign`` says how spending appears in a single
 * amount column: "negative" (bank accounts), "positive" (card statements) or "auto".
 */
export function toTransactions(rows, { headerRow = -1, mapping }, spendSign = "auto") {
  const body = rows.slice(headerRow + 1);
  const out = [];
  for (const r of body) {
    const date = parseDate(r[mapping.date]);
    if (!date) continue;
    let amount;
    if (mapping.debit >= 0 || mapping.credit >= 0) {
      const d = parseAmount(r[mapping.debit]), c = parseAmount(r[mapping.credit]);
      amount = (Number.isFinite(d) ? Math.abs(d) : 0) - (Number.isFinite(c) ? Math.abs(c) : 0);
      if (!Number.isFinite(d) && !Number.isFinite(c)) continue;
    } else {
      amount = parseAmount(r[mapping.amount]);
      if (!Number.isFinite(amount)) continue;
    }
    const desc = String(r[mapping.desc] ?? "").replace(/\s+/g, " ").trim();
    if (amount === 0) continue;
    out.push({ date, desc, amount });
  }
  const single = !(mapping.debit >= 0 || mapping.credit >= 0);
  if (single) {
    let sign = spendSign;
    if (sign === "auto") {
      // most lines of a statement are purchases, so the majority sign is spending
      const neg = out.filter((t) => t.amount < 0).length;
      sign = neg > out.length / 2 ? "negative" : "positive";
    }
    if (sign === "negative") out.forEach((t) => (t.amount = -t.amount));
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Text lines of a PDF statement -> transactions. A line counts when it starts with a date and
 * ends with an amount; the text in between is the description. Card statements list purchases as
 * positive amounts, so the sign convention is the same "auto" rule as for CSV.
 */
export function fromTextLines(lines, spendSign = "auto") {
  const rows = [];
  const amountRe = /(-?\(?[\d.]+,\d{2}\)?-?)\s*(TL|TRY)?\s*$/i;
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, " ").trim();
    const dm = line.match(/^(\d{1,2}[./]\d{1,2}[./]\d{2,4})\s+/);
    if (!dm) continue;
    let rest = line.slice(dm[0].length);
    // a balance column often follows the amount: take the first of two trailing amounts
    const two = rest.match(/(-?[\d.]+,\d{2}-?)\s*(TL)?\s+(-?[\d.]+,\d{2}-?)\s*(TL)?\s*$/i);
    let amt;
    if (two) { amt = two[1]; rest = rest.slice(0, two.index); } else {
      const one = rest.match(amountRe);
      if (!one) continue;
      amt = one[1]; rest = rest.slice(0, one.index);
    }
    // a second date (value date) may follow the first
    rest = rest.replace(/^\d{1,2}[./]\d{1,2}[./]\d{2,4}\s+/, "");
    rows.push([dm[1], rest.trim(), amt]);
  }
  return toTransactions(rows, { headerRow: -1, mapping: { date: 0, desc: 1, amount: 2, debit: -1, credit: -1 } }, spendSign);
}

/**
 * Merge statements without double counting where they overlap (the same file added twice, or
 * two months that share a few days). Two identical coffees on one day are real, so each line is
 * kept as many times as it appears in the file that has it most often.
 */
export function merge(files) {
  const key = (t) => `${t.date}|${t.desc}|${t.amount}`;
  const best = new Map();
  for (const txs of files) {
    const count = new Map();
    for (const t of txs) count.set(key(t), (count.get(key(t)) || 0) + 1);
    for (const [k, n] of count) if (!best.has(k) || best.get(k).n < n) best.set(k, { n, t: txs.find((t) => key(t) === k) });
  }
  const out = [];
  for (const { n, t } of best.values()) for (let i = 0; i < n; i++) out.push({ ...t });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
