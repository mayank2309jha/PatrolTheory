'use strict';

/* ============================================================
   Learn-the-paper page. Self-contained: it re-implements the
   small amount of maths each lesson needs (K = 3 barrier types)
   so the planner's script.js stays untouched.
   ============================================================ */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const sum = a => a.reduce((s, x) => s + x, 0);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

const NAMES = ['High', 'Medium', 'Low'];
const SH = ['H', 'M', 'L'];
const COL = k => `var(--c${k})`;
const SOFT = k => `var(--c${k}-soft)`;

// The paper's Section 12 instance (22 aircraft, μ = 3, B_eff = 1209 h).
const PAPER = { N: 22, Tdays: 30, tp: 3, ts: 6, tr: 0, F: 55, n: [4, 3, 3], v: [30, 20, 10] };
let P = JSON.parse(JSON.stringify(PAPER));

function fmt(x, d = 2) {
  if (!Number.isFinite(x)) return '—';
  const s = x.toFixed(d);
  return /^-0\.?0*$/.test(s) ? s.slice(1) : s;
}
const sgn = (x, d = 2) => (x > 0.5 * 10 ** -d ? '+' : '') + fmt(x, d);
const fmtNum = x => (Math.abs(x - Math.round(x)) < 1e-9 ? String(Math.round(x)) : fmt(x, 2));
function hhmm(t) {
  const m = Math.round(t * 60);
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
const dayTime = t => `day ${Math.floor(t / 24) + 1}, ${hhmm(t % 24)}`;

/* ============================================================
   Model
   ============================================================ */

function derive(p) {
  const T = p.Tdays * 24, W = p.tp + p.ts, mu = W / p.tp, G = p.tp + p.tr, B = p.N * p.F;
  const Nsrt = Math.floor(B / p.tp + 1e-9), Beff = Nsrt * p.tp, Nb = sum(p.n);
  return { T, W, mu, G, B, Nsrt, Beff, Nb };
}
const cover = (p, d, k, h) => (d.mu * h) / (p.n[k] * d.T);
const utilOf = (p, d, k, h) => p.v[k] * (2 * Math.min(1, cover(p, d, k, h)) - 1);

// Theorem 1 with the iterative removal of Remark 5.
function stage1(p, d) {
  const dk = p.n.map((n, k) => (n * d.T) / (2 * d.mu * p.v[k]));
  let active = [0, 1, 2], z = 0, h = [0, 0, 0];
  const log = [];
  while (active.length) {
    const sd = sum(active.map(k => dk[k])), nb = sum(active.map(k => p.n[k]));
    z = (d.Beff - (d.T * nb) / (2 * d.mu)) / sd;
    h = [0, 0, 0];
    active.forEach(k => { h[k] = dk[k] * (z + p.v[k]); });
    const neg = active.filter(k => h[k] < -1e-9);
    if (!neg.length) break;
    log.push({ removed: neg, z });
    active = active.filter(k => !neg.includes(k));
  }
  h = h.map((x, k) => (active.includes(k) ? Math.max(0, x) : 0));
  const Pk = h.map((x, k) => cover(p, d, k, x));
  const U = h.map((x, k) => p.v[k] * (2 * Pk[k] - 1));
  return { dk, z, h, P: Pk, U, active, log };
}

// Floor/ceil mixture with marginals m*. Systematic sampling over the fractional parts gives
// one basic solution of LP (9) supported on the floor/ceil neighbourhood (≤ K+1 plans).
function floorCeilMix(mStar) {
  const fl = mStar.map(x => Math.floor(x + 1e-9));
  const fr = mStar.map((x, k) => { const f = x - fl[k]; return f < 1e-9 ? 0 : f; });
  const cum = [0];
  fr.forEach(f => cum.push(cum[cum.length - 1] + f));
  const r = Math.round(cum[cum.length - 1]);
  if (r === 0) return { fl, fr, r, plans: [{ m: fl.slice(), s: 1, up: [] }] };
  const bps = [...new Set([0, 1, ...cum.map(c => c - Math.floor(c + 1e-12)).map(x => +x.toFixed(12))])]
    .filter(x => x >= 0 && x <= 1).sort((a, b) => a - b);
  const plans = [];
  for (let i = 0; i + 1 < bps.length; i++) {
    const a = bps[i], b = bps[i + 1];
    if (b - a < 1e-12) continue;
    const u = (a + b) / 2, m = fl.slice(), up = [];
    for (let k = 0; k < fr.length; k++)
      for (let t = 0; t < r; t++) if (cum[k] <= u + t && u + t < cum[k + 1]) { m[k]++; up.push(k); }
    const ex = plans.find(pl => pl.m.join() === m.join());
    if (ex) ex.s += b - a; else plans.push({ m, s: b - a, up });
  }
  return { fl, fr, r, plans };
}

function buildPlan(p, d, m) {
  const bars = [], ev = [];
  for (let k = 0; k < 3; k++) {
    const nk = p.n[k], base = Math.floor(m[k] / nk), rem = m[k] - base * nk;
    for (let i = 0; i < nk; i++) {
      const q = base + (i < rem ? 1 : 0);
      const delta = q ? d.T / q : null;
      const span = q ? delta - d.W : 0;
      const phi = q && span > 1e-9 ? Math.random() * span : 0;
      const starts = [];
      if (q) for (let j = 0; j < q; j++) { const t = phi + j * delta; starts.push(t); ev.push({ k, i, t }); }
      bars.push({ k, i, q, delta, p: q ? Math.min(1, (d.W * q) / d.T) : 0, phi, starts });
    }
  }
  ev.sort((a, b) => a.t - b.t);
  const ac = Array.from({ length: p.N }, () => ({ next: -Infinity, hours: 0 }));
  let ptr = 0, unassigned = 0;
  ev.forEach(e => {
    for (let s = 0; s < p.N; s++) {
      const idx = (ptr + s) % p.N, a = ac[idx];
      if (e.t + 1e-9 >= a.next && a.hours + p.tp <= p.F + 1e-9) {
        a.next = e.t + d.G; a.hours += p.tp; e.ac = idx; ptr = (idx + 1) % p.N; return;
      }
    }
    unassigned++;
  });
  return { bars, ev, ac, unassigned };
}

function compute() {
  const d = derive(P);
  const s1 = stage1(P, d);
  const mStar = s1.h.map(h => h / P.tp);
  const mix = floorCeilMix(mStar);
  mix.plans.forEach((pl, j) => { pl.label = String.fromCharCode(65 + j); });
  return { d, s1, mStar, mix };
}

function baselines(p, d, s1) {
  const n = p.n, v = p.v, Nsrt = d.Nsrt, tp = p.tp;
  const evalH = h => { const U = h.map((x, k) => utilOf(p, d, k, x)); return { h, U, game: Math.min(...U) }; };

  const base = Math.floor(Nsrt / d.Nb);
  let left = Nsrt - base * d.Nb, t = 0, guard = 0;
  const extra = [0, 0, 0];
  while (left > 0 && guard++ < 1000) { if (extra[t] < n[t]) { extra[t]++; left--; } t = (t + 1) % 3; }
  const hEq = n.map((nk, k) => (nk * base + extra[k]) * tp);

  const w = n.map((nk, k) => nk * v[k]), tw = sum(w);
  const mVp = [Math.floor((Nsrt * w[0]) / tw), Math.floor((Nsrt * w[1]) / tw), 0];
  mVp[2] = Nsrt - mVp[0] - mVp[1];

  const order = [0, 1, 2].sort((a, b) => v[b] - v[a]);
  let budget = d.Beff;
  const hG = [0, 0, 0];
  order.forEach(k => { const full = (n[k] * d.T) / d.mu; hG[k] = Math.max(0, Math.min(full, budget)); budget -= hG[k]; });

  const fixedU = v.map(x => -x);
  return [
    { id: 'fixed', name: 'Fixed deterministic', h: hEq, U: fixedU, game: Math.min(...fixedU) },
    { id: 'uniform', name: 'Uniform random', ...evalH(hEq) },
    { id: 'vp', name: 'Value-proportional', ...evalH(mVp.map(m => m * tp)) },
    { id: 'greedy', name: 'Greedy (high value first)', ...evalH(hG) },
    { id: 'stack', name: 'Stackelberg optimal', h: s1.h, U: s1.U, game: Math.min(...s1.U) },
  ];
}

/* ============================================================
   SVG helpers
   ============================================================ */

function niceTicks(a, b, n = 5) {
  const raw = (b - a) / n, mag = 10 ** Math.floor(Math.log10(raw)), r = raw / mag;
  const step = (r < 1.5 ? 1 : r < 3 ? 2 : r < 7 ? 5 : 10) * mag;
  const out = [];
  for (let x = Math.ceil(a / step) * step; x <= b + 1e-9; x += step) out.push(+x.toFixed(10));
  return out;
}

function frame(o) {
  const sx = v => o.ml + ((v - o.x0) / (o.x1 - o.x0)) * (o.W - o.ml - o.mr);
  const sy = v => o.H - o.mb - ((v - o.y0) / (o.y1 - o.y0)) * (o.H - o.mt - o.mb);
  let s = '';
  (o.yt || []).forEach(t => {
    s += `<line class="grid" x1="${o.ml}" x2="${o.W - o.mr}" y1="${sy(t)}" y2="${sy(t)}"/>` +
      `<text x="${o.ml - 6}" y="${sy(t) + 4}" text-anchor="end">${(o.yf || fmtNum)(t)}</text>`;
  });
  (o.xt || []).forEach(t => {
    s += `<text x="${sx(t)}" y="${o.H - o.mb + 15}" text-anchor="middle">${(o.xf || fmtNum)(t)}</text>`;
  });
  s += `<line class="axis" x1="${o.ml}" x2="${o.W - o.mr}" y1="${o.H - o.mb}" y2="${o.H - o.mb}"/>`;
  if (o.xl) s += `<text x="${(o.ml + o.W - o.mr) / 2}" y="${o.H - 4}" text-anchor="middle">${o.xl}</text>`;
  if (o.yl) s += `<text x="12" y="${(o.mt + o.H - o.mb) / 2}" text-anchor="middle" transform="rotate(-90 12 ${(o.mt + o.H - o.mb) / 2})">${o.yl}</text>`;
  return { sx, sy, s };
}
const svgWrap = (W, H, body, label) => `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${label || ''}">${body}</svg>`;
const poly = (pts, attrs) => `<polyline fill="none" points="${pts.map(p => p.join(',')).join(' ')}" ${attrs}/>`;
const tipAttr = s => `data-tip="${String(s).replace(/"/g, '&quot;')}"`;

/* ============================================================
   Navigation, progress, quizzes
   ============================================================ */

const LESSONS = $$('.lesson').map(a => ({ id: a.id, title: a.dataset.title }));
const QUIZ_IDS = LESSONS.filter(l => l.id !== 's13' && l.id !== 'deck').map(l => l.id);
let done = new Set();
try { done = new Set(JSON.parse(localStorage.getItem('patrolLearnDone') || '[]')); } catch (e) { /* storage unavailable */ }
const saveDone = () => { try { localStorage.setItem('patrolLearnDone', JSON.stringify([...done])); } catch (e) { /* ignore */ } };

function buildToc() {
  $('#tocList').innerHTML = LESSONS.map((l, i) =>
    `<li><a href="#${l.id}" data-id="${l.id}"><span class="num">${l.id === 's13' ? '★' : l.id === 'deck' ? '✎' : '§' + (i + 1)}</span><span>${l.title}</span><span class="tick">✓</span></a></li>`).join('');
}
function updateProgress() {
  const n = QUIZ_IDS.filter(id => done.has(id)).length;
  $('#progressFill').style.width = `${(100 * n) / QUIZ_IDS.length}%`;
  $('#progressText').textContent = `${n} / ${QUIZ_IDS.length}`;
  $$('#tocList a').forEach(a => a.classList.toggle('done', done.has(a.dataset.id)));
}

let current = null;
function show(id) {
  if (!LESSONS.some(l => l.id === id)) id = 's1';
  current = id;
  $$('.lesson').forEach(a => { a.hidden = a.id !== id; });
  $$('#tocList a').forEach(a => a.classList.toggle('current', a.dataset.id === id));
  const i = LESSONS.findIndex(l => l.id === id);
  const prev = LESSONS[i - 1], next = LESSONS[i + 1];
  $('#pager').innerHTML =
    (prev ? `<a href="#${prev.id}"><small>← Previous</small><span>${prev.title}</span></a>` : '') +
    (next ? `<a class="next" href="#${next.id}"><small>Next →</small><span>${next.title}</span></a>` : '');
  if (render[id]) render[id]();
  $('#toc').classList.add('collapsed');
  window.scrollTo(0, 0);
}

const QUIZ = {
  s1: { q: 'What can the attacker observe before striking?', o: ["Today's exact patrol timetable", 'The long-run probabilities of each patrol plan, but not which plan is flown today', 'Nothing: attacks happen at random', 'Only the number of aircraft'], a: 1, why: 'The attacker learns the policy by watching over time, but today\'s draw is hidden. That is why the defender commits to a randomised (mixed) strategy.' },
  s2: { q: 'With τp = 3 h and τs = 6 h, how many protection-hours does one flying hour buy?', o: ['1', '2', '3', '9'], a: 2, why: 'μ = W/τp = (3 + 6)/3 = 3. One 3-hour sortie protects for 9 hours.' },
  s3: { q: 'Medium type: n = 3 barriers, T = 720 h, μ = 3. How many flying hours give each barrier P = 50%?', o: ['180 h', '360 h', '720 h', '1080 h'], a: 1, why: 'h = P·n·T/μ = 0.5 × 3 × 720 / 3 = 360 h.' },
  s4: { q: 'At the Stackelberg optimum, the defender\'s payoffs on the active barrier types are…', o: ['highest on the most valuable type', 'all equal to the game value z*', 'all exactly zero', 'proportional to v_k'], a: 1, why: 'Remark 3: if one type were weaker, you could move hours to it and raise the worst case. So all active types tie at z*.' },
  s5: { q: 'When does a barrier type get zero hours (become inactive)?', o: ['Whenever z* < 0', 'When z* ≤ −v_k', 'When its d_k is the largest', 'Never; every type always gets hours'], a: 1, why: 'h*_k = d_k(z* + v_k) ≤ 0 exactly when z* ≤ −v_k (Case 3). A loss alone (Case 2) is not enough.' },
  s6: { q: 'Why does Stage 2 mix several plans instead of flying one?', o: ['Because LP (9) is infeasible otherwise', 'Because m*_k is usually fractional, sorties are whole, and only an average can hit h* exactly', 'To use more aircraft', 'To reduce B_eff'], a: 1, why: 'E.g. 160.69 sorties: fly 161 with probability 0.69 and 160 otherwise, and the average is exact.' },
  s7: { q: 'Randomising barrier i\'s phase φ_i does what to its time-averaged coverage p_i?', o: ['Raises it', 'Lowers it', 'Leaves it unchanged: p_i = W/Δ_i', 'Makes it random'], a: 2, why: 'Remark 7: exactly W of every Δ_i hours are covered wherever φ_i lands. Randomising only hides the timing.' },
  s8: { q: 'T = 720 h, N_b = 10, μ = 3, F = 55 h. Smallest fleet for zero expected loss (θ = ½)?', o: ['11', '20', '22', '44'], a: 2, why: '⌈0.5 × 720 × 10 / (3 × 55)⌉ = ⌈21.8⌉ = 22, which is exactly the paper\'s fleet.' },
  s9: { q: 'In the toy example, why does the 50/50 mix beat both pure plans?', o: ['It flies more hours', 'It equalises the expected payoffs at 1.5 on both types, versus a worst case of 1 (plan A) or 0 (plan B)', 'It hides the number of aircraft', 'It doesn\'t; plan A is better'], a: 1, why: 'Each pure plan has a weak type. Mixing averages them to exactly h* = (5, 7), where both payoffs are 1.5.' },
  s10: { q: 'Which lines of Algorithm 1 produce the mixing probabilities s*?', o: ['Lines 3–6 (Stage 1)', 'Lines 8–10 (Stage 2)', 'Lines 12–16 (Stage 3)', 'Line 19'], a: 1, why: 'Stage 2 enumerates floor/ceil candidates and solves the Phase-1 LP for s*.' },
  s11: { q: 'A mix flies 0 High sorties some months and 5 in others (average 2.5). Against a patient attacker, compared with floor/ceil (2 or 3):', o: ['Better worst case, thanks to unpredictability', 'Same worst case', 'Worse worst case: the attacker waits for the 0-sortie month', 'Better expected payoff'], a: 2, why: 'Theorem 5: going below the floor in any month lowers W(s) below W*. Expected payoff is the same z* for every valid mix.' },
  s12: { q: 'Why does value-proportional patrol lose to plain uniform random?', o: ['It flies fewer hours', 'It starves the Low barriers below 50% coverage, handing the attacker a clear target', 'It doesn\'t randomise start times', 'High barriers get too few hours'], a: 1, why: 'Low gets about 24% coverage, so U_d(L) ≈ −5.17. Uniform keeps every type near 50%.' },
};

function buildQuizzes() {
  $$('.quiz').forEach(box => {
    const id = box.dataset.quiz, q = QUIZ[id];
    box.innerHTML = `<h3>Check yourself</h3><div class="qtext">${q.q}</div><div class="opts">${q.o.map((t, i) => `<button class="opt" data-i="${i}">${t}</button>`).join('')}</div><div class="why" hidden></div>`;
    box.addEventListener('click', e => {
      const b = e.target.closest('.opt');
      if (!b) return;
      const i = +b.dataset.i, why = $('.why', box);
      if (i === q.a) {
        $$('.opt', box).forEach(x => x.classList.remove('wrong'));
        b.classList.add('right');
        why.innerHTML = `<b class="t2" style="color:var(--ok)">Correct.</b> ${q.why}`;
        done.add(id); saveDone(); updateProgress();
      } else {
        b.classList.add('wrong');
        why.innerHTML = '<b style="color:var(--bad)">Not quite.</b> Have another look at the section and try again.';
      }
      why.hidden = false;
    });
  });
}

/* ============================================================
   Lessons
   ============================================================ */

const render = {};

function fillChips() {
  const { d } = compute();
  $$('.run-chip').forEach(c => {
    c.innerHTML = `<span>Running example:</span> <span><b>N</b> = ${P.N}</span><span><b>n</b> = (${P.n.join(', ')})</span><span><b>v</b> = (${P.v.join(', ')})</span><span><b>μ</b> = ${fmtNum(d.mu)}</span><span><b>T</b> = ${d.T} h</span><span><b>B<sub>eff</sub></b> = ${fmtNum(d.Beff)} h</span><a href="#s2">edit</a>`;
  });
  $$('.v-Beff').forEach(s => { s.textContent = fmtNum(d.Beff); });
}

/* ---------------- §1 ---------------- */
const PIPE = [
  { k: 'Inputs', t: 'The problem', s: 'N, K, n_k, v_k, T, τp, τs, τr, F', in: 'Fleet size, barrier types (count n_k and value v_k), timing parameters, and the per-aircraft hour budget F.', out: 'Derived quantities: protection window W, multiplier μ, budget B_eff, sortie count N_srt.', go: 's2' },
  { k: 'Stage 1', t: 'How many hours per type?', s: 'LP → h*, z*', in: 'The budget B_eff and the barrier types.', out: 'Optimal flying hours h*_k per barrier type, and the game value z* (the best worst-case payoff). Closed-form via Theorem 1.', go: 's5' },
  { k: 'Stage 2', t: 'Which whole-sortie plans, how often?', s: 'Feasibility LP → s*', in: 'The continuous h* from Stage 1.', out: 'A few whole-number sortie plans and the probability of flying each (the mixed strategy s*), averaging exactly to h*.', go: 's6' },
  { k: 'Stage 3', t: 'When, and in which aircraft?', s: 'Timetables', in: 'Each plan that s* uses.', out: 'Sorties spread across individual barriers, random start phases, and a greedy assignment to aircraft respecting the gap G and budget F.', go: 's7' },
  { k: 'Also', t: 'How big a fleet is enough?', s: 'N_min(θ)', in: 'Target coverage θ.', out: 'Minimum number of aircraft for zero expected loss (θ = ½) or full coverage (θ = 1).', go: 's8' },
];
function initS1() {
  const box = $('#pipeline');
  box.innerHTML = PIPE.map((p, i) => `<button class="pipe-box${i === 0 ? ' on' : ''}" data-i="${i}"><b>${p.k}</b><span>${p.t}</span><small>${p.s}</small></button>`).join('');
  const showP = i => {
    const p = PIPE[i];
    $$('.pipe-box', box).forEach((b, j) => b.classList.toggle('on', i === j));
    $('#pipeDetail').innerHTML = `<b>${p.k}: ${p.t}</b><br><b>Takes in:</b> ${p.in}<br><b>Produces:</b> ${p.out}<br><a href="#${p.go}">Go to the section that explains this →</a>`;
  };
  box.addEventListener('click', e => { const b = e.target.closest('.pipe-box'); if (b) showP(+b.dataset.i); });
  showP(0);
}

/* ---------------- §2 ---------------- */
const PARAM_FIELDS = [
  ['N', 'Aircraft N', 1, 1], ['Tdays', 'Horizon T (days)', 1, 1], ['tp', 'Sortie length τp (h)', 0.5, 0.5],
  ['ts', 'Safe period τs (h)', 0, 0.5], ['tr', 'Turnaround τr (h)', 0, 0.5], ['F', 'Hours per aircraft F (h)', 1, 1],
];
function initS2() {
  $('#paramControls').innerHTML = PARAM_FIELDS.map(([k, l, min, step]) =>
    `<div class="ctl"><label for="p-${k}">${l}</label><input type="number" id="p-${k}" data-k="${k}" min="${min}" step="${step}"></div>`).join('');
  $('#barrierEditor').innerHTML = `<tr><th>Type</th><th>Barriers n<sub>k</sub></th><th>Value per barrier v<sub>k</sub></th></tr>` +
    [0, 1, 2].map(k => `<tr><td><span class="swatch" style="background:${COL(k)}"></span>${NAMES[k]}</td><td><input type="number" min="1" step="1" data-arr="n" data-i="${k}" style="width:6rem"></td><td><input type="number" min="0.1" step="any" data-arr="v" data-i="${k}" style="width:6rem"></td></tr>`).join('');
  const onInput = e => {
    const t = e.target;
    const x = parseFloat(t.value);
    if (!Number.isFinite(x)) return;
    if (t.dataset.k) {
      const k = t.dataset.k;
      const ok = { N: x >= 1 && Number.isInteger(x), Tdays: x >= 1, tp: x > 0, ts: x >= 0, tr: x >= 0, F: x > 0 }[k];
      if (!ok) { t.style.borderColor = 'var(--bad)'; return; }
      P[k] = x;
    } else if (t.dataset.arr) {
      const ok = t.dataset.arr === 'n' ? x >= 1 && Number.isInteger(x) : x > 0;
      if (!ok) { t.style.borderColor = 'var(--bad)'; return; }
      P[t.dataset.arr][+t.dataset.i] = x;
    } else return;
    t.style.borderColor = '';
    paramsChanged();
  };
  $('#paramControls').addEventListener('input', onInput);
  $('#barrierEditor').addEventListener('input', onInput);
  $('#resetParams').addEventListener('click', () => { P = JSON.parse(JSON.stringify(PAPER)); syncParamInputs(); paramsChanged(); });
  syncParamInputs();
}
function syncParamInputs() {
  PARAM_FIELDS.forEach(([k]) => { $(`#p-${k}`).value = P[k]; $(`#p-${k}`).style.borderColor = ''; });
  $$('#barrierEditor input').forEach(i => { i.value = P[i.dataset.arr][+i.dataset.i]; i.style.borderColor = ''; });
}
function paramsChanged() {
  covH = null; game = null; wlN = null; planCache = null;
  fillChips();
  if (current && render[current]) render[current]();
}
render.s2 = () => {
  const { d } = compute();
  const rows = [
    ['Horizon in hours', `T = ${P.Tdays} days × 24 = <b>${fmtNum(d.T)} h</b>`],
    ['Protection window', `W = τ<sub>p</sub> + τ<sub>s</sub> = ${fmtNum(P.tp)} + ${fmtNum(P.ts)} = <b>${fmtNum(d.W)} h</b>`],
    ['Window multiplier', `μ = W / τ<sub>p</sub> = ${fmtNum(d.W)} / ${fmtNum(P.tp)} = <b>${fmtNum(d.mu)}</b> protection-hours per flying hour`],
    ['Minimum gap between one aircraft\'s sortie starts', `G = τ<sub>p</sub> + τ<sub>r</sub> = ${fmtNum(P.tp)} + ${fmtNum(P.tr)} = <b>${fmtNum(d.G)} h</b>`],
    ['Total fleet hours', `B = N·F = ${P.N} × ${fmtNum(P.F)} = <b>${fmtNum(d.B)} h</b>`],
    ['Whole sorties available', `N<sub>srt</sub> = ⌊B / τ<sub>p</sub>⌋ = ⌊${fmtNum(d.B)} / ${fmtNum(P.tp)}⌋ = <b>${d.Nsrt}</b>`],
    ['Usable budget', `B<sub>eff</sub> = N<sub>srt</sub>·τ<sub>p</sub> = ${d.Nsrt} × ${fmtNum(P.tp)} = <b>${fmtNum(d.Beff)} h</b>`],
    ['Total barriers', `N<sub>b</sub> = Σ n<sub>k</sub> = ${P.n.join(' + ')} = <b>${d.Nb}</b>`],
  ];
  $('#deriveChain').innerHTML = rows.map(([a, b]) => `<li><b>${a}</b><div class="calc">${b}</div></li>`).join('');
  $('#remark1Gap').textContent = `B − B_eff = ${fmtNum(d.B)} − ${fmtNum(d.Beff)} = ${fmtNum(d.B - d.Beff)} h (less than one ${fmtNum(P.tp)}-hour sortie)`;
};

/* ---------------- §3 ---------------- */
let covK = 0, covH = null, covMode = 'even';
function initS3() {
  $('#covType').innerHTML = [0, 1, 2].map(k => `<button data-v="${k}" class="${k === 0 ? 'on' : ''}">${NAMES[k]}</button>`).join('');
  $('#covType').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    covK = +b.dataset.v; covH = null;
    $$('#covType button').forEach(x => x.classList.toggle('on', x === b));
    render.s3();
  });
  $('#covMode').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    covMode = b.dataset.v;
    $$('#covMode button').forEach(x => x.classList.toggle('on', x === b));
    render.s3();
  });
  $('#covH').addEventListener('input', e => { covH = +e.target.value; render.s3(); });
}
function unionLength(iv, lo, hi) {
  const s = iv.map(([a, b]) => [Math.max(lo, a), Math.min(hi, b)]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  let tot = 0, ca = null, cb = null;
  s.forEach(([a, b]) => {
    if (ca === null || a > cb) { if (ca !== null) tot += cb - ca; ca = a; cb = b; } else cb = Math.max(cb, b);
  });
  if (ca !== null) tot += cb - ca;
  return tot;
}
render.s3 = () => {
  const { d, s1 } = compute();
  const k = covK, n = P.n[k], hMax = Math.floor((n * d.T) / d.mu);
  if (covH === null) covH = Math.round(Math.min(s1.h[k], hMax));
  covH = clamp(covH, 0, hMax);
  const sl = $('#covH'); sl.max = hMax; sl.value = covH;
  $('#covHOut').textContent = `${covH} h`;

  const win = Math.min(168, d.T);
  const perBarrierSorties = covH / P.tp / n;                    // sorties per barrier per period
  const delta = perBarrierSorties > 0 ? d.T / perBarrierSorties : Infinity;
  const rowsStarts = [];
  for (let i = 0; i < n; i++) {
    const even = [];
    const off = Number.isFinite(delta) ? ((i + 0.5) * delta) / n % delta : 0;
    if (Number.isFinite(delta)) for (let t = off; t < win; t += delta) even.push(t);
    if (covMode === 'even') rowsStarts.push(even);
    else {
      const byDay = {};
      even.forEach(t => { const dd = Math.floor(t / 24); byDay[dd] = (byDay[dd] || 0) + 1; });
      const cl = [];
      Object.entries(byDay).forEach(([dd, c]) => { for (let j = 0; j < c; j++) cl.push(+dd * 24 + 6 + j * P.tp); });
      rowsStarts.push(cl);
    }
  }
  const measured = sum(rowsStarts.map(st => unionLength(st.map(t => [t, t + d.W]), 0, win) / win)) / n;

  const Wd = 760, rh = 22, H = 40 + n * rh + 24;
  const f = frame({ W: Wd, H, ml: 64, mr: 12, mt: 10, mb: 34, x0: 0, x1: win, y0: 0, y1: 1, xt: Array.from({ length: Math.floor(win / 24) + 1 }, (_, i) => i * 24), xf: t => `day ${t / 24 + 1}`, xl: 'Hours into the period' });
  let body = f.s;
  rowsStarts.forEach((st, i) => {
    const y = 12 + i * rh;
    body += `<text x="58" y="${y + 13}" text-anchor="end">${SH[k]}${i + 1}</text><rect x="${f.sx(0)}" y="${y}" width="${f.sx(win) - f.sx(0)}" height="${rh - 6}" rx="3" fill="var(--surface-2)"/>`;
    st.forEach(t => {
      const a = f.sx(t), b = f.sx(Math.min(win, t + P.tp)), c = f.sx(Math.min(win, t + d.W));
      body += `<g ${tipAttr(`${SH[k]}${i + 1}: departs ${dayTime(t)}, safe until ${dayTime(t + d.W)}`)}><rect x="${b}" y="${y}" width="${Math.max(0, c - b)}" height="${rh - 6}" fill="${SOFT(k)}"/><rect x="${a}" y="${y}" width="${Math.max(1, b - a)}" height="${rh - 6}" fill="${COL(k)}"/></g>`;
    });
  });
  $('#covChart').innerHTML = svgWrap(Wd, H, body, 'Sortie blocks per barrier');

  const Pk = cover(P, d, k, covH), U = utilOf(P, d, k, covH);
  $('#covStats').innerHTML = `
    <div class="stat"><b>Protection-hours created</b><span>${fmtNum(d.mu * covH)}</span><small>μ·h = ${fmtNum(d.mu)} × ${covH}</small></div>
    <div class="stat"><b>Barrier-hours to cover</b><span>${fmtNum(n * d.T)}</span><small>n·T = ${n} × ${d.T}</small></div>
    <div class="stat"><b>Coverage P<sub>k</sub> (Eq. 1)</b><span>${fmt(100 * Pk, 1)}%</span><small>${fmtNum(d.mu * covH)} / ${fmtNum(n * d.T)}</small></div>
    <div class="stat ${Math.abs(measured - Pk) > 0.02 ? 'bad' : ''}"><b>Actually covered in the chart</b><span>${fmt(100 * measured, 1)}%</span><small>${covMode === 'even' ? 'matches Eq. 1 (edges aside)' : 'overlapping windows count once'}</small></div>
    <div class="stat ${U >= 0 ? 'good' : 'bad'}"><b>Payoff if attacked (§4)</b><span>${sgn(U)}</span><small>v(2P−1) with v = ${P.v[k]}</small></div>`;
  $('#covNote').innerHTML = covMode === 'even'
    ? `Sorties are spaced every Δ = ${Number.isFinite(delta) ? fmt(delta, 1) : '∞'} h on each barrier, so safe windows never overlap and Eq. 1 is exact. Full coverage needs h = n·T/μ = ${hMax} h (Remark 2).`
    : 'Same number of sorties, but flown back-to-back each morning. The safe windows overlap and those hours are wasted, so real coverage falls below Eq. 1. This is why Stage 3 spreads sorties out in time.';
};

/* ---------------- §4 ---------------- */
function initS4() {
  $('#payP').addEventListener('input', render.payoff);
  const set = (hH, hM) => { game = [hH, hM]; render.s4(); };
  $('#gH').addEventListener('input', e => {
    const { d } = compute(); const hH = +e.target.value; let hM = game[1];
    if (hH + hM > d.Beff) hM = d.Beff - hH; set(hH, hM);
  });
  $('#gM').addEventListener('input', e => {
    const { d } = compute(); const hM = +e.target.value; let hH = game[0];
    if (hH + hM > d.Beff) hH = d.Beff - hM; set(hH, hM);
  });
  $('#gEqual').addEventListener('click', () => { const { d } = compute(); set(d.Beff / 3, d.Beff / 3); });
  $('#gOpt').addEventListener('click', () => { const { s1 } = compute(); set(s1.h[0], s1.h[1]); });
  $('#gShift').addEventListener('click', () => {
    const { d } = compute();
    const h = [game[0], game[1], d.Beff - game[0] - game[1]];
    const U = h.map((x, k) => utilOf(P, d, k, x));
    const lo = U.indexOf(Math.min(...U)), hi = U.indexOf(Math.max(...U));
    if (lo === hi) return;
    const slope = k => (2 * d.mu * P.v[k]) / (P.n[k] * d.T);
    const delta = Math.min(h[hi], (U[hi] - U[lo]) / (slope(lo) + slope(hi)));
    h[hi] -= delta; h[lo] += delta;
    $('#gameMsg').innerHTML = `Moved ${fmt(delta, 1)} h from <b class="t${hi}">${NAMES[hi]}</b> (strongest) to <b class="t${lo}">${NAMES[lo]}</b> (weakest). Those two now tie; keep pressing until all three do.`;
    set(h[0], h[1]);
  });
}
let game = null;
render.payoff = () => {
  const p = +$('#payP').value;
  $('#payPOut').textContent = `${Math.round(p * 100)}%`;
  const vmax = Math.max(...P.v);
  const Wd = 560, H = 260;
  const f = frame({ W: Wd, H, ml: 46, mr: 90, mt: 12, mb: 36, x0: 0, x1: 1, y0: -vmax, y1: vmax, xt: [0, .25, .5, .75, 1], xf: t => `${t * 100}%`, yt: niceTicks(-vmax, vmax, 6), xl: 'Coverage probability P' });
  let b = f.s + `<line x1="${f.sx(.5)}" x2="${f.sx(.5)}" y1="${f.sy(vmax)}" y2="${f.sy(-vmax)}" stroke="var(--axis)" stroke-dasharray="3 3"/><text x="${f.sx(.5) + 4}" y="${f.sy(vmax) + 10}">50%: break-even</text>`;
  b += `<line x1="${f.sx(p)}" x2="${f.sx(p)}" y1="${f.sy(vmax)}" y2="${f.sy(-vmax)}" stroke="var(--text-2)" stroke-width="1"/>`;
  [0, 1, 2].forEach(k => {
    const v = P.v[k], u = v * (2 * p - 1);
    b += poly([[f.sx(0), f.sy(-v)], [f.sx(1), f.sy(v)]], `stroke="${COL(k)}" stroke-width="2"`);
    b += `<circle cx="${f.sx(p)}" cy="${f.sy(u)}" r="5" fill="${COL(k)}" stroke="var(--surface)" stroke-width="2" ${tipAttr(`${NAMES[k]} (v = ${v}): U = ${sgn(u)}`)}/>`;
    b += `<text x="${f.sx(1) + 6}" y="${f.sy(v) + 4}" class="lbl-strong">${NAMES[k]}: ${sgn(u, 1)}</text>`;
  });
  $('#payChart').innerHTML = svgWrap(Wd, H, b, 'Payoff versus coverage');
  $('#payLegend').innerHTML = [0, 1, 2].map(k => `<span><i style="background:${COL(k)}"></i>${NAMES[k]}, v = ${P.v[k]}, slope 2v = ${2 * P.v[k]}</span>`).join('');
};
render.s4 = () => {
  render.payoff();
  const { d, s1 } = compute();
  if (!game) game = [d.Beff / 3, d.Beff / 3];
  const h = [game[0], game[1], Math.max(0, d.Beff - game[0] - game[1])];
  ['gH', 'gM'].forEach((id, k) => { const s = $('#' + id); s.max = d.Beff; s.value = h[k]; $(`#${id}Out`).textContent = `${fmt(h[k], 0)} h`; });
  $('#gLOut').textContent = `${fmt(h[2], 0)} h`;
  const U = h.map((x, k) => utilOf(P, d, k, x)), Pk = h.map((x, k) => cover(P, d, k, x));
  const g = Math.min(...U), tgt = U.indexOf(g), vmax = Math.max(...P.v);
  $('#gameBars').innerHTML = [0, 1, 2].map(k => {
    const u = U[k], left = 50 + (Math.min(0, u) / vmax) * 50, w = (Math.abs(u) / vmax) * 50;
    return `<div class="ubar-row ${k === tgt ? 'target' : ''}"><div><span class="swatch" style="background:${COL(k)}"></span>${NAMES[k]}<br><small class="widget-sub">P = ${fmt(100 * Math.min(1, Pk[k]), 1)}%${Pk[k] > 1 ? ' (capped)' : ''}</small></div>
      <div class="ubar-track" ${tipAttr(`${NAMES[k]}: U = v(2P−1) = ${P.v[k]} × (2 × ${fmt(Math.min(1, Pk[k]), 3)} − 1) = ${sgn(u)}`)}><div class="zero"></div><div class="bar" style="left:${left}%;width:${w}%;background:${COL(k)}"></div></div>
      <div class="val">${sgn(u)}${k === tgt ? '<br><span class="target-tag">attacker hits</span>' : ''}</div></div>`;
  }).join('');
  const gap = s1.z - g, close = gap < 0.005 * vmax;
  $('#gameStats').innerHTML = `
    <div class="stat ${g >= 0 ? 'good' : 'bad'}"><b>Your game value</b><span>${sgn(g)}</span><small>= the lowest bar</small></div>
    <div class="stat"><b>Best possible, z*</b><span>${sgn(s1.z)}</span><small>from Stage 1 (§5)</small></div>
    <div class="stat ${close ? 'good' : ''}"><b>You are short by</b><span>${close ? '≈ 0' : fmt(gap)}</span><small>${close ? 'you found the equilibrium' : 'raise the weakest type'}</small></div>`;
  if (close) $('#gameMsg').innerHTML = 'All three payoffs are (nearly) equal. The attacker gains nothing by switching targets: this is the Stackelberg equilibrium of Remark 3.';
};

/* ---------------- §5 ---------------- */
let s1Shown = 1;
function initS5() {
  $('#s1Next').addEventListener('click', () => { s1Shown++; render.s1steps(); });
  $('#s1All').addEventListener('click', () => { s1Shown = 99; render.s1steps(); });
  $('#s1Reset').addEventListener('click', () => { s1Shown = 1; render.s1steps(); });
  $('#wlN').addEventListener('input', e => { wlN = +e.target.value; render.water(); });
}
render.s1steps = () => {
  const { d, s1 } = compute();
  const A = s1.active, Nb = sum(A.map(k => P.n[k])), sd = sum(A.map(k => s1.dk[k])), c = (d.T * Nb) / (2 * d.mu);
  const typeLine = k => `<span class="t${k}">${NAMES[k]}</span>`;
  const steps = [
    `<b>Sensitivities</b> d<sub>k</sub> = n<sub>k</sub>T / (2μv<sub>k</sub>)<div class="calc">${[0, 1, 2].map(k => `${typeLine(k)}: ${P.n[k]} × ${d.T} / (2 × ${fmtNum(d.mu)} × ${P.v[k]}) = <b>${fmt(s1.dk[k], 3)}</b>`).join('<br>')}</div>`,
    `<b>Two sums</b> over the active types (${A.map(k => NAMES[k]).join(', ')})<div class="calc">Σd<sub>k</sub> = ${A.map(k => fmt(s1.dk[k], 2)).join(' + ')} = <b>${fmt(sd, 3)}</b><br>TN<sub>b</sub>/(2μ) = ${d.T} × ${Nb} / (2 × ${fmtNum(d.mu)}) = <b>${fmt(c, 2)} h</b>, the hours that would hold every barrier at exactly 50%</div>`,
    `<b>Game value</b> z* = (B<sub>eff</sub> − TN<sub>b</sub>/(2μ)) / Σd<sub>k</sub><div class="calc">z* = (${fmtNum(d.Beff)} − ${fmt(c, 2)}) / ${fmt(sd, 3)} = <b>${fmt(s1.z, 4)}</b> ${s1.z > 0 ? '→ net gain (Remark 4)' : '→ net loss even when patrolling optimally (Remark 4)'}</div>`,
    `<b>Optimal hours</b> h*<sub>k</sub> = d<sub>k</sub>(z* + v<sub>k</sub>)<div class="calc">${[0, 1, 2].map(k => A.includes(k) ? `${typeLine(k)}: ${fmt(s1.dk[k], 3)} × (${fmt(s1.z, 4)} + ${P.v[k]}) = <b>${fmt(s1.h[k], 2)} h</b>` : `${typeLine(k)}: inactive → <b>0 h</b>`).join('<br>')}<br>Budget check: ${s1.h.map(x => fmt(x, 2)).join(' + ')} = ${fmt(sum(s1.h), 2)} = B<sub>eff</sub> ✓</div>`,
    `<b>Check the attacker is indifferent</b><div class="calc">${[0, 1, 2].map(k => `${typeLine(k)}: P = ${fmt(s1.P[k], 4)}, U<sub>d</sub> = ${P.v[k]}(2 × ${fmt(s1.P[k], 4)} − 1) = <b>${sgn(s1.U[k], 4)}</b>${A.includes(k) ? '' : ' (inactive, ≥ z* ✓)'}`).join('<br>')}<br>Every active type pays exactly z* ✓</div>`,
  ];
  if (s1.log.length) steps.unshift(`<b>Remark 5 kicked in first.</b><div class="calc">${s1.log.map(l => `With all types: z* = ${fmt(l.z, 3)} gave negative hours for ${l.removed.map(k => NAMES[k]).join(', ')} → removed, re-solved.`).join('<br>')}</div>`);
  $('#s1Steps').innerHTML = steps.map((s, i) => `<li class="${i < s1Shown ? '' : 'hidden-step'}">${s}</li>`).join('');
  $('#s1Next').disabled = s1Shown >= steps.length;
};
let wlN = null;
function maxSaneN() {
  let best = 1;
  for (let N = 1; N <= 400; N++) {
    const p = { ...P, N }, d = derive(p), s = stage1(p, d);
    if (Math.max(...s.P) <= 1 + 1e-9) best = N; else break;
  }
  return best;
}
render.water = () => {
  const Nmax = maxSaneN();
  if (wlN === null) wlN = Math.min(P.N, Nmax);
  wlN = clamp(wlN, 1, Nmax);
  const sl = $('#wlN'); sl.max = Nmax; sl.value = wlN;
  const p = { ...P, N: wlN }, d = derive(p), s1 = stage1(p, d);
  const dTop = derive({ ...P, N: Nmax }), zTop = stage1({ ...P, N: Nmax }, dTop).z;
  $('#wlNOut').textContent = `${wlN} aircraft → B_eff = ${fmtNum(d.Beff)} h`;
  const vmax = Math.max(...P.v), x0 = -1.15 * vmax, x1 = Math.max(zTop, 0) + 0.15 * vmax;
  const need = z => sum([0, 1, 2].map(k => s1.dk[k] * Math.max(0, z + P.v[k])));
  const y1 = need(x1) * 1.05;
  const Wd = 720, H = 300;
  const f = frame({ W: Wd, H, ml: 58, mr: 16, mt: 14, mb: 38, x0, x1, y0: 0, y1, xt: niceTicks(x0, x1, 8), yt: niceTicks(0, y1, 5), xl: 'Target payoff level z', yl: 'Flying hours needed' });
  let b = f.s;
  b += `<line x1="${f.sx(0)}" x2="${f.sx(0)}" y1="${f.sy(y1)}" y2="${f.sy(0)}" stroke="var(--axis)" stroke-dasharray="2 3"/>`;
  [0, 1, 2].forEach(k => {
    b += poly([[f.sx(x0), f.sy(0)], [f.sx(-P.v[k]), f.sy(0)], [f.sx(x1), f.sy(s1.dk[k] * (x1 + P.v[k]))]], `stroke="${COL(k)}" stroke-width="1.5" stroke-dasharray="5 4"`);
    const kx = -P.v[k];
    b += `<circle cx="${f.sx(kx)}" cy="${f.sy(need(kx))}" r="4.5" fill="${COL(k)}" stroke="var(--surface)" stroke-width="2" ${tipAttr(`At z = −v = ${-P.v[k]}, ${NAMES[k]} starts receiving hours`)}/>`;
    b += `<text x="${f.sx(kx)}" y="${f.sy(need(kx)) - 9}" text-anchor="middle">${NAMES[k]} on</text>`;
  });
  const kinks = [x0, ...P.v.map(v => -v).sort((a, c) => a - c), x1];
  b += poly(kinks.map(z => [f.sx(z), f.sy(need(z))]), 'stroke="var(--text)" stroke-width="2.5"');
  b += `<line x1="${f.sx(x0)}" x2="${f.sx(x1)}" y1="${f.sy(d.Beff)}" y2="${f.sy(d.Beff)}" stroke="var(--accent)" stroke-width="2"/><text x="${f.sx(x0) + 4}" y="${f.sy(d.Beff) - 6}" class="lbl-strong">your budget B_eff = ${fmtNum(d.Beff)} h</text>`;
  b += `<line x1="${f.sx(s1.z)}" x2="${f.sx(s1.z)}" y1="${f.sy(d.Beff)}" y2="${f.sy(0)}" stroke="var(--accent)" stroke-dasharray="3 3"/>`;
  b += `<circle cx="${f.sx(s1.z)}" cy="${f.sy(d.Beff)}" r="6" fill="var(--accent)" stroke="var(--surface)" stroke-width="2" ${tipAttr(`z* = ${fmt(s1.z, 3)}`)}/><text x="${f.sx(s1.z) + 8}" y="${f.sy(0) - 8}" class="lbl-strong">z* = ${fmt(s1.z, 2)}</text>`;
  $('#wlChart').innerHTML = svgWrap(Wd, H, b, 'Total hours needed versus target payoff');
  const caseOf = k => (s1.z > 0 ? ['Case 1', 'ok'] : s1.z > -P.v[k] ? ['Case 2', 'warn'] : ['Case 3 · inactive', 'bad']);
  $('#wlTable').innerHTML = `<tr><th>Type</th><th>v<sub>k</sub></th><th>d<sub>k</sub></th><th>z* + v<sub>k</sub></th><th>h*<sub>k</sub></th><th>P*<sub>k</sub></th><th>Regime</th></tr>` +
    [0, 1, 2].map(k => { const [c, cls] = caseOf(k); return `<tr><td><span class="swatch" style="background:${COL(k)}"></span>${NAMES[k]}</td><td>${P.v[k]}</td><td>${fmt(s1.dk[k], 2)}</td><td>${sgn(s1.z + P.v[k])}</td><td>${fmt(s1.h[k], 1)}</td><td>${fmt(100 * s1.P[k], 1)}%</td><td><span class="pill ${cls}">${c}</span></td></tr>`; }).join('');
  $('#wlLog').innerHTML = s1.log.length
    ? `Remark 5 in action: ${s1.log.map(l => `the all-types formula gave z* = ${fmt(l.z, 2)} ≤ −v for ${l.removed.map(k => NAMES[k]).join(', ')}, so it was dropped and the rest re-solved`).join('; then ')}.`
    : `The slider stops at N = ${Nmax}: beyond it some type would need more than 100% coverage, where the simple model saturates. Try N below ${Math.ceil(((derive(P).T * derive(P).Nb) / (2 * derive(P).mu)) / P.F)} to enter the loss regime.`;
};
render.s5 = () => { render.s1steps(); render.water(); };

/* ---------------- §6 ---------------- */
let wheelRot = 0, tally = null;
function initS6() {
  $('#spinBtn').addEventListener('click', () => {
    const { mix } = compute();
    const j = drawPlan(mix.plans);
    let a = 0; for (let i = 0; i < j; i++) a += mix.plans[i].s * 360;
    const theta = a + mix.plans[j].s * 360 * (0.2 + 0.6 * Math.random());
    wheelRot += 1440 + (((-theta - wheelRot) % 360) + 360) % 360;
    $('#wheelSvg').style.transform = `rotate(${wheelRot}deg)`;
    $('#spinBtn').disabled = true;
    setTimeout(() => {
      $('#spinBtn').disabled = false;
      record(mix, j);
      const pl = mix.plans[j];
      $('#drawnPlan').innerHTML = `This month: <span class="big">Plan ${pl.label}</span> = (${pl.m.map((m, k) => `<span class="t${k}">${m}${SH[k]}</span>`).join(', ')}) sorties`;
    }, 1650);
  });
  $('#sim100').addEventListener('click', () => {
    const { mix } = compute();
    for (let i = 0; i < 120; i++) record(mix, drawPlan(mix.plans), true);
    render.simTable();
  });
}
function drawPlan(plans) {
  let u = Math.random();
  for (let j = 0; j < plans.length; j++) { u -= plans[j].s; if (u < 0) return j; }
  return plans.length - 1;
}
function record(mix, j, quiet) {
  tally.months++;
  mix.plans[j].m.forEach((m, k) => { tally.sum[k] += m; });
  tally.count[j]++;
  if (!quiet) render.simTable();
}
render.simTable = () => {
  const { mStar, mix } = compute();
  const M = tally.months;
  $('#simTable').innerHTML = `<tr><th>After ${M} month${M === 1 ? '' : 's'}</th>${[0, 1, 2].map(k => `<th class="t${k}">${NAMES[k]}</th>`).join('')}</tr>` +
    `<tr><td>Target m*<sub>k</sub></td>${mStar.map(x => `<td>${fmt(x, 3)}</td>`).join('')}</tr>` +
    `<tr><td>Average flown</td>${tally.sum.map(x => `<td>${M ? fmt(x / M, 3) : '—'}</td>`).join('')}</tr>` +
    `<tr><td>Times each plan drawn</td><td colspan="3" style="text-align:left">${mix.plans.map((pl, j) => `${pl.label}: ${tally.count[j]}`).join(' · ')}</td></tr>`;
};
render.s6 = () => {
  const { d, s1, mStar, mix } = compute();
  tally = { months: 0, sum: [0, 0, 0], count: mix.plans.map(() => 0) };
  $('#mStarTable').innerHTML = `<tr><th>Type</th><th>h*<sub>k</sub></th><th>m*<sub>k</sub> = h*/τ<sub>p</sub></th><th>Floor</th><th>Fraction</th></tr>` +
    [0, 1, 2].map(k => `<tr><td><span class="swatch" style="background:${COL(k)}"></span>${NAMES[k]}</td><td>${fmt(s1.h[k], 2)}</td><td>${fmt(mStar[k], 3)}</td><td>${mix.fl[k]}</td><td>${fmt(mix.fr[k], 3)}</td></tr>`).join('') +
    `<tr class="hl"><td>Total</td><td>${fmt(sum(s1.h), 2)}</td><td>${fmt(sum(mStar), 3)} = N<sub>srt</sub></td><td>${sum(mix.fl)}</td><td>r = ${mix.r}</td></tr>`;
  const cands = mix.r === 0 ? 1 : binom(mix.fr.filter(f => f > 0).length, mix.r);
  const check = [0, 1, 2].map(k => sum(mix.plans.map(pl => pl.m[k] * P.tp * pl.s)));
  $('#candList').innerHTML = `<p>${mix.r === 0 ? 'Every m*<sub>k</sub> is already whole, so one plan suffices and no mixing is needed.' : `Round <b>${mix.r}</b> of the fractional types up: C(${mix.fr.filter(f => f > 0).length}, ${mix.r}) = ${cands} candidate plan${cands === 1 ? '' : 's'}. The probabilities below solve Eq. 8 exactly:`}</p>` +
    `<div class="tbl-wrap"><table class="tbl"><tr><th>Plan</th>${[0, 1, 2].map(k => `<th class="t${k}">m<sub>${SH[k]}</sub></th>`).join('')}<th>Probability s<sub>j</sub></th><th style="width:30%"></th></tr>` +
    mix.plans.map(pl => `<tr><td><b>${pl.label}</b></td>${pl.m.map((m, k) => `<td>${m}${pl.up.includes(k) ? ' <span class="pill info">↑</span>' : ''}</td>`).join('')}<td>${fmt(pl.s, 4)}</td><td><div style="height:10px;border-radius:4px;background:var(--accent);width:${100 * pl.s}%"></div></td></tr>`).join('') +
    `<tr class="hl"><td>Expected hours Σ<sub>j</sub> A<sub>jk</sub>s<sub>j</sub></td>${check.map(x => `<td>${fmt(x, 2)}</td>`).join('')}<td colspan="2">= h* ✓, gap Σε = ${fmt(Math.abs(sum(check) - sum(s1.h)), 6)}</td></tr></table></div>` +
    `<p class="widget-sub">↑ marks a type rounded up in that plan. Each plan totals N<sub>srt</sub> = ${d.Nsrt} sorties.</p>`;
  $('#supportCount').textContent = `${mix.plans.length} plan${mix.plans.length === 1 ? '' : 's'}`;
  // wheel
  let a = 0, svg = '';
  const greys = ['var(--accent)', '#6250d6', '#008300', '#9a5b00'];
  mix.plans.forEach((pl, j) => {
    const a0 = a, a1 = a + pl.s * 360; a = a1;
    const pt = deg => [100 * Math.sin((deg * Math.PI) / 180), -100 * Math.cos((deg * Math.PI) / 180)];
    const [x0, y0] = pt(a0), [x1, y1] = pt(a1), mid = pt((a0 + a1) / 2);
    const path = pl.s > 0.9999 ? `<circle r="100" fill="${greys[j % 4]}"/>` : `<path d="M0 0 L${x0} ${y0} A100 100 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1} Z" fill="${greys[j % 4]}" stroke="var(--surface)" stroke-width="2"/>`;
    svg += path + (pl.s > 0.06 ? `<text x="${mid[0] * 0.6}" y="${mid[1] * 0.6 + 5}" text-anchor="middle">${pl.label} ${Math.round(pl.s * 100)}%</text>` : '');
  });
  $('#wheelSvg').innerHTML = svg;
  $('#drawnPlan').textContent = 'Spin to pick a plan.';
  render.simTable();
  $('#canonMix').textContent = [0, 1, 2].map(k => `${NAMES[k]} ${fmt(s1.h[k] / d.Beff, 3)}`).join(', ');
  cgReset();
};
function binom(n, r) { let c = 1; for (let i = 0; i < r; i++) c = (c * (n - i)) / (i + 1); return Math.round(c); }

/* ---------------- §6.3 column generation animation ---------------- */

// Small dense simplex (Bland's rule) for min c·x s.t. A x = b, x ≥ 0, b ≥ 0, started from a basis whose
// columns form the identity. Returns x and the duals y (= c_B B⁻¹, read off the initial identity columns).
function lpSolve(A, b, c, basis0) {
  const m = A.length, n = c.length, T = A.map((r, i) => [...r, b[i]]), basis = basis0.slice();
  for (let it = 0; it < 500; it++) {
    let enter = -1;
    for (let j = 0; j < n && enter < 0; j++) {
      if (basis.includes(j)) continue;
      let r = c[j]; for (let i = 0; i < m; i++) r -= c[basis[i]] * T[i][j];
      if (r < -1e-9) enter = j;
    }
    if (enter < 0) break;
    let row = -1, best = Infinity;
    for (let i = 0; i < m; i++) if (T[i][enter] > 1e-12) { const q = T[i][n] / T[i][enter]; if (q < best - 1e-12 || (Math.abs(q - best) <= 1e-12 && basis[i] < basis[row])) { best = q; row = i; } }
    if (row < 0) break; // unbounded (cannot happen here)
    const pv = T[row][enter];
    for (let j = 0; j <= n; j++) T[row][j] /= pv;
    for (let i = 0; i < m; i++) if (i !== row && Math.abs(T[i][enter]) > 0) { const fct = T[i][enter]; for (let j = 0; j <= n; j++) T[i][j] -= fct * T[row][j]; }
    basis[row] = enter;
  }
  const x = new Array(n).fill(0); basis.forEach((j, i) => { x[j] = T[i][n]; });
  const y = basis0.map((_, i) => basis.reduce((acc, j, r) => acc + c[j] * T[r][basis0[i]], 0));
  return { x, y };
}

// Restricted master: min Σ(ε⁺ + ε⁻) s.t. Σ_j m_jk s_j + ε⁻_k − ε⁺_k = m*_k, Σ_j s_j = 1.
// Columns: plans, then ε⁻ (k), ε⁺ (k), then one artificial for the probability row.
function cgMaster(cols, mStar) {
  const K = mStar.length, J = cols.length, n = J + 2 * K + 1, BIG = 1e6;
  const A = [], b = [];
  for (let k = 0; k < K; k++) { const r = new Array(n).fill(0); cols.forEach((m, j) => { r[j] = m[k]; }); r[J + k] = 1; r[J + K + k] = -1; A.push(r); b.push(mStar[k]); }
  { const r = new Array(n).fill(0); for (let j = 0; j < J; j++) r[j] = 1; r[n - 1] = 1; A.push(r); b.push(1); }
  const c = new Array(n).fill(0); for (let k = 0; k < 2 * K; k++) c[J + k] = 1; c[n - 1] = BIG;
  const { x, y } = lpSolve(A, b, c, [...Array(K).keys()].map(k => J + k).concat([n - 1]));
  const s = x.slice(0, J), point = mStar.map((_, k) => cols.reduce((a, m, j) => a + s[j] * m[k], 0));
  const gap = x.slice(J, J + 2 * K).reduce((a, v) => a + v, 0);
  return { s, point, gap, lambda: y.slice(0, K), nu: y[K] };
}

const cg = { cols: [], phase: 'solve', round: 0, res: null, price: null, done: false, timer: null, added: -1 };
function cgStartCols(mode) {
  const N = compute().d.Nsrt;
  if (mode === 'canon') return [0, 1, 2].map(k => [0, 1, 2].map(i => (i === k ? N : 0)));
  const w = mode === 'vp' ? P.n.map((n, k) => n * P.v[k]) : [1, 1, 1], tw = sum(w);
  const m = w.map(x => Math.floor((N * x) / tw)); m[2] += N - sum(m);
  return [m];
}
function cgReset() {
  if (!$('#cgSvg')) return;
  if (cg.timer) { clearInterval(cg.timer); cg.timer = null; $('#cgPlay').innerHTML = '&#9654; Play'; }
  Object.assign(cg, { cols: cgStartCols($('#cgStart').value), phase: 'solve', round: 0, res: null, price: null, done: false, added: -1 });
  $('#cgStep').disabled = false;
  cgDraw('Press Step: solve the restricted LP over the plans collected so far.');
}
function cgStep() {
  if (cg.done) return;
  const { d, mStar } = compute(), N = d.Nsrt;
  if (cg.phase === 'solve') {
    cg.round++; cg.res = cgMaster(cg.cols, mStar); cg.price = null; cg.added = -1;
    cg.phase = 'price';
    const r = cg.res;
    cgDraw(`Round ${cg.round}: the best mix of the ${cg.cols.length} plan(s) reaches the cross; it misses m* by Σ|ε| = ${fmt(r.gap, 2)} sorties. ` +
      `Duals λ = (${r.lambda.map(x => fmt(x, 2)).join(', ')}), ν = ${fmt(r.nu, 2)}: a positive λ<sub>k</sub> marks a type the mix under-covers.`);
  } else if (cg.phase === 'price') {
    const r = cg.res, scores = [0, 1, 2].map(k => r.lambda[k] * N + r.nu);
    const kBest = scores.indexOf(Math.max(...scores)), cand = [0, 1, 2].map(i => (i === kBest ? N : 0));
    const exists = cg.cols.some(m => m.join() === cand.join());
    cg.price = { scores, kBest };
    if (scores[kBest] <= 1e-7 || exists) {
      cg.done = true; $('#cgStep').disabled = true;
      if (cg.timer) { clearInterval(cg.timer); cg.timer = null; $('#cgPlay').innerHTML = '&#9654; Play'; }
      cgDraw(r.gap < 1e-6
        ? `Stop: the gap is 0 and no plan has positive reduced cost. The mix uses ${r.s.filter(x => x > 1e-6).length} plan(s) with probabilities ${r.s.map(x => fmt(x, 3)).join(', ')}.${$('#cgStart').value === 'canon' ? ' Starting from the K canonical plans, as the paper does, the loop stops in round 1: they already contain m* in their hull. That is why §6.4 builds the floor/ceiling plans instead (see the note below).' : ' The columns pricing adds are always canonical plans (all sorties on one type), so in the months they are drawn whole types go unpatrolled; §6.4 and §11 explain why the floor/ceiling plans are the better choice.'}`
        : `Stop: no plan improves the LP (gap ${fmt(r.gap, 2)}).`);
    } else {
      cg.phase = 'solve';
      cgDraw(`Pricing: a plan's value is Σλ<sub>k</sub>m<sub>k</sub> + ν. Putting all ${N} sorties on one type scores ${scores.map((x, k) => `${NAMES[k]} ${fmt(x, 1)}`).join(', ')}. ` +
        `The best is all on <b>${NAMES[kBest]}</b> (positive reduced cost), so that column is added. Press Step to re-solve.`, cand);
      cg.cols.push(cand); cg.added = cg.cols.length - 1;
    }
  }
}
function cgDraw(msg, pending) {
  const { d, mStar } = compute(), N = d.Nsrt;
  const V = [[210, 44], [36, 330], [384, 330]]; // corners: all on High, Medium, Low
  const pt = m => { const w = m.map(x => x / N); return [w[0] * V[0][0] + w[1] * V[1][0] + w[2] * V[2][0], w[0] * V[0][1] + w[1] * V[1][1] + w[2] * V[2][1]]; };
  let b = '';
  for (let i = 1; i < 10; i++) { const t = i / 10; [[0, 1, 2], [1, 2, 0], [2, 0, 1]].forEach(([a, c, e]) => { const p1 = V[a].map((v, z) => v * t + V[c][z] * (1 - t)), p2 = V[a].map((v, z) => v * t + V[e][z] * (1 - t)); b += `<line x1="${p1[0]}" y1="${p1[1]}" x2="${p2[0]}" y2="${p2[1]}" stroke="var(--border)" stroke-width=".6"/>`; }); }
  b += `<polygon points="${V.map(v => v.join(',')).join(' ')}" fill="none" stroke="var(--text-2)" stroke-width="1.2"/>`;
  [['All on High', 0, 0, -22], ['All on Medium', 1, -4, 22], ['All on Low', 2, 4, 22]].forEach(([l, i, dx, dy]) => { b += `<text x="${V[i][0] + dx}" y="${V[i][1] + dy}" text-anchor="${i === 1 ? 'start' : i === 2 ? 'end' : 'middle'}" font-size="11" fill="var(--text-2)">${l}</text>`; });
  // Hull of the current columns (≤ 4 points): sort by angle around the centroid.
  const P2 = cg.cols.map(pt);
  if (P2.length >= 2) {
    const cx = sum(P2.map(q => q[0])) / P2.length, cy = sum(P2.map(q => q[1])) / P2.length;
    const ord = P2.slice().sort((a, c) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(c[1] - cy, c[0] - cx));
    b += `<polygon points="${ord.map(q => q.map(v => v.toFixed(1)).join(',')).join(' ')}" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="1.5"/>`;
  }
  const S = pt(mStar);
  if (cg.res) {
    const X = pt(cg.res.point);
    if (cg.res.gap > 1e-6) b += `<line x1="${X[0]}" y1="${X[1]}" x2="${S[0]}" y2="${S[1]}" stroke="var(--bad)" stroke-width="1.5" stroke-dasharray="4 3"/>`;
    b += `<path d="M${X[0] - 6},${X[1] - 6}L${X[0] + 6},${X[1] + 6}M${X[0] - 6},${X[1] + 6}L${X[0] + 6},${X[1] - 6}" stroke="var(--text)" stroke-width="2"/>`;
  }
  cg.cols.forEach((m, j) => { const q = pt(m); b += `<circle cx="${q[0]}" cy="${q[1]}" r="${j === cg.added ? 8 : 6}" fill="${j === cg.added ? 'var(--ok)' : 'var(--text)'}" stroke="var(--surface)" stroke-width="2" ${tipAttr(`Plan ${j + 1}: (${m.join(', ')}) sorties`)}/><text x="${q[0] - 10}" y="${q[1] + 4}" text-anchor="end" font-size="11" font-weight="700">${j + 1}</text>`; });
  if (pending) { const q = pt(pending); b += `<circle cx="${q[0]}" cy="${q[1]}" r="11" fill="none" stroke="var(--ok)" stroke-width="2.5"/>`; }
  const star = (x, y, r) => [...Array(10).keys()].map(i => { const a = (Math.PI / 5) * i - Math.PI / 2, rr = i % 2 ? r * 0.45 : r; return `${(x + rr * Math.cos(a)).toFixed(1)},${(y + rr * Math.sin(a)).toFixed(1)}`; }).join(' ');
  b += `<polygon points="${star(S[0], S[1], 9)}" fill="var(--warn)" stroke="var(--surface)" stroke-width="1"/><text x="${S[0] + 11}" y="${S[1] + 4}" font-size="11" font-weight="700">m*</text>`;
  $('#cgSvg').innerHTML = b;
  const r = cg.res;
  const rows = cg.cols.map((m, j) => `<tr${j === cg.added ? ' style="background:var(--ok-soft)"' : ''}><td>${j + 1}</td><td>${m.map((x, k) => `<span class="t${k}">${x}${SH[k]}</span>`).join(' ')}</td><td>${r && j < r.s.length ? fmt(r.s[j], 3) : '—'}</td></tr>`).join('');
  $('#cgPanel').innerHTML = `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Plan</th><th>Sorties (H M L)</th><th>s<sub>j</sub></th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="stats"><div class="stat ${r && r.gap < 1e-6 ? 'good' : 'bad'}"><b>Gap Σ|ε|</b><span>${r ? fmt(r.gap, 2) : '—'}</span><small>sorties away from m* = (${mStar.map(x => fmt(x, 1)).join(', ')})</small></div>
    <div class="stat"><b>Duals λ</b><span style="font-size:.95rem">${r ? r.lambda.map(x => fmt(x, 2)).join(', ') : '—'}</span><small>${cg.price ? `pricing scores ${cg.price.scores.map(x => fmt(x, 0)).join(', ')}` : 'under-coverage signal per type'}</small></div></div>`;
  $('#cgMsg').innerHTML = msg;
}
function initCG() {
  if (!$('#cgSvg')) return;
  $('#cgStart').addEventListener('change', cgReset);
  $('#cgReset').addEventListener('click', cgReset);
  $('#cgStep').addEventListener('click', cgStep);
  $('#cgPlay').addEventListener('click', () => {
    if (cg.timer) { clearInterval(cg.timer); cg.timer = null; $('#cgPlay').innerHTML = '&#9654; Play'; return; }
    if (cg.done) cgReset();
    $('#cgPlay').innerHTML = '&#10073;&#10073; Pause';
    cg.timer = setInterval(() => { cgStep(); if (cg.done && cg.timer) { clearInterval(cg.timer); cg.timer = null; $('#cgPlay').innerHTML = '&#9654; Play'; } }, 1400);
  });
  cgReset();
}

/* ---------------- §7 ---------------- */
let planIdx = 0, planCache = null;
function initS7() {
  $('#planPick').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; planIdx = +b.dataset.v; planCache = null; render.s7(); });
  $('#redraw').addEventListener('click', () => { planCache = null; render.phases(); });
  $('#atkT').addEventListener('input', render.cycle);
  $('#simAtk').addEventListener('click', () => render.cycle(true));
  $('#toyPlan').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; toy.plan = b.dataset.v; $$('#toyPlan button').forEach(x => x.classList.toggle('on', x === b)); toyReset(); });
  $('#toyTr').addEventListener('input', e => { toy.tr = +e.target.value; toyReset(); });
  $('#asgStep').addEventListener('click', () => { toyStep(); render.gantt(); });
  $('#asgAll').addEventListener('click', () => { while (toy.i < toy.sorties.length) toyStep(); render.gantt(); });
  $('#asgReset').addEventListener('click', toyReset);
}
function currentPlan() {
  const c = compute();
  planIdx = Math.min(planIdx, c.mix.plans.length - 1);
  if (!planCache) planCache = buildPlan(P, c.d, c.mix.plans[planIdx].m);
  return { ...c, plan: planCache, mplan: c.mix.plans[planIdx] };
}
render.s7 = () => {
  const { mix } = compute();
  planIdx = Math.min(planIdx, mix.plans.length - 1);
  $('#planPick').innerHTML = mix.plans.map((pl, j) => `<button data-v="${j}" class="${j === planIdx ? 'on' : ''}">Plan ${pl.label} (${pl.m.join(', ')}) · ${Math.round(pl.s * 100)}%</button>`).join('');
  const { d, plan } = currentPlan();
  $('#barrierTable').innerHTML = `<tr><th>Barrier</th><th>Sorties q<sub>i</sub></th><th>Interval Δ<sub>i</sub> = T/q<sub>i</sub></th><th>Phase range [0, Δ<sub>i</sub>−W)</th><th>Coverage p<sub>i</sub> = Wq<sub>i</sub>/T</th></tr>` +
    plan.bars.map(b => `<tr><td><span class="swatch" style="background:${COL(b.k)}"></span>${SH[b.k]}${b.i + 1}</td><td>${b.q}</td><td>${b.q ? fmt(b.delta, 2) + ' h' : '—'}</td><td>${b.q ? `[0, ${fmt(b.delta - d.W, 2)})` : '—'}</td><td>${b.q ? fmt(100 * b.p, 2) + '%' : '<span class="pill bad">unpatrolled in this plan</span>'}</td></tr>`).join('');
  render.phases();
  render.cycle();
  toyReset();
};
render.phases = () => {
  const { d, plan } = currentPlan();
  const win = Math.min(72, d.T), rh = 20, n = plan.bars.length;
  const Wd = 780, H = 16 + n * rh + 40;
  const f = frame({ W: Wd, H, ml: 40, mr: 70, mt: 8, mb: 34, x0: 0, x1: win, y0: 0, y1: 1, xt: Array.from({ length: Math.floor(win / 12) + 1 }, (_, i) => i * 12), xf: t => `${t} h`, xl: 'Hours into the period' });
  let b = f.s;
  plan.bars.forEach((br, r) => {
    const y = 10 + r * rh;
    b += `<text x="34" y="${y + 12}" text-anchor="end">${SH[br.k]}${br.i + 1}</text><rect x="${f.sx(0)}" y="${y}" width="${f.sx(win) - f.sx(0)}" height="${rh - 5}" rx="3" fill="var(--surface-2)"/>`;
    br.starts.filter(t => t < win).forEach(t => {
      const a = f.sx(t), c = f.sx(Math.min(win, t + P.tp)), e = f.sx(Math.min(win, t + d.W));
      b += `<g ${tipAttr(`${SH[br.k]}${br.i + 1}: departs ${dayTime(t)}, safe until ${dayTime(t + d.W)}`)}><rect x="${c}" y="${y}" width="${Math.max(0, e - c)}" height="${rh - 5}" fill="${SOFT(br.k)}"/><rect x="${a}" y="${y}" width="${Math.max(1, c - a)}" height="${rh - 5}" fill="${COL(br.k)}"/></g>`;
    });
    b += `<text x="${f.sx(win) + 6}" y="${y + 12}" class="lbl-strong">${br.q ? fmt(100 * br.p, 1) + '%' : '0%'}</text>`;
  });
  b += `<text x="${f.sx(win) + 6}" y="${H - 6}">p<tspan dy="3" font-size="8">i</tspan></text>`;
  const assigned = plan.ev.length - plan.unassigned;
  $('#phaseChart').innerHTML = svgWrap(Wd, H, b, 'Patrol timeline for each barrier') +
    `<p class="widget-sub" style="margin-top:.4rem">This plan has ${plan.ev.length} sorties. The greedy aircraft assignment (7.3) placed ${assigned}${plan.unassigned ? `; <b style="color:var(--bad)">${plan.unassigned} could not be placed</b> (random phases can bunch sorties up; a sign of a tight fleet)` : ', all of them'}.</p>`;
};
render.cycle = sim => {
  const { d, plan } = currentPlan();
  const br = plan.bars.find(b => b.q > 0);
  if (!br) { $('#cycleChart').innerHTML = '<p class="widget-sub">No patrolled barrier in this plan.</p>'; return; }
  const D = br.delta, W = d.W, L = D - W;
  const sl = $('#atkT'); sl.max = +D.toFixed(2);
  const t = Math.min(+sl.value, D);
  $('#atkTOut').textContent = `${fmt(t, 2)} h after the cycle starts`;
  $('#lcDelta').textContent = fmt(D, 2); $('#lcW').textContent = fmtNum(W);
  const phi0 = L / 2;
  const rules = [
    { name: 'Fixed clock (attacker learned it)', col: 'var(--muted)', dash: '5 4', p: x => (x >= phi0 && x < phi0 + W ? 1 : 0), draw: () => (L > 0 ? phi0 : 0) },
    { name: "Paper's rule φ ~ U[0, Δ−W)", col: '#6250d6', dash: '', p: x => (L <= 1e-9 ? 1 : clamp((Math.min(x, L) - Math.max(x - W, 0)) / L, 0, 1)), draw: () => Math.random() * Math.max(0, L) },
    { name: 'Full-cycle φ ~ U[0, Δ) with wrap', col: '#008300', dash: '', p: () => Math.min(1, W / D), draw: () => Math.random() * D, wrap: true },
  ];
  const Wd = 640, H = 230;
  const f = frame({ W: Wd, H, ml: 46, mr: 16, mt: 12, mb: 36, x0: 0, x1: D, y0: 0, y1: 1.05, xt: niceTicks(0, D, 6), yt: [0, .25, .5, .75, 1], yf: v => `${v * 100}%`, xl: 'Time within the cycle (h)', yl: 'P(covered)' });
  let b = f.s;
  rules.forEach(r => {
    const pts = [];
    for (let i = 0; i <= 400; i++) { const x = (D * i) / 400; pts.push([f.sx(x), f.sy(r.p(x))]); }
    b += poly(pts, `stroke="${r.col}" stroke-width="2" ${r.dash ? `stroke-dasharray="${r.dash}"` : ''}`);
  });
  b += `<line x1="${f.sx(t)}" x2="${f.sx(t)}" y1="${f.sy(1.05)}" y2="${f.sy(0)}" stroke="var(--bad)" stroke-width="1.5"/><text x="${f.sx(t) + 4}" y="${f.sy(1.05) + 10}" style="fill:var(--bad)">attack</text>`;
  $('#cycleChart').innerHTML = svgWrap(Wd, H, b, 'Coverage probability within the cycle');
  $('#cycleLegend').innerHTML = rules.map(r => `<span><i style="background:${r.col}"></i>${r.name}</span>`).join('');
  const covered = (r, phi) => r.wrap ? ((t - phi + D) % D) < W : t >= phi && t < phi + W;
  $('#cycleStats').innerHTML = rules.map(r => {
    let extra = '';
    if (sim === true) {
      let hit = 0; const M = 5000;
      for (let i = 0; i < M; i++) if (covered(r, r.draw())) hit++;
      extra = `<small>simulated: ${fmt((100 * hit) / M, 1)}% caught</small>`;
    }
    const pr = r.p(t);
    return `<div class="stat ${pr < W / D - 0.05 ? 'bad' : ''}"><b>${r.name}</b><span>${fmt(100 * pr, 1)}%</span><small>chance the attacker is caught</small>${extra}</div>`;
  }).join('');
};

// Toy assignment (paper Tables 3–4)
const TOY_SORTIES = {
  A: [[0, 'H'], [4, 'M'], [8, 'H'], [12, 'M'], [16, 'H'], [20, 'M']],
  B: [[0, 'H'], [3, 'M'], [9, 'M'], [12, 'H'], [15, 'M'], [21, 'M']],
};
const toy = { plan: 'A', tr: 4 };
function toyReset() {
  const G = 2 + toy.tr;
  toy.G = G;
  toy.sorties = TOY_SORTIES[toy.plan].map(([t, k]) => ({ t, k, ac: undefined }));
  toy.ac = [{ last: -Infinity, hours: 0 }, { last: -Infinity, hours: 0 }];
  toy.ptr = 0; toy.i = 0;
  toy.log = [`τp = 2 h, τr = ${toy.tr} h ⇒ G = ${G} h; F = 6 h per aircraft. Sorties in time order: ${toy.sorties.map(s => `${s.k}@${hhmm(s.t)}`).join(', ')}.`];
  $('#toyTrOut').textContent = `${toy.tr} h (G = ${G} h)`;
  render.gantt();
}
function toyStep() {
  if (toy.i >= toy.sorties.length) return;
  const s = toy.sorties[toy.i++];
  const lines = [`<span class="hl">Sortie ${s.k} at ${hhmm(s.t)}</span>`];
  for (let j = 0; j < 2; j++) {
    const idx = (toy.ptr + j) % 2, a = toy.ac[idx];
    const gap = s.t - a.last;
    if (gap + 1e-9 < toy.G) { lines.push(`  AC-${idx + 1}: last start ${hhmm(a.last)}, gap ${gap} h < G = ${toy.G} h <span class="bad">✗ busy</span>`); continue; }
    if (a.hours + 2 > 6) { lines.push(`  AC-${idx + 1}: already flown ${a.hours} h, +2 > F = 6 h <span class="bad">✗ budget</span>`); continue; }
    lines.push(`  AC-${idx + 1}: ${a.last === -Infinity ? 'not flown yet' : `gap ${gap} h ≥ G`}, ${a.hours} h flown <span class="ok">✓ assigned</span>`);
    a.last = s.t; a.hours += 2; s.ac = idx; toy.ptr = (idx + 1) % 2;
    toy.log.push(lines.join('\n'));
    return;
  }
  s.ac = null;
  lines.push('  <span class="bad">No aircraft can take it: sortie left unassigned.</span>');
  toy.log.push(lines.join('\n'));
}
render.gantt = () => {
  const Wd = 720, H = 210;
  const f = frame({ W: Wd, H, ml: 92, mr: 24, mt: 8, mb: 30, x0: 0, x1: 24, y0: 0, y1: 1, xt: [0, 4, 8, 12, 16, 20, 24], xf: t => `${String(t).padStart(2, '0')}:00`, xl: 'Hour of day' });
  let b = f.s;
  const rows = ['AC-1', 'AC-2', 'Unassigned', 'H covered', 'M covered'], rh = 30;
  const kIdx = { H: 0, M: 1 };
  rows.forEach((r, i) => { const y = 10 + i * rh; b += `<text x="86" y="${y + 15}" text-anchor="end">${r}</text><rect x="${f.sx(0)}" y="${y}" width="${f.sx(24) - f.sx(0)}" height="${rh - 8}" rx="3" fill="var(--surface-2)"/>`; });
  const seg = (y, a, c, fill, tip) => {
    let s = '';
    const parts = c <= 24 ? [[a, c]] : [[a, 24], [0, c - 24]];
    parts.forEach(([x, z]) => { s += `<rect x="${f.sx(x)}" y="${y}" width="${Math.max(1, f.sx(z) - f.sx(x))}" height="${rh - 8}" fill="${fill}" ${tip ? tipAttr(tip) : ''}/>`; });
    return s;
  };
  const cov = { H: [], M: [] };
  toy.sorties.forEach((s, i) => {
    const k = kIdx[s.k];
    if (s.ac === undefined) return;
    const row = s.ac === null ? 2 : s.ac, y = 10 + row * rh;
    b += seg(y, s.t, s.t + 2, COL(k), `${s.k} sortie ${hhmm(s.t)}–${hhmm(s.t + 2)}${s.ac === null ? ' (unassigned)' : ` flown by AC-${s.ac + 1}`}`);
    b += `<text x="${f.sx(s.t + 1)}" y="${y + 15}" text-anchor="middle" style="fill:#fff;font-weight:700">${s.k}</text>`;
    if (s.ac !== null) cov[s.k].push([s.t, s.t + 6]);
  });
  ['H', 'M'].forEach((key, j) => {
    const y = 10 + (3 + j) * rh;
    cov[key].forEach(([a, c]) => { b += seg(y, a, c, SOFT(kIdx[key]), `${key} protected ${hhmm(a)}–${hhmm(c % 24)}`); });
    const iv = cov[key].flatMap(([a, c]) => (c <= 24 ? [[a, c]] : [[a, 24], [0, c - 24]]));
    const tot = unionLength(iv, 0, 24);
    b += `<text x="${f.sx(24) - 4}" y="${y + 15}" text-anchor="end" class="lbl-strong">${tot}/24 h</text>`;
  });
  if (toy.i < toy.sorties.length) {
    const nx = toy.sorties[toy.i];
    b += `<line x1="${f.sx(nx.t)}" x2="${f.sx(nx.t)}" y1="6" y2="${10 + 5 * rh - 6}" stroke="var(--accent)" stroke-dasharray="3 3"/>`;
  }
  $('#ganttChart').innerHTML = svgWrap(Wd, H, b, 'Aircraft assignment for the toy example');
  const hrs = toy.ac.map((a, i) => `AC-${i + 1} flew ${a.hours} h`).join(', ');
  $('#asgLog').innerHTML = toy.log.join('\n') + (toy.i >= toy.sorties.length ? `\n<span class="hl">Done.</span> ${hrs}.${toy.plan === 'A' && toy.tr === 4 ? ' Matches the paper\'s Table 3.' : toy.plan === 'B' && toy.tr === 4 ? ' Matches the paper\'s Table 4.' : ''}` : '');
  $('#asgLog').scrollTop = 1e6;
  $('#asgStep').disabled = $('#asgAll').disabled = toy.i >= toy.sorties.length;
};

/* ---------------- §8 ---------------- */
function initS8() { $('#theta').addEventListener('input', render.s8); }
render.s8 = () => {
  const d = derive(P);
  const th = +$('#theta').value;
  $('#thetaOut').textContent = `${Math.round(th * 100)}%`;
  const Nmin = t => Math.ceil((t * d.T * d.Nb) / (d.mu * P.F) - 1e-9);
  const raw = (th * d.T * d.Nb) / (d.mu * P.F);
  const thMax = Math.min(1, (d.mu * d.Beff) / (d.T * d.Nb));
  $('#fleetStats').innerHTML = `
    <div class="stat"><b>N<sub>min</sub>(${fmt(th, 2)})</b><span>${Nmin(th)}</span><small>⌈${fmt(th, 2)} × ${d.T} × ${d.Nb} / (${fmtNum(d.mu)} × ${fmtNum(P.F)})⌉ = ⌈${fmt(raw, 2)}⌉</small></div>
    <div class="stat"><b>Zero loss, θ = ½</b><span>${Nmin(0.5)}</span><small>Eq. 17</small></div>
    <div class="stat"><b>Full coverage, θ = 1</b><span>${Nmin(1)}</span><small>Eq. 18</small></div>
    <div class="stat ${P.N >= Nmin(th) ? 'good' : 'bad'}"><b>Your fleet</b><span>${P.N}</span><small>${P.N >= Nmin(th) ? 'enough for this θ' : `${Nmin(th) - P.N} short for this θ`}; guarantees θ up to ${fmt(100 * thMax, 1)}%</small></div>`;
  const ymax = Nmin(1) + Math.max(2, Math.ceil(Nmin(1) * 0.1));
  const Wd = 640, H = 250;
  const f = frame({ W: Wd, H, ml: 44, mr: 16, mt: 14, mb: 36, x0: 0, x1: 1, y0: 0, y1: Math.max(ymax, P.N + 2), xt: [0, .25, .5, .75, 1], xf: t => `${t * 100}%`, yt: niceTicks(0, Math.max(ymax, P.N + 2), 5), xl: 'Coverage target θ', yl: 'Aircraft needed' });
  let b = f.s;
  const pts = [];
  for (let i = 0; i <= 500; i++) { const t = i / 500; pts.push([f.sx(t), f.sy(Nmin(t))]); }
  b += poly(pts, 'stroke="var(--accent)" stroke-width="2"');
  b += `<line x1="${f.sx(0)}" x2="${f.sx(1)}" y1="${f.sy(P.N)}" y2="${f.sy(P.N)}" stroke="var(--text-2)" stroke-dasharray="5 4"/><text x="${f.sx(0) + 4}" y="${f.sy(P.N) - 5}" class="lbl-strong">your fleet N = ${P.N}</text>`;
  [[0.5, 'zero loss'], [1, 'full']].forEach(([t, l]) => { b += `<circle cx="${f.sx(t)}" cy="${f.sy(Nmin(t))}" r="4.5" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/><text x="${f.sx(t) - 6}" y="${f.sy(Nmin(t)) - 8}" text-anchor="end">${l}: ${Nmin(t)}</text>`; });
  b += `<circle cx="${f.sx(th)}" cy="${f.sy(Nmin(th))}" r="6" fill="var(--bad)" stroke="var(--surface)" stroke-width="2" ${tipAttr(`θ = ${fmt(th, 2)} → ${Nmin(th)} aircraft`)}/>`;
  $('#fleetChart').innerHTML = svgWrap(Wd, H, b, 'Minimum fleet size versus coverage target');
  $('#capacitySteps').innerHTML = [
    `One aircraft flies F = ${fmtNum(P.F)} h, i.e. F/τ<sub>p</sub> = ${fmt(P.F / P.tp, 2)} sorties per period.`,
    `Each sortie protects for W = ${fmtNum(d.W)} h, so one aircraft makes ${fmt(P.F / P.tp, 2)} × ${fmtNum(d.W)} = μF = <b>${fmt(d.mu * P.F, 1)}</b> protection-hours.`,
    `Covering N<sub>b</sub> = ${d.Nb} barriers for the whole T = ${d.T} h needs N<sub>b</sub>T = <b>${d.Nb * d.T}</b> protection-hours (times θ for partial coverage).`,
    `So N<sub>min</sub>(1) = ⌈${d.Nb * d.T} / ${fmt(d.mu * P.F, 1)}⌉ = <b>${Nmin(1)}</b>, the same as Eq. 18.`,
  ].map(s => `<li>${s}</li>`).join('');
};

/* ---------------- §9 ---------------- */
const EX = [
  ['d<sub>H</sub>', 'Eq. 7: n<sub>H</sub>T / (2μv<sub>H</sub>)', 2 / 3, '1 × 24 / (2 × 3 × 6) = 24/36 = 2/3'],
  ['d<sub>M</sub>', 'Same formula with v<sub>M</sub> = 2', 2, '1 × 24 / (2 × 3 × 2) = 24/12 = 2'],
  ['z*', 'Eq. 5: (B<sub>eff</sub> − TN<sub>b</sub>/(2μ)) / (d<sub>H</sub> + d<sub>M</sub>)', 1.5, '(12 − 48/6) / (2/3 + 2) = 4 / (8/3) = 3/2'],
  ['h*<sub>H</sub> (hours)', 'Eq. 6: d<sub>H</sub>(z* + v<sub>H</sub>)', 5, '(2/3)(3/2 + 6) = (2/3)(15/2) = 5 h'],
  ['h*<sub>M</sub> (hours)', 'd<sub>M</sub>(z* + v<sub>M</sub>)', 7, '2 × (3/2 + 2) = 7 h. Check: 5 + 7 = 12 = B<sub>eff</sub>'],
  ['P<sub>H</sub>', 'Eq. 1: μh / (nT)', 0.625, '3 × 5 / 24 = 5/8'],
  ['P<sub>M</sub>', 'μh / (nT)', 0.875, '3 × 7 / 24 = 7/8. Then U<sub>d</sub>(H) = 6(2·5/8 − 1) = 3/2 and U<sub>d</sub>(M) = 2(2·7/8 − 1) = 3/2: indifferent ✓'],
  ['m*<sub>H</sub> (sorties)', 'h*<sub>H</sub> / τ<sub>p</sub>', 2.5, '5 / 2 = 2.5, fractional, so we must mix'],
  ['s<sub>A</sub>, probability of plan A = (3H, 3M)', 'Plan B = (2H, 4M). Solve 6s<sub>A</sub> + 4(1 − s<sub>A</sub>) = h*<sub>H</sub>', 0.5, '6s<sub>A</sub> + 4 − 4s<sub>A</sub> = 5 ⇒ s<sub>A</sub> = 1/2: a fair coin'],
  ['N<sub>min</sub>(½)', 'Eq. 16: ⌈θTN<sub>b</sub> / (μF)⌉', 2, '⌈0.5 × 24 × 2 / 18⌉ = ⌈1.33⌉ = 2: the toy fleet is exactly enough'],
  ['N<sub>min</sub>(1)', 'Same with θ = 1', 3, '⌈48 / 18⌉ = ⌈2.67⌉ = 3'],
];
function parseAns(s) {
  s = s.trim().replace(/\s/g, '');
  if (/^-?\d*\.?\d+\/-?\d*\.?\d+$/.test(s)) { const [a, b] = s.split('/').map(Number); return a / b; }
  const x = Number(s); return s === '' ? NaN : x;
}
function initS9() {
  $('#exercise').innerHTML = EX.map(([q, hint], i) => `<div class="ex-row" data-i="${i}"><div class="q">${q}<small>${hint}</small></div><input type="text" inputmode="decimal" placeholder="your answer"><div class="btn-row" style="margin:0"><button class="btn small" data-a="check">Check</button><button class="btn ghost small" data-a="reveal">Show</button></div><div class="fb"></div></div>`).join('');
  const act = (row, a) => {
    const i = +row.dataset.i, inp = $('input', row), fb = $('.fb', row);
    if (a === 'reveal') { inp.value = fmtNum(EX[i][2]); inp.className = 'right'; fb.innerHTML = EX[i][3]; return; }
    const x = parseAns(inp.value);
    if (!Number.isFinite(x)) { fb.textContent = 'Type a number or a fraction such as 2/3.'; return; }
    const ok = Math.abs(x - EX[i][2]) <= 0.006 * Math.max(1, Math.abs(EX[i][2]));
    inp.className = ok ? 'right' : 'wrong';
    fb.innerHTML = ok ? `✓ ${EX[i][3]}` : 'Not yet. Re-read the hint, or press Show.';
  };
  $('#exercise').addEventListener('click', e => { const b = e.target.closest('button'); if (b) act(b.closest('.ex-row'), b.dataset.a); });
  $('#exercise').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('input')) act(e.target.closest('.ex-row'), 'check'); });
  $('#exReveal').addEventListener('click', () => $$('#exercise .ex-row').forEach(r => act(r, 'reveal')));
  $('#sA').addEventListener('input', render.s9);
}
render.s9 = () => {
  const s = +$('#sA').value;
  $('#sAOut').textContent = fmt(s, 2);
  const uH = x => 3 * x, uM = x => 2 - x;
  const Wd = 600, H = 250;
  const f = frame({ W: Wd, H, ml: 40, mr: 110, mt: 12, mb: 36, x0: 0, x1: 1, y0: -0.2, y1: 3.2, xt: [0, .25, .5, .75, 1], yt: [0, 1, 2, 3], xl: 'Probability of flying plan A, s_A' });
  let b = f.s;
  const env = []; for (let i = 0; i <= 100; i++) { const x = i / 100; env.push([f.sx(x), f.sy(Math.min(uH(x), uM(x)))]); }
  b += poly(env, 'stroke="var(--text)" stroke-width="7" stroke-opacity=".12" stroke-linejoin="round"');
  b += poly([[f.sx(0), f.sy(uH(0))], [f.sx(1), f.sy(uH(1))]], `stroke="${COL(0)}" stroke-width="2"`);
  b += poly([[f.sx(0), f.sy(uM(0))], [f.sx(1), f.sy(uM(1))]], `stroke="${COL(1)}" stroke-width="2"`);
  b += `<text x="${f.sx(1) + 6}" y="${f.sy(3) + 4}" class="lbl-strong">attack High</text><text x="${f.sx(1) + 6}" y="${f.sy(1) + 4}" class="lbl-strong">attack Medium</text>`;
  b += `<text x="${f.sx(0.5)}" y="${f.sy(1.5) - 12}" text-anchor="middle">best: s_A = ½, value 1.5</text>`;
  const g = Math.min(uH(s), uM(s));
  b += `<line x1="${f.sx(s)}" x2="${f.sx(s)}" y1="${f.sy(3.2)}" y2="${f.sy(-0.2)}" stroke="var(--text-2)"/>`;
  b += `<circle cx="${f.sx(s)}" cy="${f.sy(uH(s))}" r="5" fill="${COL(0)}" stroke="var(--surface)" stroke-width="2"/><circle cx="${f.sx(s)}" cy="${f.sy(uM(s))}" r="5" fill="${COL(1)}" stroke="var(--surface)" stroke-width="2"/>`;
  $('#sAChart').innerHTML = svgWrap(Wd, H, b, 'Expected payoff versus probability of plan A');
  $('#sALegend').innerHTML = `<span><i style="background:${COL(0)}"></i>E[U | attack High] = 3·s<sub>A</sub></span><span><i style="background:${COL(1)}"></i>E[U | attack Medium] = 2 − s<sub>A</sub></span><span><i style="background:var(--text);opacity:.25"></i>what the attacker leaves you (the lower line)</span>`;
  $('#sAStats').innerHTML = `<div class="stat"><b>Attack High</b><span>${fmt(uH(s))}</span></div><div class="stat"><b>Attack Medium</b><span>${fmt(uM(s))}</span></div><div class="stat ${Math.abs(g - 1.5) < 0.02 ? 'good' : ''}"><b>Your game value</b><span>${fmt(g)}</span><small>${Math.abs(g - 1.5) < 0.02 ? 'optimal: z* = 3/2' : 'the optimum is 1.5'}</small></div>`;
};

/* ---------------- §10 ---------------- */
const ALGO = [
  ['Require: N, K, {n_k, v_k}, T, τp, W, μ, F', null, 's2'],
  ['Ensure:  mixed strategy s*, game value z*, timetables', null, null],
  ['B_eff ← ⌊N·F/τp⌋ · τp', c => `B_eff = ⌊${P.N}×${fmtNum(P.F)}/${fmtNum(P.tp)}⌋ × ${fmtNum(P.tp)} = ${c.d.Nsrt} × ${fmtNum(P.tp)} = ${fmtNum(c.d.Beff)} h`, 's2'],
  ['// Stage 1', null, 's5', 1],
  ['Compute d_k ← n_k·T/(2μ·v_k) for each k', c => `d = (${c.s1.dk.map(x => fmt(x, 3)).join(', ')})`, 's5'],
  ['z* ← (B_eff − T·N_b/(2μ)) / Σ d_k', c => `z* = ${fmt(c.s1.z, 4)}`, 's5'],
  ['h*_k ← d_k (z* + v_k) for each k', c => `h* = (${c.s1.h.map(x => fmt(x, 2)).join(', ')}) h`, 's5'],
  ['Set h_k ← 0 where h*_k < 0; re-solve over the rest', c => (c.s1.log.length ? `removed: ${c.s1.log.map(l => l.removed.map(k => NAMES[k]).join(', ')).join(' then ')}` : 'no type removed: all active'), 's5'],
  ['// Stage 2', null, 's6', 1],
  ['Enumerate candidates near m*_k = h*_k/τp', c => `m* = (${c.mStar.map(x => fmt(x, 3)).join(', ')}); r = ${c.mix.r} type(s) round up`, 's6'],
  ['Solve Phase-1 LP (9) → mixing probabilities s*', c => c.mix.plans.map(pl => `Plan ${pl.label} (${pl.m.join(', ')}): s = ${fmt(pl.s, 4)}`).join('\n'), 's6'],
  ['Assert 1ᵀε* = 0 (zero gap)', c => { const g = Math.abs(sum([0, 1, 2].map(k => sum(c.mix.plans.map(pl => pl.m[k] * P.tp * pl.s)) - c.s1.h[k]))); return `gap = ${g.toExponential(1)} ✓`; }, 's6'],
  ['// Stage 3', null, 's7', 1],
  ['for all pure strategies j with s*_j > 0 do', c => `${c.mix.plans.length} plan(s) to schedule`, 's7'],
  ['    Distribute sorties across barriers (floor/ceil)', c => c.mix.plans.map(pl => `Plan ${pl.label}: ` + [0, 1, 2].map(k => { const b = Math.floor(pl.m[k] / P.n[k]), r = pl.m[k] - b * P.n[k]; return `${SH[k]}: ${r} × ${b + 1}, ${P.n[k] - r} × ${b}`; }).join('; ')).join('\n'), 's7'],
  ['    Compute start times via (15)', () => 'φ_i ~ U[0, Δ_i − W) drawn per barrier; t_ij = φ_i + jΔ_i', 's7'],
  ['    Assign sorties to aircraft (greedy, gap G, budget F)', c => c.mix.plans.map(pl => { const r = buildPlan(P, c.d, pl.m); return `Plan ${pl.label}: ${r.ev.length - r.unassigned}/${r.ev.length} sorties placed, busiest aircraft ${fmtNum(Math.max(...r.ac.map(a => a.hours)))} h of F = ${fmtNum(P.F)}`; }).join('\n'), 's7'],
  ['    Output timetable', () => 'timetables ready (see the planner page for the full tables)', 's7'],
  ['end for', null, null],
  ['// Goal 2', null, 's8', 1],
  ['Report N_min(1/2) and N_min(1) via (16)', c => { const f = t => Math.ceil((t * c.d.T * c.d.Nb) / (c.d.mu * P.F) - 1e-9); return `N_min(½) = ${f(0.5)}, N_min(1) = ${f(1)} (you have ${P.N})`; }, 's8'],
];
let algoPos = -1, algoCtx = null;
function initS10() {
  $('#algo').innerHTML = ALGO.map(([t, , go, cmt], i) => `<div data-i="${i}" ${go ? `data-goto="${go}" ${tipAttr('Click to open the section that explains this line')}` : ''} class="${cmt ? 'cmt' : ''}"><span class="ln">${i + 1}:</span>${t}</div>`).join('');
  $('#algo').addEventListener('click', e => { const r = e.target.closest('[data-goto]'); if (r) location.hash = r.dataset.goto; });
  $('#algoStep').addEventListener('click', algoStep);
  $('#algoAll').addEventListener('click', () => { while (algoPos < ALGO.length - 1) algoStep(); });
  $('#algoReset').addEventListener('click', render.s10);
}
function algoStep() {
  if (algoPos >= ALGO.length - 1) return;
  if (!algoCtx) algoCtx = compute();
  algoPos++;
  $$('#algo > div').forEach((dv, i) => { dv.classList.toggle('run', i === algoPos); dv.classList.toggle('ran', i < algoPos); });
  const fn = ALGO[algoPos][1];
  if (fn) {
    const out = $('#algoOut');
    if (algoPos === 0 || out.dataset.fresh) { out.innerHTML = ''; delete out.dataset.fresh; }
    out.innerHTML += `<span class="hl">line ${algoPos + 1}:</span> ${fn(algoCtx).replace(/\n/g, '\n         ')}\n`;
    out.scrollTop = 1e6;
  }
  $('#algoStep').disabled = algoPos >= ALGO.length - 1;
}
render.s10 = () => {
  algoPos = -1; algoCtx = null;
  $$('#algo > div').forEach(dv => dv.classList.remove('run', 'ran'));
  const out = $('#algoOut'); out.textContent = 'Press “Run next line”.'; out.dataset.fresh = '1';
  $('#algoStep').disabled = false;
};

/* ---------------- §11 ---------------- */
let atkMode = 'adaptive';
function initS11() {
  $('#lowA').addEventListener('input', render.mix);
  $('#highB').addEventListener('input', render.mix);
  $('#atkType').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; atkMode = b.dataset.v; $$('#atkType button').forEach(x => x.classList.toggle('on', x === b)); render.mix(); });
}
render.mix = () => {
  const a = +$('#lowA').value, bb = +$('#highB').value;
  $('#lowAOut').textContent = `${a} (Medium ${6 - a})`;
  $('#highBOut').textContent = `${bb} (Medium ${6 - bb})`;
  const uH = m => 6 * (m / 2 - 1), uM = m => 2 * (m / 2 - 1);
  const Wstar = Math.min(uH(2), uM(3));
  if (a >= 3) {
    $('#mixChart').innerHTML = '';
    $('#mixLegend').innerHTML = '';
    $('#mixStats').innerHTML = '';
    $('#mixMsg').innerHTML = '<b style="color:var(--bad)">Impossible: this is Lemma 4.</b> If both plans fly at least 3 High sorties, the average is at least 3, never 2.5. Every valid mix must contain a month with ≤ ⌊2.5⌋ = 2 High sorties.';
    return;
  }
  const sa = (bb - 2.5) / (bb - a), sb = 1 - sa;
  const plans = [{ name: `Low plan (${a}H, ${6 - a}M)`, s: sa, U: [uH(a), uM(6 - a)] }, { name: `High plan (${bb}H, ${6 - bb}M)`, s: sb, U: [uH(bb), uM(6 - bb)] }];
  const Ws = Math.min(...plans.flatMap(p => p.U));
  const Wd = 600, H = 260, y0 = -6.5, y1 = 12.5;
  const f = frame({ W: Wd, H, ml: 40, mr: 70, mt: 12, mb: 40, x0: 0, x1: 2, y0, y1, yt: niceTicks(y0, y1, 6) });
  let b = f.s;
  b += `<line x1="${f.sx(0)}" x2="${f.sx(2)}" y1="${f.sy(0)}" y2="${f.sy(0)}" stroke="var(--axis)"/>`;
  plans.forEach((p, j) => {
    const cx = f.sx(j + 0.5);
    b += `<text x="${cx}" y="${H - 22}" text-anchor="middle" class="lbl-strong">${p.name}</text><text x="${cx}" y="${H - 8}" text-anchor="middle">flown with probability ${fmt(p.s, 3)}</text>`;
    p.U.forEach((u, k) => {
      const x = cx + (k === 0 ? -34 : 6), top = f.sy(Math.max(0, u)), bot = f.sy(Math.min(0, u));
      b += `<rect x="${x}" y="${top}" width="28" height="${Math.max(1, bot - top)}" rx="3" fill="${COL(k)}" ${tipAttr(`${p.name}, attack ${NAMES[k]}: U = ${sgn(u)}`)}/>`;
      b += `<text x="${x + 14}" y="${u >= 0 ? top - 4 : bot + 12}" text-anchor="middle">${sgn(u, 1)}</text>`;
    });
  });
  b += `<line x1="${f.sx(0)}" x2="${f.sx(2)}" y1="${f.sy(Wstar)}" y2="${f.sy(Wstar)}" stroke="var(--text)" stroke-dasharray="5 4"/><text x="${f.sx(2) + 4}" y="${f.sy(Wstar) + 4}">W* = ${fmt(Wstar, 1)}</text>`;
  b += `<line x1="${f.sx(0)}" x2="${f.sx(2)}" y1="${f.sy(1.5)}" y2="${f.sy(1.5)}" stroke="var(--accent)" stroke-dasharray="2 3"/><text x="${f.sx(2) + 4}" y="${f.sy(1.5) - 2}" style="fill:var(--accent)">z* = 1.5</text>`;
  $('#mixChart').innerHTML = svgWrap(Wd, H, b, 'Realised payoff per plan and attacked type');
  $('#mixLegend').innerHTML = `<span><i style="background:${COL(0)}"></i>attack High</span><span><i style="background:${COL(1)}"></i>attack Medium</span>`;
  const isFC = a === 2 && bb === 3;
  const val = atkMode === 'adaptive' ? Ws : 1.5;
  $('#mixStats').innerHTML = `
    <div class="stat"><b>Average High sorties</b><span>${fmt(sa * a + sb * bb, 2)}</span><small>${fmt(sa, 3)}×${a} + ${fmt(sb, 3)}×${bb} = m*<sub>H</sub> ✓</small></div>
    <div class="stat"><b>Expected payoff</b><span>${fmt(1.5, 2)}</span><small>the same z* for every valid mix</small></div>
    <div class="stat ${atkMode === 'adaptive' ? (Ws >= Wstar - 1e-9 ? 'good' : 'bad') : 'good'}"><b>${atkMode === 'adaptive' ? 'Worst month W(s)' : 'Committed attacker gets'}</b><span>${sgn(val, 2)}</span><small>${atkMode === 'adaptive' ? `best possible W* = ${fmt(Wstar, 1)}` : 'diversification neither helps nor hurts'}</small></div>`;
  $('#mixMsg').innerHTML = atkMode === 'committed'
    ? 'A committed attacker picks a target before knowing the month\'s plan, so they only face the average: every mix gives z* = 1.5 (Remark 11).'
    : isFC ? 'This is the floor/ceil mix: no month goes below the floor on any type, so the worst month equals the bound W* (Theorem 5).'
      : `Spreading wider than floor/ceil pushes the low month to ${a} High sorties, below ⌊2.5⌋ = 2. A patient attacker waits for that month and gets you down to ${sgn(Ws, 1)} &lt; W* (Section 11.4).`;
};
render.s11 = () => {
  render.mix();
  const { d, s1, mix } = compute();
  const U = (k, m) => P.v[k] * ((2 * d.mu * m * P.tp) / (P.n[k] * d.T) - 1);
  const worst = plans => Math.min(...plans.map(pl => Math.min(...[0, 1, 2].map(k => U(k, pl.m[k])))));
  const canon = [0, 1, 2].filter(k => s1.h[k] > 0).map(k => { const m = [0, 0, 0]; m[k] = d.Nsrt; return { m, s: s1.h[k] / d.Beff }; });
  const Wst = Math.min(...[0, 1, 2].map(k => U(k, mix.fl[k])));
  $('#wcTable').innerHTML = `<tr><th>Mixed strategy</th><th>Plans used</th><th>Expected payoff</th><th>Worst month W(s)</th></tr>` +
    `<tr><td>Canonical (all sorties on one type each month)</td><td>${canon.length}</td><td>${sgn(s1.z, 3)}</td><td class="neg">${sgn(worst(canon), 2)}</td></tr>` +
    `<tr class="hl"><td>Floor/ceil (Stage 2)</td><td>${mix.plans.length}</td><td>${sgn(s1.z, 3)}</td><td>${sgn(worst(mix.plans), 3)}</td></tr>` +
    `<tr><td>Bound W* from the floors</td><td></td><td></td><td>${sgn(Wst, 3)}</td></tr>`;
  const gap = s1.z - Wst;
  const p = $('#wcTable').parentElement;
  let note = $('.wc-note', p.parentElement);
  if (!note) { note = document.createElement('p'); note.className = 'widget-sub wc-note'; p.after(note); }
  note.innerHTML = `Both mixes reproduce h* exactly, so both have expected payoff z*. Only floor/ceil reaches W*. The integrality gap z* − W* = ${fmt(gap, 3)} is the price of flying whole sorties (Remark 12).`;
};

/* ---------------- §12 ---------------- */
let polSel = 'stack';
const POL_TEXT = {
  fixed: 'Equal sorties per barrier on a fixed, published clock. After two or three days of watching, the attacker knows exactly when each barrier is uncovered and strikes in that gap. Effective coverage is 0 everywhere, so U<sub>d</sub>(k) = −v<sub>k</sub>, and the attacker hits the most valuable type.',
  uniform: 'Same equal split, but with randomised start times. Coverage is about 50% everywhere, which looks fair. But payoffs scale with v<sub>k</sub>, so equal coverage does not mean equal payoff, and one type ends up the weakest link.',
  vp: 'Sorties proportional to the total value n<sub>k</sub>v<sub>k</sub>. High is heavily over-protected while Low falls far below 50% coverage. The attacker simply targets the starved type.',
  greedy: 'Fill the most valuable type to 100%, then the next, until the budget runs out. The leftover type is completely unpatrolled: the most obvious target of all.',
  stack: 'Stage 1\'s answer. Payoffs are equal across every active type by construction, so the attacker has no better target, and no allocation can raise the worst case.',
};
function initS12() {
  $('#polPick').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; polSel = b.dataset.v; render.s12(); });
}
render.s12 = () => {
  const { d, s1 } = compute();
  const pols = baselines(P, d, s1);
  $('#polPick').innerHTML = pols.map(p => `<button data-v="${p.id}" class="${p.id === polSel ? 'on' : ''}">${p.name}</button>`).join('');
  const vmax = Math.max(...P.v);
  const Wd = 760, H = 300;
  const f = frame({ W: Wd, H, ml: 44, mr: 12, mt: 14, mb: 46, x0: 0, x1: 5, y0: -vmax * 1.08, y1: vmax * 1.08, yt: niceTicks(-vmax, vmax, 6), yl: 'Defender payoff U_d(k)' });
  let b = f.s + `<line x1="${f.sx(0)}" x2="${f.sx(5)}" y1="${f.sy(0)}" y2="${f.sy(0)}" stroke="var(--axis)"/>`;
  pols.forEach((p, i) => {
    const cx = f.sx(i + 0.5), bw = 24, op = p.id === polSel ? 1 : 0.35;
    b += `<g opacity="${op}" style="cursor:pointer" data-pol="${p.id}">`;
    b += `<rect x="${cx - 70}" y="${f.mt || 0}" width="140" height="${H - 46}" fill="transparent"/>`;
    p.U.forEach((u, k) => {
      const x = cx - 1.5 * bw - 2 + k * (bw + 2), top = f.sy(Math.max(0, u)), bot = f.sy(Math.min(0, u));
      b += `<rect x="${x}" y="${top}" width="${bw}" height="${Math.max(1, bot - top)}" rx="3" fill="${COL(k)}" ${tipAttr(`${p.name}: attack ${NAMES[k]} → U = ${sgn(u)} (h = ${fmt(p.h[k], 0)} h)`)}/>`;
    });
    b += `<line x1="${cx - 44}" x2="${cx + 44}" y1="${f.sy(p.game)}" y2="${f.sy(p.game)}" stroke="var(--text)" stroke-width="2.5"/>`;
    b += `<text x="${cx}" y="${H - 28}" text-anchor="middle" class="lbl-strong">${p.name.replace(' (high value first)', '')}</text><text x="${cx}" y="${H - 13}" text-anchor="middle">game value ${sgn(p.game)}</text></g>`;
  });
  $('#polChart').innerHTML = svgWrap(Wd, H, b, 'Defender payoff by policy and barrier type');
  $$('#polChart [data-pol]').forEach(g => g.addEventListener('click', () => { polSel = g.dataset.pol; render.s12(); }));
  $('#polLegend').innerHTML = [0, 1, 2].map(k => `<span><i style="background:${COL(k)}"></i>attack ${NAMES[k]}</span>`).join('') + '<span><i style="background:var(--text);height:3px;vertical-align:3px"></i>game value (attacker\'s pick)</span>';
  const sel = pols.find(p => p.id === polSel), tgt = sel.U.indexOf(sel.game);
  $('#polDetail').innerHTML = `<b>${sel.name}.</b> ${POL_TEXT[sel.id]}<br><b>Attacker hits:</b> <span class="t${tgt}">${NAMES[tgt]}</span>, game value <b>${sgn(sel.game)}</b>${sel.id !== 'stack' ? `, which is ${fmt(s1.z - sel.game)} worse than Stackelberg.` : '.'}`;
  const best = Math.max(...pols.map(p => p.game));
  $('#polTable').innerHTML = `<tr><th>Policy</th>${[0, 1, 2].map(k => `<th>h<sub>${SH[k]}</sub></th>`).join('')}${[0, 1, 2].map(k => `<th>U<sub>d</sub>(${SH[k]})</th>`).join('')}<th>Game value</th></tr>` +
    pols.map(p => `<tr class="${p.game === best ? 'hl' : ''}"><td>${p.name}</td>${p.h.map(h => `<td>${fmt(h, 0)}</td>`).join('')}${p.U.map(u => `<td class="${u >= 0 ? 'pos' : 'neg'}">${sgn(u)}</td>`).join('')}<td class="${p.game >= 0 ? 'pos' : 'neg'}"><b>${sgn(p.game)}</b></td></tr>`).join('');
  const isPaper = JSON.stringify(P) === JSON.stringify(PAPER);
  $('#polFoot').innerHTML = isPaper
    ? 'These match the paper\'s Table 5. One small difference: the paper prints Fixed Deterministic hours as 480/360/360, which sums to 400 sorties rather than 403. Its text describes the same split as Uniform Random (483/363/363), which is what is shown here. The game value (−30) is unaffected.'
    : 'Recomputed for your edited parameters. Reset them in Section 2 to see the paper\'s Table 5.';
};

/* ---------------- Summary ---------------- */
const TAKE = [
  ['§1', 'Model patrol planning as a <b>Stackelberg game</b>: the defender commits to a randomised policy; a smart attacker sees the policy, not the day\'s draw, and hits the weakest spot.'],
  ['§2', 'A sortie of τ<sub>p</sub> hours protects for W = τ<sub>p</sub> + τ<sub>s</sub>, so every flying hour is worth <b>μ = W/τ<sub>p</sub></b> protection hours. Work with the integer-feasible budget <b>B<sub>eff</sub></b>.'],
  ['§3', 'Coverage is a ratio of hours: <b>P<sub>k</sub> = μh<sub>k</sub>/(n<sub>k</sub>T)</b>, valid only if sorties are spread evenly in time.'],
  ['§4', 'Payoff <b>U<sub>d</sub> = v<sub>k</sub>(2P<sub>k</sub> − 1)</b>. The defender maximises the minimum, and at the optimum the attacker is <b>indifferent</b> among active types.'],
  ['§5', 'Stage 1 has a closed form: <b>z* = (B<sub>eff</sub> − TN<sub>b</sub>/2μ)/Σd<sub>k</sub></b>, <b>h*<sub>k</sub> = d<sub>k</sub>(z* + v<sub>k</sub>)</b>. A type is dropped only when z* ≤ −v<sub>k</sub>.'],
  ['§6', 'Stage 2 writes h* as a <b>lottery over whole-sortie plans</b> via a feasibility LP. Floor/ceil candidates suffice, and at most K+1 plans are ever needed.'],
  ['§7', 'Stage 3 spreads sorties over barriers, <b>randomises each barrier\'s phase</b> independently, and assigns aircraft greedily under gap G and budget F.'],
  ['§8', '<b>N<sub>min</sub>(θ) = ⌈θTN<sub>b</sub>/(μF)⌉</b>: θ = ½ for zero expected loss, θ = 1 for full coverage.'],
  ['§9', 'The toy example shows mixing <b>creates value</b>: the 50/50 coin earns 1.5, more than either plan alone (1 or 0).'],
  ['§10', 'The whole method is a <b>19-line algorithm</b> with no heavy solver: a closed form, a tiny LP, and a greedy scheduler.'],
  ['§11', 'All valid mixes have the same expected payoff, but <b>floor/ceil uniquely maximises the worst month</b>. Diversifying further only helps a patient attacker.'],
  ['§12', 'Against common-sense policies, <b>only Stackelberg leaves no weakest link</b>. Intuitive “protect the valuable stuff” rules do worst.'],
];
render.s13 = () => {
  $('#takeaways').innerHTML = TAKE.map(([s, t], i) => `<li><b>${s}</b> ${t} <a href="#s${i + 1}">revisit</a></li>`).join('');
};

/* ============================================================
   Glossary, tooltip, boot
   ============================================================ */

const GLOSS = [
  ['N, K', 'Number of aircraft; number of barrier types'], ['n_k, v_k', 'Count and military value of barriers of type k'],
  ['N_b = Σ n_k', 'Total number of individual barriers'], ['T', 'Planning horizon; the schedule repeats every T hours'],
  ['τp', 'Patrol duration: flying hours per sortie'], ['τs', 'Safe period after a patrol ends'],
  ['W = τp + τs', 'Protection window of one sortie'], ['μ = W/τp', 'Window multiplier: protection-hours per flying hour'],
  ['τr', 'Aircraft restart (turnaround) period'], ['G = τp + τr', 'Minimum gap between one aircraft\'s sortie starts'],
  ['F', 'Maximum flying hours per aircraft per period'], ['B = N·F', 'Total fleet flying hours'],
  ['N_srt = ⌊B/τp⌋', 'Maximum whole number of sorties'], ['B_eff = N_srt·τp', 'Integer-feasible budget used by Stage 1'],
  ['h_k', 'Total flying hours on all barriers of type k'], ['P_k', 'Coverage probability of one barrier of type k'],
  ['U_d(k; h)', 'Defender expected payoff if type k is attacked'], ['z*', 'Game value: best achievable worst-case payoff'],
  ['d_k = n_kT/(2μv_k)', 'Sensitivity: hours needed per unit of payoff on type k'], ['A (active set)', 'Types with h*_k > 0'],
  ['m_k, m_jk', 'Sortie count on type k (in plan j)'], ['m*_k = h*_k/τp', 'Fractional sortie target'],
  ['A_jk', 'Flying hours on type k in pure plan j'], ['s_j', 'Probability of flying pure plan j'],
  ['ε_k', 'Stage-2 slack: coverage shortfall on type k'], ['λ_k, ν', 'Dual variables: under-coverage signal; probability-row dual'],
  ['q_i, Δ_i = T/q_i', 'Sorties on barrier i; its patrol interval'], ['p_i = W/Δ_i', 'Coverage of individual barrier i'],
  ['φ_i', 'Random phase (start offset) of barrier i'], ['θ', 'Coverage threshold for the minimum fleet size'],
  ['N_min(θ)', 'Minimum fleet for coverage ≥ θ on every barrier'], ['W(s), W*', 'Worst realised payoff of mix s; its floor bound (Section 11)'],
];
function initGlossary() {
  const tbl = $('#glossaryTable');
  const draw = q => { tbl.innerHTML = '<tr><th>Symbol</th><th>Meaning</th></tr>' + GLOSS.filter(([a, b]) => !q || (a + b).toLowerCase().includes(q)).map(([a, b]) => `<tr><td><code>${a}</code></td><td>${b}</td></tr>`).join(''); };
  draw('');
  $('#glossarySearch').addEventListener('input', e => draw(e.target.value.toLowerCase()));
  $('#glossaryBtn').addEventListener('click', () => { $('#glossary').hidden = false; $('#glossarySearch').focus(); });
  $('#glossaryClose').addEventListener('click', () => { $('#glossary').hidden = true; });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') $('#glossary').hidden = true; });
}
function initTip() {
  const tip = $('#tip');
  document.addEventListener('mousemove', e => {
    const t = e.target.closest && e.target.closest('[data-tip]');
    if (!t) { tip.classList.remove('on'); return; }
    tip.textContent = t.getAttribute('data-tip');
    tip.classList.add('on');
    const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
    tip.style.left = `${x}px`; tip.style.top = `${e.clientY + 16}px`;
  });
}

function boot() {
  ['s3', 's4', 's5', 's6', 's7', 's8', 's10', 's11', 's12'].forEach(id => {
    const chip = document.createElement('div'); chip.className = 'run-chip';
    $(`#${id} .lesson-head`).after(chip);
  });
  buildToc(); buildQuizzes(); updateProgress();
  initS1(); initS2(); initS3(); initS4(); initS5(); initS6(); initCG(); initS7(); initS8(); initS9(); initS10(); initS11(); initS12();
  initGlossary(); initTip();
  fillChips();
  $('#tocToggle').addEventListener('click', () => $('#toc').classList.toggle('collapsed'));
  $('#resetProgress').addEventListener('click', () => { done.clear(); saveDone(); updateProgress(); $$('.quiz').forEach(q => { $$('.opt', q).forEach(o => o.classList.remove('right', 'wrong')); $('.why', q).hidden = true; }); });
  if (window.renderMathInElement) {
    window.renderMathInElement(document.body, { delimiters: [{ left: '\\[', right: '\\]', display: true }, { left: '\\(', right: '\\)', display: false }], throwOnError: false });
  }
  window.addEventListener('hashchange', () => show(location.hash.slice(1)));
  show(location.hash.slice(1) || 's1');
}
boot();
