/**
 * Payslip: a payslip standing out of its pay envelope, a little askew. The
 * envelope stands on its edge with its flap folded open behind the slip and
 * the seams of its back towards us. The slip has a header band, a gross row,
 * three deduction rows, a double rule and the net pay as a bold bar. The
 * amounts run as a waterfall across the gross: the tax is cut from its start,
 * the social security from where the tax stopped, and the net bar, the bright
 * mark, is what is left. The pointer's x sets the gross pay on a spring; the
 * tax rises with it, so the tax bar widens and the net bar shrinks. The slider
 * is the top tax rate, in percent.
 *
 * The pattern: a scrub. One spring for the gross, a hit test on the slip's
 * width at rest, and the slip painted between the envelope's two panels so
 * the part inside stays hidden.
 */
const {
  Cam, clamp, fillet, fit, hull, lerp, open, poly, proj, rad, seg, spring, stepS,
  disposer, mk, pointer, put, register, solid,
} = HL;

const TURN = 62, LEAN = 8, FOLD = 34, EW = 100, EH = 56, ET = 3, FH = 40;
const SW = 74, SH = 108, SU = 11, SB = 30, TILT = -5, R = SW / 2 - 6, AW = 54, ROW = 9, REST = 0.4;
const U0 = [Math.sin(rad(TURN)), -Math.cos(rad(TURN))], N0 = [Math.cos(rad(TURN)), Math.sin(rad(TURN))];
const sL = Math.sin(rad(LEAN)), cL = Math.cos(rad(LEAN)), sT = Math.sin(rad(TILT)), cT = Math.cos(rad(TILT));
/** A world point from the envelope's frame: u across it, h up its face, w toward the viewer; the whole leans back. */
const W = (u, h, w) => { const ww = w - h * sL; return [u * U0[0] + ww * N0[0], u * U0[1] + ww * N0[1], h * cL]; };
/** A point on the slip: s across it from its middle, t up from its foot. */
const S = (s, t) => [SU + s * cT - t * sT, SB + s * sT + t * cT];
const rect = (u0, z0, u1, z1, r) => fillet([[u0, z0], [u1, z0], [u1, z1], [u0, z1]], [r, r, r, r]);
/** Gross, its two deductions (income tax, rising with the pay, and social security) and the net, as shares of the top gross. */
function split(g, top) {
  const tax = (top / 100) * g ** 1.4 * g, soc = 0.11 * g;
  return [g, tax, soc, g - tax - soc];
}
const gross = (x) => lerp(0.25, 1, clamp(x, 0, 1));

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let top = value;

  const C = Cam(45, 0.5, 1.66);
  const flap = (u, f) => W(u, EH + f * Math.cos(rad(FOLD)), -ET - f * Math.sin(rad(FOLD)));
  const sp = (s, t, w = -ET / 2) => { const [u, h] = S(s, t); return W(u, h, w); };
  fit(C, [W(-EW / 2, 0, 0), W(EW / 2, 0, 0), W(-EW / 2, EH, -ET), W(EW / 2, EH, -ET), flap(0, FH), sp(-SW / 2, SH), sp(SW / 2, SH), sp(SW / 2, 0)], 200, 166);
  const P = proj(C), Q = (u, h, w) => P(...W(u, h, w)), Z = (s, t, w) => P(...sp(s, t, w));
  const env = rect(-EW / 2, 0, EW / 2, EH, 3);

  const g = mk("g", {}, svg);
  // the flap, folded open behind; then the envelope's body, both panels
  mk("path", { d: poly(fillet([flap(-EW / 2 + 2, 0), flap(-6, FH), flap(6, FH), flap(EW / 2 - 2, 0)].map((p) => P(...p)), [0, 4, 4, 0])) }, g);
  put(solid(g), { sil: poly(hull(env.map((p) => Q(p[0], p[1], -ET)).concat(env.map((p) => Q(p[0], p[1], 0))))), crease: "" });
  mk("path", { d: open([Q(-EW / 2 + 2, EH - 1, -ET + 0.4), Q(EW / 2 - 2, EH - 1, -ET + 0.4)]), class: "nf lo" }, g);

  // the slip: a sheet with its thickness, a header band, rows and a double rule
  const sheet = rect(-SW / 2, 0, SW / 2, SH, 2).map((p) => S(p[0], p[1]));
  put(solid(g), { sil: poly(hull(sheet.map(([u, h]) => Q(u, h, -ET / 2 - 0.6)).concat(sheet.map(([u, h]) => Q(u, h, -ET / 2 + 0.6))))), crease: open(sheet.slice(7, 18).map(([u, h]) => Q(u, h, -ET / 2 + 0.6))) });
  const f = -ET / 2 + 0.7, row = (k) => SH - 28 - k * ROW, NET = row(3) - 4;
  const L = (s0, s1, t) => seg(Z(s0, t, f), Z(s1, t, f));
  mk("path", { d: poly(rect(-R - 1, SH - 17, R + 1, SH - 5, 2.6).map((p) => Z(p[0], p[1], f))), class: "nf" }, g);
  let labels = L(-R + 3, -R + 24, SH - 11) + L(R - 12, R - 3, SH - 11);
  [7, 5, 6].forEach((n, k) => { labels += L(-R, -R + n, row(k)); });
  labels += L(-R, R, row(2) - 5) + L(-R, R, row(2) - 6.6) + L(-R, -R + 6, NET);
  mk("path", { d: labels, class: "nf lo" }, g);
  const amounts = mk("path", { class: "nf" }, g);
  const net = mk("path", { class: "nf sil hi" }, g);

  // the envelope's back panel, over the slip's foot: its fill, its edges and seams
  mk("path", { d: poly(env.map((p) => Q(p[0], p[1], 0))), class: "fo" }, g);
  mk("path", { d: open(env.slice(17).concat(env.slice(0, 8)).map((p) => Q(p[0], p[1], 0))), class: "nf sil" }, g);
  mk("path", { d: open(env.slice(7, 13).map((p) => Q(p[0], p[1], 0))), class: "nf lo" }, g);
  mk("path", { d: open(env.slice(12, 18).map((p) => Q(p[0], p[1], 0))), class: "nf" }, g);
  mk("path", { d: open([Q(-EW / 2 + 3, 3, 0), Q(-4, EH * 0.5, 0), Q(4, EH * 0.5, 0), Q(EW / 2 - 3, 3, 0)]) + seg(Q(-EW / 2 + 3, EH - 3, 0), Q(-14, EH * 0.42, 0)) + seg(Q(EW / 2 - 3, EH - 3, 0), Q(14, EH * 0.42, 0)), class: "nf lo" }, g);

  let drawn = "";
  function draw(x) {
    const key = x.toFixed(4) + "," + top;
    if (key === drawn) return;
    drawn = key;
    const v = split(gross(x), top).map((a, k, all) => (a / all[0]) * AW);
    const bar = (s0, s1, t, h) => poly(rect(s0, t - h, s1, t + h, h).map((p) => Z(p[0], p[1], f)));
    const at = R - v[0];
    amounts.setAttribute("d", bar(at, R, row(0), 1.7) + bar(at, at + v[1], row(1), 1.7) + bar(at + v[1], at + v[1] + v[2], row(2), 1.7));
    net.setAttribute("d", poly(rect(R - v[3], NET - 2.8, R, NET + 2.8, 2.8).map((p) => Z(p[0], p[1], f))));
  }

  const gs = spring(REST);
  const B = register(stage, (dt) => {
    const m = stepS(gs, dt);
    draw(gs.x);
    return m;
  });
  bag.add(B.unregister);

  // hit: the pointer's x across the slip's width at rest, inside the figure's box
  const xl = Z(-SW / 2, 0, 0)[0], xr = Z(SW / 2, 0, 0)[0], ytop = Z(0, SH, 0)[1] - 30, ybot = Q(0, 0, 0)[1] + 20;
  let shown = "";
  function aim(p) {
    const inside = !!p && p[1] > ytop && p[1] < ybot && p[0] > xl - 40 && p[0] < xr + 40;
    const x = inside ? clamp((p[0] - xl) / (xr - xl), 0, 1) : REST;
    gs.t = x;
    const v = split(gross(x), top);
    const s = inside ? `net ${Math.round((v[3] / v[0]) * 100)}%` : "rest";
    if (s !== shown) { shown = s; read.textContent = s; }
    B.wake();
  }

  aim(null);
  bag.add(pointer(stage, { move: (p) => aim(p), leave: () => aim(null) }));
  bag.add(() => svg.replaceChildren());

  return {
    set: (v) => { top = v; drawn = ""; draw(gs.x); },
    destroy: bag.dispose,
  };
}

hairline({
  name: "payslip",
  means: "A payslip out of its envelope: move right to raise the gross pay; the tax takes a larger share and the net bar shrinks.",
  rules: [1, 4, 5, 6],
  range: [20, 35, 50],
  tour: [[150, 170], [215, 170], [280, 170], null],
  mount,
});
