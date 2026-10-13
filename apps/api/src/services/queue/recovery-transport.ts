import type { PgBoss } from 'pg-boss';

/** Narrow pg-boss surface shared by borrowed recovery transports and owned producers. */
export type RecoveryTransport = Partial<Pick<PgBoss, 'updateQueue'>> & Pick<PgBoss, 'createQueue' | 'findJobs' | 'send'>;
