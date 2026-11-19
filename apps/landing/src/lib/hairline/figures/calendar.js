/**
 * Calendar: a desk calendar standing as a tent, two boards hinged at the top
 * under a twin-wire binding, twelve month pages hanging down the front, each
 * with a header and a ruled grid of weeks that starts on its own weekday. The
 * pointer's x picks the month; the pages before it flip up over the binding
 * to the back, staggered outwards from the page that turned first. The day
 * circled on the page in front takes the bright edge. At rest the top page is
 * lifted a little, as if about to turn. The slider is the stagger, in ms.
 *
 * The pattern: one of many, by scrubbing. Tweens with a stagger by distance,
 * a hit test on the calendar's width at rest, and paint order that moves a
 * page from the front group to the back one as it passes over the top.
 */
const {
  Cam, circ, clamp, fillet, fit, poly, proj, rad, seg,
  tdone, tset, tval, tween, disposer, mk, pointer, register,
} = HL;

const N = 12, W = 138, L = 50, A = 22, HT = L * Math.cos(rad(A)) + 1, REST = 5, CURL = 18, RR = 3.4;
const STARTS = [3, 6, 6, 2, 4, 0, 2, 5, 1, 3, 6, 1];
const ROWS = 5, CW = (W - 12) / 7, CS0 = 17, CH = (L - 3 - CS0) / ROWS;
/** How far each page fans out from its board: the first page farthest. */
const off = (i) => (N - 1 - i) * 0.75 + 1.2;
const facesCam = (phi) => 0.612 * Math.cos(rad(phi)) + 0.5 * Math.sin(rad(phi)) > 0;

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let stag = value;

  const C = Cam(45, 0.5, 1.84);
  const Y = L * Math.sin(rad(A)) + 2;
  fit(C, [[0, -Y, 0], [W, Y, 0], [W, -Y, 0], [0, Y, 0], [0, 0, HT + L], [W, 0, HT + L]], 200, 166);
  const P = proj(C);
  /** The point (u, s) of a page or board hanging at angle phi from the binding: s runs down it from the top. */
  const at = (phi) => (u, s) => P(u, s * Math.sin(rad(phi)), HT - s * Math.cos(rad(phi)));
  const sheet = fillet([[0, 0], [W, 0], [W, L], [0, L]], [0.5, 0.5, 2.2, 2.2]);
  const board = fillet([[0, 0], [W, 0], [W, L + 2], [0, L + 2]], [0.5, 0.5, 2.6, 2.6]);

  const g = mk("g", {}, svg), gBack = mk("g", {}, g);
  for (const [phi, cls] of [[360 - A + 2, "lo"], [360 - A + 0.6, "sil"], [A - 2, "lo"], [A - 0.6, "sil"]]) {
    const w = at(phi);
    mk("path", { d: poly(board.map((p) => w(p[0], p[1]))), class: cls }, g);
  }
  const gFront = mk("g", {}, g);

  // each page: its outline, its header rule and its grid of days, and the ring round one day
  const pages = [];
  for (let i = 0; i < N; i++) {
    // a ruled grid of five weeks, its first row starting on the month's own weekday
    const grp = mk("g", {}, gFront), st = STARTS[i], cu = (c) => 6 + c * CW, cs = (r) => CS0 + r * CH, rules = [];
    for (let r = 0; r <= ROWS; r++) rules.push([cu(r ? 0 : st), cs(r), cu(7), cs(r)]);
    for (let c = 0; c <= 7; c++) rules.push([cu(c), cs(c < st ? 1 : 0), cu(c), cs(ROWS)]);
    const k = st + ((i * 5 + 9) % 27);
    pages.push({
      grp, rules, day: [cu((k % 7) + 0.5), cs(Math.floor(k / 7) + 0.5)], phi: tween(A + off(i)), drawn: NaN, back: null,
      face: mk("path", { class: "sil" }, grp), lines: mk("path", { class: "nf lo" }, grp),
      head: mk("path", { class: "nf" }, grp), ring: mk("path", { class: "nf" }, grp),
    });
  }
  // the twin-wire binding over the top: a pair of loops every few units
  let wire = "";
  for (let k = 0; k < 13; k++) for (const du of [-1.4, 1.4]) {
    const u = 7 + k * ((W - 14) / 12) + du;
    wire += poly(circ(RR, 14).map((q) => P(u, q.u, HT + 0.6 + q.v)));
  }
  mk("path", { d: wire, class: "nf" }, g);

  let cur = REST - 1, lit = -1;
  function draw(pg, phi) {
    if (phi === pg.drawn) return;
    pg.drawn = phi;
    const w = at(phi), show = facesCam(phi);
    pg.face.setAttribute("d", poly(sheet.map((p) => w(p[0], p[1]))));
    pg.head.setAttribute("d", show ? seg(w(6, 13), w(W - 6, 13)) : "");
    pg.lines.setAttribute("d", show ? pg.rules.map((q) => seg(w(q[0], q[1]), w(q[2], q[3]))).join("") : "");
    const [u, v] = pg.day;
    pg.ring.setAttribute("d", show && pages.indexOf(pg) === lit ? poly(circ(1, 24).map((q) => w(u + q.u * 7.4, v + q.v * 4.6))) : "");
  }

  /** Paint order: pages over the top go behind the boards, the first turned farthest back; the rest in front, the next to turn on top. */
  function order(now) {
    const back = pages.map((pg) => tval(pg.phi, now) >= 180);
    if (pages.every((pg, i) => pg.back === back[i])) return;
    pages.forEach((pg, i) => { pg.back = back[i]; });
    pages.forEach((pg) => { if (pg.back) gBack.appendChild(pg.grp); });
    for (let i = N - 1; i >= 0; i--) if (!pages[i].back) gFront.appendChild(pages[i].grp);
  }

  const B = register(stage, (_dt, now) => {
    let moving = false;
    order(now);
    pages.forEach((pg) => { draw(pg, Math.round(tval(pg.phi, now) * 100) / 100); if (!tdone(pg.phi, now)) moving = true; });
    return moving;
  });
  bag.add(B.unregister);

  // hit: the pointer's x across the calendar's width at rest, cut into twelve months
  const xl = P(0, 0, HT)[0], xr = P(W, 0, HT)[0], ytop = P(W, 0, HT + L)[1], ybot = P(W, Y, 0)[1] + 12;
  function hit([x, y]) {
    if (y < ytop || y > ybot || x < xl - 24 || x > xr + 24) return -1;
    return clamp(Math.floor(((x - xl) / (xr - xl)) * N), 0, N - 1);
  }

  let act = -2;
  function turnTo(k) {
    if (k === act) return;
    const now = performance.now(), m = k < 0 ? REST - 1 : k, from = m >= cur ? cur : cur - 1;
    act = k;
    pages.forEach((pg, i) => {
      const phi = i < m ? 360 - A - off(i) : A + off(i) + (k < 0 && i === m ? CURL : 0);
      tset(pg.phi, phi, now, Math.abs(i - from) * stag);
      pg.drawn = NaN;
    });
    cur = m; lit = m;
    read.textContent = k < 0 ? "rest" : `month ${k + 1}`;
    B.wake();
  }

  turnTo(-1);
  pages.forEach((pg) => { pg.phi = tween(tval(pg.phi, Infinity)); pg.ring.setAttribute("class", "nf hi"); });
  bag.add(pointer(stage, { move: (p) => turnTo(hit(p)), leave: () => turnTo(-1) }));
  bag.add(() => svg.replaceChildren());

  return {
    set: (v) => { stag = v; },
    destroy: bag.dispose,
  };
}

hairline({
  name: "calendar",
  means: "A desk calendar: move the pointer to the right and the months flip up over the binding, one after another.",
  rules: [1, 2, 5, 6],
  range: [0, 40, 80],
  tour: [[128, 164], [196, 190], [262, 226], null],
  mount,
});
