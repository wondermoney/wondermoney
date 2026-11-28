/**
 * How long personal data the privacy policy names is kept once it has served its purpose: the
 * records of a household dissolved by its owner's account deletion and the anonymised account
 * record, retired Enable Banking keys, the assistant and MCP audit log, sent email and notification
 * records, delivered analytics events, receipt images sent for reading and imported portfolio
 * files. One period for all of them, so the policy and the code cannot drift apart per kind.
 * `retention-purge.service.ts` deletes each kind once it is older than this.
 */
export const PERSONAL_DATA_RETENTION_DAYS = 30;

export const PERSONAL_DATA_RETENTION_MS = PERSONAL_DATA_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** The instant before which a record has been kept for the whole retention period. */
export function retentionCutoff(now: Date): Date {
  return new Date(now.getTime() - PERSONAL_DATA_RETENTION_MS);
}
