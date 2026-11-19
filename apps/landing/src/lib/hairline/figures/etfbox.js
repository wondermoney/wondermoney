/**
 * ETF box: one shallow box with a hinged lid, holding a dense grid of small
 * tiles, many holdings in one product. The pointer's x scrubs the lid open on
 * a spring; the tiles rise in a gentle wave around the pointer, each on its
 * own spring, and never higher than the lid above them allows. At rest the
 * lid stands ajar over a low dune of tiles and has the bright edge; when the
 * pointer is in, the risen tiles take it. The slider is the wave's radius, in
 * cells.
 *
 * The pattern: scrub and a field. Springs for the lid and the tiles, a falloff
 * by distance, a hit test on the rim's plane, which never moves, and tiles
 * painted before or after the lid by which side of it they are on.
 */
const {
  Cam, clamp, facing, fit, hull, open, poly, prism, proj, ringAt, rings, rrect, run, unproj,
  spring, stepS, disposer, mk, pointer, put, register, solid,
} = HL;

const NX = 9, NY = 6, X0 = 0, X1 = 118, Y0 = 0, Y1 = 80, WR = 6, WT = 2.6, TT = 14, DP = Y1 - Y0;
const CW = (X1 - X0 - 2 * WT) / NX, CH = (Y1 - Y0 - 2 * WT) / NY, FOOT = 9.4, HMAX = 34, LT = 3.2;
const A_MIN = 12, A_REST = 66, A_MAX = 100, DEG = Math.PI / 180;

/** The share of full rise at u radii from the pointer: a smooth swell from 1 down to a floor of .05 at the radius. */
const falloff = (u) => (u >= 1 ? 0.05 : 0.05 + 0.95 * (1 + Math.cos(Math.PI * u)) / 2);

/** A run of points ordered left to right on screen. */
const LR = (pts) => (pts[0][0] <= pts[pts.length - 1][0] ? pts : pts.slice().reverse());

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let R = value * CW, over = null;

  /** The lid's own frame, turned a degrees open about the hinge on the back rim. */
  const lidW = (a, u, v, w) => [u, Y0 + v * Math.cos(a * DEG) - w * Math.sin(a * DEG), TT + v * Math.sin(a * DEG) + w * Math.cos(a * DEG)];
  const C = Cam(45, 0.5, 1.8);
  const pts = [[X0, Y0, 0], [X1, Y1, 0], [X1, Y0, 0], [X0, Y1, 0], [X1, Y1, HMAX]];
  for (const a of [A_MIN, 45, 90, A_MAX]) for (const u of [X0, X1]) pts.push(lidW(a, u, DP, LT), lidW(a, u, DP, 0));
  fit(C, pts, 200, 166);
  const P = proj(C), front = facing(C);

  // the box: far half before the tiles, near half after them, as Riffle's tray
  const outer = rrect(X0, Y0, X1, Y1, WR, 6), inner = rrect(X0 + WT, Y0 + WT, X1 - WT, Y1 - WT, WR - WT, 6);
  const g = mk("g", {}, svg);
  mk("path", { d: poly(hull(ringAt(P, outer, 0).concat(ringAt(P, outer, TT)))), class: "sil" }, g);
  mk("path", { d: poly(ringAt(P, inner, TT)), class: "nf" }, g);
  mk("path", { d: open(ringAt(P, run(inner, (q) => !front(q)), 1.5)), class: "nf lo" }, g);
  const under = mk("g", {}, g), lidG = mk("g", {}, g), above = mk("g", {}, g), near = mk("g", {}, g);
  const iF = LR(ringAt(P, run(inner, front), TT)), oT = LR(ringAt(P, run(outer, front), TT)), oB = LR(ringAt(P, run(outer, front), 0));
  mk("path", { d: poly([...iF, oT[oT.length - 1], ...oB.slice().reverse(), oT[0]]), class: "fo" }, near);
  mk("path", { d: open(oT), class: "nf lo" }, near);
  mk("path", { d: open(iF), class: "nf" }, near);
  mk("path", { d: open([oT[0], ...oB, oT[oT.length - 1]]), class: "nf sil" }, near);

  // the lid: a plate with its own thickness, and a panel line on whichever face we see
  const lring = rrect(X0, 0, X1, DP, WR, 6), lpanel = rrect(X0 + 3, 3, X1 - 3, DP - 3, WR - 2, 6);
  const lid = { sil: mk("path", { class: "sil" }, lidG), panel: mk("path", { class: "nf lo" }, lidG), a: spring(A_REST), drawn: NaN };
  const LP = (ring, a, w) => ring.map((q) => P(...lidW(a, q.u, q.v, w)));

  // the tiles, diagonal by diagonal from the back corner; a low dune at rest
  const tiles = [];
  for (let s = 0; s <= NX + NY - 2; s++) for (let i = 0; i < NX; i++) {
    const j = s - i;
    if (j < 0 || j >= NY) continue;
    const x = X0 + WT + (i + 0.5) * CW, y = Y0 + WT + (j + 0.5) * CH, u = i / (NX - 1), v = j / (NY - 1);
    const h0 = 4.5 + 5.5 * Math.exp(-((u - 0.3) ** 2 + (v - 0.75) ** 2) / 0.09) + 3 * Math.exp(-((u - 0.8) ** 2 + (v - 0.35) ** 2) / 0.05);
    const [ring, inn] = rings(x - FOOT / 2, y - FOOT / 2, x + FOOT / 2, y + FOOT / 2, 2.2, 0.8);
    tiles.push({ i, j, x, y, h0, ring, inn, sp: spring(h0, { eps: 0.04 }), el: solid(under), drawn: NaN, side: "under", s });
  }

  /** How high a tile may stand under the lid at angle a: the lid's underside over the tile's back edge. */
  const cap = (t, a) => {
    const dy = t.y - FOOT / 2 - Y0;
    return a < 90 && dy < DP * Math.cos(a * DEG) ? TT + dy * Math.tan(a * DEG) - 1 : Infinity;
  };

  function drawLid() {
    const a = lid.a.x;
    if (a === lid.drawn) return false;
    lid.drawn = a;
    lid.sil.setAttribute("d", poly(hull(LP(lring, a, 0).concat(LP(lring, a, LT)))));
    // the outer face is seen while the lid is shallower than the line of sight, the inner one after
    const outerSeen = -0.612 * Math.sin(a * DEG) + 0.5 * Math.cos(a * DEG) > 0;
    lid.panel.setAttribute("d", poly(LP(lpanel, a, outerSeen ? LT : 0)));
    let moved = false;
    for (const t of tiles) {
      const side = outerSeen && t.y - Y0 < DP * Math.cos(a * DEG) ? "under" : "above";
      if (side !== t.side) { t.side = side; moved = true; }
    }
    if (moved) for (const t of tiles) (t.side === "under" ? under : above).appendChild(t.el.g);
    return true;
  }

  let lit = false;
  const risen = (t) => lit && t.drawn - t.h0 > (HMAX - t.h0) * 0.3;
  function drawTile(t) {
    const h = Math.max(0.6, Math.min(t.sp.x, cap(t, lid.a.x)));
    if (h === t.drawn) return;
    t.drawn = h;
    put(t.el, prism(P, front, t.ring, t.inn, 0, h));
    t.el.sil.classList.toggle("hi", risen(t));
  }

  const B = register(stage, (dt) => {
    let m = stepS(lid.a, dt);
    drawLid();
    for (const t of tiles) { if (stepS(t.sp, dt)) m = true; drawTile(t); }
    return m;
  });
  bag.add(B.unregister);

  const sxL = P(X0, Y1, 0)[0], sxR = P(X1, Y0, 0)[0];
  function retarget(p) {
    lit = !!p;
    if (!p) {
      over = null;
      lid.a.t = A_REST;
      for (const t of tiles) t.sp.t = t.h0;
      read.textContent = "rest";
    } else {
      const o = clamp((p[0] - sxL) / (sxR - sxL), 0, 1);
      over = unproj(C, p[0], p[1], TT);
      lid.a.t = A_MIN + o * (A_MAX - A_MIN);
      // the wave grows with the opening: a box barely open lets little out
      for (const t of tiles) {
        const rise = t.h0 + o * (HMAX - t.h0) * falloff(Math.hypot(t.x - over[0], t.y - over[1]) / R);
        t.sp.t = Math.min(rise, cap(t, lid.a.t));
      }
      read.textContent = `open ${Math.round(o * 100)}`;
    }
    lid.sil.classList.toggle("hi", !p);
    for (const t of tiles) t.el.sil.classList.toggle("hi", risen(t));
    B.wake();
  }

  let last = null;
  retarget(null);
  bag.add(pointer(stage, {
    move: (p) => { last = p; retarget(p); },
    leave: () => { last = null; retarget(null); },
  }));
  bag.add(() => svg.replaceChildren());

  return {
    set: (v) => { R = v * CW; if (last) retarget(last); },
    destroy: bag.dispose,
  };
}

hairline({
  name: "etfbox",
  means: "One box, many holdings: the pointer opens the lid, and the tiles inside rise in a wave around it.",
  rules: [1, 3, 6, 8],
  range: [2, 3.5, 5],
  tour: [[127, 215], [190, 222], [268, 241], null],
  mount,
});
