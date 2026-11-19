/**
 * Scale: a balance on a round stepped base. Its beam carries two pans hung
 * on three strings each: blocks of assets stacked on the left pan, two
 * blocks of debts on the right. At rest the beam tips toward the assets. The
 * pointer presses on the side it is over, the farther out the harder, and
 * the beam tips on a spring; the lower pan takes the bright edge. The
 * read-out gives the balance in blocks. The slider is the beam's full tip,
 * in degrees.
 *
 * The pattern: a continuous press. One spring for the beam, a hit test on a
 * fixed screen band, and every hanging part placed from the beam's angle.
 */
const {
  Cam, clamp, circ, facing, fit, hull, open, poly, prism, proj, rad, ringAt, rings, run, seg,
  spring, stepS, disposer, mk, pointer, put, register, solid,
} = HL;

const HP = 120, L = 66, HANG = 62, PR = 25, PF = 17, PT = 4, BK = 11, BASE = 30;
const U = [Math.SQRT1_2, -Math.SQRT1_2, 0], W = [Math.SQRT1_2, Math.SQRT1_2, 0];
const add = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const at = (ring, cx, cy) => ring.map((q) => ({ ...q, u: q.u + cx, v: q.v + cy }));
/** Assets: a 2 × 2 layer and one on top. Debts: two side by side. Each block is [x, y, z] of its foot's centre. */
const G = BK / 2 + 0.6;
const ASSETS = [[-G, -G, 0], [G, -G, 0], [-G, G, 0], [G, G, 0], [0, 0, BK]];
const DEBTS = [[-G, G, 0], [G, -G, 0]];

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let MAX = value;

  const C = Cam(45, 0.5, 1.56);
  const span = L + PR;
  fit(C, [add([0, 0, -2], U, -span), add([0, 0, -2], U, span), [BASE, BASE, 0], [-BASE, -BASE, 0], [0, 0, HP + 8 + L * Math.sin(rad(20))]], 200, 160);
  const P = proj(C), front = facing(C);

  const g = mk("g", {}, svg);
  // the base: two round steps, and the post
  const step = (r, z0, z1) => put(solid(g), prism(P, front, circ(r, 48), circ(r - 1.8, 48), z0, z1));
  step(BASE, 0, 7);
  step(BASE - 9, 7, 12);
  put(solid(g), prism(P, front, circ(4.5, 24), circ(3, 24), 12, HP));

  const needle = mk("path", { class: "nf" }, g), beam = mk("path", { class: "sil" }, g), pin = mk("path", {}, g);
  const pan = (n) => {
    const back = mk("path", { class: "nf lo" }, g), dish = solid(g), blocks = [];
    for (let i = 0; i < n; i++) blocks.push(solid(g));
    return { back, dish, blocks, side: mk("path", { class: "nf lo" }, g) };
  };
  const pans = [{ ...pan(ASSETS.length), list: ASSETS, s: -1 }, { ...pan(DEBTS.length), list: DEBTS, s: 1 }];
  const [br, bi] = rings(-BK / 2, -BK / 2, BK / 2, BK / 2, 2.2, 1);
  const foot = circ(PF, 40), top = circ(PR, 40), topIn = circ(PR - 1.6, 40);

  /** A rod through the centres, each with its own radius: the hull of a circle round the axis at each. */
  function rod(list) {
    const a = list[0][0], b = list[list.length - 1][0], dl = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const d = [(b[0] - a[0]) / dl, (b[1] - a[1]) / dl, (b[2] - a[2]) / dl];
    const e1n = Math.hypot(d[1], d[0]), e1 = [d[1] / e1n, -d[0] / e1n, 0];
    const e2 = [e1[1] * d[2] - e1[2] * d[1], e1[2] * d[0] - e1[0] * d[2], e1[0] * d[1] - e1[1] * d[0]];
    const pts = [];
    for (const [c, r] of list) for (let k = 0; k < 16; k++) {
      const t = (k / 16) * Math.PI * 2;
      pts.push(P(...add(add(c, e1, r * Math.cos(t)), e2, r * Math.sin(t))));
    }
    return poly(hull(pts));
  }

  let drawn = NaN;
  function draw(phi) {
    if (phi === drawn) return;
    drawn = phi;
    const c = Math.cos(rad(phi)), s = Math.sin(rad(phi)), O = [0, 0, HP];
    const end = (k, e = 0) => add(add(O, U, k * (L + e) * c), [0, 0, 1], k * (L + e) * s);
    // the beam: thick at the pivot, thin at the ends, each end capped round
    beam.setAttribute("d", rod([[end(-1, 2), 1.3], [end(-1), 2.6], [O, 4.6], [end(1), 2.6], [end(1, 2), 1.3]]));
    pin.setAttribute("d", rod([[add(O, W, -3), 2.6], [add(O, W, 7), 2.6]]));
    // the needle stands square to the beam, from behind it
    needle.setAttribute("d", seg(P(...O), P(...add(add(O, U, -28 * s), [0, 0, 1], 28 * c))));
    for (const pn of pans) {
      const h = end(pn.s), z0 = h[2] - HANG, z1 = z0 + PT, cx = h[0], cy = h[1];
      const rim = (dir) => P(...add([cx, cy, z1], dir, PR - 1));
      pn.back.setAttribute("d", seg(P(...h), rim([-Math.SQRT1_2, -Math.SQRT1_2, 0])));
      put(pn.dish, {
        sil: poly(hull(ringAt(P, at(foot, cx, cy), z0).concat(ringAt(P, at(top, cx, cy), z1)))),
        crease: open(ringAt(P, run(at(topIn, cx, cy), front), z1)),
      });
      pn.list.forEach(([bx, by, bz], i) => put(pn.blocks[i], prism(P, front, at(br, cx + bx, cy + by), at(bi, cx + bx, cy + by), z1 + bz, z1 + bz + BK)));
      pn.side.setAttribute("d", seg(P(...h), rim(U)) + seg(P(...h), rim([-U[0], -U[1], 0])));
    }
  }

  const tip = spring(value * 0.3);
  const B = register(stage, (dt) => {
    const m = stepS(tip, dt);
    draw(Math.round(tip.x * 100) / 100);
    return m;
  });
  bag.add(B.unregister);

  // hit: a fixed band over the whole balance; the press grows with the pointer's distance from the post
  const cx0 = P(0, 0, HP)[0], half = P(...add([0, 0, HP], U, L))[0] - cx0;
  const top0 = P(0, 0, HP + 30)[1], bot0 = P(BASE, BASE, 0)[1] + 10;
  const press = ([x, y]) => (y < top0 || y > bot0 || Math.abs(x - cx0) > half + PR * 1.6 ? null : clamp((cx0 - x) / half, -1, 1));

  let last = "";
  function setPress(q) {
    const t = q === null ? 0.3 : 0.3 + 0.7 * q;
    tip.t = MAX * t;
    const v = Math.round(t * 2), txt = q === null ? "rest" : v > 0 ? `+${v}` : `${v}`;
    pans[0].dish.sil.classList.toggle("hi", t >= 0);
    pans[1].dish.sil.classList.toggle("hi", t < 0);
    if (txt !== last) read.textContent = last = txt;
    B.wake();
  }

  let q0 = null;
  setPress(null);
  bag.add(pointer(stage, { move: (p) => setPress((q0 = press(p))), leave: () => setPress((q0 = null)) }));
  bag.add(() => svg.replaceChildren());

  return {
    set: (v) => { MAX = v; setPress(q0); },
    destroy: bag.dispose,
  };
}

hairline({
  name: "scale",
  means: "A balance with assets on one pan and debts on the other: press a pan and the beam tips toward it.",
  rules: [1, 3, 5, 8],
  range: [8, 14, 20],
  tour: [[90, 150], [200, 150], [310, 150], null],
  mount,
});
