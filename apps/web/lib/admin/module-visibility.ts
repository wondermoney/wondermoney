export const ADMIN_MODULE_VISIBILITY_STORAGE_KEY =
  "wondermoney.adminModuleVisibility.v1";

export const ADMIN_MODULE_IDS = [
  "credits",
  "goals",
  "financialMarkets",
  "recurring",
  "assistant",
] as const;

export type AdminModuleId = (typeof ADMIN_MODULE_IDS)[number];

export type AdminModuleVisibility = Record<AdminModuleId, boolean>;

export function createDefaultAdminModuleVisibility(): AdminModuleVisibility {
  return ADMIN_MODULE_IDS.reduce((visibility, moduleId) => {
    visibility[moduleId] = false;
    return visibility;
  }, {} as AdminModuleVisibility);
}

export function createHiddenAdminModuleVisibility(): AdminModuleVisibility {
  return createDefaultAdminModuleVisibility();
}

export function createVisibleAdminModuleVisibility(): AdminModuleVisibility {
  return ADMIN_MODULE_IDS.reduce((visibility, moduleId) => {
    visibility[moduleId] = true;
    return visibility;
  }, {} as AdminModuleVisibility);
}

export function normalizeAdminModuleVisibility(
  raw: null | string,
): AdminModuleVisibility {
  const visibility = createDefaultAdminModuleVisibility();

  if (!raw) return visibility;

  try {
    const parsed = JSON.parse(raw) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return visibility;
    }

    for (const moduleId of ADMIN_MODULE_IDS) {
      const storedValue = (parsed as Partial<Record<AdminModuleId, unknown>>)[
        moduleId
      ];

      if (typeof storedValue === "boolean") {
        visibility[moduleId] = storedValue;
      }
    }
  } catch {
    return visibility;
  }

  return visibility;
}

export function serializeAdminModuleVisibility(
  visibility: AdminModuleVisibility,
): string {
  const orderedVisibility = ADMIN_MODULE_IDS.reduce((ordered, moduleId) => {
    ordered[moduleId] = visibility[moduleId];
    return ordered;
  }, {} as AdminModuleVisibility);

  return JSON.stringify(orderedVisibility);
}
