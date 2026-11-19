/**
 * Containers: a shelf holding five places to keep money, from the most open
 * to the most locked: a bowl, a jar with a screw lid, a tin with a lid, a box
 * with a clasp and a small safe. The one under the pointer lifts and opens a
 * little (a lid rises, the box's lid hinges up off its clasp, the safe's door
 * swings out); its neighbours lift a touch, staggered outwards. The slider is
 * the stagger, in ms.
 *
 * The pattern: one of many. Tweens with a stagger by distance, a hit test on
 * the containers' rest centres, and each part drawn through one transform so
 * a lid or a door can turn on its hinge.
 */
const {
  Cam, circ, clamp, facing, fit, hull, open, poly, proj, rad, rings, rrect, run, seg,
  tdone, tset, tval, tween, disposer, mk, pointer, put, register, solid,
} = HL;

const SP = 47, N = 5, LIFT = 15, NEAR = 4, REST = 2, SX0 = -28, SX1 = (N - 1) * SP + 28, SY = 25;
const id = (u, v, z) => [u, v, z];
/** The containers' heights at rest, for the hit test and the fit. */
const H = [15, 38, 20, 26, 42];

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let stag = value;

  const C = Cam(45, 0.5, 1.64);
  fit(C, [[SX0, -SY, -6], [SX1, SY, -6], [SX1, -SY, -6], [SX0, SY, -6], [0, 0, H[0] + LIFT], [SX1 - 28, 0, 42 + LIFT]], 200, 166);
  const P = proj(C), front = facing(C);
  const R = (ring, z, xf) => ring.map((q) => P(...xf(q.u, q.v, z)));
  /** A solid from its foot ring to its top ring, both through xf; the crease is the top's inset ring, front side. */
  const body = (s, foot, top, inner, z0, z1, xf) =>
    put(s, { sil: poly(hull(R(foot, z0, xf).concat(R(top, z1, xf)))), crease: open(R(run(inner, front), z1, xf)) });
  const ring = (r) => circ(r, 40);

  const g = mk("g", {}, svg);
  const [pr, pi] = rings(SX0, -SY, SX1, SY, 6, 2);
  put(solid(g), { sil: poly(hull(R(pr, -6, id).concat(R(pr, 0, id)))), crease: open(R(run(pi, front), 0, id)) });

  // each maker builds its parts once and returns [draw(xf, open), ...the silhouettes that take the bright edge]
  const makers = [
    (p) => { // a bowl: wide at the rim, a small foot, its inside seen
      const s = solid(p), rim = mk("path", { class: "nf" }, p);
      return [(xf) => { body(s, ring(10), ring(19), ring(17.6), 0, 15, xf); rim.setAttribute("d", poly(R(ring(17.6), 15, xf))); }, s.sil];
    },
    (p) => { // a jar: a body that rounds in to a neck, and a screw lid
      const s = solid(p), sh = mk("path", { class: "nf lo" }, p), mouth = mk("path", { class: "nf" }, p), lid = solid(p), thr = mk("path", { class: "nf lo" }, lid.g);
      return [(xf, o) => {
        put(s, { sil: poly(hull(R(ring(15), 0, xf).concat(R(ring(15), 25, xf), R(ring(10), 32, xf)))), crease: "" });
        sh.setAttribute("d", open(R(run(ring(15), front), 25, xf)));
        mouth.setAttribute("d", poly(R(ring(8.6), 32, xf)));
        const lz = 31 + o * 9;
        body(lid, ring(11.5), ring(11.5), ring(10.2), lz, lz + 7, xf);
        thr.setAttribute("d", open(R(run(ring(11.5), front), lz + 2.4, xf)) + open(R(run(ring(11.5), front), lz + 4.6, xf)));
      }, s.sil, lid.sil];
    },
    (p) => { // a tin: a squat drum, and a lid that fits over its top
      const s = solid(p), mouth = mk("path", { class: "nf" }, p), lid = solid(p), panel = mk("path", { class: "nf lo" }, lid.g);
      return [(xf, o) => {
        body(s, ring(17), ring(17), ring(15.6), 0, 16, xf);
        mouth.setAttribute("d", poly(R(ring(15.4), 16, xf)));
        const lz = 13 + o * 9;
        body(lid, ring(18.2), ring(18.2), ring(16.8), lz, lz + 7, xf);
        panel.setAttribute("d", poly(R(ring(12), lz + 7, xf)));
      }, s.sil, lid.sil];
    },
    (p) => { // a box: a lid hinged at the back, and a clasp across the seam on the front
      const [br, bi] = rings(-18, -14, 18, 14, 3, 1.4), s = solid(p), mouth = mk("path", { class: "nf" }, p), staple = mk("path", { class: "nf" }, p);
      const lid = solid(p), hasp = mk("path", {}, p);
      return [(xf, o) => {
        body(s, br, br, bi, 0, 18, xf);
        mouth.setAttribute("d", poly(R(rrect(-16.6, -12.6, 16.6, 12.6, 1.6, 4), 18, xf)));
        staple.setAttribute("d", poly(rrect(-2.4, 11, 2.4, 15.2, 2, 4).map((q) => P(...xf(q.u, 14.2, q.v)))));
        const a = rad(o * 26), c = Math.cos(a), sn = Math.sin(a);
        const lx = (u, v, z) => xf(u, -14 + (v + 14) * c - (z - 18) * sn, 18 + (v + 14) * sn + (z - 18) * c);
        body(lid, br, br, bi, 18, 25, lx);
        hasp.setAttribute("d", poly(rrect(-3.2, 13.6, 3.2, 24, 1.6, 4).map((q) => P(...lx(q.u, 14.4, q.v)))));
      }, s.sil, lid.sil];
    },
    (p) => { // a safe: a heavy box, a door hinged on its near edge, a dial and a spoked handle on it
      const [sr, si] = rings(-20, -20, 20, 20, 3.4, 1.6), s = solid(p), hole = mk("path", { class: "nf lo" }, p);
      const edge = mk("path", { class: "lo" }, p), door = mk("path", {}, p), dial = mk("path", { class: "nf" }, p), knob = mk("path", { class: "nf" }, p);
      const DU0 = -14, DU1 = 14, DZ0 = 7, DZ1 = 36;
      return [(xf, o) => {
        body(s, sr, sr, si, 0, 42, xf);
        const face = (u, z) => P(...xf(u, 20, z));
        hole.setAttribute("d", poly(rrect(DU0, DZ0, DU1, DZ1, 2.4, 4).map((q) => face(q.u, q.v))));
        // hinged on its near edge, so it swings out toward the viewer
        const b = rad(o * 40), cb = Math.cos(b), sb = Math.sin(b);
        const dx = (u, z, t = 0) => P(...xf(DU1 - (DU1 - u) * cb + t * sb, 20.4 + (DU1 - u) * sb + t * cb, z));
        // the door's thickness, only once it stands out of its hole
        edge.setAttribute("d", o > 0.02 ? poly(rrect(DU0, DZ0, DU1, DZ1, 2.4, 4).map((q) => dx(q.u, q.v, -2.6))) : "");
        door.setAttribute("d", poly(rrect(DU0, DZ0, DU1, DZ1, 2.4, 4).map((q) => dx(q.u, q.v))));
        dial.setAttribute("d", poly(circ(3.4, 20).map((q) => dx(-4 + q.u, 28 + q.v))) + poly(circ(1, 10).map((q) => dx(-4 + q.u, 28 + q.v))));
        let w = poly(circ(1.4, 10).map((q) => dx(-4 + q.u, 16 + q.v)));
        for (const t of [90, 210, 330]) w += seg(dx(-4 + 1.4 * Math.cos(rad(t)), 16 + 1.4 * Math.sin(rad(t))), dx(-4 + 6 * Math.cos(rad(t)), 16 + 6 * Math.sin(rad(t))));
        knob.setAttribute("d", w);
      }, s.sil];
    },
  ];

  const items = makers.map((make, i) => {
    const grp = mk("g", {}, g);
    const [draw, ...his] = make(grp);
    return { grp, draw, his, lift: tween(0), open: tween(i === REST ? 0.35 : 0), key: "" };
  });
  const mark = (i, on) => items[i].his.forEach((el) => el.classList.toggle("hi", on));

  const B = register(stage, (_dt, now) => {
    let moving = false;
    items.forEach((it, i) => {
      const l = tval(it.lift, now), o = clamp(tval(it.open, now), 0, 1), key = `${l.toFixed(2)},${o.toFixed(3)}`;
      if (key !== it.key) { it.key = key; it.draw((u, v, z) => [u + i * SP, v, z + l], o); }
      if (!tdone(it.lift, now) || !tdone(it.open, now)) moving = true;
    });
    return moving;
  });
  bag.add(B.unregister);

  // hit: the container whose rest centre is nearest the pointer's x, inside a band over the shelf
  const cx = H.map((h, i) => P(i * SP, 0, h / 2)[0]);
  const top = P(0, 0, 42 + LIFT)[1] - 10, bot = P(SX1, SY, -6)[1] + 8;
  function hit([x, y]) {
    if (y < top || y > bot || x < cx[0] - 40 || x > cx[N - 1] + 40) return -1;
    let best = 0;
    cx.forEach((v, i) => { if (Math.abs(v - x) < Math.abs(cx[best] - x)) best = i; });
    return best;
  }

  let act = -2;
  function choose(a) {
    if (a === act) return;
    const now = performance.now(), from = a >= 0 ? a : act;
    act = a;
    items.forEach((it, i) => {
      const d = Math.abs(i - from), delay = from >= 0 ? d * stag : 0;
      tset(it.lift, a < 0 ? 0 : i === a ? LIFT : d === 1 ? NEAR : 0, now, delay);
      tset(it.open, a < 0 ? (i === REST ? 0.35 : 0) : i === a ? 1 : 0, now, delay);
      mark(i, a < 0 ? i === REST : i === a);
    });
    read.textContent = a < 0 ? "rest" : `no. ${a + 1}`;
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
  name: "containers",
  means: "Five places to keep savings, from an open bowl to a safe: the one under the pointer lifts and opens a little.",
  rules: [1, 2, 5, 6],
  range: [0, 45, 90],
  tour: [[91, 102], [200, 153], [309, 192], null],
  mount,
});
