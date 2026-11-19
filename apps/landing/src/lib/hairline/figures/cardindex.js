/**
 * Card index: a wooden box on a plinth, its front wall carrying a label holder
 * and a finger hole, filled with twelve ruled index cards and three tabbed
 * dividers. The card under the pointer stands up and lifts out of the box;
 * the ones in front lean forward and the ones behind lean back, staggered
 * outwards from it. At rest the stack is parted at one divider, which takes
 * the bright edge. The slider is the stagger, in ms.
 *
 * The pattern: one of many, as Riffle. Tweens, a stagger by distance, and a
 * hit test on static bands along the cards' resting top edges.
 */
const {
  Cam, circ, clamp, facing, fillet, fit, hull, open, poly, prism, proj, rad, ringAt, rings, rrect, run, seg,
  tdone, tset, tval, tween, disposer, mk, pointer, put, register, solid,
} = HL;

const N = 12, W = 76, H = 44, G = 8, Y00 = 4, TW = 20, TH = 8, TK = 1.2, TABS = [6, 28, 50];
const DIV = [1, 5, 9], REST = 5, BACK = -18, FWD = 12, LIFT = 16;
const X0 = -6, X1 = W + 6, Y0 = -10, Y1 = Y00 + (N - 1) * G + 11, WH = 28, WT = 3, WR = 4;

/** A run of points ordered left to right on screen. */
const LR = (pts) => (pts[0][0] <= pts[pts.length - 1][0] ? pts : pts.slice().reverse());
/** Card i's lean at rest: the stack parted in front of the bright divider. */
const restLean = (i) => (i < REST ? -11 : i === REST ? -5 : 9);

/** Card i: a divider with a tab, or a plain card a little shorter. */
function card(i) {
  const d = DIV.indexOf(i);
  if (d < 0) return { tab: -1, shape: fillet([[0, 0], [W, 0], [W, H - 4], [0, H - 4]], [1, 1, 2.6, 2.6]) };
  const t0 = TABS[d];
  return {
    tab: t0,
    shape: fillet([[0, 0], [W, 0], [W, H], [t0 + TW, H], [t0 + TW, H + TH], [t0, H + TH], [t0, H], [0, H]], [1, 1, 3, 1.6, 2.4, 2.4, 1.6, 3]),
  };
}

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let stag = value;

  const C = Cam(45, 0.5, 1.7);
  fit(C, [[X0, Y0, -4], [X1, Y1, -4], [X1, Y0, -4], [X0, Y1, -4], [X1, Y0, H + TH + LIFT], [X0, Y0, H + TH]], 200, 166);
  const P = proj(C), front = facing(C);
  const g = mk("g", {}, svg);

  // the plinth, then the box's far half: its body, and the inner edge of its rim
  const [pr, pi] = rings(X0 - 3, Y0 - 3, X1 + 3, Y1 + 3, WR + 2, 1.2);
  put(solid(g), prism(P, front, pr, pi, -4, 0));
  const outer = rrect(X0, Y0, X1, Y1, WR, 6), inner = rrect(X0 + WT, Y0 + WT, X1 - WT, Y1 - WT, WR - WT / 2, 6);
  mk("path", { d: poly(hull(ringAt(P, outer, 0).concat(ringAt(P, outer, WH)))), class: "sil" }, g);
  mk("path", { d: poly(ringAt(P, inner, WH)), class: "nf" }, g);

  const cards = [];
  for (let i = 0; i < N; i++) {
    const { tab, shape } = card(i), grp = mk("g", {}, g);
    const back = mk("path", { class: "lo" }, grp), face = mk("path", { class: "sil" }, grp), lines = mk("path", { class: "nf lo" }, grp);
    cards.push({ tab, shape, back, face, lines, a: tween(restLean(i)), z: tween(0), key: "" });
  }

  // the near half: one opaque piece from the rim's inner edge down to the floor, then the front's label holder and finger hole
  const iF = LR(ringAt(P, run(inner, front), WH)), oT = LR(ringAt(P, run(outer, front), WH)), oB = LR(ringAt(P, run(outer, front), 0));
  mk("path", { d: poly([...iF, oT[oT.length - 1], ...oB.slice().reverse(), oT[0]]), class: "fo" }, g);
  mk("path", { d: open(oT), class: "nf lo" }, g);
  mk("path", { d: open(iF), class: "nf" }, g);
  mk("path", { d: open([oT[0], ...oB, oT[oT.length - 1]]), class: "nf sil" }, g);
  const hx = (X0 + X1) / 2, onFront = (ring, du = 0, dz = 0) => ring.map((q) => P(q.u + du, Y1, q.v + dz));
  mk("path", { d: poly(onFront(rrect(hx - 15, 15, hx + 15, 24, 1.8, 4))) }, g);
  mk("path", { d: poly(onFront(rrect(hx - 12.4, 16.8, hx + 12.4, 22.2, 1, 4))), class: "nf lo" }, g);
  mk("path", { d: poly(onFront(circ(4.4, 20), hx, 8)), class: "nf" }, g);
  mk("path", { d: open(onFront(circ(3.4, 20).filter((q) => q.v > 0), hx, 7.6)), class: "nf lo" }, g);

  /** Card i leaning th degrees (negative leans back) and lifted: its outline, its back edge and its lines. */
  function draw(i, th, lift) {
    const cd = cards[i], yb = Y00 + i * G, s = Math.sin(rad(th)), c = Math.cos(rad(th));
    const w = (u, v) => P(u, yb + v * s, v * c + lift);
    const wb = (u, v) => P(u, yb + v * s - TK * c, v * c + TK * s + lift);
    cd.back.setAttribute("d", poly(cd.shape.map((p) => wb(p[0], p[1]))));
    cd.face.setAttribute("d", poly(cd.shape.map((p) => w(p[0], p[1]))));
    // a plain card: its heading rule and two lines; a divider: the window on its tab
    if (cd.tab < 0) cd.lines.setAttribute("d", [H - 10, H - 16, H - 22].map((v) => seg(w(5, v), w(W - 5, v))).join(""));
    else cd.lines.setAttribute("d", poly(rrect(cd.tab + 3, H + 2, cd.tab + TW - 3, H + TH - 2, 1, 3).map((q) => w(q.u, q.v))));
  }

  const B = register(stage, (_dt, now) => {
    let moving = false;
    cards.forEach((cd, i) => {
      const th = tval(cd.a, now), z = tval(cd.z, now), key = `${th.toFixed(2)},${z.toFixed(2)}`;
      if (key !== cd.key) { cd.key = key; draw(i, th, z); }
      if (!tdone(cd.a, now) || !tdone(cd.z, now)) moving = true;
    });
    return moving;
  });
  bag.add(B.unregister);

  // hit bands: oblique strips along the cards' top edges at a fixed lean; they never move, and nothing draws them
  const top = (i) => P(W / 2, Y00 + i * G + H * Math.sin(rad(-4)), H * Math.cos(rad(-4)));
  const c0 = top(0), c1 = top(1), d = [c1[0] - c0[0], c1[1] - c0[1]];
  const px0 = P(0, 0, 0), px1 = P(1, 0, 0), ex = [px1[0] - px0[0], px1[1] - px0[1]];
  const HALF = W / 2 + 6, det = d[0] * ex[1] - d[1] * ex[0];
  function hit([x, y]) {
    const qx = x - c0[0], qy = y - c0[1];
    const s = (qx * ex[1] - qy * ex[0]) / det, r = (d[0] * qy - d[1] * qx) / det;
    if (Math.abs(r) > HALF || s < -0.6 || s > N + 0.4) return -1;
    return clamp(Math.round(s), 0, N - 1);
  }

  let act = -2;
  function setActive(a) {
    if (a === act) return;
    const now = performance.now(), from = a >= 0 ? a : act >= 0 ? act : REST;
    act = a;
    cards.forEach((cd, i) => {
      const delay = Math.abs(i - from) * stag;
      const th = a < 0 ? restLean(i) : i < a ? BACK : i > a ? FWD : 0;
      tset(cd.a, th, now, delay); tset(cd.z, i === a ? LIFT : 0, now, delay);
      cd.face.classList.toggle("hi", a < 0 ? i === REST : i === a);
    });
    read.textContent = a < 0 ? "rest" : `card ${N - a}`;
    B.wake();
  }

  setActive(-1);
  bag.add(pointer(stage, { move: (p) => setActive(hit(p)), leave: () => setActive(-1) }));
  bag.add(() => svg.replaceChildren());

  return {
    set: (v) => { stag = v; },
    destroy: bag.dispose,
  };
}

hairline({
  name: "cardindex",
  means: "A wooden card index: the card under the pointer lifts out of the box, and its neighbours lean away in turn.",
  rules: [1, 2, 5, 8],
  range: [0, 35, 70],
  tour: [[244, 116], [198, 141], [156, 164], null],
  mount,
});
