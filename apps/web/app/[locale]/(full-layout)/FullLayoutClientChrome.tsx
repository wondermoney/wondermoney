"use client";

import BottomNav from "@/components/layout/BottomNav";
import Sidebar from "@/components/layout/Sidebar";
import useConfigs from "@/lib/api/configs/useConfigs";

export default function FullLayoutClientChrome() {
  useConfigs();

  return (
    <>
      <Sidebar />
      <BottomNav />
    </>
  );
}
