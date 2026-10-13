'use strict';

/* ============================================================
   Viva revision deck: every definition, theorem, lemma, remark,
   equation and trick in the paper, plus likely counter-questions.
   Reorderable (top / up / down / bottom), with "understood" (green,
   +1) and "not yet" (red, −1) counters. Saved in localStorage.
   ============================================================ */

(() => {
  const SEC = {
    1: '§1 Introduction', 2: '§2 Problem parameters', 3: '§3 Coverage model', 4: '§4 The Stackelberg game',
    5: '§5 Stage 1: LP and closed form', 6: '§6 Stage 2: mixed strategy', 7: '§7 Stage 3: scheduling',
    8: '§8 Minimum fleet size', 9: '§9 Worked toy example', 10: '§10 Algorithm 1', 11: '§11 Why floor/ceil is optimal',
    12: '§12 Baseline comparison', 13: 'Beyond the paper: viva preparation',
  };
  const TYPE_CLASS = { Definition: 'info', Theorem: 'ok', Lemma: 'ok', Proposition: 'ok', Equation: 'info', Remark: 'warn', Trick: 'ok', Assumption: 'warn', Insight: 'info', Critical: 'bad', Question: 'warn', Example: 'info', Concept: 'info' };

  // [section, type, title, statement, details (toggle; '' = none)]
  const P = [
    // ---------------- §1
    [1, 'Concept', 'The problem in one sentence', 'A defender allocates a fleet of aircraft to protect a set of barriers against an intelligent attacker who picks the most vulnerable target.', '<b>Q:</b> Why is this a game and not just an optimisation? <b>A:</b> The attacker\'s choice depends on the defender\'s policy. Whatever you do, the opponent responds to it, so you must optimise against a best response, not a fixed threat.'],
    [1, 'Assumption', 'What the attacker knows', 'The attacker observes the defender\'s <b>policy</b> (the probabilities of each plan) but <b>not today\'s specific schedule</b>.', '<b>Q:</b> What if the attacker could see today\'s schedule? <b>A:</b> Then mixing is useless: the attacker hits whatever is uncovered right now. The defender\'s value drops to the worst pure plan; only covering everything (θ = 1) helps.'],
    [1, 'Definition', 'Stackelberg security game', 'The defender is the <b>leader</b> who commits to a mixed strategy; the attacker is the <b>follower</b> who observes it and best-responds (ref. [1], Tambe).', '<b>Q:</b> Why leader–follower and not simultaneous (Nash)? <b>A:</b> Real defenders publish/reveal routines over time (surveillance), so commitment is realistic. In a zero-sum game the two coincide anyway: the Stackelberg strategy is a maximin strategy (minimax theorem), so the choice does not change the answer here.'],
    [1, 'Concept', 'Three-stage pipeline', 'Stage 1: LP → optimal flying hours h* per barrier type. Stage 2: feasibility LP → mixed strategy s* over integer sortie plans. Stage 3: concrete timetables with aircraft assignments.', '<b>Q:</b> Why decompose instead of one big model? <b>A:</b> Each stage is small and exactly solvable: a continuous relaxation (Stage 1), then implementing it with integers (Stage 2), then scheduling (Stage 3). A single mixed-integer Stackelberg model (DOBSS-style) over all timetables would be enormous.'],
    [1, 'Concept', 'Second goal: fleet sizing', 'The paper also characterises the minimum fleet for zero expected loss and for guaranteed full coverage.', ''],

    // ---------------- §2
    [2, 'Definition', 'Fleet and barrier symbols', 'N aircraft; K barrier types; n<sub>k</sub> barriers of type k, each worth v<sub>k</sub>; N<sub>b</sub> = Σ n<sub>k</sub> total barriers.', ''],
    [2, 'Definition', 'Planning horizon T', 'The schedule is planned over a horizon T (hours) and repeats periodically.', '<b>Q:</b> What is T in the worked examples? <b>A:</b> 24 h in the toy (§9); 720 h = 30 days in §12.'],
    [2, 'Definition', 'Patrol, safe period, protection window', 'τ<sub>p</sub> = flying hours per sortie; τ<sub>s</sub> = safe period after the patrol ends; protection window W = τ<sub>p</sub> + τ<sub>s</sub>.', '<b>Q:</b> Justify the safe period. <b>A:</b> A freshly swept barrier stays effectively protected for a while (intrusions take time to stage, or are detected later). It\'s a modelling assumption; a sensitivity analysis on τ<sub>s</sub> is a good extension.'],
    [2, 'Definition', 'Window multiplier μ = W/τ<sub>p</sub>', 'Each flying hour buys μ protection-hours. It scales every coverage formula.', '<b>Q:</b> Value of μ in the examples? <b>A:</b> 3 in both the toy (W = 6, τ<sub>p</sub> = 2) and §12 (W = 9, τ<sub>p</sub> = 3).'],
    [2, 'Definition', 'Turnaround τ<sub>r</sub> and gap G', 'τ<sub>r</sub> = restart period after landing; G = τ<sub>p</sub> + τ<sub>r</sub> = minimum gap between consecutive sortie <em>starts</em> of the same aircraft.', '<b>Q:</b> Where does τ<sub>r</sub> enter the model? <b>A:</b> Only in Stage 3 (through G). Stages 1–2 and N<sub>min</sub> ignore it, so a large τ<sub>r</sub> can make a Stage-1 plan unschedulable. That is a real limitation to mention.'],
    [2, 'Definition', 'Budgets F and B', 'F = max flying hours per aircraft per period; B = N·F = total fleet hours.', ''],
    [2, 'Equation', 'N<sub>srt</sub> and B<sub>eff</sub>', 'N<sub>srt</sub> = ⌊B/τ<sub>p</sub>⌋ whole sorties; B<sub>eff</sub> = N<sub>srt</sub>·τ<sub>p</sub> is the integer-feasible budget.', ''],
    [2, 'Remark', 'Remark 1: why use B<sub>eff</sub>', 'B<sub>eff</sub> ≤ B with a gap of less than one sortie. Stage 1 is solved with B<sub>eff</sub> so that Stage 2 closes with zero residual gap.', '<b>Why it matters:</b> with B<sub>eff</sub>, Σ m*<sub>k</sub> = N<sub>srt</sub> is an integer, which is exactly what makes the floor/ceiling construction work (§6.4). The paper says the gap is “at most τ<sub>p</sub> − 1 hours”, which is true only when B and τ<sub>p</sub> are integers; in general it is “strictly less than τ<sub>p</sub>”.'],

    // ---------------- §3
    [3, 'Definition', 'Definition 1: coverage probability', 'P<sub>k</sub> = μh<sub>k</sub> / (n<sub>k</sub>T): the fraction of the horizon a given barrier of type k is protected.', '<b>Derivation:</b> h<sub>k</sub> flying hours create μh<sub>k</sub> protection-hours, spread over n<sub>k</sub> barriers × T hours = n<sub>k</sub>T barrier-hours.'],
    [3, 'Insight', 'Coverage = probability of catching a random-time attack', 'Because P<sub>k</sub> is a time fraction, it equals the probability that an attack at a uniformly random moment finds the barrier protected.', '<b>Q:</b> And if the attacker chooses the moment cleverly? <b>A:</b> Then time-averaged coverage is not enough. See the phase-timing point in §7.'],
    [3, 'Assumption', 'Sorties spread uniformly in time', 'The formula assumes sorties on a barrier type are distributed uniformly in time, so protection windows do not overlap. Stage 3 enforces this.', '<b>Q:</b> What if two windows overlap? <b>A:</b> Overlapping hours are counted twice in the formula but protect only once, so real coverage is lower than P<sub>k</sub>.'],
    [3, 'Remark', 'Remark 2: the range of P<sub>k</sub>', 'P<sub>k</sub> ≤ 1 requires h<sub>k</sub> ≤ n<sub>k</sub>T/μ; full coverage needs exactly h<sub>k</sub> = n<sub>k</sub>T/μ.', '<b>Q:</b> Does LP (4) enforce h<sub>k</sub> ≤ n<sub>k</sub>T/μ? <b>A:</b> No, it has no upper bound. With a very large budget the closed form can give P<sub>k</sub> &gt; 1, where the model is invalid (it would “reward” coverage beyond 100%). Adding h<sub>k</sub> ≤ n<sub>k</sub>T/μ fixes it.'],
    [3, 'Trick', 'Linearity of coverage in hours', 'P<sub>k</sub> is linear in h<sub>k</sub>, hence payoffs are linear in h. This is what makes Stage 1 a linear programme.', ''],

    // ---------------- §4
    [4, 'Concept', '§4.1 Players and actions', 'Defender moves first by committing to a mixed patrol policy; attacker observes it and selects a target barrier.', ''],
    [4, 'Definition', 'Definition 2: pure strategy', 'An integer sortie allocation (m<sub>1</sub>, …, m<sub>K</sub>), m<sub>k</sub> ≥ 0, Σ m<sub>k</sub> = N<sub>srt</sub>; flying hours a<sub>k</sub> = m<sub>k</sub>τ<sub>p</sub>.', '<b>Q:</b> Must a pure strategy use all N<sub>srt</sub> sorties? <b>A:</b> Yes, by definition. This is why every plan, and h*, lies on the hyperplane Σ h = B<sub>eff</sub> (used in Prop. 3 and in the ε observation in §6).'],
    [4, 'Definition', 'Definition 3: mixed strategy', 'A probability distribution s over J pure strategies; expected hours h<sub>k</sub> = Σ<sub>j</sub> A<sub>jk</sub>s<sub>j</sub>.', ''],
    [4, 'Equation', 'Payoff u<sub>d</sub>(k) = v<sub>k</sub>(2P<sub>k</sub> − 1)', 'Gain v<sub>k</sub> if covered (prob. P<sub>k</sub>), lose v<sub>k</sub> if not. Zero-sum: u<sub>a</sub> = −u<sub>d</sub>.', '<b>Q:</b> Why symmetric ±v<sub>k</sub>? <b>A:</b> A simplification. General security games have four payoffs (defender/attacker × covered/uncovered) and are general-sum, which needs methods like DOBSS. Symmetric zero-sum payoffs give the closed form.'],
    [4, 'Equation', 'Eq. 2: payoff in terms of hours', 'U<sub>d</sub>(k; h) = v<sub>k</sub>(2μh<sub>k</sub>/(n<sub>k</sub>T) − 1): linear in h<sub>k</sub> with slope 2μv<sub>k</sub>/(n<sub>k</sub>T).', ''],
    [4, 'Insight', 'Break-even at 50% coverage', 'U<sub>d</sub>(k) &lt; 0 whenever P<sub>k</sub> &lt; ½: below half coverage the defender expects to lose on that type.', ''],
    [4, 'Equation', 'Eq. 3: the defender\'s maximin problem', 'max<sub>h ≥ 0, Σh = B<sub>eff</sub></sub> min<sub>k</sub> U<sub>d</sub>(k; h). Inner min = attacker\'s best response; outer max = defender\'s commitment.', ''],
    [4, 'Remark', 'Remark 3: attacker indifference at the optimum', 'If U<sub>d</sub>(k′) &gt; U<sub>d</sub>(k″) at an optimum, shift hours from k′ to k″ to raise the worst case, a contradiction. So all active types satisfy U<sub>d</sub>(k; h*) = z*; inactive types satisfy U<sub>d</sub> ≥ z*.', '<b>Q:</b> Is the argument airtight? <b>A:</b> It needs a <em>small</em> shift (so k′ stays above k″) and continuity/linearity of U<sub>d</sub>, both true here. With several equally-worst types you shift a little to all of them.'],
    [4, 'Insight', 'Zero-sum ⇒ Stackelberg = maximin = Nash', 'For zero-sum games the minimax theorem makes the commitment strategy the same as a maximin/Nash strategy, so it stays optimal even if the attacker <em>doesn\'t</em> observe the policy.', '<b>Q:</b> Then what does commitment buy? <b>A:</b> Nothing extra in value, but also no loss: the strategy is robust to whether or not it\'s observed. In general-sum games commitment can strictly help the leader.'],
    [4, 'Assumption', 'The attacker picks a <em>type</em>, not a barrier', 'The model lets the attacker choose a barrier type; all barriers of a type are treated as equally covered.', '<b>Q:</b> Is that true after Stage 3? <b>A:</b> Only approximately: sortie counts within a type differ by one (e.g. 41 vs 40). See the critical point on the extra-sortie barrier in §7.'],

    // ---------------- §5
    [5, 'Equation', 'LP (4): Stage 1 formulation', 'max z s.t. z ≤ v<sub>k</sub>(2μh<sub>k</sub>/(n<sub>k</sub>T) − 1) ∀k (C1); Σ h<sub>k</sub> = B<sub>eff</sub> (C2); h<sub>k</sub> ≥ 0 (C3).', ''],
    [5, 'Trick', 'The epigraph trick: max–min → LP', 'Replace min<sub>k</sub> f<sub>k</sub>(h) by a new variable z with z ≤ f<sub>k</sub>(h) for every k, then maximise z. At the optimum z equals the smallest f<sub>k</sub>.', '<b>Q:</b> Why does this work? <b>A:</b> z is pushed up until it hits the lowest constraint, so z = min<sub>k</sub> f<sub>k</sub> at the optimum. The trick works whenever each f<sub>k</sub> is linear (or concave).'],
    [5, 'Remark', 'Size of LP (4); always feasible and bounded', 'K+1 variables (h<sub>1</sub>…h<sub>K</sub>, z). The paper says K+2 constraints before non-negativity; always feasible and bounded.', '<b>Count it yourself before the viva:</b> C1 gives K constraints and C2 gives 1, i.e. K+1; the paper\'s “K+2” may count something else. Feasible: any split of B<sub>eff</sub> plus a low enough z. Bounded: z ≤ v<sub>k</sub>(2μB<sub>eff</sub>/(n<sub>k</sub>T) − 1).'],
    [5, 'Theorem', 'Theorem 1: closed-form optimum', 'd<sub>k</sub> = n<sub>k</sub>T/(2μv<sub>k</sub>); z* = (B<sub>eff</sub> − TN<sub>b</sub>/(2μ)) / Σ<sub>k</sub> d<sub>k</sub>; h*<sub>k</sub> = d<sub>k</sub>(z* + v<sub>k</sub>). Assumes all types active (checked afterwards).', ''],
    [5, 'Trick', 'Proof of Theorem 1: binding constraints → linear system', 'All (C1) bind (Remark 3), so v<sub>k</sub>(2μh<sub>k</sub>/(n<sub>k</sub>T) − 1) = z* ⇒ h<sub>k</sub> = d<sub>k</sub>(z* + v<sub>k</sub>). Substitute into Σh<sub>k</sub> = B<sub>eff</sub> and solve for z*.', '<b>Write it out once by hand.</b> z*Σd<sub>k</sub> + Σd<sub>k</sub>v<sub>k</sub> = B<sub>eff</sub>, and Σd<sub>k</sub>v<sub>k</sub> = TN<sub>b</sub>/(2μ).'],
    [5, 'Trick', 'Σ d<sub>k</sub>v<sub>k</sub> = TN<sub>b</sub>/(2μ)', 'd<sub>k</sub>v<sub>k</sub> = n<sub>k</sub>T/(2μ): the values cancel, so the sum depends only on the barrier count.', ''],
    [5, 'Insight', 'Meaning of d<sub>k</sub>', 'd<sub>k</sub> = flying hours needed to raise type k\'s payoff by one unit (the inverse of the payoff slope). Many barriers or low value ⇒ large d<sub>k</sub>.', '<b>Units check:</b> d<sub>k</sub> is in hours per value-unit; z* is in value-units; h*<sub>k</sub> = d<sub>k</sub>(z* + v<sub>k</sub>) is in hours ✓.'],
    [5, 'Insight', 'Meaning of TN<sub>b</sub>/(2μ)', 'The hours needed to hold every barrier at exactly 50% coverage (the break-even point). z* is the budget surplus over break-even divided by total sensitivity Σd<sub>k</sub>.', ''],
    [5, 'Remark', 'Remark 4: sign of z*', 'z* &gt; 0 iff B<sub>eff</sub> &gt; TN<sub>b</sub>/(2μ): the fleet\'s protection capacity exceeds half the total barrier-hours. z* &lt; 0 means even optimal patrolling loses on average.', ''],
    [5, 'Concept', '§5.3: the sign of h*<sub>k</sub>', 'Since d<sub>k</sub>, v<sub>k</sub> &gt; 0, the sign of h*<sub>k</sub> = d<sub>k</sub>(z* + v<sub>k</sub>) is the sign of z* + v<sub>k</sub>.', ''],
    [5, 'Concept', 'Case 1: z* &gt; 0', 'Net gain: z* + v<sub>k</sub> &gt; 0 for all k, so every type gets positive hours.', ''],
    [5, 'Concept', 'Case 2: −v<sub>k</sub> &lt; z* ≤ 0', 'Net loss, but type k is still defended: abandoning it would hand the attacker v<sub>k</sub> &gt; |z*|, worse than the current loss.', ''],
    [5, 'Concept', 'Case 3: z* ≤ −v<sub>k</sub>', 'Type k is indefensible: the formula gives h*<sub>k</sub> ≤ 0, so k leaves the active set. Leaving it open (loss v<sub>k</sub>) is no worse than the loss |z*| already suffered elsewhere.', ''],
    [5, 'Proposition', 'Proposition 2: active set', 'A = {k : z* &gt; −v<sub>k</sub>}. All types are active when z* ≥ 0; a type is inactive only if z* &lt; 0 and |z*| ≥ v<sub>k</sub>.', '<b>Corollary:</b> types drop out in increasing order of value. The cheapest type is abandoned first.'],
    [5, 'Remark', 'Remark 5: iterative removal', 'If any h*<sub>k</sub> &lt; 0, remove those types and re-solve Theorem 1 over the rest. The LP does this automatically; the closed form needs the manual step.', '<b>Q:</b> Does it converge, and in what order? <b>A:</b> At most K−1 removals. Removing a type can only lower z* (the formula with negative hours over-counts the budget), so lowest-value types leave first. It is equivalent to the water-filling picture below.'],
    [5, 'Trick', 'Water-filling view (equivalent to §5)', 'z* is the unique root of F(z) = Σ<sub>k</sub> d<sub>k</sub>·max(0, z + v<sub>k</sub>) = B<sub>eff</sub>. F is increasing and piecewise linear, with kinks at z = −v<sub>k</sub> where types switch on.', 'Not stated this way in the paper, but it is the cleanest way to explain active/inactive types on a whiteboard. It also proves uniqueness of z*.'],
    [5, 'Insight', 'Equal payoffs ≠ equal coverage', 'From v<sub>k</sub>(2P<sub>k</sub> − 1) = z*: P*<sub>k</sub> = (1 + z*/v<sub>k</sub>)/2. When z* &gt; 0, <b>lower-value types get higher coverage</b>; when z* &lt; 0, higher-value types do.', '<b>Check:</b> toy example, z* = 1.5: P<sub>H</sub> = (1 + 1.5/6)/2 = 0.625 and P<sub>M</sub> = (1 + 1.5/2)/2 = 0.875 ✓. This is the most counter-intuitive fact in the paper and a likely question.'],
    [5, 'Insight', 'Hours per barrier barely depend on value near break-even', 'h*<sub>k</sub>/n<sub>k</sub> = (T/2μ)(1 + z*/v<sub>k</sub>). When z* ≈ 0, every barrier gets ≈ T/(2μ) hours regardless of v<sub>k</sub>.', '<b>§12 example:</b> High ≈ 120.5 h per barrier, Low ≈ 121.5 h, so a High barrier gets slightly <em>fewer</em> hours despite 3× the value.'],
    [5, 'Insight', 'h* is unique (when all types are active)', 'The equalisation conditions plus the budget give K+1 independent linear equations in K+1 unknowns, so h* and z* are unique. The mixed strategy s* (Stage 2) is generally <em>not</em> unique.', ''],

    // ---------------- §6
    [6, 'Concept', '§6.1: why mixing is needed', 'm*<sub>k</sub> = h*<sub>k</sub>/τ<sub>p</sub> is generally fractional, so no single integer plan achieves h*. A probability mix of integer plans can achieve it on average.', ''],
    [6, 'Trick', 'Fractional parts sum to an integer', 'Because Σ m*<sub>k</sub> = N<sub>srt</sub> (an integer, thanks to B<sub>eff</sub>), the fractional parts of m*<sub>k</sub> sum to an integer r. Exactly r types must round up in each floor/ceil plan.', ''],
    [6, 'Equation', 'Eq. 8: feasibility system', 'A<sup>⊤</sup>s = h*, 1<sup>⊤</sup>s = 1, s ≥ 0: h* must be a convex combination of the candidate plans\' hour vectors.', '<b>Geometry:</b> h* must lie in the convex hull of the columns of A<sup>⊤</sup>.'],
    [6, 'Equation', 'LP (9): Phase-1 formulation', 'min 1<sup>⊤</sup>ε s.t. A<sup>⊤</sup>s + ε = h* (F1), 1<sup>⊤</sup>s = 1 (F2), s, ε ≥ 0 (F3). A zero optimum confirms h* is a convex combination.', ''],
    [6, 'Trick', 'Phase-1 slack', 'Turn a pure feasibility question into an LP by adding non-negative slack and minimising it. Zero optimum ⇔ feasible. The same idea starts every two-phase simplex.', ''],
    [6, 'Critical', 'Look closer: ε can only ever be 0', 'Every plan uses all N<sub>srt</sub> sorties, so Σ<sub>k</sub>(A<sup>⊤</sup>s)<sub>k</sub> = B<sub>eff</sub> = Σ h*<sub>k</sub>. That forces Σε<sub>k</sub> = 0, and with ε ≥ 0, ε = 0. LP (9) is either exactly feasible or <em>infeasible</em>; it never returns a positive “gap”.', '<b>Q:</b> So how would you measure a gap? <b>A:</b> Use two-sided slack (ε<sup>+</sup>, ε<sup>−</sup>) or ≥ constraints. Good to raise yourself; it shows you read the LP carefully.'],
    [6, 'Concept', 'LP duality background', 'Primal min c<sup>⊤</sup>x, Ax = b, x ≥ 0 has dual max b<sup>⊤</sup>y, A<sup>⊤</sup>y ≤ c. Reduced cost c̄<sub>j</sub> = c<sub>j</sub> − a<sub>j</sub><sup>⊤</sup>y (Eq. 10).', ''],
    [6, 'Theorem', 'Complementary slackness', 'At optimality x<sub>j</sub> &gt; 0 ⇒ c̄<sub>j</sub> = 0, and c̄<sub>j</sub> &gt; 0 ⇒ x<sub>j</sub> = 0. A column not yet in the LP can improve the objective iff c̄<sub>j</sub> &lt; 0.', ''],
    [6, 'Equation', 'Duals of LP (9)', 'λ<sub>k</sub> for each coverage row (F1), ν for the probability row (F2). Dual feasibility: a<sub>j</sub><sup>⊤</sup>λ + ν ≤ 0 ∀j, λ<sub>k</sub> ≤ 1.', ''],
    [6, 'Equation', 'Reduced cost of a new plan', 'c̄<sub>j</sub> = 0 − (a<sub>j</sub><sup>⊤</sup>λ + ν). A new plan helps iff a<sub>j</sub><sup>⊤</sup>λ + ν &gt; 0.', ''],
    [6, 'Insight', 'Meaning of λ<sub>k</sub>', 'λ<sub>k</sub> ≥ 0 is the marginal reduction in total slack per extra hour on type k: an “under-coverage signal”. Large λ<sub>k</sub> = type k most urgently needs hours.', ''],
    [6, 'Trick', 'Pricing problem (Eq. 11) solved by sorting', 'max τ<sub>p</sub>Σλ<sub>k</sub>m<sub>k</sub> s.t. Σm<sub>k</sub> = N<sub>srt</sub>, m ≥ 0: put all sorties on the type with the largest λ<sub>k</sub>. A closed form, no search.', '<b>Why:</b> the objective is linear and every sortie costs the same, so the best use of each sortie is the highest-λ type.'],
    [6, 'Concept', 'Column generation loop', '1) Start with K canonical plans (all sorties on one type). 2) Solve LP (9), get λ, ν. 3) Stop if gap = 0. 4) Price a new plan. 5) Add it and repeat.', ''],
    [6, 'Critical', 'The termination claim and the canonical start', 'The paper says column generation ends in ≤ K+1 iterations “by Proposition 3”, but Prop. 3 bounds the <em>support size</em>, not the iteration count. Also, the K canonical plans already reproduce h* exactly (s<sub>k</sub> = h*<sub>k</sub>/B<sub>eff</sub>), so the gap is zero at iteration 1.', '<b>Q:</b> Then why not use the canonical mix? <b>A:</b> It has the right average but each month leaves all but one type unpatrolled (worst month −30 in §12). §11 is exactly the argument for floor/ceil instead.'],
    [6, 'Concept', 'In practice: enumerate floor/ceil candidates', 'For K ≤ 4 the paper replaces column generation with direct enumeration of the floor/ceil neighbourhood of m*.', ''],
    [6, 'Concept', '§6.4: candidate generation', 'Round each m*<sub>k</sub> to floor or ceiling so that Σ = N<sub>srt</sub>: at most 2<sup>K−1</sup> candidates (exactly C(K′, r) with K′ fractional types). ±1 perturbations are added for robustness.', ''],
    [6, 'Proposition', 'Proposition 3: support ≤ K+1 plans', 'LP (9) has K+1 equality constraints, and a basic feasible solution has at most that many non-zeros, so s* uses ≤ K+1 plans regardless of how many candidates exist.', '<b>Sharper (Carathéodory):</b> all plan vectors and h* lie on the hyperplane Σh = B<sub>eff</sub> (dimension K−1), so K plans always suffice. Equivalently, the K+1 rows of LP (9) are linearly dependent. The §12 example uses 3 plans for K = 3.'],
    [6, 'Example', 'Toy example: exactly 2 plans', 'With K = 2 the system has a unique solution, so exactly 2 strategies appear in the support.', ''],
    [6, 'Concept', 'Operational meaning of s*', 'At the start of each period, draw a plan with probabilities s* and fly it. The attacker knows s*, not the draw.', ''],

    // ---------------- §7
    [7, 'Equation', '§7.1: splitting sorties across barriers', 'q<sub>i</sub> = ⌊m<sub>k</sub>/n<sub>k</sub>⌋ + 1[i &lt; (m<sub>k</sub> mod n<sub>k</sub>)]: as even as possible; the first (m<sub>k</sub> mod n<sub>k</sub>) barriers get one extra.', ''],
    [7, 'Equation', 'Eqs. 12–13: interval and individual coverage', 'Δ<sub>i</sub> = T/q<sub>i</sub>; p<sub>i</sub> = W/Δ<sub>i</sub> = Wq<sub>i</sub>/T = μτ<sub>p</sub>q<sub>i</sub>/T.', ''],
    [7, 'Critical', 'The extra sortie always goes to the same barriers', 'With 1[i &lt; m mod n] the leftover sorties always go to the <em>first</em> barriers. In the §12 example, H4, M3 and L3 get 40 sorties in every plan: p = 50.0%, payoff 0, below z* = +0.13. A barrier-level attacker exploits this.', '<b>Fix:</b> randomise which barriers receive the extra sortie each period. Then every barrier\'s expected coverage equals P*<sub>k</sub> again. A neat, defensible improvement.'],
    [7, 'Concept', '§7.2: why fixed start times are dangerous', 'If barrier i is always patrolled at the same clock times, an observer learns the clock and attacks just after a patrol ends.', ''],
    [7, 'Equation', 'Eqs. 14–15: random phase', 'φ<sub>i</sub> ∼ Uniform[0, Δ<sub>i</sub> − W); patrol j starts at t<sub>i,j</sub> = φ<sub>i</sub> + jΔ<sub>i</sub>.', ''],
    [7, 'Remark', 'Remark 6: why Δ<sub>i</sub> − W', 'The upper limit keeps each protection window inside its own cycle (no overlap, no double counting), so exactly W of every Δ<sub>i</sub> hours is covered. Requires Δ<sub>i</sub> &gt; W; true since Δ<sub>i</sub> ≥ 720/41 ≈ 17.6 h &gt; 9 h.', ''],
    [7, 'Remark', 'Remark 7: randomising preserves coverage', 'p<sub>i</sub> = W/Δ<sub>i</sub> does not depend on φ<sub>i</sub>, so z* and all coverage guarantees are unchanged.', ''],
    [7, 'Remark', 'Remark 8: individual vs shared phase draws', 'Each barrier draws its own φ<sub>i</sub>. With one shared draw per type, seeing one barrier reveals all its siblings; with independent draws the attacker must infer n<sub>k</sub> phases.', ''],
    [7, 'Remark', 'Remark 9: two layers of randomness', 'Stage 2 hides <em>which plan</em> (the sortie allocation); Stage 3 hides <em>when</em> sorties fly. They defend against different information threats.', ''],
    [7, 'Critical', 'The cycle start is never covered', 'With φ ∼ U[0, Δ−W), time t = jΔ is never inside a window: window j starts at φ ≥ 0, and window j−1 ends at φ + W − Δ &lt; 0. An attacker who times strikes at cycle boundaries always succeeds.', '<b>Fix:</b> φ ∼ U[0, Δ) with the last window wrapping into the next cycle (as the toy timetable does at midnight). Then coverage is exactly W/Δ at <em>every</em> moment. Remark 7 holds only for a random-time attacker.'],
    [7, 'Critical', 'Daily draw vs. per-period cycle', 'The paper says each barrier draws φ<sub>i</sub> “at the start of each day”, but Δ<sub>i</sub> ≈ 18 h does not divide 24 h, and q<sub>i</sub> sorties are defined per period T.', '<b>Q:</b> Which did you implement? <b>A:</b> One draw per period, t = φ + jΔ for j &lt; q<sub>i</sub>. Be ready to say the paper is ambiguous here.'],
    [7, 'Concept', '§7.3: aircraft assignment', 'Sorties are assigned chronologically with a greedy round-robin, subject to the gap G and the budget F per aircraft. The paper groups aircraft by barrier type.', ''],
    [7, 'Critical', 'Greedy assignment is not guaranteed to succeed', 'The round-robin is a heuristic. With random phases, sorties can bunch up; in one §12 plan, 7 of 403 sorties could not be placed even though total hours suffice.', '<b>Q:</b> How would you guarantee feasibility? <b>A:</b> Model it as interval scheduling / bipartite matching or an ILP. A necessary condition: at every moment, the number of sorties starting within the last G hours ≤ N.'],

    // ---------------- §8
    [8, 'Definition', 'Definition 4: coverage threshold θ', 'Require P<sub>k</sub> ≥ θ for every type k.', ''],
    [8, 'Equation', 'Eq. 16: minimum fleet', 'P<sub>k</sub> ≥ θ ⇔ h<sub>k</sub> ≥ θn<sub>k</sub>T/μ; summing gives B<sub>eff</sub> ≥ θTN<sub>b</sub>/μ, so N<sub>min</sub>(θ) = ⌈θTN<sub>b</sub>/(μF)⌉.', ''],
    [8, 'Equation', 'Eqs. 17–18: the two thresholds', 'θ = ½: zero expected loss (z* ≥ 0). θ = 1: guaranteed full coverage.', '<b>§12 numbers:</b> N<sub>min</sub>(½) = ⌈21.8⌉ = 22 (exactly the fleet!) and N<sub>min</sub>(1) = ⌈43.6⌉ = 44.'],
    [8, 'Remark', 'Remark 10: capacity argument', 'One aircraft flies F/τ<sub>p</sub> sorties × W hours = μF protection-hours. Full coverage of N<sub>b</sub> barriers for T hours needs N<sub>b</sub>T, so N<sub>min</sub>(1) = ⌈N<sub>b</sub>T/(μF)⌉.', ''],
    [8, 'Critical', 'N<sub>min</sub> uses N·F, not B<sub>eff</sub>', 'The derivation requires B<sub>eff</sub> ≥ θTN<sub>b</sub>/μ but divides by F, i.e. uses B = NF. When F isn\'t a multiple of τ<sub>p</sub>, B<sub>eff</sub> &lt; B and N<sub>min</sub> can be off by one. It also ignores turnaround G and assignment feasibility.', ''],

    // ---------------- §9
    [9, 'Example', 'Toy parameters (Table 2)', 'N = 2; K = 2 (High, Medium); n = 1, 1; v = 6, 2; T = 24 h; τ<sub>p</sub> = 2; τ<sub>s</sub> = 4; W = 6; μ = 3; τ<sub>r</sub> = 4; G = 6; F = 6; B = B<sub>eff</sub> = 12; N<sub>srt</sub> = 6.', ''],
    [9, 'Example', 'Toy Stage 1', 'd<sub>H</sub> = 2/3, d<sub>M</sub> = 2; z* = (12 − 8)/(8/3) = 3/2; h*<sub>H</sub> = 5 h, h*<sub>M</sub> = 7 h (sum 12 ✓).', ''],
    [9, 'Example', 'Toy coverage and indifference', 'P<sub>H</sub> = 5/8, P<sub>M</sub> = 7/8; U<sub>d</sub>(H) = U<sub>d</sub>(M) = 3/2. Both (C1) bind.', 'Note the lower-value type (M) gets the higher coverage, because z* &gt; 0.'],
    [9, 'Example', 'Toy Stage 2', 'm* = (2.5, 3.5). Plan A = (3, 3), plan B = (2, 4). Solve 6s<sub>A</sub> + 4s<sub>B</sub> = 5 ⇒ s<sub>A</sub> = s<sub>B</sub> = ½: flip a fair coin each day.', ''],
    [9, 'Example', 'Toy timetables (Tables 3–4)', 'A: H at 00, 08, 16 and M at 04, 12, 20 (AC-1 flies H, AC-2 flies M). B: H at 00, 12 and M at 03, 09, 15, 21. Each aircraft flies 6 h = F; all gaps ≥ G = 6 h.', ''],
    [9, 'Critical', 'Typo: “offset by 4 h = τ<sub>p</sub>”', 'In plan A the M sorties are offset by 4 h, but τ<sub>p</sub> = 2 h in the toy, so “4 h = τ<sub>p</sub>” is wrong (4 h = τ<sub>s</sub> = 2τ<sub>p</sub>).', ''],
    [9, 'Example', 'Coverage per plan', 'Plan A: P<sub>H</sub> = P<sub>M</sub> = 0.75. Plan B: P<sub>H</sub> = 0.50, P<sub>M</sub> = 1.00.', ''],
    [9, 'Example', '§9.5: verification across the mix', 'E[P<sub>H</sub>] = ½(0.75) + ½(0.50) = 0.625; E[P<sub>M</sub>] = 0.875; E[U | H] = ½·3 + ½·0 = 1.5 = E[U | M].', ''],
    [9, 'Insight', 'Mixing creates value', 'Plan A alone: min(3, 1) = 1. Plan B alone: min(0, 2) = 0. The 50/50 mix: 1.5, strictly better than either pure plan.', ''],
    [9, 'Example', 'Toy fleet sizes', 'N<sub>min</sub>(½) = ⌈24/18⌉ = 2 (the toy fleet exactly); N<sub>min</sub>(1) = ⌈48/18⌉ = 3.', ''],

    // ---------------- §10
    [10, 'Concept', 'Algorithm 1 walk-through', 'B<sub>eff</sub> → d<sub>k</sub> → z* → h* → drop negatives and re-solve → candidates near m* → Phase-1 LP → assert zero gap → for each plan in the support: split sorties, draw phases, assign aircraft → report N<sub>min</sub>(½), N<sub>min</sub>(1).', ''],
    [10, 'Insight', 'Computational cost', 'Stage 1: O(K) per pass, ≤ K passes. Stage 2: a tiny LP over C(K′, r) columns. Stage 3: sorting S sorties plus O(S·N) round-robin checks. Everything runs in milliseconds.', '<b>Q:</b> Compare with DOBSS? <b>A:</b> DOBSS solves a mixed-integer LP over pure strategies and attacker types; here zero-sum structure and type-level coverage give a closed form plus a tiny LP.'],
    [10, 'Critical', 'Section 10 heading is empty', 'In the PDF, “10 Solution Algorithm” is a bare heading; Algorithm 1 appears just before it, on p. 14.', ''],

    // ---------------- §11
    [11, 'Concept', 'Motivation: is more variety better?', 'Many mixes reproduce h* with the same expected payoff z*. Would one that varies sorties more widely be safer through unpredictability? The paper shows: no.', ''],
    [11, 'Definition', 'Definition 5: feasible mixed strategies S*', 'Mixes over integer plans (Σ<sub>k</sub> m<sub>jk</sub> = N<sub>srt</sub>) with Σ<sub>j</sub> s<sub>j</sub>m<sub>jk</sub> = m*<sub>k</sub> for all k.', ''],
    [11, 'Insight', 'All of S* has the same expected payoff', 'Payoffs are linear in hours, so every s ∈ S* gives expected payoff z*. Only the realised payoff in a single period differs.', ''],
    [11, 'Definition', 'Definition 6: realised utility and W(s)', 'U<sup>(j)</sup>(k) = v<sub>k</sub>(2μm<sub>jk</sub>τ<sub>p</sub>/(n<sub>k</sub>T) − 1); W(s) = min over plans in the support and over k.', ''],
    [11, 'Trick', 'Monotonicity', 'U<sup>(j)</sup>(k) is strictly increasing in m<sub>jk</sub>: fewer sorties on k in a period is strictly worse if k is attacked then.', ''],
    [11, 'Lemma', 'Lemma 4: you can\'t avoid the floor', 'For every s ∈ S* and every k, some plan in the support has m<sub>jk</sub> ≤ ⌊m*<sub>k</sub>⌋.', '<b>Proof (averaging):</b> if every plan had m<sub>jk</sub> ≥ ⌈m*<sub>k</sub>⌉, the average would be ≥ ⌈m*<sub>k</sub>⌉ &gt; m*<sub>k</sub>, a contradiction. Needs m*<sub>k</sub> to be non-integer.'],
    [11, 'Theorem', 'Theorem 5: floor/ceil is worst-case optimal', 'W* = min<sub>k</sub> v<sub>k</sub>(2μ⌊m*<sub>k</sub>⌋τ<sub>p</sub>/(n<sub>k</sub>T) − 1). Then W(s) ≤ W* for all s ∈ S*, and the floor/ceil mix achieves W(s<sub>FC</sub>) = W*.', '<b>Proof:</b> upper bound from Lemma 4 + monotonicity; achievability because floor/ceil plans never go below the floor on any type.'],
    [11, 'Critical', '“Unique maximiser” is not what is proved', 'The section intro says floor/ceil is the <em>unique</em> maximiser of W(s), but Theorem 5 only shows it attains the maximum. Other mixes whose plans never drop below any floor (e.g. a plan with ⌊m*⌋ + 2 on one type when r ≥ 2) also reach W*.', ''],
    [11, 'Concept', '§11.4: why diversification can\'t help', 'If some plan goes below the floor on k, then by strict monotonicity W(s) &lt; W*. A patient attacker waits for that low period.', ''],
    [11, 'Remark', 'Remark 11: patient vs committed attacker', 'If the attacker must commit before knowing which plan is active, every s ∈ S* is equivalent (all give z*). The theorem is about adaptive attackers who see the plan or attack repeatedly.', ''],
    [11, 'Remark', 'Remark 12: integrality gap', 'The difference between W* and z* is the cost of whole sorties; with many sorties, ⌊m*⌋/m* → 1 and W* → z*.', 'Note the sign: W* ≤ z*, so the gap is z* − W* ≥ 0 (the paper writes W* − z*). §12 example: z* = 0.129, W* = 0.000.'],

    // ---------------- §12
    [12, 'Example', '§12 setup', 'B<sub>eff</sub> = 1209 h, N<sub>srt</sub> = 403, μ = 3, T = 720 h, n = (4, 3, 3), v = (30, 20, 10) (H, M, L).', 'The paper says “barrier parameters as in Table 1”, but Table 1 only lists symbols; the values come from the text. These match N = 22, F = 55, τ<sub>p</sub> = 3, τ<sub>s</sub> = 6.'],
    [12, 'Example', 'Baseline 1: fixed deterministic', 'Equal sorties per barrier on a fixed, published clock. The attacker learns Δ ≈ 18 h and strikes in the gap ⇒ effective P = 0 ⇒ U = −v<sub>k</sub> ⇒ game value −30.', ''],
    [12, 'Example', 'Baseline 2: uniform random', '40–41 sorties per barrier with random phases: h = (483, 363, 363), U ≈ (+0.19, +0.17, +0.08) ⇒ game value +0.08 (Low is the weak link).', ''],
    [12, 'Example', 'Baseline 3: value-proportional', 'Sorties ∝ n<sub>k</sub>v<sub>k</sub> (weights 120 : 60 : 30) ⇒ (230, 115, 58) sorties, h = (690, 345, 174), U ≈ (+13.13, −0.83, −5.17) ⇒ −5.17.', ''],
    [12, 'Example', 'Baseline 4: greedy (high value first)', 'High to full coverage (960 h), Medium gets the remaining 249 h, Low 0 ⇒ U = (+30, −6.17, −10) ⇒ −10.', ''],
    [12, 'Example', 'Stackelberg optimal', 'h ≈ (482, 362, 365); U = +0.13 for every type ⇒ game value +0.13, the highest.', ''],
    [12, 'Critical', 'Table 5 inconsistency', 'Fixed-deterministic hours are printed as 480/360/360 (= 400 sorties, not 403), while the text describes the same split as uniform random (483/363/363). The game value (−30) is unaffected.', ''],
    [12, 'Insight', 'Two lessons of Table 5', '1) Only Stackelberg equalises payoffs: no preferred target. 2) Intuitive value-based policies do worse than plain uniform random, because they starve low-value types below 50%.', ''],
    [12, 'Question', '“Your method beats uniform by only 0.05. So what?”', 'Near break-even (z* ≈ 0) every barrier needs ≈ 50% coverage, so uniform is almost optimal. Away from break-even the gap is large: at N = 10, Stackelberg −9.30 vs uniform −16.31; at N = 30, +6.43 vs +3.75.', 'Plus Stackelberg comes with a <em>guarantee</em> (it is worst-case optimal for any budget), while uniform is only good by coincidence at this budget.'],

    // ---------------- Beyond the paper
    [13, 'Question', 'How does this relate to DOBSS / general SSGs?', 'DOBSS (ref. [2]) solves Bayesian, general-sum Stackelberg games as a MILP over pure strategies. This paper exploits zero-sum payoffs, one attacker type and type-level coverage to get a closed form plus a tiny LP.', ''],
    [13, 'Question', 'Where does “compact representation” appear?', 'Stage 1 optimises <em>marginal</em> coverage (h) instead of probabilities over exponentially many timetables, as in compact security-game formulations. Stage 2 then shows those marginals are implementable by a mix of real plans.', ''],
    [13, 'Question', 'List the model\'s assumptions', 'Zero-sum symmetric payoffs; a single attack; one attacker type; identical barriers within a type; identical aircraft; no transit time from base to barrier; protection is perfect within the window (detection probability 1); the attacker picks a type; attacks at random times.', 'Being able to list these, and say which one you would relax first, is the single best preparation for “limitations” questions.'],
    [13, 'Question', 'What if the values v<sub>k</sub> are mis-estimated?', 'h* changes smoothly (d<sub>k</sub> ∝ 1/v<sub>k</sub>). Near break-even h* barely depends on v at all (h*<sub>k</sub>/n<sub>k</sub> ≈ T/2μ), so the plan is robust there; far from break-even it matters more.', ''],
    [13, 'Question', 'How does μ (or τ<sub>s</sub>) affect the result?', 'Break-even hours TN<sub>b</sub>/(2μ) fall as μ grows, so z* rises: a longer safe period is worth as much as more aircraft. N<sub>min</sub>(θ) ∝ 1/μ.', ''],
    [13, 'Question', 'Is the optimum unique?', 'h* and z* are unique (when all types are active); the mixed strategy s* is not, since many decompositions reproduce h*. Theorem 5 is what selects floor/ceil among them.', ''],
    [13, 'Question', 'What would you do next? (Stage 2 of the MTP)', 'Timing-aware attacker and the full-cycle phase rule; optimal (not greedy) aircraft assignment; randomising the extra-sortie barrier; transit times; heterogeneous aircraft; multiple attacker types (Bayesian); general-sum payoffs.', 'Pick one or two and argue why they matter for real operations.'],
  ];

  SEC[14] = 'My notes';
  const TYPES = [...new Set(P.map(p => p[1])), 'Note'];
  TYPE_CLASS.Note = 'info';

  /* ---------- state ----------
     Built-in points have ids "p0".."p123"; points you add have ids "c1", "c2", …
     edits:   { id: {sec,type,title,body,more} }   (your changes to built-in points)
     custom:  { id: {sec,type,title,body,more,seq} } (points you added)
     deleted: [ids]                                   (built-in points you removed)  */
  const KEY = 'patrolVivaDeck';
  const builtinIds = P.map((_, i) => `p${i}`);
  let state = { order: builtinIds.slice(), green: {}, red: {}, edits: {}, custom: {}, deleted: [], seq: 0 };

  function normalise(s) {
    const st = { order: [], green: {}, red: {}, edits: {}, custom: {}, deleted: [], seq: 0, ...s };
    const fix = k => (typeof k === 'number' || /^\d+$/.test(k) ? `p${k}` : k); // migrate the first version's numeric ids
    st.order = (st.order || []).map(fix);
    ['green', 'red'].forEach(f => { const o = {}; Object.entries(st[f] || {}).forEach(([k, v]) => { o[fix(k)] = v; }); st[f] = o; });
    const known = new Set([...builtinIds, ...Object.keys(st.custom)]);
    const del = new Set(st.deleted);
    st.order = [...new Set(st.order)].filter(id => known.has(id) && !del.has(id));
    [...known].forEach(id => { if (!del.has(id) && !st.order.includes(id)) st.order.push(id); });
    return st;
  }
  try { const saved = JSON.parse(localStorage.getItem(KEY) || 'null'); if (saved) state = normalise(saved); } catch (e) { /* storage unavailable */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ } };

  const isCustom = id => id.startsWith('c');
  function pt(id) {
    if (isCustom(id)) return state.custom[id];
    const b = P[+id.slice(1)];
    return state.edits[id] || { sec: b[0], type: b[1], title: b[2], body: b[3], more: b[4] };
  }
  const label = id => (isCustom(id) ? 'yours' : `#${+id.slice(1) + 1}`);
  const paperKey = id => { const p = pt(id); return [p.sec, isCustom(id) ? 1 : 0, isCustom(id) ? p.seq : +id.slice(1)]; };
  const paperSort = (a, b) => { const x = paperKey(a), y = paperKey(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };

  const open = new Set(), editing = new Set(), fresh = new Set();
  let query = '', typeFilter = 'All';
  const root = document.getElementById('deckRoot');

  root.innerHTML = `
    <div class="deck-controls">
      <input type="search" id="deckSearch" placeholder="Search points (e.g. Lemma 4, d_k, phase)…">
      <div class="seg deck-types" id="deckTypes">${['All', ...TYPES].map(t => `<button data-v="${t}" class="${t === 'All' ? 'on' : ''}">${t}</button>`).join('')}</div>
      <div class="btn-row" style="margin:0">
        <button class="btn small" data-a="new">＋ New point</button>
        <button class="btn ghost small" data-a="paper">Reset to paper order</button>
        <button class="btn ghost small" data-a="weak">Weakest first</button>
        <button class="btn ghost small" data-a="expand">Expand all</button>
        <button class="btn ghost small" data-a="collapse">Collapse all</button>
        <button class="btn ghost small" data-a="zero">Reset counters</button>
        <button class="btn ghost small" data-a="restore" id="restoreBtn" hidden></button>
        <button class="btn ghost small" data-a="export">⬇ Export notes</button>
        <label class="btn ghost small" style="cursor:pointer">⬆ Import notes<input type="file" accept="application/json,.json" id="deckImport" hidden></label>
      </div>
      <div class="stats" id="deckStats" style="margin:.2rem 0 0"></div>
    </div>
    <div class="deck-now" id="deckNow"></div>
    <div id="deckList"></div>
    <div class="deck-toast" id="deckToast" hidden></div>`;

  const strip = h => String(h || '').replace(/<[^>]+>/g, ' ');
  const visible = id => {
    if (editing.has(id)) return true;
    const p = pt(id);
    if (typeFilter !== 'All' && p.type !== typeFilter) return false;
    if (!query) return true;
    return strip(`${p.title} ${p.body} ${p.more} ${SEC[p.sec]} ${label(id)}`).toLowerCase().includes(query);
  };
  const net = id => (state.green[id] || 0) + (state.red[id] || 0);

  function renderStats() {
    const ids = state.order;
    const g = ids.filter(id => net(id) > 0).length, r = ids.filter(id => net(id) < 0).length, u = ids.filter(id => !state.green[id] && !state.red[id]).length;
    const mine = ids.filter(isCustom).length, edited = Object.keys(state.edits).length;
    document.getElementById('deckStats').innerHTML = `<div class="stat"><b>Points</b><span>${ids.length}</span><small>${mine} yours · ${edited} edited</small></div><div class="stat good"><b>Net understood</b><span>${g}</span></div><div class="stat bad"><b>Still shaky</b><span>${r}</span></div><div class="stat"><b>Not reviewed yet</b><span>${u}</span></div>`;
    const rb = document.getElementById('restoreBtn');
    rb.hidden = !state.deleted.length;
    rb.textContent = `↺ Restore deleted (${state.deleted.length})`;
  }

  const ed = (field, html, ph, cls) => `<div class="deck-field ${cls || ''}" contenteditable="true" data-f="${field}" data-ph="${ph}">${html || ''}</div>`;
  function editorHTML(id) {
    const p = pt(id);
    return `<div class="deck-editor">
      <div class="deck-edit-row">
        <label>Section <select data-f="sec">${Object.entries(SEC).map(([k, v]) => `<option value="${k}" ${+k === p.sec ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>Type <select data-f="type">${TYPES.map(t => `<option ${t === p.type ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <span class="deck-tools"><button type="button" data-cmd="bold" title="Bold (⌘/Ctrl+B)"><b>B</b></button><button type="button" data-cmd="italic" title="Italic (⌘/Ctrl+I)"><i>I</i></button><button type="button" data-cmd="sub" title="Subscript">x<sub>k</sub></button><button type="button" data-cmd="sup" title="Superscript">x<sup>2</sup></button><button type="button" data-cmd="list" title="Bulleted list">• List</button></span>
      </div>
      ${ed('title', p.title, 'Title', 'deck-field-title')}
      ${ed('body', p.body, 'Statement: what you would say in one or two sentences')}
      ${ed('more', p.more, 'Details shown when the card is opened (optional): proof sketch, likely question and answer…', 'deck-field-more')}
      <div class="deck-actions">
        <button class="deck-btn green" data-a="save">Save</button>
        <button class="deck-btn" data-a="cancel">Cancel</button>
        <span class="deck-spacer"></span>
        <span class="widget-sub" style="margin:0">⌘/Ctrl+Enter saves · Esc cancels</span>
      </div>
    </div>`;
  }

  function cardHTML(id, pos) {
    const p = pt(id);
    if (editing.has(id)) return `<div class="deck-card editing" data-id="${id}" data-sec="${p.sec}">${editorHTML(id)}</div>`;
    const g = state.green[id] || 0, r = state.red[id] || 0, n = g + r, hasMore = !!strip(p.more).trim(), isOpen = open.has(id);
    const edited = !isCustom(id) && state.edits[id];
    return `<div class="deck-card${isOpen ? ' open' : ''}${hasMore ? ' toggle' : ''}${isCustom(id) ? ' mine' : ''}" data-id="${id}" data-sec="${p.sec}">
      <div class="deck-head">
        <span class="deck-pos" title="Current position">${pos}</span>
        <span class="deck-id" title="Original position in the paper order">${label(id)}</span>
        <span class="pill ${TYPE_CLASS[p.type] || 'info'}">${p.type}</span>
        ${edited ? '<span class="pill warn" title="You changed this point">edited</span>' : ''}
        <b class="deck-title">${p.title}</b>
        ${hasMore ? `<span class="deck-caret" title="Click the card to show/hide details">${isOpen ? '▾' : '▸'}</span>` : ''}
      </div>
      <div class="deck-body">${p.body}</div>
      ${hasMore ? `<div class="deck-more"${isOpen ? '' : ' hidden'}>${p.more}</div>` : ''}
      <div class="deck-actions">
        <button class="deck-btn" data-a="top" title="Move to the top">⤒ Top</button>
        <button class="deck-btn" data-a="up" title="Move up one place">▲</button>
        <button class="deck-btn" data-a="down" title="Move down one place">▼</button>
        <button class="deck-btn" data-a="bottom" title="Move to the bottom">⤓ Bottom</button>
        <button class="deck-btn" data-a="edit" title="Edit this point">✎ Edit</button>
        ${edited ? '<button class="deck-btn" data-a="revert" title="Undo your edits to this point">↺ Original</button>' : ''}
        <button class="deck-btn" data-a="del" title="Delete this point">🗑</button>
        <span class="deck-spacer"></span>
        <button class="deck-btn green" data-a="g" title="I went over this and understood it">✓ Understood <b>${g > 0 ? '+' + g : 0}</b></button>
        <button class="deck-btn red" data-a="r" title="I went over this and did not understand it">✗ Not yet <b>${r}</b></button>
        <span class="deck-net ${n > 0 ? 'pos' : n < 0 ? 'neg' : ''}" title="Net score">${n > 0 ? '+' : ''}${n}</span>
      </div>
    </div>`;
  }

  function render() {
    let html = '', lastSec = null, pos = 0;
    state.order.forEach(id => {
      if (!visible(id)) return;
      pos++;
      const sec = pt(id).sec;
      if (sec !== lastSec) { html += `<h3 class="deck-sec" data-sec="${sec}"><span>${SEC[sec]}</span><button class="deck-btn" data-add="${sec}" title="Add a point to this section">＋ Add point here</button></h3>`; lastSec = sec; }
      html += cardHTML(id, pos);
    });
    document.getElementById('deckList').innerHTML = html || '<p class="widget-sub">No points match your search.</p>';
    renderStats();
    updateNow();
  }

  function toast(msg) {
    const t = document.getElementById('deckToast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true; }, 1800);
  }
  const cardEl = id => document.querySelector(`.deck-card[data-id="${id}"]`);
  function focusEditor(id) {
    const c = cardEl(id); if (!c) return;
    c.scrollIntoView({ block: 'center' });
    const f = c.querySelector('[data-f="title"]'); f.focus();
    const r = document.createRange(); r.selectNodeContents(f); r.collapse(false);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  }

  function move(id, how) {
    const o = state.order, at = o.indexOf(id);
    if (how === 'top' || how === 'bottom') { o.splice(at, 1); if (how === 'top') o.unshift(id); else o.push(id); toast(`${label(id)} moved to the ${how}`); return; }
    const step = how === 'up' ? -1 : 1; // swap with the nearest *visible* neighbour
    let j = at + step;
    while (j >= 0 && j < o.length && !visible(o[j])) j += step;
    if (j < 0 || j >= o.length) return;
    o.splice(at, 1); o.splice(j, 0, id);
  }

  function addPoint(sec) {
    const id = `c${++state.seq}`;
    state.custom[id] = { sec, type: 'Note', title: '', body: '', more: '', seq: state.seq };
    // place it after the last visible point of that section (or at the top for "My notes")
    let at = -1;
    if (sec !== 14) state.order.forEach((x, k) => { if (pt(x).sec === sec) at = k; });
    state.order.splice(at + 1, 0, id);
    editing.add(id); fresh.add(id);
    save(); render(); focusEditor(id);
  }

  function saveEdit(id) {
    const c = cardEl(id), get = f => c.querySelector(`[data-f="${f}"]`);
    const clean = el => { const h = el.innerHTML.replace(/<br\s*\/?>\s*$/i, '').trim(); return strip(h).trim() ? h : ''; };
    const p = { sec: +get('sec').value, type: get('type').value, title: clean(get('title')) || 'Untitled point', body: clean(get('body')), more: clean(get('more')) };
    if (isCustom(id)) state.custom[id] = { ...state.custom[id], ...p };
    else {
      const b = P[+id.slice(1)];
      const same = p.sec === b[0] && p.type === b[1] && p.title === b[2] && p.body === b[3] && p.more === b[4];
      if (same) delete state.edits[id]; else state.edits[id] = p;
    }
    editing.delete(id); fresh.delete(id);
    save(); render(); toast('Saved');
  }
  function cancelEdit(id) {
    editing.delete(id);
    if (fresh.has(id)) { fresh.delete(id); delete state.custom[id]; state.order = state.order.filter(x => x !== id); save(); }
    render();
  }

  const list = document.getElementById('deckList');
  list.addEventListener('mousedown', e => { if (e.target.closest('.deck-tools button')) e.preventDefault(); }); // keep the text selection
  list.addEventListener('click', e => {
    const add = e.target.closest('[data-add]');
    if (add) { addPoint(+add.dataset.add); return; }
    const tool = e.target.closest('.deck-tools button');
    if (tool) {
      const cmd = tool.dataset.cmd;
      document.execCommand(cmd === 'sub' ? 'subscript' : cmd === 'sup' ? 'superscript' : cmd === 'list' ? 'insertUnorderedList' : cmd);
      return;
    }
    const card = e.target.closest('.deck-card'); if (!card) return;
    const id = card.dataset.id, btn = e.target.closest('[data-a]');
    if (card.classList.contains('editing')) {
      if (btn && btn.dataset.a === 'save') saveEdit(id);
      else if (btn && btn.dataset.a === 'cancel') cancelEdit(id);
      return;
    }
    if (!btn) {
      if (!card.classList.contains('toggle') || e.target.closest('a')) return;
      if (open.has(id)) open.delete(id); else open.add(id);
      card.classList.toggle('open');
      card.querySelector('.deck-more').hidden = !open.has(id);
      card.querySelector('.deck-caret').textContent = open.has(id) ? '▾' : '▸';
      return;
    }
    const a = btn.dataset.a;
    if (a === 'edit') { editing.add(id); render(); focusEditor(id); return; }
    if (a === 'del') {
      if (btn.dataset.confirm !== '1') { btn.dataset.confirm = '1'; btn.textContent = 'Click again to delete'; setTimeout(() => { if (btn.isConnected) { btn.dataset.confirm = ''; btn.textContent = '🗑'; } }, 3000); return; }
      state.order = state.order.filter(x => x !== id);
      if (isCustom(id)) delete state.custom[id]; else state.deleted.push(id);
      save(); render(); toast(isCustom(id) ? 'Your point was deleted' : `${label(id)} deleted (restore it from the toolbar)`);
      return;
    }
    if (a === 'revert') { delete state.edits[id]; save(); render(); toast(`${label(id)} restored to the original`); return; }
    const before = card.getBoundingClientRect().top;
    if (a === 'g') state.green[id] = (state.green[id] || 0) + 1;
    else if (a === 'r') state.red[id] = (state.red[id] || 0) - 1;
    else move(id, a);
    save(); render();
    if (a === 'up' || a === 'down' || a === 'g' || a === 'r') { const now = cardEl(id); if (now) window.scrollBy(0, now.getBoundingClientRect().top - before); }
  });
  list.addEventListener('keydown', e => {
    const card = e.target.closest('.deck-card.editing'); if (!card) return;
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveEdit(card.dataset.id); }
    else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(card.dataset.id); }
    else if (e.key === 'Enter' && e.target.dataset.f === 'title') { e.preventDefault(); card.querySelector('[data-f="body"]').focus(); }
  });
  // Paste as plain text so formatting from PDFs/web pages doesn't leak in
  list.addEventListener('paste', e => {
    if (!e.target.closest('[contenteditable]')) return;
    e.preventDefault();
    document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text/plain'));
  });

  root.querySelector('.deck-controls').addEventListener('click', e => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const a = b.dataset.a;
    if (a === 'new') { addPoint(14); return; }
    if (a === 'export') {
      const blob = new Blob([JSON.stringify({ app: 'patrol-viva-deck', version: 2, savedAt: new Date().toISOString(), state }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = `viva-deck-notes-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('Notes exported');
      return;
    }
    if (a === 'paper') { state.order.sort(paperSort); toast('Back to paper order'); }
    else if (a === 'weak') { const o = state.order.slice(); state.order.sort((x, y) => net(x) - net(y) || o.indexOf(x) - o.indexOf(y)); toast('Least-understood points moved to the top'); }
    else if (a === 'expand') state.order.forEach(id => { if (strip(pt(id).more).trim()) open.add(id); });
    else if (a === 'collapse') open.clear();
    else if (a === 'restore') {
      const back = state.deleted.slice().sort(paperSort);
      state.deleted = [];
      back.forEach(id => { const k = state.order.findIndex(x => paperSort(x, id) > 0); state.order.splice(k < 0 ? state.order.length : k, 0, id); });
      toast('Deleted points restored to their paper positions');
    }
    else if (a === 'zero') {
      if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Click again to reset all counters'; setTimeout(() => { b.dataset.confirm = ''; b.textContent = 'Reset counters'; }, 3000); return; }
      state.green = {}; state.red = {}; b.dataset.confirm = ''; b.textContent = 'Reset counters'; toast('Counters reset');
    }
    save(); render();
  });
  document.getElementById('deckImport').addEventListener('change', e => {
    const file = e.target.files[0]; if (!file) return;
    file.text().then(txt => {
      const data = JSON.parse(txt);
      if (!data || data.app !== 'patrol-viva-deck' || !data.state) throw new Error('not a viva-deck export');
      state = normalise(data.state); editing.clear(); fresh.clear();
      save(); render(); toast('Notes imported');
    }).catch(err => toast(`Import failed: ${err.message}`)).finally(() => { e.target.value = ''; });
  });
  document.getElementById('deckSearch').addEventListener('input', e => { query = e.target.value.trim().toLowerCase(); render(); });
  document.getElementById('deckTypes').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    typeFilter = b.dataset.v;
    document.querySelectorAll('#deckTypes button').forEach(x => x.classList.toggle('on', x === b));
    render();
  });

  // "You are here": the subtopic of the card nearest the top of the viewport
  function updateNow() {
    const now = document.getElementById('deckNow');
    if (!now || root.closest('[hidden]')) return;
    const cards = document.querySelectorAll('#deckList .deck-card');
    let sec = null;
    for (const c of cards) { if (c.getBoundingClientRect().top > 140) break; sec = c.dataset.sec; }
    if (!sec && cards.length) sec = cards[0].dataset.sec;
    now.innerHTML = sec ? `Now in: <b>${SEC[sec]}</b>` : '';
  }
  let ticking = false;
  window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(() => { ticking = false; updateNow(); }); } });
  window.addEventListener('hashchange', updateNow);

  render();
})();
