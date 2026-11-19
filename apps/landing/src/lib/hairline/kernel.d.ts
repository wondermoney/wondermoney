/** The part of the Hairline kernel (kernel.js) the mount module calls; figures use the rest. */
declare const HL: {
  inject(root: Document | ShadowRoot): void;
  mk(tag: string, attrs: Record<string, string | number> | null, parent?: Element): SVGElement;
  reducedMotion(): boolean;
  readonly [name: string]: unknown;
};

export default HL;
