"use client";

import Image from "next/image";

import { Link as Linki18n } from "@/components/ui/Link";
import { cn } from "@/lib/utils";

export default function Logo({ className }: { className?: string } = {}) {
  return (
    <Linki18n
      href="/"
      className={cn(
        "relative flex h-[54px] w-[146px] cursor-pointer justify-center bg-transparent",
        className,
      )}
    >
      {/* One wordmark per theme: each matches that mode's --primary. A single
          flat asset cannot serve both — the light violet drops to 2.16:1 on the
          dark shell, under the 3:1 minimum for a graphical object. */}
      <Image
        priority
        src="/logo.png"
        alt="WonderMoney"
        fill
        sizes="146px"
        className="dark:hidden"
      />
      <Image
        priority
        src="/logo-dark.png"
        alt=""
        aria-hidden
        fill
        sizes="146px"
        className="hidden dark:block"
      />
    </Linki18n>
  );
}
