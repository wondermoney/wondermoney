/**
 * Envelopes: a desk tray holding six budget envelopes on edge, their backs to
 * the viewer: the seams of the folded flaps, a pointed flap with a round seal
 * at its tip, and banknotes peeking out of the open ones. The envelope under
 * the pointer lifts, stands up and opens its flap wide, its notes rising;
 * the ones behind lean back and the ones in front lean forward, staggered
 * outwards from it. The slider is the stagger, in ms.
 *
 * The pattern: one of many, as Riffle. Tweens, a stagger by distance, and a
 * hit test on static bands along the resting top edges.
 */
const {
  Cam, clamp, fillet, fit, hull, open, poly, proj, rad, ringAt, rrect, run, seg, facing,
  tdone, tset, tval, tween, disposer, mk, place, pointer, register,
} = HL;

const N = 6, W = 88, H = 46, G = 15, TK = 2.6, FL = 25;
const REST = [-11, -14, -10, -13, -9, -12], BACK = -24, FWD = 16, LIFT = 15;
/** At rest: which flaps are tucked open behind, and how far their notes peek out. */
const AJAR = [1, 1, 0, 1, 0, 0], PEEK = [14, 8, 0, 11, 0, 0], UP = 14, AJ = 1.95 * Math.PI, OPEN = 1.12 * Math.PI;
const X0 = -6, X1 = W + 6, Y0 = -11, Y1 = (N - 1) * G + 9, WH = 15, WR = 6, WT = 2.4, MARK = 3;

/** A run of points ordered left to right on screen. */
const LR = (pts) => (pts[0][0] <= pts[pts.length - 1][0] ? pts : pts.slice().reverse());

/** The tray, which never moves: `far` is painted before the envelopes, `near` after them; each entry is [d, class]. */
function tray(P, front, outer, inner) {
  const far = [
    [poly(hull(ringAt(P, outer, 0).concat(ringAt(P, outer, WH)))), "sil"],
    [poly(ringAt(P, inner, WH)), "nf"],
    [open(ringAt(P, run(inner, (q) => !front(q)), 2.5)), "nf lo"],
  ];
  const iF = LR(ringAt(P, run(inner, front), WH)), oT = LR(ringAt(P, run(outer, front), WH)), oB = LR(ringAt(P, run(outer, front), 0));
  // a label holder on the front, left empty: the tray's own, not a word
  const hx = (X0 + X1) / 2, onFront = (ring) => ring.map((q) => P(q.u, Y1, q.v));
  const near = [
    [poly([...iF, oT[oT.length - 1], ...oB.slice().reverse(), oT[0]]), "fo"],
    [open(oT), "nf lo"],
    [open(iF), "nf"],
    [open([oT[0], ...oB, oT[oT.length - 1]]), "nf sil"],
    [poly(onFront(rrect(hx - 13, 4.5, hx + 13, 10.5, 2, 5))), "nf lo"],
  ];
  return { far, near };
}

const BODY = fillet([[0, 0], [W, 0], [W, H], [0, H]], [2.4, 2.4, 2.4, 2.4]);
/** The flap from one end of its hinge round the tip to the other, so the hinge itself is never stroked. */
const FLAP = ((f) => f.slice(5).concat(f.slice(0, 5)))(fillet([[0, 0], [W, 0], [W / 2 + 3, FL], [W / 2 - 3, FL]], [0.6, 0.6, 2.5, 2.5]));
/** Two notes in each envelope: [u0, u1, drop from the peek]. */
const NOTES = [[10, 54, 0], [27, 74, 5]];

/** Envelope i leaning th degrees, lifted, its flap at angle phi (0 shut, π upright), its notes peeking pk over the edge. */
function pose(P, i, th, lift, phi, pk) {
  const yb = i * G, s = Math.sin(rad(th)), c = Math.cos(rad(th));
  // u across, v up the envelope, n out of its back towards the viewer
  const w = (u, v, n = 0) => P(u, yb + v * s + n * c, v * c - n * s + lift);
  // shut, the flap's hinge sits a little under the edge, so its fill never eats the envelope's outline
  const f0 = 1.4 * Math.max(0, Math.cos(phi)), fl = (u, f) => w(u, H - f0 - f * Math.cos(phi), f * Math.sin(phi));
  const notes = NOTES.map(([u0, u1, dr]) => {
    const top = H + pk - dr, sh = fillet([[u0, H - 24], [u1, H - 24], [u1, top], [u0, top]], [1, 1, 1.2, 1.2]);
    const b = fillet([[u0 + 3, H - 21], [u1 - 3, H - 21], [u1 - 3, top - 3], [u0 + 3, top - 3]], [1, 1, 1, 1]);
    return [poly(sh.map((p) => w(p[0], p[1], -TK / 2))), poly(b.map((p) => w(p[0], p[1], -TK / 2)))];
  });
  return {
    back: poly(BODY.map((p) => w(p[0], p[1], -TK))),
    face: poly(BODY.map((p) => w(p[0], p[1]))),
    seams: open([w(3, 3), w(W / 2, H * 0.47), w(W - 3, 3)]) + seg(w(3, H - 3), w(W * 0.4, H * 0.5)) + seg(w(W - 3, H - 3), w(W * 0.6, H * 0.5)),
    // open: filled, but no stroke along the hinge, which the envelope's own edge already draws
    flap: open(FLAP.map((p) => fl(p[0], p[1]))),
    seal: fl(W / 2, FL - 4.5),
    notes,
  };
}

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let stag = value;

  // Fitted to the tray, an envelope lifted with its flap and notes up, and the front one leaning out.
  const C = Cam(45, 0.5, 1.72);
  fit(C, [[X0, Y0, 0], [X1, Y1, -6], [X1, Y0, 0], [X0, Y1, 0], [X0, Y0, H + LIFT + FL], [X1, Y0, H + LIFT + FL], [X1, Y1 + 6, H]], 200, 166);
  const P = proj(C), front = facing(C);
  const outer = rrect(X0, Y0, X1, Y1, WR, 6), inner = rrect(X0 + WT, Y0 + WT, X1 - WT, Y1 - WT, WR - WT, 6);
  const paths = tray(P, front, outer, inner);

  const g = mk("g", {}, svg);
  for (const [d, cls] of paths.far) mk("path", { d, class: cls }, g);

  const envs = [];
  for (let i = 0; i < N; i++) {
    const grp = mk("g", {}, g);
    const back = mk("path", { class: "lo" }, grp);
    const notes = NOTES.map(() => [mk("path", {}, grp), mk("path", { class: "nf lo" }, grp)]);
    const face = mk("path", { class: "sil" }, grp), seams = mk("path", { class: "nf lo" }, grp);
    const fg = mk("g", {}, grp), flap = mk("path", {}, fg), seal = mk("circle", { r: 1.5, class: "dot off" }, fg);
    envs.push({ grp, back, notes, face, seams, fg, flap, seal, shut: true, key: "",
      a: tween(REST[i]), z: tween(0), f: tween(AJAR[i] ? AJ : 0), k: tween(PEEK[i]) });
  }

  for (const [d, cls] of paths.near) mk("path", { d, class: cls }, g);

  // hit bands: oblique strips along the resting top edges, at the row's mean lean. They never move.
  const RL = REST.reduce((a, b) => a + b) / N;
  const top = (i) => P(W / 2, i * G + H * Math.sin(rad(RL)), H * Math.cos(rad(RL)));
  const c0 = top(0), c1 = top(1), d = [c1[0] - c0[0], c1[1] - c0[1]];
  const px0 = P(0, 0, 0), px1 = P(1, 0, 0), ex = [px1[0] - px0[0], px1[1] - px0[1]];
  const HALF = W / 2 + 6, det = d[0] * ex[1] - d[1] * ex[0];
  function hit([x, y]) {
    const qx = x - c0[0], qy = y - c0[1];
    const s = (qx * ex[1] - qy * ex[0]) / det, r = (d[0] * qy - d[1] * qx) / det;
    if (Math.abs(r) > HALF || s < -1 || s > N + 1.5) return -1;
    return clamp(Math.round(s), 0, N - 1);
  }

  function draw(i, now) {
    const e = envs[i], th = tval(e.a, now), lift = tval(e.z, now), phi = tval(e.f, now), pk = tval(e.k, now);
    const key = [th, lift, phi, pk].map((v) => v.toFixed(3)).join();
    if (key === e.key) return;
    e.key = key;
    const q = pose(P, i, th, lift, phi, pk);
    e.back.setAttribute("d", q.back);
    e.face.setAttribute("d", q.face);
    e.seams.setAttribute("d", q.seams);
    e.flap.setAttribute("d", q.flap);
    place(e.seal, q.seal);
    e.notes.forEach(([o, l], k) => { o.setAttribute("d", q.notes[k][0]); l.setAttribute("d", q.notes[k][1]); });
    // a flap leaning back sits behind the notes; one folded towards the viewer covers the back
    const shut = phi < Math.PI;
    if (shut !== e.shut) { e.shut = shut; shut ? e.grp.appendChild(e.fg) : e.back.after(e.fg); }
  }

  const B = register(stage, (_dt, now) => {
    let moving = false;
    envs.forEach((e, i) => { draw(i, now); if (![e.a, e.z, e.f, e.k].every((t) => tdone(t, now))) moving = true; });
    return moving;
  });
  bag.add(B.unregister);

  let act = -2;
  /** Opens envelope a (-1 puts them all back). The stagger spreads out from the one opened, or the one let go. */
  function setActive(a) {
    if (a === act) return;
    const now = performance.now(), from = a >= 0 ? a : act < 0 ? MARK : act;
    act = a;
    envs.forEach((e, i) => {
      const delay = Math.abs(i - from) * stag;
      tset(e.a, a < 0 ? REST[i] : i < a ? BACK : i > a ? FWD : 0, now, delay);
      tset(e.z, i === a ? LIFT : 0, now, delay);
      tset(e.f, i === a ? OPEN : AJAR[i] ? AJ : 0, now, delay);
      tset(e.k, i === a ? UP : PEEK[i], now, delay);
      const lit = a < 0 ? i === MARK : i === a;
      e.face.classList.toggle("hi", lit);
      e.seal.setAttribute("class", lit ? "dot" : "dot off");
    });
    read.textContent = a < 0 ? "rest" : `env ${a + 1}`;
    B.wake();
  }

  setActive(-1);
  bag.add(pointer(stage, { move: (p) => setActive(hit(p)), leave: () => setActive(-1) }));
  bag.add(() => svg.replaceChildren());

  return {
    set: (v) => { stag = v; },
    destroy: bag.dispose,
  };
}

hairline({
  name: "envelopes",
  means: "A monthly budget as six envelopes in a tray: the one under the pointer lifts and opens, and its neighbours lean away.",
  rules: [1, 2, 5, 6],
  range: [0, 45, 90],
  tour: [[150, 190], [200, 140], [250, 110], null],
  mount,
});
