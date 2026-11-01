"use client";

import { createContext, type ReactNode, useContext } from "react";

import { DEFAULT_INSTANCE_NAME } from "@/lib/instance-name";

const InstanceNameContext = createContext<string>(DEFAULT_INSTANCE_NAME);

/**
 * Hands the instance name, read on the server, to client components, so the wordmark and the
 * headings render with it on the first paint instead of waiting for `/v1/instance`.
 */
export function InstanceNameProvider({
  children,
  name,
}: {
  children: ReactNode;
  name: string;
}) {
  return (
    <InstanceNameContext.Provider value={name}>
      {children}
    </InstanceNameContext.Provider>
  );
}

/** The instance's name; the default outside the provider (the global error page). */
export const useInstanceName = (): string => useContext(InstanceNameContext);
