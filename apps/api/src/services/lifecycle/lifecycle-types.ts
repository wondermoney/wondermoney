/**
 * Shared lifecycle enums, kept free of ORM decorators so pure logic (campaign
 * eligibility, frequency cap) can import them without pulling in the entity /
 * database layer. The `LifecycleDelivery` entity re-uses these same values.
 */

/**
 * Only `DATA_HEALTH` is a live campaign. The other members are the retired
 * marketing campaigns; they stay so existing `lifecycle_delivery` rows still
 * hydrate.
 */
export enum LifecycleCampaign {
  ACTIVATION = 'activation',
  DATA_HEALTH = 'data_health',
  ENGAGEMENT = 'engagement',
  REACTIVATION = 'reactivation',
}

export enum LifecycleDeliveryStatus {
  CLAIMED = 'claimed',
  FAILED = 'failed',
  NEEDS_RECONCILIATION = 'needs_reconciliation',
  PENDING = 'pending',
  SENT = 'sent',
  SUPPRESSED = 'suppressed',
}
