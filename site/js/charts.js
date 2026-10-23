// Small SVG charts with hover tooltips: line + band, stacked monthly bars, histogram.
// Colors are CSS variables (passed as "--name"), so light and dark themes switch without redrawing.

const NS = "http://www.w3.org/2000/svg";
const renders = [];
let rz;
addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => renders.forEach((r) => r.isConnected() && r.draw()), 150); });

export const nf = (d = 0) => new Intl.NumberFormat("tr-TR", { maximumFractionDigits: d, minimumFractionDigits: d });
export const fmt = (v, d = 0) => (v == null || !isFinite(v) ? "–" : nf(d).format(v));
export const TL = (v) => fmt(v) + " TL";
/** 1.234.567 -> "1,2 mn" for axes */
export const short = (v) => {
  const a = Math.abs(v);
  if (a >= 1e9) return fmt(v / 1e9, 1) + " milyar";
  if (a >= 1e6) return fmt(v / 1e6, a >= 1e7 ? 0 : 1) + " milyon";
  if (a >= 1e3) return fmt(v / 1e3, a >= 1e4 ? 0 : 1) + " bin";
  return fmt(v);
};

export function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

export function niceTicks(lo, hi, n = 4) {
  if (!isFinite(lo) || !isFinite(hi)) { lo = 0; hi = 1; }
  if (lo === hi) { lo -= 1; hi += 1; }
  const step0 = (hi - lo) / n;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0);
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return { ticks: out, lo: Math.min(lo, out[0]), hi: Math.max(hi, out[out.length - 1]) };
}

function tipBox(host) {
  let t = host.querySelector(".tip");
  if (!t) { t = document.createElement("div"); t.className = "tip"; host.appendChild(t); }
  return t;
}

function showTip(host, tip, x, y, title, rows) {
  tip.innerHTML = `<b>${title}</b>` + rows.map((r) =>
    `<div class="row"><span>${r.color ? `<i class="sw" style="background:var(${r.color})"></i>` : ""}${r.label}</span><span>${r.value}</span></div>`).join("");
  tip.style.display = "block";
  const w = host.clientWidth, tw = tip.offsetWidth;
  tip.style.left = Math.min(Math.max(0, x + 14), w - tw) + "px";
  tip.style.top = Math.max(0, y - 10) + "px";
}

function mount(host, draw) {
  host._render = { draw, isConnected: () => host.isConnected };
  const i = renders.findIndex((r) => r.host === host);
  if (i >= 0) renders.splice(i, 1);
  renders.push({ host, ...host._render });
  draw();
}

/** Redraw every chart (after a hidden tab becomes visible). */
export const redrawAll = () => renders.forEach((r) => r.draw());

/**
 * Line chart. series: {kind: "line"|"band", y | lo+hi, color, width, dash, label, fmt}
 * sharing one x array. Tooltip at the nearest x.
 */
export function lineChart(host, o) {
  mount(host, () => {
    host.innerHTML = "";
    const W = host.clientWidth || 600, H = o.height || 280, m = { l: 56, r: 12, t: 10, b: 26 };
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, height: H, role: "img", "aria-label": o.aria || "" }, host);
    const x = o.x, ys = o.series.flatMap((s) => (s.kind === "band" ? [...s.lo, ...s.hi] : s.y)).filter(Number.isFinite);
    const x0 = x[0], x1 = x[x.length - 1];
    const yt = niceTicks(Math.min(o.zero ? 0 : Infinity, ...ys), Math.max(...ys), 4);
    const X = (v) => m.l + ((v - x0) / (x1 - x0 || 1)) * (W - m.l - m.r);
    const Y = (v) => m.t + (1 - (v - yt.lo) / (yt.hi - yt.lo)) * (H - m.t - m.b);
    for (const v of yt.ticks) {
      el("line", { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), style: `stroke:var(${v === 0 ? "--axis" : "--grid"})` }, svg);
      el("text", { x: m.l - 8, y: Y(v) + 4, "text-anchor": "end" }, svg).textContent = (o.yfmt || short)(v);
    }
    const every = Math.max(1, Math.ceil(x.length / (W < 520 ? 4 : 8)));
    x.forEach((v, i) => { if (i % every === 0 || i === x.length - 1) el("text", { x: X(v), y: H - 6, "text-anchor": "middle" }, svg).textContent = (o.xfmt || fmt)(v); });
    for (const s of o.series) {
      if (s.kind === "band") {
        const d = "M" + x.map((v, i) => `${X(v)},${Y(s.hi[i])}`).join("L") + "L" + x.map((v, i) => `${X(v)},${Y(s.lo[i])}`).reverse().join("L") + "Z";
        el("path", { d, style: `fill:var(${s.color})` }, svg);
      } else {
        el("path", { d: "M" + x.map((v, i) => `${X(v).toFixed(1)},${Y(s.y[i]).toFixed(1)}`).join("L"), fill: "none", style: `stroke:var(${s.color})`, "stroke-width": s.width || 2.5, "stroke-dasharray": s.dash ? "4 4" : "none", "stroke-linejoin": "round" }, svg);
      }
    }
    const tip = tipBox(host);
    const cross = el("line", { y1: m.t, y2: H - m.b, style: "stroke:var(--axis)", visibility: "hidden" }, svg);
    const lines = o.series.filter((s) => s.kind !== "band");
    const dots = lines.map((s) => el("circle", { r: 4, style: `fill:var(${s.color});stroke:var(--surface)`, "stroke-width": 2, visibility: "hidden" }, svg));
    const hit = el("rect", { x: m.l, y: 0, width: W - m.l - m.r, height: H, fill: "transparent" }, svg);
    hit.addEventListener("pointermove", (ev) => {
      const r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) * (W / r.width);
      const xv = x0 + ((px - m.l) / (W - m.l - m.r)) * (x1 - x0);
      let i = 0; x.forEach((v, k) => { if (Math.abs(v - xv) < Math.abs(x[i] - xv)) i = k; });
      cross.setAttribute("x1", X(x[i])); cross.setAttribute("x2", X(x[i])); cross.setAttribute("visibility", "visible");
      const rows = [];
      o.series.forEach((s) => {
        if (s.kind === "band") { if (s.label) rows.push({ label: s.label, value: `${(s.fmt || TL)(s.lo[i])} – ${(s.fmt || TL)(s.hi[i])}`, color: s.color }); }
        else rows.push({ label: s.label, value: (s.fmt || TL)(s.y[i]), color: s.color });
      });
      lines.forEach((s, k) => { dots[k].setAttribute("cx", X(x[i])); dots[k].setAttribute("cy", Y(s.y[i])); dots[k].setAttribute("visibility", "visible"); });
      showTip(host, tip, (X(x[i]) * r.width) / W, ev.clientY - r.top, (o.tipTitle || o.xfmt || fmt)(x[i]), rows);
    });
    hit.addEventListener("pointerleave", () => { tip.style.display = "none"; cross.setAttribute("visibility", "hidden"); dots.forEach((d) => d.setAttribute("visibility", "hidden")); });
  });
}

/** Stacked vertical bars: labels[], groups [{label, color, values}] (positive values). */
export function stackedBars(host, o) {
  mount(host, () => {
    host.innerHTML = "";
    const W = host.clientWidth || 600, H = o.height || 260, m = { l: 52, r: 8, t: 10, b: 26 };
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, height: H, role: "img", "aria-label": o.aria || "" }, host);
    const n = o.labels.length;
    const tot = o.labels.map((_, i) => o.groups.reduce((s, g) => s + Math.max(0, g.values[i]), 0));
    const yt = niceTicks(0, Math.max(...tot), 4);
    const Y = (v) => m.t + (1 - (v - yt.lo) / (yt.hi - yt.lo)) * (H - m.t - m.b);
    const bw = (W - m.l - m.r) / n;
    for (const v of yt.ticks) {
      el("line", { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), style: `stroke:var(${v === 0 ? "--axis" : "--grid"})` }, svg);
      el("text", { x: m.l - 8, y: Y(v) + 4, "text-anchor": "end" }, svg).textContent = short(v);
    }
    const tip = tipBox(host);
    const every = Math.max(1, Math.ceil(n / (W < 520 ? 4 : 12)));
    for (let i = 0; i < n; i++) {
      if (i % every === 0) el("text", { x: m.l + bw * (i + 0.5), y: H - 6, "text-anchor": "middle" }, svg).textContent = o.labels[i];
      let acc = 0;
      const x = m.l + bw * i + Math.min(6, bw * 0.15), w = Math.max(2, bw - 2 * Math.min(6, bw * 0.15));
      o.groups.forEach((g, k) => {
        const v = Math.max(0, g.values[i]);
        if (!v) return;
        const top = k === o.groups.length - 1 || o.groups.slice(k + 1).every((h) => !(h.values[i] > 0));
        const y = Y(acc + v), h = Y(acc) - Y(acc + v);
        el("rect", { x, y, width: w, height: Math.max(0.5, h), rx: top ? 3 : 0, style: `fill:var(${g.color});stroke:var(--surface)`, "stroke-width": 1 }, svg);
        acc += v;
      });
      const hit = el("rect", { x: m.l + bw * i, y: m.t, width: bw, height: H - m.t - m.b, fill: "transparent" }, svg);
      hit.addEventListener("pointermove", (ev) => {
        const r = svg.getBoundingClientRect();
        const rows = o.groups.map((g) => ({ label: g.label, value: TL(g.values[i]), color: g.color, v: g.values[i] }))
          .filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
        rows.push({ label: "Toplam", value: TL(tot[i]) });
        showTip(host, tip, ((m.l + bw * (i + 0.5)) * r.width) / W, ev.clientY - r.top, o.tipLabels?.[i] ?? o.labels[i], rows);
      });
      hit.addEventListener("pointerleave", () => (tip.style.display = "none"));
    }
  });
}

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Count a number up to its value (respects reduced motion). */
export function countUp(node, value, format = (v) => fmt(v)) {
  if (reduced() || !isFinite(value)) { node.textContent = format(value); return; }
  const t0 = performance.now(), dur = 900;
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    node.textContent = format(value * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** Tiny trend line with a soft fill. */
export function sparkline(values, color = "--blue") {
  const W = 200, H = 34, n = values.length;
  if (n < 2) return "";
  const lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1;
  const pts = values.map((v, i) => [(i / (n - 1)) * W, H - 3 - ((v - lo) / span) * (H - 6)]);
  const d = "M" + pts.map((p) => p.map((x) => x.toFixed(1)).join(",")).join("L");
  const id = "sg" + Math.random().toString(36).slice(2, 8);
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(${color})" stop-opacity=".35"/><stop offset="1" stop-color="var(${color})" stop-opacity="0"/></linearGradient></defs>
    <path d="${d}L${W},${H}L0,${H}Z" fill="url(#${id})"/><path d="${d}" fill="none" stroke="var(${color})" stroke-width="1.8" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
    <circle cx="${pts[n - 1][0]}" cy="${pts[n - 1][1]}" r="2.6" fill="var(${color})"/></svg>`;
}

/**
 * Money flow: one source on the left (income) splitting into targets on the right (categories,
 * savings). Band widths are proportional to amounts; hover a band for its numbers.
 */
export function sankey(host, o) {
  mount(host, () => {
    host.innerHTML = "";
    const W = host.clientWidth || 800, narrow = W < 560;
    const targets = o.targets.filter((t) => t.value > 0);
    const total = targets.reduce((s, t) => s + t.value, 0);
    const gap = narrow ? 5 : 8, labelW = narrow ? 118 : Math.min(230, W * 0.28);
    const H = Math.max(narrow ? 320 : 360, targets.length * (narrow ? 34 : 38));
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, height: H, role: "img", "aria-label": o.aria || "" }, host);
    const defs = el("defs", {}, svg);
    const avail = H - gap * (targets.length - 1);
    const scale = avail / total;
    const xL = narrow ? 0 : 120, nodeW = 12, xR = W - labelW - nodeW;
    // left node
    const srcH = total * scale;
    el("rect", { x: xL, y: 0, width: nodeW, height: srcH, rx: 4, style: "fill:var(--ink);opacity:.9" }, svg);
    if (!narrow) {
      el("text", { x: xL - 12, y: srcH / 2 - 4, "text-anchor": "end", style: "fill:var(--ink);font-size:14px;font-weight:600" }, svg).textContent = o.source.label;
      el("text", { x: xL - 12, y: srcH / 2 + 14, "text-anchor": "end" }, svg).textContent = short(o.source.value) + " TL";
    }
    const tip = tipBox(host);
    // label positions: centred on their node, but never closer than one line to the previous one
    const lineH = narrow ? 17 : 19;
    let yy = 0;
    const labelY = targets.map((t) => { const h = t.value * scale, c = yy + h / 2; yy += h + gap; return c; });
    for (let i = 1; i < labelY.length; i++) labelY[i] = Math.max(labelY[i], labelY[i - 1] + lineH + (targets[i - 1].value * scale > 26 ? 14 : 0));
    let yL = 0, yR = 0;
    targets.forEach((t, i) => {
      const h = t.value * scale;
      const gid = `fl${i}`;
      const lg = el("linearGradient", { id: gid, x1: "0", x2: "1" }, defs);
      el("stop", { offset: "0", "stop-color": "var(--ink)", "stop-opacity": ".10" }, lg);
      el("stop", { offset: "1", "stop-color": `var(${t.color})`, "stop-opacity": ".55" }, lg);
      const x0 = xL + nodeW, x1 = xR, c = (x1 - x0) * 0.5;
      const d = `M${x0},${yL} C${x0 + c},${yL} ${x1 - c},${yR} ${x1},${yR} L${x1},${yR + h} C${x1 - c},${yR + h} ${x0 + c},${yL + h} ${x0},${yL + h} Z`;
      const band = el("path", { d, fill: `url(#${gid})`, style: `opacity:0;transition:opacity .6s ${0.05 * i}s, filter .2s` }, svg);
      requestAnimationFrame(() => (band.style.opacity = 1));
      el("rect", { x: xR, y: yR, width: nodeW, height: Math.max(2, h), rx: 3, style: `fill:var(${t.color})` }, svg);
      const ty = labelY[i];
      el("text", { x: xR + nodeW + 10, y: ty - (h > 26 ? 3 : -4), style: "fill:var(--ink);font-size:13px;font-weight:550" }, svg).textContent = t.label;
      if (h > 26) el("text", { x: xR + nodeW + 10, y: ty + 13 }, svg).textContent = `${short(t.value)} TL · %${fmt((t.value / total) * 100)}`;
      band.addEventListener("pointermove", (ev) => {
        const r = svg.getBoundingClientRect();
        band.style.filter = "brightness(1.35)";
        showTip(host, tip, ev.clientX - r.left, ev.clientY - r.top, t.label, [{ label: o.unit || "Aylık", value: TL(t.value), color: t.color }, { label: "Pay", value: `%${fmt((t.value / total) * 100, 1)}` }]);
      });
      band.addEventListener("pointerleave", () => { band.style.filter = ""; tip.style.display = "none"; });
      yL += h; yR += h + gap;
    });
  });
}

/** Donut of shares with a hover readout in the middle. items: [{label, value, color}] */
export function ring(host, o) {
  mount(host, () => {
    host.innerHTML = "";
    const S = Math.min(230, host.clientWidth || 230), r = S / 2 - 14, th = 20, cx = S / 2, cy = S / 2;
    const svg = el("svg", { viewBox: `0 0 ${S} ${S}`, width: S, height: S, role: "img", "aria-label": o.aria || "" }, host);
    const total = o.items.reduce((s, x) => s + x.value, 0);
    const C = 2 * Math.PI * r;
    el("circle", { cx, cy, r, fill: "none", style: "stroke:var(--grid)", "stroke-width": th }, svg);
    const label = el("text", { x: cx, y: cy - 4, "text-anchor": "middle", style: "fill:var(--ink);font-size:22px;font-weight:700;letter-spacing:-.02em" }, svg);
    const sub = el("text", { x: cx, y: cy + 16, "text-anchor": "middle", style: "fill:var(--muted);font-size:11.5px" }, svg);
    const reset = () => { label.textContent = short(o.total ?? total); sub.textContent = o.caption || "toplam"; };
    reset();
    let acc = 0;
    o.items.forEach((x, i) => {
      const len = (x.value / total) * C;
      const seg = el("circle", {
        cx, cy, r, fill: "none", "stroke-width": th, "stroke-linecap": "butt",
        "stroke-dasharray": `${Math.max(0, len - 2.5)} ${C}`, "stroke-dashoffset": -acc,
        transform: `rotate(-90 ${cx} ${cy})`, style: `stroke:var(${x.color});transition:stroke-width .2s, opacity .3s;opacity:0`,
      }, svg);
      setTimeout(() => (seg.style.opacity = 1), reduced() ? 0 : 40 * i);
      seg.addEventListener("pointerenter", () => { seg.setAttribute("stroke-width", th + 6); label.textContent = `%${fmt((x.value / total) * 100)}`; sub.textContent = x.label; o.onHover?.(x); });
      seg.addEventListener("pointerleave", () => { seg.setAttribute("stroke-width", th); reset(); o.onHover?.(null); });
      seg.addEventListener("click", () => o.onClick?.(x));
      acc += len;
    });
  });
}

/** A low–high range with a dot at the middle value, on a shared scale. */
export function rangeSVG(lo, mid, hi, max, color = "--blue") {
  const W = 300, X = (v) => 4 + (Math.max(0, v) / max) * (W - 8);
  return `<svg viewBox="0 0 ${W} 16" preserveAspectRatio="none" aria-hidden="true">
    <line x1="4" x2="${W - 4}" y1="8" y2="8" stroke="var(--grid)" stroke-width="2" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    <line x1="${X(lo)}" x2="${X(hi)}" y1="8" y2="8" stroke="var(${color})" stroke-opacity=".45" stroke-width="8" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    <circle cx="${X(mid)}" cy="8" r="5" fill="var(${color})" stroke="var(--surface)" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
}

/** Probability as a ring that fills; the number sits in the middle. */
export function gauge(p, label) {
  const S = 180, r = 74, C = 2 * Math.PI * r, id = "gg" + Math.random().toString(36).slice(2, 7);
  return `<svg viewBox="0 0 ${S} ${S}" width="${S}" height="${S}" role="img" aria-label="${label}: %${fmt(p * 100)}">
    <defs><linearGradient id="${id}" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="var(--mint)"/><stop offset=".5" stop-color="var(--blue)"/><stop offset="1" stop-color="var(--violet)"/></linearGradient></defs>
    <circle cx="90" cy="90" r="${r}" fill="none" stroke="var(--grid)" stroke-width="12"/>
    <circle cx="90" cy="90" r="${r}" fill="none" stroke="url(#${id})" stroke-width="12" stroke-linecap="round" transform="rotate(-90 90 90)"
      stroke-dasharray="${C}" stroke-dashoffset="${C}" style="transition:stroke-dashoffset 1.1s cubic-bezier(.2,.8,.2,1)" data-target="${C * (1 - p)}"/>
    <text x="90" y="92" text-anchor="middle" style="fill:var(--ink);font:700 38px var(--display);letter-spacing:-.04em">%${fmt(p * 100)}</text>
    <text x="90" y="116" text-anchor="middle" style="fill:var(--muted);font-size:12px">${label}</text></svg>`;
}
/** Start gauge animations inside a container (after it is in the DOM). */
export function animateGauges(root) {
  root.querySelectorAll("[data-target]").forEach((c) => requestAnimationFrame(() => requestAnimationFrame(() => c.setAttribute("stroke-dashoffset", c.dataset.target))));
}

/** Histogram of values with a marker at zero; bars left of zero and right of zero get two colors. */
export function histogram(host, o) {
  mount(host, () => {
    host.innerHTML = "";
    const W = host.clientWidth || 500, H = o.height || 220, m = { l: 36, r: 10, t: 10, b: 26 };
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, height: H, role: "img", "aria-label": o.aria || "" }, host);
    const v = o.values;
    const lo = v[Math.floor(v.length * 0.01)], hi = v[Math.ceil(v.length * 0.99) - 1];
    const bins = o.bins || 30, step = (hi - lo) / bins || 1;
    const counts = Array(bins).fill(0);
    for (const x of v) { const k = Math.min(bins - 1, Math.max(0, Math.floor((x - lo) / step))); counts[k]++; }
    const maxC = Math.max(...counts);
    const X = (x) => m.l + ((x - lo) / (hi - lo || 1)) * (W - m.l - m.r);
    const Y = (c) => m.t + (1 - c / maxC) * (H - m.t - m.b);
    el("line", { x1: m.l, x2: W - m.r, y1: Y(0), y2: Y(0), style: "stroke:var(--axis)" }, svg);
    const xt = niceTicks(lo, hi, W < 520 ? 3 : 5).ticks.filter((t) => t >= lo && t <= hi);
    for (const t of xt) el("text", { x: X(t), y: H - 6, "text-anchor": "middle" }, svg).textContent = short(t);
    const tip = tipBox(host);
    counts.forEach((c, k) => {
      const a = lo + k * step, b = a + step;
      const x = X(a) + 1, w = Math.max(1, X(b) - X(a) - 2);
      const color = (a + b) / 2 >= 0 ? o.pos : o.neg;
      if (c) el("rect", { x, y: Y(c), width: w, height: Y(0) - Y(c), rx: 2, style: `fill:var(${color})` }, svg);
      const hit = el("rect", { x: X(a), y: m.t, width: X(b) - X(a), height: H - m.t - m.b, fill: "transparent" }, svg);
      hit.addEventListener("pointermove", (ev) => {
        const r = svg.getBoundingClientRect();
        showTip(host, tip, ev.clientX - r.left, ev.clientY - r.top, `${short(a)} – ${short(b)} TL`, [{ label: "Senaryo", value: `${c} (%${fmt((c / v.length) * 100, 1)})` }]);
      });
      hit.addEventListener("pointerleave", () => (tip.style.display = "none"));
    });
    if (lo < 0 && hi > 0) {
      el("line", { x1: X(0), x2: X(0), y1: m.t, y2: Y(0), style: "stroke:var(--ink)", "stroke-width": 1.5, "stroke-dasharray": "3 3" }, svg);
      el("text", { x: X(0) + 4, y: m.t + 10, style: "fill:var(--ink-2)" }, svg).textContent = "eşit";
    }
  });
}
