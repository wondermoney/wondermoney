export function hasInstitutionTechnicalError(syncError?: string | null) {
  return syncError === "InstitutionTechnicalError";
}
