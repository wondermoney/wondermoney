interface Props {
  children: React.ReactNode;
}

/**
 * The calculator's two panels: the inputs, then the result. From `lg` they sit side by side,
 * the result on the wider seven twelfths so its figures, charts and tables have room; below,
 * they stack. A tall input panel may stick (`lg:sticky lg:top-24`) while the result scrolls.
 */
export default function CalculatorLayout({ children }: Props) {
  return (
    <div className="calculator-layout grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start lg:gap-8">
      {children}
    </div>
  );
}
