// Spending categories from Turkish statement descriptions.
//
// Statement lines look like "MIGROS 4521 KADIKOY ISTANBUL TR" or "YEMEKSEPETI*ORDER 81723".
// Rules match brand names after folding Turkish letters; the first category in the list that
// matches wins, so specific rules ("TRENDYOL YEMEK") come before general ones ("TRENDYOL").
// Users correct the rest; corrections are kept per merchant in the browser.

import { fold } from "./parse.js";

export const CATEGORIES = [
  { id: "income", name: "Gelir", rules: ["maas", "salary", "ucret odemesi", "prim odemesi", "kira geliri"] },
  { id: "card", name: "Kart ödemesi", rules: ["kart odemesi", "kredi karti odeme", "ekstre odeme", "odemeniz icin tesekkur"] },
  { id: "fees", name: "Faiz ve ücretler", rules: ["faiz", "kkdf", "bsmv", "kart ucreti", "yillik ucret", "gecikme", "hesap isletim", "masraf", "komisyon"] },
  { id: "food", name: "Yemek ve kafe", rules: ["yemeksepeti", "trendyol yemek", "trendyolyemek", "getiryemek", "getir yemek", "migros yemek", "starbucks", "kahve dunyasi", "simit sarayi", "burger king", "mcdonald", "dominos", "pizza", "popeyes", "kfc", "little caesars", "papa john", "espressolab", "gloria jean", "caribou", "restoran", "restaurant", "cafe", "kafe", "lokanta", "kebap", "pide", "doner", "baklava", "pastane", "firin"] },
  { id: "grocery", name: "Market", rules: ["migros", "a101", "bim", "sok market", "sok marketler", "carrefour", "macrocenter", "metro market", "file market", "hakmar", "onur market", "bizim toptan", "getir", "istegelsin", "market", "kasap", "manav"] },
  { id: "subs", name: "Dijital abonelik", rules: ["netflix", "spotify", "youtube", "google one", "google storage", "apple com", "icloud", "disney", "prime video", "amazon prime", "exxen", "blutv", "hbo max", " max ", "gain", "tod tv", "digiturk", "chatgpt", "openai", "anthropic", "claude ai", "adobe", "microsoft", "storytel", "duolingo", "canva", "dropbox", "playstation plus", "xbox"] },
  { id: "bills", name: "Faturalar", rules: ["enerjisa", "ck enerji", "bogazici elektrik", "ayedas", "bedas", "toroslar", "igdas", "iski", "aski", "izsu", "baskentgaz", "izmirgaz", "aksa", "turkcell", "vodafone", "turk telekom", "tt mobil", "superonline", "turknet", "millenicom", "kablonet", "fatura"] },
  { id: "fuel", name: "Akaryakıt", rules: ["shell", "opet", "petrol ofisi", " bp ", "bp petrol", "total", "aytemiz", "lukoil", "go petrol", "akaryakit", "sunpet", "moil"] },
  { id: "transport", name: "Ulaşım", rules: ["istanbulkart", "belbim", "iett", "metro istanbul", "izban", "ankarakart", "uber", "bitaksi", "marti", "binbin", "hop scooter", "tcdd", "turk hava yollari", "thy", "pegasus", "ajet", "anadolujet", "sunexpress", "obilet", "havaist", "havabus", "ispark", "otopark", "hgs", "ogs", "kgm", "otoyol", "kopru"] },
  { id: "housing", name: "Kira ve konut", rules: ["kira", "aidat", "site yonetim", "yonetim gideri", "emlak vergisi", "dask"] },
  { id: "health", name: "Sağlık", rules: ["eczane", "hastane", "acibadem", "memorial", "medical park", "florence", "liv hospital", "dis hekimi", "klinik", "optik", "laboratuvar", "saglik"] },
  { id: "shopping", name: "Alışveriş", rules: ["trendyol", "hepsiburada", "amazon", "n11", "ciceksepeti", "pazarama", "zara", "lc waikiki", "lcw", "defacto", "koton", "mavi", "boyner", "h&m", "hm ", "flo ", "decathlon", "teknosa", "mediamarkt", "vatan bilgisayar", "apple store", "ikea", "koctas", "bauhaus", "english home", "madame coco", "watsons", "gratis", "rossmann", "sephora", "ebebek", "idefix", "d&r", "dr kitap"] },
  { id: "fun", name: "Eğlence", rules: ["biletix", "passo", "biletinial", "sinema", "cinemaximum", "paribu cineplex", "steam", "epic games", "playstation", "nintendo", "konser", "tiyatro", "muze", "spor salonu", "macfit", "gym"] },
  { id: "edu", name: "Eğitim", rules: ["universite", "okul", "kurs", "dershane", "udemy", "coursera", "kirtasiye", "egitim"] },
  { id: "travel", name: "Seyahat ve konaklama", rules: ["otel", "hotel", "booking", "airbnb", "jolly", "etstur", "tatilbudur", "tatil"] },
  { id: "public", name: "Vergi ve kamu", rules: ["gelir idaresi", "vergi", "sgk", "belediye", "mtv", "trafik ceza", "pasaport", "noter", "harc"] },
  { id: "cash", name: "Nakit ve transfer", rules: ["atm", "nakit", "para cekme", "eft", "havale", "fast", "transfer", "papara", "ininal", "param "] },
];

export const OTHER = { id: "other", name: "Diğer" };
export const byId = Object.fromEntries([...CATEGORIES, OTHER].map((c) => [c.id, c]));

const norm = (s) => " " + fold(s).replace(/[^a-z0-9&]+/g, " ").replace(/\s+/g, " ").trim() + " ";

// precompiled rules: whole-word-ish matches on the folded text
const COMPILED = CATEGORIES.map((c) => ({ id: c.id, rules: c.rules.map((r) => norm(r).trim()) }));

/** A stable merchant key: the description without numbers, card masks, cities and country codes. */
export function merchantKey(desc) {
  const words = norm(desc).trim().split(" ")
    // drop store numbers and payment codes ("4521", "P0A8B1") but keep brands like "A101"
    .filter((w) => w && !/^\d+$/.test(w) && !(/\d/.test(w) && w.length >= 6) && !NOISE.has(w));
  return words.slice(0, 3).join(" ") || norm(desc).trim();
}

const NOISE = new Set(["tr", "tur", "turkey", "turkiye", "istanbul", "ist", "ankara", "izmir", "bursa", "antalya", "kocaeli",
  "kadikoy", "besiktas", "sisli", "uskudar", "atasehir", "bakirkoy", "maltepe", "beyoglu", "sariyer", "cankaya",
  "konak", "karsiyaka", "pos", "sanal", "www", "com", "as", "a s", "ltd", "sti", "tic", "san", "ve", "tl", "try",
  "harcama", "alisveris", "islem", "odeme",
  // foreign card descriptors: "SPOTIFY P0A8B1 STOCKHOLM SE", "APPLE.COM/BILL"
  "se", "us", "ie", "nl", "gb", "lu", "de", "fr", "stockholm", "dublin", "amsterdam", "luxembourg", "london", "cork",
  "bill", "help", "order", "trip", "purchase", "payment", "inc", "llc", "ltd", "bv", "ab", "co"]);

/** Category id for one description, honouring the user's corrections first. */
export function categorize(desc, amount, overrides = {}) {
  const key = merchantKey(desc);
  if (overrides[key]) return overrides[key];
  const text = norm(desc);
  for (const c of COMPILED) {
    if (c.id === "income" && amount > 0) continue; // salary words only on money in
    if (c.rules.some((r) => text.includes(" " + r + " ") || (r.length >= 5 && text.includes(r)))) return c.id;
  }
  if (amount < 0) return "income";
  return OTHER.id;
}

/** Add `cat` and `merchant` to each transaction (returns new objects). */
export function categorizeAll(txs, overrides = {}) {
  return txs.map((t) => ({ ...t, merchant: merchantKey(t.desc), cat: categorize(t.desc, t.amount, overrides) }));
}
