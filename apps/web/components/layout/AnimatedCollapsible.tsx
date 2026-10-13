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

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{
            height: "auto",
            opacity: 1,
            transition: {
              height: { duration: 0.3, ease: "easeInOut" },
              opacity: { duration: 0.2, delay: 0.05 },
            },
          }}
          exit={{
            height: 0,
            opacity: 0,
            transition: {
              height: { duration: 0.3, ease: "easeInOut" },
              opacity: { duration: 0.2 },
            },
          }}
          className={cn("overflow-hidden", className)}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default AnimatedCollapsible;
