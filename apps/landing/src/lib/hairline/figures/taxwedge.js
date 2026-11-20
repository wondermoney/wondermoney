/**
 * Taxwedge: a round tray holding a stack of coins cut like a pie. One wedge,
 * the tax share, sits slid out of the pie; at rest a modest one, a
 * seven-year hold half slid out, so the pie still reads whole. The pointer's left-to-right
 * position is the holding period, one to ten years, marked by ten dots along
 * the tray's front rim; the longer the hold, the thinner the wedge that slides
 * out. The wedge's width and slide each ride a spring. The slider is how far
 * the wedge slides, in world units.
 *
 * The pattern: scrub and pick. Springs, a hit test on fixed screen bands, a
 * pie whose cuts stay put while the wedge's two edges move, and paint order
 * taken from the planes the cuts make.
 */
const {
  Cam, clamp, facing, fillet, fit, flatDot, hull, open, place, poly, prism, proj, rad, ringAt, run, circ,
  spring, stepS, disposer, mk, pointer, put, register, solid,
} = HL;

const PR = 54, T = 5.6, LAY = 5, PH = LAY * T, TR = 86, TW = 4.5, TH = 7, A0 = -15, YRS = 10, REST = 7, OUT = 0.5;
/** The wedge's width in degrees after y years: a sharp drop past the first year, then a slow one. */
/** Where the rest of the pie is cut, on its far side so no cut shows on a wall facing the viewer; each piece stays under 180°. */
const CUT = [160, 250];
const width = (y) => 34 + 86 * Math.exp(-(y - 1) / 2.4);

/** Ring samples for a closed outline: drops repeated points and gives each an outward normal. */
function samples(pts) {
  const q = pts.filter((p, i) => { const r = pts[(i + pts.length - 1) % pts.length]; return Math.hypot(p[0] - r[0], p[1] - r[1]) > 1e-6; });
  let A = 0;
  q.forEach((p, i) => { const r = q[(i + 1) % q.length]; A += p[0] * r[1] - r[0] * p[1]; });
  const s = A > 0 ? 1 : -1;
  return q.map((p, i) => {
    const a = q[(i + q.length - 1) % q.length], c = q[(i + 1) % q.length], dx = c[0] - a[0], dy = c[1] - a[1], L = Math.hypot(dx, dy);
    return { u: p[0], v: p[1], nu: (s * dy) / L, nv: (-s * dx) / L };
  });
}

/** A pie slice from a0 to a1 degrees, inset by b, slid by d along its middle; its corners rounded. */
function sector(a0, a1, b, d) {
  const h = rad(a1 - a0) / 2, m = rad(a0) + h, k = b / Math.sin(h), rr = PR - b, e = Math.asin(b / rr);
  const ox = d * Math.cos(m), oy = d * Math.sin(m), n = Math.max(4, Math.ceil((a1 - a0) / 5));
  const pts = [[ox + k * Math.cos(m), oy + k * Math.sin(m)]];
  for (let i = 0; i <= n; i++) {
    const a = rad(a0) + e + ((2 * h - 2 * e) * i) / n;
    pts.push([ox + rr * Math.cos(a), oy + rr * Math.sin(a)]);
  }
  return samples(fillet(pts, pts.map((_, i) => (i < 2 || i === pts.length - 1 ? 3 - b * 0.6 : 0)), 3));
}

/** The coin rim on a slice's top: an arc just inside its curved edge. */
function rimArc(P, a0, a1, d) {
  const m = rad((a0 + a1) / 2), pts = [];
  for (let a = a0 + 4; a <= a1 - 4 + 1e-6; a += Math.max(1, (a1 - a0 - 8) / 16)) {
    pts.push(P(d * Math.cos(m) + (PR - 7) * Math.cos(rad(a)), d * Math.sin(m) + (PR - 7) * Math.sin(rad(a)), PH));
  }
  return open(pts);
}

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let slide = value;

  const C = Cam(45, 0.5, 1.74);
  fit(C, [[-TR, -TR, 0], [TR, TR, 0], [TR, -TR, 0], [-TR, TR, 0], [0, 0, PH]], 200, 170);
  const P = proj(C), front = facing(C);

  // the tray: its body and far rim before the pie, its near wall after it
  const outer = circ(TR, 72), inner = circ(TR - TW, 72);
  const g = mk("g", {}, svg);
  mk("path", { d: poly(hull(ringAt(P, outer, 0).concat(ringAt(P, outer, TH)))), class: "sil" }, g);
  mk("path", { d: poly(ringAt(P, inner, TH)), class: "nf" }, g);
  mk("path", { d: open(ringAt(P, run(inner, (q) => !front(q)), 1.5)), class: "nf lo" }, g);
  const pie = mk("g", {}, g);
  const LR = (pts) => (pts[0][0] <= pts[pts.length - 1][0] ? pts : pts.slice().reverse());
  const iF = LR(ringAt(P, run(inner, front), TH)), oT = LR(ringAt(P, run(outer, front), TH)), oB = LR(ringAt(P, run(outer, front), 0));
  mk("path", { d: poly([...iF, oT[oT.length - 1], ...oB.slice().reverse(), oT[0]]), class: "fo" }, g);
  mk("path", { d: open(oT), class: "nf lo" }, g);
  mk("path", { d: open(iF), class: "nf" }, g);
  mk("path", { d: open([oT[0], ...oB, oT[oT.length - 1]]), class: "nf sil" }, g);

  // ten years, as dots along the front rim, left to right on screen
  const dots = [], dx = [];
  for (let k = 0; k < YRS; k++) {
    const a = rad(135 - (k * 180) / (YRS - 1)), pt = P((TR - TW / 2) * Math.cos(a), (TR - TW / 2) * Math.sin(a), TH);
    const el = flatDot(g, C, 0.75, "dot off");
    place(el, pt);
    dots.push(el); dx.push(pt[0]);
  }

  // four pieces, painted back to front: the back slice, the right one, the wedge, the front-left one
  const piece = () => { const s = solid(pie); return { s, lay: mk("path", { class: "nf lo" }, s.g), rim: mk("path", { class: "nf lo" }, s.g) }; };
  const back = piece(), right = piece(), wedge = piece(), left = piece();
  wedge.s.sil.classList.add("hi");

  function slice(pc, a0, a1, d) {
    const o = sector(a0, a1, 0, d), i = sector(a0, a1, 1.8, d);
    put(pc.s, prism(P, front, o, i, 0, PH));
    const f = run(o, front);
    let lay = "";
    for (let k = 1; k < LAY; k++) lay += open(ringAt(P, f, k * T));
    pc.lay.setAttribute("d", lay);
    pc.rim.setAttribute("d", rimArc(P, a0, a1, d));
  }

  const th = spring(width(REST)), sl = spring(slide * OUT);
  let drawn = "";
  function draw() {
    const w = clamp(th.x, 20, 130), d = clamp(sl.x, 0, 26), key = `${w.toFixed(2)},${d.toFixed(2)}`;
    if (key === drawn) return;
    drawn = key;
    slice(back, CUT[0], CUT[1], 0);
    slice(right, CUT[1], A0 + 360 - w / 2, 0);
    slice(wedge, A0 - w / 2, A0 + w / 2, d);
    slice(left, A0 + w / 2, CUT[0], 0);
  }

  const B = register(stage, (dt) => {
    const a = stepS(th, dt), b = stepS(sl, dt);
    draw();
    return a || b;
  });
  bag.add(B.unregister);

  // hit: a fixed band over the tray; the year is the dot nearest the pointer's x
  const top = P(-TR, -TR, PH)[1] - 10, bot = P(TR, TR, 0)[1] + 10;
  function hit([x, y]) {
    if (y < top || y > bot || x < dx[0] - 24 || x > dx[YRS - 1] + 24) return -1;
    let best = 0;
    dx.forEach((v, k) => { if (Math.abs(v - x) < Math.abs(dx[best] - x)) best = k; });
    return best + 1;
  }

  let yr = 0;
  function setYear(y) {
    if (y === yr) return;
    yr = y;
    th.t = width(y < 0 ? REST : y);
    sl.t = y < 0 ? slide * OUT : slide;
    dots.forEach((el, k) => el.setAttribute("class", k === y - 1 ? "dot m" : "dot off"));
    read.textContent = y < 0 ? "rest" : `yr ${y}`;
    B.wake();
  }

  setYear(-1);
  bag.add(pointer(stage, { move: (p) => setYear(hit(p)), leave: () => setYear(-1) }));
  bag.add(() => svg.replaceChildren());

  return {
    set: (v) => { slide = v; sl.t = yr < 0 ? v * OUT : v; B.wake(); },
    destroy: bag.dispose,
  };
}

hairline({
  name: "taxwedge",
  means: "A pie of stacked coins with the tax share slid out: move right to hold longer, and the wedge thins.",
  rules: [1, 3, 6, 8],
  range: [10, 18, 24],
  tour: [[54, 160], [200, 200], [346, 160], null],
  mount,
});
