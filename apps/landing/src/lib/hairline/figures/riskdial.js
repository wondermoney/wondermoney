/**
 * Risk dial: a gauge on a block base, its half-round face turned toward the
 * viewer. Round the face runs an arc of five segments, thin at the cautious
 * end and thicker toward the bold one, a ring of ticks inside it, and a
 * tapered needle on a hub. The pointer's x sets the needle on a spring, from
 * cautious on the left to bold on the right; the segment it points into
 * takes the bright edge and its number goes to the read-out. The slider is
 * the gain: how far the needle swings for a move of the pointer.
 *
 * The pattern: a continuous value read against discrete bands. One spring
 * for the needle, a hit test on the dial's width at rest, and a solid turned
 * on the ground by rotating its rings, normals and all.
 */
const {
  Cam, clamp, facing, fillet, fit, hull, open, poly, prism, proj, rad, rings, seg, spring, stepS,
  disposer, mk, pointer, put, register, solid,
} = HL;

const TURN = 62, BW = 64, BD = 22, BH = 16, R = 58, ZC = BH + 9, T = 5, WD = -5;
const A0 = 168, A1 = 12, SEG = 5, GAP = 2.2, REST = 128;
/** The dial's own axes on the ground: u across its face, left to right on screen; n out of its face. */
const N0 = [Math.cos(rad(TURN)), Math.sin(rad(TURN))], U0 = [N0[1], -N0[0]];
const V = [0.612, 0.612, 0.5];
/** A world point from the dial's coordinates: u across, w out of the face, z up. */
const W3 = (u, w, z) => [u * U0[0] + w * N0[0], u * U0[1] + w * N0[1], z];
/** A ring in the dial's coordinates, turned onto the ground, normals and all. */
const turnRing = (ring) => ring.map((q) => ({ u: q.u * U0[0] + q.v * N0[0], v: q.u * U0[1] + q.v * N0[1], nu: q.nu * U0[0] + q.nv * N0[0], nv: q.nu * U0[1] + q.nv * N0[1] }));
/** The segment an angle points into, 0 (cautious) to 4 (bold). */
const band = (a) => clamp(Math.floor(((A0 - a) / (A0 - A1)) * SEG), 0, SEG - 1);

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let gain = value;

  const C = Cam(45, 0.5, 1.86);
  fit(C, [W3(-BW, -BD, 0), W3(BW, BD, 0), W3(BW, -BD, 0), W3(-BW, BD, 0), W3(0, WD, ZC + R), W3(-R, WD, ZC + 20), W3(R, WD, ZC + 20)], 200, 166);
  const P = proj(C), front = facing(C), Q = (u, w, z) => P(...W3(u, w, z));
  /** A point on the face at radius r and angle a about the hub, standing off the face by d. */
  const F = (r, a, d = 0) => Q(r * Math.cos(rad(a)), WD + T / 2 + d, ZC + r * Math.sin(rad(a)));
  const g = mk("g", {}, svg);

  // the base: a block turned with the dial
  const [br, bi] = rings(-BW, -BD, BW, BD, 7, 1.8);
  put(solid(g), prism(P, front, turnRing(br), turnRing(bi), 0, BH));

  // the face: a half-round plate standing on the base, its silhouette the hull of its two faces,
  // its crease the run of the front face whose edge faces the camera
  const arc = [];
  for (let k = 0; k <= 36; k++) arc.push([R * Math.cos(rad(k * 5)), ZC + R * Math.sin(rad(k * 5)), k * 5]);
  const outline = fillet([[R, BH], ...arc.map((p) => [p[0], p[1]]), [-R, BH]], [3, ...arc.map(() => 0.01), 3], 3);
  const at = (w) => outline.map((p) => Q(p[0], w, p[1]));
  const sees = (t) => Math.cos(rad(t)) * (U0[0] * V[0] + U0[1] * V[1]) + Math.sin(rad(t)) * V[2] > 0;
  put(solid(g), {
    sil: poly(hull(at(WD - T / 2).concat(at(WD + T / 2)))),
    crease: open(arc.filter((p) => sees(p[2])).map((p) => Q(p[0], WD + T / 2, p[1]))),
  });

  // the arc of five segments, thickening toward bold, and the ticks inside it
  const span = (A0 - A1) / SEG, segs = [];
  for (let k = 0; k < SEG; k++) {
    const a0 = A0 - k * span - GAP / 2, a1 = A0 - (k + 1) * span + GAP / 2, ro = R - 6, ri = ro - 4 - k * 2.4, pts = [];
    for (let j = 0; j <= 10; j++) pts.push(F(ro, a0 + ((a1 - a0) * j) / 10));
    for (let j = 10; j >= 0; j--) pts.push(F(ri, a0 + ((a1 - a0) * j) / 10));
    segs.push(mk("path", { d: poly(pts), class: "nf" }, g));
  }
  let ticks = "";
  for (let k = 0; k <= 20; k++) ticks += seg(F(R - 22, A0 - (k * (A0 - A1)) / 20), F(k % 4 ? R - 25 : R - 28, A0 - (k * (A0 - A1)) / 20));
  mk("path", { d: ticks, class: "nf lo" }, g);

  const needle = mk("path", { class: "sil" }, g);
  const hub = Array.from({ length: 24 }, (_, k) => k * 15);
  mk("path", { d: poly(hub.map((a) => F(6, a, 1.6))) }, g);
  mk("path", { d: poly(hub.map((a) => F(2.4, a, 1.8))), class: "nf lo" }, g);

  let drawn = NaN;
  function draw(a) {
    if (a === drawn) return;
    drawn = a;
    needle.setAttribute("d", poly([F(R - 13, a, 1.2), F(4.4, a + 90, 1.2), F(7, a + 180, 1.2), F(4.4, a - 90, 1.2)]));
  }

  const sp = spring(REST);
  const B = register(stage, (dt) => {
    const m = stepS(sp, dt);
    draw(Math.round(sp.x * 100) / 100);
    return m;
  });
  bag.add(B.unregister);

  // hit: the pointer's x across the dial's width at rest, read from the hub outwards
  const xc = F(0, 0)[0], hw = (F(R, 0)[0] - F(R, 180)[0]) / 2;
  const ytop = F(R, 90)[1] - 24, ybot = Q(0, BD, 0)[1] + 24;
  let lvl = -2;
  function aim(p) {
    let k = -1, a = REST;
    if (p && p[1] > ytop && p[1] < ybot && Math.abs(p[0] - xc) < hw + 40) {
      a = 90 - clamp(((p[0] - xc) / hw) * gain, -1, 1) * (90 - A1);
      k = band(a);
    }
    sp.t = a;
    if (k !== lvl) {
      lvl = k;
      segs.forEach((el, i) => el.classList.toggle("hi", i === band(a)));
      read.textContent = k < 0 ? "rest" : `risk ${k + 1}`;
    }
    B.wake();
  }

  aim(null);
  bag.add(pointer(stage, { move: (p) => aim(p), leave: () => aim(null) }));
  bag.add(() => svg.replaceChildren());

  return {
    set: (v) => { gain = v; },
    destroy: bag.dispose,
  };
}

hairline({
  name: "riskdial",
  means: "A risk gauge: move the pointer from left to right and the needle swings from the cautious end to the bold one.",
  rules: [1, 3, 5, 8],
  range: [0.7, 1, 1.5],
  tour: [[130, 150], [210, 150], [290, 150], null],
  mount,
});
