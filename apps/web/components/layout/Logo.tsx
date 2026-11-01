"use client";

import Image from "next/image";

import { useInstanceName } from "@/components/instance/InstanceNameProvider";
import { Link as Linki18n } from "@/components/ui/Link";
import { isDefaultInstanceName } from "@/lib/instance-name";
import { cn } from "@/lib/utils";

/**
 * The instance's name as text, for an instance that renamed itself: the WonderMoney wordmark
 * would name the wrong server.
 */
export function InstanceNameWordmark({
  className,
  name,
}: {
  className?: string;
  name: string;
}) {
  return (
    <span
      className={cn(
        "text-primary truncate text-2xl leading-none font-bold tracking-tight",
        className,
      )}
    >
      {name}
    </span>
  );
}

export default function Logo({ className }: { className?: string } = {}) {
  const instanceName = useInstanceName();

  if (!isDefaultInstanceName(instanceName)) {
    return (
      <Linki18n
        href="/"
        className={cn(
          "flex h-[54px] max-w-full cursor-pointer items-center bg-transparent",
          className,
        )}
      >
        <InstanceNameWordmark name={instanceName} />
      </Linki18n>
    );
  }

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
        alt={instanceName}
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
