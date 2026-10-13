export default function Container({ children }: { children: React.ReactNode }) {
  return (
    <main className="col-start-1 col-end-1 row-start-2 row-end-2 flex min-w-0 flex-1 lg:col-start-2 lg:col-end-2 lg:px-2 lg:pt-2 lg:pb-2">
      {/* pb-20 on mobile, not pb-4: AssistantLauncher is fixed at `bottom-24`
          and stands ~44px tall, so it covers 96–140px up from the viewport
          bottom. Wrapper's pb-16 only clears the 64px BottomNav, which left the
          launcher sitting on top of the last card on every page — it covered
          the savings-rate figure on the accounts empty state and the final
          account row on home. The padding goes here rather than on Wrapper so
          the bg-background card still runs down to the nav; widening Wrapper's
          padding instead would open a muted strip above it. */}
      <div className="bg-background lg:ring-border h-full grow px-4 pt-4 pb-20 lg:rounded-lg lg:p-6 lg:shadow-xs lg:ring-1">
        {children}
      </div>
    </main>
  );
}
