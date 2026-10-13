'use strict';

/* ============================================================
   "Taking this idea forward" — the patrol paper's pattern applied
   to other decisions. Self-contained; styles come from learn.css.
   ============================================================ */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const sum = a => a.reduce((s, x) => s + x, 0);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const COL = k => `var(--c${k})`;
const EXTRA = ['#eda100', '#6250d6', '#e87ba4'];
const colorOf = k => (k < 3 ? COL(k) : EXTRA[(k - 3) % EXTRA.length]);

function fmt(x, d = 2) {
  if (!Number.isFinite(x)) return '—';
  const s = x.toFixed(d);
  return /^-0\.?0*$/.test(s) ? s.slice(1) : s;
}
const sgn = (x, d = 1) => (x > 0.5 * 10 ** -d ? '+' : '') + fmt(x, d);
const pct = (x, d = 0) => `${fmt(100 * x, d)}%`;

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
    s += `<line class="grid" x1="${o.ml}" x2="${o.W - o.mr}" y1="${sy(t)}" y2="${sy(t)}"/><text x="${o.ml - 6}" y="${sy(t) + 4}" text-anchor="end">${(o.yf || String)(t)}</text>`;
  });
  (o.xt || []).forEach(t => { s += `<text x="${sx(t)}" y="${o.H - o.mb + 15}" text-anchor="middle">${(o.xf || String)(t)}</text>`; });
  s += `<line class="axis" x1="${o.ml}" x2="${o.W - o.mr}" y1="${o.H - o.mb}" y2="${o.H - o.mb}"/>`;
  if (o.xl) s += `<text x="${(o.ml + o.W - o.mr) / 2}" y="${o.H - 4}" text-anchor="middle">${o.xl}</text>`;
  if (o.yl) s += `<text x="12" y="${(o.mt + o.H - o.mb) / 2}" text-anchor="middle" transform="rotate(-90 12 ${(o.mt + o.H - o.mb) / 2})">${o.yl}</text>`;
  return { sx, sy, s };
}
const svgWrap = (W, H, body, label) => `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">${body}</svg>`;
const poly = (pts, attrs) => `<polyline fill="none" points="${pts.map(p => p.join(',')).join(' ')}" ${attrs}/>`;
const tipAttr = s => `data-tip="${String(s).replace(/"/g, '&quot;')}"`;

function segButtons(el, items, current, onPick) {
  el.innerHTML = items.map(([v, label]) => `<button data-v="${v}" class="${v === current ? 'on' : ''}">${label}</button>`).join('');
  el.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    $$('button', el).forEach(x => x.classList.toggle('on', x === b));
    onPick(b.dataset.v);
  };
}

/* ============================================================
   Concept translator
   ============================================================ */

const TR_ROWS = ['Defender (leader)', 'Attacker (follower)', 'Barrier types', 'Value v<sub>k</sub>', 'Budget B<sub>eff</sub>',
  'Coverage P<sub>k</sub>', 'Mixed strategy (Stage 2)', 'Indifference at z*', 'Inactive type (Case 3)', 'Phase randomisation (Stage 3)', 'Minimum fleet N<sub>min</sub>'];
const TR = {
  paper: ['Paper', ['Aircraft fleet operator', 'Intelligent intruder', 'Barriers (borders, choke points)', 'Military value of a barrier', 'Fleet flying hours', 'Fraction of time a barrier is protected', 'Lottery over whole-sortie monthly plans', 'Every active barrier type equally (un)attractive', 'A barrier type left unpatrolled', 'Random start time per barrier', 'Aircraft needed for zero loss / full cover']],
  viva: ['Viva / exam', ['You, the student', 'The examiner probing weak spots', 'Syllabus topics', 'Marks at stake on a topic', 'Study hours before the exam', 'How well you know a topic', 'Not needed: preparation is split, not randomised (Stage 1 only)', 'The examiner gains nothing by switching topic', 'A low-stakes topic you deliberately skip', '—', 'Hours needed to be safe on every topic']],
  penalty: ['Penalty kick', ['Penalty taker', 'Goalkeeper with a scouting report', 'Left side / right side', 'How much each side matters (scoring chance)', 'One kick', 'Chance the keeper guesses wrong', 'Probability of kicking left', 'Keeper gains nothing by leaning either way', 'A side so bad you never use it', 'Varying the run-up and timing', 'Practice needed to make both sides reliable']],
  poker: ['Poker', ['You, the bettor', 'Opponent deciding to call', 'Your strong hands and your bluffs', 'Pot size', 'Your chips', 'How often a bet is “real”', 'Bluffing frequency chosen in advance', 'Caller indifferent between call and fold', 'Weak hands you simply give up', 'Varying bet timing and sizing', 'Bankroll to ride out variance']],
  commute: ['Commute / personal safety', ['You', 'Someone learning your routine', 'Routes and departure times', 'Harm if intercepted on that route', 'Extra minutes you will spend', 'Chance a watcher misses you on a route', 'Draw today\'s route from a fixed mix', 'Watcher gains nothing by picking any route', 'Very slow routes kept at 0%', 'Varying departure time', 'Extra time per day to reach a risk target']],
  portfolio: ['Portfolio', ['You, the investor', 'A pessimistic “world” (assumed, not real)', 'Economic scenarios', 'Return in that scenario', 'Money to allocate', 'How well you are protected in a scenario', 'Weights: split, not randomised', 'Worst scenarios equalised', 'Assets given zero weight', 'Varying order size and timing (execution)', 'Capital needed for a target floor']],
  transit: ['Ticket inspection', ['Transit authority', 'Fare evader', 'Train lines and stations', 'Fare revenue at risk', 'Inspector-hours', 'Chance of being checked', 'Random daily inspection rota', 'Evading equally (un)tempting everywhere', 'Lines not worth inspecting', 'Random shift start times', 'Inspectors needed so evading never pays']],
  chess: ['Chess openings', ['You', 'Opponent who prepares against you', 'Your openings', 'Damage if they are deeply prepared', 'Study time', 'Chance your choice was not prepared for', 'Repertoire played with some randomness', 'No opening worth preparing more than another', 'Openings you drop', 'Move-order surprises', 'Repertoire size needed']],
};
let trSel = 'viva';
function renderTranslator() {
  segButtons($('#trPick'), Object.entries(TR).filter(([k]) => k !== 'paper').map(([k, [n]]) => [k, n]), trSel, v => { trSel = v; renderTranslator(); });
  const [name, col] = TR[trSel], paper = TR.paper[1];
  $('#trTable').innerHTML = `<tr><th>Concept</th><th style="text-align:left">In the paper</th><th style="text-align:left">In: ${name}</th></tr>` +
    TR_ROWS.map((r, i) => `<tr><td><b>${r}</b></td><td style="text-align:left;white-space:normal">${paper[i]}</td><td style="text-align:left;white-space:normal">${col[i]}</td></tr>`).join('');
}

/* ============================================================
   Case 1 — viva study plan (Stage 1 in disguise)
   ============================================================ */

const viva = {
  topics: [
    { name: 'Linear algebra', w: 30, c: 20 },
    { name: 'Probability', w: 25, c: 15 },
    { name: 'Optimisation', w: 30, c: 30 },
    { name: 'Graph theory', w: 15, c: 10 },
  ],
  H: 40, strat: 'opt',
};
function vivaMaxmin(T, H) {
  const C = sum(T.map(t => t.c));
  if (H >= C) return { h: T.map(t => t.c), L: 0, dropped: [] };
  let A = T.map((_, i) => i), L = 0, dropped = [];
  for (let g = 0; g < T.length + 1; g++) {
    L = (sum(A.map(i => T[i].c)) - H) / sum(A.map(i => T[i].c / T[i].w));
    const neg = A.filter(i => T[i].w <= L + 1e-9);
    if (!neg.length) break;
    dropped = dropped.concat(neg);
    A = A.filter(i => !neg.includes(i));
  }
  return { h: T.map((t, i) => (A.includes(i) ? t.c * (1 - L / t.w) : 0)), L, dropped };
}
// Water-fill: give each open topic an equal (or weighted) share, capping at full mastery.
function fillShares(T, H, weight) {
  const h = T.map(() => 0);
  let open = T.map((_, i) => i), left = H;
  for (let g = 0; g < T.length + 1 && left > 1e-9 && open.length; g++) {
    const W = sum(open.map(weight));
    const capped = [];
    open.forEach(i => { const add = (left * weight(i)) / W; if (h[i] + add >= T[i].c) capped.push(i); });
    if (!capped.length) { open.forEach(i => { h[i] += (left * weight(i)) / W; }); left = 0; break; }
    capped.forEach(i => { left -= T[i].c - h[i]; h[i] = T[i].c; });
    open = open.filter(i => !capped.includes(i));
  }
  return h;
}
function vivaStrategies() {
  const T = viva.topics, H = viva.H;
  const greedy = T.map(() => 0);
  let left = H;
  T.map((t, i) => i).sort((a, b) => T[b].w - T[a].w).forEach(i => { greedy[i] = Math.min(T[i].c, left); left -= greedy[i]; });
  return {
    equal: { name: 'Equal hours', h: fillShares(T, H, () => 1) },
    prop: { name: 'Proportional to marks', h: fillShares(T, H, i => T[i].w) },
    greedy: { name: 'Biggest topic first', h: greedy },
    opt: { name: 'Max–min (Stage 1 formula)', h: vivaMaxmin(T, H).h },
  };
}
const lossOf = (t, h) => t.w * (1 - Math.min(1, h / t.c));
function initViva() {
  $('#vivaEdit').innerHTML = `<tr><th>Topic</th><th>Marks at stake w</th><th>Hours to master c</th></tr>` +
    viva.topics.map((t, i) => `<tr><td><span class="swatch" style="background:${colorOf(i)}"></span>${t.name}</td><td><input type="number" min="1" step="1" value="${t.w}" data-i="${i}" data-f="w" style="width:5rem"></td><td><input type="number" min="1" step="1" value="${t.c}" data-i="${i}" data-f="c" style="width:5rem"></td></tr>`).join('');
  $('#vivaEdit').addEventListener('input', e => {
    const x = parseFloat(e.target.value);
    if (!(x > 0)) return;
    viva.topics[+e.target.dataset.i][e.target.dataset.f] = x;
    renderViva();
  });
  $('#vivaH').addEventListener('input', e => { viva.H = +e.target.value; renderViva(); });
  segButtons($('#vivaStrat'), [['opt', 'Max–min (Stage 1 formula)'], ['equal', 'Equal hours'], ['prop', 'Proportional to marks'], ['greedy', 'Biggest topic first']], viva.strat, v => { viva.strat = v; renderViva(); });
}
function renderViva() {
  const T = viva.topics, C = sum(T.map(t => t.c));
  const sl = $('#vivaH'); sl.max = Math.ceil(C); viva.H = Math.min(viva.H, C); sl.value = viva.H;
  $('#vivaHOut').textContent = `${viva.H} h of ${C} h for full mastery`;
  const S = vivaStrategies(), cur = S[viva.strat];
  const losses = T.map((t, i) => lossOf(t, cur.h[i]));
  const worst = Math.max(...losses), tgt = losses.indexOf(worst), wmax = Math.max(...T.map(t => t.w));
  $('#vivaChart').innerHTML = T.map((t, i) => `<div class="ubar-row ${i === tgt && worst > 1e-9 ? 'target' : ''}" style="grid-template-columns:150px 1fr 90px">
      <div><span class="swatch" style="background:${colorOf(i)}"></span>${t.name}<br><small class="widget-sub">${fmt(cur.h[i], 1)} h · mastery ${pct(Math.min(1, cur.h[i] / t.c))}</small></div>
      <div class="ubar-track" ${tipAttr(`Marks lost if probed on ${t.name}: ${t.w} × (1 − ${fmt(Math.min(1, cur.h[i] / t.c), 2)}) = ${fmt(losses[i], 1)}`)}><div class="bar" style="left:0;width:${(100 * losses[i]) / wmax}%;background:${colorOf(i)}"></div></div>
      <div class="val">−${fmt(losses[i], 1)}${i === tgt && worst > 1e-9 ? '<br><span class="target-tag">examiner probes</span>' : ''}</div></div>`).join('') +
    '<p class="widget-sub" style="margin:.3rem 0 0">Bars = marks you would lose if the examiner probes that topic. Shorter is better.</p>';
  const rows = Object.entries(S).map(([k, s]) => {
    const L = T.map((t, i) => lossOf(t, s.h[i]));
    return { k, name: s.name, h: s.h, worst: Math.max(...L), avg: sum(L) / L.length };
  });
  const best = Math.min(...rows.map(r => r.worst));
  $('#vivaTable').innerHTML = `<tr><th>Strategy</th>${T.map((t, i) => `<th><span class="swatch" style="background:${colorOf(i)}"></span>Hours</th>`).join('')}<th>Worst-case loss</th><th>Average loss (random examiner)</th></tr>` +
    rows.map(r => `<tr class="${r.k === viva.strat ? 'hl' : ''}"><td>${r.name}</td>${r.h.map(x => `<td>${fmt(x, 1)}</td>`).join('')}<td class="${r.worst <= best + 1e-6 ? 'pos' : 'neg'}"><b>−${fmt(r.worst, 1)}</b></td><td>−${fmt(r.avg, 1)}</td></tr>`).join('');
  const mm = vivaMaxmin(T, viva.H);
  $('#vivaMsg').innerHTML = mm.dropped.length
    ? `With only ${viva.H} h, the formula gives <b>zero hours to ${mm.dropped.map(i => T[i].name).join(', ')}</b>: its marks (${mm.dropped.map(i => T[i].w).join(', ')}) are no more than the equalised loss L* = ${fmt(mm.L, 1)} you are already conceding elsewhere. This is the paper's Case 3.`
    : `Max–min equalises every topic's loss at L* = ${fmt(mm.L, 1)} marks, so the examiner has no better topic to probe. Its <em>average</em> loss can be higher than other plans; that's the price of guarding against the worst case. Lower the hours to watch a topic drop out (Case 3).`;
}

/* ============================================================
   Case 2 — penalty kick
   ============================================================ */

const pen = { M: { LL: 0.58, LR: 0.95, RL: 0.93, RR: 0.70 } };
function initPenalty() {
  const cells = [['LL', 'Kick Left, keeper dives Left'], ['LR', 'Kick Left, keeper dives Right'], ['RL', 'Kick Right, keeper dives Left'], ['RR', 'Kick Right, keeper dives Right']];
  $('#penEdit').innerHTML = `<tr><th>Situation</th><th>Chance of scoring</th></tr>` +
    cells.map(([k, l]) => `<tr><td>${l}</td><td><input type="number" min="0" max="1" step="0.01" value="${pen.M[k]}" data-k="${k}" style="width:5rem"></td></tr>`).join('');
  $('#penEdit').addEventListener('input', e => { const x = parseFloat(e.target.value); if (x >= 0 && x <= 1) { pen.M[e.target.dataset.k] = x; renderPenalty(); } });
  $('#penP').addEventListener('input', renderPenalty);
}
function renderPenalty() {
  const { LL, LR, RL, RR } = pen.M, p = +$('#penP').value;
  $('#penPOut').textContent = pct(p);
  const vL = x => x * LL + (1 - x) * RL, vR = x => x * LR + (1 - x) * RR;
  const den = LL - LR - RL + RR;
  let pStar = Math.abs(den) > 1e-9 ? (RR - RL) / den : 0.5;
  const interior = pStar > 0 && pStar < 1;
  if (!interior) pStar = Math.min(vL(0), vR(0)) >= Math.min(vL(1), vR(1)) ? 0 : 1;
  const qStar = Math.abs(den) > 1e-9 ? (RR - LR) / den : 0.5;
  const g = Math.min(vL(p), vR(p)), gStar = Math.min(vL(pStar), vR(pStar));
  const Wd = 600, H = 250, ys = [LL, LR, RL, RR], y0 = Math.max(0, Math.min(...ys) - 0.08), y1 = Math.min(1, Math.max(...ys) + 0.06);
  const f = frame({ W: Wd, H, ml: 44, mr: 130, mt: 12, mb: 36, x0: 0, x1: 1, y0, y1, xt: [0, .25, .5, .75, 1], xf: t => pct(t), yt: niceTicks(y0, y1, 5), yf: t => pct(t), xl: 'How often you kick Left' });
  let b = f.s;
  const env = []; for (let i = 0; i <= 100; i++) { const x = i / 100; env.push([f.sx(x), f.sy(Math.min(vL(x), vR(x)))]); }
  b += poly(env, 'stroke="var(--text)" stroke-width="7" stroke-opacity=".12" stroke-linejoin="round"');
  b += poly([[f.sx(0), f.sy(vL(0))], [f.sx(1), f.sy(vL(1))]], `stroke="${COL(0)}" stroke-width="2"`);
  b += poly([[f.sx(0), f.sy(vR(0))], [f.sx(1), f.sy(vR(1))]], `stroke="${COL(1)}" stroke-width="2"`);
  b += `<text x="${f.sx(1) + 6}" y="${f.sy(vL(1)) + 4}" class="lbl-strong">keeper dives Left</text><text x="${f.sx(1) + 6}" y="${f.sy(vR(1)) + 4}" class="lbl-strong">keeper dives Right</text>`;
  b += `<line x1="${f.sx(p)}" x2="${f.sx(p)}" y1="${f.sy(y1)}" y2="${f.sy(y0)}" stroke="var(--text-2)"/>`;
  b += `<circle cx="${f.sx(pStar)}" cy="${f.sy(gStar)}" r="5" fill="var(--text)" stroke="var(--surface)" stroke-width="2" ${tipAttr(`Best mix: kick Left ${pct(pStar)} → score ${pct(gStar, 1)} whatever the keeper does`)}/>`;
  $('#penChart').innerHTML = svgWrap(Wd, H, b, 'Scoring chance versus kicking frequency');
  $('#penLegend').innerHTML = `<span><i style="background:${COL(0)}"></i>if the keeper always dives Left</span><span><i style="background:${COL(1)}"></i>if the keeper always dives Right</span><span><i style="background:var(--text);opacity:.25"></i>what a keeper who knows your habit leaves you</span>`;
  const keeperDive = vL(p) < vR(p) - 1e-9 ? 'Left' : vR(p) < vL(p) - 1e-9 ? 'Right' : 'either way';
  $('#penStats').innerHTML = `
    <div class="stat"><b>Keeper's best response</b><span>${keeperDive}</span><small>given your habit</small></div>
    <div class="stat ${g >= gStar - 0.002 ? 'good' : 'bad'}"><b>Your scoring chance</b><span>${pct(g, 1)}</span><small>best possible ${pct(gStar, 1)}</small></div>
    <div class="stat"><b>Best kicking mix</b><span>${pct(pStar)} Left</span><small>${interior ? `keeper's best mix: dive Left ${pct(clamp(qStar, 0, 1))}` : 'one side dominates: no mixing needed'}</small></div>`;
  $('#penMsg').innerHTML = interior
    ? `At ${pct(pStar)} Left, both lines meet: the keeper gains nothing from the scouting report. Kick Left more often and keepers will dive Left; kick it less and they'll dive Right. Same logic as Remark 3.`
    : 'With these numbers one side is better whatever the keeper does, so the best plan is pure: no opponent can be made indifferent. The pattern needs a genuine trade-off.';
}

/* ============================================================
   Case 3 — poker bluffing
   ============================================================ */

function initPoker() { ['pkPot', 'pkBet', 'pkF'].forEach(id => $('#' + id).addEventListener('input', renderPoker)); }
function renderPoker() {
  const P = +$('#pkPot').value, B = +$('#pkBet').value, f = +$('#pkF').value;
  $('#pkPotOut').textContent = P; $('#pkBetOut').textContent = `${B} (${fmt(B / P, 2)}× pot)`; $('#pkFOut').textContent = pct(f);
  const fStar = B / (P + 2 * B), cStar = P / (P + B);
  // Your EV per strong hand, against an opponent who best-responds to your known bluffing rate.
  const ev = x => (x <= fStar ? P / (1 - x) : (P + B) - (B * x) / (1 - x));
  const callEV = x => x * (P + B) - (1 - x) * B;
  const Wd = 600, H = 250, xs = []; for (let i = 0; i <= 160; i++) xs.push((0.8 * i) / 160);
  const ys = xs.map(ev), y0 = Math.min(0, ...ys), y1 = Math.max(...ys) * 1.08;
  const f2 = frame({ W: Wd, H, ml: 50, mr: 16, mt: 14, mb: 36, x0: 0, x1: 0.8, y0, y1, xt: [0, .2, .4, .6, .8], xf: t => pct(t), yt: niceTicks(y0, y1, 5), xl: 'Fraction of your bets that are bluffs', yl: 'Your profit per strong hand' });
  let b = f2.s + poly(xs.map(x => [f2.sx(x), f2.sy(ev(x))]), 'stroke="var(--accent)" stroke-width="2.5"');
  b += `<line x1="${f2.sx(fStar)}" x2="${f2.sx(fStar)}" y1="${f2.sy(y1)}" y2="${f2.sy(y0)}" stroke="var(--accent)" stroke-dasharray="3 3"/><text x="${f2.sx(fStar) + 5}" y="${f2.sy(y1) + 12}" class="lbl-strong">balanced: ${pct(fStar, 1)}</text>`;
  b += `<text x="${f2.sx(fStar / 2)}" y="${f2.sy(ev(fStar / 2)) + 18}" text-anchor="middle">they always fold</text><text x="${f2.sx(0.62) - 10}" y="${f2.sy(ev(0.62)) - 12}" text-anchor="end">they always call</text>`;
  b += `<circle cx="${f2.sx(f)}" cy="${f2.sy(ev(f))}" r="6" fill="var(--bad)" stroke="var(--surface)" stroke-width="2" ${tipAttr(`At ${pct(f)} bluffs you make ${fmt(ev(f), 1)} per strong hand`)}/>`;
  $('#pkChart').innerHTML = svgWrap(Wd, H, b, 'Profit versus bluffing frequency');
  const ce = callEV(f);
  $('#pkStats').innerHTML = `
    <div class="stat"><b>Balanced bluff share</b><span>${pct(fStar, 1)}</span><small>B / (P + 2B)</small></div>
    <div class="stat ${Math.abs(ce) < 1e-6 ? '' : ce > 0 ? 'bad' : 'good'}"><b>Their profit from calling</b><span>${sgn(ce, 1)}</span><small>${Math.abs(f - fStar) < 0.005 ? 'indifferent: calling and folding pay the same' : ce > 0 ? 'positive: they should always call you' : 'negative: they should always fold'}</small></div>
    <div class="stat"><b>How often they should call</b><span>${pct(cStar, 1)}</span><small>P / (P + B) keeps <em>your</em> bluffs break-even</small></div>
    <div class="stat ${Math.abs(f - fStar) < 0.01 ? 'good' : ''}"><b>Your profit per strong hand</b><span>${fmt(ev(f), 1)}</span><small>best ${fmt(ev(fStar), 1)} at the balanced share</small></div>`;
  $('#pkMsg').innerHTML = f < fStar - 0.005
    ? 'Too few bluffs: an observant opponent folds every time you bet, and your strong hands win only the pot.'
    : f > fStar + 0.005 ? 'Too many bluffs: an observant opponent calls every time, and your bluffs bleed chips.'
      : 'Balanced: the opponent cannot gain by calling more or less. Your habit no longer leaks information they can use.';
}

/* ============================================================
   Case 4 — routes
   ============================================================ */

const rt = { routes: [{ name: 'Main road', t: 25 }, { name: 'Through the park', t: 32 }, { name: 'Ring road', t: 40 }], watch: true };
function initRoute() {
  $('#rtEdit').innerHTML = `<tr><th>Route</th><th>Usual travel time (min)</th></tr>` +
    rt.routes.map((r, i) => `<tr><td><span class="swatch" style="background:${colorOf(i)}"></span>${r.name}</td><td><input type="number" min="1" step="1" value="${r.t}" data-i="${i}" style="width:5rem"></td></tr>`).join('');
  $('#rtEdit').addEventListener('input', e => { const x = parseFloat(e.target.value); if (x > 0) { rt.routes[+e.target.dataset.i].t = x; renderRoute(); } });
  $('#rtWatch').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; rt.watch = b.dataset.v === '1'; $$('#rtWatch button').forEach(x => x.classList.toggle('on', x === b)); renderRoute(); });
  $('#rtA').addEventListener('input', renderRoute);
}
function routeMix(a) {
  const order = rt.routes.map((r, i) => i).sort((x, y) => rt.routes[x].t - rt.routes[y].t);
  const p = rt.routes.map(() => 0); let left = 1;
  order.forEach(i => { p[i] = Math.min(a, left); left -= p[i]; });
  return p;
}
function renderRoute() {
  const n = rt.routes.length, aMin = 1 / n;
  const sl = $('#rtA'); sl.min = +aMin.toFixed(2);
  let a = Math.max(+sl.value, aMin);
  if (!rt.watch) a = 1;
  sl.disabled = !rt.watch;
  $('#rtAOut').textContent = rt.watch ? pct(a) : '— (no one is watching)';
  const p = routeMix(a), E = sum(p.map((x, i) => x * rt.routes[i].t));
  const Wd = 600, H = 240, tFast = Math.min(...rt.routes.map(r => r.t)), tAvg = sum(rt.routes.map(r => r.t)) / n;
  const y0 = Math.floor(tFast - 2), y1 = Math.ceil(tAvg + 2);
  const f = frame({ W: Wd, H, ml: 46, mr: 16, mt: 14, mb: 36, x0: aMin, x1: 1, y0, y1, xt: niceTicks(aMin, 1, 5).filter(t => t >= aMin - 1e-9), xf: t => pct(t), yt: niceTicks(y0, y1, 5), xl: 'Chance a watcher intercepts you (your largest route probability)', yl: 'Average trip (min)' });
  const pts = []; for (let i = 0; i <= 100; i++) { const x = aMin + ((1 - aMin) * i) / 100; const q = routeMix(x); pts.push([f.sx(x), f.sy(sum(q.map((v, j) => v * rt.routes[j].t)))]); }
  let b = f.s + poly(pts, 'stroke="var(--accent)" stroke-width="2.5"');
  b += `<circle cx="${f.sx(a)}" cy="${f.sy(E)}" r="6" fill="var(--bad)" stroke="var(--surface)" stroke-width="2" ${tipAttr(`Risk ${pct(a)} · average ${fmt(E, 1)} min`)}/>`;
  b += `<text x="${f.sx(1) - 4}" y="${f.sy(tFast) + 18}" text-anchor="end">always the fastest route: 100% predictable</text><text x="${f.sx(aMin) + 10}" y="${f.sy(tAvg) + 26}">uniform mix: hardest to predict</text>`;
  $('#rtChart').innerHTML = svgWrap(Wd, H, b, 'Average travel time versus interception risk');
  $('#rtStats').innerHTML = rt.routes.map((r, i) => `<div class="stat"><b><span class="swatch" style="background:${colorOf(i)}"></span>${r.name}</b><span>${pct(p[i])}</span><small>of days</small></div>`).join('') +
    `<div class="stat"><b>Average trip</b><span>${fmt(E, 1)} min</span><small>+${fmt(E - tFast, 1)} min vs. always fastest</small></div>` +
    `<div class="stat ${rt.watch ? (a > 0.6 ? 'bad' : 'good') : ''}"><b>Interception risk</b><span>${rt.watch ? pct(a) : 'n/a'}</span><small>${rt.watch ? 'the watcher waits on your most-used route' : 'traffic doesn\'t learn habits'}</small></div>`;
  $('#rtMsg').innerHTML = rt.watch
    ? `Each step left on the curve buys less predictability at a growing cost in minutes. That trade-off is yours to make, just as the paper's N<sub>min</sub>(θ) lets you price coverage.`
    : 'With no one watching, a mix can only average in slower routes: randomising costs time and buys nothing. Take the fastest (or most reliable) route every day.';
}

/* ============================================================
   Case 5 — portfolio max–min
   ============================================================ */

const pf = { assets: ['Stocks', 'Bonds', 'Gold'], scen: ['Boom', 'Recession', 'Inflation'], R: [[20, -15, -5], [3, 8, -8], [-2, 5, 15]], w: [0.6, 0.3, 0.1] };
function initPortfolio() {
  $('#pfEdit').innerHTML = `<tr><th>Return (%) if…</th>${pf.scen.map(s => `<th>${s}</th>`).join('')}</tr>` +
    pf.assets.map((a, i) => `<tr><td><span class="swatch" style="background:${colorOf(i)}"></span>${a}</td>${pf.scen.map((_, j) => `<td><input type="number" step="1" value="${pf.R[i][j]}" data-i="${i}" data-j="${j}" style="width:4.5rem"></td>`).join('')}</tr>`).join('');
  $('#pfEdit').addEventListener('input', e => { const x = parseFloat(e.target.value); if (Number.isFinite(x)) { pf.R[+e.target.dataset.i][+e.target.dataset.j] = x; renderPortfolio(); } });
  const set = (s, b) => { pf.w = [s, b, Math.max(0, 1 - s - b)]; renderPortfolio(); };
  $('#pfS').addEventListener('input', e => { const s = +e.target.value; let b = pf.w[1]; if (s + b > 1) b = 1 - s; set(s, b); });
  $('#pfB').addEventListener('input', e => { const b = +e.target.value; let s = pf.w[0]; if (s + b > 1) s = 1 - b; set(s, b); });
  $('#pfOpt').addEventListener('click', () => { const o = pfMaxmin(); set(o[0], o[1]); });
  $('#pfEq').addEventListener('click', () => set(1 / 3, 1 / 3));
  $('#pfAll').addEventListener('click', () => set(1, 0));
}
const pfScen = w => pf.scen.map((_, j) => sum(w.map((x, i) => x * pf.R[i][j])));
function pfMaxmin() {
  let best = -Infinity, bw = [1 / 3, 1 / 3, 1 / 3];
  for (let s = 0; s <= 200; s++) for (let b = 0; b + s <= 200; b++) {
    const w = [s / 200, b / 200, (200 - s - b) / 200], m = Math.min(...pfScen(w));
    if (m > best + 1e-12) { best = m; bw = w; }
  }
  return bw;
}
function renderPortfolio() {
  const w = pf.w;
  $('#pfS').value = w[0]; $('#pfB').value = w[1];
  $('#pfSOut').textContent = pct(w[0]); $('#pfBOut').textContent = pct(w[1]); $('#pfGOut').textContent = pct(w[2]);
  const r = pfScen(w), worst = Math.min(...r), tgt = r.indexOf(worst), M = Math.max(...pf.R.flat().map(Math.abs), 1);
  $('#pfBars').innerHTML = pf.scen.map((s, j) => {
    const u = r[j], left = 50 + (Math.min(0, u) / M) * 50, wd = (Math.abs(u) / M) * 50;
    return `<div class="ubar-row ${j === tgt ? 'target' : ''}"><div>${s}</div><div class="ubar-track"><div class="zero"></div><div class="bar" style="left:${left}%;width:${wd}%;background:${u >= 0 ? 'var(--ok)' : 'var(--bad)'}"></div></div><div class="val">${sgn(u)}%${j === tgt ? '<br><span class="target-tag">worst case</span>' : ''}</div></div>`;
  }).join('');
  const opt = pfMaxmin(), ro = pfScen(opt);
  const row = (name, ww) => { const x = pfScen(ww); return `<div class="stat"><b>${name}</b><span>${sgn(Math.min(...x))}%</span><small>worst case · average ${sgn(sum(x) / 3)}% · weights ${ww.map(v => pct(v)).join(' / ')}</small></div>`; };
  $('#pfStats').innerHTML = `<div class="stat ${worst >= Math.min(...ro) - 0.05 ? 'good' : ''}"><b>Your worst case</b><span>${sgn(worst)}%</span><small>average over the 3 scenarios ${sgn(sum(r) / 3)}%</small></div>` +
    row('Max–min weights', opt) + row('Equal thirds', [1 / 3, 1 / 3, 1 / 3]) + row('All stocks', [1, 0, 0]);
}

/* ============================================================
   Decision guide
   ============================================================ */

const GQ = [
  'Is there <b>someone</b> (a person, team or organisation, not luck or nature) whose interests oppose yours?',
  'Do they <b>adapt to your habits</b>, learning what you usually do and responding to it?',
  'Can they <b>see your actual move</b> before they commit to theirs?',
  'Are your resources <b>too limited</b> to cover everything you care about?',
];
const gAns = [null, null, null, null];
function renderGuide() {
  const needed = gAns[0] === false ? 1 : gAns[1] === false ? 2 : gAns[2] === true ? 3 : 4;
  $('#guideQs').innerHTML = GQ.map((q, i) => i >= needed && i !== 3 ? '' : `<div class="ex-row" style="grid-template-columns:1fr auto"><div class="q">${i + 1}. ${q}</div><div class="seg" data-q="${i}"><button data-v="1" class="${gAns[i] === true ? 'on' : ''}">Yes</button><button data-v="0" class="${gAns[i] === false ? 'on' : ''}">No</button></div></div>`).join('');
  const [a, b, c, d] = gAns;
  let out;
  if (a === null) out = 'Answer the questions above.';
  else if (!a) out = '<b>No opponent: you are playing against nature.</b> Randomising buys nothing, because a mix can never beat the best single option on average. Choose the option with the best expected outcome. If a bad outcome is unaffordable, choose the one with the best <em>worst</em> case (robust thinking, as in the portfolio case).';
  else if (b === null) out = 'Keep going…';
  else if (!b) out = '<b>An opponent who doesn\'t adapt: exploit them.</b> Study what they actually do and best-respond. You don\'t need to hide anything yet. If they start learning your habits, come back to this guide.';
  else if (c === null) out = 'Keep going…';
  else if (c) out = '<b>They see your move before acting (like a chess move): think ahead.</b> Use minimax / backward induction: “if I do this, their best reply is that, then…”. Randomising doesn\'t help in this phase. But look for a <em>hidden</em> phase (preparation, timing, which plan you\'ll use) where the patrol paper\'s ideas apply again.';
  else out = '<b>This is the patrol paper\'s pattern.</b> Judge plans by their weakest point; equalise so the opponent is indifferent; randomise what they can observe, but only as much as needed; and drop targets not worth defending.';
  if (a && b && c === false && d !== null) out += d
    ? '<br><b>Limited resources:</b> the allocation step (Stage 1) is the heart of it. Work out effort per target and accept that some may get none.'
    : '<br><b>Ample resources:</b> cover everything well first. Randomisation matters less when no target is left weak.';
  $('#guideOut').innerHTML = out;
}
function initGuide() {
  $('#guideQs').addEventListener('click', e => {
    const btn = e.target.closest('button'), seg = e.target.closest('[data-q]');
    if (!btn || !seg) return;
    const i = +seg.dataset.q;
    gAns[i] = btn.dataset.v === '1';
    for (let j = i + 1; j < 3; j++) gAns[j] = null;
    renderGuide();
  });
}

/* ============================================================
   Spot the pattern
   ============================================================ */

const TOOLS = { mix: 'Randomise & equalise', ahead: 'Think ahead', nature: 'No opponent: best expected / robust choice' };
const SPOT = [
  ['Scheduling surprise quality checks at a supplier\'s factory.', 'mix', 'The supplier learns any fixed schedule and tidies up just before it. Random checks with a known overall rate are the patrol paper exactly.'],
  ['Deciding whether to carry an umbrella.', 'nature', 'The weather doesn\'t react to your habits. Use the forecast and the cost of getting wet.'],
  ['Choosing your next move in a chess middlegame.', 'ahead', 'Your opponent sees the board before replying: perfect information, so calculate, don\'t randomise.'],
  ['Serving in tennis to an opponent who has studied your serve patterns.', 'mix', 'Like the penalty kick: mix serve directions so the returner can\'t lean.'],
  ['Choosing between an index fund and a fixed deposit for retirement savings.', 'nature', 'The market isn\'t adapting to you personally. Think expected return and risk tolerance (robust if needed).'],
  ['Designing a spam filter that spammers probe and adapt to.', 'mix', 'Spammers learn fixed rules. Varying which checks run, and keeping some hidden, denies them a stable weak spot.'],
  ['Playing tic-tac-toe.', 'ahead', 'Everything is visible and the game is tiny: look ahead and play perfectly.'],
  ['Picking the quickest route to a meeting on a rainy day.', 'nature', 'Traffic doesn\'t learn your habits; take the best (or most reliable) route.'],
  ['A company buying a large block of shares over several days without moving the price.', 'mix', 'Other traders hunt for predictable order flow. Varying size and timing is Stage 3 phase randomisation.'],
  ['A teacher deciding when to give pop quizzes.', 'mix', 'If students could predict quiz days they would study only then. A known rate with unknown days keeps every day “covered”.'],
];
const spotAns = SPOT.map(() => null);
function renderSpot() {
  $('#spotList').innerHTML = SPOT.map(([q, a, why], i) => `<div class="ex-row" style="grid-template-columns:1fr" data-i="${i}"><div class="q">${i + 1}. ${q}</div>
    <div class="seg" style="flex-wrap:wrap">${Object.entries(TOOLS).map(([k, l]) => `<button data-v="${k}" class="${spotAns[i] === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="fb">${spotAns[i] === null ? '' : spotAns[i] === a ? `<b style="color:var(--ok)">✓</b> ${why}` : `<b style="color:var(--bad)">Not quite.</b> Ask: is there an opponent, do they learn habits, and can they see this move?`}</div></div>`).join('');
  const right = spotAns.filter((x, i) => x === SPOT[i][1]).length, tried = spotAns.filter(x => x !== null).length;
  $('#spotScore').textContent = tried ? `${right} of ${SPOT.length} correct.` : '';
}
function initSpot() {
  $('#spotList').addEventListener('click', e => {
    const b = e.target.closest('button'), row = e.target.closest('[data-i]');
    if (!b || !row) return;
    spotAns[+row.dataset.i] = b.dataset.v;
    renderSpot();
  });
}

/* ============================================================
   Boot
   ============================================================ */

function initToc() {
  $('#tocToggle').addEventListener('click', () => $('#toc').classList.toggle('collapsed'));
  const links = $$('#tocList a');
  const obs = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (en.isIntersecting) links.forEach(a => a.classList.toggle('current', a.getAttribute('href') === `#${en.target.id}`));
    });
  }, { rootMargin: '-30% 0px -60% 0px' });
  $$('main section[id]').forEach(s => obs.observe(s));
  links.forEach(a => a.addEventListener('click', () => $('#toc').classList.add('collapsed')));
}
function initTip() {
  const tip = $('#tip');
  document.addEventListener('mousemove', e => {
    const t = e.target.closest && e.target.closest('[data-tip]');
    if (!t) { tip.classList.remove('on'); return; }
    tip.textContent = t.getAttribute('data-tip');
    tip.classList.add('on');
    tip.style.left = `${Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8)}px`;
    tip.style.top = `${e.clientY + 16}px`;
  });
}

renderTranslator();
initViva(); renderViva();
initPenalty(); renderPenalty();
initPoker(); renderPoker();
initRoute(); renderRoute();
initPortfolio(); renderPortfolio();
initGuide(); renderGuide();
initSpot(); renderSpot();
initToc(); initTip();
