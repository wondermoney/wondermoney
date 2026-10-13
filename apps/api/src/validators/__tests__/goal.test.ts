import { describe, expect, it } from 'vitest';

import {
  assignGoalMoneyRequestSchema,
  createGoalRequestSchema,
  fundGoalTransactionRequestSchema,
  goalAccountLinkRequestSchema,
  goalActivityQueryRequestSchema,
  goalParamsRequestSchema,
  listGoalsRequestSchema,
  moveGoalMoneyOutRequestSchema,
  undoGoalTransactionFundingRequestSchema,
  unlinkGoalAccountRequestSchema,
  updateGoalRequestSchema,
} from '../goal';

describe('goal validators', () => {
  it('rejects negative target amounts on create', () => {
    expect(
      createGoalRequestSchema.safeParse({
        body: {
          currencyId: 1,
          name: 'Emergency fund',
          targetAmount: -1,
        },
      }).success,
    ).toBe(false);
  });

  it('accepts a minimal valid create payload', () => {
    expect(
      createGoalRequestSchema.safeParse({
        body: {
          name: 'Emergency fund',
          targetAmount: 1000,
        },
      }).success,
    ).toBe(true);
  });

  it('validates goal names, descriptions, and currency IDs', () => {
    expect(
      createGoalRequestSchema.safeParse({
        body: {
          currencyId: 1,
          name: '',
          targetAmount: 1000,
        },
      }).success,
    ).toBe(false);

    expect(
      createGoalRequestSchema.safeParse({
        body: {
          currencyId: 1,
          name: 'x'.repeat(101),
          targetAmount: 1000,
        },
      }).success,
    ).toBe(false);

    expect(
      createGoalRequestSchema.safeParse({
        body: {
          currencyId: 1,
          description: 'x'.repeat(501),
          name: 'Emergency fund',
          targetAmount: 1000,
        },
      }).success,
    ).toBe(false);

    expect(
      createGoalRequestSchema.safeParse({
        body: {
          currencyId: null,
          description: null,
          name: 'Emergency fund',
          targetAmount: 1000,
        },
      }).success,
    ).toBe(false);

    const result = createGoalRequestSchema.parse({
      body: {
        description: null,
        name: 'Emergency fund',
        targetAmount: 1000,
      },
    });

    expect(result.body.description).toBeNull();
  });

  it('allows omitted create currencyId', () => {
    expect(
      createGoalRequestSchema.safeParse({
        body: {
          name: 'Emergency fund',
          targetAmount: 1000,
        },
      }).success,
    ).toBe(true);
  });

  it('validates update payloads without accepting invalid money values', () => {
    expect(
      updateGoalRequestSchema.safeParse({
        body: {
          monthlyContributionTarget: 'Infinity',
          targetAmount: true,
        },
        params: {
          goalKey: '42',
        },
      }).success,
    ).toBe(false);

    const result = updateGoalRequestSchema.parse({
      body: {
        monthlyContributionTarget: '25.5',
        targetAmount: '1000',
      },
      params: {
        goalKey: '42',
      },
    });

    expect(result).toMatchObject({
      body: {
        monthlyContributionTarget: 25.5,
        targetAmount: 1000,
      },
      params: {
        goalKey: 42,
      },
    });
  });

  it('accepts a valid debt paydown create payload and coerces its fields', () => {
    const result = createGoalRequestSchema.parse({
      body: {
        annualInterestRatePercent: '19.99',
        currentBalance: '12000',
        extraPayment: 100,
        minimumPayment: 250,
        name: 'Pay off Visa',
        type: 'debt_paydown',
      },
    });

    expect(result.body).toMatchObject({
      annualInterestRatePercent: 19.99,
      currentBalance: 12000,
      minimumPayment: 250,
      type: 'debt_paydown',
    });
  });

  it('requires balance, interest, and minimum payment for debt paydown goals', () => {
    expect(
      createGoalRequestSchema.safeParse({
        body: { name: 'Pay off Visa', type: 'debt_paydown' },
      }).success,
    ).toBe(false);
  });

  it('rejects out-of-range interest rates on debt paydown goals', () => {
    expect(
      createGoalRequestSchema.safeParse({
        body: {
          annualInterestRatePercent: 1500,
          currentBalance: 12000,
          minimumPayment: 250,
          name: 'Pay off Visa',
          type: 'debt_paydown',
        },
      }).success,
    ).toBe(false);
  });

  it('defaults goal type to save_up and keeps requiring targetAmount', () => {
    expect(createGoalRequestSchema.parse({ body: { name: 'Emergency fund', targetAmount: 1000 } }).body.type).toBe('save_up');
    expect(createGoalRequestSchema.safeParse({ body: { name: 'Emergency fund' } }).success).toBe(false);
  });

  it('accepts priority 0-2 on create and rejects out-of-range values', () => {
    for (const priority of [0, 1, 2]) {
      expect(
        createGoalRequestSchema.safeParse({
          body: {
            name: 'Emergency fund',
            priority,
            targetAmount: 1000,
          },
        }).success,
      ).toBe(true);
    }

    for (const priority of [-1, 3, 1.5, '1']) {
      expect(
        createGoalRequestSchema.safeParse({
          body: {
            name: 'Emergency fund',
            priority,
            targetAmount: 1000,
          },
        }).success,
      ).toBe(false);
    }
  });

  it('accepts priority on update payloads', () => {
    const result = updateGoalRequestSchema.parse({
      body: {
        priority: 2,
      },
      params: {
        goalKey: '42',
      },
    });

    expect(result.body.priority).toBe(2);
  });

  it('coerces goal params to numbers', () => {
    const result = goalParamsRequestSchema.parse({
      params: {
        goalKey: '42',
      },
    });

    expect(result.params.goalKey).toBe(42);

    expect(
      goalParamsRequestSchema.safeParse({
        params: {
          goalKey: 0,
        },
      }).success,
    ).toBe(false);
  });

  it('rejects zero or negative amount when funding with a transaction', () => {
    expect(
      fundGoalTransactionRequestSchema.safeParse({
        body: {
          amount: 0,
          transactionKey: 10,
        },
        params: {
          goalKey: 1,
        },
      }).success,
    ).toBe(false);

    expect(
      fundGoalTransactionRequestSchema.safeParse({
        body: {
          amount: -1,
          transactionKey: 10,
        },
        params: {
          goalKey: 1,
        },
      }).success,
    ).toBe(false);

    expect(
      fundGoalTransactionRequestSchema.safeParse({
        body: {
          amount: Infinity,
          transactionKey: 10,
        },
        params: {
          goalKey: 1,
        },
      }).success,
    ).toBe(false);

    expect(
      fundGoalTransactionRequestSchema.safeParse({
        body: {
          amount: true,
          transactionKey: 10,
        },
        params: {
          goalKey: 1,
        },
      }).success,
    ).toBe(false);
  });

  it('defaults activity query pagination', () => {
    expect(goalActivityQueryRequestSchema.parse({ params: { goalKey: '3' }, query: {} }).params.goalKey).toBe(3);
    expect(goalActivityQueryRequestSchema.parse({ params: { goalKey: '3' }, query: {} }).query).toEqual({
      limit: 25,
      offset: 0,
    });
  });

  it('defaults list goals archived filter to false', () => {
    expect(listGoalsRequestSchema.parse({ query: {} }).query.includeArchived).toBe(false);
    expect(listGoalsRequestSchema.parse({ query: { includeArchived: 'true' } }).query.includeArchived).toBe(true);
    expect(listGoalsRequestSchema.parse({ query: { includeArchived: 'false' } }).query.includeArchived).toBe(false);
    expect(listGoalsRequestSchema.parse({ query: { includeArchived: true } }).query.includeArchived).toBe(true);
    expect(listGoalsRequestSchema.safeParse({ query: { includeArchived: 'nope' } }).success).toBe(false);
  });

  it('rejects empty targetDate strings and accepts future dates', () => {
    expect(
      createGoalRequestSchema.safeParse({
        body: {
          currencyId: 1,
          name: 'Emergency fund',
          targetAmount: 1000,
          targetDate: '',
        },
      }).success,
    ).toBe(false);

    expect(
      createGoalRequestSchema.safeParse({
        body: {
          currencyId: 1,
          name: 'Emergency fund',
          targetAmount: 1000,
          targetDate: 'not-a-date',
        },
      }).success,
    ).toBe(false);

    expect(
      createGoalRequestSchema.safeParse({
        body: {
          currencyId: 1,
          name: 'Emergency fund',
          targetAmount: 1000,
          targetDate: '2000-01-01T00:00:00.000Z',
        },
      }).success,
    ).toBe(false);

    const result = createGoalRequestSchema.parse({
      body: {
        currencyId: 1,
        name: 'Emergency fund',
        targetAmount: 1000,
        targetDate: '2099-01-01T00:00:00.000Z',
      },
    });

    expect(result.body.targetDate).toBeInstanceOf(Date);
  });

  it('accepts a null target date when updating a goal', () => {
    const result = updateGoalRequestSchema.parse({
      body: {
        targetDate: null,
      },
      params: {
        goalKey: 3,
      },
    });

    expect(result.body.targetDate).toBeNull();
  });

  it('validates monthly contribution target semantics', () => {
    expect(
      createGoalRequestSchema.safeParse({
        body: {
          currencyId: 1,
          monthlyContributionTarget: null,
          name: 'Emergency fund',
          targetAmount: 1000,
        },
      }).success,
    ).toBe(true);

    expect(
      createGoalRequestSchema.safeParse({
        body: {
          currencyId: 1,
          monthlyContributionTarget: 0,
          name: 'Emergency fund',
          targetAmount: 1000,
        },
      }).success,
    ).toBe(false);

    expect(
      createGoalRequestSchema.safeParse({
        body: {
          currencyId: 1,
          monthlyContributionTarget: -1,
          name: 'Emergency fund',
          targetAmount: 1000,
        },
      }).success,
    ).toBe(false);
  });

  it('coerces assignment and move-out amounts and rejects no-op metadata keys', () => {
    expect(
      assignGoalMoneyRequestSchema.parse({
        body: {
          amount: 10,
        },
        params: {
          goalKey: 1,
        },
      }).body,
    ).toEqual({
      amount: 10,
    });

    expect(
      assignGoalMoneyRequestSchema.safeParse({
        body: {
          amount: '10.5',
          budgetKey: 5,
        },
        params: {
          goalKey: '1',
        },
      }).success,
    ).toBe(false);

    expect(
      moveGoalMoneyOutRequestSchema.parse({
        body: {
          amount: 10,
        },
        params: {
          goalKey: 1,
        },
      }).body,
    ).toEqual({
      amount: 10,
    });

    expect(
      moveGoalMoneyOutRequestSchema.safeParse({
        body: {
          amount: 10,
          destinationGoalKey: 2,
        },
        params: {
          goalKey: 1,
        },
      }).success,
    ).toBe(false);
  });

  it.each([
    ['assign', assignGoalMoneyRequestSchema],
    ['move-out', moveGoalMoneyOutRequestSchema],
  ])('accepts up to four decimal places and rejects greater precision for %s amounts', (_name, schema) => {
    for (const amount of [1, 0.0001, 12.3456, '0.0001', '12.3456']) {
      expect(schema.parse({ body: { amount }, params: { goalKey: '1' } }).body.amount).toBe(Number(amount));
    }

    for (const amount of [0.00001, 12.34567, '0.00001', '12.34567', '12.34000']) {
      expect(schema.safeParse({ body: { amount }, params: { goalKey: 1 } }).success).toBe(false);
    }
  });

  it('does not apply the assign/move-out precision contract to transaction funding', () => {
    expect(
      fundGoalTransactionRequestSchema.safeParse({
        body: { amount: '1.23456', transactionKey: 10 },
        params: { goalKey: 1 },
      }).success,
    ).toBe(true);
  });

  it('supports URL-param goal funding/account unlink flows', () => {
    expect(
      undoGoalTransactionFundingRequestSchema.parse({
        params: {
          fundingKey: '9',
          goalKey: '1',
        },
      }).params,
    ).toEqual({
      fundingKey: 9,
      goalKey: 1,
    });

    expect(
      unlinkGoalAccountRequestSchema.parse({
        params: {
          accountKey: '7',
          goalKey: '1',
        },
      }).params,
    ).toEqual({
      accountKey: 7,
      goalKey: 1,
    });

    expect(
      goalAccountLinkRequestSchema.parse({
        body: {
          accountKey: 7,
        },
        params: {
          goalKey: 1,
        },
      }).body.accountKey,
    ).toBe(7);
  });
});
