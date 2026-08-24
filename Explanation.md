# Explanation: A Stackelberg Security Game for Aircraft Patrol Planning

This document explains **everything the paper contains**, in the order the paper presents it,
and then explains **exactly how each piece maps onto the code** in `script.js`. Read this
alongside the running app (`index.html` via Live Server) — every number you see on the page is
produced by one of the algorithms described below.

The source paper is `patrol_theory_v6 1.pdf` ("A Stackelberg Security Game Formulation for
Aircraft Patrol Planning — Theory, Linear Programming Formulation, and Implementation").

---

## 1. The problem, in plain language

You have a fleet of `N` aircraft. There are several **barriers** — physical borders, choke
points, or areas — that need to be patrolled. Barriers come in `K` **types** (e.g. "high value",
"medium value", "low value"), and each type has `n_k` individual barriers and a military value
`v_k` per barrier.

Flying a **sortie** (one patrol flight of `τ_p` hours) protects a barrier not just while the
aircraft is overhead, but for a **protection window** `W = τ_p + τ_s` hours — the flight itself
plus a "safe period" `τ_s` afterwards (e.g. because a barrier that was just checked is unlikely
to be crossed again immediately).

An intelligent **attacker** watches how the defender patrols (the *policy*, i.e. the long-run
probabilities of each schedule) but not the specific schedule flown on any given day, and then
picks the single barrier that is worst for the defender. This attacker/defender interaction is a
**Stackelberg security game**: the defender commits first (as the *leader*) to a mixed strategy,
and the attacker responds optimally (as the *follower*).

The paper solves this in **three stages**:

1. **Stage 1** — decide, *in aggregate*, how many flying hours to spend on each barrier *type*
   (a continuous LP with a closed-form solution).
2. **Stage 2** — convert that continuous, fractional answer into a small set of *integer* sortie
   schedules mixed with specific probabilities (a feasibility LP).
3. **Stage 3** — turn each schedule into an actual daily/monthly timetable: which barrier is
   visited when, and which tail number (aircraft) flies it.

The paper additionally derives the **minimum fleet size** needed for guaranteed outcomes, proves
the Stage-2 rounding scheme is *worst-case optimal* (Section 11), and benchmarks the result
against four common-sense patrol heuristics (Section 12).

---

## 2. Problem parameters (paper Table 1) and the defaults used here

| Symbol | Meaning | Default in this app | Customizable? |
|---|---|---|---|
| `N` | Number of aircraft | **22** | Yes |
| `K` | Number of barrier types | **3** | Yes (1–12) |
| `n_k` | Individual barriers of type `k` | **4, 3, 3** | Yes, per type |
| `v_k` | Military value of one barrier of type `k` | **3, 2, 1** | Yes, per type |
| `N_b = Σ n_k` | Total number of barriers | *computed* (10) | No — derived |
| `T` | Planning horizon (schedule repeats every `T`) | **30 days** = 720 h | Yes (entered in days) |
| `τ_p` | Patrol duration / flying hours per sortie | **3 h** | Yes |
| `τ_s` | Safe period after a patrol ends | **9 h** | Yes |
| `W = τ_p + τ_s` | Protection window | *computed* (12 h) | No — derived |
| `μ = W / τ_p` | Window multiplier | *computed* (4) | No — derived |
| `τ_r` | Aircraft restart period (turnaround after landing) | **0 h** | Yes |
| `G = τ_p + τ_r` | Minimum gap between sortie *starts* for the same aircraft | *computed* (3 h) | No — derived |
| `F` | Maximum flying hours per aircraft per period `T` | **55 h** (assumed — see below) | Yes |
| `B = N·F` | Total fleet flying hours | *computed* | No — derived |
| `N_srt = ⌊B/τ_p⌋` | Maximum integer sorties | *computed* | No — derived |
| `B_eff = N_srt·τ_p` | Integer-feasible budget | *computed* | No — derived |
| `θ` | Coverage threshold for the minimum-fleet-size formula | **0.5** | Yes |

### Assumed default: `F`

You listed every parameter above **except** `F` (max flying hours per aircraft per planning
period). It is required by the model — `B = N·F` is the fleet's total flying-hour budget that
Stage 1 allocates — so a default of **55 hours per aircraft per 30-day period** was chosen. This
isn't arbitrary: with `N = 22` and `τ_p = 3`, it reproduces the exact `B_eff = 1209 h`,
`N_srt = 403 sorties` figures that the paper itself uses in its Section 12 baseline-comparison
worked example (the "22-aircraft problem"). Change it freely in the form — everything downstream
recomputes automatically.

### Why `T` is entered in days but used in hours

The paper's `T` is in hours (e.g. `T = 720 h` in its worked examples), but you specified the
default planning horizon as "30 days," which is the more natural unit to type. The app takes
`T_days` as input and internally computes `T = T_days × 24` for every formula.

---

## 3. Coverage model (paper §3)

Let `h_k` be the *total* flying hours spent per period `T` on **all** barriers of type `k`
combined. Since each sortie protects for `W` hours (not just `τ_p`), `h_k` flying hours buy
`μ·h_k` hours of *protection* (spread across the `n_k` barriers of that type).

**Coverage probability** of one barrier of type `k` — the fraction of the planning horizon it is
protected —

```
P_k = μ·h_k / (n_k·T)
```

`P_k = 1` means continuous protection all period; it requires `h_k = n_k·T/μ` flying hours. This
formula assumes sorties are spread out *uniformly in time*, which Stage 3 is responsible for
actually enforcing.

**Code:** `renderStage1` displays `P_k` for every type; the formula itself is computed inline in
`stage1()`.

---

## 4. The Stackelberg game (paper §4)

- **Defender** commits to a mixed patrol policy (a probability distribution over integer sortie
  schedules).
- **Attacker** observes the policy, then picks one barrier *type* to strike.
- If the attacker strikes a type-`k` barrier, the defender's payoff is

  ```
  U_d(k) = v_k·(2·P_k − 1)
  ```

  — a gain of `v_k` if the barrier happened to be covered at that moment (probability `P_k`), a
  loss of `v_k` if not (probability `1 − P_k`). This is a **zero-sum** game: the attacker's
  payoff is `−U_d(k)`.

- The defender's problem is a **maximin**:

  ```
  max_h  min_k  U_d(k; h)      subject to  Σ h_k = B_eff,  h_k ≥ 0
  ```

  The inner `min` is the attacker always striking the single worst barrier type for the current
  allocation `h`; the outer `max` is the defender's best commitment against that.

- **Why the attacker must be indifferent at the optimum** (Remark 3): if one active type gave the
  attacker strictly less defender-utility than another, the defender could shift hours from the
  better-defended type to the worse one and improve the worst case — so at the optimum, every
  *active* type yields exactly the same defender payoff `z*` (the **game value**). This is the
  classic security-game equalization argument, and it's the key structural fact Stage 1 exploits.

---

## 5. Stage 1 — optimal flying-hour allocation (paper §5)

### The LP

Introducing a scalar `z` for the game value turns the maximin into a linear programme:

```
max   z
s.t.  z ≤ v_k·(2μh_k/(n_k·T) − 1)   for every type k     (C1)
      Σ h_k = B_eff                                       (C2)
      h_k ≥ 0                                              (C3)
```

### Closed-form solution (Theorem 1)

Assuming every type ends up "active" (gets positive hours), all `K` inequality constraints (C1)
bind simultaneously (because of the indifference argument above), which turns the LP into a
solvable linear system. Define a per-type **sensitivity coefficient**

```
d_k = n_k·T / (2μv_k)
```

Then

```
z* = ( B_eff − T·N_b/(2μ) ) / Σ d_k
h_k* = d_k·(z* + v_k)
```

Intuitively: `d_k` says how many flying hours it takes to move type `k`'s coverage probability by
one unit of value — types with **many barriers** or **low value per barrier** have a large `d_k`
(cheap/urgent to cover), while types with **few, high-value barriers** have a small `d_k`.

### Active vs inactive types (§5.3, Proposition 2)

If the fleet is so small that `z* + v_k ≤ 0` for some type, the formula above would return a
*negative* `h_k*`, which is impossible (hours can't be negative). That type is **inactive** — the
defender abandons it entirely (`h_k = 0`) because even that total loss is no worse than the
equilibrium loss already being sustained elsewhere. When this happens, the type is dropped and
`z*`, `h_k*` are **recomputed over the remaining active types only** (Remark 5) — repeating until
every remaining type has `h_k* ≥ 0`.

**Code:** `stage1(p, d)` implements exactly this loop: compute `d_k`, `z*`, `h_k*` for the
current active set; if any `h_k* < 0`, remove those types, log the removal, and recompute. The
`log` array populated here is what you see under "Stage 1" in the app when a removal happens (it
won't happen with the defaults, but try lowering `N` or raising one `v_k` a lot to trigger it).

---

## 6. Stage 2 — turning the continuous answer into a mixed strategy (paper §6)

`h_k*` is a real number of flying hours; sorties are discrete. `m_k* = h_k*/τ_p` (the "fractional
sortie target") is in general **not an integer**, so no single integer schedule achieves `h*`
exactly — you need to **mix** two or more integer schedules.

### Candidate schedules (§6.4)

Because `Σ m_k* = N_srt` exactly (an integer, by construction of Stage 1), the fractional parts
of the `m_k*` across active types must themselves sum to an integer `r`. That means: take every
active type's target, round **down** by default, then round **up** ("ceil") exactly `r` of them
— any choice of *which* `r` types round up gives a valid integer schedule summing to `N_srt`. The
app enumerates **all** `C(K', r)` such choices (`K'` = number of active types), plus, as an extra
safety net, the `K` "canonical" schedules that put every sortie on a single type (the same seed
columns the paper's full column-generation algorithm — §6.3 — starts from).

This is exactly what the paper recommends in practice: *"the full column generation loop is
replaced by direct enumeration of the floor/ceil neighbourhood... small, which is small for
K ≤ 4."* The app extends this to `K` up to 12 (`C(12,6) = 924` candidates worst case — trivial for
a browser).

### The feasibility LP (§6.2)

Given the candidate schedules as columns of a matrix `A` (`A_jk` = flying hours on type `k` in
candidate `j`), solve

```
min  Σ ε_k
s.t. A^T s + ε = h*        (coverage, per type)
     Σ s_j = 1              (probabilities)
     s ≥ 0, ε ≥ 0
```

`ε_k` is a "coverage deficit" slack; if the optimal objective is exactly `0`, `h*` is achieved
*exactly* as a convex combination (probability mixture) of the candidate schedules.

**By Proposition 3**, because this LP has `K+1` equality constraints, its optimal (basic
feasible) solution has **at most `K+1` nonzero probabilities** — regardless of how many
candidates were generated. In the paper's toy example (`K=2`) exactly 2 schedules end up with
positive probability; you'll see the same sparsity in the app's "Stage 2" table.

### How the LP is actually solved: a two-phase simplex, written from scratch

`script.js` implements a genuine dense-tableau **two-phase simplex method** (`twoPhaseSimplex`,
`runSimplex`, `pivotTableau`, `computeObjRow` in `script.js`) — no external library:

1. **Phase 1**: add one artificial variable per equality row, minimize their sum. If the minimum
   isn't `0`, the candidate set is infeasible (shouldn't happen given the construction above, but
   the app checks and reports it).
2. **Phase 2**: re-price the tableau with the *real* objective (`Σ ε_k`) and re-optimize,
   forbidding artificial variables from re-entering the basis.
3. **Bland's rule** (always pick the lowest-indexed eligible entering/leaving variable) is used
   throughout to guarantee the algorithm terminates even in degenerate cases.
4. **Dual values** (`λ_k`, the paper's "marginal coverage value" signal from §6.3) fall out of the
   final tableau for free: the artificial column for row `i` always holds `B⁻¹eᵢ`, so its final
   reduced cost is exactly `−λ_i`. These are displayed under Stage 2 for `K ≤ 8`.

**Operational meaning of the result:** each period (day/month), flip a weighted coin according to
the `s_j` probabilities and fly whichever schedule wins. Over many periods, expected coverage
converges to exactly `h*`, and the attacker — who only ever sees the long-run policy, not the
day's specific draw — cannot find a systematically weaker type to exploit.

---

## 7. Stage 3 — concrete timetables (paper §7)

Given one integer schedule `(m_1,...,m_K)` (a "plan"), Stage 3 makes it flyable:

### 7.1 Spreading sorties across individual barriers

Within a type, the `m_k` sorties are split as evenly as possible across its `n_k` individual
barriers: barrier `i` gets `q_i = ⌊m_k/n_k⌋ + 1` if `i` is one of the first `(m_k mod n_k)`
barriers, else `⌊m_k/n_k⌋`. Barrier `i`'s own patrol interval is then `Δ_i = T/q_i`, and its
individual coverage is `p_i = W·q_i/T`.

*(If `m_k = 0` for a type in this particular plan, its barriers get `q_i = 0` — completely
unpatrolled **under this one plan**. That's fine: the app flags it clearly, because the mixed
strategy from Stage 2 guarantees the barrier *is* covered under the plan's sibling schedules, and
the expected coverage across the mix still equals `h*`.)*

### 7.2 Randomised phase allocation

If every barrier always patrolled at the exact same clock times every day, an attacker who
watches for a few days could learn the schedule and strike in the predictable gap right after a
patrol ends. To prevent this, **each barrier independently draws its own random phase offset**
every period:

```
φ_i ~ Uniform[0, Δ_i − W)
t_{i,j} = φ_i + j·Δ_i     for j = 0, 1, 2, ...
```

Randomising the phase this way (rather than deriving all of a type's barriers from one shared
draw) is deliberate (Remark 8): if an adversary infers one barrier's timing, it reveals nothing
about the others'. Crucially, the *coverage probability* `p_i = W/Δ_i` doesn't depend on where
`φ_i` lands (Remark 7) — randomising the phase is "free" from a coverage-guarantee point of view;
it only helps against a watching adversary.

**Code:** `buildPlan()` draws a fresh `Math.random()`-based `φ_i` for every barrier every time you
click "Run Algorithm" — reload/rerun to see the timetable shuffle while the coverage numbers stay
fixed.

### 7.3 Aircraft assignment

All sorties across all barriers (for a given plan) are collected, sorted by departure time, and
assigned to physical aircraft with a **greedy round-robin**: cycle through the `N` aircraft in
turn, giving a sortie to the first one that (a) isn't blocked by the gap constraint — its previous
sortie started at least `G = τ_p + τ_r` hours before this one — and (b) still has flying-hour
budget left (`hours_flown + τ_p ≤ F`). This exactly matches the paper's Algorithm 1, Stage 3.

*Note: this greedy heuristic is not a guaranteed-optimal bin-packing — the paper doesn't claim
one either. With independently randomised phases, sorties can occasionally cluster tightly enough
that a handful can't be slotted into any aircraft that period, even when the total flying-hour
budget would technically allow it. The app surfaces this honestly (an "N sorties unassigned"
warning) rather than hiding it; if you see it often, it's a sign you're close to the minimum
fleet-size threshold (Section 6 of the app / §8 of the paper) and should consider a larger `N`.*

---

## 8. Minimum fleet size (paper §8)

For a desired coverage level `θ ∈ [0,1]` (every type must reach at least `P_k ≥ θ`), summing the
coverage requirement over all barriers gives a closed-form minimum fleet size:

```
N_min(θ) = ⌈ θ·T·N_b / (μ·F) ⌉
```

Two thresholds matter most:

- **`θ = 0.5`** — the "zero expected loss" threshold (`z* ≥ 0`): the fleet is just large enough
  that the defender doesn't lose value on average even under the worst-case attack.
- **`θ = 1`** — "guaranteed full coverage": every barrier is protected 100% of the time.

The app reports both, plus your custom `θ` slider value, each compared against your current `N`.

---

## 9. Why floor/ceil mixing is worst-case optimal (paper §11)

You might wonder: since many different mixes of integer schedules can all achieve the same
*expected* coverage `h*`, does it matter *which* one you use? The paper proves it does.

**Lemma 4**: in *any* valid mix that reproduces `h*` exactly, for every type `k` there must be at
least one schedule in the mix that assigns `m_k ≤ ⌊m_k*⌋` sorties to it (you can't avoid
occasionally under-shooting every type — that's just what an average made of integers has to look
like when the average itself is fractional).

**Theorem 5**: because of Lemma 4, the *worst* realized outcome across any valid mix is bounded by
a fixed quantity `W*` that depends only on the floors `⌊m_k*⌋` — and the floor/ceiling mix
(exactly the candidate-generation scheme in §6.4, used here) **achieves** that bound exactly. Any
"more diversified" mixing scheme (spreading further from the floor/ceiling neighbourhood, hoping
to look less predictable) can only make some realized period's coverage *worse*, never better,
because an adaptive attacker who watches over many periods will simply concentrate strikes in
whichever periods happen to be under-covered. **Diversifying beyond floor/ceiling never helps and
can only hurt** (§11.4).

This is why Stage 2 restricts its candidate search to the floor/ceiling neighbourhood rather than
trying to be "extra random" — it's already provably the best worst-case choice.

---

## 10. Baseline comparison (paper §12)

The app's bottom section ("Comparison with Baseline Patrol Policies") benchmarks four intuitive
but suboptimal heuristics against the Stackelberg-optimal answer, generalised from the paper's
worked example to whatever `K` you've configured:

| Policy | What it does | Typical failure mode |
|---|---|---|
| **Fixed Deterministic** | Equal sorties per *individual barrier*, fixed clock every day | A patient attacker learns the exact schedule and strikes the instant a patrol ends — effective coverage is treated as `0`, so `U_d(k) = −v_k` for every type. |
| **Uniform Random** | Same equal-sortie allocation, but randomised start times | Ignores that barrier types differ in value — a low-value type with the same coverage as a high-value one is still the "cheapest" one for the attacker to hit, since `U_d` scales with `v_k`. |
| **Value-Proportional** | Sorties ∝ `n_k·v_k` (spend more where total value is higher) | Over-protects already-safe high-value types and starves low-value types below the 50% breakeven coverage — the attacker simply targets whichever type was shorted. |
| **Greedy (Highest-Value First)** | Fully covers the most valuable type, then the next, etc., until the budget runs out | Leaves the least valuable type(s) *completely* unpatrolled once the budget is exhausted — the obvious, exploitable gap. |
| **Stackelberg Optimal** | This tool's Stage 1 answer | Equalizes `U_d(k)` across every active type by construction, so *no* type is a "weakest link" — provably the highest achievable game value (`min_k U_d(k)`). |

The app computes and displays the game value (`min_k U_d(k)`) for all five and highlights the
best one — it will always be the Stackelberg-optimal row, illustrating the paper's central claim.

### Validated against the paper's own published numbers

Section 12 of the paper works through this exact comparison for a concrete 10-barrier instance
(`n=[4,3,3]`, `v=[30,20,10]`, `μ=3`, `T=720h`, `B_eff=1209h`, `N_srt=403`) and publishes a summary
table (its Table 5). Feeding those same parameters into this app (`N=22, K=3, n=[4,3,3],
v=[30,20,10], τ_p=3, τ_s=6, T_days=30, F=55`, which reproduces `μ=3` and `B_eff=1209` exactly)
reproduces the paper's table **exactly** for every row except one near-miss, explained below:

| Policy | Paper's `h` | This app's `h` | Paper's game value | This app's game value |
|---|---|---|---|---|
| Fixed Deterministic | 480, 360, 360 | 483, 363, 363 | −30.00 | −30.00 ✓ |
| Uniform Random | 483, 363, 363 | 483, 363, 363 ✓ | +0.08 | +0.08 ✓ |
| Value-Proportional | 690, 345, 174 | 690, 345, 174 ✓ | −5.17 | −5.17 ✓ |
| Greedy (Highest-Value) | 960, 249, 0 | 960, 249, 0 ✓ | −10.00 | −10.00 ✓ |
| **Stackelberg Optimal** | 482, 362, 365 | 482, 362, 365 ✓ | **+0.13** | **+0.13** ✓ |

Every game value matches exactly, and every allocation matches exactly **except** the paper's
printed `h` for "Fixed Deterministic," which is inconsistent with its own budget: `480+360+360`
sorties-worth sums to only `400` of the stated `403` sorties, even though the paper's prose
describes the identical allocation method for both "Fixed Deterministic" and "Uniform Random"
("40 sorties each, three barriers receiving 41 to absorb the remainder"). This looks like a minor
transcription slip in the published table rather than a real modelling difference — and it has no
effect on the reported game value anyway, since that baseline's payoff is defined as `U_d(k) = −v_k`
for every type regardless of `h_k` (the whole premise of "Fixed Deterministic" is that a predictable
clock lets the attacker treat coverage as zero). This app's code distributes the leftover
`N_srt mod N_b` sorties round-robin **across types** (one extra barrier's worth per type, per
pass) — matching the paper's stated method precisely, and consistently for both baselines.

### Also validated against the paper's toy example (§9)

The paper's second, fully hand-traceable example (`N=2` aircraft, `K=2` types "High"/"Medium",
`n_H=n_M=1`, `v_H=6, v_M=2`, `T=24h`, `τ_p=2h`, `τ_s=4h`, `τ_r=4h`, `F=6h`) was also run through
this app's code during development. Every number it derives by hand — `z*=1.5`, `h_H=5, h_M=7`,
`P_H=0.625, P_M=0.875`, the two candidate schedules `(3,3)` and `(2,4)`, the `50/50` mix,
6-hours-flown-per-aircraft in both timetables, `N_min(0.5)=2`, `N_min(1)=3` — was reproduced
**exactly** (down to floating-point noise around `1e-16`).

### Other checks performed

Beyond the two worked examples above, the implementation was also stress-tested with: a fleet so
small that barrier types cascade out of the active set one by one (confirms Remark 5's iterative
removal, and that `min_k U_d(k)` over *all* types — active or not — still lands exactly on `z*`,
matching the post-optimality consistency check in Remark 3); `K=1` and `K=12` (the app's allowed
range); a zero-sortie budget (`N_srt=0`); and a perfectly symmetric configuration where the
optimal allocation is already integer (so Stage 2 skips mixing entirely, as it should). All
behaved correctly with no crashes or NaNs.

---

## 11. Notation summary (paper's own table, for quick reference)

| Symbol | Meaning |
|---|---|
| `N, K` | Number of aircraft; number of barrier types |
| `n_k, v_k` | Count and value of barriers of type `k` |
| `N_b = Σ n_k` | Total number of individual barriers |
| `T, τ_p, τ_s, W, μ` | Planning horizon, patrol duration, safe period, protection window, window multiplier |
| `τ_r, G = τ_p+τ_r` | Turnaround; minimum gap between sortie starts (same aircraft) |
| `F, B, N_srt, B_eff` | Budget per aircraft; fleet total; integer sorties; effective budget |
| `h_k` | Total flying hours on barriers of type `k` |
| `P_k` | Coverage probability for one barrier of type `k` |
| `U_d(k; h)` | Defender's expected utility when the attacker strikes type `k` |
| `z*` | Stackelberg game value (optimal worst-case defender utility) |
| `d_k = n_k T/(2μv_k)` | Sensitivity coefficient for type `k` |
| `m_k, m_jk` | Sortie count for type `k` (in schedule `j`) |
| `A_jk` | Flying hours on type `k` in pure schedule `j` |
| `s_j` | Mixing probability of pure schedule `j` |
| `ε_k` | Feasibility slack (coverage deficit) for type `k` in Stage 2 |
| `λ_k` | Dual variable of the Stage-2 coverage constraint (marginal coverage value) |

---

## 12. File map

| File | Purpose |
|---|---|
| `index.html` | Page structure: the parameter form and the seven output sections. No logic lives here. |
| `style.css` | Minimal, framework-free styling. |
| `script.js` | **All** the algorithmic work: the simplex LP solver, Stages 1–3, minimum fleet size, and the four baseline policies, plus the rendering functions that turn results into HTML. |
| `Explanation.md` | This document. |

To run: open the folder in an editor with a "Live Server" extension (or any static file server)
and open `index.html`. The page auto-runs once with the default 22-aircraft scenario on load;
change any parameter (including adding/removing barrier types) and click **Run Algorithm** to
recompute everything.
