/**
 * Timer: a round kitchen timer, a squat body with a ridged dial on top and an
 * index mark on the body's front. The dial carries a ring of minute ticks and
 * a grip across its face, and an arc from the dial's zero round to the index
 * shows the time set. The pointer, read on the dial's top plane, turns the
 * dial; it clicks into detents, one minute apart, on a spring, and the minute
 * at the index goes to the read-out. The slider is the detent, in minutes.
 *
 * The pattern: push the camera's cousin, a turned part with detents. One
 * spring for the dial's angle, a hit test on a plane that never moves, and
 * ridges and ticks that ride the dial round.
 */
const {
  Cam, circ, clamp, facing, fit, lerp, open, prism, proj, rad, rrect, seg, spring, stepS, unproj,
  disposer, mk, pointer, put, register, solid,
} = HL;

const BR = 64, BH = 26, DR = 59, DT = BH + 17, GH = 10, GL = 40, GW = 7, IDX = 45, REST = 20;

/** A ring turned by a degrees about the centre, normals and all. */
const turn = (ring, a) => {
  const c = Math.cos(rad(a)), s = Math.sin(rad(a));
  return ring.map((q) => ({ u: q.u * c - q.v * s, v: q.u * s + q.v * c, nu: q.nu * c - q.nv * s, nv: q.nu * s + q.nv * c }));
};

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let step = value;

  const C = Cam(45, 0.5, 1.8);
  fit(C, [[-BR, -BR, 0], [BR, BR, 0], [BR, -BR, 0], [-BR, BR, 0], [0, 0, DT + GH]], 200, 166);
  const P = proj(C), front = facing(C);
  const at = (r, a, z) => P(r * Math.cos(rad(a)), r * Math.sin(rad(a)), z);

  const g = mk("g", {}, svg);
  // the body, and the index mark on its front
  put(solid(g), prism(P, front, circ(BR, 64), circ(BR - 2, 64), 0, BH));
  const index = mk("path", { d: seg(at(BR, IDX, 5), at(BR, IDX, BH - 6)), class: "nf hi" }, g);
  // the dial: its skirt ridged, its face ticked, a grip across it
  put(solid(g), prism(P, front, circ(DR, 64), circ(DR - 2, 64), BH, DT));
  const ridges = mk("path", { class: "nf lo" }, g), span = mk("path", { class: "nf" }, g), ticks = mk("path", { class: "nf lo" }, g), fives = mk("path", { class: "nf" }, g);
  const grip = solid(g), gr = rrect(-GL, -GW, GL, GW, GW, 6), gi = rrect(-GL + 1.6, -GW + 1.6, GL - 1.6, GW - 1.6, GW - 1.6, 6);

  let drawn = NaN;
  /** The dial turned to world angle d: minute m sits at d - 6m. */
  function draw(d) {
    if (d === drawn) return;
    drawn = d;
    let r = "", t = "", f = "";
    for (let k = 0; k < 60; k++) {
      const w = d + k * 6, n = Math.cos(rad(w)) + Math.sin(rad(w));
      if (n > 0.2) r += seg(at(DR, w + 3, BH + 3), at(DR, w + 3, DT - 3));
      const a = d - k * 6;
      if (k % 5) t += seg(at(DR - 9, a, DT), at(DR - 5, a, DT));
      else f += seg(at(DR - 14, a, DT), at(DR - 5, a, DT));
    }
    // the time set: an arc on the face from the dial's zero round to the index
    const arc = [];
    for (let k = 0; k <= 48; k++) arc.push(at(DR - 22, lerp(IDX, d, k / 48), DT));
    span.setAttribute("d", open(arc));
    ridges.setAttribute("d", r); ticks.setAttribute("d", t); fives.setAttribute("d", f);
    put(grip, prism(P, front, turn(gr, d), turn(gi, d), DT, DT + GH));
  }

  const dial = spring(IDX + REST * 6);
  const B = register(stage, (dt) => {
    const m = stepS(dial, dt);
    draw(Math.round(dial.x * 100) / 100);
    return m;
  });
  bag.add(B.unregister);

  // hit: the pointer on the dial's top plane, which never moves; its angle is the grip's
  let mins = -1;
  function turnTo(p) {
    let m = -1;
    if (p) {
      const [x, y] = unproj(C, p[0], p[1], DT), r = Math.hypot(x, y);
      if (r > BR * 1.45) m = -1;
      else if (r < 8) m = mins;
      else {
        const raw = ((((Math.atan2(y, x) * 180) / Math.PI - IDX) / 6) % 60 + 60) % 60;
        m = (Math.round(raw / step) * step) % 60;
      }
    }
    const want = IDX + (m < 0 ? REST : m) * 6;
    let t = want;
    while (t - dial.t > 180) t -= 360;
    while (t - dial.t < -180) t += 360;
    dial.t = t;
    if (m !== mins) {
      mins = m;
      read.textContent = m < 0 ? "rest" : `${clamp(m, 0, 60)} min`;
      index.classList.toggle("hi", m < 0);
      span.classList.toggle("hi", m >= 0);
    }
    B.wake();
  }

  read.textContent = "rest";
  bag.add(pointer(stage, { move: (p) => turnTo(p), leave: () => turnTo(null) }));
  bag.add(() => svg.replaceChildren());

  return {
    set: (v) => { step = v; },
    destroy: bag.dispose,
  };
}

hairline({
  name: "timer",
  means: "A kitchen timer: turn the ridged dial round and it clicks, a minute at a time, past the mark on its body.",
  rules: [1, 7, 8, 9],
  range: [0.5, 1, 5],
  tour: [[129, 100], [200, 64], [271, 100], null],
  mount,
});
