/**
 * Snowball: five dominoes on a plinth, smallest first, each one a debt, and a
 * ball in front of the row. The pointer's place along the row says how many
 * are paid: that many dominoes tip over backwards, smallest first, staggered
 * outwards from the last one to move, and the ball rolls on to the next one
 * standing, a little bigger for every debt it has cleared. The domino it faces
 * takes the bright edge. The slider is the stagger, in ms.
 *
 * The pattern: one of many, counted. Tweens with a stagger by distance, a hit
 * test on the dominoes' resting centres along the row, and solids extruded
 * along the row so they can tip about their back edge.
 */
const {
  Cam, fit, hull, open, poly, proj, rrect, run, rings, prism, facing,
  tset, tval, tdone, tween, disposer, mk, place, pointer, put, register, solid,
} = HL;

const N = 5, WS = [8, 11, 14.5, 18.5, 23], GAP = 8, HF = 1.9, TF = 0.42, XA = 24, REST = 1;
const PX0 = 5, PY0 = -51, PY1 = 27, PH = 6, R0 = 5, RG = 0.9;
/** Where each domino stands: x0, x1, its height and thickness. */
const DOM = [];
WS.forEach((w, i) => { const x0 = i ? DOM[i - 1].x1 + GAP : XA; DOM.push({ w, x0, x1: x0 + w, h: w * HF, t: w * TF }); });
const PX1 = DOM[N - 1].x1 + 2 * (R0 + N * RG) + 8;
/** The ball after k debts: its radius, and where it waits, against the next domino or past the last. */
const ballR = (k) => R0 + k * RG;
const ballX = (k) => (k < N ? DOM[k].x0 - ballR(k) - 1.5 : DOM[N - 1].x1 + ballR(k) + 4);
/** Towards the camera, for the ball's seam and the dominoes' end crease. */
const V = [0.612, 0.612, 0.5];
/** Pip layouts on a 3 × 3 grid, for one to five. */
const PIPS = [[4], [0, 8], [0, 4, 8], [0, 2, 6, 8], [0, 2, 4, 6, 8]];

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let stag = value;

  const C = Cam(45, 0.5, 1.88);
  const top = DOM[N - 1];
  fit(C, [[PX0, PY0, -PH], [PX1, PY1, -PH], [PX1, PY0, -PH], [PX0, PY1, -PH], [top.x0, 0, top.h], [top.x1, 0, top.h]], 200, 166);
  const P = proj(C), front = facing(C);

  const g = mk("g", {}, svg);
  const [pr, pi] = rings(PX0, PY0, PX1, PY1, 10, 2.2);
  put(solid(g), prism(P, front, pr, pi, -PH, 0));

  // Each domino is its cross-section (y across, z up) carried along x, tipping back about its back foot.
  const doms = DOM.map((d, i) => {
    const sec = rrect(-d.t / 2, 0, d.t / 2, d.h, d.t * 0.3, 4), inner = rrect(-d.t / 2 + 0.9, 0.9, d.t / 2 - 0.9, d.h - 0.9, d.t * 0.3 - 0.9, 4);
    const s = solid(g), mid = mk("path", { class: "nf lo" }, s.g);
    const pips = PIPS[i].map(() => mk("circle", { r: 0.45 + d.w * 0.035, class: "dot off" }, s.g));
    return { ...d, i, sec, inner, s, mid, pips, tip: tween(i < REST ? 1 : 0), key: "" };
  });

  function drawDom(d, now) {
    const a = tval(d.tip, now) * Math.PI / 2, ca = Math.cos(a), sa = Math.sin(a), key = a.toFixed(4);
    if (key === d.key) return;
    d.key = key;
    // a point of the section (u across, v up) after the tip, at x
    const at = (x, u, v) => P(x, -d.t / 2 + (u + d.t / 2) * ca - v * sa, (u + d.t / 2) * sa + v * ca);
    const faces = (q) => V[1] * (q.nu * ca - q.nv * sa) + V[2] * (q.nu * sa + q.nv * ca) > 0;
    const sil = poly(hull(d.sec.map((q) => at(d.x0, q.u, q.v)).concat(d.sec.map((q) => at(d.x1, q.u, q.v)))));
    const crease = open(run(d.inner, faces).map((q) => at(d.x1, q.u, q.v)));
    put(d.s, { sil, crease });
    const f = d.t / 2 + 0.05, xm = (d.x0 + d.x1) / 2;
    d.mid.setAttribute("d", open([at(d.x0 + 1.6, f, d.h / 2), at(d.x1 - 1.6, f, d.h / 2)]));
    PIPS[d.i].forEach((k, j) => place(d.pips[j], at(xm + ((k % 3) - 1) * d.w * 0.24, f, d.h * 0.75 + (1 - Math.floor(k / 3)) * d.w * 0.24)));
  }

  // The ball: an outline and one seam, a ring round one pole that turns as it rolls.
  const ball = { el: mk("ellipse", { class: "sil" }, g), seam: mk("path", { class: "nf lo" }, g),
    x: tween(ballX(REST)), r: tween(ballR(REST)), key: "" };
  const n0 = [0.2, 0.55, 0.81], e1 = [0, 0.83, -0.56], e2 = [n0[1] * e1[2] - n0[2] * e1[1], n0[2] * e1[0] - n0[0] * e1[2], n0[0] * e1[1] - n0[1] * e1[0]];
  const CA = Math.cos(0.95), SA = Math.sin(0.95);
  function drawBall(now) {
    const bx = tval(ball.x, now), r = tval(ball.r, now), by = r + 5.5, key = `${bx.toFixed(3)},${r.toFixed(3)}`;
    if (key === ball.key) return;
    ball.key = key;
    const c = P(bx, by, r), e = P(bx + r * 0.7071, by - r * 0.7071, r), R = Math.hypot(e[0] - c[0], e[1] - c[1]);
    ball.el.setAttribute("cx", c[0]); ball.el.setAttribute("cy", c[1]);
    ball.el.setAttribute("rx", R); ball.el.setAttribute("ry", R);
    // rolling along +x turns the ball about y, the top going forwards
    const th = bx / r, ct = Math.cos(th), st = Math.sin(th), ring = [];
    for (let k = 0; k < 48; k++) {
      const ph = (k / 48) * 2 * Math.PI, p = [0, 1, 2].map((j) => CA * n0[j] + SA * (Math.cos(ph) * e1[j] + Math.sin(ph) * e2[j]));
      const q = [p[0] * ct + p[2] * st, p[1], -p[0] * st + p[2] * ct];
      ring.push({ q, nu: q[0] * V[0] + q[1] * V[1] + q[2] * V[2] });
    }
    ball.seam.setAttribute("d", open(run(ring, (s) => s.nu > 0.05).map((s) => P(bx + s.q[0] * r * 0.97, by + s.q[1] * r * 0.97, r + s.q[2] * r * 0.97))));
  }

  const B = register(stage, (_dt, now) => {
    doms.forEach((d) => drawDom(d, now));
    drawBall(now);
    return !doms.every((d) => tdone(d.tip, now)) || !tdone(ball.x, now) || !tdone(ball.r, now);
  });
  bag.add(B.unregister);

  // hit: the dominoes' resting centres along the row, by screen x; paid is how many the pointer has passed
  const cx = DOM.map((d) => P((d.x0 + d.x1) / 2, 0, d.h / 2)[0]);
  const xl = P(PX0, PY1, 0)[0], xr = P(PX1, PY0, 0)[0], yt = P(top.x0, 0, top.h)[1] - 24, yb = P(PX1, PY1, -PH)[1] + 8;
  function hit([x, y]) {
    if (x < xl || x > xr || y < yt || y > yb) return -1;
    return cx.filter((c) => c < x).length;
  }

  let paid = -2;
  function setPaid(k) {
    if (k === paid) return;
    const now = performance.now(), prev = paid < 0 ? REST : paid, n = k < 0 ? REST : k;
    paid = k;
    const pivot = n > prev ? prev : n - 1;
    doms.forEach((d, i) => {
      tset(d.tip, i < n ? 1 : 0, now, Math.abs(i - pivot) * stag);
      d.s.sil.classList.toggle("hi", i === n);
    });
    // the ball sets off with the last domino to tip, so it never runs ahead of the chain
    const lag = n > prev ? (n - 1 - pivot) * stag : 0;
    tset(ball.x, ballX(n), now, lag);
    tset(ball.r, ballR(n), now, lag);
    ball.el.classList.toggle("hi", n === N);
    read.textContent = k < 0 ? "rest" : `${k} paid`;
    B.wake();
  }

  setPaid(-1);
  bag.add(pointer(stage, { move: (p) => setPaid(hit(p)), leave: () => setPaid(-1) }));
  bag.add(() => svg.replaceChildren());

  return {
    set: (v) => { stag = v; },
    destroy: bag.dispose,
  };
}

hairline({
  name: "snowball",
  means: "Debts as dominoes, smallest first: move along the row to tip them over, and the ball rolls on, growing.",
  rules: [1, 2, 5, 8],
  range: [0, 60, 120],
  tour: [[200, 150], [250, 170], [300, 190], null],
  mount,
});
