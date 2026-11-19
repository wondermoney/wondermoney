/**
 * Inflation: a balance scale on a stepped foot, a stack of coins in one pan
 * and a shopping basket in the other. The pointer's x runs through ten years;
 * prices compound at the slider's rate, goods rise into the basket, staggered
 * from the newest, and the beam, on a spring, tips toward them, lifting the
 * same coins. The newest good takes the bright edge; at rest the top coin does.
 * The slider is the yearly rate, in %.
 *
 * The pattern: scrub and pick. A spring for the beam, tweens for the goods, a
 * hit test on fixed screen bands, and a basket drawn far half, goods, near
 * half, so what sits low in it stays hidden.
 */
const {
  Cam, circ, clamp, facing, fillet, fit, hull, lerp, open, poly, prism, proj, rad, ringAt, rrect, run, seg,
  spring, stepS, tween, tset, tval, tdone, disposer, mk, pointer, put, register, solid,
} = HL;

const R2 = Math.SQRT1_2, YEARS = 10;
const L = 58, ZP = 104, HANG = 62, PR = 26, DB = 6, CR = 13, CT = 4.6, NC = 5;
const BH = 15, REST_T = 4, REST_N = 2;
/** A world point from the scale's own frame: s along the screen's horizontal, d toward the viewer, z up. */
const W = (s, d, z) => [(s + d) * R2, (d - s) * R2, z];
const at = (ring, cx, cy) => ring.map((q) => ({ ...q, u: q.u + cx, v: q.v + cy }));
/** A ring drawn in the scale's frame (u along s, v along d), centred on s0, d0, turned into world x, y. */
const sd = (ring, s0, d0) => ring.map((q) => { const [u, v] = W(q.u + s0, q.v + d0, 0); return { ...q, u, v, nu: (q.nu + q.nv) * R2, nv: (q.nv - q.nu) * R2 }; });
/** A run of points ordered left to right on screen. */
const LR = (pts) => (pts[0][0] <= pts[pts.length - 1][0] ? pts : pts.slice().reverse());
/** The goods, in the order they arrive: a bottle, a cereal box, a gabled carton and a can, where they stand in the basket (s, d), their size and height. */
const GOODS = [
  { s: 6.5, d: -4, r: 3.8, h: 32, neck: true },
  { s: -6.5, d: -5, w: 5.2, dd: 2, h: 28 },
  { s: -5.5, d: 4, w: 3.8, dd: 3.8, h: 25, gable: true },
  { s: 6.5, d: 4.5, r: 4.4, h: 21 },
];

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let rate = value, year = -1;

  // Fitted to both pans at their lowest and the hooks at their highest, so no pose leaves the frame.
  const C = Cam(45, 0.5, 1.68), E = L + PR + 1;
  fit(C, [W(-E, DB, ZP - HANG - 22), W(E, DB, ZP - HANG - 22), W(-E, DB, ZP + 18), W(E, DB, ZP + 18), W(0, -31, 0), W(0, 31, 0), W(-L, DB + PR, ZP - HANG - 22), W(L, DB + PR, ZP - HANG - 22)], 200, 166);
  const P = proj(C), front = facing(C), Q = (s, d, z) => P(...W(s, d, z));
  const g = mk("g", {}, svg);

  // the stand: a stepped round foot and a slim column
  put(solid(g), prism(P, front, circ(30, 48), circ(28.2, 48), 0, 5));
  put(solid(g), prism(P, front, circ(17, 40), circ(15.6, 40), 5, 10));
  put(solid(g), prism(P, front, circ(4.5, 24), circ(3.4, 24), 10, ZP));
  // the gauge: a fan plate on the column under the pivot, with its balance mark
  const fan = [];
  for (let k = 0; k <= 8; k++) { const a = rad(-26 + k * 6.5); fan.push([23 * Math.sin(a), ZP - 23 * Math.cos(a)]); }
  for (let k = 8; k >= 0; k--) { const a = rad(-26 + k * 6.5); fan.push([13 * Math.sin(a), ZP - 13 * Math.cos(a)]); }
  mk("path", { d: poly(fillet(fan, fan.map(() => 0.8)).map(([s, z]) => Q(s, 4.8, z))) }, g);
  mk("path", { d: seg(Q(0, 4.8, ZP - 15), Q(0, 4.8, ZP - 21)), class: "nf lo" }, g);

  // the beam: a bar thicker at the middle, its back for thickness, a needle under it, a boss on the pivot
  const shape = fillet([[-L - 3, -1.6], [-9, -4.4], [9, -4.4], [L + 3, -1.6], [L + 3, 1.6], [9, 4.4], [-9, 4.4], [-L - 3, 1.6]], [1.4, 3, 3, 1.4, 1.4, 3, 3, 1.4]);
  const needle = fillet([[-2, 0], [2, 0], [0, -20]], [1, 1, 0.8]);
  const eNeedle = mk("path", {}, g), eBack = mk("path", { class: "lo" }, g), eFace = mk("path", { class: "sil" }, g);
  const boss = [], pin = [];
  for (let k = 0; k < 20; k++) { const a = (k / 20) * Math.PI * 2; boss.push(Q(5.4 * Math.cos(a), DB + 2.4, ZP + 5.4 * Math.sin(a))); pin.push(Q(2.6 * Math.cos(a), DB + 2.4, ZP + 2.6 * Math.sin(a))); }
  mk("path", { d: poly(boss) }, g);
  mk("path", { d: poly(pin), class: "nf lo" }, g);

  /** A pan: two cords to a hook, and a shallow dish. */
  function pan() {
    return { cords: mk("path", { class: "nf" }, g), dish: solid(g) };
  }
  const left = pan();
  const coins = [];
  for (let i = 0; i < NC; i++) {
    const s = solid(g), mill = mk("path", { class: "nf lo" }, s.g);
    coins.push({ s, mill, jx: Math.sin(i * 2.3) * 1.4, jy: Math.cos(i * 1.7) * 1.2 });
  }
  const right = pan();
  // the basket: far half, the goods at the back, the handle, the goods in front, then the near half
  const bFar = mk("path", { class: "sil" }, g), bRim = mk("path", { class: "nf" }, g);
  const goods = GOODS.map((gd, i) => ({ ...gd, t: tween(i < REST_N ? 1 : 0) }));
  goods.filter((gd) => gd.d < 0).forEach((gd) => { gd.el = solid(g); });
  const handle = mk("path", { class: "nf sil" }, g);
  goods.filter((gd) => gd.d > 0).forEach((gd) => { gd.el = solid(g); });
  const bNear = mk("path", { class: "fo" }, g), bBand = mk("path", { class: "nf lo" }, g), bTop = mk("path", { class: "nf lo" }, g);
  const bIn = mk("path", { class: "nf" }, g), bSide = mk("path", { class: "nf sil" }, g);

  const th = spring(REST_T, { eps: 0.01 });
  let key = "";

  /** Hangs a pan from the beam end at s, z; returns the dish's top height. */
  function hang(p, s, z) {
    const zp = z - HANG, c = W(s, DB, 0);
    p.cords.setAttribute("d", seg(Q(s, DB, z), Q(s, DB, z - 5)) + seg(Q(s, DB, z - 5), Q(s - PR, DB, zp)) + seg(Q(s, DB, z - 5), Q(s + PR, DB, zp)));
    const foot = at(circ(PR - 6, 40), c[0], c[1]), top = at(circ(PR, 48), c[0], c[1]);
    put(p.dish, { sil: poly(hull(ringAt(P, foot, zp - 3.5).concat(ringAt(P, top, zp)))), crease: open(ringAt(P, run(at(circ(PR - 1.6, 48), c[0], c[1]), front), zp)) });
    return zp;
  }

  function good(gd, rs, z0, now) {
    const t = tval(gd.t, now), s0 = rs + gd.s, d0 = DB + gd.d, h = lerp(6, gd.h, t);
    if (t < 0.03) return put(gd.el, { sil: "", crease: "" });
    if (gd.neck) {
      const body = sd(circ(gd.r, 24), s0, d0), sho = z0 + h * 0.6;
      return put(gd.el, { sil: poly(hull(ringAt(P, body, z0).concat(ringAt(P, body, sho), ringAt(P, sd(circ(gd.r - 1.2, 24), s0, d0), sho + 3), ringAt(P, sd(circ(1.7, 16), s0, d0), z0 + h)))), crease: open(ringAt(P, run(body, front), sho)) });
    }
    const box = (b) => (gd.r ? sd(circ(gd.r - b, 24), s0, d0) : sd(rrect(-gd.w + b, -gd.dd + b, gd.w - b, gd.dd - b, 1.2 - b * 0.7, 4), s0, d0));
    if (gd.gable) {
      const ridge = sd(rrect(-gd.w, -0.5, gd.w, 0.5, 0.4, 3), s0, d0), eave = z0 + h - 5;
      return put(gd.el, { sil: poly(hull(ringAt(P, box(0), z0).concat(ringAt(P, box(0), eave), ringAt(P, ridge, z0 + h)))), crease: open(ringAt(P, run(box(0), front), eave)) });
    }
    put(gd.el, prism(P, front, box(0), box(0.8), z0, z0 + h));
  }

  function draw(now) {
    const a = rad(th.x), k = `${th.x.toFixed(3)}|${goods.map((gd) => tval(gd.t, now).toFixed(3)).join()}`;
    if (k === key) return;
    key = k;
    const rot = ([u, v]) => [u * Math.cos(a) + v * Math.sin(a), ZP - u * Math.sin(a) + v * Math.cos(a)];
    eFace.setAttribute("d", poly(shape.map(rot).map(([s, z]) => Q(s, DB + 1.6, z))));
    eBack.setAttribute("d", poly(shape.map(rot).map(([s, z]) => Q(s, DB - 1.6, z))));
    eNeedle.setAttribute("d", poly(needle.map(rot).map(([s, z]) => Q(s, DB - 0.4, z))));
    // the coins' pan
    const ls = -L * Math.cos(a), zl = hang(left, ls, ZP + L * Math.sin(a)), lc = W(ls, DB, 0);
    coins.forEach((cn, i) => {
      const x = lc[0] + cn.jx, y = lc[1] + cn.jy, z = zl + i * CT, ring = at(circ(CR, 32), x, y);
      put(cn.s, prism(P, front, ring, at(circ(CR - 1.4, 32), x, y), z, z + CT - 1));
      cn.mill.setAttribute("d", open(ringAt(P, run(ring, front), z + (CT - 1) * 0.45)));
    });
    // the basket's pan: a tub wider at the rim, a woven band, a handle arching over the goods
    const rs = L * Math.cos(a), z0 = hang(right, rs, ZP - L * Math.sin(a)), zt = z0 + BH;
    const ring = (hs, hd, r) => sd(rrect(-hs, -hd, hs, hd, r, 5), rs, DB);
    const foot = ring(13, 8.5, 3), top = ring(17, 11.5, 4), inner = ring(15.4, 9.9, 2.6), mid = ring(15, 10, 3.5);
    bFar.setAttribute("d", poly(hull(ringAt(P, foot, z0).concat(ringAt(P, top, zt)))));
    bRim.setAttribute("d", poly(ringAt(P, inner, zt)));
    const arch = [];
    for (let k2 = 0; k2 <= 16; k2++) { const u = Math.cos((k2 / 16) * Math.PI); arch.push(Q(rs + u * 15.4, DB, zt + 15 * Math.sqrt(1 - u * u))); }
    handle.setAttribute("d", open(arch));
    goods.forEach((gd) => good(gd, rs, z0 + 1, now));
    const iF = LR(ringAt(P, run(inner, front), zt)), oT = LR(ringAt(P, run(top, front), zt)), oB = LR(ringAt(P, run(foot, front), z0));
    bNear.setAttribute("d", poly([...iF, oT[oT.length - 1], ...oB.slice().reverse(), oT[0]]));
    bTop.setAttribute("d", open(oT));
    bIn.setAttribute("d", open(iF));
    bSide.setAttribute("d", open([oT[0], ...oB, oT[oT.length - 1]]));
    bBand.setAttribute("d", open(ringAt(P, run(mid, front), z0 + BH * 0.5)));
  }

  const B = register(stage, (dt, now) => {
    let moving = stepS(th, dt);
    goods.forEach((gd) => { if (!tdone(gd.t, now)) moving = true; });
    draw(now);
    return moving;
  });
  bag.add(B.unregister);

  // what a year costs: prices compound, the basket's goods and the beam's lean follow, both clamped
  const price = (yr) => Math.pow(1 + rate / 100, yr);
  const tilt = (yr) => clamp(-3 + 36 * (price(yr) - 1), -3, 15);
  const count = (yr) => clamp(1 + Math.floor((price(yr) - 1) / 0.1), 1, 4);

  let shown = REST_N;
  function setYear(yr) {
    year = yr;
    const now = performance.now(), n = yr < 0 ? REST_N : count(yr), pivot = n > shown ? shown : n - 1;
    th.t = yr < 0 ? REST_T : tilt(yr);
    goods.forEach((gd, i) => {
      tset(gd.t, i < n ? 1 : 0, now, Math.abs(i - pivot) * 45);
      gd.el.sil.classList.toggle("hi", yr >= 0 && i === n - 1);
    });
    shown = n;
    coins[NC - 1].s.sil.classList.toggle("hi", yr < 0);
    read.textContent = yr < 0 ? "rest" : `yr ${yr}`;
    B.wake();
  }

  // hit bands: the years laid across the scale's width at rest, by screen x; they never move
  const xl = Q(-E, DB, ZP - HANG)[0], xr = Q(E, DB, ZP - HANG)[0];
  const yt = Q(0, DB, ZP + 22)[1], yb = Q(0, 32, 0)[1] + 14;
  function hit([x, y]) {
    if (x < xl - 8 || x > xr + 8 || y < yt || y > yb) return -1;
    return Math.round(clamp((x - xl) / (xr - xl), 0, 1) * YEARS);
  }

  setYear(-1);
  bag.add(pointer(stage, { move: (p) => { const yr = hit(p); if (yr !== year) setYear(yr); }, leave: () => setYear(-1) }));
  bag.add(() => svg.replaceChildren());

  return {
    set: (v) => { rate = v; if (year >= 0) setYear(year); },
    destroy: bag.dispose,
  };
}

hairline({
  name: "inflation",
  means: "A balance scale: move through the years and the basket of goods outweighs the same stack of coins.",
  rules: [3, 5, 8, 6],
  range: [2, 4, 7],
  tour: [[112, 170], [230, 170], [340, 170], null],
  mount,
});
