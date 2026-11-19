/**
 * Wallet: an open bifold lying on its back, its two leaves rising a little
 * from the fold, stitched round the edge. The left leaf holds three cards in
 * stepped slots, each card's top and chip showing above its pocket; the right
 * leaf has a pocket with a window. The pointer's x picks a card, and it
 * slides up out of its slot on the 700ms curve with the bright edge, its
 * neighbours easing up a touch, staggered outwards. At rest the middle card
 * is half drawn. The slider is the stagger, in ms.
 *
 * The pattern: one of many. Tweens with a stagger by distance, paint order by
 * layer (each card between its own pocket and the one behind), and a hit
 * test on bands of the wallet's width at rest.
 */
const {
  Cam, clamp, fillet, fit, hull, open, poly, proj, rad, rrect,
  tdone, tset, tval, tween, disposer, mk, pointer, register,
} = HL;

const LA = 78, LB = 64, TH = 3, TILT = 20, Z0 = 3, CW = 64, CH = 38, OUT = 27, NEAR = 0.14, REST = 1;
const LIPS = [52, 38, 24];
const ct = Math.cos(rad(TILT)), st = Math.sin(rad(TILT));
/** A world point on leaf s (-1 left, 1 right): a' out from the fold, b up the leaf, h off its face. */
const L3 = (s, a, b, h = 0) => [s * (a * ct - h * st), -b, Z0 + a * st + h * ct];
const rect = (a0, b0, a1, b1, r) => fillet([[a0, b0], [a1, b0], [a1, b1], [a0, b1]], Array.isArray(r) ? r : [r, r, r, r]);

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let stag = value;

  const C = Cam(45, 0.5, 1.92);
  fit(C, [L3(-1, LA, 0, -TH), L3(1, LA, 0, -TH), L3(-1, LA, LB), L3(1, LA, LB), L3(-1, 40, LIPS[0] + 12 + OUT, 3)], 200, 166);
  const P = proj(C), at = (s, h) => (p) => P(...L3(s, p[0], p[1], h));

  const g = mk("g", {}, svg);
  // the fold: a rounded spine under the two leaves
  const spine = [];
  for (let k = 0; k <= 12; k++) spine.push(P(-2.6 * Math.cos(rad(k * 15)), 0.5, Z0 - 2.6 * Math.sin(rad(k * 15))));
  for (let k = 12; k >= 0; k--) spine.push(P(-2.6 * Math.cos(rad(k * 15)), -LB + 0.5, Z0 - 2.6 * Math.sin(rad(k * 15))));
  mk("path", { d: poly(hull(spine)), class: "sil" }, g);

  // each leaf: its silhouette, a crease along its edges that face the viewer, and its stitching
  const shape = rect(0, 0, LA, LB, [1, 7, 7, 1]);
  function leaf(s) {
    mk("path", { d: poly(hull(shape.map(at(s, 0)).concat(shape.map(at(s, -TH))))), class: "sil" }, g);
    mk("path", { d: open(shape.slice(2, s > 0 ? 13 : 8).map(at(s, 0))), class: "nf lo" }, g);
    mk("path", { d: poly(rrect(4, 4, LA - 4, LB - 4, 4, 4).map((q) => P(...L3(s, q.u, q.v, 0.2)))), class: "dash" }, g);
  }

  leaf(-1);
  // the cards and their pockets, back to front: card 0 in the top slot, behind pocket 0, and so on down
  const cards = LIPS.map((lip, k) => {
    const grp = mk("g", {}, g);
    const c = {
      lip, h: 0.5 + k, grp,
      face: mk("path", {}, grp), chip: mk("path", { class: "nf" }, grp), lines: mk("path", { class: "nf lo" }, grp),
      t: tween(k === REST ? 0.32 : 0), key: "",
    };
    const pocket = rect(4, 3, LA - 4, lip, [5, 5, 1.4, 1.4]);
    mk("path", { d: poly(pocket.map(at(-1, c.h + 0.5))) }, g);
    mk("path", { d: open([[8, lip - 3], [LA - 8, lip - 3]].map(at(-1, c.h + 0.5))), class: "dash" }, g);
    return c;
  });
  leaf(1);
  // the right leaf's pocket, with a window in it
  mk("path", { d: poly(rect(4, 3, LA - 4, 44, [5, 5, 1.4, 1.4]).map(at(1, 0.6))) }, g);
  mk("path", { d: poly(rect(12, 10, LA - 22, 37, 3).map(at(1, 0.7))), class: "nf lo" }, g);

  function draw(c, o) {
    const top = c.lip + 12 + o * OUT, b0 = top - CH, a0 = (LA - CW) / 2, w = at(-1, c.h + o * 1.2);
    c.face.setAttribute("d", poly(rect(a0, b0, a0 + CW, top, 3.2).map(w)));
    c.chip.setAttribute("d", poly(rect(a0 + 7, top - 12, a0 + 17, top - 4, 1.6).map(w)) + open([[a0 + 7, top - 8], [a0 + 17, top - 8]].map(w)));
    c.lines.setAttribute("d", open([[a0 + 7, top - 19], [a0 + 44, top - 19]].map(w)) + open([[a0 + 7, top - 24], [a0 + 26, top - 24]].map(w)));
  }

  const B = register(stage, (_dt, now) => {
    let moving = false;
    for (const c of cards) {
      const o = tval(c.t, now), key = o.toFixed(4);
      if (key !== c.key) { c.key = key; draw(c, o); }
      if (!tdone(c.t, now)) moving = true;
    }
    return moving;
  });
  bag.add(B.unregister);

  // hit: the card leaf's width at rest, cut in three bands, ordered as the cards' rest centres fall left to right
  const corners = [0, LA].flatMap((a) => [0, LB].map((b) => P(...L3(-1, a, b))));
  const xs = [Math.min(...corners.map((p) => p[0])), Math.max(...corners.map((p) => p[0]))];
  const ys = [Math.min(...corners.map((p) => p[1])) - 24, Math.max(...corners.map((p) => p[1])) + 14];
  const order = cards.map((c, k) => [P(...L3(-1, LA / 2, c.lip + 6))[0], k]).sort((a, b) => a[0] - b[0]).map((e) => e[1]);
  function hit([x, y]) {
    if (x < xs[0] - 10 || x > xs[1] + 10 || y < ys[0] || y > ys[1]) return -1;
    return order[clamp(Math.floor(((x - xs[0]) / (xs[1] - xs[0])) * 3), 0, 2)];
  }

  let act = -2;
  function choose(a) {
    if (a === act) return;
    const now = performance.now(), from = a >= 0 ? a : act >= 0 ? act : REST;
    act = a;
    cards.forEach((c, i) => {
      const d = Math.abs(i - from);
      tset(c.t, a < 0 ? (i === REST ? 0.32 : 0) : i === a ? 1 : d === 1 ? NEAR : 0, now, d * stag);
      c.face.classList.toggle("hi", a < 0 ? i === REST : i === a);
    });
    read.textContent = a < 0 ? "rest" : `card ${a + 1}`;
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
  name: "wallet",
  means: "An open wallet with three cards in its slots: move the pointer across it and the card it picks slides out.",
  rules: [1, 2, 5, 6],
  range: [0, 45, 90],
  tour: [[120, 170], [200, 150], [280, 130], null],
  mount,
});
