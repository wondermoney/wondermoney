/**
 * Deckchair: a folding deck chair, its striped sling hung between two
 * crossing frames, beside a stack of coins, and over the stack a dashed coin:
 * the sum that pays your spending for good, twenty-five years of it. The
 * pointer's x is the savings rate. The stack shows how much of that sum the
 * rate has saved after the slider's years, at a 5% real return, to the
 * nearest tenth, coins dropping in on a spring; once it reaches the dashed coin, the chair leans
 * back on the 700ms curve. The top coin holds the bright edge. The read-out
 * gives the rate and the years it takes. The slider is the years saved.
 *
 * The pattern: a continuous value with a discrete end. A spring for the
 * stack, a tween for the chair, and a hit test on the figure's width at rest.
 */
const {
  Cam, circ, clamp, extremes, facing, fillet, fit, lerp, open, poly, prism, proj, rad, seg, spring, stepS,
  tdone, tset, tval, tween, disposer, mk, pointer, put, register, solid,
} = HL;

const YAW = -110, CW = 30, F = [46, 0], B = [0, 0], S0 = [40, 22], ARM = 70, A0 = 127, A1 = 141;
const SX = 74, SY = -40, CR = 14, T = 4.2, N = 10, LO = 5, HI = 75, REST = 30, RET = 0.05;
/** Years until the savings, growing at RET, reach 25 years of spending, for savings rate s. */
const years = (s) => Math.log(1 + (25 * (1 - s) * RET) / s) / Math.log(1 + RET);
/** The share of that sum saved after h years. */
const share = (s, h) => clamp((s * ((1 + RET) ** h - 1)) / RET / (25 * (1 - s)), 0, 1);
const cY = Math.cos(rad(YAW)), sY = Math.sin(rad(YAW));
/** A world point from the chair's frame: x across it, v = [y, z] in its side plane, y forward. */
const CH = (x, [y, z]) => [x * cY - y * sY, x * sY + y * cY, z];
/** The chair's side nearer the viewer: the one with the larger x + y. */
const NEAR = Math.sign(cY + sY);
/** The sling's curve from the top bar to the front bar, sagging into a seat. */
function sling(top, n = 14) {
  const c = [30, 4], pts = [];
  for (let k = 0; k <= n; k++) { const t = k / n, a = (1 - t) ** 2, b = 2 * t * (1 - t), d = t * t; pts.push([a * top[0] + b * c[0] + d * S0[0], a * top[1] + b * c[1] + d * S0[1]]); }
  return pts;
}

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let horizon = value;

  const C = Cam(45, 0.5, 2.45);
  const topAt = (r) => { const a = rad(lerp(A0, A1, r)); return [F[0] + ARM * Math.cos(a), F[1] + ARM * Math.sin(a)]; };
  const box = [CH(-CW / 2, [-2, 0]), CH(CW / 2, [-2, 0]), CH(-CW / 2, [F[0] + 2, 0]), CH(CW / 2, [F[0] + 2, 0]), CH(-CW / 2, topAt(0)), CH(CW / 2, topAt(0)), CH(-CW / 2, topAt(1)), CH(CW / 2, topAt(1)), [SX + CR, SY + CR, 0], [SX - CR, SY - CR, N * T + 2], [SX + CR, SY - CR, N * T]];
  fit(C, box, 200, 168);
  const P = proj(C), front = facing(C), Y = (x, v) => P(...CH(x, v));
  /** A flat rail in the side plane x, from p to q, w wide. */
  const rail = (x, p, q, w = 2.6) => {
    const dy = q[0] - p[0], dz = q[1] - p[1], L = Math.hypot(dy, dz), n = [(-dz / L) * w / 2, (dy / L) * w / 2];
    const pts = [[p[0] + n[0], p[1] + n[1]], [q[0] + n[0], q[1] + n[1]], [q[0] - n[0], q[1] - n[1]], [p[0] - n[0], p[1] - n[1]]];
    return poly(fillet(pts, [1.2, 1.2, 1.2, 1.2], 3).map((v) => Y(x, v)));
  };

  const g = mk("g", {}, svg);
  // the chair: the far side's rails, the bars and the sling, then the near side's rails
  const farR = [mk("path", { class: "sil" }, g), mk("path", { class: "sil" }, g)];
  const bars = mk("path", { class: "nf" }, g), cloth = solid(g), stripes = mk("path", { class: "nf lo" }, g);
  const nearR = [mk("path", { class: "sil" }, g), mk("path", { class: "sil" }, g)];
  function chair(r) {
    const top = topAt(r), sl = sling(top), w = CW / 2 - 2;
    [[farR, -NEAR * CW / 2], [nearR, NEAR * CW / 2]].forEach(([els, x]) => { els[0].setAttribute("d", rail(x, B, S0)); els[1].setAttribute("d", rail(x, F, top)); });
    bars.setAttribute("d", seg(Y(-CW / 2, top), Y(CW / 2, top)) + seg(Y(-CW / 2, S0), Y(CW / 2, S0)));
    const edge = sl.map((v) => Y(w, v)), back = sl.map((v) => Y(-w, v)).reverse();
    put(cloth, { sil: poly(edge.concat(back)), crease: "" });
    stripes.setAttribute("d", open(sl.map((v) => Y(w / 3, v))) + open(sl.map((v) => Y(-w / 3, v))));
  }

  // the target: a dashed coin over the stack and its drops, behind the coins
  const ring = circ(CR, 32).map((q) => ({ ...q, u: q.u + SX, v: q.v + SY }));
  const [el, er] = extremes(P, ring);
  mk("path", { d: poly(ring.map((q) => P(q.u, q.v, N * T))) + seg(P(el.u, el.v, N * T), P(el.u, el.v, 0)) + seg(P(er.u, er.v, N * T), P(er.u, er.v, 0)), class: "nf dash" }, g);
  const inner = circ(CR - 1.4, 32).map((q) => ({ ...q, u: q.u + SX, v: q.v + SY }));
  const coins = Array.from({ length: N }, () => solid(g));

  let shownCoins = "";
  function stack(c) {
    const n = Math.floor(c), f = c - n, key = `${n},${f.toFixed(3)}`;
    if (key === shownCoins) return;
    shownCoins = key;
    coins.forEach((s, k) => {
      const on = k < n || (k === n && f > 0.02), z = k * T + (k === n ? (1 - f) * 14 : 0);
      put(s, on ? prism(P, front, ring, inner, z, z + T - 0.6) : { sil: "", crease: "" });
      s.sil.classList.toggle("hi", on && (k === n || (k === n - 1 && f <= 0.02)));
    });
  }

  const pile = spring(Math.round(share(REST / 100, value) * N)), lean = tween(0);
  let key = "";
  const Bk = register(stage, (dt, now) => {
    const m = stepS(pile, dt), r = tval(lean, now), k = r.toFixed(4);
    stack(clamp(pile.x, 0, N));
    if (k !== key) { key = k; chair(clamp(r, 0, 1.05)); }
    return m || !tdone(lean, now);
  });
  bag.add(Bk.unregister);

  // hit: the pointer's x across the figure's width at rest, inside its box
  const sx = box.map((q) => P(...q)), xl = Math.min(...sx.map((q) => q[0])), xr = Math.max(...sx.map((q) => q[0]));
  const ytop = Math.min(...sx.map((q) => q[1])) - 20, ybot = Math.max(...sx.map((q) => q[1])) + 20;
  let shown = "", free = null, rate = REST, last = null;
  function aim(p) {
    last = p;
    const inside = !!p && p[1] > ytop && p[1] < ybot && p[0] > xl - 24 && p[0] < xr + 24;
    rate = inside ? Math.round(lerp(LO, HI, clamp((p[0] - xl) / (xr - xl), 0, 1))) : REST;
    const s = rate / 100, sh = share(s, horizon);
    pile.t = Math.round(sh * N);
    if ((sh >= 1) !== free) { free = sh >= 1; tset(lean, free ? 1 : 0, performance.now(), 0); }
    const txt = inside ? `${rate}% · ${Math.round(years(s))}y` : "rest";
    if (txt !== shown) { shown = txt; read.textContent = txt; }
    Bk.wake();
  }

  aim(null);
  bag.add(pointer(stage, { move: (p) => aim(p), leave: () => aim(null) }));
  bag.add(() => svg.replaceChildren());

  return {
    set: (v) => { horizon = v; aim(last); },
    destroy: bag.dispose,
  };
}

hairline({
  name: "deckchair",
  means: "A deck chair beside a stack of coins: move right to save more; the stack climbs to the dashed coin and the chair leans back.",
  rules: [1, 4, 5, 8],
  range: [10, 15, 20],
  tour: [[110, 180], [200, 175], [310, 170], null],
  mount,
});
