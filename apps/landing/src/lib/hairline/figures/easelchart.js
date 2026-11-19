/**
 * Easel chart: a flip-chart easel on three legs, its pad held under a clamp
 * bar at the top with the sheets already turned rolled over the board, a pen
 * resting in the tray. On the top sheet a line chart: two axes, a few dim
 * rules and ten years of a market that climbs with dips. The pointer's x runs
 * a cursor along the line on a spring, a dot with a dashed drop to the
 * baseline, and the dot holds the bright edge; the year goes to the read-out.
 * The slider is the gain: how far the cursor runs for a move of the pointer.
 *
 * The pattern: a continuous value read along a line. One spring, a hit test
 * on the chart's width at rest, and a board leaning back in its own frame.
 */
const {
  Cam, clamp, facing, fillet, fit, hull, lerp, open, poly, prism, proj, rad, rings, seg, spring, stepS,
  disposer, mk, place, pointer, put, register, solid,
} = HL;

const TURN = 68, LEAN = 11, BW = 112, BH = 92, ZB = 54, T = 4, YEARS = 10, REST = 0.7;
const DATA = [0.12, 0.22, 0.18, 0.34, 0.29, 0.45, 0.37, 0.56, 0.66, 0.6, 0.84];
const U0 = [Math.sin(rad(TURN)), -Math.cos(rad(TURN))], N0 = [Math.cos(rad(TURN)), Math.sin(rad(TURN))];
const sL = Math.sin(rad(LEAN)), cL = Math.cos(rad(LEAN));
/** A world point from the easel's frame: u across, w toward the viewer, z up. */
const W3 = (u, w, z) => [u * U0[0] + w * N0[0], u * U0[1] + w * N0[1], z];
/** A point on the board's plane: u across, s up the board from its foot, d out of its face. */
const B3 = (u, s, d = 0) => W3(u, -s * sL + d * cL, ZB + s * cL + d * sL);
const turnRing = (ring) => ring.map((q) => ({ u: q.u * U0[0] + q.v * N0[0], v: q.u * U0[1] + q.v * N0[1], nu: q.nu * U0[0] + q.nv * N0[0], nv: q.nu * U0[1] + q.nv * N0[1] }));
/** A rounded rectangle on the board, as fillet points (five to a corner, from the bottom-left). */
const rect = (u0, s0, u1, s1, r) => fillet([[u0, s0], [u1, s0], [u1, s1], [u0, s1]], [r, r, r, r]);

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let gain = value;

  const S = 1.6, C = Cam(45, 0.5, S);
  const footS = -ZB / cL;
  fit(C, [B3(-BW / 2 - 6, footS, -T), B3(BW / 2 + 6, footS, -T), B3(-BW / 2, BH + 8, -T), B3(BW / 2, BH + 8, -T), W3(0, -44, 0)], 200, 166);
  const P = proj(C), front = facing(C), Q = (u, s, d) => P(...B3(u, s, d));
  /** A round bar between two screen points, r in world units: the outline of a cylinder seen side on. */
  function rod(a, b, r) {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy), nx = -dy / L, ny = dx / L, R = r * S, pts = [];
    for (let k = 0; k <= 17; k++) {
      const e = k < 9 ? a : b, t = rad(k * 22.5 - (k < 9 ? 0 : 22.5));
      pts.push([e[0] + R * (nx * Math.cos(t) - (dx / L) * Math.sin(t)), e[1] + R * (ny * Math.cos(t) - (dy / L) * Math.sin(t))]);
    }
    return poly(pts);
  }
  /** A plate on the board between depths d0 and d1: its silhouette, and its front's top and right edges as the crease. */
  const slab = (out, d0, d1) => ({ sil: poly(hull(out.map((p) => Q(p[0], p[1], d0)).concat(out.map((p) => Q(p[0], p[1], d1))))), crease: open(out.slice(7, 18).map((p) => Q(p[0], p[1], d1))) });

  const g = mk("g", {}, svg);
  // the legs: one behind, hinged at the top, and two in the board's plane splaying to the floor
  mk("path", { d: rod(Q(0, BH - 8, -T - 2.5), P(...W3(0, -44, 0)), 2.4) }, g);
  for (const sd of [-1, 1]) mk("path", { d: rod(Q(sd * (BW / 2 - 12), BH - 4, -T - 2), Q(sd * (BW / 2 + 5), footS, -T - 2), 2.6) }, g);
  // the board
  put(solid(g), slab(rect(-BW / 2, 0, BW / 2, BH, 3.2), -T, 0));

  // the pad: its top sheet, and the edges of the sheets under it along the foot
  const PW = BW - 12;
  mk("path", { d: poly(rect(-PW / 2, 6, PW / 2, BH - 6, 2).map((p) => Q(p[0], p[1], 1.6))) }, g);
  mk("path", { d: seg(Q(-PW / 2 + 2, 5.2, 0.9), Q(PW / 2 - 2, 5.2, 0.9)) + seg(Q(-PW / 2 + 3, 4.4, 0.4), Q(PW / 2 - 3, 4.4, 0.4)), class: "nf lo" }, g);
  // the sheets already turned, rolled over the top of the board
  const roll = (u) => Array.from({ length: 13 }, (_, k) => Q(u, BH - 5 + 6.5 * Math.sin(rad(k * 15)), -T / 2 + 6.5 * Math.cos(rad(k * 15))));
  mk("path", { d: poly(hull(roll(-PW / 2).concat(roll(PW / 2)))), class: "sil" }, g);
  mk("path", { d: open(roll(PW / 2 - 6)), class: "nf lo" }, g);
  // the clamp bar across the top, with a knob at each end
  put(solid(g), slab(rect(-BW / 2 + 2, BH - 16, BW / 2 - 2, BH - 5, 2.4), 1.6, 4.6));
  for (const sd of [-1, 1]) mk("path", { d: poly(Array.from({ length: 16 }, (_, k) => Q(sd * (BW / 2 - 10) + 2.4 * Math.cos(rad(k * 22.5)), BH - 10.5 + 2.4 * Math.sin(rad(k * 22.5)), 4.8))), class: "nf" }, g);

  // the chart on the sheet: axes, rules, a tick a year, and the line
  const U0c = -PW / 2 + 10, U1c = PW / 2 - 8, S0 = 16, S1 = BH - 26, D = 1.8;
  const cu = (t) => lerp(U0c, U1c, t), cs = (v) => lerp(S0, S1, v);
  let rules = "", ticks = "";
  for (const v of [0.33, 0.66, 1]) rules += seg(Q(U0c, cs(v), D), Q(U1c, cs(v), D));
  for (let k = 1; k <= YEARS; k++) ticks += seg(Q(cu(k / YEARS), S0, D), Q(cu(k / YEARS), S0 - 2.6, D));
  mk("path", { d: rules + ticks, class: "nf lo" }, g);
  mk("path", { d: open([Q(U0c, S1 + 4, D), Q(U0c, S0, D), Q(U1c + 3, S0, D)]), class: "nf" }, g);
  const past = mk("path", { class: "nf" }, g), next = mk("path", { class: "nf lo" }, g);
  const drop = mk("path", { class: "dash" }, g), ring = mk("path", { class: "nf hi" }, g);
  const dot = mk("circle", { r: 2, class: "dot" }, g);

  // the tray at the foot of the board, and a marker lying in it
  const [tr, ti] = rings(-BW / 2 + 1, -2, BW / 2 - 1, 9, 2.2, 1.2);
  put(solid(g), prism(P, front, turnRing(tr), turnRing(ti), ZB - 6, ZB));
  mk("path", { d: rod(P(...W3(-26, 4.5, ZB + 2)), P(...W3(8, 4.5, ZB + 2)), 2) }, g);
  mk("path", { d: rod(P(...W3(8, 4.5, ZB + 2)), P(...W3(15, 4.5, ZB + 2)), 1.6), class: "nf" }, g);

  let drawn = NaN;
  function draw(t) {
    if (t === drawn) return;
    drawn = t;
    const i = Math.min(YEARS - 1, Math.floor(t * YEARS)), v = lerp(DATA[i], DATA[i + 1], t * YEARS - i);
    const at = Q(cu(t), cs(v), D + 0.2);
    const pts = DATA.map((v, k) => Q(cu(k / YEARS), cs(v), D));
    past.setAttribute("d", open([...pts.slice(0, i + 1), at]));
    next.setAttribute("d", open([at, ...pts.slice(i + 1)]));
    drop.setAttribute("d", seg(at, Q(cu(t), S0, D)) + seg(at, Q(U0c, cs(v), D)));
    ring.setAttribute("d", poly(Array.from({ length: 16 }, (_, k) => [at[0] + 4.4 * Math.cos(rad(k * 22.5)), at[1] + 4.4 * Math.sin(rad(k * 22.5))])));
    place(dot, at);
  }

  const sp = spring(REST);
  const B = register(stage, (dt) => {
    const m = stepS(sp, dt);
    draw(Math.round(clamp(sp.x, 0, 1) * 1000) / 1000);
    return m;
  });
  bag.add(B.unregister);

  // hit: the pointer's x across the chart's width at rest, inside the easel's box
  const x0 = Q(U0c, S0, D)[0], x1 = Q(U1c, S0, D)[0], xm = (x0 + x1) / 2;
  const ytop = Q(0, BH + 8, 0)[1] - 16, ybot = Q(0, footS, 0)[1] + 12, xl = Q(-BW / 2, 0, 0)[0] - 30, xr = Q(BW / 2, 0, 0)[0] + 30;
  let yr = -2;
  function aim(p) {
    const inside = !!p && p[1] > ytop && p[1] < ybot && p[0] > xl && p[0] < xr;
    const t = inside ? clamp(0.5 + ((p[0] - xm) / (x1 - x0)) * gain, 0, 1) : REST;
    sp.t = t;
    const k = inside ? Math.round(t * YEARS) : -1;
    if (k !== yr) { yr = k; read.textContent = k < 0 ? "rest" : `yr ${k}`; }
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
  name: "easelchart",
  means: "A flip-chart easel with a market chart on its pad: move the pointer and a cursor runs along the years.",
  rules: [1, 3, 5, 9],
  range: [0.7, 1, 1.4],
  tour: [[150, 160], [215, 140], [262, 120], null],
  mount,
});
