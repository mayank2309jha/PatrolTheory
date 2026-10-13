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
  renderStage2(p, s2);
  renderStage3(p, d, s3);
  setupPlayback(p, d, s3, s1);
  renderFleetSize(p, fs);
  renderBaselines(p, s1, bl);
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
