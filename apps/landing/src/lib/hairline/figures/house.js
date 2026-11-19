/**
 * House: a small house on its plot, a gable roof over a front with a door
 * and two windows, a round window in the gable, a chimney behind the ridge
 * and a path of stepping stones to the door. The roof's near slope is laid
 * in tiles, and each tile is a share of the loan: the ones paid are laid,
 * the rest are a dashed outline. The pointer's x sets how much is paid; the
 * tiles go down or come up staggered outwards from where the share stopped,
 * and the last tile laid takes the bright edge. The slider is the stagger, in ms.
 *
 * The pattern: one of many, by scrubbing. Tweens with a stagger by distance,
 * a hit test on the house's width at rest, and guides painted before the
 * tiles that cover them.
 */
const {
  Cam, clamp, facing, fillet, fit, hull, open, poly, prism, proj, rings, rrect, seg, circ,
  tdone, tset, tval, tween, disposer, mk, pointer, put, register, solid,
} = HL;

const W = 72, D = 52, HW = 30, SL = 0.9, OV = 5, RT = 2.6;
const HR = HW + (D / 2) * SL, ZE = HW - OV * SL, LS = Math.hypot(D / 2 + OV, (D / 2 + OV) * SL);
const CA = 1 / Math.hypot(1, SL), SA = SL / Math.hypot(1, SL);
const NX = 8, NS = 5, NT = NX * NS, REST = 24, GAP = 1.5, M = 2.2;
const PX0 = -14, PX1 = W + 14, PY0 = -10, PY1 = D + 26;

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let stag = value;

  const C = Cam(45, 0.5, 1.98);
  fit(C, [[PX0, PY0, -4], [PX1, PY1, -4], [PX1, PY0, -4], [PX0, PY1, -4], [W * 0.62, D / 2 - 14, HR + 13]], 200, 166);
  const P = proj(C), front = facing(C);
  /** A point on the near slope: u along the ridge, s down from it, n out of the roof. */
  const sl = (u, s, n = 0) => P(u, D / 2 + s * CA + n * SA, HR - s * SA + n * CA);
  const onY = (ring, y) => ring.map((q) => P(q.u, y, q.v));
  const onX = (ring, x) => ring.map((q) => P(x, q.u, q.v));
  const r4 = (pts, r) => fillet(pts, pts.map(() => r));

  const g = mk("g", {}, svg);
  const [pr, pi] = rings(PX0, PY0, PX1, PY1, 9, 2.2);
  put(solid(g), prism(P, front, pr, pi, -4, 0));
  // stepping stones from the plot's edge to the door
  for (let k = 0; k < 3; k++) {
    const y0 = D + 7 + k * 6;
    mk("path", { d: poly(rrect(39 - k * 0.6, y0, 50 + k * 0.6, y0 + 4.4, 2.2, 4).map((q) => P(q.u, q.v, 0.2))), class: "nf lo" }, g);
  }
  // the chimney, on the far slope, so the roof covers its foot
  const [cr, ci] = rings(W * 0.62, D / 2 - 14, W * 0.62 + 10, D / 2 - 4, 1.6, 1);
  put(solid(g), prism(P, front, cr, ci, HR - 14, HR + 10));
  const [kr, ki] = rings(W * 0.62 - 1.4, D / 2 - 15.4, W * 0.62 + 11.4, D / 2 - 2.6, 1.8, 1);
  put(solid(g), prism(P, front, kr, ki, HR + 10, HR + 13));

  // the walls, then what is set into them
  const [br, bi] = rings(0, 0, W, D, 2.5, 1.2);
  put(solid(g), prism(P, front, br, bi, 0, HW));
  const win = (x0, x1, z0, z1, on) => {
    mk("path", { d: poly(on(rrect(x0, z0, x1, z1, 1.6, 4))), class: "nf" }, g);
    mk("path", { d: poly(on(rrect(x0 + 1.6, z0 + 1.6, x1 - 1.6, z1 - 1.6, 1, 4))) + seg(on([{ u: (x0 + x1) / 2, v: z0 + 1.6 }])[0], on([{ u: (x0 + x1) / 2, v: z1 - 1.6 }])[0]) + seg(on([{ u: x0 + 1.6, v: (z0 + z1) / 2 }])[0], on([{ u: x1 - 1.6, v: (z0 + z1) / 2 }])[0]), class: "nf lo" }, g);
  };
  const fy = (ring) => onY(ring, D + 0.05), fx = (ring) => onX(ring, W + 0.05);
  win(8, 24, 8, 21, fy);
  win(55, 67, 8, 21, fy);
  win(D / 2 - 8, D / 2 + 8, 9, 21, fx);
  mk("path", { d: poly(fy(rrect(36, -2, 49, 21, 2.2, 5))), class: "nf" }, g);
  mk("path", { d: poly(fy(rrect(38.6, 5, 46.4, 18.4, 1.2, 4))), class: "nf lo" }, g);
  mk("path", { d: poly(fy(circ(0.9, 10).map((q) => ({ u: 46.6 + q.u, v: 10 + q.v })))), class: "nf" }, g);
  const [sr, si] = rings(34, D, 51, D + 5, 1.5, 0.8);
  put(solid(g), prism(P, front, sr, si, 0, 1.8));
  // the gable: the wall's triangle, a round window in it
  mk("path", { d: poly(r4([P(W, 1.2, HW - 1.4), P(W, D - 1.2, HW - 1.4), P(W, D / 2, HR - RT)], 1)), class: "fo" }, g);
  mk("path", { d: poly(fx(circ(4.6, 20).map((q) => ({ u: D / 2 + q.u, v: HW + 8.5 + q.v })))), class: "nf" }, g);
  mk("path", { d: poly(fx(circ(3, 16).map((q) => ({ u: D / 2 + q.u, v: HW + 8.5 + q.v })))), class: "nf lo" }, g);

  // the roof: a slab bent over the ridge, its silhouette the hull of its corners
  const corners = [];
  for (const x of [-OV, W + OV]) for (const dz of [0, -RT]) {
    corners.push(P(x, -OV, ZE + dz), P(x, D + OV, ZE + dz), P(x, D / 2, HR + dz));
  }
  mk("path", { d: poly(r4(hull(corners), 1.4)), class: "sil" }, g);
  mk("path", { d: open([P(-OV, D + OV, ZE), P(W + OV, D + OV, ZE), P(W + OV, D / 2, HR), P(W + OV, -OV, ZE)]), class: "nf lo" }, g);

  // the tiles, course by course from the ridge down: a dashed place for each, then the tile laid in it
  const TW = (W + 2 * OV - 2 * M) / NX, TH = (LS - 2 * M) / NS;
  const place = (c, s) => [-OV + M + c * TW + GAP / 2, M + s * TH + GAP / 2, -OV + M + (c + 1) * TW - GAP / 2, M + (s + 1) * TH - GAP / 2];
  const gd = mk("g", {}, g), gt = mk("g", {}, g), tiles = [];
  for (let s = 0; s < NS; s++) for (let c = 0; c < NX; c++) {
    const [u0, s0, u1, s1] = place(c, s), shape = fillet([[u0, s0], [u1, s0], [u1, s1], [u0, s1]], [1.2, 1.2, 1.2, 1.2]);
    mk("path", { d: poly(shape.map((p) => sl(p[0], p[1], 0.2))), class: "nf dash" }, gd);
    // the order they are paid in: column by column from the left, each from the eave up
    const i = c * NS + (NS - 1 - s);
    tiles[i] = { c, s, shape, cu: (u0 + u1) / 2, cs: (s0 + s1) / 2, el: mk("path", {}, gt), t: tween(i < REST ? 1 : 0), drawn: NaN };
  }

  function draw(tl, t) {
    if (t === tl.drawn) return;
    tl.drawn = t;
    // a tile grows into its place and settles onto it
    const n = 0.7 + Math.sin(Math.PI * t) * 4;
    tl.el.setAttribute("d", t < 0.02 ? "" : poly(tl.shape.map((p) => sl(tl.cu + (p[0] - tl.cu) * t, tl.cs + (p[1] - tl.cs) * t, n))));
  }

  const B = register(stage, (_dt, now) => {
    let moving = false;
    tiles.forEach((tl) => { draw(tl, Math.round(clamp(tval(tl.t, now), 0, 1.2) * 1000) / 1000); if (!tdone(tl.t, now)) moving = true; });
    return moving;
  });
  bag.add(B.unregister);

  // hit: the pointer's x across the house's width at rest, cut into the tiles' shares
  const xl = P(-OV, D + OV, ZE)[0], xr = P(W + OV, -OV, ZE)[0];
  const ytop = P(W * 0.62, D / 2 - 14, HR + 13)[1] - 12, ybot = P(PX1, PY1, -4)[1] + 8;
  function hit([x, y]) {
    if (y < ytop || y > ybot || x < xl - 30 || x > xr + 30) return -1;
    return clamp(Math.round(((x - xl) / (xr - xl)) * NT), 1, NT);
  }

  let paid = -2, cur = REST;
  function pay(k) {
    if (k === paid) return;
    const now = performance.now(), n = k < 0 ? REST : k;
    paid = k;
    const pivot = tiles[clamp(n > cur ? cur : n - 1, 0, NT - 1)];
    cur = n;
    tiles.forEach((tl, i) => {
      tset(tl.t, i < n ? 1 : 0, now, Math.hypot(tl.c - pivot.c, tl.s - pivot.s) * stag);
      tl.el.setAttribute("class", i === n - 1 ? "sil hi" : "");
    });
    read.textContent = k < 0 ? "rest" : `${Math.round((k / NT) * 100)}%`;
    B.wake();
  }

  pay(-1);
  bag.add(pointer(stage, { move: (p) => pay(hit(p)), leave: () => pay(-1) }));
  bag.add(() => svg.replaceChildren());

  return {
    set: (v) => { stag = v; },
    destroy: bag.dispose,
  };
}

hairline({
  name: "house",
  means: "A house on its plot: move the pointer to the right and more of its roof tiles are laid, as more of the loan is paid.",
  rules: [1, 2, 5, 6],
  range: [0, 40, 80],
  tour: [[150, 160], [250, 170], [300, 190], null],
  mount,
});
