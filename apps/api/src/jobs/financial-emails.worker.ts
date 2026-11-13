import type { Job } from 'pg-boss';

import { handleFinancialEmailCoordinator } from '@app/jobs/financial-emails.coordinator';
import type { FinancialEmailCoordinatorPayload, FinancialEmailUserPayload } from '@app/jobs/financial-emails.queue';
import { validateFinancialEmailUserPayload } from '@app/jobs/financial-emails.queue';
import { parseScheduledFor } from '@service/budget/aggregation-periods';
import { FinancialEmailUserWorkerService } from '@service/email/financial-email-user-worker.service';
import { BudgetPushNotifier } from '@service/push/budget-push';
import type { Enqueue } from '@service/queue/enqueue';
import type { PartialBossLike } from '@service/queue/enqueue';

type BossSend = Pick<PartialBossLike, 'send' | 'sendAfter'>;

export const handleBudgetEmailCoordinator = (job: Job<Partial<FinancialEmailCoordinatorPayload>>, boss: BossSend) => handleFinancialEmailCoordinator(job, 'budget', { boss });
export const handleWeeklyEmailCoordinator = (job: Job<Partial<FinancialEmailCoordinatorPayload>>, boss: BossSend) => handleFinancialEmailCoordinator(job, 'weekly', { boss });
export const handleMonthlyStoryEmailCoordinator = (job: Job<Partial<FinancialEmailCoordinatorPayload>>, boss: BossSend) => handleFinancialEmailCoordinator(job, 'monthlyStory', { boss });

export async function handleFinancialEmailUser(job: Job<FinancialEmailUserPayload>, stream: 'budget' | 'monthlyStory' | 'weekly', service = new FinancialEmailUserWorkerService()) {
  validateFinancialEmailUserPayload(job.data);
  parseScheduledFor(job.data.scheduledFor);
  const result = await service.process({ appuserKey: job.data.appuserKey, scheduledFor: job.data.scheduledFor, stream });
  if (result.result === 'retryable_failed') throw new Error('financial_email_retryable_failed');
  return result;
}

/** The budget stream, which also pushes budget alerts to the people who turned that on. */
export const handleBudgetEmailUser = (job: Job<FinancialEmailUserPayload>, enqueue: Enqueue) =>
  handleFinancialEmailUser(job, 'budget', new FinancialEmailUserWorkerService({ budgetPush: new BudgetPushNotifier({ enqueue }) }));
