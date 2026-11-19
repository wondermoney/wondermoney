/**
 * Car: a compact hatchback on a stretch of road, in three-quarter view: a
 * body that tapers in a little to its top, a cabin narrower and shorter than
 * it with a sloped windscreen and a near-upright hatch, side windows split by
 * a pillar, mirrors, headlights, a grille and a blank number plate, and four
 * wheels with spoked hubs under their arches. The pointer's x rolls it along
 * the road and its wheels turn by the distance over their radius. At rest the
 * plate takes the bright edge; rolling, the near front tyre does. The slider
 * is how far it can roll, in world units.
 *
 * The pattern: scrub. A spring on the distance, a hit test on the road's
 * width at rest, and a side panel cut round the arches, painted over the near
 * wheels so they show only under them.
 */
const {
  Cam, circ, clamp, facing, fillet, fit, hull, lerp, open, poly, prism, proj, rad, rings, rrect, run, seg,
  spring, stepS, disposer, mk, pointer, put, register, solid,
} = HL;

const L = 100, B = 22, Z0 = 6, Z1 = 26, Z2 = 44, R = 11, WX = [22, 78], TW = 8, AR = 13.5, MAXR = 44;
const RX0 = -8, RX1 = L + MAXR + 8, RY0 = -32, RY1 = 36;

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let roll = value;

  const C = Cam(45, 0.5, 1.62);
  fit(C, [[RX0, RY0, -3], [RX1, RY1, -3], [RX1, RY0, -3], [RX0, RY1, -3], [10, -16, Z2], [MAXR + 44, -16, Z2]], 200, 170);
  const P0 = proj(C), front = facing(C);
  let dx = 0;
  const P = (x, y, z) => P0(x + dx, y, z);
  const pts = (list) => list.map((p) => P(...p));
  const r4 = (list, r) => fillet(list, list.map(() => r));

  const g = mk("g", {}, svg);
  const [rr, ri] = rings(RX0, RY0, RX1, RY1, 8, 2);
  put(solid(g), prism(P0, front, rr, ri, -3, 0));
  let lane = "";
  for (let x = RX0 + 6; x < RX1 - 12; x += 19) lane += poly(rrect(x, 28, x + 10, 30.6, 1.3, 3).map((q) => P0(q.u, q.v, 0.1)));
  mk("path", { d: lane, class: "nf lo" }, g);

  // every part of the car is a path redrawn from these makers; order is paint order
  const parts = [];
  const add = (cls, make) => parts.push([mk("path", { class: cls }, g), make]);
  /** A tyre at x, from its outer face at y = yo to its inner face at yi; the hub carries the turn. */
  const wheel = (xw, yo, yi) => () => {
    const face = (r, y) => circ(r, 28).map((q) => [xw + q.u, y, R + q.v]);
    return poly(hull(pts(face(R, yo)).concat(pts(face(R, yi)))));
  };
  const hub = (xw, yo) => (ang) => {
    let d = poly(pts(circ(8, 24).map((q) => [xw + q.u, yo, R + q.v]))) + poly(pts(circ(3.2, 14).map((q) => [xw + q.u, yo, R + q.v])));
    for (let k = 0; k < 5; k++) {
      const a = ang + (k * 2 * Math.PI) / 5, c = Math.cos(a), s = Math.sin(a);
      d += seg(P(xw + 3.2 * c, yo, R + 3.2 * s), P(xw + 7.4 * c, yo, R + 7.4 * s));
    }
    return d;
  };
  for (const xw of WX) add("sil", wheel(xw, -B + 1, -B + 1 + TW));

  // the body: a hull from its foot to a slightly narrower top; the cabin over it, narrower and shorter
  const foot = rrect(0, -B, L, B, 8, 5), top = rrect(1, -B + 1, L - 3, B - 1, 8, 5), topIn = rrect(3, -B + 3, L - 5, B - 3, 6, 5);
  const cFoot = rrect(4, -20, 64, 20, 6, 5), cTop = rrect(10, -16, 44, 16, 5, 5), cIn = rrect(12, -14, 42, 14, 3.5, 5);
  const ringZ = (ring, z) => pts(ring.map((q) => [q.u, q.v, z]));
  add("sil", () => poly(hull(ringZ(foot, Z0).concat(ringZ(top, Z1)))));
  add("nf lo", () => open(ringZ(run(topIn, front), Z1)));
  const mirror = (s) => () => { const [mr] = rings(56.5, s > 0 ? 19 : -26, 61.5, s > 0 ? 26 : -19, 2, 0.7); return poly(hull(ringZ(mr, 28.5).concat(ringZ(mr, 33)))); };
  add("", mirror(-1));
  add("sil", () => poly(hull(ringZ(cFoot, Z1).concat(ringZ(cTop, Z2)))));
  add("nf lo", () => open(ringZ(run(cIn, front), Z2)));
  // the windscreen, on the cabin's sloped front; two side windows split by a pillar
  const screen = (t, s) => [lerp(64, 44, t), s * (lerp(20, 16, t) - 4), lerp(Z1, Z2, t)];
  add("nf", () => poly(r4(pts([screen(0.12, -1), screen(0.12, 1), screen(0.88, 1), screen(0.88, -1)]), 1.6)));
  const side = (x, t) => [x, lerp(20, 16, t) + 0.05, lerp(Z1, Z2, t)];
  add("nf", () => poly(r4(pts([side(35, 0.2), side(lerp(64, 44, 0.2) - 5, 0.2), side(lerp(64, 44, 0.86) - 4, 0.86), side(35, 0.86)]), 1.4))
    + poly(r4(pts([side(lerp(4, 10, 0.2) + 5, 0.2), side(31, 0.2), side(31, 0.86), side(lerp(4, 10, 0.86) + 5, 0.86)]), 1.4)));
  add("", mirror(1));
  // the front: lamps, a grille, and a plate with nothing on it
  const nose = (ring, cy, cz) => pts(ring.map((q) => [lerp(L, L - 3, (cz + q.v - Z0) / (Z1 - Z0)) + 0.05, cy + q.u, cz + q.v]));
  add("nf", () => poly(nose(rrect(-3, -2.2, 3, 2.2, 1.6, 4), 12.5, 20)) + poly(nose(rrect(-3, -2.2, 3, 2.2, 1.6, 4), -12.5, 20)) + poly(nose(rrect(-7, -2.6, 7, 2.6, 1.6, 4), 0, 16.5)));
  add("nf lo", () => seg(...nose([{ u: -5.6, v: 0 }, { u: 5.6, v: 0 }], 0, 16.5)) + seg(...nose([{ u: -13, v: 0 }, { u: 13, v: 0 }], 0, 12.4)));
  const plate = mk("path", { class: "nf" }, g);
  parts.push([plate, () => poly(nose(rrect(-8, -2.4, 8, 2.4, 1.2, 4), 0, 8.6))]);

  // near wheels, then the side panel cut round their arches, painted over them
  const near = WX.map((xw) => { add("sil", wheel(xw, B - 0.6, B - 0.6 - TW)); return parts[parts.length - 1][0]; });
  for (const xw of WX) add("nf lo", hub(xw, B - 0.55));
  const ny = (z) => B - (z - Z0) / (Z1 - Z0) + 0.1;
  const lower = [[92, Z0]];
  for (const xw of [WX[1], WX[0]]) {
    const a0 = Math.asin((R - Z0) / AR);
    for (let k = 0; k <= 16; k++) { const a = lerp(-a0, Math.PI + a0, k / 16); lower.push([xw + AR * Math.cos(a), R + AR * Math.sin(a)]); }
  }
  lower.push([8, Z0]);
  const toP = (list) => pts(list.map(([x, z]) => [x, ny(z), z]));
  add("fo", () => poly(toP([[8, Z1], [92, Z1]].concat(lower))));
  add("nf sil", () => open(toP(lower)));
  add("nf lo", () => open(toP([[8, Z1 - 0.2], [92, Z1 - 0.2]])) + open(toP([[35, Z1 - 0.5], [35, 9]])) + open(toP([[62, Z1 - 0.5], [62, 9]])) + open(toP([[45, 21], [50, 21]])));
  const tyre = near[1];

  const sp = spring(0.4 * roll, { eps: 0.01 });
  let drawn = NaN;
  function draw(d) {
    if (d === drawn) return;
    drawn = d; dx = d;
    // rolling forward, a point on the rim turns from the top towards the front: the angle falls by the distance over the radius
    const ang = rad(18) - d / R;
    for (const [el, make] of parts) el.setAttribute("d", make(ang));
  }

  const loop = register(stage, (dt) => { const m = stepS(sp, dt); draw(Math.round(sp.x * 100) / 100); return m; });
  bag.add(loop.unregister);

  // hit: the pointer's x across the road's width at rest; the road never moves
  const xl = P0(0, B, Z0)[0], xr = P0(L + MAXR, -B, Z0)[0], ytop = P0(MAXR, -B, Z2)[1] - 20, ybot = P0(RX1, RY1, -3)[1] + 10;
  function aim(p) {
    const inside = p && p[1] > ytop && p[1] < ybot && p[0] > xl - 30 && p[0] < xr + 30;
    sp.t = inside ? roll * clamp((p[0] - xl) / (xr - xl), 0, 1) : 0.4 * roll;
    read.textContent = inside ? `km ${Math.round((sp.t / MAXR) * 20)}` : "rest";
    plate.classList.toggle("hi", !inside);
    tyre.classList.toggle("hi", !!inside);
    loop.wake();
  }

  aim(null);
  bag.add(pointer(stage, { move: aim, leave: () => aim(null) }));
  bag.add(() => svg.replaceChildren());

  return {
    set: (v) => { roll = v; aim(null); },
    destroy: bag.dispose,
  };
}

hairline({
  name: "car",
  means: "A small hatchback on a stretch of road: move the pointer to the right and it rolls forward on its wheels.",
  rules: [1, 3, 5, 9],
  range: [16, 30, 44],
  tour: [[120, 170], [230, 180], [300, 200], null],
  mount,
});
