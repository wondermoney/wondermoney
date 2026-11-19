/**
 * Calculator: a desk calculator whose top slopes down toward you, a recessed
 * display window at the back, blank, and a grid of keys with one tall key at
 * the bottom right. The key under the pointer sinks; its neighbours sink a
 * little, staggered outwards by distance. The tall key takes the bright edge
 * at rest. The slider is the stagger, in ms.
 *
 * The pattern: one of many on a slope. Tweens, a stagger by distance, and a
 * hit test that puts the pointer on each key's own resting top, since every
 * row of keys stands at a different height.
 */
const {
  Cam, facing, fit, hull, open, poly, proj, rings, rrect, run, unproj,
  tdone, tset, tval, tween, disposer, mk, pointer, put, register, solid,
} = HL;

const KP = 19, KS = 14.5, KH = 7, M = 8, DY0 = 8, DY1 = 36, KY = 44;
const WB = 2 * M + 3 * KP + KS, D = KY + 4 * KP + KS + M, HB = 26, HF = 9, SINK = 5.2;
/** The top's height over the ground at depth v: high at the back, low at the front. */
const zt = (v) => HB + ((HF - HB) * v) / D;
/** Rows top to bottom; the plus key is tall, spanning the last two rows. */
const NAMES = [["C", "±", "%", "÷"], ["7", "8", "9", "×"], ["4", "5", "6", "−"], ["1", "2", "3", "+"], ["0", ".", "="]];
const TALL = "+";

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let stag = value;

  const C = Cam(45, 0.5, 1.74);
  fit(C, [[0, 0, 0], [WB, D, 0], [WB, 0, 0], [0, D, 0], [0, 0, HB], [WB, 0, HB]], 200, 160);
  const P = proj(C), front = facing(C);
  /** Points on or over the sloped top: z is the height above it. */
  const on = (ring, z) => ring.map((q) => P(q.u, q.v, zt(q.v) + z));

  const g = mk("g", {}, svg);
  const [br, bi] = rings(0, 0, WB, D, 7, 2);
  put(solid(g), { sil: poly(hull(br.map((q) => P(q.u, q.v, 0)).concat(on(br, 0)))), crease: open(on(run(bi, front), 0)) });
  // the display: a window let into the top, its far wall showing; nothing in it
  mk("path", { d: poly(on(rrect(M, DY0, WB - M, DY1, 3, 4), 0)), class: "nf" }, g);
  mk("path", { d: open(on(run(rrect(M + 1.8, DY0 + 1.8, WB - M - 1.8, DY1 - 1.8, 2, 4), (q) => !front(q)), -2.2)), class: "nf lo" }, g);

  const keys = [];
  NAMES.forEach((row, r) => row.forEach((name, c) => {
    if (r === 4 && c === 3) return;
    const x = M + c * KP, y = KY + r * KP, tall = name === TALL;
    const [ring, inner] = rings(x, y, x + KS, y + (tall ? KP + KS : KS), 2.8, 1);
    keys.push({ name, ring, inner, cx: x + KS / 2, cy: y + (tall ? KP + KS : KS) / 2, r: tall ? 3.5 : r, c, tall });
  }));
  // back to front: the key nearest the far corner first
  keys.sort((a, b) => a.cx + a.cy - (b.cx + b.cy));
  keys.forEach((k) => { k.s = solid(g); k.d = tween(k.tall ? 1.4 : 0); k.drawn = NaN; });

  function draw(k, d) {
    if (d === k.drawn) return;
    k.drawn = d;
    put(k.s, { sil: poly(hull(on(k.ring, 0).concat(on(k.ring, KH - d)))), crease: open(on(run(k.inner, front), KH - d)) });
  }

  const B = register(stage, (_dt, now) => {
    let moving = false;
    keys.forEach((k) => { draw(k, Math.round(tval(k.d, now) * 100) / 100); if (!tdone(k.d, now)) moving = true; });
    return moving;
  });
  bag.add(B.unregister);

  // hit: the pointer put on each key's resting top in turn; the key that holds it nearest its middle
  function hit([x, y]) {
    let best = -1, bd = Infinity;
    keys.forEach((k, i) => {
      const [u, v] = unproj(C, x, y, zt(k.cy) + KH), hw = KS / 2 + 2.5, hh = (k.tall ? KP + KS : KS) / 2 + 2.5;
      const du = Math.abs(u - k.cx) / hw, dv = Math.abs(v - k.cy) / hh, dd = Math.max(du, dv);
      if (dd <= 1 && dd < bd) { best = i; bd = dd; }
    });
    return best;
  }

  let act = -2;
  function press(a) {
    if (a === act) return;
    const now = performance.now(), from = a >= 0 ? keys[a] : act >= 0 ? keys[act] : null;
    act = a;
    keys.forEach((k, i) => {
      const dist = from ? Math.hypot(k.c - from.c, k.r - from.r) : 0;
      const sink = a < 0 ? (k.tall ? 1.4 : 0) : i === a ? SINK : dist < 1.1 ? 2 : dist < 1.6 ? 0.9 : 0;
      tset(k.d, sink, now, Math.round(dist) * stag);
      k.s.sil.classList.toggle("hi", a < 0 ? k.tall : i === a);
    });
    read.textContent = a < 0 ? "rest" : `key ${keys[a].name}`;
    B.wake();
  }

  press(-1);
  bag.add(pointer(stage, { move: (p) => press(hit(p)), leave: () => press(-1) }));
  bag.add(() => svg.replaceChildren());

  return {
    set: (v) => { stag = v; },
    destroy: bag.dispose,
  };
}

hairline({
  name: "calculator",
  means: "A desk calculator: the key under the pointer sinks, and the keys around it give a little.",
  rules: [1, 2, 9, 10],
  range: [0, 40, 90],
  tour: [[166, 123], [190, 163], [143, 192], null],
  mount,
});
