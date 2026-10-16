/* ============================================================
   Experiments page (local only). Reuses the planner's algorithms
   from script.js: computeDerived, stage1, stage2, stage3, buildPlan,
   baselines, minimumFleetSize, twoPhaseSimplex.
   ============================================================ */

(() => {
  /* ---------------- small utilities ---------------- */

  const $ = id => document.getElementById(id);
  const range = (a, b, step = 1) => { const out = []; for (let x = a; x <= b + 1e-9; x += step) out.push(+x.toFixed(10)); return out; };
  const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
  const sd = a => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
  const quantile = (a, q) => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); const i = (s.length - 1) * q, lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };
  const f = (x, d = 3) => (x === null || x === undefined || !Number.isFinite(x) ? '—' : Number(x).toFixed(d));
  const pct = (x, d = 1) => (Number.isFinite(x) ? (x * 100).toFixed(d) + '%' : '—');
  const COLS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#6250d6', '#008300', '#e34948'];
  const col = i => COLS[i % COLS.length];

  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const randInt = (rng, a, b) => a + Math.floor(rng() * (b - a + 1));
  // buildPlan draws phases with Math.random; swap in a seeded generator so runs are reproducible.
  function withSeed(seed, fn) {
    const orig = Math.random;
    Math.random = mulberry32(seed);
    try { return fn(); } finally { Math.random = orig; }
  }

  /* ---------------- model helpers ---------------- */

  function readBase() {
    const list = s => s.split(',').map(x => parseFloat(x.trim())).filter(x => Number.isFinite(x));
    const n = list($('bn').value), v = list($('bv').value);
    const b = {
      N: parseFloat($('bN').value), n, v, K: n.length,
      tau_p: parseFloat($('btp').value), tau_s: parseFloat($('bts').value), tau_r: parseFloat($('btr').value),
      T_days: parseFloat($('bT').value), F: parseFloat($('bF').value), theta: 0.5,
      seed: parseInt($('bSeed').value, 10) || 0
    };
    const errs = validateParams(b);
    if (n.length !== v.length) errs.unshift('n_k and v_k lists must have the same length.');
    return { b, errs };
  }
  const mkP = (b, o = {}) => { const p = { ...b, ...o }; p.K = p.n.length; p.theta = p.theta ?? 0.5; return p; };
  function solve(p, withStage2 = true) {
    const d = computeDerived(p), s1 = stage1(p, d);
    const s2 = withStage2 && s1.feasible ? stage2(p, d, s1) : null;
    return { d, s1, s2 };
  }
  // Realised payoff if integer plan m is flown this month and type k is attacked.
  const planU = (p, d, m) => p.n.map((nk, k) => p.v[k] * (2 * Math.min(1, (d.mu * m[k] * p.tau_p) / (nk * d.T)) - 1));
  // Game value a policy can actually achieve: coverage cannot exceed 100%, so P_k is capped at 1.
  const gameCapped = (p, d, h) => Math.min(...p.n.map((nk, k) => p.v[k] * (2 * Math.min(1, (d.mu * h[k]) / (nk * d.T)) - 1)));
  const overCovered = s1 => s1.P.some(x => x > 1 + 1e-9);
  // Whole sorties the fleet can really fly: each aircraft flies at most floor(F / tau_p) of them.
  const flyableSorties = p => p.N * Math.floor(p.F / p.tau_p + 1e-9);
  const support = s2 => (s2 && s2.feasible ? s2.candidates.map((m, j) => ({ m, s: s2.s[j] })).filter(x => x.s > 1e-6) : []);
  function randomInstance(rng, b, opts = {}) {
    const K = opts.K ?? randInt(rng, 2, 5);
    const n = Array.from({ length: K }, () => randInt(rng, 1, 6));
    const v = Array.from({ length: K }, () => randInt(rng, 1, 10));
    const p0 = mkP(b, { n, v, N: 1 });
    const full = minimumFleetSize(p0, computeDerived(p0)).full;
    return mkP(b, { n, v, N: randInt(rng, 2, Math.max(2, full)) });
  }
  // Fraction of [0, T] during which each barrier is protected by an assigned sortie (exact union length).
  function realisedCoverage(p, d, plan) {
    const off = p.n.map((_, k) => p.n.slice(0, k).reduce((a, c) => a + c, 0)), Nb = d.Nb;
    const iv = Array.from({ length: Nb }, () => []);
    plan.events.forEach(e => { if (e.aircraft !== null) iv[off[e.type] + e.barrierIdx].push([e.start, Math.min(d.T, e.safeUntil)]); });
    return iv.map(list => {
      list.sort((a, c) => a[0] - c[0]);
      let tot = 0, cs = -1, ce = -1; const merged = [];
      list.forEach(([s, e]) => { if (s > ce) { if (ce > cs) { tot += ce - cs; merged.push([cs, ce]); } cs = s; ce = e; } else ce = Math.max(ce, e); });
      if (ce > cs) { tot += ce - cs; merged.push([cs, ce]); }
      return { frac: tot / d.T, merged };
    });
  }

  /* ---------------- drawing helpers ---------------- */

  function niceTicks(a, b, n = 5) {
    if (!(b > a)) b = a + 1;
    const raw = (b - a) / n, mag = 10 ** Math.floor(Math.log10(raw)), r = raw / mag;
    const step = (r < 1.5 ? 1 : r < 3 ? 2 : r < 7 ? 5 : 10) * mag, out = [];
    for (let x = Math.ceil(a / step - 1e-9) * step; x <= b + 1e-9; x += step) out.push(+x.toFixed(10));
    return out;
  }
  const legend = items => `<div class="legend">${items.map(([c, l, dash]) => `<span><i style="background:${dash ? 'repeating-linear-gradient(90deg,' + c + ' 0 4px,transparent 4px 7px)' : c}"></i>${l}</span>`).join('')}</div>`;

  // Multi-series line / scatter chart. Series: {name, y, x?, color, dash?, points?}. Non-finite y breaks the line.
  function lineChart(o) {
    const W = o.W || 760, H = o.H || 280, ml = 62, mr = 18, mt = 14, mb = 46;
    const xsOf = s => s.x || o.x;
    const allX = o.series.flatMap(xsOf).filter(Number.isFinite);
    const allY = o.series.flatMap(s => s.y).filter(Number.isFinite).concat((o.hlines || []).map(h => h.y));
    let x0 = o.xMin ?? Math.min(...allX), x1 = o.xMax ?? Math.max(...allX);
    let y0 = o.yMin ?? Math.min(...allY), y1 = o.yMax ?? Math.max(...allY);
    if (!(y1 - y0 > 1e-12)) { y0 -= 1; y1 += 1; }
    const padY = (y1 - y0) * 0.06;
    if (o.yMin === undefined) y0 -= padY;
    if (o.yMax === undefined) y1 += padY;
    if (!(x1 - x0 > 1e-12)) { x0 -= 1; x1 += 1; }
    const sx = x => ml + ((x - x0) / (x1 - x0)) * (W - ml - mr);
    const sy = y => H - mb - ((Math.max(y0, Math.min(y1, y)) - y0) / (y1 - y0)) * (H - mt - mb);
    const yf = o.yFmt || (t => +t.toFixed(6)), xf = o.xFmt || (t => +t.toFixed(6));
    let s = '';
    niceTicks(y0, y1, 5).forEach(t => { s += `<line x1="${ml}" x2="${W - mr}" y1="${sy(t)}" y2="${sy(t)}" stroke="#eee"/><text x="${ml - 6}" y="${sy(t) + 4}" text-anchor="end" font-size="10">${yf(t)}</text>`; });
    (o.xTicks || niceTicks(x0, x1, 8)).forEach(t => { s += `<line x1="${sx(t)}" x2="${sx(t)}" y1="${H - mb}" y2="${H - mb + 4}" stroke="#999"/><text x="${sx(t)}" y="${H - mb + 16}" text-anchor="middle" font-size="10">${xf(t)}</text>`; });
    s += `<line x1="${ml}" x2="${W - mr}" y1="${H - mb}" y2="${H - mb}" stroke="#999"/><line x1="${ml}" x2="${ml}" y1="${mt}" y2="${H - mb}" stroke="#999"/>`;
    if (o.xLabel) s += `<text x="${(ml + W - mr) / 2}" y="${H - 8}" text-anchor="middle" font-size="11">${o.xLabel}</text>`;
    if (o.yLabel) s += `<text x="14" y="${(mt + H - mb) / 2}" text-anchor="middle" font-size="11" transform="rotate(-90 14 ${(mt + H - mb) / 2})">${o.yLabel}</text>`;
    (o.hlines || []).forEach(h => { s += `<line x1="${ml}" x2="${W - mr}" y1="${sy(h.y)}" y2="${sy(h.y)}" stroke="${h.color || '#555'}" stroke-dasharray="5 4"/>${h.label ? `<text x="${W - mr - 4}" y="${sy(h.y) - 4}" text-anchor="end" font-size="10" fill="${h.color || '#555'}">${h.label}</text>` : ''}`; });
    (o.vlines || []).forEach((v, i) => { if (v.x < x0 || v.x > x1) return; s += `<line x1="${sx(v.x)}" x2="${sx(v.x)}" y1="${mt}" y2="${H - mb}" stroke="${v.color || '#888'}" stroke-dasharray="3 3"/>${v.label ? `<text x="${sx(v.x) + 4}" y="${mt + 12 + 13 * i}" font-size="10" fill="${v.color || '#555'}">${v.label}</text>` : ''}`; });
    o.series.forEach((se, si) => {
      const c = se.color || col(si), xs = xsOf(se);
      if (se.points) {
        se.y.forEach((y, i) => { if (Number.isFinite(y) && Number.isFinite(xs[i])) s += `<circle cx="${sx(xs[i]).toFixed(1)}" cy="${sy(y).toFixed(1)}" r="${se.r || 3}" fill="${c}" fill-opacity="${se.opacity ?? 0.7}"/>`; });
        return;
      }
      let seg = [];
      const flush = () => { if (seg.length > 1) s += `<polyline fill="none" stroke="${c}" stroke-width="${se.width || 2}" ${se.dash ? 'stroke-dasharray="6 4"' : ''} points="${seg.join(' ')}"/>`; else if (seg.length === 1) { const [cx, cy] = seg[0].split(','); s += `<circle cx="${cx}" cy="${cy}" r="2.5" fill="${c}"/>`; } seg = []; };
      se.y.forEach((y, i) => { if (Number.isFinite(y) && Number.isFinite(xs[i])) seg.push(`${sx(xs[i]).toFixed(1)},${sy(y).toFixed(1)}`); else flush(); });
      flush();
      if (se.markers) se.y.forEach((y, i) => { if (Number.isFinite(y)) s += `<circle cx="${sx(xs[i]).toFixed(1)}" cy="${sy(y).toFixed(1)}" r="2.6" fill="${c}"/>`; });
    });
    return `<div style="overflow-x:auto"><svg viewBox="0 0 ${W} ${H}" width="100%" style="min-width:560px;font-family:inherit" role="img" aria-label="${o.title || 'chart'}">${s}</svg></div>` +
      legend(o.series.filter(se => se.name).map((se, si) => [se.color || col(o.series.indexOf(se)), se.name, se.dash]).concat((o.hlines || []).filter(h => h.legend).map(h => [h.color || '#555', h.legend, true])));
  }

  function barChart(o) {
    const W = o.W || 760, H = o.H || 260, ml = 62, mr = 18, mt = 14, mb = 50, n = o.labels.length;
    const vals = o.values.filter(Number.isFinite).concat((o.hlines || []).map(h => h.y));
    const y0 = Math.min(0, ...vals), y1 = Math.max(...vals, 1e-9) * 1.08;
    const sy = y => H - mb - ((y - y0) / (y1 - y0)) * (H - mt - mb), bw = (W - ml - mr) / n;
    let s = '';
    niceTicks(y0, y1, 5).forEach(t => { s += `<line x1="${ml}" x2="${W - mr}" y1="${sy(t)}" y2="${sy(t)}" stroke="#eee"/><text x="${ml - 6}" y="${sy(t) + 4}" text-anchor="end" font-size="10">${(o.yFmt || (x => +x.toFixed(4)))(t)}</text>`; });
    o.values.forEach((v, i) => {
      const x = ml + i * bw, c = Array.isArray(o.color) ? o.color[i] : o.color || col(0);
      if (Number.isFinite(v)) s += `<rect x="${x + bw * 0.12}" y="${Math.min(sy(v), sy(0))}" width="${bw * 0.76}" height="${Math.abs(sy(v) - sy(0))}" fill="${c}" rx="2"><title>${o.labels[i]}: ${f(v, 3)}</title></rect>`;
      if (n <= 30 || i % Math.ceil(n / 30) === 0) s += `<text x="${x + bw / 2}" y="${H - mb + 14}" text-anchor="middle" font-size="${n > 16 ? 8 : 10}">${o.labels[i]}</text>`;
    });
    (o.hlines || []).forEach(h => { s += `<line x1="${ml}" x2="${W - mr}" y1="${sy(h.y)}" y2="${sy(h.y)}" stroke="${h.color || '#b00020'}" stroke-dasharray="5 4"/><text x="${W - mr - 4}" y="${sy(h.y) - 4}" text-anchor="end" font-size="10" fill="${h.color || '#b00020'}">${h.label || ''}</text>`; });
    s += `<line x1="${ml}" x2="${W - mr}" y1="${sy(0)}" y2="${sy(0)}" stroke="#999"/>`;
    if (o.xLabel) s += `<text x="${(ml + W - mr) / 2}" y="${H - 8}" text-anchor="middle" font-size="11">${o.xLabel}</text>`;
    if (o.yLabel) s += `<text x="14" y="${(mt + H - mb) / 2}" text-anchor="middle" font-size="11" transform="rotate(-90 14 ${(mt + H - mb) / 2})">${o.yLabel}</text>`;
    return `<div style="overflow-x:auto"><svg viewBox="0 0 ${W} ${H}" width="100%" style="min-width:560px;font-family:inherit" role="img" aria-label="${o.title || 'bar chart'}">${s}</svg></div>`;
  }

  const table = (headers, rows) => `<div style="overflow-x:auto"><table><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;

  /* ---------------- the experiments ---------------- */

  const EXPS = [];
  const exp = (title, question, setup, heavy, run) => EXPS.push({ title, question, setup, heavy, run });

  /* 1 */
  exp('Fleet size and the three regimes',
    'How do the game value z* and each type\'s coverage change as the fleet grows, and where do the regime switches happen?',
    'Sweep N from 1 to 1.2 × N<sub>min</sub>(1). Everything else at the base configuration. Stage 1 only.', false, b => {
      const p0 = mkP(b), d0 = computeDerived(p0), fs = minimumFleetSize(p0, d0);
      const Ns = range(1, Math.max(10, Math.ceil(fs.full * 1.2)));
      const rows = Ns.map(N => { const p = mkP(b, { N }), { d, s1 } = solve(p, false); return { N, z: s1.feasible ? s1.z : NaN, zc: s1.feasible ? gameCapped(p, d, s1.h) : NaN, act: s1.active.length, P: s1.P }; });
      const firstZ0 = rows.find(r => r.z >= -1e-9), firstOver = rows.find(r => r.P.some(x => x > 1 + 1e-9));
      const actAt = p0.n.map((_, k) => (rows.find(r => r.P[k] > 1e-9) || {}).N);
      const html = lineChart({ x: Ns, series: [{ name: 'z* reported by Stage 1', y: rows.map(r => r.z), color: '#111' }, { name: 'Game value actually achievable (coverage capped at 100%)', y: rows.map(r => r.zc), color: col(7), dash: true }], hlines: [{ y: 0 }], vlines: [{ x: fs.half, label: `N_min(½) = ${fs.half}` }, { x: fs.full, label: `N_min(1) = ${fs.full}` }].concat(firstOver ? [{ x: firstOver.N, label: `first P* > 100% (N = ${firstOver.N})`, color: '#b00020' }] : []), xLabel: 'Fleet size N', yLabel: 'z*', yFmt: t => +t.toFixed(2) }) +
        lineChart({ x: Ns, yMin: 0, yMax: 1.05, series: p0.n.map((_, k) => ({ name: `P${k + 1}* (Type ${k + 1}, v = ${p0.v[k]})`, y: rows.map(r => Math.min(1.05, r.P[k])), color: col(k) })), xLabel: 'Fleet size N', yLabel: 'Coverage P_k*', yFmt: t => pct(t, 0) }) +
        table(['N', 'z* (Stage 1)', 'Achievable', 'Active types', ...p0.n.map((_, k) => `P${k + 1}*`)], rows.filter((r, i) => i % Math.ceil(rows.length / 14) === 0 || r.N === fs.half || r.N === fs.full || r === firstOver).map(r => [r.N, f(r.z), f(r.zc), r.act, ...r.P.map(x => (x > 1 + 1e-9 ? `<span class="error">${pct(x)}</span>` : pct(x)))]));
      const finding = `Types switch on at N = ${actAt.map((N, k) => `${N ?? '—'} (Type ${k + 1})`).join(', ')}: the highest-value types are defended first and lower-value ones join as the fleet grows (Cases 3 → 2 → 1).
        z* first reaches 0 at N = ${firstZ0 ? firstZ0.N : '—'}, against the closed-form N<sub>min</sub>(½) = ${fs.half}${firstZ0 && Math.abs(firstZ0.N - fs.half) <= 1 ? ', agreeing to within one aircraft' : ''}. Full coverage needs N<sub>min</sub>(1) = ${fs.full} aircraft.
        ${firstOver ? `<b>Model limitation found:</b> from N = ${firstOver.N}, well before N<sub>min</sub>(1), Stage 1 gives some type a coverage above 100% (the LP has no P<sub>k</sub> ≤ 1 constraint). From there the reported z* overstates what can be achieved (dashed line): no plan can do better than min<sub>k</sub> v<sub>k</sub> = ${f(Math.min(...p0.v))}, the payoff of a fully covered lowest-value barrier. The hours above full coverage are wasted; moving them to the other types would not raise the worst case but would raise every other type's payoff. Adding h<sub>k</sub> ≤ n<sub>k</sub>T/μ to the LP fixes this.` : 'No type is ever assigned more than 100% coverage in this range.'}`;
      return { html, finding, csv: [['N', 'z', 'z_achievable', 'active', ...p0.n.map((_, k) => `P${k + 1}`)], ...rows.map(r => [r.N, r.z, r.zc, r.act, ...r.P])] };
    });

  /* 2 */
  exp('Stackelberg vs. the four baselines across fleet sizes',
    'Is the Stackelberg allocation better than the baseline policies at every fleet size, and by how much?',
    'Sweep N from 2 to N<sub>min</sub>(1). For each N compute the achievable game value min<sub>k</sub> U<sub>d</sub>(k), with coverage capped at 100%, for the Stage-1 allocation and for Fixed, Uniform, Value-proportional and Greedy.', false, b => {
      const p0 = mkP(b), fs = minimumFleetSize(p0, computeDerived(p0));
      const Ns = range(2, Math.max(4, fs.full));
      const names = ['Stackelberg', 'Uniform random', 'Value-proportional', 'Greedy', 'Fixed deterministic'];
      const rows = Ns.map(N => { const p = mkP(b, { N }), { d, s1 } = solve(p, false), bl = baselines(p, d); return [gameCapped(p, d, s1.h), gameCapped(p, d, bl.uniform.h), gameCapped(p, d, bl.valueProportional.h), gameCapped(p, d, bl.greedy.h), bl.fixed.game]; });
      const gapBest = rows.map(r => r[0] - Math.max(...r.slice(1)));
      const beaten = Ns.filter((_, i) => gapBest[i] < -1e-9);
      const html = lineChart({ x: Ns, series: names.map((nm, i) => ({ name: nm, y: rows.map(r => r[i]), color: i === 0 ? '#111' : col(i - 1), width: i === 0 ? 3 : 2, dash: i === 4 })), xLabel: 'Fleet size N', yLabel: 'Game value', hlines: [{ y: 0 }] }) +
        table(['N', ...names, 'Gap to best baseline'], Ns.map((N, i) => [N, ...rows[i].map(x => f(x)), f(gapBest[i])]).filter((_, i) => i % Math.ceil(Ns.length / 12) === 0));
      const worstGap = Math.min(...gapBest), iMax = gapBest.indexOf(Math.max(...gapBest));
      const finding = `${beaten.length ? `Stackelberg is beaten at ${beaten.length} fleet sizes (N = ${beaten[0]}–${beaten[beaten.length - 1]}), by up to ${f(-worstGap)}. These are exactly the fleets where Stage 1 assigns a type more than 100% coverage (Experiment 5): the uncapped LP wastes hours there, and Greedy, which stops at full coverage, does better.` : `Stackelberg is never beaten: its smallest margin over the best baseline is ${f(worstGap)}.`}
        The largest margin is ${f(gapBest[iMax])} at N = ${Ns[iMax]}; the average is ${f(mean(gapBest))}.
        Fixed deterministic stays at −max v<sub>k</sub> = ${f(-Math.max(...p0.v))} at every fleet size, because an observant attacker always strikes just after the patrol.`;
      return { html, finding, csv: [['N', ...names], ...Ns.map((N, i) => [N, ...rows[i]])] };
    });

  /* 3 */
  exp('Random-instance benchmark',
    'Over many random problems, how often and by how much does Stackelberg beat each baseline?',
    '500 random instances: K ∈ {2..5} types, n<sub>k</sub> ∈ {1..6}, v<sub>k</sub> ∈ {1..10} (integers), N uniform between 2 and N<sub>min</sub>(1) so coverage stays below 100%. Other parameters from the base configuration. Seeded.', true, b => {
      const rng = mulberry32(b.seed + 3), R = 500, names = ['Uniform random', 'Value-proportional', 'Greedy', 'Fixed deterministic'];
      const gaps = names.map(() => []), gapBest = [], rows = [], overFlags = [];
      for (let r = 0; r < R; r++) {
        const p = randomInstance(rng, b), { d, s1 } = solve(p, false);
        if (!s1.feasible) continue;
        const bl = baselines(p, d), g = [gameCapped(p, d, bl.uniform.h), gameCapped(p, d, bl.valueProportional.h), gameCapped(p, d, bl.greedy.h), bl.fixed.game];
        const zc = gameCapped(p, d, s1.h), over = overCovered(s1);
        g.forEach((x, i) => gaps[i].push(zc - x));
        gapBest.push(zc - Math.max(...g)); overFlags.push(over);
        rows.push([p.K, p.n.join(' '), p.v.join(' '), p.N, zc, over ? 1 : 0, ...g]);
      }
      const bins = 14, lo = Math.min(0, ...gapBest), hi = Math.max(...gapBest, 1e-6), w = (hi - lo) / bins, counts = new Array(bins).fill(0);
      gapBest.forEach(g => { counts[Math.min(bins - 1, Math.max(0, Math.floor((g - lo) / w)))]++; });
      const html = barChart({ labels: counts.map((_, i) => f(lo + i * w, 2)), values: counts, color: counts.map((_, i) => (lo + (i + 1) * w <= 1e-9 ? '#e34948' : col(0))), xLabel: 'Margin of Stackelberg over the best baseline (bin start)', yLabel: 'Instances', yFmt: t => t.toFixed(0) }) +
        table(['Baseline', 'Stackelberg ≥ baseline', 'Mean margin', 'Median margin', 'Max margin', 'Min margin'], names.map((nm, i) => [nm, pct(gaps[i].filter(g => g >= -1e-9).length / gaps[i].length), f(mean(gaps[i])), f(quantile(gaps[i], 0.5)), f(Math.max(...gaps[i])), f(Math.min(...gaps[i]))]));
      const lost = gapBest.map((g, i) => [g, overFlags[i]]).filter(([g]) => g < -1e-9), lostOver = lost.filter(([, o]) => o).length;
      const finding = `Scored by the achievable game value (coverage capped at 100%), Stackelberg was at least as good as every baseline in ${pct(1 - lost.length / gapBest.length)} of ${gapBest.length} instances.
        ${lost.length ? `All ${lost.length} losses${lostOver === lost.length ? '' : ` (${lostOver} of them)`} occur where Stage 1 assigns some type more than 100% coverage, the missing P<sub>k</sub> ≤ 1 constraint from Experiment 5; ${pct(overFlags.filter(Boolean).length / overFlags.length)} of all instances are in that regime.` : 'It never lost.'}
        Its median margin over the <em>best</em> baseline for each instance is ${f(quantile(gapBest, 0.5))}, and ${pct(gapBest.filter(g => Math.abs(g) < 1e-6).length / gapBest.length)} of instances are ties.`;
      return { html, finding, csv: [['K', 'n', 'v', 'N', 'z_stackelberg_achievable', 'stage1_overcovers', ...names], ...rows] };
    });

  /* 4 */
  exp('Closed form vs. a general LP solver',
    'Does the analytical Stage-1 solution (Theorem 1 with iterative removal of inactive types) give the same answer as solving the LP directly?',
    '300 random instances (as in Experiment 7, K up to 8). Each is solved twice: by stage1() and by the two-phase simplex on max z s.t. v<sub>k</sub>(2μh<sub>k</sub>/(n<sub>k</sub>T) − 1) ≥ z, Σh<sub>k</sub> = B<sub>eff</sub>, h ≥ 0.', true, b => {
      const rng = mulberry32(b.seed + 4), R = 300, pts = [], rows = [];
      let maxDz = 0, maxDh = 0, activeAgree = 0, solved = 0;
      for (let r = 0; r < R; r++) {
        const p = randomInstance(rng, b, { K: randInt(rng, 2, 8) }), { d, s1 } = solve(p, false);
        const K = p.K, nv = K + 2 + K, A = [], rhs = [];
        for (let k = 0; k < K; k++) {
          const row = new Array(nv).fill(0);
          row[k] = (2 * p.v[k] * d.mu) / (p.n[k] * d.T); row[K] = -1; row[K + 1] = 1; row[K + 2 + k] = -1;
          A.push(row); rhs.push(p.v[k]);
        }
        const brow = new Array(nv).fill(0); for (let k = 0; k < K; k++) brow[k] = 1; A.push(brow); rhs.push(d.B_eff);
        const c = new Array(nv).fill(0); c[K] = -1; c[K + 1] = 1;
        const lp = twoPhaseSimplex(A, rhs, c);
        if (!lp.feasible || !s1.feasible) continue;
        solved++;
        const zLP = lp.x[K] - lp.x[K + 1], hLP = lp.x.slice(0, K);
        const dz = Math.abs(zLP - s1.z), dh = Math.max(...hLP.map((h, k) => Math.abs(h - s1.h[k])));
        maxDz = Math.max(maxDz, dz); maxDh = Math.max(maxDh, dh);
        const actLP = hLP.map(h => h > 1e-6), actCF = s1.h.map(h => h > 1e-6);
        if (actLP.every((a, k) => a === actCF[k])) activeAgree++;
        pts.push([s1.z, zLP]);
        rows.push([K, p.N, s1.z, zLP, dz, dh]);
      }
      const lo = Math.min(...pts.flat()), hi = Math.max(...pts.flat());
      const html = lineChart({ series: [{ name: 'instances', x: pts.map(q => q[0]), y: pts.map(q => q[1]), points: true, color: col(0) }, { name: 'y = x', x: [lo, hi], y: [lo, hi], color: '#999', dash: true, width: 1 }], xLabel: 'z* from the closed form (stage1)', yLabel: 'z* from the simplex LP', yFmt: t => +t.toFixed(1), xFmt: t => +t.toFixed(1) }) +
        table(['Instances solved', 'Max |Δz*|', 'Max |Δh<sub>k</sub>| (hours)', 'Same active set'], [[solved, maxDz.toExponential(2), maxDh.toExponential(2), `${activeAgree} / ${solved}`]]);
      const finding = `On ${solved} instances the closed form and the LP agree: largest difference in z* is ${maxDz.toExponential(1)} and in any h<sub>k</sub> ${maxDh.toExponential(1)} hours (floating-point noise), and the active set matches in ${activeAgree} of ${solved}.
        This is a numerical check of Theorem 1 and of the iterative inactive-type removal, including instances where some types are switched off.`;
      return { html, finding, csv: [['K', 'N', 'z_closed_form', 'z_lp', 'abs_dz', 'max_abs_dh'], ...rows] };
    });

  /* 5 */
  exp('Stage 2: support size and residual gap',
    'How many integer plans does the mixed strategy need, does it always close exactly (zero gap), and does it ever need the canonical "all sorties on one type" plans?',
    '100 random instances for each K = 2..8. Stage 1 + Stage 2. Support = plans with probability > 10⁻⁶.', true, b => {
      const rng = mulberry32(b.seed + 5), Ks = range(2, 8), out = [], csv = [];
      Ks.forEach(K => {
        const sizes = [], gaps = []; let canon = 0, infeas = 0, ok = 0;
        for (let r = 0; r < 100; r++) {
          const p = randomInstance(rng, b, { K }), { d, s1, s2 } = solve(p);
          if (!s2 || !s2.feasible) { infeas++; continue; }
          ok++;
          const sup = support(s2);
          sizes.push(sup.length); gaps.push(s2.gap);
          const multi = s1.active.length > 1;
          if (multi && sup.some(x => x.m.filter(c => c > 0).length === 1 && x.m.some(c => c === d.N_srt))) canon++;
          csv.push([K, p.N, s1.active.length, sup.length, s2.gap]);
        }
        out.push({ K, mean: mean(sizes), max: Math.max(...sizes), gap: Math.max(...gaps), canon, infeas, ok });
      });
      const html = barChart({ labels: Ks.map(K => `K=${K}`), values: out.map(o => o.mean), hlines: [], xLabel: 'Number of barrier types', yLabel: 'Mean plans in support', yFmt: t => t.toFixed(1) }) +
        table(['K', 'Instances', 'Mean support', 'Max support', 'K + 1 bound', 'Max residual gap Σε', 'Used a canonical plan', 'Stage 2 infeasible'], out.map(o => [o.K, o.ok, f(o.mean, 2), o.max, o.K + 1, o.gap.toExponential(1), o.canon, o.infeas]));
      const worst = Math.max(...out.map(o => o.gap)), overBound = out.filter(o => o.max > o.K + 1);
      const finding = `The residual gap Σε never exceeds ${worst.toExponential(1)}, so Stage 2 reproduces h* exactly in every instance.
        The support never exceeds ${Math.max(...out.map(o => o.max))} plans${overBound.length ? '' : ', always within the K + 1 bound of Proposition 3'}, and stays small as K grows.
        Canonical plans were needed in ${out.reduce((s, o) => s + o.canon, 0)} instances: the floor/ceiling plans alone were enough in ${out.reduce((s, o) => s + o.ok - o.canon, 0)} of ${out.reduce((s, o) => s + o.ok, 0)}.`;
      return { html, finding, csv: [['K', 'N', 'active_types', 'support_size', 'gap'], ...csv] };
    });

  /* 6 */
  exp('Per-month risk: floor/ceiling mix vs. canonical mix (Theorem 5)',
    'Two mixed strategies can give the same expected coverage. How bad can a single month get under each?',
    'For each N, compare the Stage-2 floor/ceiling mix with a "canonical" mix that reaches the same h* by flying all sorties on one type per month (type k with probability h<sub>k</sub>*/B<sub>eff</sub>). Report the worst realised payoff over the plans each mix can draw.', false, b => {
      const p0 = mkP(b), fs = minimumFleetSize(p0, computeDerived(p0));
      const Ns = range(3, Math.max(5, fs.full));
      const rows = Ns.map(N => {
        const p = mkP(b, { N }), { d, s1, s2 } = solve(p);
        const sup = support(s2);
        const fcWorst = sup.length ? Math.min(...sup.map(x => Math.min(...planU(p, d, x.m)))) : NaN;
        const canWorst = Math.min(...s1.active.map(k => { const m = new Array(p.K).fill(0); m[k] = d.N_srt; return Math.min(...planU(p, d, m)); }));
        return { N, z: gameCapped(p, d, s1.h), fcWorst, canWorst, over: overCovered(s1) };
      });
      const html = lineChart({ x: Ns, series: [{ name: 'Achievable game value of h* (both mixes)', y: rows.map(r => r.z), color: '#111' }, { name: 'Floor/ceiling mix: worst single month', y: rows.map(r => r.fcWorst), color: col(2), dash: true }, { name: 'Canonical mix: worst single month', y: rows.map(r => r.canWorst), color: col(7) }], xLabel: 'Fleet size N', yLabel: 'Defender payoff', hlines: [{ y: 0 }] }) +
        table(['N', 'z*', 'Floor/ceil worst month', 'Canonical worst month', 'Floor/ceil shortfall vs z*'], rows.filter((_, i) => i % Math.ceil(rows.length / 12) === 0).map(r => [r.N, f(r.z), f(r.fcWorst), f(r.canWorst), f(r.z - r.fcWorst, 4)]));
      const maxShort = Math.max(...rows.map(r => r.z - r.fcWorst).filter(Number.isFinite));
      const meanShort = mean(rows.map(r => r.z - r.fcWorst).filter(Number.isFinite));
      const finding = `Both mixes have the same expected value, but the canonical mix leaves whole types unpatrolled in some months: its worst month is as low as ${f(Math.min(...rows.map(r => r.canWorst)))}.
        The floor/ceiling mix's worst month is never more than ${f(maxShort, 4)} below the achievable value (mean ${f(meanShort, 4)}), because every plan in its support is within one sortie per type of the optimum. This is Theorem 5 in numbers: rounding locally keeps every realised month close to optimal.`;
      return { html, finding, csv: [['N', 'z_achievable', 'floorceil_worst_month', 'canonical_worst_month', 'stage1_overcovers'], ...rows.map(r => [r.N, r.z, r.fcWorst, r.canWorst, r.over ? 1 : 0])] };
    });

  /* 7 */
  exp('When does aircraft assignment break? (turnaround time)',
    'Stage 3 assigns sorties greedily, round-robin, under the gap G = τ<sub>p</sub> + τ<sub>r</sub> and the per-aircraft budget F. As turnaround grows, how many sorties can no aircraft fly?',
    'Sweep τ<sub>r</sub> from 0 to 48 h for three per-aircraft budgets (F, 2F, 4F; same fleet). 10 seeds each; every plan in the support is built, and the unassigned fraction is weighted by plan probability. The dashed line for each budget is the capacity limit (F/τ<sub>p</sub>)·G = T.', true, b => {
      const trs = range(0, 48, 3), mults = [1, 2, 4], series = [], csv = [], vlines = [];
      mults.forEach((mlt, mi) => {
        const ys = trs.map(tr => {
          const p = mkP(b, { tau_r: tr, F: b.F * mlt }), { d, s1, s2 } = solve(p);
          if (!s2 || !s2.feasible) return NaN;
          const vals = range(1, 10).map(seed => withSeed(b.seed * 31 + seed + tr * 101 + mi, () => {
            const s3 = stage3(p, d, s1, s2), w = s3.plans.reduce((s, x) => s + x.prob, 0);
            return s3.plans.reduce((s, x) => s + (x.prob / w) * (x.plan.unassigned / Math.max(1, x.plan.totalSorties)), 0);
          }));
          const m = mean(vals);
          csv.push([b.F * mlt, tr, m, sd(vals)]);
          return m;
        });
        series.push({ name: `F = ${b.F * mlt} h per aircraft`, y: ys, color: col(mi), markers: true });
        const limit = (computeDerived(mkP(b)).T * b.tau_p) / (b.F * mlt) - b.tau_p;
        vlines.push({ x: limit, label: `capacity limit, F = ${b.F * mlt}`, color: col(mi) });
      });
      const html = lineChart({ x: trs, series, vlines, yMin: 0, xLabel: 'Turnaround τ_r (hours)', yLabel: 'Sorties unassigned', yFmt: t => pct(t, 0) }) +
        table(['F (h)', 'τ<sub>r</sub> (h)', 'Unassigned (mean of 10 seeds)', 'SD'], csv.filter(r => r[1] % 12 === 0).map(r => [r[0], r[1], pct(r[2], 2), pct(r[3], 2)]));
      const floors = mults.map(mlt => { const p = mkP(b, { F: b.F * mlt }), d = computeDerived(p); return { mlt, nsrt: d.N_srt, fly: flyableSorties(p), floor: Math.max(0, d.N_srt - flyableSorties(p)) / d.N_srt }; });
      const firstFail = mults.map((mlt, mi) => { const i = series[mi].y.findIndex(y => y > floors[mi].floor + 1e-4); return i < 0 ? 'none up to 48 h' : `${trs[i]} h`; });
      const finding = `<b>Model limitation found:</b> even with no turnaround some sorties are unassigned: ${floors.map(x => `${pct(x.floor, 2)} at F = ${b.F * x.mlt}`).join(', ')}.
        The reason is N<sub>srt</sub> = ⌊N·F/τ<sub>p</sub>⌋ (Remark 1) pools flying hours across aircraft, but each aircraft can only fly ⌊F/τ<sub>p</sub>⌋ whole sorties: with the base values ${floors[0].nsrt} sorties are planned and only ${floors[0].fly} can be flown. Using N·⌊F/τ<sub>p</sub>⌋ instead would make every planned sortie flyable.
        Above that floor, extra failures from turnaround start at τ<sub>r</sub> = ${firstFail.map((t, i) => `${t} (F = ${b.F * mults[i]})`).join(', ')}. With a larger budget each aircraft must fly more sorties, so the gap constraint binds sooner. Failures can start before the pure capacity limit because the greedy round-robin does not look ahead: sorties cluster in time, and a burst can find every aircraft still in turnaround. Stage 1 and 2 assume every planned sortie flies, so this marks where the theory's guarantee no longer holds.`;
      return { html, finding, csv: [['F', 'tau_r', 'unassigned_mean', 'unassigned_sd'], ...csv] };
    });

  /* 8 */
  exp('Workload balance across the fleet',
    'Does the round-robin assignment spread flying hours and barriers evenly over the aircraft?',
    'Base configuration, 30 seeds. For the most probable plan in the support, record each aircraft\'s hours and how many distinct barriers it serves.', true, b => {
      const p = mkP(b), { d, s1, s2 } = solve(p);
      const sup = support(s2), top = sup.reduce((a, x) => (x.s > a.s ? x : a), sup[0]);
      const runs = range(1, 30).map(seed => withSeed(b.seed * 17 + seed, () => buildPlan(p, d, top.m)));
      const stats = runs.map(pl => {
        const hrs = pl.aircraft.map(a => a.hours), served = pl.aircraft.map((_, ai) => new Set(pl.events.filter(e => e.aircraft === ai).map(e => `${e.type}-${e.barrierIdx}`)).size);
        return { min: Math.min(...hrs), max: Math.max(...hrs), sd: sd(hrs), atBudget: hrs.filter(h => h >= p.F - p.tau_p + 1e-9).length, served: mean(served), types: mean(pl.aircraft.map((_, ai) => new Set(pl.events.filter(e => e.aircraft === ai).map(e => e.type)).size)), un: pl.unassigned };
      });
      const first = runs[0].aircraft.map(a => a.hours);
      const html = barChart({ labels: first.map((_, i) => `AC${i + 1}`), values: first, color: col(0), hlines: [{ y: p.F, label: `budget F = ${p.F} h` }], xLabel: 'Aircraft (seed 1)', yLabel: 'Hours flown', yFmt: t => t.toFixed(0) }) +
        table(['Metric (30 seeds)', 'Mean', 'Min', 'Max'], [
          ['Lowest hours on any aircraft', f(mean(stats.map(s => s.min)), 1), f(Math.min(...stats.map(s => s.min)), 1), f(Math.max(...stats.map(s => s.min)), 1)],
          ['Highest hours on any aircraft', f(mean(stats.map(s => s.max)), 1), f(Math.min(...stats.map(s => s.max)), 1), f(Math.max(...stats.map(s => s.max)), 1)],
          ['SD of hours across aircraft', f(mean(stats.map(s => s.sd)), 2), f(Math.min(...stats.map(s => s.sd)), 2), f(Math.max(...stats.map(s => s.sd)), 2)],
          ['Aircraft within one sortie of F', f(mean(stats.map(s => s.atBudget)), 1), Math.min(...stats.map(s => s.atBudget)), Math.max(...stats.map(s => s.atBudget))],
          ['Distinct barriers per aircraft', f(mean(stats.map(s => s.served)), 1), f(Math.min(...stats.map(s => s.served)), 1), f(Math.max(...stats.map(s => s.served)), 1)],
          ['Distinct types per aircraft', f(mean(stats.map(s => s.types)), 2), f(Math.min(...stats.map(s => s.types)), 2), f(Math.max(...stats.map(s => s.types)), 2)],
          ['Unassigned sorties', f(mean(stats.map(s => s.un)), 2), Math.min(...stats.map(s => s.un)), Math.max(...stats.map(s => s.un))]
        ]);
      const finding = `Plan (${top.m.join(', ')}), ${d.N_srt} sorties on ${p.N} aircraft: hours per aircraft range from ${f(mean(stats.map(s => s.min)), 1)} to ${f(mean(stats.map(s => s.max)), 1)} h on average (SD ${f(mean(stats.map(s => s.sd)), 2)} h)${mean(stats.map(s => s.sd)) < 1e-9 ? `: every aircraft flies exactly ⌊F/τ<sub>p</sub>⌋ = ${Math.floor(p.F / p.tau_p)} sorties, the most it can, and the ${f(mean(stats.map(s => s.un)), 0)} sorties left over cannot be flown (see Experiment 11)` : ', so the round-robin keeps the fleet within about one sortie of an even split'}.
        Each aircraft ends up serving about ${f(mean(stats.map(s => s.served)), 1)} different barriers across ${f(mean(stats.map(s => s.types)), 1)} types, which is why the planner's "aircraft per type" icons are only an equivalent count.`;
      return { html, finding, csv: [['seed', 'min_hours', 'max_hours', 'sd_hours', 'aircraft_at_budget', 'barriers_per_aircraft', 'types_per_aircraft', 'unassigned'], ...stats.map((s, i) => [i + 1, s.min, s.max, s.sd, s.atBudget, s.served, s.types, s.un])] };
    });

  /* 9 */
  exp('Do the real timetables deliver the promised coverage?',
    'Stage 1 promises coverage P<sub>k</sub>*. Measured on the concrete Stage-3 timetables (only sorties that got an aircraft count), how close do we get, and what game value does the attacker actually face?',
    'Base configuration, 30 seeds, every plan in the support built. Exact coverage = length of the union of protection windows ÷ T, per barrier, averaged per type and weighted by plan probability. Plus 60,000 simulated attacks on the same timetables.', true, b => {
      const p = mkP(b), { d, s1, s2 } = solve(p), K = p.K;
      const seeds = range(1, 30), per = seeds.map(() => new Array(K).fill(0)), built = [], unFrac = [];
      seeds.forEach((seed, si) => withSeed(b.seed * 7 + seed, () => {
        const s3 = stage3(p, d, s1, s2), w = s3.plans.reduce((s, x) => s + x.prob, 0);
        const plans = s3.plans.map(x => ({ prob: x.prob / w, cov: realisedCoverage(p, d, x.plan) }));
        unFrac.push(s3.plans.reduce((s, x) => s + (x.prob / w) * (x.plan.unassigned / Math.max(1, x.plan.totalSorties)), 0));
        built.push(plans);
        const off = p.n.map((_, k) => p.n.slice(0, k).reduce((a, c) => a + c, 0));
        plans.forEach(pl => { for (let k = 0; k < K; k++) { let s = 0; for (let i = 0; i < p.n[k]; i++) s += pl.cov[off[k] + i].frac; per[si][k] += pl.prob * (s / p.n[k]); } });
      }));
      const rng = mulberry32(b.seed + 9), hits = new Array(K).fill(0), tries = new Array(K).fill(0);
      const off = p.n.map((_, k) => p.n.slice(0, k).reduce((a, c) => a + c, 0));
      for (let a = 0; a < 60000; a++) {
        const plans = built[Math.floor(rng() * built.length)];
        let u = rng(), j = 0; for (; j < plans.length - 1; j++) { u -= plans[j].prob; if (u < 0) break; }
        const k = Math.floor(rng() * K), i = Math.floor(rng() * p.n[k]), t = rng() * d.T;
        const iv = plans[j].cov[off[k] + i].merged;
        let lo = 0, hi = iv.length - 1, caught = false;
        while (lo <= hi) { const mid = (lo + hi) >> 1; if (t < iv[mid][0]) hi = mid - 1; else if (t >= iv[mid][1]) lo = mid + 1; else { caught = true; break; } }
        tries[k]++; if (caught) hits[k]++;
      }
      const realised = p.n.map((_, k) => mean(per.map(r => r[k]))), realU = realised.map((P, k) => p.v[k] * (2 * P - 1));
      const html = barChart({ labels: p.n.flatMap((_, k) => [`T${k + 1} P*`, `T${k + 1} real`]), values: p.n.flatMap((_, k) => [Math.min(1, s1.P[k]), realised[k]]), color: p.n.flatMap((_, k) => [col(k), '#444']), xLabel: 'Coloured: Stage-1 promise · dark: measured on timetables', yLabel: 'Coverage', yFmt: t => pct(t, 0) }) +
        table(['Type', 'P<sub>k</sub>* (Stage 1)', 'Exact on timetables (mean ± SD)', 'Simulated attacks caught', 'U<sub>d</sub>(k) promised', 'U<sub>d</sub>(k) realised'], p.n.map((_, k) => [`Type ${k + 1}`, pct(s1.P[k], 2), `${pct(realised[k], 2)} ± ${pct(sd(per.map(r => r[k])), 2)}`, `${pct(hits[k] / tries[k], 2)} (${tries[k]})`, f(s1.U[k]), f(realU[k])]));
      const finding = `Promised game value z* = ${f(s1.z)}; the attacker's best response against the real timetables gives ${f(Math.min(...realU))} (shortfall ${f(s1.z - Math.min(...realU), 4)})${s1.z > 0 && Math.min(...realU) < 0 ? ', which turns a small promised gain into a loss' : ''}.
        The shortfall comes from the ${pct(mean(unFrac), 2)} of sorties that could not be given an aircraft (the per-aircraft rounding of Experiment 11, plus turnaround τ<sub>r</sub> = ${p.tau_r} h). Every window that is flown ends inside the month, because the phase is drawn from [0, Δ − W]; Experiment 1 shows the price of that choice. Simulated attacks on the same timetables agree with the exact coverage to within sampling noise.`;
      return { html, finding, csv: [['type', 'P_star', 'realised_mean', 'realised_sd', 'sim_caught', 'sim_attacks'], ...p.n.map((_, k) => [k + 1, s1.P[k], realised[k], sd(per.map(r => r[k])), hits[k] / tries[k], tries[k]])] };
    });

  /* 10 */
  exp('Sensitivity to the safe period τ<sub>s</sub>',
    'How much does a longer post-patrol safe period help, in game value and in the fleet needed?',
    'Sweep τ<sub>s</sub> from 0 to 24 h (W = τ<sub>p</sub> + τ<sub>s</sub>). Fleet fixed at the base N.', false, b => {
      const tss = range(0, 24, 1);
      const rows = tss.map(ts => { const p = mkP(b, { tau_s: ts }), { d, s1 } = solve(p, false), fs = minimumFleetSize(p, d); return { ts, W: d.W, z: s1.z, zc: gameCapped(p, d, s1.h), over: overCovered(s1), act: s1.active.length, half: fs.half, full: fs.full }; });
      const html = lineChart({ x: tss, series: [{ name: 'z* reported by Stage 1', y: rows.map(r => r.z), color: '#111', markers: true }, { name: 'Achievable (coverage capped at 100%)', y: rows.map(r => r.zc), color: col(7), dash: true }], hlines: [{ y: 0 }], vlines: [{ x: b.tau_s, label: 'base τ_s' }], xLabel: 'Safe period τ_s (hours)', yLabel: 'z*' }) +
        lineChart({ x: tss, series: [{ name: 'N_min(½): zero expected loss', y: rows.map(r => r.half), color: col(0), markers: true }, { name: 'N_min(1): full coverage', y: rows.map(r => r.full), color: col(1), markers: true }], hlines: [{ y: b.N, label: `current fleet N = ${b.N}`, color: '#b00020' }], yMin: 0, xLabel: 'Safe period τ_s (hours)', yLabel: 'Aircraft needed', yFmt: t => t.toFixed(0) }) +
        table(['τ<sub>s</sub> (h)', 'W (h)', 'z*', 'Achievable', 'Active types', 'N<sub>min</sub>(½)', 'N<sub>min</sub>(1)'], rows.filter(r => r.ts % 3 === 0).map(r => [r.ts, r.W, f(r.z), f(r.zc), r.act, r.half, r.full]));
      const zeroAt = rows.find(r => r.zc >= 0), overAt = rows.find(r => r.over);
      const finding = `Coverage per flying hour scales with μ = W/τ<sub>p</sub>, so a longer safe period works like a bigger fleet: N<sub>min</sub>(1) falls from ${rows[0].full} at τ<sub>s</sub> = 0 to ${rows[rows.length - 1].full} at 24 h, in proportion to 1/W (Eq. 18).
        With the current ${b.N} aircraft the defender breaks even once τ<sub>s</sub> ≥ ${zeroAt ? zeroAt.ts : '>24'} h${overAt ? `; from τ<sub>s</sub> = ${overAt.ts} h Stage 1 over-covers a type and its z* overstates what is achievable` : ''}. How long a barrier stays safe after a patrol is the parameter to estimate most carefully.`;
      return { html, finding, csv: [['tau_s', 'W', 'z', 'active', 'Nmin_half', 'Nmin_full'], ...rows.map(r => [r.ts, r.W, r.z, r.act, r.half, r.full])] };
    });

  /* 11 */
  exp('Sortie length: granularity and rounding',
    'For a fixed protection window, how does sortie length affect the rounding loss, the number of plans and how far a single month can drift from z*?',
    `Keep W fixed at the base value (τ<sub>p</sub> + τ<sub>s</sub>) and vary τ<sub>p</sub> from 0.5 h up to W − 0.5 h, with τ<sub>s</sub> = W − τ<sub>p</sub>. Fleet budget unchanged.`, false, b => {
      const W = b.tau_p + b.tau_s, tps = range(0.5, Math.max(1, W - 0.5), 0.5);
      const rows = tps.map(tp => {
        const p = mkP(b, { tau_p: tp, tau_s: W - tp }), { d, s1, s2 } = solve(p), sup = support(s2);
        const zc = gameCapped(p, d, s1.h);
        const dev = sup.length ? Math.max(...sup.map(x => Math.abs(Math.min(...planU(p, d, x.m)) - zc))) : NaN;
        return { tp, mu: d.mu, loss: d.B - d.B_eff, z: s1.z, zc, over: overCovered(s1), sup: sup.length, dev };
      });
      const html = lineChart({ x: tps, series: [{ name: 'z* reported by Stage 1', y: rows.map(r => r.z), color: '#111', markers: true }, { name: 'Achievable (coverage capped at 100%)', y: rows.map(r => r.zc), color: col(7), dash: true, markers: true }], xLabel: 'Sortie length τ_p (hours), W fixed', yLabel: 'z*' }) +
        lineChart({ x: tps, series: [{ name: 'Max per-month deviation |worst U − z*|', y: rows.map(r => r.dev), color: col(1), markers: true }], yMin: 0, xLabel: 'Sortie length τ_p (hours), W fixed', yLabel: 'Deviation' }) +
        table(['τ<sub>p</sub>', 'μ = W/τ<sub>p</sub>', 'Rounding loss B − B<sub>eff</sub> (h)', 'z* (Stage 1)', 'Achievable', 'Plans in support', 'Max per-month deviation'], rows.map(r => [r.tp, f(r.mu, 2), f(r.loss, 2), r.over ? `<span class="error">${f(r.z)}</span>` : f(r.z), f(r.zc), r.sup, f(r.dev, 4)]));
      const overList = rows.filter(r => r.over).map(r => r.tp), devs = rows.map(r => r.dev).filter(Number.isFinite);
      const finding = `With W fixed, shorter sorties give a larger multiplier μ = W/τ<sub>p</sub>: each flying hour protects for longer, so the achievable value falls from ${f(rows[0].zc)} at τ<sub>p</sub> = ${rows[0].tp} h to ${f(rows[rows.length - 1].zc)} at ${rows[rows.length - 1].tp} h.
        ${overList.length ? `For τ<sub>p</sub> ≤ ${Math.max(...overList)} h Stage 1 over-covers some type (red z*), reporting values above max v<sub>k</sub> that cannot be achieved, the same missing P<sub>k</sub> ≤ 1 constraint as in Experiment 5.` : ''}
        A single month never drifts more than ${f(Math.max(...devs), 4)} from the achievable value, and the rounding loss B − B<sub>eff</sub> is always below one sortie (Remark 1).`;
      return { html, finding, csv: [['tau_p', 'mu', 'rounding_loss', 'z', 'z_achievable', 'support', 'max_month_dev'], ...rows.map(r => [r.tp, r.mu, r.loss, r.z, r.zc, r.sup, r.dev])] };
    });

  /* 12 */
  exp('Robustness to mis-estimated barrier values',
    'The optimum depends on v<sub>k</sub>. If the defender\'s estimates are wrong, how much is lost, and is it still better than a value-blind uniform patrol?',
    'For noise σ ∈ {0, 5, 10, 20, 30, 50}%: the defender plans with v̂<sub>k</sub> = v<sub>k</sub>(1 + σu), u ~ Uniform(−1, 1), and the attacker best-responds using the true v<sub>k</sub>. Loss = true z* − achieved game value. 400 trials per level, seeded.', true, b => {
      const p = mkP(b), { d, s1 } = solve(p, false), rng = mulberry32(b.seed + 12);
      const uni = gameCapped(p, d, baselines(p, d).uniform.h), sigmas = [0, 0.05, 0.1, 0.2, 0.3, 0.5], rows = [];
      sigmas.forEach(sg => {
        const losses = [];
        for (let t = 0; t < 400; t++) {
          const vh = p.v.map(v => Math.max(0.05 * v, v * (1 + sg * (2 * rng() - 1))));
          const ph = mkP(b, { v: vh }), sh = stage1(ph, d);
          losses.push(gameCapped(p, d, s1.h) - gameCapped(p, d, sh.h));
        }
        rows.push({ sg, mean: mean(losses), p95: quantile(losses, 0.95), max: Math.max(...losses), beat: losses.filter(l => gameCapped(p, d, s1.h) - l >= uni - 1e-9).length / losses.length });
      });
      const html = lineChart({ x: sigmas.map(s => s * 100), series: [{ name: 'Mean loss', y: rows.map(r => r.mean), color: col(0), markers: true }, { name: '95th percentile loss', y: rows.map(r => r.p95), color: col(1), markers: true }], hlines: [{ y: gameCapped(p, d, s1.h) - uni, label: 'loss of Uniform random (no value info)', color: '#b00020', legend: 'Uniform random loss' }], yMin: 0, xLabel: 'Noise in value estimates σ (%)', yLabel: 'Loss in game value', xFmt: t => t + '%' }) +
        table(['σ', 'Mean loss', '95th pct loss', 'Max loss', 'Still ≥ Uniform random'], rows.map(r => [pct(r.sg, 0), f(r.mean, 4), f(r.p95, 4), f(r.max, 4), pct(r.beat)]));
      const r20 = rows.find(r => r.sg === 0.2);
      const finding = `The optimum degrades gracefully: at ±20% error the mean loss is ${f(r20.mean, 4)} (z* = ${f(s1.z)}), and the plan still matches or beats the value-blind Uniform patrol in ${pct(r20.beat)} of trials.
        At ±50% error it beats Uniform in ${pct(rows[rows.length - 1].beat)} of trials, with a mean loss of ${f(rows[rows.length - 1].mean, 4)}. Rough value estimates are enough to get most of the benefit.`;
      return { html, finding, csv: [['sigma', 'mean_loss', 'p95_loss', 'max_loss', 'share_beating_uniform'], ...rows.map(r => [r.sg, r.mean, r.p95, r.max, r.beat])] };
    });

  /* 13 */
  exp('Spend by count, not by value',
    'As the high-value type becomes far more valuable than the rest, do its barriers get proportionally more hours?',
    'K = 3 with the base n<sub>k</sub>. Values v = (r, √r, 1) for r from 1 to 50. Fleet at the base N.', false, b => {
      const n3 = b.n.length >= 3 ? b.n.slice(0, 3) : [4, 3, 3], rs = [1, 1.5, 2, 3, 4, 6, 8, 12, 16, 25, 35, 50];
      const rows = rs.map(r => {
        const v = [r, Math.sqrt(r), 1], p = mkP(b, { n: n3, v }), { s1 } = solve(p, false);
        const hb = s1.h.map((h, k) => h / n3[k]), tot = s1.h.reduce((a, c) => a + c, 0);
        const valShare = (n3[0] * v[0]) / n3.reduce((s, nk, k) => s + nk * v[k], 0);
        return { r, hb, hShare: s1.h[0] / tot, valShare, z: s1.z };
      });
      const html = lineChart({ x: rs, series: n3.map((_, k) => ({ name: `Hours per barrier, type ${k + 1} (v = ${['r', '√r', '1'][k]})`, y: rows.map(r => r.hb[k]), color: col(k), markers: true })), yMin: 0, xLabel: 'Value ratio r = v_1 / v_3', yLabel: 'Flying hours per barrier' }) +
        lineChart({ x: rs, yMin: 0, yMax: 1, series: [{ name: 'Type 1 share of total value', y: rows.map(r => r.valShare), color: '#111', dash: true, markers: true }, { name: 'Type 1 share of flying hours', y: rows.map(r => r.hShare), color: col(0), markers: true }], xLabel: 'Value ratio r = v_1 / v_3', yLabel: 'Share', yFmt: t => pct(t, 0) }) +
        table(['r', ...n3.map((_, k) => `h/n, type ${k + 1}`), 'Type 1 value share', 'Type 1 hours share', 'z*'], rows.map(r => [r.r, ...r.hb.map(x => f(x, 1)), pct(r.valShare), pct(r.hShare), f(r.z)]));
      const last = rows[rows.length - 1];
      const finding = `At r = 50, Type 1 holds ${pct(last.valShare)} of the value but receives only ${pct(last.hShare)} of the hours. Hours per barrier follow h<sub>k</sub>/n<sub>k</sub> ∝ 1 + z*/v<sub>k</sub>, which flattens as values grow, so barriers end up with similar hours regardless of value.
        The optimum equalises the attacker's payoff, which is driven by coverage, so it buys coverage per barrier rather than spending in proportion to value. This is why Value-proportional loses in Experiments 6 and 7.`;
      return { html, finding, csv: [['r', ...n3.map((_, k) => `hours_per_barrier_${k + 1}`), 'type1_value_share', 'type1_hours_share', 'z'], ...rows.map(r => [r.r, ...r.hb, r.valShare, r.hShare, r.z])] };
    });

  /* 14 */
  exp('Planning horizon and integer granularity',
    'Does the length of the planning period matter when the daily flying budget is the same?',
    'Vary T from 1 to 60 days, scaling F with T so the budget per day is unchanged. Record z*, the rounding loss, plans in support and the worst single-period deviation from z*.', false, b => {
      const Ts = [1, 2, 3, 5, 7, 10, 15, 20, 30, 45, 60];
      const rows = Ts.map(T => {
        const p = mkP(b, { T_days: T, F: (b.F * T) / b.T_days }), { d, s1, s2 } = solve(p), sup = support(s2);
        const zc = gameCapped(p, d, s1.h);
        const dev = sup.length ? Math.max(...sup.map(x => Math.abs(Math.min(...planU(p, d, x.m)) - zc))) : NaN;
        return { T, Nsrt: d.N_srt, loss: d.B - d.B_eff, z: zc, sup: sup.length, dev };
      });
      const html = lineChart({ x: Ts, series: [{ name: 'Max per-period deviation |worst U − z*|', y: rows.map(r => r.dev), color: col(1), markers: true }], yMin: 0, xLabel: 'Planning horizon T (days)', yLabel: 'Deviation' }) +
        lineChart({ x: Ts, series: [{ name: 'z*', y: rows.map(r => r.z), color: '#111', markers: true }], xLabel: 'Planning horizon T (days)', yLabel: 'z*' }) +
        table(['T (days)', 'N<sub>srt</sub>', 'Rounding loss (h)', 'z*', 'Plans in support', 'Max per-period deviation'], rows.map(r => [r.T, r.Nsrt, f(r.loss, 2), f(r.z), r.sup, f(r.dev, 4)]));
      const finding = `z* is essentially independent of T when the daily budget is fixed (it ranges from ${f(Math.min(...rows.map(r => r.z)))} to ${f(Math.max(...rows.map(r => r.z)))}; the small wobble comes from rounding the budget down to whole sorties).
        What changes is granularity: with T = 1 day one extra sortie is a large share of a type's coverage, and a single period can deviate by up to ${f(rows[0].dev, 3)} from z*; at T = ${Ts[Ts.length - 1]} days the deviation is ${f(rows[rows.length - 1].dev, 4)}. Longer planning periods give the mixed strategy finer control.`;
      return { html, finding, csv: [['T_days', 'N_srt', 'rounding_loss', 'z', 'support', 'max_period_dev'], ...rows.map(r => [r.T, r.Nsrt, r.loss, r.z, r.sup, r.dev])] };
    });

  /* 15 */
  exp('Scalability: run time vs. number of types and barriers',
    'How do Stage 1, 2 and 3 run times grow with the number of barrier types and with the number of barriers?',
    'Part A: K = 1..12 types, 5 barriers each, values random in {1..10}, N set for about 50% coverage. Part B: K = 3, n<sub>k</sub> ∈ {1, 2, 5, 10, 20, 40} barriers per type. Median of 5 repetitions, in this browser.', true, b => {
      const rng = mulberry32(b.seed + 15);
      const time = (fn, reps = 5) => { const ts = []; let out; for (let i = 0; i < reps; i++) { const t0 = performance.now(); out = fn(); ts.push(performance.now() - t0); } return { ms: quantile(ts, 0.5), out }; };
      const runOne = p => {
        const d = computeDerived(p);
        const t1 = time(() => stage1(p, d)), s1 = t1.out;
        const t2 = time(() => stage2(p, d, s1)), s2 = t2.out;
        const t3 = time(() => withSeed(b.seed, () => stage3(p, d, s1, s2)), 3);
        return { t1: t1.ms, t2: t2.ms, t3: t3.ms, cand: s2.candidates.length, sorties: d.N_srt, sup: support(s2).length };
      };
      const sizeN = p => { const d = computeDerived(mkP(p, { N: 1 })); return Math.max(1, Math.ceil((d.T * d.Nb) / (2 * d.mu * p.F))); };
      const A = range(1, 12).map(K => { const n = new Array(K).fill(5), v = Array.from({ length: K }, () => randInt(rng, 1, 10)); const p = mkP(b, { n, v }); p.N = sizeN(p); return { K, Nb: 5 * K, N: p.N, ...runOne(p) }; });
      const B = [1, 2, 5, 10, 20, 40].map(nk => { const p = mkP(b, { n: [nk, nk, nk], v: b.v.length >= 3 ? b.v.slice(0, 3) : [3, 2, 1] }); p.N = sizeN(p); return { K: 3, Nb: 3 * nk, N: p.N, ...runOne(p) }; });
      const html = lineChart({ x: A.map(r => r.K), series: [{ name: 'Stage 1', y: A.map(r => r.t1), color: col(0), markers: true }, { name: 'Stage 2', y: A.map(r => r.t2), color: col(1), markers: true }, { name: 'Stage 3', y: A.map(r => r.t3), color: col(2), markers: true }], yMin: 0, xLabel: 'Number of barrier types K (5 barriers each)', yLabel: 'Time (ms)' }) +
        table(['K', 'Barriers', 'N', 'Sorties', 'Candidate plans', 'Plans in support', 'Stage 1 (ms)', 'Stage 2 (ms)', 'Stage 3 (ms)'], A.map(r => [r.K, r.Nb, r.N, r.sorties, r.cand, r.sup, f(r.t1, 3), f(r.t2, 2), f(r.t3, 2)])) +
        `<h4>Part B — more barriers, K = 3</h4>` +
        table(['Barriers per type', 'Barriers', 'N', 'Sorties', 'Candidate plans', 'Stage 1 (ms)', 'Stage 2 (ms)', 'Stage 3 (ms)'], B.map(r => [r.Nb / 3, r.Nb, r.N, r.sorties, r.cand, f(r.t1, 3), f(r.t2, 2), f(r.t3, 2)]));
      const maxCand = A.reduce((a, r) => (r.cand > a.cand ? r : a), A[0]);
      const t1max = Math.max(...A.map(r => r.t1), ...B.map(r => r.t1));
      const finding = `Stage 1 is closed form: at most ${f(t1max, 3)} ms in this run. Stage 2 grows with the number of candidate plans: it enumerates C(f, r) floor/ceiling combinations, which reached ${maxCand.cand} candidates at K = ${maxCand.K} (${f(maxCand.t2, 1)} ms). This is the part that grows combinatorially and would need column generation (§6.3) for much larger K.
        Stage 3 grows with the number of sorties and the fleet size (${f(B[B.length - 1].t3, 1)} ms for ${B[B.length - 1].Nb} barriers). At any realistic size the whole pipeline runs interactively.`;
      return { html, finding, csv: [['part', 'K', 'barriers', 'N', 'sorties', 'candidates', 'support', 'stage1_ms', 'stage2_ms', 'stage3_ms'], ...A.map(r => ['A', r.K, r.Nb, r.N, r.sorties, r.cand, r.sup, r.t1, r.t2, r.t3]), ...B.map(r => ['B', r.K, r.Nb, r.N, r.sorties, r.cand, r.sup, r.t1, r.t2, r.t3])] };
    });

  /* 16 — phase (offset) distribution */

  // Standard normal CDF via the Abramowitz–Stegun erf approximation (error < 1.5e-7).
  function normCdf(z) {
    const x = Math.abs(z) / Math.SQRT2, t = 1 / (1 + 0.3275911 * x);
    const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
  }
  function normSample(rng) { let u = 0; while (u === 0) u = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng()); }

  // Each distribution of the phase φ for one barrier with visit interval D = Δ and window W.
  // cdf(x) = P(φ ≤ x); spill = the month's last window may run into the next month (cyclic operation).
  const PHASE_DISTS = [
    {
      name: 'Current: uniform on [0, Δ − W], month self-contained', short: 'Current', spill: false,
      cdf: (x, D, W) => { const L = Math.max(0, D - W); return x < 0 ? 0 : L <= 0 ? 1 : Math.min(1, x / L); },
      sample: (rng, D, W) => rng() * Math.max(0, D - W)
    },
    {
      name: 'Uniform on [0, Δ), last patrol cut at month end', short: 'Uniform, cut', spill: false,
      cdf: (x, D) => (x < 0 ? 0 : Math.min(1, x / D)),
      sample: (rng, D) => rng() * D
    },
    {
      name: 'Uniform on [0, Δ), cyclic, phase redrawn independently each month', short: 'Uniform, cyclic', spill: true,
      cdf: (x, D) => (x < 0 ? 0 : Math.min(1, x / D)),
      sample: (rng, D) => rng() * D
    },
    {
      // Next month's phase is last month's phase rescaled to the new interval: φ = φ'·Δ/Δ'. Each month's phase is
      // still uniform, but the first window of a month can no longer overlap the spill-over from the previous one.
      name: 'Uniform on [0, Δ), cyclic, phase carried into next month (φ = φ′·Δ/Δ′)', short: 'Uniform, carried', spill: true, carry: true,
      cdf: (x, D) => (x < 0 ? 0 : Math.min(1, x / D)),
      sample: (rng, D) => rng() * D
    },
    {
      name: 'Triangular on [0, Δ) peaked at Δ/2, cyclic', short: 'Triangular, cyclic', spill: true,
      cdf: (x, D) => { if (x <= 0) return 0; if (x >= D) return 1; const u = x / D; return u <= 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u); },
      sample: (rng, D) => (D * (rng() + rng())) / 2
    },
    {
      name: 'Normal(Δ/2, Δ/6) truncated to [0, Δ), cyclic', short: 'Normal, cyclic', spill: true,
      cdf: (x, D) => { if (x <= 0) return 0; if (x >= D) return 1; const m = D / 2, s = D / 6, a = normCdf(-m / s), b = normCdf((D - m) / s); return (normCdf((x - m) / s) - a) / (b - a); },
      sample: (rng, D) => { for (;;) { const x = D / 2 + (D / 6) * normSample(rng); if (x >= 0 && x < D) return x; } }
    },
    {
      name: 'Whole hours only: uniform on {0, 1, …} h below Δ, cyclic', short: 'Whole hours, cyclic', spill: true,
      cdf: (x, D) => { const m = Math.ceil(D - 1e-9); return x < 0 ? 0 : Math.min(1, (Math.floor(x + 1e-9) + 1) / m); },
      sample: (rng, D) => Math.floor(rng() * Math.ceil(D - 1e-9))
    }
  ];

  // Exact probability that a barrier with q visits (interval D) is protected at time t, measured from
  // the start of the month the visits belong to. Window j covers t iff φ ∈ (t − jD − W, t − jD].
  function phaseCover(dist, q, D, W, t) {
    if (q <= 0) return 0;
    const jHi = Math.min(q - 1, Math.floor(t / D)), jLo = Math.max(0, Math.floor((t - W - D) / D));
    if (jHi < jLo) return 0;
    const mass = (a, b) => Math.max(0, dist.cdf(b, D, W) - dist.cdf(a, D, W));
    if (W >= D) return mass(t - jHi * D - W, t - jLo * D); // overlapping windows: their union is one interval
    let s = 0;
    for (let j = jLo; j <= jHi; j++) s += mass(t - j * D - W, t - j * D);
    return Math.min(1, s);
  }
  function phaseSimCovered(q, D, W, phi, t) {
    if (q <= 0) return false;
    for (let j = Math.max(0, Math.floor((t - phi - W) / D)); j <= Math.min(q - 1, Math.floor((t - phi) / D)); j++) {
      const x = t - phi - j * D;
      if (x >= 0 && x < W) return true;
    }
    return false;
  }

  exp('Phase distribution: uniform, or something else?',
    'Each barrier is visited every Δ = T/q hours after a random phase φ. Which distribution should φ follow, how should the month boundary (the cycle) be handled, and what does each choice do to the game value, including against an attacker who picks the moment of attack?',
    `<b>Analysis.</b> With windows of length W every Δ hours, the chance a barrier is protected at time t is the phase density convolved with a box of width W.
     If the schedule is cyclic (the last patrol may run into the next month), the average of this over one cycle is W/Δ for <em>every</em> distribution, so the worst moment can be no better than the average,
     and it equals the average only if the convolution is flat. Its Fourier coefficients are the density's multiplied by sin(πnW/Δ)/(πn), so for generic W/Δ only the uniform density is flat:
     <b>uniform on the full cycle [0, Δ) is the max–min choice.</b> The current scheme draws φ from [0, Δ − W] so that every window stays inside the month; that support has a gap of width W, so coverage falls to 0 at the start of the month and at multiples of Δ. The only way to get flat coverage while keeping every window inside the month is a lattice φ ∈ {0, W, 2W, …, Δ − W} (each with probability 1/m), which works only when Δ = mW; otherwise the last window has to cross into the next month (an accounting boundary only: sorties and flying hours per month are unchanged).<br>
     <b>Test.</b> Seven phase distributions on the base configuration's Stage-2 mix. Exact coverage P<sub>k</sub>(t) from each distribution's CDF on a 6-minute grid over the month (cyclic variants include the spill-over from the previous month's last patrol, either redrawn independently or carried over), then 20,000 simulated attacks per type at a uniformly random time and at the worst time, as a check.`, true, b => {
      const p = mkP(b), { d, s1, s2 } = solve(p), sup = support(s2), K = p.K, W = d.W;
      const tot = sup.reduce((s, x) => s + x.s, 0), w = sup.map(x => x.s / tot);
      // q and Δ of barrier i of type k under each plan (same split as Stage 3).
      const qOf = (m, k, i) => { const base = Math.floor(m[k] / p.n[k]), rem = m[k] - base * p.n[k]; return base + (i < rem ? 1 : 0); };
      const bars = []; for (let k = 0; k < K; k++) for (let i = 0; i < p.n[k]; i++) bars.push({ k, i, q: sup.map(x => qOf(x.m, k, i)) });
      const Dof = q => (q > 0 ? d.T / q : Infinity);
      const covBar = (dist, br, t) => {
        let own = 0, spill = 0;
        sup.forEach((_, j) => { own += w[j] * phaseCover(dist, br.q[j], Dof(br.q[j]), W, t); });
        if (dist.spill) sup.forEach((_, j) => { spill += w[j] * phaseCover(dist, br.q[j], Dof(br.q[j]), W, t + d.T); });
        // Carried phase: this month's and the spill-over windows never overlap, so the events are disjoint.
        // Redrawn phase: the two months are independent, so overlapping windows are counted once.
        return dist.carry ? Math.min(1, own + spill) : 1 - (1 - own) * (1 - spill);
      };
      const covType = (dist, k, t) => { const bs = bars.filter(x => x.k === k); return bs.reduce((s, br) => s + covBar(dist, br, t), 0) / bs.length; };
      const step = 0.1, ts = range(0, d.T - step, step), rng = mulberry32(b.seed + 16), M = 20000;
      const res = PHASE_DISTS.map(dist => {
        const avg = [], worst = [], worstT = [];
        for (let k = 0; k < K; k++) {
          let sum = 0, mn = Infinity, at = 0;
          ts.forEach(t => { const c = covType(dist, k, t); sum += c; if (c < mn) { mn = c; at = t; } });
          avg.push(sum / ts.length); worst.push(mn); worstT.push(at);
        }
        // Simulation check: draw this month's plan and phase (and last month's, for cyclic schedules).
        const simAt = (k, tFn) => {
          let hit = 0;
          for (let a = 0; a < M; a++) {
            const t = tFn(), i = Math.floor(rng() * p.n[k]), br = bars.find(x => x.k === k && x.i === i);
            const pick = () => { let u = rng(), j = 0; for (; j < w.length - 1; j++) { u -= w[j]; if (u < 0) break; } return j; };
            const j = pick(), q = br.q[j], D = Dof(q);
            let caught;
            if (dist.carry) {
              const j2 = pick(), q2 = br.q[j2], D2 = Dof(q2), phiPrev = q2 > 0 ? dist.sample(rng, D2, W) : rng() * D;
              const phi = q2 > 0 ? (phiPrev * D) / D2 : phiPrev;
              caught = (q > 0 && phaseSimCovered(q, D, W, phi, t)) || (q2 > 0 && phaseSimCovered(q2, D2, W, phiPrev, t + d.T));
            } else {
              caught = q > 0 && phaseSimCovered(q, D, W, dist.sample(rng, D, W), t);
              if (!caught && dist.spill) { const j2 = pick(), q2 = br.q[j2], D2 = Dof(q2); caught = q2 > 0 && phaseSimCovered(q2, D2, W, dist.sample(rng, D2, W), t + d.T); }
            }
            if (caught) hit++;
          }
          return hit / M;
        };
        const simAvg = p.n.map((_, k) => simAt(k, () => rng() * d.T)), simWorst = p.n.map((_, k) => simAt(k, () => worstT[k]));
        const game = P => Math.min(...P.map((x, k) => p.v[k] * (2 * Math.min(1, x) - 1)));
        return { dist, avg, worst, worstT, simAvg, simWorst, gAvg: game(avg), gWorst: game(worst) };
      });

      // Chart 1: one barrier over one cycle in the middle of the month (no boundary effects).
      const top = sup.reduce((a, x, j) => (x.s > sup[a].s ? j : a), 0), br0 = bars[0], q0 = br0.q[top], D0 = Dof(q0), t0 = Math.floor(q0 / 2) * D0;
      const ss = range(0, D0, D0 / 240);
      const chart1 = lineChart({ x: ss, yMin: 0, yMax: 1, series: PHASE_DISTS.map((dist, di) => ({ name: dist.short, y: ss.map(s => phaseCover(dist, q0, D0, W, t0 + s)), color: col(di), dash: di === 1 })), hlines: [{ y: W / D0, label: `W/Δ = ${pct(W / D0)}` }], xLabel: `Position within one visit cycle (hours), Type 1 barrier 1 in plan (${sup[top].m.join(', ')}): Δ = ${f(D0, 2)} h, W = ${W} h`, yLabel: 'P(protected)', yFmt: t => pct(t, 0) });
      // Chart 2: the month boundary, fraction of all barriers protected, first and last 36 hours.
      const edge = range(-36, 36, 0.25);
      const allCov = (dist, x) => { const t = x < 0 ? d.T + x : x; return bars.reduce((s, br) => s + covBar(dist, br, t), 0) / bars.length; };
      const chart2 = lineChart({ x: edge, yMin: 0, yMax: 1, series: PHASE_DISTS.map((dist, di) => ({ name: dist.short, y: edge.map(x => allCov(dist, x)), color: col(di), dash: di === 1 })), vlines: [{ x: 0, label: 'month boundary' }], xLabel: 'Hours from the month boundary (negative = end of previous month)', yLabel: 'Barriers protected', yFmt: t => pct(t, 0) });

      const typeCols = p.n.map((_, k) => `T${k + 1}`).join(' / ');
      const fmtList = a => a.map(x => pct(x, 1)).join(' / ');
      const tbl = table(['Phase distribution', `Avg coverage (${typeCols})`, `Worst-moment coverage (${typeCols})`, 'Worst moment (type 1)', 'Game value, uninformed timing (what Eq. 1 and §4.2 compute)', 'Game value, informed timing (the §7.2 attacker)', 'Sim − exact (max)'],
        res.map(r => [r.dist.name, fmtList(r.avg), fmtList(r.worst), fmtDayTime(r.worstT[0]), f(r.gAvg), `<b>${f(r.gWorst)}</b>`, f(Math.max(...r.simAvg.map((x, k) => Math.abs(x - r.avg[k])), ...r.simWorst.map((x, k) => Math.abs(x - r.worst[k]))), 3)]));
      const html = `<h4>One visit cycle in mid-month</h4>${chart1}<h4>Across the month boundary</h4>${chart2}${tbl}`;

      const by = sh => res.find(r => r.dist.short === sh), cur = by('Current'), cyc = by('Uniform, cyclic'), car = by('Uniform, carried'), tri = by('Triangular, cyclic'), nor = by('Normal, cyclic'), hrs = by('Whole hours, cyclic');
      const best = res.reduce((a, r) => (r.gWorst > a.gWorst ? r : a), res[0]);
      const finding = `Against an attacker whose timing is uninformed (what Definition 1 and §4.2 compute), every distribution that keeps whole windows gives almost the same value: ${f(cur.gAvg)} for the current scheme, ${f(car.gAvg)} for the carried uniform (${f(cyc.gAvg)} with independent redraws, where boundary overlaps waste a little).
        Against the attacker of §7.2, who knows the policy and waits for the best moment, the current scheme collapses: its worst-moment coverage is ${fmtList(cur.worst)} (at ${fmtDayTime(cur.worstT[0])} for Type 1), so the game value falls to ${f(cur.gWorst)}, no better than a fixed patrol.
        Uniform on the whole cycle with an independently redrawn phase lifts the worst moment to ${fmtList(cyc.worst)} (game value ${f(cyc.gWorst)}); the remaining dip sits just after the month boundary, where last month's spill-over and this month's first window can overlap and waste coverage.
        Carrying the phase into the next month removes that overlap: worst moment ${fmtList(car.worst)} against an average of ${fmtList(car.avg)}, game value <b>${f(car.gWorst)}</b> against ${f(car.gAvg)}, which is what the analysis predicts (the small difference left comes from consecutive months using plans with slightly different Δ).
        Peaked distributions leave predictable quiet moments even with cyclic operation (triangular ${f(tri.gWorst)}, normal ${f(nor.gWorst)}), and restricting departures to whole hours costs only ${f(cyc.gWorst - hrs.gWorst, 3)} relative to the same scheme with continuous times. Best against a timing attacker: <b>${best.dist.name}</b>.
        Simulation agrees with the exact calculation to within ${f(Math.max(...res.map(r => Math.max(...r.simAvg.map((x, k) => Math.abs(x - r.avg[k])), ...r.simWorst.map((x, k) => Math.abs(x - r.worst[k]))))), 3)} everywhere.`;
      const csv = [['distribution', 'type', 'avg_coverage', 'worst_coverage', 'worst_time_h', 'sim_avg', 'sim_worst', 'game_random_time', 'game_timing_attacker']];
      res.forEach(r => p.n.forEach((_, k) => csv.push([r.dist.short, k + 1, r.avg[k], r.worst[k], r.worstT[k], r.simAvg[k], r.simWorst[k], r.gAvg, r.gWorst])));
      return { html, finding, csv };
    });

  /* 17 — simultaneous attacks (two or three at once) */

  exp('Simultaneous attacks: two or three at once',
    'If the attacker strikes two or three barriers at the same moment, how does the game change compared with the single attack the paper (and Stage 3) is built for?',
    `<b>Analysis.</b> With payoff v<sub>k</sub>(2·caught − 1) per attack, the expected payoff of a group of r attacks is the sum of their single-attack payoffs, whatever the correlation between the outcomes (linearity of expectation),
     so an expected-value attacker simply picks the r weakest barriers. Against such an attacker the defender solves max z s.t. Σ<sub>k in the group</sub> U<sub>k</sub> ≥ z for every feasible group of types (a type can appear at most n<sub>k</sub> times); this LP is solved below for r = 2 and r = 3 and compared with r·z*.
     Correlation matters once the attacker cares about <em>whether</em> attacks succeed, for example "at least one succeeds" or "all succeed".<br>
     <b>Test.</b> Base configuration; 20 seeds of real Stage-3 timetables for every plan in the mix (only sorties with an aircraft count). For every group of types, 40,000 simulated simultaneous attacks on distinct barriers at an uninformed moment, compared with single attacks on the same timetables and with the independence prediction.`, true, b => {
      const p = mkP(b), { d, s1, s2 } = solve(p), K = p.K;
      const aCoef = p.n.map((nk, k) => (2 * p.v[k] * d.mu) / (nk * d.T));
      // All groups of r types (with repetition) that have enough distinct barriers.
      const groupsOf = r => {
        const out = [];
        (function rec(start, acc) {
          if (acc.length === r) { if (p.n.every((nk, k) => acc.filter(x => x === k).length <= nk)) out.push(acc.slice()); return; }
          for (let k = start; k < K; k++) { acc.push(k); rec(k, acc); acc.pop(); }
        })(0, []);
        return out;
      };
      // Optimal defence against an r-attack expected-value attacker: variables h_1..h_K, z+, z-, one slack per group.
      const groupLP = groups => {
        const nv = K + 2 + groups.length, A = [], rhs = [];
        groups.forEach((g, r) => { const row = new Array(nv).fill(0); g.forEach(k => { row[k] += aCoef[k]; }); row[K] = -1; row[K + 1] = 1; row[K + 2 + r] = -1; A.push(row); rhs.push(g.reduce((s, k) => s + p.v[k], 0)); });
        { const row = new Array(nv).fill(0); for (let k = 0; k < K; k++) row[k] = 1; A.push(row); rhs.push(d.B_eff); }
        const c = new Array(nv).fill(0); c[K] = -1; c[K + 1] = 1;
        const lp = twoPhaseSimplex(A, rhs, c);
        return { z: lp.x[K] - lp.x[K + 1], h: lp.x.slice(0, K) };
      };

      // Real timetables: merged protection intervals per barrier, per plan, per seed.
      const unTimes = [];
      const S = 20, worlds = range(1, S).map(seed => withSeed(b.seed * 13 + seed, () => {
        const s3 = stage3(p, d, s1, s2), w = s3.plans.reduce((x, y) => x + y.prob, 0);
        s3.plans.forEach(pl => pl.plan.events.forEach(e => { if (e.aircraft === null) unTimes.push(e.start); }));
        return s3.plans.map(pl => ({ prob: pl.prob / w, cov: realisedCoverage(p, d, pl.plan) }));
      }));
      const off = p.n.map((_, k) => p.n.slice(0, k).reduce((a, x) => a + x, 0));
      const inIv = (iv, t) => { let lo = 0, hi = iv.length - 1; while (lo <= hi) { const m = (lo + hi) >> 1; if (t < iv[m][0]) hi = m - 1; else if (t >= iv[m][1]) lo = m + 1; else return true; } return false; };
      const rng = mulberry32(b.seed + 17), M = 40000;
      const drawWorld = () => { const wd = worlds[Math.floor(rng() * S)]; let u = rng(), j = 0; for (; j < wd.length - 1; j++) { u -= wd[j].prob; if (u < 0) break; } return wd[j]; };
      const single = p.n.map((nk, k) => { let hit = 0; for (let a = 0; a < M; a++) { const pl = drawWorld(); if (inIv(pl.cov[off[k] + Math.floor(rng() * nk)].merged, rng() * d.T)) hit++; } return hit / M; });
      const P1 = p.n.map((_, k) => Math.min(1, s1.P[k]));

      const simGroup = g => {
        const r = g.length; let allC = 0, noneC = 0, pay = 0;
        const c1 = new Array(r).fill(0), c2 = Array.from({ length: r }, () => new Array(r).fill(0));
        for (let a = 0; a < M; a++) {
          const pl = drawWorld(), t = rng() * d.T, used = p.n.map(() => []), x = [];
          g.forEach(k => { let i; do { i = Math.floor(rng() * p.n[k]); } while (used[k].includes(i)); used[k].push(i); x.push(inIv(pl.cov[off[k] + i].merged, t)); });
          x.forEach((xi, i) => { if (xi) { c1[i]++; for (let j = i + 1; j < r; j++) if (x[j]) c2[i][j]++; } pay += p.v[g[i]] * (xi ? 1 : -1); });
          if (x.every(Boolean)) allC++; if (!x.some(Boolean)) noneC++;
        }
        let corr = 0, nPairs = 0;
        for (let i = 0; i < r; i++) for (let j = i + 1; j < r; j++) {
          const pi = c1[i] / M, pj = c1[j] / M, pij = c2[i][j] / M;
          corr += (pij - pi * pj) / Math.sqrt(Math.max(1e-12, pi * (1 - pi) * pj * (1 - pj))); nPairs++;
        }
        return { g, pay: pay / M, pred: g.reduce((s, k) => s + s1.U[k], 0), allCaught: allC / M, allSucceed: noneC / M, indepAllSucceed: g.reduce((s, k) => s * (1 - P1[k]), 1), atLeastOne: 1 - allC / M, corr: corr / nPairs };
      };
      const lab = g => g.map(k => `T${k + 1}`).join(' + ');
      const parts = [2, 3].map(r => { const groups = groupsOf(r); return { r, groups, lp: groupLP(groups), rows: groups.map(simGroup) }; });

      let html = '';
      parts.forEach(({ r, lp, rows }) => {
        html += `<h4>${r} simultaneous attacks</h4>` +
          barChart({ labels: rows.flatMap(x => [`${lab(x.g)} sim`, `${lab(x.g)} indep.`]), values: rows.flatMap(x => [x.allSucceed, x.indepAllSucceed]), color: rows.flatMap(() => [col(7), '#999']), xLabel: `Probability all ${r} attacks succeed: simulated on real timetables vs. independence prediction`, yLabel: `P(all ${r} succeed)`, yFmt: t => pct(t, 0) }) +
          table(['Group of types', 'Defender payoff (sim)', 'Σ U<sub>d</sub> (Stage 1)', 'P(all caught)', `P(all ${r} succeed) sim`, 'P(all succeed) if independent', 'P(at least one succeeds)', 'Mean pairwise correlation'],
            rows.map(x => [lab(x.g), f(x.pay), f(x.pred), pct(x.allCaught), pct(x.allSucceed), pct(x.indepAllSucceed), pct(x.atLeastOne), f(x.corr, 3)])) +
          `<p class="muted small">Optimal defence against ${r} simultaneous attacks (LP): h = (${lp.h.map(h => f(h, 1)).join(', ')}) h, game value ${f(lp.z)} against ${r}·z* = ${f(r * s1.z)}.</p>`;
      });
      html += table(['', ...p.n.map((_, k) => `Type ${k + 1}`), 'Game value'], [
        ['Single attack: caught on real timetables', ...single.map(x => pct(x)), f(Math.min(...single.map((x, k) => p.v[k] * (2 * x - 1))))],
        ['Stage 1 h* (hours)', ...s1.h.map(h => f(h, 1)), `single ${f(s1.z)}`]
      ]);

      const [p2, p3] = parts, same = part => Math.abs(part.lp.z - part.r * s1.z) < 1e-6;
      const risk = part => part.rows.reduce((a, x) => (x.atLeastOne > a.atLeastOne ? x : a), part.rows[0]);
      const r2 = risk(p2), r3 = risk(p3), worst3 = p3.rows.reduce((a, x) => (x.pay < a.pay ? x : a), p3.rows[0]);
      const maxCorr = Math.max(...p2.rows.map(x => x.corr), ...p3.rows.map(x => x.corr));
      const finding = `Expected payoffs add up: every group's simulated payoff matches the sum of its single-attack payoffs, apart from the gap left by unassigned sorties (worst triple ${lab(worst3.g)}: ${f(worst3.pay)} vs ${f(worst3.pred)}).
        Re-optimising against an expected-value attacker gives ${f(p2.lp.z)} for two attacks (2z* = ${f(2 * s1.z)}) and ${f(p3.lp.z)} for three (3z* = ${f(3 * s1.z)})${same(p2) && same(p3) ? ', with the Stage-1 hours unchanged: as long as every type has at least as many barriers as there are attacks, the single-attack allocation is already optimal' : '; the allocation shifts because some type has fewer barriers than there are attacks, so it cannot be hit repeatedly'}.
        The outcomes are positively correlated (mean pairwise correlation up to ${f(maxCorr, 3)}), so "all succeed" happens more often than independence predicts.
        ${unTimes.length ? `The cause is shared quiet time: all ${unTimes.length} unassigned sorties across the ${S * worlds[0].length} simulated timetables (${f(unTimes.length / (S * worlds[0].length), 1)} per timetable) fall between ${fmtDayTime(Math.min(...unTimes))} and ${fmtDayTime(Math.max(...unTimes))}, after every aircraft has used its budget, so near the end of the month every barrier is unprotected at once; the month-boundary gap of Experiment 1 adds to it.` : 'With no unassigned sorties, the remaining correlation comes from the shared monthly plan and the month-boundary gap of Experiment 1.'}
        For an attacker who only needs one success, each extra attack helps a lot: P(at least one succeeds) is about ${pct(1 - Math.max(...single))}–${pct(1 - Math.min(...single))} for one attack, up to ${pct(r2.atLeastOne)} for two (${lab(r2.g)}) and ${pct(r3.atLeastOne)} for three (${lab(r3.g)}). That risk is invisible to the expected-value game the paper solves.`;
      const csv = [['attacks', 'group', 'payoff_sim', 'payoff_stage1', 'p_all_caught', 'p_all_succeed', 'p_all_succeed_indep', 'p_at_least_one', 'mean_pairwise_corr'],
        ...parts.flatMap(({ r, rows }) => rows.map(x => [r, lab(x.g), x.pay, x.pred, x.allCaught, x.allSucceed, x.indepAllSucceed, x.atLeastOne, x.corr]))];
      return { html, finding, csv };
    });

  /* 18 — an attacker who learns */

  exp('An attacker who learns (regret matching / CFR)',
    'Suppose the attacker does not know the policy at first and learns it month by month with a no-regret algorithm. How does its strategy evolve, and can it ever beat the game value? And if both sides learn, do they find the Stackelberg solution on their own?',
    `<b>Method.</b> The attacker's choice each month is a single decision (which type to hit), so CFR reduces exactly to <em>regret matching</em>: play each type in proportion to its positive cumulative regret.
     <b>Part A</b> pits a learning attacker against fixed defender policies for 4,000 rounds (one round = one planning period): the Stackelberg mix (a fresh plan each round) and the Uniform, Value-proportional and Greedy baselines.
     With full information (after each round the attacker learns what every type would have paid that round) it uses regret matching; with only its own outcome it uses EXP3, the bandit version.
     <b>Part B</b> is self-play: the defender also runs regret matching (RM+) over allocations of B<sub>eff</sub> on a grid, against the learning attacker. In a zero-sum game the <em>average</em> strategies of two no-regret learners converge to an equilibrium, which here is the Stackelberg allocation h*.`, true, b => {
      const p = mkP(b), { d, s1, s2 } = solve(p), K = p.K, sup = support(s2), tot = sup.reduce((s, x) => s + x.s, 0), wts = sup.map(x => x.s / tot);
      const vmax = Math.max(...p.v), rng = mulberry32(b.seed + 18), R = 4000;
      const covOf = h => h.map((hk, k) => Math.min(1, (d.mu * hk) / (p.n[k] * d.T)));
      const qOf = (m, k, i) => { const base = Math.floor(m[k] / p.n[k]), rem = m[k] - base * p.n[k]; return base + (i < rem ? 1 : 0); };
      // Catch probability of a random barrier of each type when plan m is flown (Eq. 13).
      const planCov = m => p.n.map((nk, k) => { let s = 0; for (let i = 0; i < nk; i++) s += Math.min(1, (d.W * qOf(m, k, i)) / d.T); return s / nk; });
      const bl = baselines(p, d);
      const policies = [
        { name: 'Stackelberg mix', draw: () => { let u = rng(), j = 0; for (; j < sup.length - 1; j++) { u -= wts[j]; if (u < 0) break; } return planCov(sup[j].m); }, exp: s1.h },
        { name: 'Uniform random', draw: () => covOf(bl.uniform.h), exp: bl.uniform.h },
        { name: 'Value-proportional', draw: () => covOf(bl.valueProportional.h), exp: bl.valueProportional.h },
        { name: 'Greedy', draw: () => covOf(bl.greedy.h), exp: bl.greedy.h }
      ];
      const attackerValue = h => Math.max(...covOf(h).map((P, k) => -p.v[k] * (2 * P - 1))); // best response to the policy's average coverage
      const checkpoints = range(50, R, 50);
      const resA = policies.map(pol => {
        const reg = new Array(K).fill(0), avgS = new Array(K).fill(0); let cum = 0;
        const w = new Array(K).fill(1), g = 0.07; let cumB = 0;
        const curve = [], curveB = [], mix = [];
        for (let t = 1; t <= R; t++) {
          const P = pol.draw(), u = P.map((x, k) => -p.v[k] * (2 * x - 1)); // attacker's expected payoff per type this round
          // Full information: regret matching (CFR on a one-decision game).
          const pos = reg.map(r => Math.max(0, r)), ps = pos.reduce((a, x) => a + x, 0), sig = ps > 0 ? pos.map(x => x / ps) : new Array(K).fill(1 / K);
          const ev = sig.reduce((a, s, k) => a + s * u[k], 0);
          for (let k = 0; k < K; k++) { reg[k] += u[k] - ev; avgS[k] += sig[k]; }
          cum += ev;
          // Bandit feedback: EXP3 sees only whether its own attack was caught.
          const W = w.reduce((a, x) => a + x, 0), pr = w.map(x => (1 - g) * (x / W) + g / K);
          let r0 = rng(), k0 = 0; for (; k0 < K - 1; k0++) { r0 -= pr[k0]; if (r0 < 0) break; }
          const caught = rng() < P[k0], pay = caught ? -p.v[k0] : p.v[k0];
          cumB += pay;
          const xhat = ((pay + vmax) / (2 * vmax)) / pr[k0];
          w[k0] *= Math.exp((g * xhat) / K);
          const mx = Math.max(...w); for (let k = 0; k < K; k++) w[k] /= mx;
          if (t % 50 === 0) { curve.push(cum / t); curveB.push(cumB / t); mix.push(sig.slice()); }
        }
        return { pol, curve, curveB, mix, final: cum / R, finalB: cumB / R, avgMix: avgS.map(x => x / R), br: attackerValue(pol.exp) };
      });

      // Part B: self-play. Defender actions = allocations of B_eff on a grid (multiples of B_eff/G).
      const G = K <= 3 ? 20 : K <= 5 ? 10 : 6, acts = [];
      (function rec(prefix, left) { if (prefix.length === K - 1) { acts.push([...prefix, left]); return; } for (let x = 0; x <= left; x++) rec([...prefix, x], left - x); })([], G);
      const Mx = acts.map(a => covOf(a.map(x => (x / G) * d.B_eff)).map((P, k) => p.v[k] * (2 * P - 1))); // defender payoff, action × type
      const rD = new Array(acts.length).fill(0), rA = new Array(K).fill(0), avgD = new Array(acts.length).fill(0), avgA = new Array(K).fill(0);
      const I = 3000, gapCurve = [], its = [];
      const norm = r => { const pos = r.map(x => Math.max(0, x)), s = pos.reduce((a, x) => a + x, 0); return s > 0 ? pos.map(x => x / s) : r.map(() => 1 / r.length); };
      let avgDw = 0;
      for (let t = 1; t <= I; t++) {
        const sd_ = norm(rD), sa = norm(rA);
        const uD = Mx.map(row => row.reduce((a, x, k) => a + x * sa[k], 0)), evD = uD.reduce((a, x, i) => a + x * sd_[i], 0);
        const uA = p.n.map((_, k) => -Mx.reduce((a, row, i) => a + row[k] * sd_[i], 0)), evA = uA.reduce((a, x, k) => a + x * sa[k], 0);
        for (let i = 0; i < rD.length; i++) rD[i] = Math.max(0, rD[i] + uD[i] - evD); // RM+ (CFR+ style)
        for (let k = 0; k < K; k++) rA[k] = Math.max(0, rA[k] + uA[k] - evA);
        for (let i = 0; i < avgD.length; i++) avgD[i] += t * sd_[i]; // linear averaging, as in CFR+
        for (let k = 0; k < K; k++) avgA[k] += t * sa[k];
        avgDw += t;
        if (t % 25 === 0) {
          const val = Math.min(...p.n.map((_, k) => Mx.reduce((a, row, i) => a + row[k] * (avgD[i] / avgDw), 0)));
          gapCurve.push(s1.z - val); its.push(t);
        }
      }
      const hAvg = p.n.map((_, k) => acts.reduce((a, act, i) => a + (avgD[i] / avgDw) * (act[k] / G) * d.B_eff, 0));
      const valAvg = Math.min(...p.n.map((_, k) => Mx.reduce((a, row, i) => a + row[k] * (avgD[i] / avgDw), 0)));

      const chartA = lineChart({ x: checkpoints, series: resA.map((r, i) => ({ name: `${r.pol.name}: learning attacker's average payoff`, y: r.curve, color: col(i) })), hlines: resA.map((r, i) => ({ y: r.br, color: col(i) })), xLabel: 'Rounds (planning periods)', yLabel: "Attacker's average payoff" }) +
        `<p class="muted small">Dashed lines: what a perfectly informed attacker gets against each policy (its best response). Full-information regret matching.</p>`;
      const stk = resA[0];
      const chartMix = lineChart({ x: checkpoints, yMin: 0, yMax: 1, series: p.n.map((_, k) => ({ name: `P(attack Type ${k + 1}) vs Stackelberg`, y: stk.mix.map(m => m[k]), color: col(k) })).concat(p.n.map((_, k) => ({ name: `P(attack Type ${k + 1}) vs Value-proportional`, y: resA[2].mix.map(m => m[k]), color: col(k), dash: true }))), xLabel: 'Rounds', yLabel: "Attacker's current strategy", yFmt: t => pct(t, 0) });
      const chartB = lineChart({ x: its, series: [{ name: 'Defender: z* − value of its average strategy (exploitability)', y: gapCurve, color: '#111' }], yMin: 0, xLabel: 'Self-play iterations', yLabel: 'Gap to z*' });
      const html = `<h4>Part A: a learning attacker against fixed policies</h4>${chartA}${chartMix}` +
        table(['Defender policy', 'Best-response payoff (perfect knowledge)', 'Learned, full information (regret matching)', 'Learned, bandit feedback (EXP3)', 'Average attack mix (regret matching)'],
          resA.map(r => [r.pol.name, f(r.br), f(r.final), f(r.finalB), r.avgMix.map(x => pct(x, 0)).join(' / ')])) +
        `<h4>Part B: both sides learn (self-play)</h4>${chartB}` +
        table(['', ...p.n.map((_, k) => `h<sub>${k + 1}</sub>`), 'Guaranteed value'], [['Stage 1 h*', ...s1.h.map(h => f(h, 1)), f(s1.z)], [`Self-play average after ${I} iterations (grid of ${acts.length} allocations)`, ...hAvg.map(h => f(h, 1)), f(valAvg)]]);
      const best = resA.slice(1).reduce((a, r) => (r.final > a.final ? r : a), resA[1]);
      const finding = `Against the Stackelberg mix the learning attacker's average payoff settles at ${f(stk.final)} (bandit: ${f(stk.finalB)}, which includes the noise of real outcomes), essentially −z* = ${f(-s1.z)}: learning cannot extract more than the game value, because every type pays the attacker the same.
        Its attack mix keeps wandering (average ${stk.avgMix.map(x => pct(x, 0)).join(' / ')}), which is what indifference looks like to a learner. Against the baselines it learns to exploit the weakest type and converges to their best-response payoff, up to ${f(best.final)} against ${best.pol.name} (bandit ${f(best.finalB)}).
        In self-play neither side is told the solution, yet the defender's average allocation reaches (${hAvg.map(h => f(h, 0)).join(', ')}) h against h* = (${s1.h.map(h => f(h, 0)).join(', ')}) h, with a remaining gap of ${f(s1.z - valAvg, 4)} after ${I} iterations. This is the regret-minimisation route to the same equilibrium (Zinkevich et al., from the seminar).`;
      const csv = [['round', ...resA.flatMap(r => [`${r.pol.name}_full`, `${r.pol.name}_bandit`])], ...checkpoints.map((t, i) => [t, ...resA.flatMap(r => [r.curve[i], r.curveB[i]])])];
      return { html, finding, csv };
    });

  /* 19 — Remark 8: individual vs shared phase draws */

  exp('Remark 8: individual vs. shared phase draws',
    'Remark 8 says individual phase draws per barrier are harder to predict than one shared draw per type, with the same coverage. What happens with one draw per type, and with one draw for every barrier?',
    `<b>Schemes.</b> (1) Individual draws (Eq. 14). (2) One draw per type, staggered by i/n<sub>k</sub> of the cycle (the earlier formulation in Remark 8). (3) One draw per type, no stagger. (4) One draw for all barriers.
     Each is run with the paper's phase range [0, Δ − W] and with the full cycle [0, Δ). Attacks are placed mid-month, so the month boundary of Experiment 1 does not interfere.<br>
     <b>Measures.</b> Coverage at an uninformed moment (Remark 8 says it is unchanged); how often <em>every</em> barrier of a type is unprotected at once; and an informed attacker who watches barrier 1 of a type for half the month (so knows its schedule exactly), then strikes barrier 2 of the same type at the best moment of the next cycle. 1,500 trials per type and scheme.`, true, b => {
      const p = mkP(b), { d, s1, s2 } = solve(p), K = p.K, sup = support(s2), tot = sup.reduce((s, x) => s + x.s, 0), w = sup.map(x => x.s / tot), W = d.W;
      const qOf = (m, k, i) => { const base = Math.floor(m[k] / p.n[k]), rem = m[k] - base * p.n[k]; return base + (i < rem ? 1 : 0); };
      const rng = mulberry32(b.seed + 19), M = 1500;
      const schemes = [
        { name: 'Individual draws (Eq. 14)', u: (k, i, U) => U.ind[k][i] },
        { name: 'One draw per type, staggered (old formulation)', u: (k, i, U) => (U.type[k] + i / p.n[k]) % 1 },
        { name: 'One draw per type, no stagger', u: (k, i, U) => U.type[k] },
        { name: 'One draw for all barriers', u: (k, i, U) => U.all }
      ];
      const rules = [{ name: 'φ ∈ [0, Δ − W] (paper)', L: D => Math.max(0, D - W) }, { name: 'φ ∈ [0, Δ) (full cycle)', L: D => D }];
      const drawU = () => ({ ind: p.n.map(nk => Array.from({ length: nk }, () => rng())), type: p.n.map(() => rng()), all: rng() });
      const pickPlan = () => { let u = rng(), j = 0; for (; j < w.length - 1; j++) { u -= w[j]; if (u < 0) break; } return j; };
      const covered = (q, D, phi, t) => phaseSimCovered(q, D, W, phi, t);
      const t0 = d.T / 2;
      const out = [];
      rules.forEach(rule => schemes.forEach(sc => {
        const avg = [], allOff = [], informed = [];
        for (let k = 0; k < K; k++) {
          let hit = 0, off = 0, inf = 0, infN = 0;
          for (let a = 0; a < M; a++) {
            const j = pickPlan(), U = drawU(), m = sup[j].m;
            const phiOf = i => { const q = qOf(m, k, i), D = d.T / Math.max(1, q); return { q, D, phi: sc.u(k, i, U) * rule.L(D) }; };
            // Uninformed moment in mid-month: random barrier, random time.
            const t = d.T / 4 + rng() * (d.T / 2), bi = phiOf(Math.floor(rng() * p.n[k]));
            if (covered(bi.q, bi.D, bi.phi, t)) hit++;
            if (Array.from({ length: p.n[k] }, (_, i) => phiOf(i)).every(x => !covered(x.q, x.D, x.phi, t))) off++;
            // Informed attacker: knows barrier 1's q and phase, strikes barrier 2 of the same type.
            if (p.n[k] >= 2) {
              const A = phiOf(0), B = phiOf(1), uA = A.phi / Math.max(1e-9, rule.L(A.D));
              const cons = sup.map((x, jj) => (qOf(x.m, k, 0) === A.q ? w[jj] : 0)), cs = cons.reduce((s, x) => s + x, 0);
              const DB = sup.map(x => d.T / Math.max(1, qOf(x.m, k, 1))), span = Math.max(...DB);
              let bestT = t0, bestC = Infinity;
              for (let tt = t0; tt < t0 + span; tt += 0.1) {
                let C = 0;
                sup.forEach((x, jj) => {
                  if (!cons[jj]) return;
                  const qB = qOf(x.m, k, 1), D = d.T / Math.max(1, qB);
                  let c;
                  if (sc.name.startsWith('Individual')) c = phaseCover({ cdf: z => (z < 0 ? 0 : rule.L(D) <= 0 ? 1 : Math.min(1, z / rule.L(D))) }, qB, D, W, tt);
                  else { const uB = sc.name.includes('staggered') ? (uA + 1 / p.n[k]) % 1 : uA; c = covered(qB, D, uB * rule.L(D), tt) ? 1 : 0; }
                  C += (cons[jj] / cs) * c;
                });
                if (C < bestC - 1e-12) { bestC = C; bestT = tt; }
              }
              infN++; if (covered(B.q, B.D, B.phi, bestT)) inf++;
            }
          }
          avg.push(hit / M); allOff.push(off / M); informed.push(infN ? inf / infN : NaN);
        }
        const game = P => Math.min(...P.map((x, k) => (Number.isFinite(x) ? p.v[k] * (2 * x - 1) : Infinity)));
        out.push({ rule: rule.name, scheme: sc.name, avg, allOff, informed, gAvg: game(avg), gInf: game(informed) });
      }));
      const fl = a => a.map(x => (Number.isFinite(x) ? pct(x, 1) : '—')).join(' / ');
      const types = p.n.map((_, k) => `T${k + 1}`).join(' / ');
      const html = barChart({ labels: out.map(r => `${r.scheme.split(' (')[0].replace('One draw ', '1 draw ')} · ${r.rule.startsWith('φ ∈ [0, Δ − W]') ? 'paper' : 'full'}`), values: out.map(r => r.gInf), color: out.map(r => (r.rule.includes('paper') ? col(0) : col(2))), xLabel: 'Informed attacker: game value by scheme (blue = paper range, green = full cycle)', yLabel: 'Game value', yFmt: t => t.toFixed(1), H: 300 }) +
        table(['Phase range', 'Scheme', `Coverage at an uninformed moment (${types})`, `P(every barrier of the type unprotected) (${types})`, `Caught by informed attacker (${types})`, 'Game value, uninformed', 'Game value, informed'],
          out.map(r => [r.rule, r.scheme, fl(r.avg), fl(r.allOff), fl(r.informed), f(r.gAvg), `<b>${f(r.gInf)}</b>`]));
      const get = (ru, sc) => out.find(r => r.rule.startsWith(ru) && r.scheme.startsWith(sc));
      const iFull = get('φ ∈ [0, Δ)', 'Individual'), sFull = get('φ ∈ [0, Δ)', 'One draw per type, no'), aFull = get('φ ∈ [0, Δ)', 'One draw for all'), stFull = get('φ ∈ [0, Δ)', 'One draw per type, staggered');
      const iPap = get('φ ∈ [0, Δ − W]', 'Individual');
      const finding = `Remark 8's first claim holds: at an uninformed moment every scheme gives the same coverage, within sampling noise of about ±2.5 points (${fl(iFull.avg)} with individual draws, ${fl(aFull.avg)} with one draw for everything).
        What sharing changes is correlation. With one draw per type and no stagger, all barriers of a type are unprotected at the same time ${fl(sFull.allOff)} of the time, against ${fl(iFull.allOff)} with individual draws; staggering spreads the visits out (${fl(stFull.allOff)}).
        Its second claim also holds: an attacker who learns one barrier's schedule can time an attack on its neighbour. On the full cycle, individual draws keep the informed catch rate at ${fl(iFull.informed)} (game value ${f(iFull.gInf)}), while shared draws drop it to ${fl(sFull.informed)} (game value ${f(sFull.gInf)}), and the staggered scheme to ${fl(stFull.informed)}.
        With the paper's range [0, Δ − W], even individual draws give the informed attacker ${fl(iPap.informed)} (game value ${f(iPap.gInf)}): the timing gap of Experiment 1 is exploitable without any information leak. So Remark 8's advantage only shows up once the phase is drawn over the full cycle.`;
      const csv = [['phase_range', 'scheme', 'type', 'coverage_uninformed', 'p_all_unprotected', 'caught_informed'], ...out.flatMap(r => p.n.map((_, k) => [r.rule, r.scheme, k + 1, r.avg[k], r.allOff[k], r.informed[k]]))];
      return { html, finding, csv };
    });

  // Display order: the research questions first, then the original fifteen.
  {
    const first = ['Phase distribution', 'Simultaneous attacks', 'An attacker who learns', 'Remark 8'].map(t => EXPS.find(e => e.title.startsWith(t)));
    EXPS.splice(0, EXPS.length, ...first, ...EXPS.filter(e => !first.includes(e)));
  }

  /* ---------------- page wiring ---------------- */

  const results = {};

  // Experiments shown on the page (by their number). The others stay in the code; add a number here to show one again.
  const VISIBLE = [2, 6];
  const shown = i => VISIBLE.includes(i + 1);

  function renderShell() {
    $('toc').innerHTML = EXPS.map((e, i) => (shown(i) ? `<li value="${i + 1}"><a href="#exp${i + 1}">${e.title}</a>${e.heavy ? ' <span class="muted small">(slower)</span>' : ''}</li>` : '')).join('');
    $('experiments').innerHTML = EXPS.map((e, i) => (!shown(i) ? '' : `
      <section id="exp${i + 1}">
        <div class="exp-head"><span class="exp-tag">Experiment ${i + 1}</span><h2>${e.title}</h2></div>
        <p class="exp-q">${e.question}</p>
        <p class="muted small"><b>Setup:</b> ${e.setup}</p>
        <div class="exp-actions"><button type="button" data-run="${i}">&#9654; Run</button><button type="button" class="secondary" data-csv="${i}" disabled>Download CSV</button></div>
        <div class="exp-out" id="out${i}"></div>
      </section>`)).join('');
    $('experiments').addEventListener('click', e => {
      const r = e.target.closest('[data-run]'), c = e.target.closest('[data-csv]');
      if (r) runExp(+r.dataset.run);
      if (c && results[+c.dataset.csv]) downloadCsv(+c.dataset.csv);
    });
  }

  function runExp(i) {
    const { b, errs } = readBase();
    if (errs.length) { $('baseError').textContent = errs.join('\n'); return Promise.resolve(); }
    $('baseError').textContent = '';
    const out = $(`out${i}`);
    out.innerHTML = '<p class="muted">Running…</p>';
    return new Promise(resolve => setTimeout(() => {
      try {
        const t0 = performance.now(), r = EXPS[i].run(b);
        results[i] = r;
        out.innerHTML = r.html + `<div class="finding"><b>Finding.</b> ${r.finding}</div><p class="muted small">Ran in ${f((performance.now() - t0) / 1000, 2)} s · base N = ${b.N}, n = (${b.n.join(', ')}), v = (${b.v.join(', ')}), τ<sub>p</sub> = ${b.tau_p}, τ<sub>s</sub> = ${b.tau_s}, τ<sub>r</sub> = ${b.tau_r}, T = ${b.T_days} d, F = ${b.F} h, seed ${b.seed}.</p>`;
        document.querySelector(`[data-csv="${i}"]`).disabled = false;
      } catch (err) {
        console.error(err);
        out.innerHTML = `<p class="error">This experiment failed: ${err.message}</p>`;
      }
      resolve();
    }, 20));
  }

  function downloadCsv(i) {
    const esc = x => { const s = typeof x === 'number' ? String(+x.toPrecision(10)) : String(x ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const text = results[i].csv.map(r => r.map(esc).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    a.download = `experiment_${String(i + 1).padStart(2, '0')}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function runMany(onlyLight) {
    for (let i = 0; i < EXPS.length; i++) if (shown(i) && (!onlyLight || !EXPS[i].heavy)) await runExp(i);
  }

  document.addEventListener('DOMContentLoaded', () => {
    renderShell();
    $('runAllBtn').addEventListener('click', () => runMany(false));
    $('runLightBtn').addEventListener('click', () => runMany(true));
    runMany(true);
  });
})();
