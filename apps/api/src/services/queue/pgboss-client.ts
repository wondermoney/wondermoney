import { PgBoss } from 'pg-boss';

import { buildPgBossConfig } from '@app/jobs/pgboss.config';

export type PgBossLike = Pick<
  PgBoss,
  'createQueue' | 'deleteQueue' | 'findJobs' | 'on' | 'schedule' | 'send' | 'sendAfter' | 'start' | 'stop' | 'unschedule' | 'work'
>;

/** Small producer-side surface needed by registered queue ensure helpers. */
export type PgBossSendAfterLike = Required<Pick<PgBossLike, 'sendAfter'>>;

export type ProducerOperations = Pick<PgBoss, 'createQueue' | 'updateQueue'>;

export const createPgBossClient = (): PgBossLike => {
  const boss = new PgBoss(buildPgBossConfig());
  return boss;
};
