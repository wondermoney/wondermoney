/**
 * Compass: a pocket compass lying on a folded map. The map has its fold
 * creases, a dog-eared corner and a dashed route that runs from the compass to
 * a ringed spot. At rest the needle points along the route. The pointer, read
 * on the map's plane, pulls the needle round toward it on a spring, and it
 * settles on the nearest compass point, which goes to the read-out. The slider
 * is how many points the card is divided into.
 *
 * The pattern: a turned part with detents, as the timer's dial. One spring for
 * the needle's bearing, and a hit test on the map's plane, which never moves.
 */
const {
  Cam, circ, facing, fillet, fit, flatDot, lerp, open, place, poly, prism, proj, ringAt, seg, spring, stepS, unproj,
  disposer, mk, pointer, put, register, solid,
} = HL;

const MX = 152, MY = 92, MT = 1.6, DOG = 22;
const CX = 46, CY = 48, CR = 36, CH = 10, NL = 28, NW = 7;
const DEST = [134, 24];
const NAMES = "N NNE NE ENE E ESE SE SSE S SSW SW WSW W WNW NW NNW".split(" ");
/** North runs up the screen to the left, along -x; east up to the right, along -y. */
const N0 = [-1, 0], E0 = [0, -1];
const deg = (r) => (r * 180) / Math.PI;
/** The world point r from the compass's centre on bearing b, turned s units to its right. */
const along = (b, r, s = 0) => {
  const c = Math.cos((b * Math.PI) / 180), n = Math.sin((b * Math.PI) / 180);
  return [CX + r * (N0[0] * c + E0[0] * n) + s * (E0[0] * c - N0[0] * n), CY + r * (N0[1] * c + E0[1] * n) + s * (E0[1] * c - N0[1] * n)];
};
const at = (ring, cx, cy) => ring.map((q) => ({ ...q, u: q.u + cx, v: q.v + cy }));

/** A flat outline as a ring of samples with outward normals, and the same ring inset by b. */
function sheet(pts, b) {
  const ring = pts.map((p, i) => {
    const a = pts[(i + pts.length - 1) % pts.length], c = pts[(i + 1) % pts.length];
    const nu = c[1] - a[1], nv = a[0] - c[0], l = Math.hypot(nu, nv);
    return { u: p[0], v: p[1], nu: nu / l, nv: nv / l };
  });
  return [ring, ring.map((q) => ({ ...q, u: q.u - q.nu * b, v: q.v - q.nv * b }))];
}

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let points = value;

  const C = Cam(45, 0.5, 1.76);
  fit(C, [[0, 0, 0], [MX, MY, 0], [MX, 0, 0], [0, MY, 0], [CX, CY, MT + CH]], 200, 166);
  const P = proj(C), front = facing(C);
  const g = mk("g", {}, svg);

  // the map: a thin sheet with one corner folded back over it, two folds across it
  const outline = fillet([[0, 0], [MX, 0], [MX, MY - DOG], [MX - DOG, MY], [0, MY]], [3, 3, 1, 1, 3]);
  const [mr, mi] = sheet(outline, 1);
  put(solid(g), prism(P, front, mr, mi, 0, MT));
  let folds = seg(P(MX / 3, 1, MT), P(MX / 3, MY - 1, MT)) + seg(P((2 * MX) / 3, 1, MT), P((2 * MX) / 3, MY - 1, MT));
  folds += seg(P(1, MY / 2, MT), P(MX - 1, MY / 2, MT));
  mk("path", { d: folds, class: "nf lo" }, g);
  const flap = fillet([[MX, MY - DOG], [MX - DOG, MY], [MX - DOG, MY - DOG]], [1, 1, 2]);
  mk("path", { d: poly(flap.map((p) => P(p[0], p[1], MT + 0.5))) }, g);

  // the route: dashed from the compass's edge, round a bend, to a ringed spot
  const b0 = deg(Math.atan2((DEST[0] - CX) * E0[0] + (DEST[1] - CY) * E0[1], (DEST[0] - CX) * N0[0] + (DEST[1] - CY) * N0[1]));
  const s0 = along(b0 + 28, CR + 6), mid = along(b0 - 4, 58, -30), route = [];
  for (let k = 0; k <= 40; k++) {
    const t = k / 40, a = lerp(lerp(s0[0], mid[0], t), lerp(mid[0], DEST[0], t), t), b = lerp(lerp(s0[1], mid[1], t), lerp(mid[1], DEST[1], t), t);
    route.push(P(a, b, MT));
  }
  mk("path", { d: open(route.slice(0, -3)), class: "nf dash" }, g);
  mk("path", { d: poly(ringAt(P, at(circ(5, 20), DEST[0], DEST[1]), MT)), class: "nf" }, g);
  const spot = flatDot(g, C, 1.3, "dot");
  place(spot, P(DEST[0], DEST[1], MT));

  // the bail and its crown, at north, then the case: a drum with a bezel, ticks and the needle under its glass
  const bail = along(0, CR + 12), crown = along(0, CR + 1.5), ZT = MT + CH;
  put(solid(g), prism(P, front, at(circ(8, 24), ...bail), at(circ(6.6, 24), ...bail), MT, MT + 2.6));
  mk("path", { d: poly(ringAt(P, at(circ(5, 20), ...bail), MT + 2.6)), class: "nf" }, g);
  put(solid(g), prism(P, front, at(circ(4, 16), ...crown), at(circ(3, 16), ...crown), MT + 1.5, ZT - 2));
  put(solid(g), prism(P, front, at(circ(CR, 56), CX, CY), at(circ(CR - 2, 56), CX, CY), MT, ZT));
  mk("path", { d: poly(ringAt(P, at(circ(CR - 4.5, 56), CX, CY), ZT)), class: "nf" }, g);
  let ticks = "", cards = "";
  for (let k = 0; k < 32; k++) {
    if (k % 8) ticks += seg(P(...along(k * 11.25, CR - 7), ZT), P(...along(k * 11.25, CR - (k % 2 ? 9 : 10.5)), ZT));
    else cards += seg(P(...along(k * 11.25, CR - 7), ZT), P(...along(k * 11.25, CR - 14), ZT));
  }
  mk("path", { d: ticks, class: "nf lo" }, g);
  mk("path", { d: cards, class: "nf" }, g);
  const north = flatDot(g, C, 0.9, "dot m");
  place(north, P(...along(0, CR - 16), ZT));
  const tail = mk("path", { class: "lo" }, g), head = mk("path", {}, g);
  mk("path", { d: poly(ringAt(P, at(circ(2.6, 14), CX, CY), ZT)) }, g);
  const pin = flatDot(g, C, 0.8, "dot m");
  place(pin, P(CX, CY, ZT));

  let drawn = NaN;
  /** The needle on bearing b: a lozenge, its north half the head. */
  function draw(b) {
    if (b === drawn) return;
    drawn = b;
    const w = (r, s) => P(...along(b, r, s), ZT);
    head.setAttribute("d", poly([w(NL, 0), w(0, NW), w(0, -NW)]));
    tail.setAttribute("d", poly([w(-NL * 0.86, 0), w(0, NW), w(0, -NW)]));
  }

  const needle = spring(b0);
  const B = register(stage, (dt) => {
    const m = stepS(needle, dt);
    draw(Math.round(needle.x * 100) / 100);
    return m;
  });
  bag.add(B.unregister);

  // hit: the pointer on the map's plane, which never moves; its bearing from the pivot, snapped to the nearest point
  let pt = -2;
  function aim(p) {
    let k = -1, want = b0;
    if (p) {
      const [x, y] = unproj(C, p[0], p[1], MT), dx = x - CX, dy = y - CY;
      if (Math.hypot(dx, dy) < 6) return;
      const step = 360 / points, raw = deg(Math.atan2(dx * E0[0] + dy * E0[1], dx * N0[0] + dy * N0[1]));
      want = Math.round(raw / step) * step;
      k = ((Math.round(want / 22.5) % 16) + 16) % 16;
    }
    while (want - needle.t > 180) want -= 360;
    while (want - needle.t < -180) want += 360;
    needle.t = want;
    if (k !== pt) {
      pt = k;
      read.textContent = k < 0 ? "rest" : NAMES[k];
      head.classList.toggle("hi", k >= 0);
      spot.setAttribute("class", k < 0 ? "dot" : "dot m");
    }
    B.wake();
  }

  aim(null);
  bag.add(pointer(stage, { move: (p) => aim(p), leave: () => aim(null) }));
  bag.add(() => svg.replaceChildren());

  return {
    set: (v) => { points = v; },
    destroy: bag.dispose,
  };
}

hairline({
  name: "compass",
  means: "A pocket compass on a folded map: its needle swings round toward the pointer and settles on the nearest point.",
  rules: [1, 5, 8, 10],
  range: [4, 8, 16],
  tour: [[330, 150], [120, 70], [150, 250], null],
  mount,
});
