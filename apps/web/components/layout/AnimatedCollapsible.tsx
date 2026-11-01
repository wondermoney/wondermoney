"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface AnimatedCollapsibleProps {
  open: boolean;
  children: ReactNode;
  className?: string;
}

const AnimatedCollapsible = ({
  open,
  children,
  className,
}: AnimatedCollapsibleProps) => {
  const shouldReduceMotion = useReducedMotion();

  if (shouldReduceMotion) {
    return open ? (
      <div className={cn("overflow-hidden", className)}>{children}</div>
    ) : null;
  }

  // grid-template-rows 0fr -> 1fr opens to the content's natural size without
  // animating `height` (the Hallmark Floor bans height, width, top and left).
  // The inner wrapper's `min-h-0` lets the 0fr track actually collapse.
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          initial={{ gridTemplateRows: "0fr", opacity: 0 }}
          animate={{
            gridTemplateRows: "1fr",
            opacity: 1,
            transition: {
              gridTemplateRows: { duration: 0.2, ease: [0.16, 1, 0.3, 1] },
              opacity: { duration: 0.12 },
            },
          }}
          exit={{
            gridTemplateRows: "0fr",
            opacity: 0,
            transition: {
              gridTemplateRows: { duration: 0.2, ease: [0.65, 0, 0.35, 1] },
              opacity: { duration: 0.12 },
            },
          }}
          className={cn("grid", className)}
        >
          <div className="min-h-0 overflow-hidden">
            {children}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default AnimatedCollapsible;
