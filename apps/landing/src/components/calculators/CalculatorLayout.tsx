interface Props {
  children: React.ReactNode;
}

export default function CalculatorLayout({ children }: Props) {
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_1fr] lg:items-start">
      {children}
    </div>
  );
}
