/**
 * Payslip: a payslip lying flat, a perforated tear-off edge, a ruled header,
 * five rows of a label and an amount, and a total under a double rule;
 * behind it a pay envelope stands on its edge, its flap folded back. Each
 * amount is gross: its right-hand share is the net. The pointer's depth on
 * the slip picks a row, and that row's net share lifts off, opens into a
 * note, turns upright and drops into the envelope, leaving the deduction and a dashed outline,
 * while the others go back to their rows, staggered outwards from it.
 * The slider is the stagger, in ms.
 *
 * The pattern: one of many. Tweens with a stagger by distance, a hit test on
 * the slip's flat plane, which never moves, and each share moved between a
 * group in front of the slip and one inside the envelope as it passes the mouth.
 */
const {
  Cam, clamp, facing, fit, hull, lerp, open, poly, prism, proj, rings, rrect, seg, unproj,
  tdone, tset, tval, tween, disposer, mk, place, pointer, put, register, solid,
} = HL;

const SW = 64, SD = 86, ST = 1.6, N = 5, RY = 28, RG = 10, REST = 2, BW = 6.2;
const EX0 = 4, EX1 = 60, EY = -10, ET = 2, EH = 34, OUT = 12, UP = 0.7, NW = 15;
/** Each row's amount, x0 to x1, and where the net share starts. */
const AMT = [[26, 58, 38], [32, 58, 40], [24, 58, 36], [36, 58, 42], [30, 58, 39]];
const N3 = 1 / Math.sqrt(3);

/** Turns a point about the (1, 1, 1) axis by th: at -120° x goes to z and y to x, so a share lying along x stands up in the envelope's plane. */
function turn([x, y, z], th) {
  const c = Math.cos(th), s = N3 * Math.sin(th), d = ((x + y + z) * (1 - c)) / 3;
  return [x * c + s * (z - y) + d, y * c + s * (x - z) + d, z * c + s * (y - x) + d];
}

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let stag = value;

  const C = Cam(45, 0.5, 2.1);
  fit(C, [[-2, -2, 0], [SW + 2, SD + 2, 0], [SW + 2, -2, 0], [-2, SD + 2, 0], [EX0, EY - ET, EH + 26], [EX1, EY - ET, EH + 26]], 200, 168);
  const P = proj(C), front = facing(C);
  const bar = (x0, x1, y, h, z) => poly(rrect(x0, y - h / 2, x1, y + h / 2, h / 2, 4).map((q) => P(q.u, q.v, z)));
  const face = (y) => (pts) => pts.map(([x, z]) => P(x, y, z));

  const g = mk("g", {}, svg);
  // the envelope, on its edge: the flap folded back, its body, the shares inside, then its front over them
  const mid = (EX0 + EX1) / 2, back = face(EY - ET), fr = face(EY);
  mk("path", { d: poly([P(EX0 + 1, EY - ET, EH - 0.5), P(mid - 3, EY - ET - 13, EH + 3), P(mid + 3, EY - ET - 13, EH + 3), P(EX1 - 1, EY - ET, EH - 0.5)]), class: "" }, g);
  const box = rrect(EX0, 0, EX1, EH, 2, 4).map((q) => [q.u, q.v]);
  mk("path", { d: poly(hull(back(box).concat(fr(box)))), class: "sil" }, g);
  mk("path", { d: open(back([[EX0 + 1.5, EH], [EX1 - 1.5, EH]])), class: "nf lo" }, g);
  const inside = mk("g", {}, g);
  mk("path", { d: poly(fr(box)), class: "" }, g);
  mk("path", { d: open(fr([[EX0 + 2, EH - 2], [mid, EH * 0.42], [EX1 - 2, EH - 2]])) + seg(...fr([[EX0 + 2, 2], [mid - 3, EH * 0.4]])) + seg(...fr([[EX1 - 2, 2], [mid + 3, EH * 0.4]])), class: "nf lo" }, g);

  // the slip: a thin sheet, its tear-off edge, a ruled header, label and amount rows, a total
  const [sr, si] = rings(0, 0, SW, SD, 2, 0.9);
  put(solid(g), prism(P, front, sr, si, 0, ST));
  const z = ST + 0.05;
  for (let k = 0; k < 12; k++) place(mk("circle", { r: 0.8, class: "dot off" }, g), P(6, 5 + k * 7, z));
  let lab = seg(P(12, 15, z), P(30, 15, z)) + seg(P(42, 15, z), P(SW - 6, 15, z)) + seg(P(11, 20, z), P(SW - 5, 20, z));
  for (let i = 0; i < N; i++) {
    const y = RY + i * RG;
    lab += seg(P(12, y, z), P(19 + ((i * 5) % 7), y, z)) + bar(AMT[i][0], AMT[i][2], y, BW, z);
  }
  const ty = RY + N * RG;
  lab += seg(P(11, ty - 3.4, z), P(SW - 5, ty - 3.4, z)) + seg(P(11, ty - 2, z), P(SW - 5, ty - 2, z));
  mk("path", { d: lab, class: "nf lo" }, g);
  mk("path", { d: bar(12, 40, 9, 4.6, z) + bar(30, 58, ty + 3, 5.4, z), class: "nf" }, g);
  mk("path", { d: AMT.map((a, i) => bar(a[2], a[1], RY + i * RG, BW, z)).join(""), class: "nf dash" }, g);
  const outside = mk("g", {}, g);

  /** A share: a bar on the slip that opens out into a note as it rises. */
  const shape = (len, a) => { const w = lerp(BW, NW, a); return rrect(0, -w / 2, len, w / 2, lerp(BW / 2, 1.6, a), 4).map((q) => [q.u, q.v, 0]); };
  const rows = AMT.map((a, i) => {
    const len = a[1] - a[2], slot = [EX0 + NW / 2 + 1 + i * 8, EY - ET / 2];
    return {
      len, start: [a[2], RY + i * RG, ST + 0.3], top: [slot[0], slot[1], EH + 2], end: [slot[0], slot[1], EH + OUT - len],
      el: mk("path", { class: "" }, outside), t: tween(i === REST ? 1 : 0), drawn: NaN, inside: false,
    };
  });

  function draw(rw, t) {
    if (t === rw.drawn) return;
    rw.drawn = t;
    // up and over to stand above its slot, turning as it goes; then down into the envelope
    const a = clamp(t / UP, 0, 1), b = clamp((t - UP) / (1 - UP), 0, 1);
    const base = t < UP ? rw.start.map((v, k) => lerp(v, rw.top[k], a) + (k === 2 ? Math.sin(Math.PI * a) * 10 : 0)) : rw.top.map((v, k) => lerp(v, rw.end[k], b));
    const th = ((-2 * Math.PI) / 3) * (1 - (1 - a) * (1 - a));
    rw.el.setAttribute("d", poly(shape(rw.len, a).map((p) => { const q = turn(p, th); return P(base[0] + q[0], base[1] + q[1], base[2] + q[2]); })));
    const inn = t > UP;
    if (inn !== rw.inside) { rw.inside = inn; (inn ? inside : outside).appendChild(rw.el); }
  }

  const B = register(stage, (_dt, now) => {
    let moving = false;
    rows.forEach((rw) => { draw(rw, Math.round(tval(rw.t, now) * 1000) / 1000); if (!tdone(rw.t, now)) moving = true; });
    return moving;
  });
  bag.add(B.unregister);

  // hit: the pointer put on the slip's plane, which never moves; its depth picks the row
  function hit(p) {
    const [x, y] = unproj(C, p[0], p[1], ST);
    if (x < -14 || x > SW + 14 || y < RY - RG / 2 - 4 || y > RY + (N - 0.5) * RG) return -1;
    return clamp(Math.round((y - RY) / RG), 0, N - 1);
  }

  let act = -2;
  function choose(a) {
    if (a === act) return;
    const now = performance.now(), from = a >= 0 ? a : act >= 0 ? act : REST;
    act = a;
    rows.forEach((rw, i) => {
      const d = Math.abs(i - from), on = a < 0 ? i === REST : i === a;
      tset(rw.t, on ? 1 : 0, now, d * stag);
      rw.el.setAttribute("class", on ? "sil hi" : "");
    });
    read.textContent = a < 0 ? "rest" : `row ${a + 1}`;
    B.wake();
  }

  choose(-1);
  bag.add(pointer(stage, { move: (p) => choose(hit(p)), leave: () => choose(-1) }));
  bag.add(() => svg.replaceChildren());

  return {
    set: (v) => { stag = v; },
    destroy: bag.dispose,
  };
}

hairline({
  name: "payslip",
  means: "A payslip and a pay envelope: the row under the pointer lifts its net share off the slip and drops it into the envelope.",
  rules: [1, 2, 5, 6],
  range: [0, 45, 90],
  tour: [[230, 217], [201, 232], [171, 246], null],
  mount,
});
