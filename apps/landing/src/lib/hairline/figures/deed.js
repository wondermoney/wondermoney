/**
 * Deed: a property deed lying on a second sheet, a ruled header, lines of
 * text drawn as rules, a small plan of the plot, two lines to sign on, and a
 * wax seal over a ribbon whose two tails run off its edge. A house key lies
 * across it. Bring the pointer near the key and it rises off the deed and
 * turns its face up to you, the nearer the more, leaving a dashed outline
 * where it lay. The slider is the reach, in world units.
 *
 * The pattern: a field with one part. A spring on the lift, a falloff with
 * the pointer's distance on the ground plane (which never moves), and a guide
 * painted before the key that covers it at rest.
 */
const {
  Cam, circ, clamp, facing, fillet, fit, hull, open, poly, prism, proj, rad, rings, rrect, seg, unproj,
  spring, stepS, disposer, mk, pointer, put, register, solid,
} = HL;

const SW = 84, SD = 108, ST = 2.2, TK = 2.2, LIFT = 26, TURN = 62, KX = 18, KY = 60;
const SEAL = [62, 90], SR = 10.5;

/** The key's outline in its own plane: a round bow at a = 0, a neck, a collar, and a blade cut on its near edge. */
const KEY = (() => {
  const pts = [], t0 = Math.asin(0.32);
  for (let k = 0; k <= 20; k++) { const t = t0 + (k / 20) * (2 * Math.PI - 2 * t0); pts.push([10 * Math.cos(t), -10 * Math.sin(t)]); }
  pts.reverse();
  pts.push([16, -3.2], [16, -5], [19.5, -5], [19.5, -3.6], [49, -3.6], [52, -0.6], [52, 1.6]);
  pts.push([48, 4.6], [45, 4.6], [43, 2.4], [40, 5.2], [37, 5.2], [35, 2.6], [32, 5.2], [29, 5.2], [27, 3], [24, 5.2], [19.5, 5.2], [19.5, 5], [16, 5], [16, 3.2]);
  return fillet(pts, pts.map(() => 0.5));
})();
const HOLE = circ(3.4, 16).map((q) => [-3.6 + q.u, q.v]);

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let reach = value;

  const C = Cam(45, 0.5, 2.16);
  fit(C, [[-6, -4, 0], [SW + 4, SD + 16, 0], [SW + 4, -4, 0], [-6, SD + 16, 0], [KX, KY, ST + LIFT + 12], [KX + 40, KY - 40, ST + LIFT + 12]], 200, 170);
  const P = proj(C);
  const on = (ring, z) => ring.map((q) => P(q.u, q.v, z));
  const top = (pts) => pts.map((p) => P(p[0], p[1], ST + 0.05));

  const g = mk("g", {}, svg);
  // the sheet underneath, turned a little; then the deed itself
  const c5 = Math.cos(rad(5)), s5 = Math.sin(rad(5));
  const under = rrect(-SW / 2, -SD / 2, SW / 2, SD / 2, 2, 4).map((q) => ({ ...q, u: SW / 2 - 4 + q.u * c5 - q.v * s5, v: SD / 2 + 3 + q.u * s5 + q.v * c5 }));
  mk("path", { d: poly(hull(on(under, -ST).concat(on(under, 0)))), class: "lo" }, g);
  const [dr, di] = rings(0, 0, SW, SD, 2.4, 1);
  put(solid(g), prism(P, facing(C), dr, di, 0, ST));
  // the writing, as geometry: a ruled header, lines of text, a plan of the plot, two lines to sign on
  mk("path", { d: poly(top(fillet([[12, 9], [SW - 12, 9], [SW - 12, 17], [12, 17]], [1.6, 1.6, 1.6, 1.6]))), class: "nf" }, g);
  let lines = seg(...top([[10, 22], [SW - 10, 22]])) + seg(...top([[10, 23.6], [SW - 10, 23.6]]));
  [62, 58, 64, 54, 60, 40, 44, 36, 66, 50].forEach((len, k) => {
    const y = 31 + k * 5.6, x1 = k >= 3 && k <= 7 ? Math.min(10 + len, 42) : 10 + len;
    lines += seg(...top([[10, y], [x1, y]]));
  });
  lines += seg(...top([[10, 98], [36, 98]]));
  mk("path", { d: lines, class: "nf lo" }, g);
  mk("path", { d: poly(top(fillet([[48, 47], [SW - 10, 47], [SW - 10, 72], [48, 72]], [1, 1, 1, 1]))), class: "nf" }, g);
  mk("path", { d: poly(top(fillet([[53, 52], [65, 52], [65, 59], [69, 59], [69, 67], [53, 67]], [0.6, 0.6, 0.6, 0.6, 0.6, 0.6]))), class: "nf lo dash" }, g);

  // the ribbon: two tails from under the seal, off the deed's near edge, cut in a V
  for (const [ex, ey] of [[50, 122], [78, 120]]) {
    const dx = ex - SEAL[0], dy = ey - SEAL[1], L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L, w = 3.4;
    const at = (t, s) => P(SEAL[0] + ux * t - uy * s, SEAL[1] + uy * t + ux * s, t < SD - SEAL[1] ? ST + 0.4 : 0.6);
    mk("path", { d: poly(fillet([at(0, -w), at(L - 2, -w), at(L - 6, 0), at(L - 2, w), at(0, w)], [0.4, 0.6, 0.8, 0.6, 0.4])), class: "" }, g);
  }
  // the seal: a disc of wax with a waved edge, a ring pressed into it
  const wav = (r, z) => { const ring = []; for (let k = 0; k < 56; k++) { const t = (k / 56) * 2 * Math.PI, rr = r + 0.7 * Math.cos(t * 14); ring.push(P(SEAL[0] + rr * Math.cos(t), SEAL[1] + rr * Math.sin(t), z)); } return ring; };
  const seal = mk("path", { d: poly(hull(wav(SR, ST + 0.5).concat(wav(SR, ST + 3.4)))), class: "sil" }, g);
  mk("path", { d: poly(wav(SR, ST + 3.4)), class: "nf lo" }, g);
  mk("path", { d: poly(on(circ(6.4, 28).map((q) => ({ ...q, u: SEAL[0] + q.u, v: SEAL[1] + q.v })), ST + 3.4)) + poly(on(circ(3.2, 20).map((q) => ({ ...q, u: SEAL[0] + q.u, v: SEAL[1] + q.v })), ST + 3.4)), class: "nf" }, g);

  // where the key lay, then the key: back, face, the hole in its bow, the groove along its blade
  const cs = Math.cos(rad(-45)), sn = Math.sin(rad(-45));
  /** A point (a, b) of the key, w out of its face, lifted by h and turned by phi so its far edge comes up. */
  const kp = (a, b, w, h, phi) => {
    const bb = b * Math.cos(phi) + w * Math.sin(phi), z = ST + TK + h - b * Math.sin(phi) + w * Math.cos(phi);
    return P(KX + a * cs - bb * sn, KY + a * sn + bb * cs, z);
  };
  mk("path", { d: poly(KEY.map((p) => P(KX + p[0] * cs - p[1] * sn, KY + p[0] * sn + p[1] * cs, ST + 0.1))), class: "nf dash" }, g);
  const back = mk("path", { class: "lo" }, g), face = mk("path", { class: "sil" }, g);
  const hole = mk("path", { class: "nf" }, g), groove = mk("path", { class: "nf lo" }, g);

  const sp = spring(0, { eps: 0.002 });
  let drawn = NaN;
  function draw(t) {
    if (t === drawn) return;
    drawn = t;
    const h = t * LIFT, phi = rad(t * TURN);
    back.setAttribute("d", poly(KEY.map((p) => kp(p[0], p[1], -TK, h, phi))));
    face.setAttribute("d", poly(KEY.map((p) => kp(p[0], p[1], 0, h, phi))));
    hole.setAttribute("d", poly(HOLE.map((p) => kp(p[0], p[1], 0, h, phi))));
    groove.setAttribute("d", seg(kp(21, 0.6, 0, h, phi), kp(47, 0.6, 0, h, phi)));
  }

  const B = register(stage, (dt) => { const m = stepS(sp, dt); draw(Math.round(clamp(sp.x, 0, 1.1) * 1000) / 1000); return m; });
  bag.add(B.unregister);

  // hit: the pointer on the ground, which never moves; the key answers by its distance from where it lies
  const mid = [KX + 22 * cs, KY + 22 * sn];
  function aim(p) {
    if (!p) { sp.t = 0; read.textContent = "rest"; }
    else {
      const [x, y] = unproj(C, p[0], p[1], ST);
      if (x < -16 || x > SW + 16 || y < -16 || y > SD + 20) return aim(null);
      const u = clamp(1 - Math.hypot(x - mid[0], y - mid[1]) / reach, 0, 1);
      sp.t = u * u * (3 - 2 * u);
      read.textContent = `${Math.round(sp.t * TURN)}°`;
    }
    const lit = sp.t > 0.05;
    face.classList.toggle("hi", lit);
    seal.classList.toggle("hi", !lit);
    B.wake();
  }

  aim(null);
  bag.add(pointer(stage, { move: aim, leave: () => aim(null) }));
  bag.add(() => svg.replaceChildren());

  return {
    set: (v) => { reach = v; },
    destroy: bag.dispose,
  };
}

hairline({
  name: "deed",
  means: "A property deed under a wax seal: bring the pointer near the house key on it and the key rises and turns to you.",
  rules: [1, 3, 5, 6],
  range: [30, 50, 80],
  tour: [[262, 170], [214, 147], [130, 190], null],
  mount,
});
