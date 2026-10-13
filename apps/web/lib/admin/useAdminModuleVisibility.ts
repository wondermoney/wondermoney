"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

import { type InstanceDescription, useInstance } from "@/lib/api/instance/useInstance";
import { instanceConfig } from "@/lib/instance";

import { isInstanceAdminEmail } from "./access";
import {
  ADMIN_MODULE_VISIBILITY_STORAGE_KEY,
  type AdminModuleId,
  type AdminModuleVisibility,
  createDefaultAdminModuleVisibility,
  createHiddenAdminModuleVisibility,
  createVisibleAdminModuleVisibility,
  normalizeAdminModuleVisibility,
  serializeAdminModuleVisibility,
} from "./module-visibility";

type AdminModuleVisibilitySnapshot = {
  hasLoaded: boolean;
  visibility: AdminModuleVisibility;
};

const listeners = new Set<() => void>();

let snapshot: AdminModuleVisibilitySnapshot = {
  hasLoaded: false,
  visibility: createDefaultAdminModuleVisibility(),
};

const serverSnapshot: AdminModuleVisibilitySnapshot = {
  hasLoaded: false,
  visibility: createDefaultAdminModuleVisibility(),
};

function emitVisibilityChange() {
  for (const listener of listeners) {
    listener();
  }
}

function readBrowserVisibility(): AdminModuleVisibility {
  try {
    return normalizeAdminModuleVisibility(
      window.localStorage.getItem(ADMIN_MODULE_VISIBILITY_STORAGE_KEY),
    );
  } catch {
    return createDefaultAdminModuleVisibility();
  }
}

function loadBrowserVisibility() {
  if (snapshot.hasLoaded || typeof window === "undefined") return;

  snapshot = {
    hasLoaded: true,
    visibility: readBrowserVisibility(),
  };
  emitVisibilityChange();
}

function setBrowserVisibility(nextVisibility: AdminModuleVisibility) {
  snapshot = {
    hasLoaded: true,
    visibility: nextVisibility,
  };

  try {
    window.localStorage.setItem(
      ADMIN_MODULE_VISIBILITY_STORAGE_KEY,
      serializeAdminModuleVisibility(nextVisibility),
    );
  } catch {
    // Keep the in-memory QA preference even if localStorage is unavailable.
  }

  emitVisibilityChange();
}

function subscribeToAdminModuleVisibility(onStoreChange: () => void) {
  listeners.add(onStoreChange);
  loadBrowserVisibility();

  return () => {
    listeners.delete(onStoreChange);
  };
}

function getAdminModuleVisibilitySnapshot() {
  return snapshot;
}

function getServerAdminModuleVisibilitySnapshot(): AdminModuleVisibilitySnapshot {
  return serverSnapshot;
}

export function useAdminModuleVisibility(
  email?: null | string,
  emailConfirmedAt?: null | string,
) {
  const isAdmin = isInstanceAdminEmail(email, emailConfirmedAt);
  const { hasLoaded, visibility } = useSyncExternalStore(
    subscribeToAdminModuleVisibility,
    getAdminModuleVisibilitySnapshot,
    getServerAdminModuleVisibilitySnapshot,
  );

  useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key !== ADMIN_MODULE_VISIBILITY_STORAGE_KEY) return;

      snapshot = {
        hasLoaded: true,
        visibility: normalizeAdminModuleVisibility(event.newValue),
      };
      emitVisibilityChange();
    };

    window.addEventListener("storage", handleStorageChange);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
    };
  }, []);

  useEffect(() => {
    if (isAdmin) {
      loadBrowserVisibility();
    }
  }, [isAdmin]);

  const persistVisibility = useCallback(
    (nextVisibility: AdminModuleVisibility) => {
      if (!isAdmin) return;
      setBrowserVisibility(nextVisibility);
    },
    [isAdmin],
  );

  const setModuleVisible = useCallback(
    (moduleId: AdminModuleId, visible: boolean) => {
      persistVisibility({
        ...visibility,
        [moduleId]: visible,
      });
    },
    [persistVisibility, visibility],
  );

  const showAllAdminModules = useCallback(() => {
    persistVisibility(createVisibleAdminModuleVisibility());
  }, [persistVisibility]);

  const viewAsRegularUser = useCallback(() => {
    persistVisibility(createHiddenAdminModuleVisibility());
  }, [persistVisibility]);

  const { data: instance } = useInstance();

  /**
   * A module needs its backing feature on the server (market data, the assistant model).
   * Beyond that, an instance with an admin domain (the hosted one) keeps these modules as
   * staff-only previews that admins toggle; an instance without one shows them to everyone.
   */
  const isModuleVisible = useCallback(
    (moduleId: AdminModuleId) => {
      if (!isModuleSupported(moduleId, instance?.features)) return false;
      if (instanceConfig.adminEmailDomain === null) return true;
      return isAdmin && hasLoaded && visibility[moduleId];
    },
    [hasLoaded, instance?.features, isAdmin, visibility],
  );

  return useMemo(
    () => ({
      isAdmin,
      hasLoaded,
      visibility,
      isModuleVisible,
      setModuleVisible,
      showAllAdminModules,
      viewAsRegularUser,
    }),
    [
      isAdmin,
      hasLoaded,
      visibility,
      isModuleVisible,
      setModuleVisible,
      showAllAdminModules,
      viewAsRegularUser,
    ],
  );
}

/** Whether the server has what a module needs. Unknown (still loading) counts as supported. */
export function isModuleSupported(
  moduleId: AdminModuleId,
  features: InstanceDescription["features"] | undefined,
): boolean {
  if (!features) return true;
  if (moduleId === "financialMarkets") return features.marketData;
  if (moduleId === "assistant") return features.ai.assistant;
  return true;
}
