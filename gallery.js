'use strict';

/* ============================================================
   Twenty representations of the patrol paper. Self-contained:
   re-implements the model for K = 3 (paper's §12 instance).
   Styles come from learn.css.
   ============================================================ */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const sum = a => a.reduce((s, x) => s + x, 0);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const NAMES = ['High', 'Medium', 'Low'], SH = ['H', 'M', 'L'];
const COL = k => `var(--c${k})`, SOFT = k => `var(--c${k}-soft)`;
const PLAN_COL = ['var(--accent)', '#6250d6', '#008300', '#9a5b00'];

function fmt(x, d = 2) {
  if (!Number.isFinite(x)) return '—';
  const s = x.toFixed(d);
  return /^-0\.?0*$/.test(s) ? s.slice(1) : s;
}
const sgn = (x, d = 2) => (x > 0.5 * 10 ** -d ? '+' : '') + fmt(x, d);
const pct = (x, d = 0) => `${fmt(100 * x, d)}%`;
const hhmm = t => { const m = Math.round(t * 60); return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
const dayTime = t => `day ${Math.floor(t / 24) + 1}, ${hhmm(t % 24)}`;

/* ---------------- model ---------------- */

const PAPER = { N: 22, Tdays: 30, tp: 3, ts: 6, tr: 0, F: 55, n: [4, 3, 3], v: [30, 20, 10] };
function derive(p) {
  const T = p.Tdays * 24, W = p.tp + p.ts, mu = W / p.tp, G = p.tp + p.tr, B = p.N * p.F;
  const Nsrt = Math.floor(B / p.tp + 1e-9), Beff = Nsrt * p.tp, Nb = sum(p.n);
  return { T, W, mu, G, B, Nsrt, Beff, Nb };
}
const cover = (p, d, k, h) => (d.mu * h) / (p.n[k] * d.T);
const utilOf = (p, d, k, h) => p.v[k] * (2 * Math.min(1, cover(p, d, k, h)) - 1);
function stage1(p, d) {
  const dk = p.n.map((n, k) => (n * d.T) / (2 * d.mu * p.v[k]));
  let active = [0, 1, 2], z = 0, h = [0, 0, 0];
  while (active.length) {
    z = (d.Beff - (d.T * sum(active.map(k => p.n[k]))) / (2 * d.mu)) / sum(active.map(k => dk[k]));
    h = [0, 0, 0];
    active.forEach(k => { h[k] = dk[k] * (z + p.v[k]); });
    const neg = active.filter(k => h[k] < -1e-9);
    if (!neg.length) break;
    active = active.filter(k => !neg.includes(k));
  }
  h = h.map((x, k) => (active.includes(k) ? Math.max(0, x) : 0));
  const P = h.map((x, k) => cover(p, d, k, x));
  return { dk, z, h, P, U: P.map((x, k) => p.v[k] * (2 * x - 1)), active };
}
function floorCeilMix(mStar) {
  const fl = mStar.map(x => Math.floor(x + 1e-9));
  const fr = mStar.map((x, k) => { const f = x - fl[k]; return f < 1e-9 ? 0 : f; });
  const cum = [0]; fr.forEach(f => cum.push(cum[cum.length - 1] + f));
  const r = Math.round(cum[cum.length - 1]);
  if (r === 0) return { fl, plans: [{ m: fl.slice(), s: 1 }] };
  const bps = [...new Set([0, 1, ...cum.map(c => +(c - Math.floor(c + 1e-12)).toFixed(12))])].filter(x => x >= 0 && x <= 1).sort((a, b) => a - b);
  const plans = [];
  for (let i = 0; i + 1 < bps.length; i++) {
    const a = bps[i], b = bps[i + 1]; if (b - a < 1e-12) continue;
    const u = (a + b) / 2, m = fl.slice();
    for (let k = 0; k < 3; k++) for (let t = 0; t < r; t++) if (cum[k] <= u + t && u + t < cum[k + 1]) m[k]++;
    const ex = plans.find(pl => pl.m.join() === m.join());
    if (ex) ex.s += b - a; else plans.push({ m, s: b - a });
  }
  return { fl, plans };
}
function rngSeed(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function buildPlan(p, d, m, rand) {
  const bars = [], ev = [];
  for (let k = 0; k < 3; k++) {
    const nk = p.n[k], base = Math.floor(m[k] / nk), rem = m[k] - base * nk;
    for (let i = 0; i < nk; i++) {
      const q = base + (i < rem ? 1 : 0), delta = q ? d.T / q : null, span = q ? delta - d.W : 0;
      const phi = q && span > 1e-9 ? rand() * span : 0, starts = [];
      for (let j = 0; j < q; j++) { starts.push(phi + j * delta); ev.push({ k, i, b: bars.length, t: phi + j * delta }); }
      bars.push({ k, i, q, delta, p: q ? Math.min(1, (d.W * q) / d.T) : 0, phi, starts });
    }
  }
  ev.sort((a, b) => a.t - b.t);
  const ac = Array.from({ length: p.N }, () => ({ next: -Infinity, hours: 0 }));
  let ptr = 0;
  ev.forEach(e => {
    e.ac = null;
    for (let s = 0; s < p.N; s++) {
      const idx = (ptr + s) % p.N, a = ac[idx];
      if (e.t + 1e-9 >= a.next && a.hours + p.tp <= p.F + 1e-9) { a.next = e.t + d.G; a.hours += p.tp; e.ac = idx; ptr = (idx + 1) % p.N; return; }
    }
  });
  return { bars, ev, ac, unassigned: ev.filter(e => e.ac === null).length };
}
function baselines(p, d, s1) {
  const n = p.n, v = p.v, Nsrt = d.Nsrt, tp = p.tp;
  const ev = h => { const U = h.map((x, k) => utilOf(p, d, k, x)); return { h, U, game: Math.min(...U) }; };
  const base = Math.floor(Nsrt / d.Nb); let left = Nsrt - base * d.Nb, t = 0, g = 0; const extra = [0, 0, 0];
  while (left > 0 && g++ < 1000) { if (extra[t] < n[t]) { extra[t]++; left--; } t = (t + 1) % 3; }
  const hEq = n.map((nk, k) => (nk * base + extra[k]) * tp);
  const w = n.map((nk, k) => nk * v[k]), tw = sum(w);
  const mVp = [Math.floor((Nsrt * w[0]) / tw), Math.floor((Nsrt * w[1]) / tw), 0]; mVp[2] = Nsrt - mVp[0] - mVp[1];
  let budget = d.Beff; const hG = [0, 0, 0];
  [0, 1, 2].sort((a, b) => v[b] - v[a]).forEach(k => { const full = (n[k] * d.T) / d.mu; hG[k] = Math.max(0, Math.min(full, budget)); budget -= hG[k]; });
  const fu = v.map(x => -x);
  return [
    { name: 'Fixed deterministic', h: hEq, U: fu, game: Math.min(...fu) },
    { name: 'Uniform random', ...ev(hEq) },
    { name: 'Value-proportional', ...ev(mVp.map(m => m * tp)) },
    { name: 'Greedy (high value first)', ...ev(hG) },
    { name: 'Stackelberg optimal', h: s1.h, U: s1.U, game: Math.min(...s1.U) },
  ];
}

const P = PAPER, D = derive(P), S1 = stage1(P, D), MSTAR = S1.h.map(h => h / P.tp), MIX = floorCeilMix(MSTAR);
MIX.plans.forEach((pl, j) => { pl.label = String.fromCharCode(65 + j); });
const PLAN = buildPlan(P, D, MIX.plans[0].m, rngSeed(7));
const BAR_LABEL = b => `${SH[b.k]}${b.i + 1}`;
function maxSaneN() { let best = 1; for (let N = 1; N <= 300; N++) { const p = { ...P, N }, s = stage1(p, derive(p)); if (Math.max(...s.P) <= 1 + 1e-9) best = N; else break; } return best; }

/* ---------------- drawing helpers ---------------- */

function niceTicks(a, b, n = 5) {
  const raw = (b - a) / n, mag = 10 ** Math.floor(Math.log10(raw)), r = raw / mag;
  const step = (r < 1.5 ? 1 : r < 3 ? 2 : r < 7 ? 5 : 10) * mag, out = [];
  for (let x = Math.ceil(a / step) * step; x <= b + 1e-9; x += step) out.push(+x.toFixed(10));
  return out;
}
function frame(o) {
  const sx = v => o.ml + ((v - o.x0) / (o.x1 - o.x0)) * (o.W - o.ml - o.mr);
  const sy = v => o.H - o.mb - ((v - o.y0) / (o.y1 - o.y0)) * (o.H - o.mt - o.mb);
  let s = '';
  (o.yt || []).forEach(t => { s += `<line class="grid" x1="${o.ml}" x2="${o.W - o.mr}" y1="${sy(t)}" y2="${sy(t)}"/><text x="${o.ml - 6}" y="${sy(t) + 4}" text-anchor="end">${(o.yf || String)(t)}</text>`; });
  (o.xt || []).forEach(t => { s += `<text x="${sx(t)}" y="${o.H - o.mb + 15}" text-anchor="middle">${(o.xf || String)(t)}</text>`; });
  s += `<line class="axis" x1="${o.ml}" x2="${o.W - o.mr}" y1="${o.H - o.mb}" y2="${o.H - o.mb}"/>`;
  if (o.xl) s += `<text x="${(o.ml + o.W - o.mr) / 2}" y="${o.H - 4}" text-anchor="middle">${o.xl}</text>`;
  if (o.yl) s += `<text x="12" y="${(o.mt + o.H - o.mb) / 2}" text-anchor="middle" transform="rotate(-90 12 ${(o.mt + o.H - o.mb) / 2})">${o.yl}</text>`;
  return { sx, sy, s };
}
const svgWrap = (W, H, body, label) => `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">${body}</svg></div>`;
const poly = (pts, attrs) => `<polyline fill="none" points="${pts.map(p => p.map(v => +v.toFixed(2)).join(',')).join(' ')}" ${attrs}/>`;
const tip = s => `data-tip="${String(s).replace(/"/g, '&quot;')}"`;
const legend = items => `<div class="legend">${items.map(([c, l]) => `<span><i style="background:${c}"></i>${l}</span>`).join('')}</div>`;
function mixRGB(a, b, t) { return `rgb(${a.map((x, i) => Math.round(x + (b[i] - x) * clamp(t, 0, 1))).join(',')})`; }
const RED = [214, 69, 69], MID = [196, 199, 206], BLUE = [42, 120, 214], PALE = [226, 234, 248], DEEP = [20, 70, 150];
const diverge = (x, m) => (x < 0 ? mixRGB(MID, RED, -x / m) : mixRGB(MID, BLUE, x / m));
const seq = t => mixRGB(PALE, DEEP, t);
function seg(el, items, cur, onPick) {
  el.innerHTML = items.map(([v, l]) => `<button data-v="${v}" class="${v === cur ? 'on' : ''}">${l}</button>`).join('');
  el.onclick = e => { const b = e.target.closest('button'); if (!b) return; $$('button', el).forEach(x => x.classList.toggle('on', x === b)); onPick(b.dataset.v); };
}

/* ============================================================
   The twenty cards
   ============================================================ */

const CARDS = [];
const card = (form, title, shows, why, sec, render) => CARDS.push({ form, title, shows, why, sec, render });

/* 1 — Sankey */
card('Sankey diagram', 'Where every flying hour goes', 'Budget B → usable B<sub>eff</sub> → barrier types (h*) → individual barriers', 'Conservation is visible: band widths always add up, so you can see the 1 h lost to whole-sortie rounding (Remark 1) and that hours split nearly evenly despite very different values.', '§2, §5', el => {
  const W = 760, H = 380, nw = 14, top = 24;
  const cols = [30, 230, 430, 640];
  const gaps = [0, 10, 18, 6];
  const k = (H - top - 20 - 9 * gaps[3]) / D.B;
  const nodes = [];
  const add = (col, label, val, color) => { nodes.push({ col, label, val, color, h: Math.max(1.5, val * k) }); return nodes.length - 1; };
  const nB = add(0, `Fleet hours B = ${D.B} h`, D.B, 'var(--text-2)');
  const nE = add(1, `Usable B<tspan font-size="9" dy="3">eff</tspan><tspan dy="-3"> = ${D.Beff} h</tspan>`, D.Beff, 'var(--accent)');
  const nW = add(1, `Rounding loss ${fmt(D.B - D.Beff, 0)} h`, D.B - D.Beff, 'var(--bad)');
  const nT = [0, 1, 2].map(t => add(2, `${NAMES[t]}: ${fmt(S1.h[t], 1)} h`, S1.h[t], COL(t)));
  const nBar = [];
  [0, 1, 2].forEach(t => { for (let i = 0; i < P.n[t]; i++) nBar.push(add(3, `${SH[t]}${i + 1}: ${fmt(S1.h[t] / P.n[t], 1)} h`, S1.h[t] / P.n[t], COL(t))); });
  [0, 1, 2, 3].forEach(c => { let y = top; nodes.filter(n => n.col === c).forEach(n => { n.y = y; n.inO = 0; n.outO = 0; y += n.h + gaps[c]; }); });
  const links = [[nB, nE, D.Beff, 'var(--accent)'], [nB, nW, D.B - D.Beff, 'var(--bad)']];
  nT.forEach((t, i) => links.push([nE, t, S1.h[i], COL(i)]));
  let bi = 0; [0, 1, 2].forEach(t => { for (let i = 0; i < P.n[t]; i++) links.push([nT[t], nBar[bi++], S1.h[t] / P.n[t], COL(t)]); });
  let b = '';
  links.forEach(([s, t, v, c]) => {
    const S = nodes[s], Tn = nodes[t], w = Math.max(1, v * k);
    const x0 = cols[S.col] + nw, x1 = cols[Tn.col], y0 = S.y + S.outO, y1 = Tn.y + Tn.inO, xm = (x0 + x1) / 2;
    S.outO += w; Tn.inO += w;
    b += `<path d="M${x0},${y0} C${xm},${y0} ${xm},${y1} ${x1},${y1} L${x1},${y1 + w} C${xm},${y1 + w} ${xm},${y0 + w} ${x0},${y0 + w} Z" fill="${c}" fill-opacity=".28" ${tip(`${fmt(v, 1)} flying hours`)}/>`;
  });
  nodes.forEach(n => {
    b += `<rect x="${cols[n.col]}" y="${n.y}" width="${nw}" height="${n.h}" fill="${n.color}" rx="2"/>`;
    const lx = n.col === 3 ? cols[3] + nw + 6 : n.col === 0 ? cols[0] + nw + 6 : cols[n.col] + nw + 6;
    b += `<text x="${lx}" y="${n.y + n.h / 2 + 4}" class="lbl-strong" font-size="${n.col === 3 ? 10 : 11}">${n.label}</text>`;
  });
  el.innerHTML = svgWrap(W, H, b, 'Sankey of flying hours');
});

/* 2 — Bullet chart */
card('Bullet chart', 'Is the budget big enough?', 'B<sub>eff</sub> against the two thresholds that decide everything: 50% coverage (z* = 0) and full coverage', 'One bar against qualitative bands answers “where do we stand?” at a glance, the way a fuel gauge does. Remark 4 and §8 become a single picture.', '§5 Remark 4, §8', el => {
  el.innerHTML = `<div class="controls"><div class="ctl"><label>Fleet size N <output></output></label><input type="range" min="1" max="50" value="${P.N}"></div></div><div class="out"></div>`;
  const draw = () => {
    const N = +$('input', el).value, d = derive({ ...P, N }), s = stage1({ ...P, N }, d);
    $('output', el).textContent = `${N} aircraft`;
    const half = (D.T * D.Nb) / (2 * D.mu), full = (D.T * D.Nb) / D.mu, xmax = 50 * P.F * 1.02;
    const W = 760, H = 150, f = frame({ W, H, ml: 20, mr: 20, mt: 20, mb: 44, x0: 0, x1: xmax, y0: 0, y1: 1, xt: niceTicks(0, xmax, 8), xl: 'Flying hours per period' });
    let b = f.s;
    b += `<rect x="${f.sx(0)}" y="30" width="${f.sx(half) - f.sx(0)}" height="56" fill="var(--bad-soft)"/><rect x="${f.sx(half)}" y="30" width="${f.sx(full) - f.sx(half)}" height="56" fill="var(--ok-soft)"/><rect x="${f.sx(full)}" y="30" width="${f.sx(xmax) - f.sx(full)}" height="56" fill="var(--surface-2)"/>`;
    b += `<text x="${f.sx(half / 2)}" y="24" text-anchor="middle">below 50% coverage: z* &lt; 0</text><text x="${f.sx((half + full) / 2)}" y="24" text-anchor="middle">net gain: z* &gt; 0</text><text x="${f.sx((full + xmax) / 2)}" y="24" text-anchor="middle">full coverage possible</text>`;
    b += `<rect x="${f.sx(0)}" y="50" width="${f.sx(d.Beff) - f.sx(0)}" height="16" rx="3" fill="var(--text)" ${tip(`B_eff = ${d.Beff} h`)}/>`;
    [[half, `N_min(½) = ${Math.ceil(half / P.F)}`], [full, `N_min(1) = ${Math.ceil(full / P.F)}`]].forEach(([x, l]) => { b += `<line x1="${f.sx(x)}" x2="${f.sx(x)}" y1="36" y2="80" stroke="var(--text)" stroke-width="3"/><text x="${f.sx(x)}" y="98" text-anchor="middle" class="lbl-strong">${l}</text>`; });
    $('.out', el).innerHTML = svgWrap(W, H, b, 'Bullet chart of the budget') + `<div class="stats"><div class="stat"><b>B<sub>eff</sub></b><span>${d.Beff} h</span></div><div class="stat ${s.z >= 0 ? 'good' : 'bad'}"><b>Game value z*</b><span>${sgn(s.z)}</span></div><div class="stat"><b>Active types</b><span>${s.active.length} of 3</span></div></div>`;
  };
  $('input', el).addEventListener('input', draw); draw();
});

/* 3 — Icon array */
card('Icon array (100 dots)', 'Coverage you can count', 'Coverage probability P<sub>k</sub> of a barrier of each type, as “out of 100 random moments”', 'People read “50 out of 100” far more reliably than “0.5022”. Switching policies shows Value-proportional starving Low barriers with no arithmetic needed.', '§3, §12', el => {
  el.innerHTML = '<div class="seg" style="flex-wrap:wrap"></div><div class="out" style="margin-top:.6rem"></div>';
  const pols = baselines(P, D, S1).slice(1);
  const draw = name => {
    const pol = pols.find(x => x.name === name), Pk = pol.h.map((h, k) => Math.min(1, cover(P, D, k, h)));
    let b = '';
    [0, 1, 2].forEach(k => {
      const ox = 20 + k * 250, filled = Math.round(Pk[k] * 100);
      b += `<text x="${ox}" y="16" class="lbl-strong">${NAMES[k]} barrier: ${filled} of 100 moments</text>`;
      for (let i = 0; i < 100; i++) { const x = ox + (i % 10) * 20 + 8, y = 34 + Math.floor(i / 10) * 20; b += `<circle cx="${x}" cy="${y}" r="7" fill="${i < filled ? COL(k) : 'none'}" stroke="${COL(k)}" stroke-width="1.3"/>`; }
    });
    $('.out', el).innerHTML = svgWrap(760, 240, b, 'Icon array of coverage') + `<p class="widget-sub">Filled = protected at a random moment. Hollow = an attack at that moment succeeds.</p>`;
  };
  seg($('.seg', el), pols.map(x => [x.name, x.name]), 'Stackelberg optimal', draw); draw('Stackelberg optimal');
});

/* 4 — Ternary heatmap */
card('Ternary heatmap', 'Every possible allocation at once', 'The game value min<sub>k</sub> U<sub>d</sub>(k) for <em>every</em> way to split B<sub>eff</sub> across the three types', 'A triangle is the natural shape for three shares that sum to 100%. The heat shows the whole landscape the LP searches, and how small the “good” region is.', '§4–§5, §12', el => {
  const W = 760, H = 400, VH = [380, 26], VM = [80, 360], VL = [680, 360], res = 40;
  const pt = (a, bm) => { const c = 1 - a - bm; return [a * VH[0] + bm * VM[0] + c * VL[0], a * VH[1] + bm * VM[1] + c * VL[1]]; };
  const gv = (a, bm) => Math.min(...[a, bm, 1 - a - bm].map((s, k) => utilOf(P, D, k, s * D.Beff)));
  const lo = -Math.max(...P.v), hi = S1.z;
  let b = '';
  const tri = (pts, a, bm) => { const g = gv(a, bm); b += `<path d="M${pts.map(p => p.map(v => v.toFixed(1)).join(',')).join('L')}Z" fill="${seq((g - lo) / (hi - lo))}" stroke="${seq((g - lo) / (hi - lo))}" stroke-width=".5" ${tip(`High ${pct(a)}, Medium ${pct(bm)}, Low ${pct(1 - a - bm)} → game value ${sgn(g)}`)}/>`; };
  for (let i = 0; i < res; i++) for (let j = 0; i + j < res; j++) {
    tri([pt(i / res, j / res), pt((i + 1) / res, j / res), pt(i / res, (j + 1) / res)], (i + 1 / 3) / res, (j + 1 / 3) / res);
    if (i + j < res - 1) tri([pt((i + 1) / res, j / res), pt((i + 1) / res, (j + 1) / res), pt(i / res, (j + 1) / res)], (i + 2 / 3) / res, (j + 2 / 3) / res);
  }
  b += `<text x="${VH[0]}" y="${VH[1] - 10}" text-anchor="middle" class="lbl-strong">100% High</text><text x="${VM[0]}" y="${VM[1] + 22}" text-anchor="middle" class="lbl-strong">100% Medium</text><text x="${VL[0]}" y="${VL[1] + 22}" text-anchor="middle" class="lbl-strong">100% Low</text>`;
  baselines(P, D, S1).slice(1).forEach(pol => {
    const sh = pol.h.map(h => h / D.Beff), [x, y] = pt(sh[0], sh[1]), st = pol.name.startsWith('Stack');
    const uni = pol.name.startsWith('Uniform');
    b += `<circle cx="${x}" cy="${y}" r="${st ? 7 : 5}" fill="${st ? '#fff' : 'var(--text)'}" stroke="var(--text)" stroke-width="2" ${tip(`${pol.name}: game value ${sgn(pol.game)}`)}/><text x="${x + 12}" y="${y + (st ? -10 : uni ? 20 : 4)}" class="lbl-strong">${pol.name.replace(' (high value first)', '')}${st ? ` (${sgn(pol.game)})` : uni ? ` (${sgn(pol.game)}, almost the same point)` : ''}</text>`;
  });
  let lg = ''; for (let i = 0; i <= 20; i++) lg += `<rect x="${560 + i * 8}" y="40" width="8" height="10" fill="${seq(i / 20)}"/>`;
  b += lg + `<text x="560" y="34">game value ${lo} → best ${fmt(hi, 2)}</text>`;
  el.innerHTML = svgWrap(W, H, b, 'Ternary heatmap of game value') + '<p class="widget-sub">Hover anywhere to read an allocation. Darkest = best. Only one point reaches the top value: the Stackelberg optimum.</p>';
});

/* 5 — Line chart with regime bands */
card('Line chart with regime bands', 'Game value as the fleet grows', 'z* as a function of fleet size N, with the number of active types shaded', 'A curve shows the trend; shaded bands show the regimes of §5.3 (types switching on) and where the line crosses zero (N<sub>min</sub>(½)).', '§5.3, §8', el => {
  const Nmax = maxSaneN(), rows = [];
  for (let N = 1; N <= Nmax; N++) { const p = { ...P, N }, s = stage1(p, derive(p)); rows.push({ N, z: s.z, a: s.active.length }); }
  const y0 = Math.min(...rows.map(r => r.z)), y1 = Math.max(...rows.map(r => r.z));
  const W = 760, H = 300, f = frame({ W, H, ml: 50, mr: 16, mt: 24, mb: 38, x0: 1, x1: Nmax, y0, y1: y1 + 2, xt: niceTicks(1, Nmax, 8), yt: niceTicks(y0, y1 + 2, 6), xl: 'Fleet size N', yl: 'Game value z*' });
  let b = '', start = 0;
  const shade = ['', 'var(--bad-soft)', 'var(--warn-soft)', 'var(--ok-soft)'];
  for (let i = 1; i <= rows.length; i++) if (i === rows.length || rows[i].a !== rows[start].a) {
    const xa = f.sx(rows[start].N - (start ? 0.5 : 0)), xb = f.sx(i === rows.length ? Nmax : rows[i].N - 0.5);
    b += `<rect x="${xa}" y="${f.sy(y1 + 2)}" width="${xb - xa}" height="${f.sy(y0) - f.sy(y1 + 2)}" fill="${shade[rows[start].a]}"/><text x="${(xa + xb) / 2}" y="${f.sy(y1 + 2) - 6}" text-anchor="middle">${rows[start].a} type${rows[start].a > 1 ? 's' : ''} active</text>`;
    start = i;
  }
  b += f.s + `<line x1="${f.sx(1)}" x2="${f.sx(Nmax)}" y1="${f.sy(0)}" y2="${f.sy(0)}" stroke="var(--text)" stroke-dasharray="4 3"/>`;
  b += poly(rows.map(r => [f.sx(r.N), f.sy(r.z)]), 'stroke="var(--accent)" stroke-width="2.5"');
  rows.forEach(r => { b += `<circle cx="${f.sx(r.N)}" cy="${f.sy(r.z)}" r="${r.N === P.N ? 6 : 3}" fill="${r.N === P.N ? 'var(--bad)' : 'var(--accent)'}" ${tip(`N = ${r.N}: z* = ${sgn(r.z)}, ${r.a} active`)}/>`; });
  b += `<text x="${f.sx(P.N) + 8}" y="${f.sy(rows[P.N - 1].z) + 18}" class="lbl-strong">N = 22: z* = ${sgn(S1.z)}</text>`;
  el.innerHTML = svgWrap(W, H, b, 'Game value versus fleet size') + `<p class="widget-sub">Stops at N = ${Nmax}, where some type would need more than 100% coverage and the simple model saturates.</p>`;
});

/* 6 — Stacked area */
card('Stacked area chart', 'How the optimal split changes with the fleet', 'h*<sub>k</sub> for each type as N grows; the top edge is B<sub>eff</sub>', 'Stacking shows both the total and the parts. Low-value types are abandoned when the fleet is small and switched on in order: Case 3 → Case 2 → Case 1.', '§5.3', el => {
  const Nmax = maxSaneN(), rows = [];
  for (let N = 1; N <= Nmax; N++) { const p = { ...P, N }, s = stage1(p, derive(p)); rows.push({ N, h: s.h }); }
  const ymax = Math.max(...rows.map(r => sum(r.h)));
  const W = 760, H = 300, f = frame({ W, H, ml: 56, mr: 90, mt: 14, mb: 38, x0: 1, x1: Nmax, y0: 0, y1: ymax, xt: niceTicks(1, Nmax, 8), yt: niceTicks(0, ymax, 5), xl: 'Fleet size N', yl: 'Flying hours' });
  let b = f.s;
  [0, 1, 2].forEach(k => {
    const top = rows.map(r => [f.sx(r.N), f.sy(sum(r.h.slice(0, k + 1)))]), bot = rows.map(r => [f.sx(r.N), f.sy(sum(r.h.slice(0, k)))]).reverse();
    b += `<path d="M${top.concat(bot).map(p => p.map(v => v.toFixed(1)).join(',')).join('L')}Z" fill="${COL(k)}" fill-opacity=".75" stroke="var(--surface)" stroke-width="1"/>`;
    const last = rows[rows.length - 1];
    b += `<text x="${f.sx(Nmax) + 6}" y="${f.sy(sum(last.h.slice(0, k)) + last.h[k] / 2) + 4}" class="lbl-strong">${NAMES[k]}</text>`;
  });
  b += `<line x1="${f.sx(P.N)}" x2="${f.sx(P.N)}" y1="${f.sy(ymax)}" y2="${f.sy(0)}" stroke="var(--text)" stroke-dasharray="3 3"/><text x="${f.sx(P.N) + 4}" y="${f.sy(ymax) + 12}">N = 22</text>`;
  el.innerHTML = svgWrap(W, H, b, 'Stacked area of optimal hours');
});

/* 7 — Dumbbell */
card('Dumbbell chart', 'How uneven each policy leaves you', 'U<sub>d</sub>(k) for every type under each of the five policies (§12, Table 5)', 'The bar length is the gap between your best- and worst-defended type: the attacker always lands on the left end. Stackelberg shrinks the bar to a single dot, which is what “indifference” looks like.', '§12', el => {
  const pols = baselines(P, D, S1), vmax = Math.max(...P.v);
  const W = 760, H = 270, f = frame({ W, H, ml: 190, mr: 20, mt: 14, mb: 38, x0: -vmax, x1: vmax, y0: 0, y1: 5, xt: niceTicks(-vmax, vmax, 6), xl: 'Defender payoff if that type is attacked' });
  let b = f.s + `<line x1="${f.sx(0)}" x2="${f.sx(0)}" y1="10" y2="${H - 38}" stroke="var(--axis)"/>`;
  pols.forEach((p, i) => {
    const y = 34 + i * 44, lo = Math.min(...p.U), hi = Math.max(...p.U);
    b += `<text x="${f.sx(-vmax) - 10}" y="${y + 4}" text-anchor="end" class="lbl-strong">${p.name}</text>`;
    b += `<line x1="${f.sx(lo)}" x2="${f.sx(hi)}" y1="${y}" y2="${y}" stroke="var(--axis)" stroke-width="6" stroke-linecap="round"/>`;
    p.U.forEach((u, k) => { b += `<circle cx="${f.sx(u)}" cy="${y}" r="7" fill="${COL(k)}" stroke="var(--surface)" stroke-width="2" ${tip(`${p.name}: attack ${NAMES[k]} → ${sgn(u)}`)}/>`; });
    b += `<text x="${f.sx(lo)}" y="${y + 22}" text-anchor="middle" style="fill:var(--bad)">${sgn(p.game, 2)}</text>`;
  });
  el.innerHTML = svgWrap(W, H, b, 'Dumbbell chart of payoffs by policy') + legend([0, 1, 2].map(k => [COL(k), `attack ${NAMES[k]}`]));
});

/* 8 — Game tree */
card('Game tree (extensive form)', 'The game, move by move (toy example)', 'Defender commits → a coin picks today\'s plan → the attacker, who can\'t see the coin, picks a target → payoff', 'The tree makes the information structure explicit. The dashed box joins nodes the attacker <em>cannot tell apart</em>: the Stackelberg assumption drawn as a picture. Slide the mix to watch expected values rebalance.', '§4, §9', el => {
  el.innerHTML = '<div class="controls"><div class="ctl"><label>Probability of plan A (3H, 3M) <output></output></label><input type="range" min="0" max="1" step="0.01" value="0.5"></div></div><div class="out"></div>';
  const U = { A: [3, 1], B: [0, 2] };
  const draw = () => {
    const s = +$('input', el).value; $('output', el).textContent = fmt(s, 2);
    const W = 760, H = 330; let b = '';
    const node = (x, y, label, fill) => `<circle cx="${x}" cy="${y}" r="16" fill="${fill}"/><text x="${x}" y="${y + 4}" text-anchor="middle" style="fill:#fff;font-weight:700">${label}</text>`;
    const edge = (x1, y1, x2, y2, l, ly) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--axis)" stroke-width="1.5"/><text x="${(x1 + x2) / 2 + (x2 > x1 ? 8 : -8)}" y="${(y1 + y2) / 2 + (ly || 0)}" text-anchor="${x2 > x1 ? 'start' : 'end'}">${l}</text>`;
    b += node(380, 30, 'D', 'var(--accent)') + `<text x="404" y="34">Defender commits to the mix (public)</text>`;
    b += edge(380, 46, 380, 94, '') + node(380, 110, '?', 'var(--muted)') + `<text x="404" y="114">Chance: today's plan (hidden)</text>`;
    const pl = [['A', 200, s], ['B', 560, 1 - s]];
    pl.forEach(([n, x, pr]) => { b += edge(380, 126, x, 184, `plan ${n} · ${fmt(pr, 2)}`, -4) + node(x, 200, 'A', '#b00020'); });
    b += `<rect x="160" y="176" width="440" height="48" rx="24" fill="none" stroke="#b00020" stroke-dasharray="6 4"/><text x="380" y="204" text-anchor="middle" style="fill:#b00020">attacker's information set: can't tell plan A from plan B</text>`;
    pl.forEach(([n, x]) => {
      [[0, -80], [1, 80]].forEach(([k, dx]) => {
        b += edge(x, 216, x + dx, 280, `hit ${NAMES[k]}`, -2);
        b += `<rect x="${x + dx - 26}" y="282" width="52" height="24" rx="5" fill="${COL(k)}"/><text x="${x + dx}" y="299" text-anchor="middle" style="fill:#fff;font-weight:700">${sgn(U[n][k], 0)}</text>`;
      });
    });
    const eH = s * U.A[0] + (1 - s) * U.B[0], eM = s * U.A[1] + (1 - s) * U.B[1];
    $('.out', el).innerHTML = svgWrap(W, H, b, 'Game tree for the toy example') + `<div class="stats"><div class="stat"><b>Expected payoff · hit High</b><span>${fmt(eH)}</span></div><div class="stat"><b>Expected payoff · hit Medium</b><span>${fmt(eM)}</span></div><div class="stat ${Math.abs(eH - eM) < 0.03 ? 'good' : ''}"><b>Attacker's choice gives you</b><span>${fmt(Math.min(eH, eM))}</span><small>${Math.abs(eH - eM) < 0.03 ? 'indifferent: z* = 1.5' : 'unequal: the attacker exploits the gap'}</small></div></div>`;
  };
  $('input', el).addEventListener('input', draw); draw();
});

/* 9 — Lattice / convex hull */
card('Lattice geometry (convex combination)', 'Stage 2 as a point inside a triangle', 'Whole-sortie plans are lattice points; the fractional target m* sits inside the triangle of floor/ceiling plans', 'Mixing probabilities are literally the barycentric weights of m* with respect to the plans. Proposition 3 (≤ K+1 plans) and §11 (stay in the floor/ceil cell) become geometry.', '§6, §11', el => {
  const fl = MIX.fl, mx = MSTAR[0] - fl[0], my = MSTAR[1] - fl[1];
  const W = 760, H = 380, f = frame({ W, H, ml: 70, mr: 230, mt: 20, mb: 44, x0: -1.4, x1: 2.4, y0: -1.4, y1: 2.4, xt: [-1, 0, 1, 2], xf: t => fl[0] + t, yt: [-1, 0, 1, 2], yf: t => fl[1] + t, xl: 'High sorties m_H', yl: 'Medium sorties m_M' });
  let b = f.s;
  for (let x = -1; x <= 2; x++) for (let y = -1; y <= 2; y++) {
    const L = 403 - fl[0] - fl[1] - x - y;
    b += `<circle cx="${f.sx(x)}" cy="${f.sy(y)}" r="4" fill="var(--axis)" ${tip(`(${fl[0] + x}, ${fl[1] + y}, ${L}) — Low ${L}`)}/>`;
  }
  const pts = MIX.plans.map(pl => [pl.m[0] - fl[0], pl.m[1] - fl[1]]);
  b += `<path d="M${pts.map(p => `${f.sx(p[0])},${f.sy(p[1])}`).join('L')}Z" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="1.5"/>`;
  MIX.plans.forEach((pl, j) => {
    const [x, y] = pts[j];
    b += `<line x1="${f.sx(mx)}" y1="${f.sy(my)}" x2="${f.sx(x)}" y2="${f.sy(y)}" stroke="${PLAN_COL[j]}" stroke-dasharray="4 3"/>`;
    b += `<circle cx="${f.sx(x)}" cy="${f.sy(y)}" r="${5 + 14 * pl.s}" fill="${PLAN_COL[j]}" fill-opacity=".85" ${tip(`Plan ${pl.label} (${pl.m.join(', ')}): weight ${fmt(pl.s, 3)}`)}/>`;
    b += `<text x="${f.sx(x) + 16}" y="${f.sy(y) - 10}" class="lbl-strong">Plan ${pl.label} · ${pct(pl.s)}</text>`;
  });
  b += `<path d="M${f.sx(mx)},${f.sy(my) - 9} l2.6,6 6.4,.6 -4.9,4.2 1.5,6.3 -5.6,-3.4 -5.6,3.4 1.5,-6.3 -4.9,-4.2 6.4,-.6Z" fill="var(--bad)"/><text x="${f.sx(mx) + 10}" y="${f.sy(my) + 18}" style="fill:var(--bad)" class="lbl-strong">m* = (${fmt(MSTAR[0], 2)}, ${fmt(MSTAR[1], 2)})</text>`;
  b += `<text x="${W - 220}" y="60">Low is implied: m_L = 403 − m_H − m_M.</text><text x="${W - 220}" y="80">Dot size = probability.</text><text x="${W - 220}" y="100">Grey dots outside the triangle are</text><text x="${W - 220}" y="116">other whole-sortie plans: valid</text><text x="${W - 220}" y="132">but worse in the worst case (§11).</text>`;
  el.innerHTML = svgWrap(W, H, b, 'Lattice of sortie plans');
});

/* 10 — Waffle chart */
card('Waffle chart', 'The mixed strategy as 100 months', 'Mixing probabilities s<sub>j</sub> of the plans in the support', 'A 10 × 10 grid turns probabilities into “how many months out of 100”, the operational meaning of a mixed strategy.', '§6', el => {
  const counts = MIX.plans.map(pl => Math.floor(pl.s * 100)); let left = 100 - sum(counts);
  MIX.plans.map((pl, j) => [pl.s * 100 - counts[j], j]).sort((a, c) => c[0] - a[0]).forEach(([, j]) => { if (left > 0) { counts[j]++; left--; } });
  let b = '', i = 0;
  counts.forEach((c, j) => { for (let n = 0; n < c; n++, i++) b += `<rect x="${20 + (i % 10) * 26}" y="${10 + Math.floor(i / 10) * 26}" width="22" height="22" rx="4" fill="${PLAN_COL[j]}" ${tip(`Month ${i + 1}: plan ${MIX.plans[j].label}`)}/>`; });
  MIX.plans.forEach((pl, j) => { b += `<rect x="320" y="${30 + j * 50}" width="22" height="22" rx="4" fill="${PLAN_COL[j]}"/><text x="352" y="${46 + j * 50}" class="lbl-strong">Plan ${pl.label}: ${counts[j]} months</text><text x="352" y="${62 + j * 50}">H ${pl.m[0]} · M ${pl.m[1]} · L ${pl.m[2]} sorties (s = ${fmt(pl.s, 4)})</text>`; });
  el.innerHTML = svgWrap(760, 280, b, 'Waffle chart of plan probabilities');
});

/* 11 — Diverging heatmap matrix */
card('Diverging heatmap', 'Realised payoff in a single month', 'For each plan (and, for contrast, the three “canonical” plans), the payoff if each type is attacked that month', 'Colour polarity (red = loss, blue = gain) makes Theorem 5 visible: floor/ceil rows stay near zero; canonical rows swing to ±30 and are exploitable.', '§11', el => {
  const U = (k, m) => Math.min(P.v[k], P.v[k] * ((2 * D.mu * m * P.tp) / (P.n[k] * D.T) - 1));
  const rows = MIX.plans.map(pl => [`Plan ${pl.label} (${pl.m.join(', ')}) · ${pct(pl.s)}`, pl.m]).concat([0, 1, 2].map(k => { const m = [0, 0, 0]; m[k] = D.Nsrt; return [`Canonical: all on ${NAMES[k]}`, m]; }));
  const vmax = Math.max(...P.v), W = 760, cw = 120, rh = 34, x0 = 270;
  let b = [0, 1, 2].map(k => `<text x="${x0 + k * cw + cw / 2}" y="18" text-anchor="middle" class="lbl-strong">attack ${NAMES[k]}</text>`).join('') + `<text x="${x0 + 3 * cw + cw / 2}" y="18" text-anchor="middle" class="lbl-strong">worst</text>`;
  rows.forEach(([name, m], r) => {
    const y = 28 + r * rh + (r >= MIX.plans.length ? 14 : 0), us = [0, 1, 2].map(k => U(k, m[k]));
    b += `<text x="${x0 - 10}" y="${y + 21}" text-anchor="end">${name}</text>`;
    us.concat([Math.min(...us)]).forEach((u, c) => { b += `<rect x="${x0 + c * cw + 2}" y="${y}" width="${cw - 4}" height="${rh - 4}" rx="4" fill="${diverge(u, vmax)}" ${tip(`${name}, ${c < 3 ? 'attack ' + NAMES[c] : 'worst'}: ${sgn(u)}`)}/><text x="${x0 + c * cw + cw / 2}" y="${y + 20}" text-anchor="middle" style="fill:#111;font-weight:${c === 3 ? 700 : 500}">${sgn(u, 2)}</text>`; });
  });
  const H = 28 + rows.length * rh + 30;
  el.innerHTML = svgWrap(W, H, b, 'Heatmap of realised payoffs') + legend([[mixRGB(MID, RED, 1), 'loss'], [mixRGB(MID, BLUE, 0), 'about zero'], [mixRGB(MID, BLUE, 1), 'gain']]);
});

/* 12 — Animated flowchart */
card('Animated flowchart', 'Algorithm 1 in motion', 'The pipeline Inputs → Stage 1 → Stage 2 → Stage 3 → outputs, with each box revealing its result as a token passes through', 'Animation shows <em>order and dependency</em>: what each stage consumes and produces, and that fleet sizing is a side branch.', '§10', el => {
  const boxes = [
    ['Inputs', 'N, n_k, v_k, T, τp, τs, F', `B_eff = ${D.Beff} h; μ = ${D.mu}`],
    ['Stage 1 · LP', 'closed form, Theorem 1', `z* = ${fmt(S1.z, 3)}; h* = (${S1.h.map(x => fmt(x, 0)).join(', ')})`],
    ['Stage 2 · mix', 'floor/ceil + feasibility LP', MIX.plans.map(pl => `${pl.label} ${pct(pl.s)}`).join(' · ')],
    ['Stage 3 · schedule', 'phases + greedy assignment', `${PLAN.ev.length} sorties, ${PLAN.ev.length - PLAN.unassigned} placed`],
    ['Output', 'timetables per plan', 'fly the plan the draw picks'],
  ];
  el.innerHTML = '<div class="btn-row"><button class="btn small">▶ Run the algorithm</button></div><div class="out"></div>';
  const W = 760, H = 230, bw = 128, gap = 22, y = 30, bh = 110;
  const draw = (lit, tok) => {
    let b = `<defs><marker id="arr12" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="var(--axis)"/></marker></defs>`;
    boxes.forEach(([t, s, r], i) => {
      const x = 10 + i * (bw + gap), on = i <= lit;
      b += `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="10" fill="${on ? 'var(--accent-soft)' : 'var(--surface-2)'}" stroke="${on ? 'var(--accent)' : 'var(--border)'}" stroke-width="1.5"/>`;
      b += `<text x="${x + bw / 2}" y="${y + 22}" text-anchor="middle" class="lbl-strong">${t}</text><text x="${x + bw / 2}" y="${y + 40}" text-anchor="middle" font-size="9">${s}</text>`;
      if (on) r.split('; ').forEach((line, li) => { b += `<text x="${x + bw / 2}" y="${y + 64 + li * 16}" text-anchor="middle" font-size="10" style="fill:var(--accent)">${line}</text>`; });
      if (i < boxes.length - 1) b += `<line x1="${x + bw + 2}" y1="${y + bh / 2}" x2="${x + bw + gap - 2}" y2="${y + bh / 2}" stroke="var(--axis)" stroke-width="2" marker-end="url(#arr12)"/>`;
    });
    const fx = 10 + 0.5 * bw;
    b += `<path d="M${fx},${y + bh} L${fx},${y + bh + 30} L${fx + 230},${y + bh + 30}" fill="none" stroke="var(--axis)" stroke-width="2" stroke-dasharray="5 4" marker-end="url(#arr12)"/><rect x="${fx + 232}" y="${y + bh + 14}" width="240" height="34" rx="8" fill="${lit >= 4 ? 'var(--ok-soft)' : 'var(--surface-2)'}" stroke="var(--border)"/><text x="${fx + 352}" y="${y + bh + 36}" text-anchor="middle" font-size="11">Side branch: N_min(½) = ${Math.ceil((D.T * D.Nb) / (2 * D.mu * P.F))}, N_min(1) = ${Math.ceil((D.T * D.Nb) / (D.mu * P.F))}</text>`;
    if (tok !== null) b += `<circle cx="${tok}" cy="${y + bh / 2}" r="9" fill="var(--bad)"/>`;
    $('.out', el).innerHTML = svgWrap(W, H, b, 'Animated algorithm flowchart');
  };
  draw(-1, null);
  $('button', el).addEventListener('click', () => {
    const t0 = performance.now(), dur = 5000, xEnd = 10 + 4 * (bw + gap) + bw / 2;
    const stepFn = now => {
      const u = Math.min(1, (now - t0) / dur), x = 10 + bw / 2 + u * (xEnd - 10 - bw / 2);
      draw(Math.floor((x - 10) / (bw + gap) + 0.15), u < 1 ? x : null);
      if (u < 1) requestAnimationFrame(stepFn);
    };
    requestAnimationFrame(stepFn);
  });
});

/* 13 — Gantt */
card('Gantt chart', 'Who flies when (first 48 hours of plan A)', 'Every sortie, on the aircraft that flies it, coloured by barrier type', 'The standard picture for schedules: you can check the gap constraint G and see how evenly the round-robin spreads work across the fleet.', '§7.3', el => {
  const win = 48, W = 760, rh = 14, H = 30 + P.N * rh + 40;
  const f = frame({ W, H, ml: 50, mr: 14, mt: 10, mb: 36, x0: 0, x1: win, y0: 0, y1: 1, xt: [0, 6, 12, 18, 24, 30, 36, 42, 48], xf: t => `${t} h`, xl: 'Hours into the month' });
  let b = f.s;
  for (let a = 0; a < P.N; a++) { const y = 10 + a * rh; b += `<text x="44" y="${y + 10}" text-anchor="end" font-size="9">AC-${a + 1}</text><rect x="${f.sx(0)}" y="${y}" width="${f.sx(win) - f.sx(0)}" height="${rh - 3}" fill="var(--surface-2)"/>`; }
  PLAN.ev.filter(e => e.t < win && e.ac !== null).forEach(e => {
    const y = 10 + e.ac * rh, br = PLAN.bars[e.b];
    b += `<rect x="${f.sx(e.t)}" y="${y}" width="${Math.max(2, f.sx(Math.min(win, e.t + P.tp)) - f.sx(e.t))}" height="${rh - 3}" rx="2" fill="${COL(e.k)}" ${tip(`AC-${e.ac + 1} → ${BAR_LABEL(br)} at ${dayTime(e.t)}`)}/>`;
  });
  el.innerHTML = svgWrap(W, H, b, 'Gantt chart of aircraft') + legend([0, 1, 2].map(k => [COL(k), `${NAMES[k]} barrier sortie`]));
});

/* 14 — Radial clock */
card('Radial clock', 'A day of protection, as a clock face', 'Day 1 of plan A: one ring per barrier, filled where the barrier is protected (dark = aircraft overhead, light = safe period)', 'Time of day is circular, so a clock beats a strip: you can see that protection is spread round the clock and that every ring has the same rhythm with a different, random phase.', '§7.2', el => {
  const cx = 280, cy = 235, r0 = 60, rw = 15;
  const arc = (r, a0, a1) => { const p = a => [cx + r * Math.sin((a / 24) * 2 * Math.PI), cy - r * Math.cos((a / 24) * 2 * Math.PI)]; const [x0, y0] = p(a0), [x1, y1] = p(a1); return `M${x0.toFixed(1)},${y0.toFixed(1)} A${r},${r} 0 ${a1 - a0 > 12 ? 1 : 0} 1 ${x1.toFixed(1)},${y1.toFixed(1)}`; };
  let b = '';
  PLAN.bars.forEach((br, i) => {
    const r = r0 + i * rw + rw / 2;
    b += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="${rw - 3}"/>`;
    br.starts.filter(t => t < 24).forEach(t => {
      const a = t, c = Math.min(24, t + P.tp), e = Math.min(24, t + D.W);
      b += `<path d="${arc(r, c, e)}" fill="none" stroke="${SOFT(br.k)}" stroke-width="${rw - 3}" ${tip(`${BAR_LABEL(br)} safe until ${hhmm(t + D.W)}`)}/><path d="${arc(r, a, c)}" fill="none" stroke="${COL(br.k)}" stroke-width="${rw - 3}" ${tip(`${BAR_LABEL(br)} patrolled ${hhmm(t)}–${hhmm(t + P.tp)}`)}/>`;
    });
    b += `<text x="${cx + 4}" y="${cy - r + 4}" font-size="8">${BAR_LABEL(br)}</text>`;
  });
  for (let h = 0; h < 24; h += 3) { const a = (h / 24) * 2 * Math.PI, R = r0 + 10 * rw + 14; b += `<text x="${cx + R * Math.sin(a)}" y="${cy - R * Math.cos(a) + 4}" text-anchor="middle" class="lbl-strong">${String(h).padStart(2, '0')}:00</text>`; }
  b += `<text x="${cx}" y="${cy + 4}" text-anchor="middle" class="lbl-strong">Day 1</text>`;
  b += `<text x="560" y="120" class="lbl-strong">Inner ring → outer ring:</text><text x="560" y="140">H1…H4, M1…M3, L1…L3</text><text x="560" y="170">Each barrier is visited about</text><text x="560" y="186">every ${fmt(D.T / Math.round(MSTAR[0] / 4), 1)} h, so a ring shows</text><text x="560" y="202">one or two visits per day.</text>`;
  el.innerHTML = svgWrap(760, 470, b, 'Radial clock of protection on day 1');
});

/* 15 — Calendar heatmap */
card('Calendar heatmap', 'The whole month, hour by hour', 'For each of the 720 hours of plan A, how many of the 10 barriers are protected', 'A calendar grid shows a whole month in one glance: steady colour means coverage is spread evenly in time. That is the assumption behind Eq. 1, checked visually.', '§3, §7', el => {
  const grid = [];
  for (let h = 0; h < D.T; h++) { const t = h + 0.5; grid.push(PLAN.bars.filter(br => br.starts.some(s => t >= s && t < s + D.W) && PLAN.ev.some(e => e.b === PLAN.bars.indexOf(br) && e.ac !== null && t >= e.t && t < e.t + D.W)).length); }
  const W = 760, cw = 26, rh = 13, x0 = 60;
  let b = '';
  for (let h = 0; h < 24; h += 3) b += `<text x="${x0 + h * cw + cw / 2}" y="12" text-anchor="middle" font-size="9">${String(h).padStart(2, '0')}h</text>`;
  grid.forEach((v, h) => { const day = Math.floor(h / 24), hr = h % 24; b += `<rect x="${x0 + hr * cw}" y="${18 + day * rh}" width="${cw - 2}" height="${rh - 2}" rx="2" fill="${seq(v / D.Nb)}" ${tip(`${dayTime(h)}: ${v} of ${D.Nb} barriers protected`)}/>`; });
  for (let d = 0; d < P.Tdays; d += 5) b += `<text x="${x0 - 6}" y="${18 + d * rh + 9}" text-anchor="end" font-size="9">day ${d + 1}</text>`;
  const H = 18 + P.Tdays * rh + 30;
  for (let i = 0; i <= 10; i++) b += `<rect x="${x0 + i * 22}" y="${H - 20}" width="20" height="10" fill="${seq(i / 10)}"/><text x="${x0 + i * 22 + 10}" y="${H - 24}" text-anchor="middle" font-size="8">${i}</text>`;
  const avg = sum(grid) / grid.length;
  el.innerHTML = svgWrap(W, H, b, 'Calendar heatmap') + `<p class="widget-sub">On average ${fmt(avg, 2)} of 10 barriers are protected at any hour (${pct(avg / 10, 1)}, close to the ≈50% the Stage 1 coverage predicts).</p>`;
});

/* 16 — Strip plot */
card('Strip plot', 'Each plan is uneven; the mix is even', 'Coverage p<sub>i</sub> of every individual barrier under each plan, with the Stage-1 target P*<sub>k</sub> as a line', 'Plotting raw points (not averages) shows the floor/ceiling jitter between plans and barriers, and that averaged over each type’s barriers and weighted by plan probability, coverage lands on the target line.', '§6, §7.1', el => {
  const bars = []; [0, 1, 2].forEach(k => { for (let i = 0; i < P.n[k]; i++) bars.push({ k, i }); });
  const ps = MIX.plans.map(pl => bars.map(({ k, i }) => { const base = Math.floor(pl.m[k] / P.n[k]), rem = pl.m[k] - base * P.n[k], q = base + (i < rem ? 1 : 0); return (D.W * q) / D.T; }));
  const all = ps.flat(), y0 = Math.min(...all) - 0.005, y1 = Math.max(...all) + 0.005;
  const W = 760, H = 280, f = frame({ W, H, ml: 56, mr: 14, mt: 14, mb: 40, x0: -0.5, x1: bars.length - 0.5, y0, y1, xt: bars.map((_, i) => i), xf: i => `${SH[bars[i].k]}${bars[i].i + 1}`, yt: niceTicks(y0, y1, 5), yf: t => pct(t, 1), yl: 'Coverage p_i' });
  let b = f.s;
  [0, 1, 2].forEach(k => { const idx = bars.map((x, i) => [x, i]).filter(([x]) => x.k === k).map(([, i]) => i); b += `<line x1="${f.sx(idx[0] - 0.4)}" x2="${f.sx(idx[idx.length - 1] + 0.4)}" y1="${f.sy(S1.P[k])}" y2="${f.sy(S1.P[k])}" stroke="${COL(k)}" stroke-width="2.5"/><text x="${f.sx(idx[0] - 0.4)}" y="${f.sy(S1.P[k]) - 6}" style="fill:${COL(k)}" class="lbl-strong">P*=${pct(S1.P[k], 2)}</text>`; });
  ps.forEach((row, j) => row.forEach((pv, i) => { b += `<circle cx="${f.sx(i) + (j - 1) * 9}" cy="${f.sy(pv)}" r="5" fill="${PLAN_COL[j]}" stroke="var(--surface)" stroke-width="1.5" ${tip(`Plan ${MIX.plans[j].label}, ${SH[bars[i].k]}${bars[i].i + 1}: ${pct(pv, 2)}`)}/>`; }));
  el.innerHTML = svgWrap(W, H, b, 'Strip plot of barrier coverage') + legend(MIX.plans.map((pl, j) => [PLAN_COL[j], `Plan ${pl.label} (${pct(pl.s)} of months)`]));
});

/* 17 — Bipartite network */
card('Bipartite network', 'Which aircraft serve which barriers', 'Plan A\'s greedy assignment: an edge from aircraft to barrier for every sortie it flies, thicker for more sorties', 'A network shows <em>relationships</em> a table can\'t: every aircraft ends up serving many barriers of all types, which is why the fleet-share icons in the planner are only an equivalent count.', '§7.3', el => {
  const cnt = {}; PLAN.ev.forEach(e => { if (e.ac !== null) { const k = `${e.ac}-${e.b}`; cnt[k] = (cnt[k] || 0) + 1; } });
  const W = 760, H = 420, ax = 120, bx = 640;
  const ay = a => 20 + (a * (H - 40)) / (P.N - 1), by = i => 40 + (i * (H - 80)) / (PLAN.bars.length - 1);
  let b = '';
  Object.entries(cnt).forEach(([key, c]) => { const [a, i] = key.split('-').map(Number), br = PLAN.bars[i]; b += `<path class="edge" data-a="${a}" data-b="${i}" d="M${ax},${ay(a)} C${(ax + bx) / 2},${ay(a)} ${(ax + bx) / 2},${by(i)} ${bx},${by(i)}" fill="none" stroke="${COL(br.k)}" stroke-opacity=".35" stroke-width="${0.6 + c * 0.6}" ${tip(`AC-${a + 1} → ${BAR_LABEL(br)}: ${c} sorties`)}/>`; });
  for (let a = 0; a < P.N; a++) b += `<g class="anode" data-a="${a}" style="cursor:pointer"><circle cx="${ax}" cy="${ay(a)}" r="6" fill="var(--text-2)"/><text x="${ax - 10}" y="${ay(a) + 4}" text-anchor="end" font-size="10">AC-${a + 1} (${PLAN.ac[a].hours} h)</text></g>`;
  PLAN.bars.forEach((br, i) => { b += `<g class="bnode" data-b="${i}" style="cursor:pointer"><circle cx="${bx}" cy="${by(i)}" r="9" fill="${COL(br.k)}"/><text x="${bx + 14}" y="${by(i) + 4}" class="lbl-strong">${BAR_LABEL(br)} (${br.q} sorties)</text></g>`; });
  el.innerHTML = svgWrap(W, H, b, 'Bipartite network of assignments') + '<p class="widget-sub">Hover an aircraft or barrier to highlight its edges.</p>';
  const svg = $('svg', el);
  svg.addEventListener('mouseover', e => {
    const g = e.target.closest('.anode, .bnode'); if (!g) return;
    $$('.edge', svg).forEach(p => { const on = g.dataset.a !== undefined ? p.dataset.a === g.dataset.a : p.dataset.b === g.dataset.b; p.setAttribute('stroke-opacity', on ? '.95' : '.05'); });
  });
  svg.addEventListener('mouseleave', () => $$('.edge', svg).forEach(p => p.setAttribute('stroke-opacity', '.35')));
});

/* 18 — Small multiples */
card('Small multiples', 'Coverage converging, barrier by barrier', 'Running fraction of time each barrier has been protected so far, over the whole month of plan A', 'Ten identical mini-charts let the eye compare shapes: early wobbles, then every line settles on its planned p<sub>i</sub> (dashed). This is the long-run meaning of “coverage probability”.', '§3, §7.2', el => {
  const mw = 140, mh = 80, cols = 5;
  let b = '';
  PLAN.bars.forEach((br, idx) => {
    const ox = 10 + (idx % cols) * (mw + 10), oy = 10 + Math.floor(idx / cols) * (mh + 34);
    const assigned = PLAN.ev.filter(e => e.b === idx && e.ac !== null).map(e => e.t);
    const pts = []; let covered = 0;
    for (let t = 1; t <= D.T; t += 4) { covered = sum(assigned.map(s => Math.max(0, Math.min(t, s + D.W) - s))); pts.push([ox + (t / D.T) * mw, oy + mh - (covered / t) * mh]); }
    b += `<rect x="${ox}" y="${oy}" width="${mw}" height="${mh}" fill="var(--surface-2)" rx="4"/>`;
    b += `<line x1="${ox}" x2="${ox + mw}" y1="${oy + mh - br.p * mh}" y2="${oy + mh - br.p * mh}" stroke="var(--text-2)" stroke-dasharray="3 3"/>`;
    b += poly(pts, `stroke="${COL(br.k)}" stroke-width="2"`);
    b += `<text x="${ox}" y="${oy + mh + 14}" class="lbl-strong">${BAR_LABEL(br)}</text><text x="${ox + mw}" y="${oy + mh + 14}" text-anchor="end">→ ${pct(br.p, 1)}</text>`;
  });
  el.innerHTML = svgWrap(760, 2 * (80 + 34) + 10, b, 'Small multiples of cumulative coverage') + '<p class="widget-sub">Each panel: x = day 1 → day 30, y = 0% → 100% of time protected so far.</p>';
});

/* 19 — Monte Carlo animation */
card('Monte Carlo animation', 'Attack it a thousand times', 'Simulated attacks: each one draws this month\'s plan (by s<sub>j</sub>) and fresh random phases, then strikes a random barrier of the chosen type at a random moment', 'A simulation turns abstract probabilities into frequencies you watch converge: the catch rate settles on P*<sub>k</sub> for <em>every</em> type, which is the indifference result seen empirically.', '§4, §6, §7', el => {
  el.innerHTML = `<div class="btn-row"><button class="btn small" data-a="go">▶ Simulate</button><button class="btn ghost small" data-a="reset">Reset</button></div><div class="out"></div><div class="stats st"></div>`;
  let sim = null, raf = null;
  const reset = () => { if (raf) cancelAnimationFrame(raf); raf = null; sim = { n: [0, 0, 0], hit: [0, 0, 0], pay: [0, 0, 0], dots: [], hist: [[], [], []] }; draw(); };
  const once = () => {
    const k = Math.floor(Math.random() * 3), i = Math.floor(Math.random() * P.n[k]);
    let u = Math.random(), j = 0; for (; j < MIX.plans.length - 1; j++) { u -= MIX.plans[j].s; if (u < 0) break; }
    const m = MIX.plans[j].m[k], base = Math.floor(m / P.n[k]), rem = m - base * P.n[k], q = base + (i < rem ? 1 : 0);
    let caught = false;
    if (q > 0) { const delta = D.T / q, phi = Math.random() * Math.max(0, delta - D.W), t = Math.random() * D.T; caught = t >= phi && ((t - phi) % delta) < D.W; }
    sim.n[k]++; if (caught) sim.hit[k]++; sim.pay[k] += caught ? P.v[k] : -P.v[k];
    sim.dots.push([k, caught]); if (sim.dots.length > 600) sim.dots.shift();
    if (sim.n[k] % 5 === 0) sim.hist[k].push(sim.hit[k] / sim.n[k]);
  };
  const draw = () => {
    const W = 760, H = 260, f = frame({ W, H, ml: 46, mr: 230, mt: 14, mb: 36, x0: 0, x1: Math.max(40, ...sim.hist.map(h => h.length)), y0: 0.3, y1: 0.7, yt: [0.3, 0.4, 0.5, 0.6, 0.7], yf: t => pct(t), xl: 'Attacks on that type (× 5)', yl: 'Catch rate so far' });
    let b = f.s;
    [0, 1, 2].forEach(k => { b += `<line x1="${f.sx(0)}" x2="${f.sx(f === null ? 0 : Math.max(40, ...sim.hist.map(h => h.length)))}" y1="${f.sy(S1.P[k])}" y2="${f.sy(S1.P[k])}" stroke="${COL(k)}" stroke-dasharray="4 3"/>`; if (sim.hist[k].length) b += poly(sim.hist[k].map((v, i) => [f.sx(i + 1), f.sy(clamp(v, 0.3, 0.7))]), `stroke="${COL(k)}" stroke-width="2"`); });
    sim.dots.forEach(([k, c], i) => { b += `<circle cx="${545 + (i % 30) * 7}" cy="${20 + k * 70 + Math.floor((i % 600) / 30) % 9 * 7}" r="2.6" fill="${c ? 'var(--ok)' : 'var(--bad)'}"/>`; });
    [0, 1, 2].forEach(k => { b += `<text x="545" y="${16 + k * 70}" class="lbl-strong" style="fill:${COL(k)}">${NAMES[k]}</text>`; });
    $('.out', el).innerHTML = svgWrap(W, H, b, 'Monte Carlo simulation of attacks') + legend([['var(--ok)', 'attack caught (defender +v)'], ['var(--bad)', 'attack succeeded (defender −v)'], ['var(--text-2)', 'dashed: Stage 1 prediction P*_k']]);
    $('.st', el).innerHTML = [0, 1, 2].map(k => `<div class="stat"><b>Attacks on ${NAMES[k]}</b><span>${sim.n[k] ? pct(sim.hit[k] / sim.n[k], 1) : '—'}</span><small>caught, of ${sim.n[k]} · predicted ${pct(S1.P[k], 1)} · average payoff ${sim.n[k] ? sgn(sim.pay[k] / sim.n[k], 2) : '—'} (z* = ${sgn(S1.z, 2)})</small></div>`).join('');
  };
  const loop = () => { for (let i = 0; i < 15; i++) once(); draw(); if (sum(sim.n) < 6000) raf = requestAnimationFrame(loop); else raf = null; };
  el.addEventListener('click', e => { const b = e.target.closest('[data-a]'); if (!b) return; if (b.dataset.a === 'reset') reset(); else if (!raf) raf = requestAnimationFrame(loop); });
  reset();
});

/* 20 — Treemap */
card('Treemap', 'Value at stake vs. hours spent', 'Each rectangle is one barrier. Toggle between area = military value v<sub>k</sub> and area = flying hours h*<sub>k</sub>/n<sub>k</sub>', 'Comparing two treemaps of the same items shows the paper\'s most surprising result in one flip: High barriers hold 57% of the value, yet each one receives about the same hours as a Low barrier (slightly fewer, in fact). The optimum spends by barrier count, not by value.', '§5, §12', el => {
  el.innerHTML = '<div class="seg"></div><div class="out" style="margin-top:.6rem"></div>';
  const draw = mode => {
    const items = []; [0, 1, 2].forEach(k => { for (let i = 0; i < P.n[k]; i++) items.push({ k, i, w: mode === 'value' ? P.v[k] : S1.h[k] / P.n[k] }); });
    const W = 760, H = 300, tot = sum(items.map(x => x.w));
    let b = '', x = 0;
    [0, 1, 2].forEach(k => {
      const its = items.filter(t => t.k === k), tw = sum(its.map(t => t.w)), cw = (tw / tot) * W;
      let y = 0;
      its.forEach(t => { const h = (t.w / tw) * H; b += `<rect x="${x + 1}" y="${y + 1}" width="${cw - 2}" height="${h - 2}" rx="4" fill="${COL(k)}" fill-opacity="${0.35 + 0.65 * S1.P[k]}" ${tip(`${SH[k]}${t.i + 1}: value ${P.v[k]}, ${fmt(S1.h[k] / P.n[k], 1)} h, coverage ${pct(S1.P[k], 1)}`)}/><text x="${x + 10}" y="${y + 20}" style="fill:#fff;font-weight:700">${SH[k]}${t.i + 1}</text><text x="${x + 10}" y="${y + 36}" style="fill:#fff" font-size="10">${mode === 'value' ? `value ${P.v[k]}` : `${fmt(t.w, 0)} h`}</text>`; y += h; });
      b += `<text x="${x + cw / 2}" y="${H + 18}" text-anchor="middle" class="lbl-strong">${NAMES[k]}: ${pct(tw / tot)}</text>`;
      x += cw;
    });
    $('.out', el).innerHTML = svgWrap(W, H + 26, b, 'Treemap of barriers');
  };
  seg($('.seg', el), [['value', 'Area = value at stake'], ['hours', 'Area = flying hours received']], 'value', draw); draw('value');
});

/* ============================================================
   Boot
   ============================================================ */

function boot() {
  $('#globalLegend').innerHTML = [0, 1, 2].map(k => `<span><i style="background:${COL(k)}"></i>${NAMES[k]} barriers (v = ${P.v[k]})</span>`).join('') + MIX.plans.map((pl, j) => `<span><i style="background:${PLAN_COL[j]}"></i>Plan ${pl.label}</span>`).join('');
  $('#tocList').innerHTML = CARDS.map((c, i) => `<li><a href="#v${i + 1}"><span class="num">${i + 1}</span><span>${c.form}</span></a></li>`).join('');
  $('#cards').innerHTML = CARDS.map((c, i) => `<section class="widget lesson" id="v${i + 1}" style="max-width:none">
      <div class="eyebrow" style="font-size:.75rem;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:.07em">${i + 1} · ${c.form} · paper ${c.sec}</div>
      <h2 style="margin:.2rem 0 .5rem;border:none;padding:0">${c.title}</h2>
      <p class="widget-sub" style="margin:0 0 .3rem"><b>Shows:</b> ${c.shows}</p>
      <p class="widget-sub"><b>Why this form:</b> ${c.why}</p>
      <div class="viz"></div></section>`).join('');
  CARDS.forEach((c, i) => { try { c.render($(`#v${i + 1} .viz`)); } catch (err) { $(`#v${i + 1} .viz`).innerHTML = `<p style="color:var(--bad)">Could not draw this view: ${err.message}</p>`; console.error(err); } });

  $('#tocToggle').addEventListener('click', () => $('#toc').classList.toggle('collapsed'));
  const links = $$('#tocList a');
  const obs = new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) links.forEach(a => a.classList.toggle('current', a.getAttribute('href') === `#${en.target.id}`)); }), { rootMargin: '-30% 0px -60% 0px' });
  $$('#cards section').forEach(s => obs.observe(s));
  const tipEl = $('#tip');
  document.addEventListener('mousemove', e => {
    const t = e.target.closest && e.target.closest('[data-tip]');
    if (!t) { tipEl.classList.remove('on'); return; }
    tipEl.textContent = t.getAttribute('data-tip'); tipEl.classList.add('on');
    tipEl.style.left = `${Math.min(e.clientX + 14, window.innerWidth - tipEl.offsetWidth - 8)}px`; tipEl.style.top = `${e.clientY + 16}px`;
  });
}
boot();
