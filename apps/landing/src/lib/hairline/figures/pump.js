/**
 * Pump: a petrol pump on its island, a tall body under a wider head, the
 * head's display panel a few blank windows and two buttons, a fill gauge
 * down the front, and on its side a holster holding the nozzle, its hose
 * looping down to the ground and back into the body. With the pointer on
 * it the nozzle lifts out of the holster on the 700ms curve, and the
 * pointer's height sets how much goes in, on a spring: the gauge's column
 * rises to it, and holds the bright edge. The slider is the tank, in litres.
 *
 * The pattern: a continuous value with a discrete gesture. A spring for the
 * level, a tween for the lift, and a hit test on the pump's box at rest.
 */
const {
  Cam, clamp, facing, fillet, fit, lerp, open, poly, prism, proj, rad, rings, seg, spring, stepS,
  tdone, tset, tval, tween, disposer, mk, pointer, put, register, solid,
} = HL;

const TURN = 68, S = 1.82, ZB = 8, ZH = 90, ZT = 124, BU = 26, BW = 16, HU = 30, HW = 19, REST = 0.3;
const G0 = 22, G1 = 82, LIFT = [9, 0, 26];
const U0 = [Math.sin(rad(TURN)), -Math.cos(rad(TURN))], N0 = [Math.cos(rad(TURN)), Math.sin(rad(TURN))];
/** A world point from the pump's frame: u across its front, w toward the viewer, z up. */
const W3 = (u, w, z) => [u * U0[0] + w * N0[0], u * U0[1] + w * N0[1], z];
const turnRing = (ring) => ring.map((q) => ({ u: q.u * U0[0] + q.v * N0[0], v: q.u * U0[1] + q.v * N0[1], nu: q.nu * U0[0] + q.nv * N0[0], nv: q.nu * U0[1] + q.nv * N0[1] }));
/** A rounded rectangle on a face, as fillet points. */
const rect = (u0, z0, u1, z1, r) => fillet([[u0, z0], [u1, z0], [u1, z1], [u0, z1]], [r, r, r, r]);
/** The nozzle, in its own frame from the spout's tip: the spout, the body, the grip, and where the hose joins. */
const NZ = { tip: [0, 0, 0], neck: [1.5, 0, 12], head: [8, 0, 21], grip: [17, 0, 18] };

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let tank = value;

  const C = Cam(45, 0.5, S);
  const A = [31, 1, 74];
  fit(C, [W3(-44, -28, 0), W3(66, 28, 0), W3(66, -28, 0), W3(-44, 28, 0), W3(-HU, -HW, ZT), W3(HU, -HW, ZT), W3(A[0] + 26, 0, A[2] + 21 + LIFT[2])], 200, 166);
  const P = proj(C), front = facing(C), Q = (u, w, z) => P(...W3(u, w, z)), F = (w) => (p) => Q(p[0], w, p[1]);
  /** A round bar between two screen points, r in world units. */
  function rod(a, b, r) {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, R = r * S, pts = [];
    for (let k = 0; k <= 17; k++) {
      const e = k < 9 ? a : b, t = rad(k * 22.5 - (k < 9 ? 0 : 22.5));
      pts.push([e[0] + R * (-uy * Math.cos(t) - ux * Math.sin(t)), e[1] + R * (ux * Math.cos(t) - uy * Math.sin(t))]);
    }
    return poly(pts);
  }
  /** A hose: a tube of radius r along screen points. */
  function tube(pts, r) {
    const L = [], Rr = [];
    pts.forEach((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const nx = (-(b[1] - a[1]) / d) * r * S, ny = ((b[0] - a[0]) / d) * r * S;
      L.push([p[0] + nx, p[1] + ny]); Rr.push([p[0] - nx, p[1] - ny]);
    });
    return poly(L.concat(Rr.reverse()));
  }
  const block = (u0, w0, u1, w1, r, b, z0, z1) => { const [o, i] = rings(u0, w0, u1, w1, r, b); return prism(P, front, turnRing(o), turnRing(i), z0, z1); };

  const g = mk("g", {}, svg);
  put(solid(g), block(-44, -28, 66, 28, 6, 2, 0, ZB));
  put(solid(g), block(-BU, -BW, BU, BW, 5, 1.6, ZB, ZH));
  put(solid(g), block(-HU, -HW, HU, HW, 6, 1.8, ZH, ZT));
  // the display: a panel of blank windows, and two buttons
  mk("path", { d: poly(rect(-23, ZH + 7, 23, ZT - 6, 3).map(F(HW))) }, g);
  for (const z of [ZH + 11, ZH + 20]) mk("path", { d: poly(rect(-19, z, 7, z + 6, 1.4).map(F(HW + 0.1))), class: "nf lo" }, g);
  for (const z of [ZH + 13.5, ZH + 22.5]) mk("path", { d: poly(Array.from({ length: 14 }, (_, k) => Q(14.5 + 2.6 * Math.cos(rad(k * 25.7)), HW + 0.1, z + 2.6 * Math.sin(rad(k * 25.7))))), class: "nf" }, g);
  // the fill gauge down the front: a window, its ticks, and the column inside it
  mk("path", { d: poly(rect(-19, G0, -7, G1, 3).map(F(BW))) }, g);
  let ticks = "";
  for (let k = 1; k < 6; k++) ticks += seg(Q(-4.5, BW, lerp(G0, G1, k / 6)), Q(k % 3 ? -2 : 0.5, BW, lerp(G0, G1, k / 6)));
  mk("path", { d: ticks, class: "nf lo" }, g);
  const column = mk("path", { class: "nf hi" }, g);
  // a seam where the body's door opens, on the front
  mk("path", { d: open(rect(4, ZB + 8, 20, ZH - 8, 2.6).map(F(BW))), class: "nf lo" }, g);

  // the hose, the spout, the holster, then the rest of the nozzle
  const hose = mk("path", {}, g), spout = mk("path", {}, g);
  mk("path", { d: rod(Q(BU - 1, 4, 32), Q(BU + 5, 4, 32), 3.4) }, g);
  put(solid(g), block(BU, -7, BU + 9, 9, 2.4, 1, A[2] - 8, A[2] + 6));
  const body = mk("path", { class: "sil" }, g), grip = mk("path", {}, g), guard = mk("path", { class: "nf" }, g);

  function draw(o, lv) {
    const off = (p) => Q(A[0] + p[0] + LIFT[0] * o, A[1] + p[1] + LIFT[1] * o, A[2] + p[2] + LIFT[2] * o);
    spout.setAttribute("d", rod(off(NZ.tip), off(NZ.neck), 1.5));
    body.setAttribute("d", rod(off(NZ.neck), off(NZ.head), 3.6));
    grip.setAttribute("d", rod(off(NZ.head), off(NZ.grip), 2.6));
    guard.setAttribute("d", open([off([4, 0, 15]), off([8, 0, 12]), off([14, 0, 13.5]), off([16, 0, 16.5])]));
    // the hose leaves the body low on its side, sags to the island and climbs to the grip
    const p0 = [BU + 4, 4, 32], p3 = [A[0] + NZ.grip[0] + LIFT[0] * o, 1, A[2] + NZ.grip[2] + LIFT[2] * o];
    const p1 = [BU + 22, 8, -8], p2 = [p3[0] + 18, 4, p3[2] - 62], pts = [];
    for (let k = 0; k <= 24; k++) {
      const t = k / 24, b = [(1 - t) ** 3, 3 * t * (1 - t) ** 2, 3 * t * t * (1 - t), t ** 3];
      pts.push(Q(...[0, 1, 2].map((j) => b[0] * p0[j] + b[1] * p1[j] + b[2] * p2[j] + b[3] * p3[j])));
    }
    hose.setAttribute("d", tube(pts, 2.2));
    column.setAttribute("d", poly(rect(-16.5, G0 + 2.5, -9.5, Math.max(G0 + 6, lerp(G0 + 2.5, G1 - 2.5, lv)), 1.8).map(F(BW + 0.2))));
  }

  const sp = spring(REST), lift = tween(0);
  let key = "";
  const B = register(stage, (dt, now) => {
    const m = stepS(sp, dt), o = tval(lift, now), k = `${o.toFixed(3)},${sp.x.toFixed(3)}`;
    if (k !== key) { key = k; draw(o, clamp(sp.x, 0, 1)); }
    return m || !tdone(lift, now);
  });
  bag.add(B.unregister);

  // hit: the pump's box at rest; the height inside it, read against the gauge, sets the level
  const xl = Q(-HU, HW, 0)[0] - 16, xr = Q(70, 0, 0)[0] + 10, ytop = Q(0, -HW, ZT)[1] - 14, ybot = Q(0, 28, 0)[1] + 10;
  const y0 = Q(-13, BW, G0)[1], y1 = Q(-13, BW, G1)[1];
  let shown = "";
  function aim(p) {
    const inside = !!p && p[0] > xl && p[0] < xr && p[1] > ytop && p[1] < ybot;
    const lv = inside ? clamp((y0 - p[1]) / (y0 - y1), 0.08, 1) : REST;
    sp.t = lv;
    tset(lift, inside ? 1 : 0, performance.now(), 0);
    const s = inside ? `${Math.max(5, Math.round((lv * tank) / 5) * 5)} L` : "rest";
    if (s !== shown) { shown = s; read.textContent = s; }
    B.wake();
  }

  aim(null);
  bag.add(pointer(stage, { move: (p) => aim(p), leave: () => aim(null) }));
  bag.add(() => svg.replaceChildren());

  return {
    set: (v) => { tank = v; },
    destroy: bag.dispose,
  };
}

hairline({
  name: "pump",
  means: "A petrol pump: put the pointer on it and the nozzle lifts; the higher the pointer, the further the fill gauge rises.",
  rules: [1, 5, 8, 9],
  range: [40, 60, 80],
  tour: [[190, 230], [200, 160], [215, 100], null],
  mount,
});
