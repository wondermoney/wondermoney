/**
 * Doorchain: a panelled door in a wall, with a security chain from a plate on
 * the door to an anchor on the wall. The pointer, taken on the plane at the
 * knob's height, is the hand on the door: the door swings toward it on a
 * spring, the chain takes up its slack, and at its length it stops the door at
 * a narrow gap: you can look in, not walk in. At rest the door stands ajar,
 * the chain hanging, the knob bright; pulled, the chain takes the bright edge.
 * The slider is the chain's gap, in cm.
 *
 * The pattern: scrub, clamped. One spring, a hit test on a fixed plane, a
 * reach that ends where the chain does, and slabs drawn back, face, edges.
 */
const {
  Cam, circ, clamp, facing, fillet, fit, hull, lerp, open, poly, prism, proj, rad, ringAt, rings, seg, unproj,
  spring, stepS, disposer, mk, pointer, put, register, solid,
} = HL;

const DW = 40, DH = 80, WT = 7, WH = 90, WX0 = -18, WX1 = DW + 26;
const HX = -1, DWD = DW + 2, DT = 3.4, KH = 38, CZ = 49, KU = DWD - 5, CU = DWD - 7, AX = DW + 8;
const CM = 80, REST = 4, NL = 7;
const rng = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const at = (ring, cx, cy) => ring.map((q) => ({ ...q, u: q.u + cx, v: q.v + cy }));

/**
 * A slab seen from the front, its top and its right end showing: the back outline is the silhouette
 * at the top and right, the face's left and bottom edges are, two corner edges join them, and the
 * face's own outline is the dim crease. `pts` is a filleted outline (5 points a corner), `F` and `B`
 * project it on the face and the back; `runs` are the face's silhouette runs, `ends` the corners joined.
 */
function slab(pts, F, B, runs, ends, fold) {
  const n = pts.length;
  return {
    back: poly(pts.map(B)),
    face: poly(pts.map(F)),
    edge: runs.map((r) => open(r.map((i) => F(pts[i % n])))).join("") + ends.map((i) => seg(F(pts[i]), B(pts[i]))).join(""),
    fold: seg(F(pts[fold]), B(pts[fold])),
  };
}

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let phiMax = 2 * Math.asin(value / (2 * CM)) * 180 / Math.PI, over = null;

  // Fitted to the floor and the wall's top; the door, held by its chain, never swings past the floor.
  const C = Cam(45, 0.5, 1.84);
  fit(C, [[-28, -22, -4], [76, 36, -4], [76, -22, -4], [-28, 36, -4], [WX0, 0, WH], [WX1, -WT, WH], [WX0, -WT, WH]], 200, 166);
  const P = proj(C), front = facing(C);
  const g = mk("g", {}, svg);

  // the floor, a thin plate
  const [fr, fi] = rings(-28, -22, 76, 36, 8, 2);
  put(solid(g), prism(P, front, fr, fi, -4, 0));

  // the wall: a slab with the doorway cut from its foot, and the casing round the doorway
  const wall = fillet([[WX0, 0], [0, 0], [0, DH], [DW, DH], [DW, 0], [WX1, 0], [WX1, WH], [WX0, WH]], [0.6, 0.6, 1.4, 1.4, 0.6, 0.6, 3, 3]);
  const w = slab(wall, ([x, z]) => P(x, 0, z), ([x, z]) => P(x, -WT, z), [rng(35, 49), rng(10, 29)], [37, 27], 32);
  mk("path", { d: w.back, class: "sil" }, g);
  mk("path", { d: w.face, class: "lo" }, g);
  mk("path", { d: w.edge, class: "nf sil" }, g);
  mk("path", { d: w.fold, class: "nf lo" }, g);
  mk("path", { d: open(fillet([[-4.5, 0], [-4.5, DH + 4.5], [DW + 4.5, DH + 4.5], [DW + 4.5, 0]], [0, 2, 2, 0]).slice(1, -1).map(([x, z]) => P(x, 0, z))), class: "nf lo" }, g);
  // the chain's anchor, screwed to the wall beside the door
  const anchor = fillet([[AX - 2.6, CZ - 3.2], [AX + 2.6, CZ - 3.2], [AX + 2.6, CZ + 3.2], [AX - 2.6, CZ + 3.2]], [1.2, 1.2, 1.2, 1.2]);
  mk("path", { d: poly(anchor.map(([x, z]) => P(x, 0.8, z))) }, g);
  // the hinge knuckles, half behind the door's edge
  for (const z of [10, 62]) put(solid(g), prism(P, front, at(circ(1.7, 16), HX - 0.4, 1.6), at(circ(1.1, 16), HX - 0.4, 1.6), z, z + 9));

  // the door: a slab proud of the wall, two sunk panels, a knob, the chain's track
  const door = fillet([[0, 0], [DWD, 0], [DWD, DH + 1], [0, DH + 1]], [0.5, 0.5, 1.4, 1.4]);
  const panels = [[5, 6, DWD - 5, 30], [5, 56, DWD - 5, DH - 5]].map(([u0, z0, u1, z1]) => fillet([[u0, z0], [u1, z0], [u1, z1], [u0, z1]], [1.6, 1.6, 1.6, 1.6]));
  const track = fillet([[CU - 8, CZ - 1.8], [CU + 2, CZ - 1.8], [CU + 2, CZ + 1.8], [CU - 8, CZ + 1.8]], [0.9, 0.9, 0.9, 0.9]);
  const dBack = mk("path", { class: "sil" }, g), dFace = mk("path", { class: "lo" }, g), dEdge = mk("path", { class: "nf sil" }, g), dFold = mk("path", { class: "nf lo" }, g);
  const dPanels = mk("path", { class: "nf lo" }, g), dTrack = mk("path", {}, g), dSlot = mk("path", { class: "nf lo" }, g);
  const knob = solid(g);
  const chain = mk("path", { class: "nf" }, g);

  const sp = spring(REST, { eps: 0.01 });
  let drawn = NaN;

  function draw() {
    const phi = clamp(sp.x, 0, phiMax);
    if (phi === drawn) return;
    drawn = phi;
    const c = Math.cos(rad(phi)), s = Math.sin(rad(phi));
    const D = (u, n, z) => P(HX + u * c - n * s, u * s + n * c, z);
    const Dw = (u, n, z) => [HX + u * c - n * s, u * s + n * c, z];
    const d = slab(door, ([u, z]) => D(u, DT, z), ([u, z]) => D(u, 0, z), [rng(15, 29)], [17, 7], 12);
    dBack.setAttribute("d", d.back); dFace.setAttribute("d", d.face); dEdge.setAttribute("d", d.edge); dFold.setAttribute("d", d.fold);
    dPanels.setAttribute("d", panels.map((p) => poly(p.map(([u, z]) => D(u, DT, z)))).join(""));
    dTrack.setAttribute("d", poly(track.map(([u, z]) => D(u, DT + 0.8, z))));
    dSlot.setAttribute("d", seg(D(CU - 6.5, DT + 0.8, CZ), D(CU + 0.5, DT + 0.8, CZ)));
    // the knob: a narrow neck off the face and a wider round grip on it
    const ring = (r, n) => Array.from({ length: 20 }, (_, k) => D(KU + r * Math.cos((k / 20) * 2 * Math.PI), DT + n, KH + r * Math.sin((k / 20) * 2 * Math.PI)));
    put(knob, { sil: poly(hull(ring(2, 0).concat(ring(2, 2.6), ring(3.4, 4.2), ring(3.1, 5.6)))), crease: poly(ring(2.3, 5.6)) });
    // the chain: from the track's end to the anchor, sagging by its slack, links turned alternately
    const a = Dw(CU + 0.5, DT + 1.2, CZ), b = [AX, 1.2, CZ], len = chainLen();
    const dist = Math.hypot(b[0] - a[0], b[1] - a[1]), sag = Math.sqrt((3 * dist * Math.max(0, len - dist)) / 8);
    const pts = rng(0, NL).map((i) => { const t = i / NL; return P(lerp(a[0], b[0], t), lerp(a[1], b[1], t), CZ - 4 * sag * t * (1 - t)); });
    let links = "";
    for (let i = 0; i < NL; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, ux = (x1 - x0) / 2, uy = (y1 - y0) / 2;
      if (i % 2) { links += seg([cx - ux * 1.25, cy - uy * 1.25], [cx + ux * 1.25, cy + uy * 1.25]); continue; }
      links += poly(Array.from({ length: 12 }, (_, k) => { const t = (k / 12) * 2 * Math.PI; return [cx + ux * 1.3 * Math.cos(t) - uy * 0.62 * Math.sin(t), cy + uy * 1.3 * Math.cos(t) + ux * 0.62 * Math.sin(t)]; }));
    }
    chain.setAttribute("d", links);
  }
  /** The chain is as long as the gap it allows: taut at phiMax. */
  function chainLen() {
    const c = Math.cos(rad(phiMax)), s = Math.sin(rad(phiMax));
    return Math.hypot(AX - (HX + (CU + 0.5) * c - (DT + 1.2) * s), 1.2 - ((CU + 0.5) * s + (DT + 1.2) * c));
  }

  const B = register(stage, (dt) => { const m = stepS(sp, dt); draw(); return m; });
  bag.add(B.unregister);

  /** The hand on the door: where the pointer meets the plane at the knob's height, read as an angle round the hinge, held by the chain. */
  function retarget() {
    const want = over ? clamp((Math.atan2(over[1], over[0] - HX) * 180) / Math.PI, 0, 90) : REST;
    sp.t = over ? Math.min(want, phiMax) : REST;
    knob.sil.classList.toggle("hi", !over);
    chain.classList.toggle("hi", !!over);
    read.textContent = over ? `gap ${Math.round(2 * CM * Math.sin(rad(sp.t) / 2))}` : "rest";
    drawn = NaN;
    B.wake();
  }

  retarget();
  bag.add(pointer(stage, {
    move: (p) => { over = unproj(C, p[0], p[1], KH); retarget(); },
    leave: () => { over = null; retarget(); },
  }));
  bag.add(() => svg.replaceChildren());

  return {
    set: (v) => { phiMax = 2 * Math.asin(v / (2 * CM)) * 180 / Math.PI; retarget(); },
    destroy: bag.dispose,
  };
}

hairline({
  name: "doorchain",
  means: "A door on a security chain: pull it and it opens only to a narrow gap, enough to look in, not to walk in.",
  rules: [1, 3, 6, 9],
  range: [8, 12, 16],
  tour: [[208, 127], [213, 167], [150, 215], null],
  mount,
});
