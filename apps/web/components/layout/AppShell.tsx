"use client";

import type { ReactNode } from "react";

import FullLayoutClientOverlays from "@/app/[locale]/(full-layout)/FullLayoutClientOverlays";
import BottomNav from "@/components/layout/BottomNav";
import CommandPalette from "@/components/layout/CommandPalette";
import DemoBanner from "@/components/layout/DemoBanner";
import { PrivacyModeShortcut } from "@/components/layout/PrivacyModeToggle";
import Sidebar from "@/components/layout/Sidebar";
import TopBar from "@/components/layout/TopBar";
import useConfigs from "@/lib/api/configs/useConfigs";

/**
 * The signed-in product shell: the grouped sidebar beside one capped content
 * column on desktop; under `lg`, a slim top bar and the bottom tab bar.
 */
export default function AppShell({ children }: { children: ReactNode }) {
  useConfigs();

  return (
    <div className="bg-background min-h-dvh pb-16 lg:flex lg:pb-0">
      <Sidebar />
      <div className="min-w-0 flex-1">
        {/* Above the top bar, which then sticks once the page scrolls past it. */}
        <DemoBanner />
        <TopBar />
        {/* pb-20 on mobile: the assistant launcher is fixed at bottom-24 above
            the 64px bottom tab bar, so the last row of a page must clear both. */}
        <main className="mx-auto w-full max-w-[85rem] px-4 pt-6 pb-20 lg:px-10 lg:pt-10 lg:pb-16">
          {children}
        </main>
      </div>
      <BottomNav />
      <FullLayoutClientOverlays />
      <CommandPalette />
      <PrivacyModeShortcut />
    </div>
  );
}
