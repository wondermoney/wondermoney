/**
 * Meter: an old household electricity meter, a moulded body hung by a lug,
 * a terminal cover with four screws at its foot and a glass hood over the
 * works: a row of five register dials, and the aluminium disc lying flat on
 * its spindle with one mark on its rim. The disc always turns, slowly at
 * rest; the pointer's x sets the load on a spring and it turns faster, the
 * register dials creeping round with it, each a tenth of the one to its right.
 * The mark holds the bright edge, a dim trail behind it as long as the speed.
 * The slider is the top load the pointer can ask for, in kW.
 *
 * The pattern: dilate time. An ambient loop whose rate rides a spring, a hit
 * test on the meter's width at rest, and glass drawn unfilled, last, so the
 * works inside stay honest.
 */
const {
  Cam, circ, clamp, fillet, fit, hull, open, poly, proj, rad, ringAt, seg, spring, stepS, reducedMotion,
  disposer, mk, place, pointer, put, register, solid,
} = HL;

const TURN = 64, BW = 92, BH = 120, BD = 12, GD = 44, DR = 16, DZ = 56, DW = 27, DY = 80, REST = 0.6;
const U0 = [Math.sin(rad(TURN)), -Math.cos(rad(TURN))], N0 = [Math.cos(rad(TURN)), Math.sin(rad(TURN))];
/** A world point from the meter's frame: u across its face, w toward the viewer, z up. */
const W3 = (u, w, z) => [u * U0[0] + w * N0[0], u * U0[1] + w * N0[1], z];
/** A rounded rectangle in the face plane, as fillet points (five to a corner, from the bottom-left). */
const rect = (u0, z0, u1, z1, r) => fillet([[u0, z0], [u1, z0], [u1, z1], [u0, z1]], [r, r, r, r]);
const DIALS = [-22, -11, 0, 11, 22];

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let top = value;

  const C = Cam(45, 0.5, 1.96);
  fit(C, [W3(-BW / 2, 0, 0), W3(BW / 2, 0, 0), W3(-34, GD, 46), W3(34, GD, 46), W3(-BW / 2, BD + 7, 0), W3(BW / 2, BD + 7, 0), W3(0, 0, BH + 10), W3(-BW / 2, 0, BH), W3(BW / 2, 0, BH)], 200, 166);
  const P = proj(C), Q = (u, z, w) => P(...W3(u, w, z));
  /** A block standing off the face between depths w0 and w1: its silhouette, and its front's top and right edges as the crease. */
  const slab = (out, w0, w1) => ({ sil: poly(hull(out.map((p) => Q(p[0], p[1], w0)).concat(out.map((p) => Q(p[0], p[1], w1))))), crease: open(out.slice(7, 18).map((p) => Q(p[0], p[1], w1))) });
  /** A circle on a plane facing the viewer, at depth w. */
  const disc = (u, z, w, r, n = 20) => poly(Array.from({ length: n }, (_, k) => Q(u + r * Math.cos(rad((k * 360) / n)), z + r * Math.sin(rad((k * 360) / n)), w)));
  /** A point on the flat disc at radius r and angle a. */
  const D = (r, a, z = DZ) => Q(r * Math.cos(rad(a)), z, DW + r * Math.sin(rad(a)));

  const g = mk("g", {}, svg);
  // the lug it hangs by, behind the body, with its hole
  put(solid(g), slab(rect(-8, BH - 12, 8, BH + 10, 4), 4, 8));
  mk("path", { d: disc(0, BH + 3.5, 8.1, 3), class: "nf lo" }, g);
  // the body
  put(solid(g), slab(rect(-BW / 2, 0, BW / 2, BH, 10), 0, BD));
  // the terminal cover at the foot, with its four screws
  put(solid(g), slab(rect(-BW / 2 + 8, 5, BW / 2 - 8, 28, 4), BD, BD + 7));
  for (const u of [-24, -8, 8, 24]) {
    mk("path", { d: disc(u, 16.5, BD + 7.1, 2.8, 14) }, g);
    mk("path", { d: seg(Q(u - 1.8, 16.5, BD + 7.2), Q(u + 1.8, 16.5, BD + 7.2)), class: "nf lo" }, g);
  }

  // the works, on the body's face under the hood: the register's five dials, each with a hand
  mk("path", { d: poly(rect(-29, DY - 7.5, 29, DY + 7.5, 2.4).map((p) => Q(p[0], p[1], BD + 0.6))) }, g);
  const hands = DIALS.map((u) => {
    mk("path", { d: disc(u, DY, BD + 0.8, 4.6) }, g);
    return mk("path", { class: "nf" }, g);
  });
  // the spindle's bracket, and the spindle below the disc
  const arm = (z) => seg(Q(0, z, BD), Q(0, z, DW));
  mk("path", { d: arm(DZ - 12) + seg(Q(0, DZ - 12, DW), Q(0, DZ, DW)), class: "nf lo" }, g);
  // the disc: a thin plate, its rim's thickness, its mark and the trail behind it
  const ring = circ(DR, 48);
  const rim = ring.map((q) => D(DR, (Math.atan2(q.v, q.u) * 180) / Math.PI));
  mk("path", { d: poly(rim) }, g);
  mk("path", { d: open(ring.filter((q) => q.v > -0.2 * DR).map((q) => D(DR, (Math.atan2(q.v, q.u) * 180) / Math.PI, DZ - 1.6))), class: "nf lo" }, g);
  const trail = mk("path", { class: "nf" }, g), mark = mk("path", { class: "nf hi" }, g);
  const hub = mk("circle", { r: 1.3, class: "dot m" }, g);
  place(hub, D(0, 0));
  mk("path", { d: arm(DZ + 12) + seg(Q(0, DZ, DW), Q(0, DZ + 12, DW)), class: "nf lo" }, g);
  // the glass hood, unfilled and last, so nothing inside is hidden
  const hood = rect(-34, 46, 34, BH - 10, 10), glass = slab(hood, BD, GD);
  mk("path", { d: glass.sil, class: "nf sil" }, g);
  mk("path", { d: glass.crease, class: "nf lo" }, g);

  let phase = 40, drawn = "";
  function draw(rate) {
    const key = phase.toFixed(1) + "," + rate.toFixed(2);
    if (key === drawn) return;
    drawn = key;
    mark.setAttribute("d", seg(D(DR * 0.45, phase), D(DR * 0.96, phase)) + seg(D(DR * 0.96, phase - 5), D(DR * 0.96, phase + 5)));
    const len = clamp(rate * 140, 4, 200), pts = [];
    for (let k = 0; k <= 16; k++) pts.push(D(DR * 0.8, phase - 8 - (len * k) / 16));
    trail.setAttribute("d", open(pts));
    // each dial a tenth of the one to its right, turning the other way
    hands.forEach((el, i) => {
      const a = 90 - (((phase / 4) / 10 ** (DIALS.length - 1 - i)) * (i % 2 ? -1 : 1) + i * 67), r = rad(a), c = DIALS[i];
      el.setAttribute("d", seg(Q(c, DY, BD + 1), Q(c + 3.8 * Math.cos(r), DY + 3.8 * Math.sin(r), BD + 1)));
    });
  }

  const sp = spring(REST);
  const B = register(stage, (dt) => {
    stepS(sp, dt);
    if (!reducedMotion()) phase = (phase + sp.x * 0.22 * 360 * dt) % 36000;
    draw(sp.x);
    return !reducedMotion();
  });
  bag.add(B.unregister);

  // hit: the pointer's x across the meter's width at rest, inside its box
  const xl = Q(-BW / 2, 0, BD)[0], xr = Q(BW / 2, 0, BD)[0], ytop = Q(0, BH + 10, 0)[1] - 16, ybot = Q(0, 0, BD + 7)[1] + 16;
  let shown = "";
  function aim(p) {
    const inside = !!p && p[1] > ytop && p[1] < ybot && p[0] > xl - 30 && p[0] < xr + 30;
    const kw = inside ? Math.max(0.5, Math.round(clamp((p[0] - xl) / (xr - xl), 0, 1) * top * 2) / 2) : REST;
    sp.t = kw;
    const s = inside ? `${kw} kW` : "rest";
    if (s !== shown) { shown = s; read.textContent = s; }
    B.wake();
  }

  aim(null);
  bag.add(pointer(stage, { move: (p) => aim(p), leave: () => aim(null) }));
  bag.add(() => svg.replaceChildren());

  return {
    set: (v) => { top = v; },
    destroy: bag.dispose,
  };
}

hairline({
  name: "meter",
  means: "An electricity meter whose disc always turns: move the pointer to the right and the load rises and the disc spins faster.",
  rules: [1, 5, 7, 8],
  range: [3, 6, 9],
  tour: [[150, 170], [215, 170], [270, 170], null],
  mount,
});
