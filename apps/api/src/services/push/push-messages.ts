import { SupportedLanguages } from '@entity/Appuser';
import { BankSyncAlertEventType } from '@entity/BankSyncAlertDelivery';

import type { PushCategory } from './push-preference.service';

/**
 * What a push notification is about. The worker turns it into text in the recipient's language
 * when it sends, so a notification queued before the person changed language still reads right.
 *
 * Push text shows on a lock screen, so it never carries an amount, a balance or a merchant: a budget
 * alert names the budget's category ("Your budget Groceries is over plan"), a card reminder says
 * when it is due, a bank alert says a connection needs attention. The figures are in the app.
 */
export interface PushBudgetCrossing {
  budgetKey: number;
  /** The budgeted category's name, as the household named it. */
  categoryName: string;
  month: number;
  state: 'at_limit' | 'near' | 'over';
  year: number;
}

export type PushLanguage = 'en' | 'es' | 'pt';

export type PushNotification =
  | { accountKey: number; daysUntilDue: number; kind: 'credit_card_due' }
  | { budgets: PushBudgetCrossing[]; kind: 'budget_alert' }
  | { event: BankSyncAlertEventType; kind: 'bank_sync_alert' }
  | { kind: 'test' };

export interface RenderedPush {
  body: string;
  /** `url` is an in-app path (Expo Router) the app opens when the notification is tapped. */
  data: { url: string };
  title: string;
}

/** The category whose switch gates a notification; the test notification has none. */
export function pushCategoryOf(notification: PushNotification): null | PushCategory {
  switch (notification.kind) {
    case 'bank_sync_alert':
      return 'bankSyncAlerts';
    case 'budget_alert':
      return 'budgetAlerts';
    case 'credit_card_due':
      return 'creditCardDueReminders';
    case 'test':
      return null;
  }
}

/**
 * The recipient's language, picked as the emails pick it: from the person's account language,
 * English for anything without a translation. Every push text has English, Portuguese and Spanish
 * copy, so an `ES` account reads Spanish.
 */
interface Copy {
  bank: { body: Record<BankSyncAlertEventType, string>; title: string };
  budget: { many: (count: number) => string; one: Record<PushBudgetCrossing['state'], (name: string) => string>; title: string };
  card: { body: (days: number) => string; title: string };
  test: { body: string; title: string };
}

export function pushLanguageFor(language: string | SupportedLanguages | undefined): PushLanguage {
  const value = (language ?? '').toLowerCase();
  if (value === SupportedLanguages.PT.toLowerCase()) return 'pt';
  if (value === 'es') return 'es';
  return 'en';
}

const COPY: Record<PushLanguage, Copy> = {
  en: {
    bank: {
      body: {
        [BankSyncAlertEventType.CONSENT_EXPIRING_1D]: 'A bank connection expires tomorrow. Renew it to keep syncing.',
        [BankSyncAlertEventType.CONSENT_EXPIRING_7D]: 'A bank connection expires in 7 days. Renew it to keep syncing.',
        [BankSyncAlertEventType.CONSENT_REVOKED]: 'The bank ended a bank connection. Reconnect it to keep syncing.',
        [BankSyncAlertEventType.SYNC_FAILING]: 'A bank connection has stopped syncing. Open the app to check it.',
      },
      title: 'Bank connection',
    },
    budget: {
      many: (count) => `${count} budgets need a look.`,
      one: {
        at_limit: (name) => `Your budget ${name} has reached its limit.`,
        near: (name) => `Your budget ${name} is close to its limit.`,
        over: (name) => `Your budget ${name} is over plan.`,
      },
      title: 'Budget alert',
    },
    card: {
      body: (days) => (days <= 0 ? 'A card payment is due today.' : days === 1 ? 'A card payment is due tomorrow.' : `A card payment is due in ${days} days.`),
      title: 'Card payment due',
    },
    test: { body: 'Push notifications are working on this phone.', title: 'Test notification' },
  },
  es: {
    bank: {
      body: {
        [BankSyncAlertEventType.CONSENT_EXPIRING_1D]: 'Una conexión bancaria caduca mañana. Renuévala para seguir sincronizando.',
        [BankSyncAlertEventType.CONSENT_EXPIRING_7D]: 'Una conexión bancaria caduca dentro de 7 días. Renuévala para seguir sincronizando.',
        [BankSyncAlertEventType.CONSENT_REVOKED]: 'El banco ha cerrado una conexión bancaria. Vuelve a conectarla para seguir sincronizando.',
        [BankSyncAlertEventType.SYNC_FAILING]: 'Una conexión bancaria ha dejado de sincronizar. Abre la app para revisarla.',
      },
      title: 'Conexión bancaria',
    },
    budget: {
      many: (count) => `${count} presupuestos necesitan tu atención.`,
      one: {
        at_limit: (name) => `Tu presupuesto ${name} ha alcanzado el límite.`,
        near: (name) => `Tu presupuesto ${name} está cerca del límite.`,
        over: (name) => `Tu presupuesto ${name} ha superado lo previsto.`,
      },
      title: 'Alerta de presupuesto',
    },
    card: {
      body: (days) => (days <= 0 ? 'Un pago de tarjeta vence hoy.' : days === 1 ? 'Un pago de tarjeta vence mañana.' : `Un pago de tarjeta vence dentro de ${days} días.`),
      title: 'Pago de tarjeta',
    },
    test: { body: 'Las notificaciones push funcionan en este teléfono.', title: 'Notificación de prueba' },
  },
  pt: {
    bank: {
      body: {
        [BankSyncAlertEventType.CONSENT_EXPIRING_1D]: 'Uma ligação bancária expira amanhã. Renova-a para continuar a sincronizar.',
        [BankSyncAlertEventType.CONSENT_EXPIRING_7D]: 'Uma ligação bancária expira daqui a 7 dias. Renova-a para continuar a sincronizar.',
        [BankSyncAlertEventType.CONSENT_REVOKED]: 'O banco terminou uma ligação bancária. Volta a ligá-la para continuar a sincronizar.',
        [BankSyncAlertEventType.SYNC_FAILING]: 'Uma ligação bancária deixou de sincronizar. Abre a app para a verificar.',
      },
      title: 'Ligação bancária',
    },
    budget: {
      many: (count) => `${count} orçamentos precisam de atenção.`,
      one: {
        at_limit: (name) => `O teu orçamento ${name} atingiu o limite.`,
        near: (name) => `O teu orçamento ${name} está perto do limite.`,
        over: (name) => `O teu orçamento ${name} ultrapassou o plano.`,
      },
      title: 'Alerta de orçamento',
    },
    card: {
      body: (days) => (days <= 0 ? 'Um pagamento de cartão vence hoje.' : days === 1 ? 'Um pagamento de cartão vence amanhã.' : `Um pagamento de cartão vence daqui a ${days} dias.`),
      title: 'Pagamento do cartão',
    },
    test: { body: 'As notificações push estão a funcionar neste telemóvel.', title: 'Notificação de teste' },
  },
};

/** A category name is the household's own text: bounded so a long one cannot crowd out the sentence. */
const shortName = (name: string) => {
  const trimmed = name.trim().replace(/\s+/gu, ' ');
  return trimmed.length > 40 ? `${trimmed.slice(0, 39)}…` : trimmed;
};

export function renderPush(notification: PushNotification, language: PushLanguage): RenderedPush {
  const copy = COPY[language];
  switch (notification.kind) {
    case 'bank_sync_alert':
      return { body: copy.bank.body[notification.event], data: { url: '/more/banking' }, title: copy.bank.title };
    case 'budget_alert': {
      const [first, ...rest] = notification.budgets;
      const sameMonthOfOneBudget = first !== undefined && rest.every((crossing) => crossing.budgetKey === first.budgetKey && crossing.year === first.year && crossing.month === first.month);
      const url = first && sameMonthOfOneBudget ? `/budgets/${first.budgetKey}/${first.year}/${first.month}` : '/budgets';
      const body = first && rest.length === 0 ? copy.budget.one[first.state](shortName(first.categoryName)) : copy.budget.many(notification.budgets.length);
      return { body, data: { url }, title: copy.budget.title };
    }
    case 'credit_card_due':
      return { body: copy.card.body(notification.daysUntilDue), data: { url: `/accounts/${notification.accountKey}` }, title: copy.card.title };
    case 'test':
      return { body: copy.test.body, data: { url: '/settings/notifications' }, title: copy.test.title };
  }
}
