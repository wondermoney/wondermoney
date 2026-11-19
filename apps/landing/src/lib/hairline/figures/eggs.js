/**
 * Eggs: an egg carton, its lid standing open behind, twelve cups in two rows
 * with the posts between them and the pods bulging under the tray. Ten cups
 * hold an egg, each a little different; two stand empty. The egg under the
 * pointer lifts straight out of its cup and takes the bright edge; the others
 * stay where they are, which is the point: one egg is not the carton. The
 * slider is how high it lifts.
 *
 * The pattern: one of many, without a spread. A tween per egg, a hit test on a
 * fixed plane through the eggs at rest, eggs cut at the rim so what is in the
 * cup stays hidden, and paint order by depth.
 */
const {
  Cam, circ, facing, fit, hull, open, poly, prism, proj, ringAt, rings, rrect, run, unproj,
  tset, tval, tdone, tween, disposer, mk, pointer, put, register, solid,
} = HL;

const NX = 6, NY = 2, PITCH = 24, RC = 9.8, TT = 16, FT = 2.2, D = 5.5;
const X0 = -4, Y0 = -4, X1 = NX * PITCH + 4, Y1 = NY * PITCH + 4, DP = Y1 - Y0;
const LD = 17, LA = 104, EMPTY = [4, 7], REST = 8;

/** A ring moved to (cx, cy). */
const at = (ring, cx, cy) => ring.map((q) => ({ ...q, u: q.u + cx, v: q.v + cy }));

/** Egg e with its foot at zb, cut at the rim: the broad end up, the pointed end in the cup. */
function eggPath(P, e, zb) {
  const zc = Math.max(zb, TT), pts = [], t0 = 0.44;
  const rAt = (z) => { const t = (z - zb) / e.h, u = (t - t0) / (t < t0 ? t0 : 1 - t0); return e.r * Math.sqrt(Math.max(0, 1 - u * u)); };
  if (zc > zb) pts.push(...ringAt(P, at(circ(rAt(zc), 28), e.x, e.y), zc));
  for (let s = 0; s <= 24; s++) {
    const f = Math.PI * s / 24, u = -Math.cos(f), z = zb + e.h * (t0 + u * (u < 0 ? t0 : 1 - t0)), r = e.r * Math.sin(f);
    if (z < zc) continue;
    pts.push(...(r < 0.05 ? [P(e.x, e.y, z)] : ringAt(P, at(circ(r, 28), e.x, e.y), z)));
  }
  return poly(hull(pts));
}

/** A solid whose top is smaller than its foot, as the rules write it. */
function taper(P, foot, top, z0, z1) {
  return { sil: poly(hull(ringAt(P, foot, z0).concat(ringAt(P, top, z1)))), crease: "" };
}

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let LIFT = value;

  // Fitted to the tray, the open lid and an egg at its highest.
  const C = Cam(45, 0.5, 1.74);
  const ca = Math.cos((LA * Math.PI) / 180), sa = Math.sin((LA * Math.PI) / 180);
  /** The lid's own frame: u along the hinge, v away from it, w out of its top; turned LA degrees open. */
  const lidW = (u, v, w) => [u, Y0 + v * ca - w * sa, TT + v * sa + w * ca];
  fit(C, [[X0, Y0, 0], [X1, Y1, 0], [X1, Y0, 0], [X0, Y1, 0], lidW(X0, DP, 0), lidW(X1, DP, 0), lidW(X0, DP, LD), [X1, Y0, TT + 21 + 44]], 200, 166);
  const P = proj(C), front = facing(C);
  const LP = (ring, w) => ring.map((q) => P(...lidW(q.u, q.v, w)));

  const g = mk("g", {}, svg);
  // the lid, open behind the tray: a shallow tapered shell seen from inside, its rim and its ceiling
  const lrim = rrect(X0, 0, X1, DP, 8, 6), ltop = rrect(X0 + 5, 5, X1 - 5, DP - 5, 5, 6);
  mk("path", { d: poly(hull(LP(lrim, 0).concat(LP(ltop, LD)))), class: "sil" }, g);
  mk("path", { d: poly(LP(rrect(X0 + 7, 7, X1 - 7, DP - 7, 4, 6), LD - 1)), class: "nf lo" }, g);
  mk("path", { d: poly(LP(rrect(X0 + 1.8, 1.8, X1 - 1.8, DP - 1.8, 6.2, 6), 0)), class: "nf" }, g);

  // the pods: one per cup, bulging under the flange, back to front
  const cups = [];
  for (let k = 0; k < NX * NY; k++) {
    const i = k % NX, j = Math.floor(k / NX), x = i * PITCH + PITCH / 2, y = j * PITCH + PITCH / 2;
    cups.push({ k, x, y, r: 8.3 + 0.45 * Math.sin(k * 2.1), h: 26 + 1.8 * Math.cos(k * 1.3), full: !EMPTY.includes(k) });
  }
  const byDepth = (a, b) => a.x + a.y - (b.x + b.y);
  for (const c of cups.slice().sort(byDepth)) {
    mk("path", { d: taper(P, at(circ(RC - 2.6, 32), c.x, c.y), at(circ(RC + 1.7, 32), c.x, c.y), 0, TT - FT).sil, class: "sil" }, g);
  }
  // the flange: a thin plate over the pods
  const [fr, fi] = rings(X0, Y0, X1, Y1, 7, 1.8);
  put(solid(g), prism(P, front, fr, fi, TT - FT, TT));

  // cups, eggs and the posts between them, back to front
  const posts = [1, 2, 3, 4, 5].map((i) => ({ x: i * PITCH, y: PITCH, post: true }));
  for (const it of cups.concat(posts).sort(byDepth)) {
    if (it.post) {
      mk("path", { d: taper(P, at(circ(4.4, 20), it.x, it.y), at(circ(1.5, 12), it.x, it.y), TT, TT + 10).sil, class: "sil" }, g);
      continue;
    }
    it.rim = mk("path", { d: poly(ringAt(P, at(circ(RC, 36), it.x, it.y), TT)), class: "nf lo" }, g);
    // the floor's far edge, seen only while the cup holds no egg
    it.floor = open(ringAt(P, run(at(circ(RC - 3.4, 32), it.x, it.y), (q) => !front(q)), TT - D));
    it.seam = mk("path", { d: it.full ? "" : it.floor, class: "nf lo" }, g);
    if (it.full) { it.el = mk("path", { class: "sil" }, g); it.t = tween(0); it.drawn = NaN; }
  }

  const eggs = cups.filter((c) => c.full);
  const B = register(stage, (_dt, now) => {
    let moving = false;
    for (const e of eggs) {
      const lift = tval(e.t, now);
      if (lift !== e.drawn) {
        e.drawn = lift;
        e.el.setAttribute("d", eggPath(P, e, TT - D + lift));
        e.seam.setAttribute("d", lift > D + 2 ? e.floor : "");
      }
      if (!tdone(e.t, now)) moving = true;
    }
    return moving;
  });
  bag.add(B.unregister);

  // hit: the pointer on a fixed plane through the eggs at rest, then the nearest cup
  function hit([sx, sy]) {
    const [wx, wy] = unproj(C, sx, sy, TT + 8);
    let best = -1, bd = PITCH * 0.62;
    for (const c of cups) { const d = Math.hypot(wx - c.x, wy - c.y); if (d < bd) { bd = d; best = c.k; } }
    return best;
  }

  let act = -1;
  function choose(k) {
    if (k === act) return;
    act = k;
    const now = performance.now(), lit = k < 0 ? REST : k;
    for (const c of cups) {
      if (c.full) { tset(c.t, c.k === k ? LIFT : 0, now, 0); c.el.classList.toggle("hi", c.k === lit); }
      c.rim.classList.toggle("hi", !c.full && c.k === k);
    }
    const n = String(k + 1).padStart(2, "0");
    read.textContent = k < 0 ? "rest" : cups[k].full ? `egg ${n}` : `cup ${n}`;
    B.wake();
  }

  for (const c of eggs) c.el.classList.toggle("hi", c.k === REST);
  read.textContent = "rest";
  bag.add(pointer(stage, { move: (p) => choose(hit(p)), leave: () => choose(-1) }));
  bag.add(() => svg.replaceChildren());

  return {
    set: (v) => { LIFT = v; if (act >= 0 && cups[act].full) { tset(cups[act].t, LIFT, performance.now(), 0); B.wake(); } },
    destroy: bag.dispose,
  };
}

hairline({
  name: "eggs",
  means: "An egg carton: the egg under the pointer lifts out of its cup, and the other eggs stay where they are.",
  rules: [1, 4, 5, 6],
  range: [20, 32, 44],
  tour: [[163, 154], [192, 197], [251, 204], null],
  mount,
});
