// A category model that learns on the device.
//
// Brand rules (categorize.js) know Migros and Netflix; they know nothing about "KÖFTECİ YUSUF" or
// "ECZ. DENİZ". This module trains a multinomial naive Bayes classifier in the browser on:
//   1. a Turkish vocabulary of everyday words per category ("köfte", "eczane", "akaryakıt"),
//   2. the statement's own transactions that a brand rule labelled (self-training),
//   3. the user's corrections, weighted most.
// Features are words plus 3-5 letter fragments, so "köfteci", "köftecisi" and "kofte" share
// evidence and abbreviations like "ECZ" still point to a pharmacy. Training takes milliseconds
// and reruns after every answer; nothing leaves the device.

import { CATEGORIES, merchantKey, ruleMatch } from "./categorize.js";
import { fold } from "./parse.js";

// everyday words per category; brands live in the rules
export const LEXICON = {
  food: "kahve kahveci kafe kafeterya coffee roastery espresso cay bahcesi restoran restaurant lokanta kebap kebapci doner durum durumcu pide pideci lahmacun kofte kofteci cigkofte balik balikci meyhane ocakbasi izgara grill burger burgerci pizza pizzeria sushi noodle manti mantici corba corbaci kokorec tantuni waffle tatli tatlici baklava baklavaci kunefe pastane pasta firin unlu mamul borek borekci simit simitci bistro brasserie kitchen mutfak sofra yemek ev yemekleri catering dondurma",
  grocery: "market supermarket hipermarket bakkal manav kasap kasabi sarkuteri sarkuteri gida gidasi sut urunleri kuruyemis kuruyemisci tekel bufe organik pazar toptan bakliyat yumurta et tavuk",
  health: "eczane eczanesi ecz pharmacy hastane hastanesi klinik klinigi poliklinik saglik medikal medical tip merkezi dis disci hekim doktor optik gozluk laboratuvar lab tahlil fizyoterapi psikolog veteriner vet",
  fuel: "petrol akaryakit benzin benzinlik istasyon istasyonu otogaz lpg dizel motorin yakit",
  transport: "taksi taxi otopark park vale otobus turizm seyahat havayolu havayollari airlines airline yolcu bilet feribot vapur otobusu marmaray metro tramvay rent car arac kiralama oto yikama servis lastik",
  shopping: "magaza magazasi butik giyim konfeksiyon tekstil moda ayakkabi ayakkabici canta aksesuar elektronik bilgisayar telefon beyaz esya mobilya ev tekstili dekorasyon store shop outlet kozmetik parfumeri parfum taki kuyumcu oyuncak hirdavat yapi market nalbur cicek cicekci",
  care: "kuafor kuaforu berber berberi barber guzellik salonu merkezi spa masaj manikur pedikur cilt bakimi epilasyon sac tasarim",
  fun: "sinema cinema bilet tiyatro konser festival muze oyun game games spor fitness gym pilates yoga studyo bowling bilardo eglence lunapark havuz kulup",
  edu: "kitap kitabevi kitapcisi kirtasiye kurs kursu akademi egitim okul kolej universite yayin yayinlari dershane etut ozel ders",
  travel: "otel hotel pansiyon resort apart hostel tatil konaklama villa butik otel kamp",
  bills: "elektrik dogalgaz gaz su idaresi internet telekom gsm hat fatura faturasi abonelik bedeli enerji dagitim",
  subs: "premium abonelik subscription membership uyelik plus pro cloud bulut depolama muzik dizi film yayini app store",
  housing: "kira kirasi aidat aidati yonetim yonetimi emlak site apartman konut",
  public: "vergi vergisi belediye belediyesi harc harci noter ceza cezasi tapu nufus pasaport sgk prim",
  cash: "atm nakit para cekme cekim",
  fees: "faiz ucret ucreti komisyon masraf masrafi gecikme kesinti",
};

const MODEL_CATS = Object.keys(LEXICON);
const ALPHA = 0.5;

/** Words and 3-5 letter fragments of a statement line. */
export function features(text) {
  const words = fold(text).replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length >= 2 && !/^\d+$/.test(w));
  const out = new Set();
  for (const w of words) {
    out.add("w:" + w);
    const s = `^${w}$`;
    for (let n = 3; n <= 5; n++) for (let i = 0; i + n <= s.length; i++) out.add(s.slice(i, i + n));
  }
  return [...out];
}

export class NaiveBayes {
  constructor(classes = MODEL_CATS) {
    this.classes = classes;
    this.counts = Object.fromEntries(classes.map((c) => [c, new Map()]));
    this.totals = Object.fromEntries(classes.map((c) => [c, 0]));
    this.vocab = new Set();
  }

  add(text, cls, weight = 1) {
    if (!this.counts[cls]) return;
    for (const f of features(text)) {
      this.counts[cls].set(f, (this.counts[cls].get(f) || 0) + weight);
      this.totals[cls] += weight;
      this.vocab.add(f);
    }
  }

  /** Class probabilities, best first. Log-likelihoods are tempered by the number of features,
   * because naive Bayes double-counts overlapping fragments and is otherwise overconfident. */
  predict(text) {
    const fs = features(text).filter((f) => this.vocab.has(f));
    if (!fs.length) return this.classes.map((c) => ({ cat: c, p: 1 / this.classes.length }));
    const V = this.vocab.size;
    const scores = this.classes.map((c) => {
      const cnt = this.counts[c], tot = this.totals[c] + ALPHA * V;
      let s = 0;
      for (const f of fs) s += Math.log(((cnt.get(f) || 0) + ALPHA) / tot);
      return s;
    });
    const temp = Math.max(1, Math.sqrt(fs.length));
    const m = Math.max(...scores);
    const ex = scores.map((s) => Math.exp((s - m) / temp));
    const z = ex.reduce((a, b) => a + b, 0);
    return this.classes.map((c, i) => ({ cat: c, p: ex[i] / z })).sort((a, b) => b.p - a.p);
  }
}

/** Train on the vocabulary, the brand rules' own keywords, rule-labelled lines and corrections. */
export function train(txs = [], overrides = {}) {
  const nb = new NaiveBayes();
  for (const [cat, words] of Object.entries(LEXICON)) for (const w of words.split(" ")) nb.add(w, cat, 1);
  for (const c of CATEGORIES) if (LEXICON[c.id]) for (const r of c.rules) nb.add(r, c.id, 1);
  const seen = new Set();
  for (const t of txs) {
    if (t.amount <= 0 || seen.has(t.merchant ?? merchantKey(t.desc))) continue;
    const r = ruleMatch(t.desc, t.amount);
    if (r && LEXICON[r]) { nb.add(t.desc, r, 0.5); seen.add(t.merchant ?? merchantKey(t.desc)); }
  }
  for (const [merchant, cat] of Object.entries(overrides)) nb.add(merchant, cat, 6);
  return nb;
}

export const THRESHOLD = 0.55;

/**
 * Category for every transaction with where it came from:
 *   "you" (a correction), "rule" (a known brand), "model" (learned, confident), "unsure".
 * Unsure lines are filed under "other" with the model's best guesses attached.
 */
export function classify(txs, overrides = {}, nb = train(txs, overrides)) {
  const cache = new Map();
  return txs.map((t) => {
    const merchant = t.merchant ?? merchantKey(t.desc);
    const base = { ...t, merchant };
    if (overrides[merchant]) return { ...base, cat: overrides[merchant], source: "you", conf: 1 };
    const r = ruleMatch(t.desc, t.amount);
    if (r) return { ...base, cat: r, source: "rule", conf: 1 };
    if (t.amount < 0) return { ...base, cat: "income", source: "rule", conf: 0.6 };
    if (!cache.has(t.desc)) cache.set(t.desc, nb.predict(t.desc));
    const ps = cache.get(t.desc);
    const top = ps[0];
    return top.p >= THRESHOLD
      ? { ...base, cat: top.cat, source: "model", conf: top.p, alt: ps.slice(0, 3) }
      : { ...base, cat: "other", source: "unsure", conf: top.p, alt: ps.slice(0, 3) };
  });
}

/** Merchants worth asking about: unsure or learned, most money first, least sure first. */
export function reviewQueue(classified, skipped = new Set()) {
  const by = new Map();
  for (const t of classified) {
    if (!["unsure", "model"].includes(t.source) || t.amount <= 0 || skipped.has(t.merchant)) continue;
    const g = by.get(t.merchant) || { merchant: t.merchant, desc: t.desc, amount: 0, count: 0, conf: t.conf, alt: t.alt, cat: t.cat, source: t.source };
    g.amount += t.amount; g.count += 1;
    by.set(t.merchant, g);
  }
  return [...by.values()].sort((a, b) => b.amount * (1 - b.conf) - a.amount * (1 - a.conf));
}
