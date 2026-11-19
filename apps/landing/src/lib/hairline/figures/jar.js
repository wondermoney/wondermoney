/**
 * Jar: a glass savings jar on a shelf, and a stack of coins beside it. The
 * pointer's height picks how many months the fund holds, one to six; that
 * many coins arc from the stack into the jar, the rest wait on the shelf,
 * staggered outwards from the coin that moved first. The newest coin in the
 * jar takes the bright edge. The slider is the stagger, in ms.
 *
 * The pattern: one of many. Tweens with a lift, a stagger by distance, a hit
 * test on static bands along the jar at rest, and glass drawn with no fill so
 * the coins inside stay honest.
 */
const {
  Cam, clamp, facing, fit, hull, lerp, open, poly, prism, proj, ringAt, rings, run, circ,
  tset, tval, tdone, tween, disposer, mk, pointer, put, register, solid,
} = HL;

const N = 6, CR = 20, T = 7.5, JR = 31, JH = 72, LIP = 4, REST = 3, SHO = 56, NR = 23, CH = 7;
const IN = [0, 0], OUT = [64, 30], ARC = JH + CH + 12;
const SX0 = -44, SY0 = -40, SX1 = 96, SY1 = 70, SH = 7;

/** A ring of the given radius centred on (cx, cy). */
const at = (ring, cx, cy) => ring.map((q) => ({ ...q, u: q.u + cx, v: q.v + cy }));

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let stag = value;

  // Fitted to the shelf and to a coin at the top of its arc, so no pose leaves the frame.
  const C = Cam(45, 0.5, 1.74);
  fit(C, [[SX0, SY0, -SH], [SX1, SY1, -SH], [SX1, SY0, -SH], [SX0, SY1, -SH], [0, 0, ARC + T], [-JR, -JR, JH]], 200, 166);
  const P = proj(C), front = facing(C);

  const g = mk("g", {}, svg);
  // the shelf: a thin plank
  const [sr, si] = rings(SX0, SY0, SX1, SY1, 8, 2);
  put(solid(g), prism(P, front, sr, si, -SH, 0));

  // the jar's floor, seen through the glass
  const jo = circ(JR, 48), ji = circ(JR - LIP, 48);
  mk("path", { d: poly(ringAt(P, jo, 0)), class: "nf lo" }, g);
  mk("path", { d: poly(ringAt(P, ji, 2.5)), class: "nf lo" }, g);

  const inside = mk("g", {}, g);
  // the glass, all unfilled: a body that rounds in at the shoulder to a neck, and a threaded collar on the neck
  const neck = circ(NR, 48), neckIn = circ(NR - 2, 48);
  mk("path", { d: poly(hull(ringAt(P, jo, 0).concat(ringAt(P, jo, SHO), ringAt(P, circ(JR - 4, 48), SHO + 7), ringAt(P, neck, JH)))), class: "nf sil" }, g);
  mk("path", { d: open(ringAt(P, run(jo, front), SHO)), class: "nf lo" }, g);
  mk("path", { d: open(ringAt(P, run(neck, front), JH)), class: "nf lo" }, g);
  const collar = prism(P, front, neck, neckIn, JH, JH + CH);
  mk("path", { d: collar.sil, class: "nf sil" }, g);
  mk("path", { d: poly(ringAt(P, neckIn, JH + CH)), class: "nf" }, g);
  for (const z of [JH + 2.2, JH + 4.4]) mk("path", { d: open(ringAt(P, run(neck, front), z)), class: "nf lo" }, g);
  const outside = mk("g", {}, g);

  const coin = circ(CR, 32), crease = circ(CR - 1.6, 32);
  /** Coin i: its slot in the jar (bottom up) and on the stack (the next to move on top). */
  const coins = [];
  for (let i = 0; i < N; i++) {
    const s = solid(outside);
    // the milled edge: a short dim band just under the face
    const mill = mk("path", { class: "nf lo" }, s.g);
    const zin = 3 + i * T, zout = (N - 1 - i) * T;
    // a slight lean in the stack, so the rest is not a column
    const jx = Math.sin(i * 2.3) * 1.8, jy = Math.cos(i * 1.7) * 1.6;
    coins.push({ s, mill, zin, zout, jx, jy, t: tween(i < REST ? 1 : 0), where: "out", key: "" });
  }

  function draw(i, now) {
    const cn = coins[i], t = tval(cn.t, now);
    const x = lerp(OUT[0] + cn.jx, IN[0] + cn.jx * 0.6, t), y = lerp(OUT[1] + cn.jy, IN[1] + cn.jy * 0.6, t);
    const z = lerp(cn.zout, cn.zin, t) + Math.sin(Math.PI * t) * (ARC - Math.max(cn.zout, cn.zin));
    const key = `${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)}`;
    if (key !== cn.key) {
      cn.key = key;
      put(cn.s, prism(P, front, at(coin, x, y), at(crease, x, y), z, z + T - 1.2));
      cn.mill.setAttribute("d", open(ringAt(P, run(at(coin, x, y), front), z + (T - 1.2) * 0.45)));
    }
    // inside the glass once it is below the rim and over the mouth; in front of it otherwise
    const where = t > 0.5 && z < JH + CH ? "in" : "out";
    if (where !== cn.where) {
      cn.where = where;
      (where === "in" ? inside : outside).appendChild(cn.s.g);
      reorder();
    }
  }

  /** Paint order: jar coins bottom up, stack coins bottom up. */
  function reorder() {
    const ins = coins.filter((c) => c.where === "in").sort((a, b) => a.zin - b.zin);
    const outs = coins.filter((c) => c.where === "out").sort((a, b) => a.zout - b.zout);
    ins.forEach((c) => inside.appendChild(c.s.g));
    outs.forEach((c) => outside.appendChild(c.s.g));
  }

  const B = register(stage, (_dt, now) => {
    let moving = false;
    coins.forEach((cn, i) => { draw(i, now); if (!tdone(cn.t, now)) moving = true; });
    return moving;
  });
  bag.add(B.unregister);

  // hit bands: the jar's rest height, cut into six bands by screen y, across the jar and the stack
  const yAt = (z) => P(IN[0], IN[1], z)[1];
  const xl = P(-JR, JR, 0)[0] - 10, xr = P(OUT[0] + CR, OUT[1] - CR, 0)[0] + 10;
  const ytop = yAt(JH + 6), ybot = yAt(0) + 18;
  function hit([x, y]) {
    if (x < xl || x > xr || y < ytop - 30 || y > ybot) return -1;
    const k = Math.floor(((ybot - y) / (ybot - ytop)) * N) + 1;
    return clamp(k, 1, N);
  }

  let m = -1;
  function setMonths(k) {
    if (k === m) return;
    const now = performance.now(), prev = m < 0 ? REST : m, n = k < 0 ? REST : k;
    m = k;
    const pivot = n > prev ? prev : n - 1;
    coins.forEach((cn, i) => {
      tset(cn.t, i < n ? 1 : 0, now, Math.abs(i - pivot) * stag);
      cn.s.sil.classList.toggle("hi", i === n - 1);
    });
    read.textContent = k < 0 ? "rest" : `${k} mo`;
    B.wake();
  }

  coins.forEach((cn, i) => cn.s.sil.classList.toggle("hi", i === REST - 1));
  read.textContent = "rest";
  bag.add(pointer(stage, { move: (p) => setMonths(hit(p)), leave: () => setMonths(-1) }));
  bag.add(() => svg.replaceChildren());

  return {
    set: (v) => { stag = v; },
    destroy: bag.dispose,
  };
}

hairline({
  name: "jar",
  means: "A savings jar on a shelf: raise the pointer and more months of coins move from the stack into the jar.",
  rules: [1, 2, 5, 6],
  range: [0, 45, 90],
  tour: [[200, 228], [200, 150], [200, 92], null],
  mount,
});
