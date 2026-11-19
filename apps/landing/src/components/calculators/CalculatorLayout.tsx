interface Props {
  children: React.ReactNode;
}

export default function CalculatorLayout({ children }: Props) {
  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
      {children}
    </div>
  );
}
