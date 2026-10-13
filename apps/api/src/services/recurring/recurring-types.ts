export enum RecurringAmountType {
  fixed = 'fixed',
  variable = 'variable',
}

export enum RecurringCadence {
  biweekly = 'biweekly',
  monthly = 'monthly',
  quarterly = 'quarterly',
  weekly = 'weekly',
  yearly = 'yearly',
}

export enum RecurringOccurrenceMatchStatus {
  manual_added = 'manual_added',
  manual_removed = 'manual_removed',
  matched = 'matched',
  missed = 'missed',
  predicted = 'predicted',
}

export enum RecurringSeriesSource {
  detected = 'detected',
  user_created = 'user_created',
}

export enum RecurringSeriesStatus {
  candidate = 'candidate',
  confirmed = 'confirmed',
  dismissed = 'dismissed',
  ended = 'ended',
  paused = 'paused',
}

export enum RecurringSeriesType {
  bill = 'bill',
  subscription = 'subscription',
}
