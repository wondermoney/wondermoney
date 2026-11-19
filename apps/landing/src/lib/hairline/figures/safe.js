/**
 * Safe: a small heavy safe on four feet, its door set in the front on two
 * hinge barrels, with a panel line, a combination dial ringed with ticks and
 * a three-spoke handle. The pointer's x turns the dial on a spring, the term
 * in months going to the read-out; at the far end of the turn the door swings
 * a little open on the 700ms curve, the handle turning first, and shows two
 * stacks of coins inside. The dial's rim holds the bright edge until the door
 * opens; then the top coin takes it. The slider is the longest term, in months.
 *
 * The pattern: a continuous value with a discrete end. A spring for the dial,
 * a tween for the door, a hit test on the safe's width at rest, and an
 * inside clipped to the door's opening by its own coordinates on the face.
 */
const {
  Cam, circ, clamp, facing, fillet, fit, hull, open, poly, prism, proj, rad, rings, seg, spring, stepS,
  tdone, tset, tval, tween, disposer, mk, pointer, put, register, solid,
} = HL;

const TURN = 66, BU = 44, BW = 34, Z0 = 6, Z1 = 96, DU0 = -33, DU1 = 33, DZ0 = 16, DZ1 = 86, DEEP = 44, TD = 3, OPEN = 40;
const DIAL = [-2, 60], HANDLE = [-2, 33], REST = 0.35, END = 0.94;
const U0 = [Math.sin(rad(TURN)), -Math.cos(rad(TURN))], N0 = [Math.cos(rad(TURN)), Math.sin(rad(TURN))];
/** A world point from the safe's frame: u across its front, w toward the viewer, z up. */
const W3 = (u, w, z) => [u * U0[0] + w * N0[0], u * U0[1] + w * N0[1], z];
const turnRing = (ring, cu = 0, cw = 0) => ring.map((q) => ({ u: (q.u + cu) * U0[0] + (q.v + cw) * N0[0], v: (q.u + cu) * U0[1] + (q.v + cw) * N0[1], nu: q.nu * U0[0] + q.nv * N0[0], nv: q.nu * U0[1] + q.nv * N0[1] }));
const rect = (u0, z0, u1, z1, r) => fillet([[u0, z0], [u1, z0], [u1, z1], [u0, z1]], [r, r, r, r]);
const COINS = [[4, -24, 3], [16, -12, 5]];

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let longest = value;

  const C = Cam(45, 0.5, 1.84);
  const ob = rad(OPEN), far = [DU0 + (DU1 - DU0) * Math.cos(ob), BW + (DU1 - DU0) * Math.sin(ob) + TD];
  fit(C, [W3(-BU, -BW, 0), W3(BU, BW, 0), W3(BU, -BW, 0), W3(-BU, BW, 0), W3(-BU, -BW, Z1), W3(BU, -BW, Z1), W3(far[0], far[1], DZ0), W3(far[0], far[1], DZ1)], 200, 166);
  const P = proj(C), front = facing(C), Q = (u, w, z) => P(...W3(u, w, z));
  // the face's own coordinates under a screen point, to keep the inside within the opening
  const o0 = Q(0, BW, 0), eu = Q(1, BW, 0).map((v, k) => v - o0[k]), ez = Q(0, BW, 1).map((v, k) => v - o0[k]), det = eu[0] * ez[1] - eu[1] * ez[0];
  const inHole = (p) => { const x = p[0] - o0[0], y = p[1] - o0[1], u = (x * ez[1] - y * ez[0]) / det, z = (eu[0] * y - eu[1] * x) / det; return u > DU0 + 0.6 && u < DU1 - 0.6 && z > DZ0 + 0.6 && z < DZ1 - 0.6; };
  const clipped = (a, b) => { const pts = []; for (let k = 0; k <= 40; k++) { const p = Q(...a.map((v, j) => v + ((b[j] - v) * k) / 40)); if (inHole(p)) pts.push(p); } return pts.length > 1 ? open(pts) : ""; };

  const g = mk("g", {}, svg);
  // four short feet, then the body
  for (const [u, w] of [[-BU + 8, -BW + 8], [BU - 8, -BW + 8], [-BU + 8, BW - 8], [BU - 8, BW - 8]]) put(solid(g), prism(P, front, turnRing(circ(4.5, 16), u, w), turnRing(circ(3.4, 16), u, w), 0, Z0 + 1));
  const [br, bi] = rings(-BU, -BW, BU, BW, 7, 2);
  put(solid(g), prism(P, front, turnRing(br), turnRing(bi), Z0, Z1));

  // the opening and what is inside it: the seams of the floor, the back and the left wall, and the coins
  mk("path", { d: poly(rect(DU0, DZ0, DU1, DZ1, 2.6).map((p) => Q(p[0], BW + 0.1, p[1]))) }, g);
  const back = BW - DEEP;
  mk("path", { d: clipped([DU0, BW, DZ0], [DU0, back, DZ0]) + clipped([DU0, back, DZ0], [DU1, back, DZ0]) + clipped([DU0, back, DZ0], [DU0, back, DZ1]), class: "nf lo" }, g);
  const coins = [];
  for (const [cu, cw, n] of COINS) for (let k = 0; k < n; k++) {
    const s = solid(g);
    put(s, prism(P, front, turnRing(circ(7, 24), cu + Math.sin(k * 2.1) * 0.8, BW + cw), turnRing(circ(5.8, 24), cu + Math.sin(k * 2.1) * 0.8, BW + cw), DZ0 + k * 2.8, DZ0 + k * 2.8 + 2.2));
    coins.push(s);
  }
  const top = coins[coins.length - 1];

  // the door, turning on its hinge at the left of the opening: x across it from the hinge, z up, t out of it
  const door = solid(g), panel = mk("path", { class: "nf lo" }, g), ring = mk("path", {}, g), ticks = mk("path", { class: "nf lo" }, g);
  const knob = mk("path", {}, g), notch = mk("path", { class: "nf" }, g), index = mk("path", { class: "nf" }, g);
  const hub = mk("path", { class: "nf" }, g), balls = mk("path", {}, g);
  for (const z of [DZ0 + 9, DZ1 - 19]) mk("path", { d: poly(hull([...circ(2.4, 12).map((q) => Q(DU0 - 1 + q.u, BW + 1.6 + q.v, z)), ...circ(2.4, 12).map((q) => Q(DU0 - 1 + q.u, BW + 1.6 + q.v, z + 10))])) }, g);

  function draw(o, a) {
    const b = rad(OPEN * o), cb = Math.cos(b), sb = Math.sin(b);
    const D = (u, z, t = TD) => Q(DU0 + (u - DU0) * cb - t * sb, BW + (u - DU0) * sb + t * cb, z);
    const out = rect(DU0, DZ0, DU1, DZ1, 2.6), circle = (c, r, n = 24, t = TD + 0.1) => poly(Array.from({ length: n }, (_, k) => D(c[0] + r * Math.cos(rad((k * 360) / n)), c[1] + r * Math.sin(rad((k * 360) / n)), t)));
    put(door, { sil: poly(hull(out.map((p) => D(p[0], p[1], 0)).concat(out.map((p) => D(p[0], p[1]))))), crease: open(out.slice(7, 18).map((p) => D(p[0], p[1]))) });
    panel.setAttribute("d", poly(rect(DU0 + 6, DZ0 + 6, DU1 - 6, DZ1 - 6, 2).map((p) => D(p[0], p[1], TD + 0.1))));
    ring.setAttribute("d", circle(DIAL, 11.5, 32));
    let tk = "";
    for (let k = 0; k < 24; k++) { const t = rad(a + k * 15), r0 = k % 6 ? 8.8 : 7.6; tk += seg(D(DIAL[0] + r0 * Math.cos(t), DIAL[1] + r0 * Math.sin(t), TD + 0.2), D(DIAL[0] + 10.6 * Math.cos(t), DIAL[1] + 10.6 * Math.sin(t), TD + 0.2)); }
    ticks.setAttribute("d", tk);
    knob.setAttribute("d", circle(DIAL, 5.4, 20, TD + 0.3));
    notch.setAttribute("d", seg(D(DIAL[0] + 1.6 * Math.cos(rad(a + 90)), DIAL[1] + 1.6 * Math.sin(rad(a + 90)), TD + 0.4), D(DIAL[0] + 4.6 * Math.cos(rad(a + 90)), DIAL[1] + 4.6 * Math.sin(rad(a + 90)), TD + 0.4)));
    index.setAttribute("d", seg(D(DIAL[0], DIAL[1] + 13, TD + 0.2), D(DIAL[0], DIAL[1] + 15.5, TD + 0.2)));
    // the handle: three spokes with a ball on each, turned a little as the door unlatches
    let sp = "", bs = "";
    for (const t0 of [90, 210, 330]) {
      const t = rad(t0 - 40 * Math.min(1, o * 2)), e = [HANDLE[0] + 10 * Math.cos(t), HANDLE[1] + 10 * Math.sin(t)];
      sp += seg(D(HANDLE[0] + 3 * Math.cos(t), HANDLE[1] + 3 * Math.sin(t), TD + 1), D(e[0], e[1], TD + 1));
      bs += circle(e, 2.2, 12, TD + 1);
    }
    hub.setAttribute("d", circle(HANDLE, 3.2, 16, TD + 1) + sp);
    balls.setAttribute("d", bs);
  }

  const dial = spring(REST), door0 = tween(0);
  let key = "";
  const B = register(stage, (dt, now) => {
    const m = stepS(dial, dt), o = tval(door0, now), k = `${o.toFixed(4)},${dial.x.toFixed(4)}`;
    if (k !== key) { key = k; draw(clamp(o, 0, 1), -dial.x * 330); }
    return m || !tdone(door0, now);
  });
  bag.add(B.unregister);

  // hit: the pointer's x across the safe's width at rest, inside its box
  const xl = Q(-BU, BW, 0)[0], xr = Q(BU, -BW, 0)[0], ytop = Q(0, -BW, Z1)[1] - 16, ybot = Q(0, BW, 0)[1] + 14;
  let shown = "", opened = null;
  function aim(p) {
    const inside = !!p && p[1] > ytop && p[1] < ybot && p[0] > xl - 30 && p[0] < xr + 30;
    const t = inside ? clamp((p[0] - xl) / (xr - xl), 0, 1) : REST;
    dial.t = t;
    const isOpen = inside && t >= END;
    if (isOpen !== opened) {
      opened = isOpen;
      tset(door0, isOpen ? 1 : 0, performance.now(), 0);
      ring.classList.toggle("hi", !isOpen); top.sil.classList.toggle("hi", isOpen);
    }
    const s = inside ? `${Math.round(1 + Math.min(t / END, 1) * (longest - 1))} mo` : "rest";
    if (s !== shown) { shown = s; read.textContent = s; }
    B.wake();
  }

  aim(null);
  bag.add(pointer(stage, { move: (p) => aim(p), leave: () => aim(null) }));
  bag.add(() => svg.replaceChildren());

  return {
    set: (v) => { longest = v; },
    destroy: bag.dispose,
  };
}

hairline({
  name: "safe",
  means: "A small safe: move the pointer across to turn the dial through the months; at the end the door swings open on stacked coins.",
  rules: [1, 5, 6, 8],
  range: [12, 24, 36],
  tour: [[140, 170], [215, 170], [300, 170], null],
  mount,
});
