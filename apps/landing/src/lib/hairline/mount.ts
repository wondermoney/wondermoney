/**
 * Puts Hairline figures on a page: the minimum of the skill's bench
 * (bench.html) the site needs. A figure file is a script in the skill's
 * format, which reads the kernel from the global `HL` and declares itself with
 * a global `hairline({ … })` call, so both globals are set before the file is
 * imported. The kernel and each figure are their own lazy chunks, loaded when
 * the first box nears the viewport.
 *
 * Left out of the bench on purpose: the corner read-out (kept off the page),
 * the slider, the theme switch (the page's tokens theme the figure) and the
 * tour (the site has no autoplay).
 */

type Value = number;

export type HairlineFigure = {
  name: string;
  means: string;
  rules: number[];
  range: [Value, Value, Value];
  tour?: unknown;
  mount: (
    context: { stage: HTMLElement; svg: SVGElement; read: { textContent: string | null } },
    value: Value,
  ) => { set: (value: Value) => void; destroy: () => void };
};

type Global = typeof globalThis & { HL?: unknown; hairline?: (figure: HairlineFigure) => void };

const registry = new Map<string, HairlineFigure>();
const figureFiles = import.meta.glob("./figures/*.js");

let kernel: Promise<(typeof import("./kernel.js"))["default"]> | null = null;

function loadKernel() {
  kernel ??= import("./kernel.js").then(({ default: HL }) => {
    const scope = globalThis as Global;
    scope.HL = HL;
    scope.hairline = (figure) => {
      registry.set(figure.name, figure);
    };
    HL.inject(document);
    return HL;
  });
  return kernel;
}

/** The figure's declaration, importing its file the first time. */
export async function loadFigure(name: string): Promise<HairlineFigure> {
  await loadKernel();
  const known = registry.get(name);
  if (known) return known;
  const file = figureFiles[`./figures/${name}.js`];
  if (!file) throw new Error(`hairline: no figure named "${name}"`);
  await file();
  const figure = registry.get(name);
  if (!figure) throw new Error(`hairline: ./figures/${name}.js declared no figure "${name}"`);
  return figure;
}

/** Draws the named figure into its box, at the middle of the figure's range. */
export async function mountFigure(stage: HTMLElement) {
  const name = stage.dataset.hlFigure;
  if (!name || stage.dataset.hairline) return null;
  const [HL, figure] = await Promise.all([loadKernel(), loadFigure(name)]);
  if (stage.dataset.hairline) return null;
  stage.dataset.hairline = figure.name;
  const svg = HL.mk("svg", { viewBox: "0 0 400 320", "aria-hidden": "true", focusable: "false" }, stage);
  // The read-out the bench prints in the corner: figures write to it, the page shows none of it.
  const read = { textContent: null as string | null };
  return figure.mount({ stage, svg, read }, figure.range[1]);
}

/** Mounts every figure box on the page as it nears the viewport. */
export function mountFigures(root: ParentNode = document) {
  const boxes = Array.from(root.querySelectorAll<HTMLElement>("[data-hl-figure]:not([data-hairline])"));
  if (!boxes.length) return;
  const mount = (box: HTMLElement) => {
    mountFigure(box).catch((error: unknown) => {
      // The box keeps its size and stays empty: the page reads the same without the drawing.
      console.error(error);
    });
  };
  if (!("IntersectionObserver" in window)) {
    boxes.forEach(mount);
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        mount(entry.target as HTMLElement);
      }
    },
    { rootMargin: "200px 0px" },
  );
  boxes.forEach((box) => observer.observe(box));
}
