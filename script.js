const EPS = 1e-7;

/* ============================================================
   Utilities
   ============================================================ */

function fmt(x, dec = 2) {
  if (x === null || x === undefined || Number.isNaN(x)) return '—';
  return Number(x).toFixed(dec);
}

function fmtDayTime(hours) {
  const totalMin = Math.round(hours * 60);
  const day = Math.floor(totalMin / 1440) + 1;
  const rem = ((totalMin % 1440) + 1440) % 1440;
  const hh = Math.floor(rem / 60), mm = rem % 60;
  return `Day ${day}, ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function combinationsIndices(n, r) {
  const result = [];
  if (r < 0 || r > n) return result;
  const combo = [];
  function backtrack(start) {
    if (combo.length === r) { result.push(combo.slice()); return; }
    for (let i = start; i < n; i++) {
      combo.push(i);
      backtrack(i + 1);
      combo.pop();
    }
  }
  backtrack(0);
  return result;
}

/* ============================================================
   Two-phase simplex solver: minimize c^T x  s.t. A x = b, x >= 0
   (b is always >= 0 for the LPs this app builds, so no row flips needed)
   ============================================================ */

function computeObjRow(tab, basis, costVec, nTotal, rhsCol) {
  const m = basis.length;
  const row = new Array(rhsCol + 1).fill(0);
  for (let j = 0; j <= rhsCol; j++) {
    let z = 0;
    for (let i = 0; i < m; i++) z += costVec[basis[i]] * tab[i][j];
    const cj = j < nTotal ? costVec[j] : 0;
    row[j] = cj - z;
  }
  return row;
}

function pivotTableau(tab, objRowIdx, row, col) {
  const nCols = tab[0].length;
  const pv = tab[row][col];
  for (let j = 0; j < nCols; j++) tab[row][j] /= pv;
  for (let i = 0; i <= objRowIdx; i++) {
    if (i === row) continue;
    const factor = tab[i][col];
    if (Math.abs(factor) < 1e-14) continue;
    for (let j = 0; j < nCols; j++) tab[i][j] -= factor * tab[row][j];
  }
}

function runSimplex(tab, basis, objRowIdx, nTotal, rhsCol, allowedCol, maxIter = 2000) {
  for (let iter = 0; iter < maxIter; iter++) {
    let enter = -1;
    for (let j = 0; j < nTotal; j++) {
      if (!allowedCol(j)) continue;
      if (tab[objRowIdx][j] < -EPS) { enter = j; break; } // Bland's rule: first eligible negative reduced cost
    }
    if (enter === -1) return { status: 'optimal' };

    let leave = -1, bestRatio = Infinity;
    for (let i = 0; i < objRowIdx; i++) {
      if (tab[i][enter] > EPS) {
        const ratio = tab[i][rhsCol] / tab[i][enter];
        if (ratio < bestRatio - EPS || (Math.abs(ratio - bestRatio) <= EPS && (leave === -1 || basis[i] < basis[leave]))) {
          bestRatio = ratio; leave = i;
        }
      }
    }
    if (leave === -1) return { status: 'unbounded' };
    pivotTableau(tab, objRowIdx, leave, enter);
    basis[leave] = enter;
  }
  return { status: 'maxiter' };
}

function twoPhaseSimplex(A, b, c) {
  const m = A.length;
  const n = A[0].length;
  const nTotal = n + m;
  const nCols = nTotal + 1;
  const rhsCol = nTotal;

  const tab = [];
  for (let i = 0; i < m; i++) {
    const row = new Array(nCols).fill(0);
    for (let j = 0; j < n; j++) row[j] = A[i][j];
    row[n + i] = 1;
    row[rhsCol] = b[i];
    tab.push(row);
  }
  const basis = [];
  for (let i = 0; i < m; i++) basis.push(n + i);

  const c1 = new Array(nTotal).fill(0);
  for (let i = 0; i < m; i++) c1[n + i] = 1;
  tab.push(computeObjRow(tab, basis, c1, nTotal, rhsCol));

  runSimplex(tab, basis, m, nTotal, rhsCol, () => true);

  let phase1Obj = 0;
  for (let i = 0; i < m; i++) phase1Obj += c1[basis[i]] * tab[i][rhsCol];
  const sumB = b.reduce((s, v) => s + Math.abs(v), 0);
  if (phase1Obj > 1e-6 * Math.max(1, sumB)) {
    return { feasible: false, x: new Array(n).fill(0), duals: new Array(m).fill(0), phase1Obj };
  }

  // Drive any degenerate (zero-valued) artificials out of the basis before phase 2
  for (let i = 0; i < m; i++) {
    if (basis[i] >= n && tab[i][rhsCol] < 1e-7) {
      let col = -1;
      for (let j = 0; j < n; j++) { if (Math.abs(tab[i][j]) > 1e-7) { col = j; break; } }
      if (col !== -1) { pivotTableau(tab, m, i, col); basis[i] = col; }
    }
  }

  const c2 = c.concat(new Array(m).fill(0));
  tab[m] = computeObjRow(tab, basis, c2, nTotal, rhsCol);
  runSimplex(tab, basis, m, nTotal, rhsCol, j => j < n);

  const x = new Array(n).fill(0);
  for (let i = 0; i < m; i++) if (basis[i] < n) x[basis[i]] = Math.max(0, tab[i][rhsCol]);

  // Dual values fall out of the (still-present) artificial columns: col (n+i) holds B^{-1}e_i
  const duals = new Array(m).fill(0);
  for (let i = 0; i < m; i++) duals[i] = -tab[m][n + i];

  let objective = 0;
  for (let j = 0; j < n; j++) objective += c[j] * x[j];

  return { feasible: true, x, duals, objective };
}

/* ============================================================
   Parameters
   ============================================================ */

function getParams() {
  const N = parseFloat(document.getElementById('N').value);
  const K = parseInt(document.getElementById('K').value, 10);
  const tau_p = parseFloat(document.getElementById('tau_p').value);
  const tau_s = parseFloat(document.getElementById('tau_s').value);
  const T_days = parseFloat(document.getElementById('T_days').value);
  const tau_r = parseFloat(document.getElementById('tau_r').value);
  const F = parseFloat(document.getElementById('F').value);
  const theta = parseFloat(document.getElementById('theta').value);
  const n = [], v = [];
  document.querySelectorAll('#barrierTypesBody tr').forEach(tr => {
    n.push(parseFloat(tr.querySelector('.nk-input').value));
    v.push(parseFloat(tr.querySelector('.vk-input').value));
  });
  return { N, K, tau_p, tau_s, T_days, tau_r, F, theta, n, v };
}

function validateParams(p) {
  const errs = [];
  if (!(p.N >= 1)) errs.push('Number of aircraft must be at least 1.');
  if (!(p.K >= 1)) errs.push('Number of barrier types must be at least 1.');
  if (!(p.tau_p > 0)) errs.push('Flying hours per sortie must be positive.');
  if (!(p.tau_s >= 0)) errs.push('Safe period must be non-negative.');
  if (!(p.T_days >= 1)) errs.push('Planning horizon must be at least 1 day.');
  if (!(p.tau_r >= 0)) errs.push('Aircraft restart period must be non-negative.');
  if (!(p.F > 0)) errs.push('Max flying hours per aircraft must be positive.');
  if (!(p.theta >= 0 && p.theta <= 1)) errs.push('Coverage threshold theta must be between 0 and 1.');
  if (p.n.length !== p.K || p.v.length !== p.K) errs.push('Barrier type table is out of sync with K — change K again to rebuild it.');
  p.n.forEach((nk, i) => { if (!(nk >= 1) || !Number.isFinite(nk)) errs.push(`Type ${i + 1}: number of barriers must be a positive integer.`); });
  p.v.forEach((vk, i) => { if (!(vk > 0)) errs.push(`Type ${i + 1}: military value must be positive.`); });
  return errs;
}

function computeDerived(p) {
  const T = p.T_days * 24;
  const W = p.tau_p + p.tau_s;
  const mu = W / p.tau_p;
  const G = p.tau_p + p.tau_r;
  const B = p.N * p.F;
  const N_srt = Math.floor(B / p.tau_p + 1e-9);
  const B_eff = N_srt * p.tau_p;
  const Nb = p.n.reduce((a, b) => a + b, 0);
  return { T, W, mu, G, B, N_srt, B_eff, Nb };
}

/* ============================================================
   Stage 1 — analytical LP solution (Theorem 1) with iterative
   removal of inactive barrier types (Remark 5 / Proposition 2)
   ============================================================ */

function stage1(p, d) {
  const K = p.K;
  let active = [...Array(K).keys()];
  const dCoef = new Array(K).fill(0);
  const h = new Array(K).fill(0);
  let z = 0;
  const log = [];
  let guard = 0;

  while (active.length > 0 && guard < K + 2) {
    guard++;
    active.forEach(k => { dCoef[k] = (p.n[k] * d.T) / (2 * d.mu * p.v[k]); });
    const NbActive = active.reduce((s, k) => s + p.n[k], 0);
    const sumD = active.reduce((s, k) => s + dCoef[k], 0);
    z = (d.B_eff - (d.T * NbActive) / (2 * d.mu)) / sumD;
    active.forEach(k => { h[k] = dCoef[k] * (z + p.v[k]); });

    const negatives = active.filter(k => h[k] < -1e-7);
    if (negatives.length === 0) break;
    log.push(`Type ${negatives.map(k => k + 1).join(', ')} removed from the active set (z* + v_k ≤ 0) — re-solving over the remaining ${active.length - negatives.length} type(s).`);
    active = active.filter(k => !negatives.includes(k));
  }

  for (let k = 0; k < K; k++) if (!active.includes(k)) h[k] = 0;

  const P = new Array(K).fill(0), U = new Array(K).fill(0);
  for (let k = 0; k < K; k++) {
    P[k] = (d.mu * h[k]) / (p.n[k] * d.T);
    U[k] = p.v[k] * (2 * P[k] - 1);
  }

  return { active, d: dCoef, h, z, P, U, log, feasible: active.length > 0 };
}

/* ============================================================
   Stage 2 — floor/ceil candidate schedules + feasibility LP
   (Section 6.4: the practical replacement for full column generation)
   ============================================================ */

function stage2(p, d, s1) {
  const K = p.K, tau_p = p.tau_p, Nsrt = d.N_srt;
  const active = s1.active;

  if (!s1.feasible || active.length === 0) {
    return { candidates: [], s: [], eps: [], gap: null, lambda: [], nu: 0, feasible: false, note: 'no active barrier types' };
  }

  const mStar = new Array(K).fill(0);
  active.forEach(k => { mStar[k] = s1.h[k] / tau_p; });

  const floorM = new Array(K).fill(0), ceilM = new Array(K).fill(0), isFrac = new Array(K).fill(false);
  active.forEach(k => {
    const f = mStar[k];
    const fl = Math.floor(f + 1e-7);
    const frac = f - fl;
    if (frac < 1e-5) { floorM[k] = fl; ceilM[k] = fl; }
    else if (frac > 1 - 1e-5) { floorM[k] = fl + 1; ceilM[k] = fl + 1; }
    else { floorM[k] = fl; ceilM[k] = fl + 1; isFrac[k] = true; }
  });

  let candidates = [];
  const fracTypes = active.filter(k => isFrac[k]);

  if (fracTypes.length === 0) {
    const m = new Array(K).fill(0);
    active.forEach(k => { m[k] = floorM[k]; });
    candidates.push(m);
  } else {
    // sum(m_k*) = N_srt exactly, so the fractional parts of the active types sum to an
    // integer r: exactly r of them must round up (ceil) and the rest down (floor).
    const sumFloorAll = active.reduce((s, k) => s + floorM[k], 0);
    let r = Math.round(Nsrt - sumFloorAll);
    r = Math.max(0, Math.min(r, fracTypes.length));
    const combos = combinationsIndices(fracTypes.length, r);
    combos.forEach(comboLocalIdx => {
      const m = new Array(K).fill(0);
      active.forEach(k => { m[k] = floorM[k]; });
      comboLocalIdx.forEach(li => { const k = fracTypes[li]; m[k] = ceilM[k]; });
      const sum = active.reduce((s, k) => s + m[k], 0);
      if (Math.abs(sum - Nsrt) < 1e-6) candidates.push(m);
    });
  }

  // Canonical strategies (all N_srt sorties on one type) as a safety net — same
  // columns the paper's column-generation algorithm starts from (Section 6.3).
  active.forEach(k => {
    const m = new Array(K).fill(0);
    m[k] = Nsrt;
    candidates.push(m);
  });

  const seen = new Set();
  candidates = candidates.filter(m => {
    const key = m.join(',');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const J = candidates.length;
  const Amat = [], bvec = [];
  for (let k = 0; k < K; k++) {
    const row = new Array(J + K).fill(0);
    for (let j = 0; j < J; j++) row[j] = candidates[j][k] * tau_p;
    row[J + k] = 1;
    Amat.push(row);
    bvec.push(s1.h[k]);
  }
  {
    const row = new Array(J + K).fill(0);
    for (let j = 0; j < J; j++) row[j] = 1;
    Amat.push(row);
    bvec.push(1);
  }
  const cvec = new Array(J + K).fill(0);
  for (let k = 0; k < K; k++) cvec[J + k] = 1;

  const sol = twoPhaseSimplex(Amat, bvec, cvec);
  const sArr = sol.x.slice(0, J);
  const epsArr = sol.x.slice(J, J + K);
  const gap = epsArr.reduce((a, b) => a + b, 0);

  return {
    candidates, s: sArr, eps: epsArr, gap,
    lambda: sol.duals.slice(0, K), nu: sol.duals[K],
    feasible: sol.feasible, mStar
  };
}

/* ============================================================
   Stage 3 — per-barrier sortie distribution, randomised phase
   allocation, and greedy round-robin aircraft assignment
   ============================================================ */

function buildPlan(p, d, mVec) {
  const K = p.K, tau_p = p.tau_p;
  const barrierSchedules = [];
  const events = [];

  for (let k = 0; k < K; k++) {
    const nk = p.n[k];
    const mk = mVec[k];
    const base = Math.floor(mk / nk);
    const rem = mk - base * nk;
    for (let i = 0; i < nk; i++) {
      const q = base + (i < rem ? 1 : 0);
      let delta = null, phi = 0, prob = 0;
      const departures = [];
      if (q > 0) {
        delta = d.T / q;
        prob = Math.min(1, (d.W * q) / d.T);
        const span = delta - d.W;
        phi = span > 1e-9 ? Math.random() * span : 0;
        for (let jdx = 0; ; jdx++) {
          const t = phi + jdx * delta;
          if (t >= d.T - 1e-9) break;
          departures.push(t);
          events.push({ type: k, barrierIdx: i, start: t, end: t + tau_p, safeUntil: t + d.W });
        }
      }
      barrierSchedules.push({ type: k, barrierIdx: i, q, delta, prob, phi, departures });
    }
  }
  events.sort((a, b) => a.start - b.start);

  const aircraft = Array.from({ length: p.N }, () => ({ nextStart: -Infinity, hours: 0, count: 0 }));
  let pointer = 0, unassigned = 0;
  events.forEach(ev => {
    let chosen = -1;
    for (let step = 0; step < p.N; step++) {
      const idx = (pointer + step) % p.N;
      const ac = aircraft[idx];
      if (ev.start + 1e-9 >= ac.nextStart && ac.hours + tau_p <= p.F + 1e-9) { chosen = idx; break; }
    }
    if (chosen === -1) { ev.aircraft = null; unassigned++; return; }
    const ac = aircraft[chosen];
    ac.nextStart = ev.start + d.G;
    ac.hours += tau_p;
    ac.count += 1;
    ev.aircraft = chosen;
    pointer = (chosen + 1) % p.N;
  });

  return { barrierSchedules, events, aircraft, unassigned, totalSorties: events.length };
}

function stage3(p, d, s1, s2) {
  if (!s2.feasible) return { plans: [] };
  const plans = [];
  s2.candidates.forEach((mVec, j) => {
    const prob = s2.s[j];
    if (prob > 1e-6) plans.push({ label: String.fromCharCode(65 + plans.length), prob, mVec, plan: buildPlan(p, d, mVec) });
  });
  return { plans };
}

/* ============================================================
   Minimum fleet size (Section 8)
   ============================================================ */

function minimumFleetSize(p, d) {
  const Nmin = th => Math.ceil((th * d.T * d.Nb) / (d.mu * p.F));
  return { half: Nmin(0.5), full: Nmin(1), custom: Nmin(p.theta), theta: p.theta };
}

/* ============================================================
   Baseline patrol policies (Section 12), generalised to any K
   ============================================================ */

function baselines(p, d) {
  const K = p.K, Nsrt = d.N_srt, tau_p = p.tau_p, mu = d.mu, T = d.T;
  const n = p.n, v = p.v;

  function coverageUtil(hArr) {
    const P = [], U = [];
    for (let k = 0; k < K; k++) {
      P[k] = (mu * hArr[k]) / (n[k] * T);
      U[k] = v[k] * (2 * P[k] - 1);
    }
    return { P, U, game: Math.min(...U) };
  }

  const Nb = d.Nb;
  const base = Math.floor(Nsrt / Nb);
  let remaining = Nsrt - base * Nb;
  // The "extra" barrier-sorties left over after an equal per-barrier split are handed out
  // round-robin across types (one extra barrier per type per pass), matching the paper's
  // own description in §12.1/§12.2 ("assigning one extra sortie to each type").
  const extraPerType = new Array(K).fill(0);
  let t = 0, guard = 0;
  while (remaining > 0 && guard < 10 * Nb) {
    guard++;
    if (extraPerType[t] < n[t]) { extraPerType[t]++; remaining--; }
    t = (t + 1) % K;
  }
  const sortiesFixed = n.map((nk, k) => nk * base + extraPerType[k]);
  const hFixed = sortiesFixed.map(m => m * tau_p);
  const Ufixed = v.map(vk => -vk); // predictable clock => attacker always strikes with P_k = 0
  const fixedResult = { h: hFixed, P: hFixed.map((h, k) => (mu * h) / (n[k] * T)), U: Ufixed, game: Math.min(...Ufixed) };
  const uniformCov = coverageUtil(hFixed);
  const uniformResult = { h: hFixed, P: uniformCov.P, U: uniformCov.U, game: uniformCov.game };

  const weight = n.map((nk, k) => nk * v[k]);
  const totalWeight = weight.reduce((a, b) => a + b, 0);
  const mVp = new Array(K).fill(0);
  let assigned = 0;
  for (let k = 0; k < K - 1; k++) { mVp[k] = Math.floor((Nsrt * weight[k]) / totalWeight); assigned += mVp[k]; }
  mVp[K - 1] = Nsrt - assigned;
  const hVp = mVp.map(m => m * tau_p);
  const vpCov = coverageUtil(hVp);
  const vpResult = { h: hVp, P: vpCov.P, U: vpCov.U, game: vpCov.game };

  const order = v.map((_, k) => k).sort((a, b) => v[b] - v[a]);
  let budget = d.B_eff;
  const hGreedy = new Array(K).fill(0);
  order.forEach(k => {
    const fullCover = (n[k] * T) / mu;
    if (budget >= fullCover) { hGreedy[k] = fullCover; budget -= fullCover; }
    else { hGreedy[k] = Math.max(0, budget); budget = 0; }
  });
  const greedyCov = coverageUtil(hGreedy);
  const greedyResult = { h: hGreedy, P: greedyCov.P, U: greedyCov.U, game: greedyCov.game };

  return { fixed: fixedResult, uniform: uniformResult, valueProportional: vpResult, greedy: greedyResult };
}

/* ============================================================
   Rendering
   ============================================================ */

function renderDerived(p, d) {
  document.getElementById('derivedOutput').innerHTML = `
    <div class="kv-grid">
      <div><b>Protection window W</b>${fmt(d.W)} h</div>
      <div><b>Window multiplier &mu;</b>${fmt(d.mu)}</div>
      <div><b>Min. gap between sorties G</b>${fmt(d.G)} h</div>
      <div><b>Planning horizon T</b>${fmt(d.T, 0)} h (${p.T_days} days)</div>
      <div><b>Total fleet flying hours B</b>${fmt(d.B)} h</div>
      <div><b>Max integer sorties N<sub>srt</sub></b>${d.N_srt}</div>
      <div><b>Integer-feasible budget B<sub>eff</sub></b>${fmt(d.B_eff)} h</div>
      <div><b>Total barriers N<sub>b</sub></b>${d.Nb}</div>
    </div>`;
}

function renderStage1(p, s1) {
  const el = document.getElementById('stage1Output');
  if (!s1.feasible) {
    el.innerHTML = `<p class="error">No barrier type is defendable with the current fleet — every type became inactive. Increase N or F, or reduce barrier counts/values.</p>`;
    return;
  }
  let rows = '';
  for (let k = 0; k < p.K; k++) {
    const isActive = s1.active.includes(k);
    rows += `<tr>
      <td>Type ${k + 1}</td>
      <td>${p.n[k]}</td>
      <td>${p.v[k]}</td>
      <td>${isActive ? fmt(s1.d[k]) : '—'}</td>
      <td>${isActive ? '<span class="pill pill-active">active</span>' : '<span class="pill pill-inactive">inactive</span>'}</td>
      <td>${fmt(s1.h[k])}</td>
      <td>${fmt(s1.h[k] / p.tau_p)}</td>
      <td>${fmt(s1.P[k] * 100)}%</td>
      <td>${fmt(s1.U[k])}</td>
    </tr>`;
  }
  const logHtml = s1.log.length ? `<ul class="log-list">${s1.log.map(l => `<li>${l}</li>`).join('')}</ul>` : '';
  el.innerHTML = `
    <div class="game-value">Game value z* = ${fmt(s1.z, 4)}
      ${s1.z > 0 ? '<span class="ok">(defender net gain)</span>' : s1.z < 0 ? '<span class="warn">(defender net loss overall, but still worst-case optimal)</span>' : ''}
    </div>
    ${logHtml}
    <table>
      <thead><tr><th>Type</th><th>n<sub>k</sub></th><th>v<sub>k</sub></th><th>d<sub>k</sub></th><th>Status</th>
      <th>h<sub>k</sub>* (hrs)</th><th>m<sub>k</sub>* (sorties)</th><th>P<sub>k</sub>*</th><th>U<sub>d</sub>(k)</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderStage2(p, s2) {
  const el = document.getElementById('stage2Output');
  if (!s2.feasible || s2.candidates.length === 0) {
    el.innerHTML = `<p class="error">Stage 2 could not find a feasible mix${s2.note ? ' (' + s2.note + ').' : '.'}</p>`;
    return;
  }
  let header = '<th>Plan</th>';
  for (let k = 0; k < p.K; k++) header += `<th>m<sub>${k + 1}</sub> (sorties)</th>`;
  header += '<th>Hours used</th><th>Mixing probability s<sub>j</sub></th>';

  let rows = '', label = 0;
  s2.candidates.forEach((m, j) => {
    if (s2.s[j] < 1e-6) return;
    const hoursUsed = m.reduce((a, b) => a + b, 0) * p.tau_p;
    let cells = `<td>Plan ${String.fromCharCode(65 + label)}</td>`;
    m.forEach(mk => { cells += `<td>${mk}</td>`; });
    cells += `<td>${fmt(hoursUsed)}</td><td>${fmt(s2.s[j], 4)}</td>`;
    rows += `<tr>${cells}</tr>`;
    label++;
  });

  const gapOk = s2.gap < 1e-5;
  const lambdaRow = p.K <= 8
    ? `<p class="muted small">Dual signal &lambda;<sub>k</sub> (marginal coverage value; complementary slackness forces &lambda;<sub>k</sub> ≤ 1 once the gap is zero): ${s2.lambda.map((l, k) => `&lambda;<sub>${k + 1}</sub>=${fmt(l, 3)}`).join(', ')}</p>`
    : '';

  el.innerHTML = `
    <p>${s2.candidates.length} candidate integer schedules were generated by rounding each fractional sortie target m<sub>k</sub>* to its
    floor/ceiling (Section 6.4); the feasibility LP (eq. 9) was solved with a two-phase simplex to reproduce h* exactly as a convex mix.</p>
    <table><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table>
    <p>Total coverage gap &Sigma;&epsilon;<sub>k</sub> = ${fmt(s2.gap, 6)}
       ${gapOk ? '<span class="ok">✓ zero gap — h* achieved exactly as a convex combination</span>' : '<span class="warn">⚠ residual gap</span>'}</p>
    ${lambdaRow}
    <p class="muted small">Operational prescription: at the start of each ${p.T_days}-day cycle, draw a random number and execute whichever plan's probability interval it falls into.</p>`;
}

function renderStage3(p, d, s3) {
  const el = document.getElementById('stage3Output');
  if (!s3.plans || s3.plans.length === 0) {
    el.innerHTML = `<p class="error">No plan to schedule (Stage 2 was infeasible).</p>`;
    return;
  }
  let html = '';
  s3.plans.forEach(({ label, prob, plan }) => {
    const bsRows = plan.barrierSchedules.map(bs => {
      const shown = bs.departures.slice(0, 4).map(t => fmtDayTime(t)).join('; ');
      const more = bs.departures.length > 4 ? ` … (+${bs.departures.length - 4} more)` : '';
      return `<tr>
        <td>Type ${bs.type + 1}</td><td>Barrier ${bs.barrierIdx + 1}</td>
        <td>${bs.q}</td>
        <td>${bs.delta ? fmt(bs.delta) + ' h' : '—'}</td>
        <td>${bs.q > 0 ? fmt(bs.prob * 100) + '%' : '<span class="warn">0% (unpatrolled this plan)</span>'}</td>
        <td>${bs.q > 0 ? fmt(bs.phi) + ' h' : '—'}</td>
        <td>${bs.departures.length ? shown + more : '—'}</td>
      </tr>`;
    }).join('');

    const windowEvents = plan.events.slice(0, 30);
    const evRows = windowEvents.map(ev => `<tr>
        <td>${ev.aircraft !== null ? 'AC-' + (ev.aircraft + 1) : '<span class="error">UNASSIGNED</span>'}</td>
        <td>Type ${ev.type + 1} / Barrier ${ev.barrierIdx + 1}</td>
        <td>${fmtDayTime(ev.start)}</td>
        <td>${fmtDayTime(ev.safeUntil)}</td>
      </tr>`).join('');

    const hoursArr = plan.aircraft.map(a => a.hours);
    const minH = Math.min(...hoursArr), maxH = Math.max(...hoursArr);
    const avgH = hoursArr.reduce((a, b) => a + b, 0) / hoursArr.length;

    html += `
      <div class="plan-block">
        <h3>Plan ${label} — mixing probability ${fmt(prob, 4)}</h3>
        <h4>Per-barrier schedule</h4>
        <table><thead><tr><th>Type</th><th>Barrier</th><th>Sorties q<sub>i</sub></th><th>Interval &Delta;<sub>i</sub></th>
        <th>Coverage p<sub>i</sub></th><th>Phase &phi;<sub>i</sub></th><th>First departures (illustrative)</th></tr></thead>
        <tbody>${bsRows}</tbody></table>

        <h4>Aircraft timetable (first ${windowEvents.length} of ${plan.totalSorties} sorties in the period)</h4>
        <table><thead><tr><th>Aircraft</th><th>Barrier</th><th>Depart</th><th>Safe until</th></tr></thead>
        <tbody>${evRows}</tbody></table>

        <p class="muted small">Fleet utilisation over the full ${fmt(d.T, 0)} h period — hours flown per aircraft: min ${fmt(minH)}, max ${fmt(maxH)}, avg ${fmt(avgH)} (budget F = ${p.F} h).
        ${plan.unassigned > 0
          ? `<span class="error">${plan.unassigned} sorties could not be assigned to any aircraft — the fleet is too small for this plan; see Section 6 (Minimum Fleet Size).</span>`
          : '<span class="ok">All sorties successfully assigned within the gap and budget constraints.</span>'}</p>

        <h4>Gantt chart &mdash; who flies when (first ${Math.min(GANTT_DAYS, p.T_days)} days)</h4>
        ${planGanttSvg(p, d, plan)}
      </div>`;
  });
  el.innerHTML = html;
}

function renderFleetSize(p, fs) {
  const row = (label, val) => `<tr><td>${label}</td><td>${val}</td><td>${
    p.N >= val
      ? `<span class="ok">✓ current fleet (N=${p.N}) meets this</span>`
      : `<span class="error">✗ current fleet (N=${p.N}) is below this — need ${val - p.N} more aircraft</span>`
  }</td></tr>`;
  document.getElementById('fleetSizeOutput').innerHTML = `
    <table><thead><tr><th>Threshold</th><th>N<sub>min</sub></th><th>Current fleet</th></tr></thead>
    <tbody>
      ${row('&theta; = 0.5 (zero expected loss)', fs.half)}
      ${row('&theta; = 1.0 (guaranteed full coverage)', fs.full)}
      ${row(`&theta; = ${fmt(fs.theta, 2)} (your custom threshold)`, fs.custom)}
    </tbody></table>`;
}

function renderBaselines(p, s1, bl) {
  const el = document.getElementById('baselineOutput');
  const rowsDef = [
    ['Fixed Deterministic', bl.fixed, 'Equal sorties per barrier, fixed clock — an observant attacker learns the timing and always strikes right after a patrol (P_k treated as 0).'],
    ['Uniform Random', bl.uniform, 'Equal sorties per barrier, randomised start times, no value-weighting.'],
    ['Value-Proportional', bl.valueProportional, 'Sorties allocated in proportion to aggregate barrier value n_k·v_k.'],
    ['Greedy (Highest-Value First)', bl.greedy, 'Fully covers the highest-value types first; low-value types may end up unpatrolled.'],
    ['Stackelberg Optimal', { h: s1.h, U: s1.U, game: s1.z }, "This tool's Stage-1 solution — worst-case optimal by Theorem 1."]
  ];

  let header = '<th>Policy</th>';
  for (let k = 0; k < p.K; k++) header += `<th>h<sub>${k + 1}</sub></th>`;
  for (let k = 0; k < p.K; k++) header += `<th>U<sub>d</sub>(${k + 1})</th>`;
  header += '<th>Game value</th>';

  let best = -Infinity, bestName = '';
  rowsDef.forEach(([name, r]) => { if (r.game > best) { best = r.game; bestName = name; } });

  const rows = rowsDef.map(([name, r]) => {
    let cells = `<td>${name}${name === 'Stackelberg Optimal' ? ' <strong>(this tool)</strong>' : ''}</td>`;
    p.n.forEach((_, k) => { cells += `<td>${fmt(r.h[k])}</td>`; });
    p.n.forEach((_, k) => { cells += `<td>${fmt(r.U[k])}</td>`; });
    const gameCell = name === bestName ? `<strong>${fmt(r.game)}</strong>` : fmt(r.game);
    cells += `<td>${gameCell}</td>`;
    return `<tr>${cells}</tr>`;
  }).join('');

  el.innerHTML = `
    <table><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table>
    <p class="muted small">Game value = min<sub>k</sub> U<sub>d</sub>(k): the defender's expected payoff once the attacker best-responds.
    The Stackelberg-optimal policy achieves the highest game value by construction (every barrier type is equally attractive to the
    attacker, so there is no single weak point left to exploit).</p>
    <ul class="log-list">${rowsDef.map(([name, , desc]) => `<li><b>${name}:</b> ${desc}</li>`).join('')}</ul>`;
}

/* ============================================================
   Visuals — icon view of the Stage-1 allocation and an animated
   playback of a Stage-3 plan over the whole period (1 s = 1 h)
   ============================================================ */

const TYPE_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const typeColor = k => TYPE_COLORS[k] || `hsl(${(k * 47) % 360}, 60%, 45%)`;

const PLANE_PATH = 'M12 0 L4 -2 L-2 -9 L-5 -9 L-2 -2 L-8 -2 L-10 -5 L-12 -5 L-11 0 L-12 5 L-10 5 L-8 2 L-2 2 L-5 9 L-2 9 L4 2 Z';
const SHIELD_PATH = 'M0 -13 L11 -9 L11 0 C11 7 6 11 0 14 C-6 11 -11 7 -11 0 L-11 -9 Z';

function renderAllocationVisual(p, d, s1) {
  const el = document.getElementById('stage1Visual');
  if (!s1.feasible) { el.innerHTML = ''; return; }

  // Fleet strip: split the N aircraft across types in proportion to h_k* (largest remainder).
  const share = s1.h.map(h => (d.B_eff > 0 ? (p.N * h) / d.B_eff : 0));
  const planes = share.map(Math.floor);
  let left = p.N - planes.reduce((a, b) => a + b, 0);
  share.map((x, k) => [x - Math.floor(x), k]).sort((a, b) => b[0] - a[0]).forEach(([, k]) => { if (left > 0) { planes[k]++; left--; } });

  const W = 760, perRow = 19, cell = 38;
  const fleetRows = Math.ceil(p.N / perRow);
  let svg = '', y = 10;
  svg += `<text x="0" y="${y + 12}" font-size="13" font-weight="600">Fleet: ${p.N} aircraft, coloured by the share of flying hours each type receives (h_k* / B_eff)</text>`;
  y += 26;
  let idx = 0;
  planes.forEach((cnt, k) => {
    for (let c = 0; c < cnt; c++, idx++) {
      const x = 20 + (idx % perRow) * cell, yy = y + Math.floor(idx / perRow) * 34 + 12;
      svg += `<g transform="translate(${x},${yy}) rotate(-90)"><path d="${PLANE_PATH}" fill="${typeColor(k)}"><title>Aircraft-equivalent of Type ${k + 1} flying hours</title></path></g>`;
    }
  });
  y += fleetRows * 34 + 18;

  // One row of shield icons per barrier type, each filled up to P_k.
  const shieldsPerRow = 11;
  for (let k = 0; k < p.K; k++) {
    const active = s1.active.includes(k);
    const Pk = Math.min(1, Math.max(0, s1.P[k]));
    svg += `<text x="0" y="${y + 12}" font-size="13" font-weight="600" fill="${typeColor(k)}">Type ${k + 1}</text>`;
    svg += `<text x="70" y="${y + 12}" font-size="12">n = ${p.n[k]}, v = ${p.v[k]} · h* = ${fmt(s1.h[k], 1)} h (${fmt(s1.h[k] / p.tau_p, 1)} sorties) · ≈ ${planes[k]} aircraft · each barrier defended <tspan font-weight="700">${fmt(Pk * 100, 1)}%</tspan> of the time${active ? '' : ' — inactive'}</text>`;
    y += 22;
    const rows = Math.ceil(p.n[k] / shieldsPerRow);
    for (let i = 0; i < p.n[k]; i++) {
      const cx = 30 + (i % shieldsPerRow) * 66, cy = y + Math.floor(i / shieldsPerRow) * 62 + 20;
      const clipId = `shc-${k}-${i}`;
      const fillTop = 14 - 27 * Pk;
      svg += `<g transform="translate(${cx},${cy}) scale(1.35)">
        <clipPath id="${clipId}"><rect x="-12" y="${fillTop}" width="24" height="${27 * Pk}"/></clipPath>
        <path d="${SHIELD_PATH}" fill="#f2f2f2" stroke="${active ? typeColor(k) : '#b00020'}" stroke-width="1.6"/>
        <path d="${SHIELD_PATH}" fill="${typeColor(k)}" clip-path="url(#${clipId})"/>
        <title>Type ${k + 1}, barrier ${i + 1}: P = ${fmt(Pk * 100, 1)}%</title></g>
        <text x="${cx}" y="${cy + 32}" font-size="11" text-anchor="middle">B${i + 1} · ${fmt(Pk * 100, 0)}%</text>`;
    }
    y += rows * 62 + 14;
  }

  el.innerHTML = `<div style="overflow-x:auto"><svg viewBox="0 0 ${W} ${y}" width="100%" style="min-width:640px;font-family:inherit" role="img" aria-label="Fleet and barrier coverage icons">${svg}</svg></div>
    <p class="muted small">Each shield is one barrier; the coloured fill is its coverage probability P<sub>k</sub> = &mu;h<sub>k</sub>/(n<sub>k</sub>T).
    The aircraft colours show how the fleet's total flying hours are split between types (an equivalent count — in Stage 3 every aircraft flies sorties for several types).</p>`;
}

/* ---------------- Sankey of flying hours and 100-dot icon array ---------------- */

// Up to 5 barrier types get their own colour; with more than 5 the new charts go black and white.
const MAX_COLOUR_TYPES = 5;
const vizColor = (k, K) => (K > MAX_COLOUR_TYPES ? '#1a1a1a' : typeColor(k));
const bwNote = K => (K > MAX_COLOUR_TYPES ? ` More than ${MAX_COLOUR_TYPES} barrier types, so this chart is drawn in black and white; read the type from the labels.` : '');

function renderSankey(p, d, s1) {
  const el = document.getElementById('stage1Sankey');
  if (!s1.feasible || !(d.B > 0)) { el.innerHTML = ''; return; }

  const K = p.K, nw = 14, top = 10, cols = [0, 200, 410, 620], W = 780;
  const loss = d.B - d.B_eff;
  // Vertical scale: grows with the number of barriers so the last column stays readable.
  const scale = Math.max(260, d.Nb * 16) / d.B;
  const minStep = [0, 20, 20, 15]; // minimum vertical slot per node so labels never overlap
  const gaps = [0, 12, 16, 4];

  const nodes = [];
  const add = (col, label, val, color, tipText) => { nodes.push({ col, label, val, color, tipText, h: Math.max(1.5, val * scale) }); return nodes.length - 1; };
  const nB = add(0, `Fleet hours B = ${fmt(d.B, 0)} h`, d.B, '#666', `N × F = ${p.N} × ${p.F}`);
  const nE = add(1, `Usable B_eff = ${fmt(d.B_eff, 0)} h`, d.B_eff, 'var(--accent)', `${d.N_srt} whole sorties × ${p.tau_p} h`);
  const nL = loss > 1e-9 ? add(1, `Rounding loss ${fmt(loss, 1)} h`, loss, 'var(--error)', 'Hours that do not make a whole sortie') : null;
  const nT = [], nBar = [];
  for (let k = 0; k < K; k++) {
    const active = s1.active.includes(k);
    nT.push(add(2, `Type ${k + 1}: ${fmt(s1.h[k], 1)} h${active ? '' : ' (inactive)'}`, s1.h[k], vizColor(k, K),
      `h${k + 1}* = ${fmt(s1.h[k], 2)} h = ${fmt(s1.h[k] / p.tau_p, 2)} sorties`));
  }
  for (let k = 0; k < K; k++) {
    const per = s1.h[k] / p.n[k];
    for (let i = 0; i < p.n[k]; i++) nBar.push({ k, idx: add(3, `T${k + 1}·B${i + 1}: ${fmt(per, 1)} h`, per, vizColor(k, K), `Type ${k + 1}, barrier ${i + 1}: ${fmt(per, 2)} h`) });
  }

  let H = 0;
  [0, 1, 2, 3].forEach(c => {
    let y = top;
    nodes.filter(n => n.col === c).forEach(n => { n.y = y; n.inO = 0; n.outO = 0; y += Math.max(n.h + gaps[c], minStep[c]); });
    H = Math.max(H, y);
  });
  H += 10;

  const links = [[nB, nE, d.B_eff, 'var(--accent)']];
  if (nL !== null) links.push([nB, nL, loss, 'var(--error)']);
  for (let k = 0; k < K; k++) links.push([nE, nT[k], s1.h[k], vizColor(k, K)]);
  nBar.forEach(({ k, idx }) => links.push([nT[k], idx, s1.h[k] / p.n[k], vizColor(k, K)]));

  let svg = '';
  links.forEach(([s, t, v, c]) => {
    if (!(v > 1e-9)) return;
    const S = nodes[s], Tn = nodes[t], w = Math.max(1, v * scale);
    const x0 = cols[S.col] + nw, x1 = cols[Tn.col], y0 = S.y + S.outO, y1 = Tn.y + Tn.inO, xm = (x0 + x1) / 2;
    S.outO += w; Tn.inO += w;
    svg += `<path d="M${x0},${y0} C${xm},${y0} ${xm},${y1} ${x1},${y1} L${x1},${y1 + w} C${xm},${y1 + w} ${xm},${y0 + w} ${x0},${y0 + w} Z" fill="${c}" fill-opacity="0.25"><title>${fmt(v, 2)} flying hours</title></path>`;
  });
  nodes.forEach(n => {
    svg += `<rect x="${cols[n.col]}" y="${n.y}" width="${nw}" height="${n.h}" fill="${n.color}" rx="2"><title>${n.tipText}</title></rect>`;
    svg += `<text x="${cols[n.col] + nw + 6}" y="${n.y + Math.min(n.h, 20) / 2 + 4}" font-size="${n.col === 3 ? 11 : 12}" font-weight="${n.col === 3 ? 400 : 600}" stroke="#fff" stroke-width="3" paint-order="stroke">${n.label}</text>`;
  });

  el.innerHTML = `<div style="overflow-x:auto"><svg viewBox="0 0 ${W} ${H}" width="100%" style="min-width:640px;font-family:inherit" role="img" aria-label="Sankey diagram of flying hours from fleet budget to individual barriers">${svg}</svg></div>
    <p class="muted small">Left to right: the fleet's total flying hours B, the part usable as whole sorties B<sub>eff</sub>, the Stage-1 split h<sub>k</sub>* across barrier types,
    and each type's hours shared equally among its n<sub>k</sub> barriers. Band widths are proportional to hours, so every split adds up. Hover a band or bar for exact values.${bwNote(K)}</p>`;
}

let iconArrayPolicy = 'Stackelberg Optimal';

function renderIconArray(p, d, s1, bl) {
  const el = document.getElementById('baselineIconArray');
  const K = p.K;
  const policies = [
    ['Uniform Random', bl.uniform.h],
    ['Value-Proportional', bl.valueProportional.h],
    ['Greedy (Highest-Value First)', bl.greedy.h],
    ['Stackelberg Optimal', s1.h]
  ];
  if (!policies.some(([name]) => name === iconArrayPolicy)) iconArrayPolicy = 'Stackelberg Optimal';

  const draw = () => {
    const h = policies.find(([name]) => name === iconArrayPolicy)[1];
    const P = h.map((hk, k) => Math.min(1, Math.max(0, (d.mu * hk) / (p.n[k] * d.T))));
    const cell = 18, grid = 10 * cell, colW = grid + 70, perRow = 3, W = 20 + perRow * colW, blockH = grid + 44;
    let svg = '';
    for (let k = 0; k < K; k++) {
      const ox = 20 + (k % perRow) * colW, oy = Math.floor(k / perRow) * blockH;
      const filled = Math.round(P[k] * 100), c = vizColor(k, K);
      svg += `<text x="${ox}" y="${oy + 16}" font-size="13" font-weight="600" fill="${c}">Type ${k + 1}: ${filled} of 100</text>`;
      for (let i = 0; i < 100; i++) {
        const x = ox + (i % 10) * cell + cell / 2, y = oy + 30 + Math.floor(i / 10) * cell;
        svg += `<circle cx="${x}" cy="${y}" r="6.5" fill="${i < filled ? c : 'none'}" stroke="${c}" stroke-width="1.3"/>`;
      }
    }
    const H = Math.ceil(K / perRow) * blockH;
    el.querySelector('.ia-out').innerHTML = `<div style="overflow-x:auto"><svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px;min-width:420px;font-family:inherit" role="img" aria-label="Icon array of barrier coverage under ${iconArrayPolicy}">${svg}</svg></div>
      <p class="muted small">Pick a policy above. Each grid is one barrier of that type watched at 100 random moments in the period:
      a filled dot means an aircraft is protecting it at that moment, a hollow dot means an attack then would succeed (P<sub>k</sub> = &mu;h<sub>k</sub>/(n<sub>k</sub>T), capped at 100).
      Fixed Deterministic is left out because an observant attacker always finds it unprotected (0 of 100).${bwNote(K)}</p>`;
    el.querySelectorAll('.seg button').forEach(b => b.classList.toggle('on', b.dataset.policy === iconArrayPolicy));
  };

  el.innerHTML = `<div class="seg">${policies.map(([name]) => `<button type="button" data-policy="${name}">${name}</button>`).join('')}</div><div class="ia-out"></div>`;
  el.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => { iconArrayPolicy = b.dataset.policy; draw(); }));
  draw();
}

/* ---------------- Shared helpers for the extra charts ---------------- */

const GANTT_DAYS = 10; // window shown by the Gantt charts; set to 30 (or more) to show the whole period

function mixRGB(a, b, t) { t = Math.max(0, Math.min(1, t)); return `rgb(${a.map((x, i) => Math.round(x + (b[i] - x) * t)).join(',')})`; }
const HM_RED = [214, 69, 69], HM_MID = [214, 216, 222], HM_BLUE = [42, 120, 214], SEQ_LO = [236, 241, 250], SEQ_HI = [20, 70, 150];
const divergeColor = (x, m) => (x < 0 ? mixRGB(HM_MID, HM_RED, -x / m) : mixRGB(HM_MID, HM_BLUE, x / m));
const seqColor = t => mixRGB(SEQ_LO, SEQ_HI, t);
const legendHtml = items => `<div class="legend">${items.map(([c, l]) => `<span><i style="background:${c}"></i>${l}</span>`).join('')}</div>`;
const typeLegend = p => (p.K > MAX_COLOUR_TYPES ? '' : legendHtml(p.n.map((_, k) => [vizColor(k, p.K), `Type ${k + 1} (n = ${p.n[k]}, v = ${p.v[k]})`])));
const sgnFmt = (x, dec = 2) => (x > 0.5 * 10 ** -dec ? '+' : '') + fmt(x, dec);
const hhmm = t => { const m = Math.round(t * 60); return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
const barrierOffsets = p => p.n.map((_, k) => p.n.slice(0, k).reduce((a, b) => a + b, 0));
const svgBox = (W, H, body, label, minW = 640) => `<div style="overflow-x:auto"><svg viewBox="0 0 ${W} ${H}" width="100%" style="min-width:${minW}px;font-family:inherit" role="img" aria-label="${label}">${body}</svg></div>`;
// Plan weights normalised to sum to 1 (the LP can leave a tiny numerical remainder).
const planWeights = plans => { const t = plans.reduce((s, x) => s + x.prob, 0) || 1; return plans.map(x => x.prob / t); };

// Fraction of each time bin during which each barrier is protected (aircraft overhead or safe
// period) in one plan. Only sorties that got an aircraft count. Returns one array per barrier.
function coverageBins(p, d, plan, binH) {
  const nBins = Math.ceil(d.T / binH - 1e-9), off = barrierOffsets(p);
  const cov = Array.from({ length: d.Nb }, () => new Float64Array(nBins));
  plan.events.forEach(ev => {
    if (ev.aircraft === null) return;
    const b = off[ev.type] + ev.barrierIdx, end = Math.min(d.T, ev.safeUntil);
    for (let i = Math.floor(ev.start / binH); i < nBins && i * binH < end; i++) {
      const o = Math.min(end, (i + 1) * binH) - Math.max(ev.start, i * binH);
      if (o > 0) cov[b][i] += o / binH;
    }
  });
  cov.forEach(a => { for (let i = 0; i < a.length; i++) if (a[i] > 1) a[i] = 1; });
  return cov;
}

/* ---------------- Treemap (end of Stage 1) ---------------- */

let treemapMode = 'value';

function renderTreemap(p, d, s1) {
  const el = document.getElementById('stage1Treemap');
  if (!s1.feasible) { el.innerHTML = ''; return; }
  const K = p.K;
  const draw = () => {
    const W = 760, H = 300;
    const items = [];
    for (let k = 0; k < K; k++) for (let i = 0; i < p.n[k]; i++) items.push({ k, i, w: treemapMode === 'value' ? p.v[k] : s1.h[k] / p.n[k] });
    const tot = items.reduce((s, t) => s + t.w, 0) || 1;
    let svg = '', x = 0;
    for (let k = 0; k < K; k++) {
      const its = items.filter(t => t.k === k), tw = its.reduce((s, t) => s + t.w, 0), cw = (tw / tot) * W;
      if (cw > 0.5) {
        let y = 0;
        its.forEach(t => {
          const h = (t.w / tw) * H;
          svg += `<rect x="${x + 1}" y="${y + 1}" width="${Math.max(0, cw - 2)}" height="${Math.max(0, h - 2)}" rx="3" fill="${vizColor(k, K)}" fill-opacity="${0.35 + 0.65 * Math.min(1, s1.P[k])}">
            <title>Type ${k + 1}, barrier ${t.i + 1}: value ${p.v[k]}, ${fmt(s1.h[k] / p.n[k], 1)} h, coverage ${fmt(s1.P[k] * 100, 1)}%</title></rect>`;
          if (cw > 44 && h > 22) svg += `<text x="${x + 8}" y="${y + 17}" font-size="12" font-weight="700" fill="#fff" pointer-events="none">T${k + 1}·B${t.i + 1}</text>`;
          if (cw > 44 && h > 38) svg += `<text x="${x + 8}" y="${y + 32}" font-size="10" fill="#fff" pointer-events="none">${treemapMode === 'value' ? `value ${p.v[k]}` : `${fmt(t.w, 0)} h`}</text>`;
          y += h;
        });
      }
      const label = cw > 90 ? `Type ${k + 1}: ${fmt((tw / tot) * 100, 0)}%` : cw > 30 ? `T${k + 1}` : '';
      if (label) svg += `<text x="${x + cw / 2}" y="${H + 18}" text-anchor="middle" font-size="12" font-weight="600">${label}</text>`;
      x += cw;
    }
    el.querySelector('.tm-out').innerHTML = svgBox(W, H + 26, svg, 'Treemap of barriers') +
      `<p class="muted small">Each rectangle is one barrier, grouped by type. Switch between area = military value v<sub>k</sub> and area = flying hours per barrier h<sub>k</sub>*/n<sub>k</sub>.
      Darker fill means higher coverage P<sub>k</sub>. The Stage-1 optimum does not spend hours in proportion to value: it spreads them by barrier count, so a high-value barrier gets roughly the hours of a low-value one.
      ${s1.active.length < K ? 'Inactive types get no hours, so they vanish in the hours view.' : ''}${bwNote(K)}</p>`;
    el.querySelectorAll('.seg button').forEach(b => b.classList.toggle('on', b.dataset.mode === treemapMode));
  };
  el.innerHTML = `<div class="seg"><button type="button" data-mode="value">Area = value at stake</button><button type="button" data-mode="hours">Area = flying hours received</button></div><div class="tm-out"></div>`;
  el.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => { treemapMode = b.dataset.mode; draw(); }));
  draw();
}

/* ---------------- Diverging heatmap (Stage 2) ---------------- */

function renderPayoffHeatmap(p, d, s1, s3) {
  const el = document.getElementById('stage2Heatmap');
  if (!s3.plans || !s3.plans.length) { el.innerHTML = ''; return; }
  const K = p.K;
  // Realised payoff if plan m is the month's plan and the attacker hits type k.
  const U = (k, m) => p.v[k] * (2 * Math.min(1, (d.mu * m * p.tau_p) / (p.n[k] * d.T)) - 1);
  const w = planWeights(s3.plans);
  const rows = s3.plans.map((pl, j) => ({ name: `Plan ${pl.label} (${pl.mVec.join(', ')}) · ${fmt(w[j] * 100, 1)}%`, u: p.n.map((_, k) => U(k, pl.mVec[k])) }));
  const mixed = p.n.map((_, k) => rows.reduce((s, r, j) => s + w[j] * r.u[k], 0));
  rows.push({ name: 'Mixed strategy (expected)', u: mixed, bold: true, gapBefore: true });
  for (let k = 0; k < K; k++) {
    const m = new Array(K).fill(0); m[k] = d.N_srt;
    rows.push({ name: `Canonical: all ${d.N_srt} sorties on Type ${k + 1}`, u: p.n.map((_, kk) => U(kk, m[kk])), gapBefore: k === 0 });
  }
  const vmax = Math.max(...p.v), x0 = 290, cw = Math.max(72, Math.min(120, 470 / (K + 1))), rh = 32;
  const W = x0 + (K + 1) * cw + 10;
  let svg = '';
  for (let c = 0; c <= K; c++) svg += `<text x="${x0 + c * cw + cw / 2}" y="18" text-anchor="middle" font-size="12" font-weight="600">${c < K ? `attack T${c + 1}` : 'worst case'}</text>`;
  let y = 28;
  rows.forEach(r => {
    if (r.gapBefore) y += 14;
    svg += `<text x="${x0 - 10}" y="${y + 19}" text-anchor="end" font-size="12" font-weight="${r.bold ? 700 : 400}">${r.name}</text>`;
    r.u.concat([Math.min(...r.u)]).forEach((u, c) => {
      svg += `<rect x="${x0 + c * cw + 2}" y="${y}" width="${cw - 4}" height="${rh - 4}" rx="4" fill="${divergeColor(u, vmax)}"><title>${r.name}, ${c < K ? 'attack Type ' + (c + 1) : 'worst case'}: ${sgnFmt(u)}</title></rect>
        <text x="${x0 + c * cw + cw / 2}" y="${y + 18}" text-anchor="middle" font-size="12" font-weight="${c === K ? 700 : 500}" fill="#111">${sgnFmt(u)}</text>`;
    });
    y += rh;
  });
  el.innerHTML = svgBox(W, y + 6, svg, 'Diverging heatmap of realised payoffs', 600) +
    legendHtml([[mixRGB(HM_MID, HM_RED, 1), 'defender loss'], [mixRGB(HM_MID, HM_BLUE, 0), 'about zero'], [mixRGB(HM_MID, HM_BLUE, 1), 'defender gain']]) +
    `<p class="muted small">Each cell is the defender's payoff U<sub>d</sub>(k) = v<sub>k</sub>(2P<sub>k</sub> &minus; 1) if that row's plan is the one flown this month and the attacker strikes that column's type.
    The floor/ceiling plans stay close to the Stage-1 value in every column, so whichever plan the coin picks, no type is badly exposed. The expected row equals z* = ${fmt(s1.z, 4)} for every active type.
    The canonical rows (all sorties on one type) are shown for contrast: they swing between large gains and large losses, and an attacker simply picks the red column.</p>`;
}

/* ---------------- Gantt charts (Stage 3) ---------------- */

// One plan: one row per aircraft, a bar per sortie, coloured by barrier type.
function planGanttSvg(p, d, plan) {
  const days = Math.min(GANTT_DAYS, p.T_days), win = days * 24, K = p.K;
  const unassigned = plan.events.filter(e => e.aircraft === null && e.start < win);
  const rows = p.N + (unassigned.length ? 1 : 0);
  const ml = 58, mr = 10, W = 960, rh = p.N > 40 ? 9 : 13, top = 22, H = top + rows * rh + 26;
  const sx = t => ml + (t / win) * (W - ml - mr);
  let svg = '';
  for (let dd = 0; dd <= days; dd++) {
    svg += `<line x1="${sx(dd * 24)}" x2="${sx(dd * 24)}" y1="${top - 4}" y2="${top + rows * rh}" stroke="#ccc"/>`;
    if (dd < days) svg += `<text x="${sx(dd * 24 + 12)}" y="${top - 8}" text-anchor="middle" font-size="11">Day ${dd + 1}</text>`;
  }
  for (let a = 0; a < p.N; a++) {
    const y = top + a * rh;
    if (rh >= 12 || a % 2 === 0) svg += `<text x="${ml - 6}" y="${y + rh - 3}" text-anchor="end" font-size="${rh >= 12 ? 10 : 8}">AC-${a + 1}</text>`;
    svg += `<rect x="${ml}" y="${y + 1}" width="${W - ml - mr}" height="${rh - 2}" fill="#f4f4f6"/>`;
  }
  plan.events.forEach(e => {
    if (e.start >= win) return;
    const row = e.aircraft === null ? p.N : e.aircraft, y = top + row * rh;
    const fill = e.aircraft === null ? 'none' : vizColor(e.type, K), stroke = e.aircraft === null ? 'var(--error)' : 'none';
    svg += `<rect x="${sx(e.start)}" y="${y + 1}" width="${Math.max(1.5, sx(Math.min(win, e.end)) - sx(e.start))}" height="${rh - 2}" rx="1.5" fill="${fill}" stroke="${stroke}">
      <title>${e.aircraft === null ? 'UNASSIGNED' : 'AC-' + (e.aircraft + 1)} → Type ${e.type + 1} / Barrier ${e.barrierIdx + 1}, ${fmtDayTime(e.start)} – ${hhmm(e.end)}</title></rect>`;
  });
  if (unassigned.length) svg += `<text x="${ml - 6}" y="${top + p.N * rh + rh - 3}" text-anchor="end" font-size="10" fill="var(--error)">none</text>`;
  svg += `<text x="${(ml + W - mr) / 2}" y="${H - 6}" text-anchor="middle" font-size="11">Time (first ${days} days of the ${p.T_days}-day period)</text>`;
  return svgBox(W, H, svg, 'Gantt chart of aircraft sorties', 760) + typeLegend(p) +
    `<p class="muted small">One row per aircraft; each bar is a ${p.tau_p} h sortie, coloured by the barrier type it patrols. Hover a bar for details.
    ${unassigned.length ? `<span class="error">Red outlines in the last row are sorties no aircraft could fly.</span>` : ''}${bwNote(K)}</p>`;
}

// All plans together: one group of lanes per barrier, one lane per plan.
function renderMixGantt(p, d, s3) {
  const el = document.getElementById('mixGantt');
  if (!s3.plans || !s3.plans.length) { el.innerHTML = ''; return; }
  const days = Math.min(GANTT_DAYS, p.T_days), win = days * 24, K = p.K, J = s3.plans.length, w = planWeights(s3.plans);
  const lane = J * d.Nb > 120 ? 7 : 10, groupGap = 5, ml = 130, mr = 10, W = 960, top = 22;
  const H = top + d.Nb * (J * lane + groupGap) + 26;
  const sx = t => ml + (t / win) * (W - ml - mr);
  const off = barrierOffsets(p);
  const groupY = b => top + b * (J * lane + groupGap);
  let svg = '';
  for (let dd = 0; dd <= days; dd++) {
    svg += `<line x1="${sx(dd * 24)}" x2="${sx(dd * 24)}" y1="${top - 4}" y2="${H - 26}" stroke="#ccc"/>`;
    if (dd < days) svg += `<text x="${sx(dd * 24 + 12)}" y="${top - 8}" text-anchor="middle" font-size="11">Day ${dd + 1}</text>`;
  }
  for (let k = 0; k < K; k++) for (let i = 0; i < p.n[k]; i++) {
    const y0 = groupY(off[k] + i);
    svg += `<text x="6" y="${y0 + (J * lane) / 2 + 4}" font-size="11" font-weight="600" fill="${vizColor(k, K)}">T${k + 1}·B${i + 1}</text>`;
    s3.plans.forEach((pl, j) => {
      const y = y0 + j * lane;
      svg += `<rect x="${ml}" y="${y + 0.5}" width="${W - ml - mr}" height="${lane - 1}" fill="${j % 2 ? '#f7f7f9' : '#efeff2'}"/>`;
      if (lane >= 9) svg += `<text x="${ml - 6}" y="${y + lane - 2}" text-anchor="end" font-size="9">${pl.label} · ${fmt(w[j] * 100, 0)}%</text>`;
    });
  }
  s3.plans.forEach((pl, j) => {
    pl.plan.events.forEach(e => {
      if (e.start >= win) return;
      const y = groupY(off[e.type] + e.barrierIdx) + j * lane, c = vizColor(e.type, K);
      const x0 = sx(e.start), x1 = sx(Math.min(win, e.end)), x2 = sx(Math.min(win, e.safeUntil));
      if (e.aircraft === null) {
        svg += `<rect x="${x0}" y="${y + 1}" width="${Math.max(1.5, x2 - x0)}" height="${lane - 2}" fill="none" stroke="var(--error)"><title>Plan ${pl.label}: unassigned sortie, ${fmtDayTime(e.start)}</title></rect>`;
        return;
      }
      svg += `<rect x="${x1}" y="${y + 1}" width="${Math.max(0, x2 - x1)}" height="${lane - 2}" fill="${c}" fill-opacity="0.3"/>
        <rect x="${x0}" y="${y + 1}" width="${Math.max(1.5, x1 - x0)}" height="${lane - 2}" fill="${c}"><title>Plan ${pl.label}: Type ${e.type + 1} / Barrier ${e.barrierIdx + 1} patrolled ${fmtDayTime(e.start)} – ${hhmm(e.end)} (AC-${e.aircraft + 1}), safe until ${hhmm(e.safeUntil)}</title></rect>`;
    });
  });
  svg += `<text x="${(ml + W - mr) / 2}" y="${H - 6}" text-anchor="middle" font-size="11">Time (first ${days} days of the ${p.T_days}-day period)</text>`;
  el.innerHTML = svgBox(W, H, svg, 'Gantt chart of all plans by barrier', 760) + typeLegend(p) +
    `<p class="muted small">One block per barrier and one lane per plan in the mix (letter and mixing probability on the left). Solid = aircraft overhead (${p.tau_p} h); light = the safe period that follows (${p.tau_s} h).
    Only one plan is flown in a given month, picked at random with these probabilities, so read each lane as "what this barrier's month looks like if that plan is drawn".
    Within a plan the visits to a barrier are evenly spaced; across plans the phase is re-randomised, so the attacker cannot predict the timing.${bwNote(K)}</p>`;
}

/* ---------------- Calendar heatmap of the mixed strategy ---------------- */

function renderMixCalendar(p, d, s1, s3) {
  const el = document.getElementById('mixCalendar');
  if (!s3.plans || !s3.plans.length) { el.innerHTML = ''; return; }
  const w = planWeights(s3.plans), nH = Math.ceil(d.T - 1e-9);
  const expected = new Float64Array(nH);
  s3.plans.forEach((pl, j) => {
    coverageBins(p, d, pl.plan, 1).forEach(arr => { for (let h = 0; h < nH; h++) expected[h] += w[j] * arr[h]; });
  });
  const nDays = Math.ceil(nH / 24), cw = 28, rh = nDays > 40 ? 9 : 14, x0 = 62, top = 20;
  const W = x0 + 24 * cw + 120, gridH = top + nDays * rh;
  let svg = '';
  for (let h = 0; h < 24; h += 3) svg += `<text x="${x0 + h * cw + cw / 2}" y="12" text-anchor="middle" font-size="10">${String(h).padStart(2, '0')}:00</text>`;
  for (let h = 0; h < nH; h++) {
    const day = Math.floor(h / 24), hr = h % 24, v = expected[h];
    svg += `<rect x="${x0 + hr * cw}" y="${top + day * rh}" width="${cw - 2}" height="${rh - 2}" rx="2" fill="${seqColor(v / d.Nb)}"><title>Day ${day + 1}, ${String(hr).padStart(2, '0')}:00–${String(hr + 1).padStart(2, '0')}:00: ${fmt(v, 2)} of ${d.Nb} barriers protected on average (${fmt((v / d.Nb) * 100, 1)}%)</title></rect>`;
  }
  const step = nDays > 15 ? 5 : 1;
  for (let dd = 0; dd < nDays; dd += step) svg += `<text x="${x0 - 6}" y="${top + dd * rh + rh - 4}" text-anchor="end" font-size="10">Day ${dd + 1}</text>`;
  // vertical colour scale on the right
  const lx = x0 + 24 * cw + 30, lh = Math.min(200, gridH - top);
  for (let i = 0; i < 20; i++) svg += `<rect x="${lx}" y="${top + lh - (i + 1) * (lh / 20)}" width="16" height="${lh / 20 + 0.5}" fill="${seqColor((i + 0.5) / 20)}"/>`;
  svg += `<text x="${lx + 22}" y="${top + 8}" font-size="10">100%</text><text x="${lx + 22}" y="${top + lh / 2 + 4}" font-size="10">50%</text><text x="${lx + 22}" y="${top + lh}" font-size="10">0%</text>`;
  svg += `<text x="${lx}" y="${top + lh + 18}" font-size="10">of barriers</text><text x="${lx}" y="${top + lh + 30}" font-size="10">protected</text>`;
  const avg = expected.reduce((a, b) => a + b, 0) / nH;
  const predicted = p.n.reduce((s, nk, k) => s + nk * Math.min(1, s1.P[k]), 0);
  el.innerHTML = svgBox(W, Math.max(gridH, top + lh + 36) + 6, svg, 'Calendar heatmap of expected protection', 640) +
    `<p class="muted small">One row per day, one cell per hour. Each cell is the expected number of barriers protected in that hour, averaging the plans by their mixing probabilities
    (only sorties that got an aircraft count). Month average: <b>${fmt(avg, 2)} of ${d.Nb}</b> barriers (${fmt((avg / d.Nb) * 100, 1)}%); Stage 1 predicts
    &sum; n<sub>k</sub>P<sub>k</sub>* = ${fmt(predicted, 2)}. An even colour means protection is spread evenly through the month, which is what the coverage formula assumes.</p>`;
}

/* ---------------- Radial clock of the mixed strategy ---------------- */

function renderMixClock(p, d, s1, s3) {
  const el = document.getElementById('mixClock');
  if (!s3.plans || !s3.plans.length) { el.innerHTML = ''; return; }
  const K = p.K, w = planWeights(s3.plans), binH = 0.25, perDay = 24 / binH;
  const clock = Array.from({ length: d.Nb }, () => new Float64Array(perDay));
  const counts = new Float64Array(perDay);
  const nBins = Math.ceil(d.T / binH - 1e-9);
  for (let i = 0; i < nBins; i++) counts[i % perDay]++;
  s3.plans.forEach((pl, j) => {
    coverageBins(p, d, pl.plan, binH).forEach((arr, b) => { for (let i = 0; i < arr.length; i++) clock[b][i % perDay] += w[j] * arr[i]; });
  });
  clock.forEach(a => { for (let s = 0; s < perDay; s++) a[s] /= counts[s] || 1; });

  const cx = 250, cy = 250, r0 = 58, rOut = 210, rw = Math.min(16, (rOut - r0) / d.Nb);
  const pt = (r, hr) => [cx + r * Math.sin((hr / 24) * 2 * Math.PI), cy - r * Math.cos((hr / 24) * 2 * Math.PI)];
  const arc = (r, a0, a1) => { const [x0, y0] = pt(r, a0), [x1, y1] = pt(r, a1); return `M${x0.toFixed(1)},${y0.toFixed(1)} A${r},${r} 0 0 1 ${x1.toFixed(1)},${y1.toFixed(1)}`; };
  const off = barrierOffsets(p);
  let svg = '';
  for (let k = 0; k < K; k++) for (let i = 0; i < p.n[k]; i++) {
    const b = off[k] + i, r = r0 + b * rw + rw / 2;
    svg += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#f0f0f2" stroke-width="${rw - 1}"/>`;
    const mean = clock[b].reduce((a, c) => a + c, 0) / perDay;
    for (let s = 0; s < perDay; s++) {
      const v = clock[b][s];
      if (v < 0.005) continue;
      svg += `<path d="${arc(r, s * binH, (s + 1) * binH)}" fill="none" stroke="${vizColor(k, K)}" stroke-opacity="${v.toFixed(3)}" stroke-width="${rw - 1}"><title>T${k + 1}·B${i + 1}, ${hhmm(s * binH)}–${hhmm((s + 1) * binH)}: protected ${fmt(v * 100, 1)}% of the time (24 h average ${fmt(mean * 100, 1)}%)</title></path>`;
    }
  }
  for (let h = 0; h < 24; h += 3) {
    const [x, y] = pt(rOut + 18, h), [ax, ay] = pt(r0 - 4, h), [bx, by] = pt(rOut + 4, h);
    svg += `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="#999" stroke-width="0.6" stroke-dasharray="2 3"/><text x="${x}" y="${y + 4}" text-anchor="middle" font-size="11" font-weight="600">${String(h).padStart(2, '0')}:00</text>`;
  }
  svg += `<text x="${cx}" y="${cy - 4}" text-anchor="middle" font-size="12" font-weight="600">Mixed</text><text x="${cx}" y="${cy + 12}" text-anchor="middle" font-size="11">strategy</text>`;
  // side key: ring order and per-type averages
  let ty = 70;
  svg += `<text x="510" y="${ty}" font-size="12" font-weight="600">Inner ring → outer ring</text>`;
  for (let k = 0; k < K; k++) {
    ty += 20;
    const avg = p.n[k] ? clock.slice(off[k], off[k] + p.n[k]).reduce((s, a) => s + a.reduce((x, y) => x + y, 0) / perDay, 0) / p.n[k] : 0;
    svg += `<rect x="510" y="${ty - 10}" width="12" height="12" rx="2" fill="${vizColor(k, K)}"/><text x="528" y="${ty}" font-size="11">Type ${k + 1}: B1…B${p.n[k]} · ${fmt(avg * 100, 1)}% (P* ${fmt(Math.min(1, s1.P[k]) * 100, 1)}%)</text>`;
  }
  ty += 30;
  ['Darker = protected more often at', 'that time of day, averaged over', `all ${p.T_days} days and all plans`, 'weighted by mixing probability.'].forEach(t => { svg += `<text x="510" y="${ty}" font-size="11" fill="#555">${t}</text>`; ty += 15; });
  el.innerHTML = svgBox(780, 500, svg, 'Radial clock of protection by time of day', 600) +
    `<p class="muted small">Each ring is one barrier; going round the ring is the 24-hour day in 15-minute slices. The shade is the probability that the barrier is protected at that time of day
    under the mixed strategy. Even shading round each ring means no time of day is a predictable weak spot. Hover a slice for its value.${bwNote(K)}</p>`;
}

/* ---------------- Monte Carlo check ---------------- */

let mcState = null;

function renderMonteCarlo(p, d, s1, s3) {
  if (mcState && mcState.raf) cancelAnimationFrame(mcState.raf);
  mcState = null;
  const el = document.getElementById('monteCarloOutput');
  if (!s1.feasible || !s3.plans || !s3.plans.length) { el.innerHTML = '<p class="muted">Nothing to simulate (no feasible plan).</p>'; return; }
  const K = p.K, TOTAL = 12000, PER_FRAME = 40, w = planWeights(s3.plans);
  // q[j][k][i]: sorties barrier i of type k receives in plan j.
  const q = s3.plans.map(pl => p.n.map((_, k) => pl.plan.barrierSchedules.filter(b => b.type === k).map(b => b.q)));

  el.innerHTML = `<p class="muted small">Each simulated attack: the defender draws this month's plan with the mixing probabilities and fresh random phases;
    the attacker, who cannot see either, picks a barrier type (uniformly), a random barrier of that type and a random moment in the period.
    The attack is caught if the barrier is protected at that moment. Running catch rates should settle on the Stage-1 coverage P<sub>k</sub>*, and the average payoff on U<sub>d</sub>(k), the same for every active type.</p>
    <div class="button-row"><button type="button" class="mc-run">&#9654; Run ${TOTAL.toLocaleString()} attacks</button><button type="button" class="secondary mc-reset">Reset</button></div>
    <div class="mc-out"></div><div class="mc-table"></div>`;

  const attack = () => {
    const k = Math.floor(Math.random() * K), i = Math.floor(Math.random() * p.n[k]);
    let u = Math.random(), j = 0;
    for (; j < w.length - 1; j++) { u -= w[j]; if (u < 0) break; }
    const qi = q[j][k][i];
    let caught = false;
    if (qi > 0) {
      const delta = d.T / qi, span = delta - d.W, phi = span > 1e-9 ? Math.random() * span : 0, t = Math.random() * d.T;
      caught = t >= phi && (t - phi) % delta < d.W;
    }
    const st = mcState;
    st.n[k]++; if (caught) st.hit[k]++; st.pay[k] += caught ? p.v[k] : -p.v[k]; st.total++;
  };

  const draw = () => {
    const st = mcState, W = 760, H = 300, ml = 52, mr = 70, mt = 14, mb = 40;
    const targets = s1.P.map(x => Math.min(1, x));
    const lo = Math.max(0, Math.min(...targets) - 0.15), hi = Math.min(1, Math.max(...targets) + 0.15);
    const sx = x => ml + (x / TOTAL) * (W - ml - mr), sy = y => H - mb - ((Math.max(lo, Math.min(hi, y)) - lo) / (hi - lo)) * (H - mt - mb);
    let svg = '';
    for (let g = 0; g <= 4; g++) {
      const v = lo + ((hi - lo) * g) / 4;
      svg += `<line x1="${ml}" x2="${W - mr}" y1="${sy(v)}" y2="${sy(v)}" stroke="#eee"/><text x="${ml - 6}" y="${sy(v) + 4}" text-anchor="end" font-size="10">${fmt(v * 100, 0)}%</text>`;
    }
    for (let g = 0; g <= 4; g++) svg += `<text x="${sx((TOTAL * g) / 4)}" y="${H - mb + 15}" text-anchor="middle" font-size="10">${((TOTAL * g) / 4).toLocaleString()}</text>`;
    svg += `<line x1="${ml}" x2="${W - mr}" y1="${H - mb}" y2="${H - mb}" stroke="#999"/>`;
    svg += `<text x="${(ml + W - mr) / 2}" y="${H - 6}" text-anchor="middle" font-size="11">Total simulated attacks</text>`;
    svg += `<text x="14" y="${(mt + H - mb) / 2}" text-anchor="middle" font-size="11" transform="rotate(-90 14 ${(mt + H - mb) / 2})">Catch rate so far</text>`;
    for (let k = 0; k < K; k++) {
      const c = vizColor(k, K);
      svg += `<line x1="${ml}" x2="${W - mr}" y1="${sy(targets[k])}" y2="${sy(targets[k])}" stroke="${c}" stroke-dasharray="5 4" stroke-opacity="0.8"/>`;
      if (st.hist[k].length > 1) svg += `<polyline fill="none" stroke="${c}" stroke-width="2" points="${st.hist[k].map(([x, y]) => `${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join(' ')}"/>`;
      const last = st.hist[k].length ? st.hist[k][st.hist[k].length - 1] : [0, targets[k]];
      svg += `<text x="${sx(last[0]) + 6}" y="${sy(last[1]) + 4}" font-size="11" font-weight="600" fill="${c}">T${k + 1}</text>`;
    }
    el.querySelector('.mc-out').innerHTML = svgBox(W, H, svg, 'Monte Carlo running catch rates', 560) +
      `<p class="muted small">Solid lines: running catch rate per type. Dashed lines: Stage-1 prediction P<sub>k</sub>*. ${st.total.toLocaleString()} of ${TOTAL.toLocaleString()} attacks simulated.${bwNote(K)}</p>`;
    let rows = '';
    for (let k = 0; k < K; k++) {
      rows += `<tr><td><span style="color:${vizColor(k, K)};font-weight:600">Type ${k + 1}</span></td><td>${st.n[k]}</td>
        <td>${st.n[k] ? fmt((st.hit[k] / st.n[k]) * 100, 1) + '%' : '—'}</td><td>${fmt(targets[k] * 100, 1)}%</td>
        <td>${st.n[k] ? sgnFmt(st.pay[k] / st.n[k]) : '—'}</td><td>${sgnFmt(s1.U[k])}</td></tr>`;
    }
    const allN = st.n.reduce((a, b) => a + b, 0);
    el.querySelector('.mc-table').innerHTML = `<table><thead><tr><th>Type attacked</th><th>Attacks</th><th>Caught (simulated)</th><th>P<sub>k</sub>* (Stage 1)</th>
      <th>Avg. defender payoff (simulated)</th><th>U<sub>d</sub>(k) (Stage 1)</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="muted small">Game value z* = ${fmt(s1.z, 4)}. ${allN >= TOTAL ? 'With this many attacks the simulated figures should sit within about &plusmn;2 percentage points of the predictions.' : ''}</p>`;
  };

  const loop = () => {
    for (let s = 0; s < PER_FRAME && mcState.total < TOTAL; s++) attack();
    for (let k = 0; k < K; k++) if (mcState.n[k]) mcState.hist[k].push([mcState.total, mcState.hit[k] / mcState.n[k]]);
    draw();
    mcState.raf = mcState.total < TOTAL ? requestAnimationFrame(loop) : null;
  };
  const reset = () => {
    if (mcState && mcState.raf) cancelAnimationFrame(mcState.raf);
    mcState = { n: new Array(K).fill(0), hit: new Array(K).fill(0), pay: new Array(K).fill(0), hist: p.n.map(() => []), total: 0, raf: null };
    draw();
  };
  el.querySelector('.mc-run').addEventListener('click', () => { if (mcState.total >= TOTAL) reset(); if (!mcState.raf) mcState.raf = requestAnimationFrame(loop); });
  el.querySelector('.mc-reset').addEventListener('click', reset);
  reset();
  mcState.raf = requestAnimationFrame(loop);
}

/* ---------------- Month playback ---------------- */

let playback = null;

function setupPlayback(p, d, s3, s1) {
  if (playback && playback.raf) cancelAnimationFrame(playback.raf);
  playback = null;
  const el = document.getElementById('playbackOutput');
  if (!s3.plans || !s3.plans.length) { el.innerHTML = ''; return; }

  const totalSec = d.T; // 1 s per hour
  el.innerHTML = `
    <p class="muted small">Every shield is a barrier, every plane is an aircraft. Aircraft wait at the base, fly out to their barrier for
    a sortie of &tau;<sub>p</sub> = ${fmt(p.tau_p, 1)} h, circle it and return. Barrier colours: <b style="color:#0a7d28">green</b> = aircraft overhead,
    <b style="color:#1a5fb4">blue</b> = within its safe period, <b style="color:#b00020">red outline</b> = unprotected. One second of playback is one hour,
    so a day takes 24 s and the full ${p.T_days}-day period takes ${Math.floor(totalSec / 60)} min ${Math.round(totalSec % 60)} s at 1&times;.</p>
    <div class="button-row" style="flex-wrap:wrap;align-items:center">
      <label class="small">Plan
        <select id="pbPlan">${s3.plans.map((pl, j) => `<option value="${j}">Plan ${pl.label} (probability ${fmt(pl.prob, 3)})</option>`).join('')}</select>
      </label>
      <button id="pbDraw" class="secondary">Draw a plan at random (by s<sub>j</sub>)</button>
      <button id="pbPlay">&#9654; Play</button>
      <button id="pbRestart" class="secondary">Restart</button>
      <label class="small">Speed
        <select id="pbSpeed">
          <option value="1" selected>1&times; (1 s = 1 h)</option>
          <option value="2">2&times;</option><option value="6">6&times;</option><option value="24">24&times; (1 s = 1 day)</option>
        </select>
      </label>
    </div>
    <div class="game-value" id="pbClock"></div>
    <input type="range" id="pbScrub" min="0" max="${d.T}" step="0.1" value="0" style="width:100%">
    <div id="pbStage" style="overflow-x:auto"></div>
    <div id="pbStats"></div>`;

  playback = { p, d, s3, s1, t: 0, playing: false, speed: 1, raf: null, last: null };
  loadPlaybackPlan(0);

  document.getElementById('pbPlan').addEventListener('change', e => loadPlaybackPlan(+e.target.value));
  document.getElementById('pbDraw').addEventListener('click', () => {
    let u = Math.random(), j = 0;
    for (; j < s3.plans.length - 1; j++) { u -= s3.plans[j].prob; if (u < 0) break; }
    document.getElementById('pbPlan').value = j;
    loadPlaybackPlan(j);
  });
  document.getElementById('pbPlay').addEventListener('click', () => setPlaying(!playback.playing));
  document.getElementById('pbRestart').addEventListener('click', () => { playback.t = 0; drawPlayback(); });
  document.getElementById('pbSpeed').addEventListener('change', e => { playback.speed = +e.target.value; });
  document.getElementById('pbScrub').addEventListener('input', e => { playback.t = +e.target.value; drawPlayback(); });
}

function setPlaying(on) {
  const pb = playback;
  pb.playing = on;
  document.getElementById('pbPlay').innerHTML = on ? '&#10073;&#10073; Pause' : '&#9654; Play';
  if (on) {
    if (pb.t >= pb.d.T) pb.t = 0;
    pb.last = null;
    const tick = now => {
      if (!pb.playing || playback !== pb) return;
      if (pb.last !== null) pb.t = Math.min(pb.d.T, pb.t + ((now - pb.last) / 1000) * pb.speed);
      pb.last = now;
      drawPlayback();
      if (pb.t >= pb.d.T) { setPlaying(false); return; }
      pb.raf = requestAnimationFrame(tick);
    };
    pb.raf = requestAnimationFrame(tick);
  } else if (pb.raf) cancelAnimationFrame(pb.raf);
}

function loadPlaybackPlan(j) {
  const pb = playback, { p, d } = pb;
  const plan = pb.s3.plans[j].plan;
  pb.planIdx = j;
  pb.t = 0;

  // Layout: base on the left, barriers in rows by type on the right.
  const W = 1000, baseCols = 4, slot = 48, baseX = 20, baseY = 40;
  const barX0 = 280, barCell = 110, barCols = Math.max(1, Math.floor((W - barX0 - 10) / barCell));
  const barriers = plan.barrierSchedules.map(bs => ({ ...bs }));
  let y = 30;
  const rowsByType = {};
  barriers.forEach(b => { (rowsByType[b.type] = rowsByType[b.type] || []).push(b); });
  Object.keys(rowsByType).forEach(k => {
    const list = rowsByType[k];
    list.forEach((b, i) => { b.x = barX0 + (i % barCols) * barCell + barCell / 2; b.y = y + 62 + Math.floor(i / barCols) * 108; });
    rowsByType[k].labelY = y + 10;
    y += Math.ceil(list.length / barCols) * 108 + 24;
  });
  const baseRows = Math.ceil(p.N / baseCols);
  const H = Math.max(y, baseY + baseRows * slot + 40);

  // Only sorties that an aircraft actually flies protect a barrier; unassigned ones are skipped.
  barriers.forEach(b => { b.key = `${b.type}-${b.barrierIdx}`; });
  barriers.forEach(b => {
    b.starts = plan.events.filter(ev => ev.aircraft !== null && ev.aircraft !== undefined && `${ev.type}-${ev.barrierIdx}` === b.key)
      .map(ev => ev.start).sort((a, c) => a - c);
  });
  const barrierByKey = {};
  barriers.forEach(b => { barrierByKey[b.key] = b; });

  const aircraft = Array.from({ length: p.N }, (_, i) => ({
    home: [baseX + 20 + (i % baseCols) * slot, baseY + 20 + Math.floor(i / baseCols) * slot],
    sorties: [],
  }));
  plan.events.forEach(ev => {
    if (ev.aircraft !== null && ev.aircraft !== undefined) aircraft[ev.aircraft].sorties.push({ start: ev.start, b: barrierByKey[`${ev.type}-${ev.barrierIdx}`] });
  });
  aircraft.forEach(a => a.sorties.sort((x, z) => x.start - z.start));
  pb.barriers = barriers; pb.aircraft = aircraft;
  pb.totalSorties = plan.events.length;
  pb.unassigned = plan.unassigned;

  let svg = `<defs><path id="pbPlaneShape" d="${PLANE_PATH}"/><path id="pbShieldShape" d="${SHIELD_PATH}"/></defs>`;
  svg += `<rect x="${baseX}" y="${baseY - 22}" width="${baseCols * slot + 20}" height="${baseRows * slot + 34}" rx="8" fill="#f7f7f8" stroke="#d5d5d5"/>`;
  svg += `<text x="${baseX + 10}" y="${baseY - 6}" font-size="13" font-weight="600">Air base</text>`;
  Object.keys(rowsByType).forEach(k => {
    svg += `<text x="${barX0}" y="${rowsByType[k].labelY}" font-size="13" font-weight="600" fill="${typeColor(+k)}">Type ${+k + 1} barriers (v = ${p.v[k]})</text>`;
  });
  barriers.forEach((b, i) => {
    svg += `<g transform="translate(${b.x},${b.y})">
      <circle id="pbHalo${i}" r="33" fill="none" stroke-width="3"/>
      <use href="#pbShieldShape" id="pbShield${i}" transform="scale(1.7)" stroke-width="1.6"/>
      <text y="5" font-size="12" text-anchor="middle" font-weight="700" fill="#fff">B${b.barrierIdx + 1}</text>
      <text id="pbCov${i}" y="52" font-size="12" text-anchor="middle"></text>
      <title>Type ${b.type + 1}, barrier ${b.barrierIdx + 1}: ${b.q} sorties, every ${b.delta ? fmt(b.delta, 1) : '—'} h, planned coverage ${fmt(b.prob * 100, 1)}%</title></g>`;
  });
  aircraft.forEach((a, i) => {
    svg += `<g id="pbAc${i}"><use href="#pbPlaneShape" id="pbAcShape${i}"/><text id="pbAcLbl${i}" y="20" font-size="10" text-anchor="middle">${i + 1}</text><title>AC-${i + 1}</title></g>`;
  });
  document.getElementById('pbStage').innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="min-width:720px;font-family:inherit" role="img" aria-label="Animated patrol playback">${svg}</svg>`;
  drawPlayback();
}

// Index of the last element of a sorted array with value <= t (−1 if none).
function lastAtOrBefore(arr, t, key = x => x) {
  let lo = 0, hi = arr.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (key(arr[m]) <= t) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans;
}

function drawPlayback() {
  const pb = playback, { p, d } = pb, t = pb.t;
  const tauP = p.tau_p, W = d.W;
  document.getElementById('pbScrub').value = t;
  document.getElementById('pbClock').textContent =
    `${fmtDayTime(t)}  ·  hour ${fmt(t, 1)} of ${fmt(d.T, 0)}  ·  ${fmt((t / d.T) * 100, 1)}% of the period`;

  // Barriers: state now + covered time so far (union of windows clipped to [0, t]).
  const typeNow = {};
  pb.barriers.forEach((b, i) => {
    let state = 'open', covered = 0, prevEnd = -Infinity;
    const last = lastAtOrBefore(b.starts, t);
    for (let j = 0; j <= last; j++) {
      const s = b.starts[j], e = Math.min(t, s + W);
      if (e > Math.max(s, prevEnd)) covered += e - Math.max(s, prevEnd);
      prevEnd = Math.max(prevEnd, s + W);
    }
    if (last >= 0) {
      const since = t - b.starts[last];
      if (since < tauP) state = 'overhead'; else if (since < W) state = 'safe';
    }
    const shield = document.getElementById(`pbShield${i}`), halo = document.getElementById(`pbHalo${i}`);
    shield.setAttribute('fill', state === 'open' ? '#e9e9ec' : typeColor(b.type));
    shield.setAttribute('fill-opacity', state === 'safe' ? 0.55 : 1);
    shield.setAttribute('stroke', state === 'open' ? '#b00020' : typeColor(b.type));
    halo.setAttribute('stroke', state === 'overhead' ? '#0a7d28' : state === 'safe' ? '#1a5fb4' : 'none');
    const sofar = t > 0 ? covered / t : 0;
    document.getElementById(`pbCov${i}`).textContent = `${fmt(sofar * 100, 0)}% so far`;
    const k = b.type;
    typeNow[k] = typeNow[k] || { covered: 0, n: 0, sum: 0, plan: 0 };
    typeNow[k].n++; typeNow[k].sum += sofar; typeNow[k].plan += b.prob;
    if (state !== 'open') typeNow[k].covered++;
  });

  // Aircraft: parked at base, or out on a sortie (outbound → orbit → return).
  let airborne = 0, flown = 0;
  pb.aircraft.forEach((a, i) => {
    const j = lastAtOrBefore(a.sorties, t, s => s.start);
    flown += j + 1;
    let x = a.home[0], y = a.home[1], ang = -90, color = '#9a9a9a';
    if (j >= 0 && t < a.sorties[j].start + tauP) {
      const { start, b } = a.sorties[j];
      const f = (t - start) / tauP, leg = 0.2, R = 40;
      color = typeColor(b.type);
      airborne++;
      const orbitStart = [b.x + R, b.y];
      if (f < leg) {
        const u = f / leg;
        x = a.home[0] + (orbitStart[0] - a.home[0]) * u; y = a.home[1] + (orbitStart[1] - a.home[1]) * u;
        ang = (Math.atan2(orbitStart[1] - a.home[1], orbitStart[0] - a.home[0]) * 180) / Math.PI;
      } else if (f > 1 - leg) {
        const u = (f - (1 - leg)) / leg;
        x = orbitStart[0] + (a.home[0] - orbitStart[0]) * u; y = orbitStart[1] + (a.home[1] - orbitStart[1]) * u;
        ang = (Math.atan2(a.home[1] - orbitStart[1], a.home[0] - orbitStart[0]) * 180) / Math.PI;
      } else {
        const th = ((f - leg) / (1 - 2 * leg)) * 2 * Math.PI * 2;
        x = b.x + R * Math.cos(th); y = b.y + R * Math.sin(th);
        ang = (th * 180) / Math.PI + 90;
      }
    }
    document.getElementById(`pbAc${i}`).setAttribute('transform', `translate(${x.toFixed(1)},${y.toFixed(1)})`);
    const shape = document.getElementById(`pbAcShape${i}`);
    shape.setAttribute('transform', `rotate(${ang.toFixed(1)}) scale(1.3)`);
    shape.setAttribute('fill', color);
  });

  const rows = Object.keys(typeNow).map(k => {
    const s = typeNow[k];
    return `<tr><td><span style="color:${typeColor(+k)};font-weight:700">Type ${+k + 1}</span></td>
      <td>${s.covered} / ${s.n}</td>
      <td>${fmt(Math.min(1, pb.s1.P[k]) * 100, 1)}%</td>
      <td>${fmt((s.plan / s.n) * 100, 1)}%</td>
      <td>${t > 0 ? fmt((s.sum / s.n) * 100, 1) + '%' : '—'}</td></tr>`;
  }).join('');
  document.getElementById('pbStats').innerHTML = `
    <div class="kv-grid">
      <div><b>Aircraft airborne now</b>${airborne} of ${p.N}</div>
      <div><b>Sorties started so far</b>${flown} of ${pb.totalSorties - pb.unassigned} assigned</div>
      <div><b>Unassigned sorties in this plan</b>${pb.unassigned}</div>
    </div>
    <table><thead><tr><th>Barrier type</th><th>Barriers protected right now</th><th>P<sub>k</sub>* defended probability (Stage 1, all plans mixed)</th><th>Planned coverage (this plan)</th><th>Coverage achieved so far</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

/* ============================================================
   Wiring
   ============================================================ */

const DEFAULT_BARRIERS = [{ n: 4, v: 3 }, { n: 3, v: 2 }, { n: 3, v: 1 }];

function buildBarrierRows(K) {
  const tbody = document.getElementById('barrierTypesBody');
  const existing = [];
  tbody.querySelectorAll('tr').forEach(tr => {
    existing.push({
      n: parseFloat(tr.querySelector('.nk-input').value),
      v: parseFloat(tr.querySelector('.vk-input').value)
    });
  });
  tbody.innerHTML = '';
  for (let k = 0; k < K; k++) {
    const defaults = DEFAULT_BARRIERS[k] || { n: 1, v: 1 };
    const prev = existing[k];
    const nVal = prev ? prev.n : defaults.n;
    const vVal = prev ? prev.v : defaults.v;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>Type ${k + 1}</td>
      <td><input type="number" class="nk-input" min="1" step="1" value="${nVal}"></td>
      <td><input type="number" class="vk-input" min="0.01" step="0.5" value="${vVal}"></td>`;
    tbody.appendChild(tr);
  }
  updateNbDisplay();
}

function updateNbDisplay() {
  let sum = 0;
  document.querySelectorAll('.nk-input').forEach(inp => { sum += parseFloat(inp.value) || 0; });
  document.getElementById('NbDisplay').textContent = sum;
}

function runAll() {
  const errorBox = document.getElementById('errorBox');
  errorBox.textContent = '';
  const p = getParams();
  const errs = validateParams(p);
  if (errs.length) { errorBox.textContent = errs.join('\n'); return; }

  const d = computeDerived(p);
  const s1 = stage1(p, d);
  const s2 = stage2(p, d, s1);
  const s3 = stage3(p, d, s1, s2);
  const fs = minimumFleetSize(p, d);
  const bl = baselines(p, d);

  renderDerived(p, d);
  renderStage1(p, s1);
  renderAllocationVisual(p, d, s1);
  renderSankey(p, d, s1);
  renderTreemap(p, d, s1);
  renderStage2(p, s2);
  renderPayoffHeatmap(p, d, s1, s3);
  renderStage3(p, d, s3);
  renderMixGantt(p, d, s3);
  renderMixCalendar(p, d, s1, s3);
  renderMixClock(p, d, s1, s3);
  setupPlayback(p, d, s3, s1);
  renderFleetSize(p, fs);
  renderBaselines(p, s1, bl);
  renderIconArray(p, d, s1, bl);
  renderMonteCarlo(p, d, s1, s3);
}

function resetDefaults() {
  document.getElementById('N').value = 22;
  document.getElementById('K').value = 3;
  document.getElementById('tau_p').value = 3;
  document.getElementById('tau_s').value = 9;
  document.getElementById('T_days').value = 30;
  document.getElementById('tau_r').value = 0;
  document.getElementById('F').value = 55;
  document.getElementById('theta').value = 0.5;
  buildBarrierRows(3);
  runAll();
}

document.addEventListener('DOMContentLoaded', () => {
  buildBarrierRows(parseInt(document.getElementById('K').value, 10));

  document.getElementById('K').addEventListener('change', () => {
    let K = parseInt(document.getElementById('K').value, 10);
    if (!K || K < 1) K = 1;
    if (K > 12) K = 12;
    document.getElementById('K').value = K;
    buildBarrierRows(K);
  });

  document.getElementById('barrierTypesBody').addEventListener('input', updateNbDisplay);
  document.getElementById('runBtn').addEventListener('click', runAll);
  document.getElementById('resetBtn').addEventListener('click', resetDefaults);

  runAll();
});
