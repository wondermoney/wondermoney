/**
 * Booklets: five booklets leaning in a stand, each at its own angle. The one
 * under the pointer slides up out of the stand and its cover swings open on
 * the spine, showing the ruled first page; the ones behind it lean back, the
 * ones in front lean forward, staggered outwards. Each booklet has a page
 * block on its top edge, a scored spine and a title panel on its cover. The
 * slider is the stagger, in ms.
 *
 * The pattern: one of many, after Riffle. Tweens, a stagger by distance, a hit
 * test on static bands along the resting top edges, and a stand drawn in two
 * halves so the booklets sit inside it.
 */
const {
  Cam, clamp, facing, fit, hull, open, poly, proj, rad, ringAt, rrect, run, seg,
  tdone, tset, tval, tween, disposer, mk, pointer, register,
} = HL;

const N = 5, G = 16, TB = 5.5, LIFT = 28, OPEN = 34, BACK = -24, FWD = 18, ON = 2;
const WS = [52, 49, 54, 48, 51], HS = [70, 63, 74, 66, 69], REST = [-13, -10, -15, -9, -12];
const X0 = -6, X1 = 60, Y0 = -12, Y1 = (N - 1) * G + 9, WH = 18, WR = 6, WT = 2.4;

/** A run of points ordered left to right on screen. */
const LR = (pts) => (pts[0][0] <= pts[pts.length - 1][0] ? pts : pts.slice().reverse());

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let stag = value;

  const C = Cam(45, 0.5, 1.78);
  fit(C, [[X0, Y0, 0], [X1, Y1, -6], [X1, Y0, 0], [X0, Y1, 0], [X0, Y0 - 10, 74 + LIFT]], 200, 162);
  const P = proj(C), front = facing(C);

  // the stand: its far half before the booklets, its near half after them
  const outer = rrect(X0, Y0, X1, Y1, WR, 6), inner = rrect(X0 + WT, Y0 + WT, X1 - WT, Y1 - WT, WR - WT, 6);
  const g = mk("g", {}, svg);
  mk("path", { d: poly(hull(ringAt(P, outer, 0).concat(ringAt(P, outer, WH)))), class: "sil" }, g);
  mk("path", { d: poly(ringAt(P, inner, WH)), class: "nf" }, g);
  mk("path", { d: open(ringAt(P, run(inner, (q) => !front(q)), 2.5)), class: "nf lo" }, g);

  const books = [];
  for (let i = 0; i < N; i++) {
    const grp = mk("g", {}, g), el = (cls) => mk("path", { class: cls }, grp);
    books.push({
      grp, w: WS[i], h: HS[i], block: el("sil"), leaves: el("nf lo"), page: el("nf lo"), cover: el("sil"), face: el("nf lo"),
      a: tween(REST[i]), z: tween(i === ON ? 10 : 0), o: tween(0), key: "",
    });
  }

  const iF = LR(ringAt(P, run(inner, front), WH)), oT = LR(ringAt(P, run(outer, front), WH)), oB = LR(ringAt(P, run(outer, front), 0));
  mk("path", { d: poly([...iF, oT[oT.length - 1], ...oB.slice().reverse(), oT[0]]), class: "fo" }, g);
  mk("path", { d: open(oT), class: "nf lo" }, g);
  mk("path", { d: open(iF), class: "nf" }, g);
  mk("path", { d: open([oT[0], ...oB, oT[oT.length - 1]]), class: "nf sil" }, g);

  /** Booklet i leaning th degrees, lifted by z, its cover open by deg: u across, v up its face, t out of it. */
  function draw(i, th, z, deg) {
    const b = books[i], s = Math.sin(rad(th)), c = Math.cos(rad(th)), yb = i * G;
    const f = (u, v, t) => P(u, yb + v * s + t * c, v * c - t * s + z);
    const ca = Math.cos(rad(deg)), sa = Math.sin(rad(deg));
    const cv = (u, v) => f(u * ca, v, u * sa);
    const outline = rrect(0, 0, b.w, b.h, 2.6, 4);
    b.block.setAttribute("d", poly(hull(outline.map((q) => f(q.u, q.v, -TB)).concat(outline.map((q) => f(q.u, q.v, -0.4))))));
    // the page block's edge along the top, and the first page's rules
    b.leaves.setAttribute("d", [-1.6, -3.2].map((t) => seg(f(3, b.h, t), f(b.w - 3, b.h, t))).join(""));
    let rules = "";
    for (let v = b.h - 14; v > 10; v -= 7) rules += seg(f(8, v, -0.4), f(b.w - 7, v, -0.4));
    b.page.setAttribute("d", rules);
    b.cover.setAttribute("d", poly(outline.map((q) => cv(q.u, q.v))));
    // the cover: a score along the spine and a title panel
    b.face.setAttribute("d", seg(cv(4.5, 3), cv(4.5, b.h - 3)) + poly(rrect(10, b.h - 25, b.w - 7, b.h - 11, 2, 3).map((q) => cv(q.u, q.v))));
  }

  const B = register(stage, (_dt, now) => {
    let moving = false;
    books.forEach((b, i) => {
      const th = tval(b.a, now), z = tval(b.z, now), o = tval(b.o, now), key = `${th.toFixed(2)},${z.toFixed(2)},${o.toFixed(2)}`;
      if (key !== b.key) { b.key = key; draw(i, th, z, o); }
      if (!tdone(b.a, now) || !tdone(b.z, now) || !tdone(b.o, now)) moving = true;
    });
    return moving;
  });
  bag.add(B.unregister);

  // hit bands: oblique strips along each booklet's resting top edge. They never move.
  const top = (i) => P(WS[i] / 2, i * G + HS[i] * Math.sin(rad(REST[i])), HS[i] * Math.cos(rad(REST[i])));
  const tops = books.map((_, i) => top(i)), d = [tops[1][0] - tops[0][0], tops[1][1] - tops[0][1]];
  const px0 = P(0, 0, 0), px1 = P(1, 0, 0), ex = [px1[0] - px0[0], px1[1] - px0[1]];
  const HALF = 36, det = d[0] * ex[1] - d[1] * ex[0];
  /** The booklet whose band holds the point, measured in band widths from each resting top; -1 outside. */
  function hit([x, y]) {
    let best = -1, bs = Infinity;
    tops.forEach(([cx, cy], i) => {
      const qx = x - cx, qy = y - cy, s = (qx * ex[1] - qy * ex[0]) / det, r = (d[0] * qy - d[1] * qx) / det;
      if (Math.abs(r) <= HALF && Math.abs(s) < bs && (Math.abs(s) <= 0.5 || (i === 0 && s > -1.2) || (i === N - 1 && s < 2.5))) { best = i; bs = Math.abs(s); }
    });
    return best;
  }

  let act = -2;
  function pull(a) {
    if (a === act) return;
    const now = performance.now(), from = a >= 0 ? a : act;
    act = a;
    books.forEach((b, i) => {
      const delay = from >= 0 ? Math.abs(i - from) * stag : 0;
      tset(b.a, a < 0 ? REST[i] : i < a ? BACK : i > a ? FWD : 0, now, delay);
      tset(b.z, a < 0 ? (i === ON ? 10 : 0) : i === a ? LIFT : 0, now, delay);
      tset(b.o, i === a ? OPEN : 0, now, delay);
      const lit = a < 0 ? i === ON : i === a;
      b.block.classList.toggle("hi", lit); b.cover.classList.toggle("hi", lit);
    });
    read.textContent = a < 0 ? "rest" : `book ${N - a}`;
    B.wake();
  }

  pull(-1);
  bag.add(pointer(stage, { move: (p) => pull(hit(p)), leave: () => pull(-1) }));
  bag.add(() => svg.replaceChildren());

  return {
    set: (v) => { stag = v; },
    destroy: bag.dispose,
  };
}

hairline({
  name: "booklets",
  means: "Five booklets leaning in a stand: the one under the pointer slides up and opens, and the rest lean away.",
  rules: [1, 2, 5, 10],
  range: [0, 40, 90],
  tour: [[175, 156], [222, 119], [257, 104], null],
  mount,
});
