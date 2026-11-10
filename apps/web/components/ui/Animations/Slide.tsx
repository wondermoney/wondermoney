"use client";

import { PropsWithChildren } from "react";

import { cn } from "@/lib/utils";

const Slide = ({
  isOpen,
  children,
  classname,
}: PropsWithChildren<{ isOpen: boolean; classname?: string }>) => {
  const slideClasses = cn(
    "fixed bottom-0 left-0 right-0 z-10 transition-transform duration-300",
    {
      "translate-y-0": isOpen,
      "translate-y-full": !isOpen,
    },
    classname,
  );

  // Closed, the panel sits below the viewport but stays mounted; inert keeps its
  // controls out of the tab order and the accessibility tree.
  return (
    <div className={slideClasses} inert={!isOpen}>
      {children}
    </div>
  );
};

export default Slide;
