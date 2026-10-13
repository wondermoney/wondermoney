export default function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-muted grid min-h-dvh grid-cols-1 grid-rows-[min-content_auto] pb-16 lg:grid-cols-[14rem_auto] lg:pb-0">
      {children}
    </div>
  );
}
