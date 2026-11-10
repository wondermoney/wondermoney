import { PopulateHint, QueryOrder } from '@mikro-orm/core';
import { addMonths, subMonths } from 'date-fns';
import type { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';

import { DI } from '@app/app';
import { Account } from '@entity/Account';
import { AppuserTenant } from '@entity/AppuserTenant';
import { Budget } from '@entity/Budget';
import { BudgetTemplateCategory } from '@entity/BudgetTemplateCategory';
import { BudgetTemplateIncome } from '@entity/BudgetTemplateIncome';
import { Category } from '@entity/Category';
import type { Currency } from '@entity/Currency';
import { authedContext } from '@middleware/authed-context';
import { getBudgetForecast as forecastBudget } from '@service/budget/budget-forecast.service';
import { getMonthRollover, rolloverRowsOf, withRollover } from '@service/budget/budget-rollover.service';
import { suggestBudgetAmounts } from '@service/budget/budget-suggestions.service';
import { ensureBudgetYear } from '@service/budget/budget-year.service';
import { type BudgetSpendingCategory, getBudgetSpending } from '@service/budget/spending';
import { calculateAmountBudgeted } from '@utils/budget';
import { BadRequestError, NotFoundError } from '@utils/errors';
import {
  addBudgetCategoryRequestSchema,
  createBudgetRequestSchema,
  deleteBudgetCategoryRequestSchema,
  deleteBudgetRequestSchema,
  getBudgetForecastRequestSchema,
  getBudgetRequestSchema,
  getBudgetSuggestionsRequestSchema,
  getBudgetTemplateByYearAndMonthRequestSchema,
  getBudgetTemplateByYearRequestSchema,
  getBudgetTemplateByYearUntilMonthRequestSchema,
  removeCategoryFromBudgetRequestSchema,
  updateBudgetAccountsRequestSchema,
  updateBudgetCategoryAmountRequestSchema,
  updateBudgetRequestSchema,
  updateBudgetTemplateRequestSchema,
} from '@validators/budget';
import { zParse } from '@validators/parser';

export async function addBudgetCategory(req: Request, res: Response, next: NextFunction) {
  const {
    body: { amountBudgeted, categoryKey, recurrency },
    params: { budgetKey },
  } = await zParse(addBudgetCategoryRequestSchema, req);
  const budget = await DI.em.findOne(Budget, {
    budgetKey,
    deletedAt: undefined,
  });
  if (!budget) {
    next(new NotFoundError('Budget not found')); return;
  }
  const category = await DI.em.findOne(Category, {
    categoryKey,
    deletedAt: undefined,
  });
  if (!category) {
    next(new NotFoundError('Category not found')); return;
  }

  const currentYear = new Date().getFullYear();

  // Check if budget template already has this category for any month in the current year
  const existingCategory = await DI.em.findOne(BudgetTemplateCategory, {
    budgetKey: budget,
    categoryKey: category,
    year: currentYear,
  });
  if (existingCategory) {
    next(new BadRequestError('Category already exists in the budget template for this year')); return;
  }

  // Rows for all 12 months of this year, and of any later year the budget already has (next
  // year exists from 1 December), unless the category is already in that year.
  const laterYearRows = await DI.em.find(
    BudgetTemplateCategory,
    { budgetKey: budget, year: { $gt: currentYear } },
    { fields: ['year', 'categoryKey'] },
  );
  const laterYears = [...new Set(laterYearRows.map((row) => row.year))].filter(
    (year) => !laterYearRows.some((row) => row.year === year && row.categoryKey.categoryKey === category.categoryKey),
  );
  const budgetTemplateCategories = [];
  for (const year of [currentYear, ...laterYears]) {
    for (let month = 1; month <= 12; month++) {
      const budgetTemplateCategory = new BudgetTemplateCategory();
      budgetTemplateCategory.budgetKey = budget;
      budgetTemplateCategory.categoryKey = category;
      budgetTemplateCategory.amountBudgeted = amountBudgeted;
      budgetTemplateCategory.recurrency = recurrency || category.recurrency;
      budgetTemplateCategory.year = year;
      budgetTemplateCategory.month = month;
      budgetTemplateCategories.push(budgetTemplateCategory);
    }
  }

  await DI.em.persist(budgetTemplateCategories).flush();
  return res.sendStatus(StatusCodes.CREATED);
}

export async function createBudget(req: Request, res: Response, next: NextFunction) {
  const { user } = authedContext(req);
  const {
    body: { dependentsNum, houseHoldSize, incomes },
  } = await zParse(createBudgetRequestSchema, req);

  // Budgets are household-shared: scope to the user's tenant.
  const appuserTenant = await DI.em.getRepository(AppuserTenant).getAppuserTenantByAppuser(user);
  if (!appuserTenant) {
    next(new NotFoundError('Tenant not found')); return;
  }

  // Create Budget
  const budget = new Budget();
  budget.appuserKey = user;
  budget.tenantKey = appuserTenant.tenantKey;
  budget.currencyKey = user.currencyKey;
  budget.numAdults = houseHoldSize - dependentsNum;
  budget.numDependents = dependentsNum;
  await DI.em.persist(budget).flush();

  // Create budget template INCOMES
  const budgetTemplateIncome = (incomes ?? []).map((income) => {
    const budgetTemplateIncome = new BudgetTemplateIncome();
    budgetTemplateIncome.budgetKey = budget;
    budgetTemplateIncome.name = income.name;
    budgetTemplateIncome.amount = income.amount;
    if (income.isRecurrent) {
      budgetTemplateIncome.recurrency = income.recurrency!;
    }
    return budgetTemplateIncome;
  });
  await DI.em.persist(budgetTemplateIncome).flush();

  // Create budget template categories
  // Get default categories
  let defaultBudgetCategories = await DI.em.getRepository(Category).getBudgetDefaultCategories();

  // Filter out DEPENDENTS category and its child categories if user has no dependents
  if (dependentsNum === 0) {
    defaultBudgetCategories = defaultBudgetCategories.filter((category) => {
      // Exclude categories that are dependent-related:
      // 1. Parent category named 'DEPENDENTS'
      // 2. Child categories that have 'DEPENDENTS' as parent category
      const isDependentsCategory = category.name === 'DEPENDENTS';
      const isChildOfDependents = category.parentCategory?.name === 'DEPENDENTS';

      return !isDependentsCategory && !isChildOfDependents;
    });
  }

  // For each category, calculate the amount budgeted using the user data
  // The income amount is already anualized
  const totalHouseholdAnualizedMonthlyIncome =
    incomes && incomes.length > 0 ? incomes.reduce((acc, income) => acc + income.amount, 0) : 0;

  // Creates budget template categories for all default categories and for the whole year
  const budgetTemplateCategories = defaultBudgetCategories.flatMap((category) => {
    const categoriesTemplates = [];
    for (const month of Array(12).keys()) {
      const budgetTemplateCategory = new BudgetTemplateCategory();
      budgetTemplateCategory.budgetKey = budget;
      budgetTemplateCategory.categoryKey = category;
      budgetTemplateCategory.amountBudgeted = calculateAmountBudgeted({
        category,
        numAdults: budget.numAdults,
        numDependents: budget.numDependents,
        totalHouseholdAnualizedMonthlyIncome,
      });
      budgetTemplateCategory.year = new Date().getFullYear();
      budgetTemplateCategory.month = month + 1;
      budgetTemplateCategory.recurrency = category.recurrency;
      categoriesTemplates.push(budgetTemplateCategory);
    }
    return categoriesTemplates;
  });
  await DI.em.persist(budgetTemplateCategories).flush();
  budget.budgetTemplatesCategory.add(budgetTemplateCategories);
  await DI.em.persist(budget).flush();

  return res.status(StatusCodes.CREATED).json({ budgetKey: budget.budgetKey });
}

export async function deleteBudget(req: Request, res: Response) {
  const {
    params: { budgetKey },
  } = await zParse(deleteBudgetRequestSchema, req);
  // A budget of another household is filtered out, so it reads as missing: 404, not a 500.
  const budget = await DI.em.findOne(Budget, {
    budgetKey,
    deletedAt: undefined,
  });
  if (!budget) throw new NotFoundError('Budget not found');
  budget.deletedAt = new Date();
  await DI.em.persist(budget).flush();
  return res.sendStatus(StatusCodes.OK);
}

export async function deleteBudgetCategory(req: Request, res: Response, next: NextFunction) {
  const {
    params: { budgetKey, categoryKey, month, year },
  } = await zParse(deleteBudgetCategoryRequestSchema, req);
  const budget = await DI.em.findOne(Budget, {
    budgetKey,
    deletedAt: undefined,
  });
  if (!budget) {
    next(new NotFoundError('Budget not found')); return;
  }
  const budgetTemplateCategory = await DI.em.findOne(BudgetTemplateCategory, {
    budgetKey: { budgetKey },
    categoryKey: {
      categoryKey,
    },
    month,
    year,
  });
  if (!budgetTemplateCategory) {
    next(new NotFoundError('Budget template category not found')); return;
  }
  await DI.em.remove(budgetTemplateCategory).flush();
  return res.sendStatus(StatusCodes.OK);
}

export async function editBudget(req: Request, res: Response) {
  const {
    body: { description, name, rolloverCarriesOverspend },
    params: { budgetKey },
  } = await zParse(updateBudgetRequestSchema, req);
  // A budget of another household is filtered out, so it reads as missing: 404, not a 500.
  const budget = await DI.em.findOne(Budget, {
    budgetKey,
    deletedAt: undefined,
  });
  if (!budget) throw new NotFoundError('Budget not found');
  if (name !== undefined) {
    budget.name = name;
    budget.description = description;
  }
  if (rolloverCarriesOverspend !== undefined) budget.rolloverCarriesOverspend = rolloverCarriesOverspend;
  await DI.em.persist(budget).flush();
  return res.sendStatus(StatusCodes.OK);
}

export async function getBudget(req: Request, res: Response, next: NextFunction) {
  const {
    params: { budgetKey },
  } = await zParse(getBudgetRequestSchema, req);
  const budget = await DI.em.findOne(
    Budget,
    {
        budgetKey,
      deletedAt: undefined,
    },
    {
      populate: ['budgetTemplatesCategory'],
    },
  );
  if (!budget) {
    next(new NotFoundError('Budget not found')); return;
  }
  const transformedData = {
    budgetKey: budget.budgetKey,
    description: budget.description,
    name: budget.name,
    rolloverCarriesOverspend: budget.rolloverCarriesOverspend,
  };
  return res.json({ budget: transformedData });
}

export async function getBudgetAccounts(req: Request, res: Response, next: NextFunction) {
  const {
    params: { budgetKey },
  } = await zParse(getBudgetRequestSchema, req);
  const budget = await DI.em.findOne(
    Budget,
    {
        budgetKey,
      deletedAt: undefined,
    },
    {
      populate: ['budgetTemplatesCategory', 'budgetTemplatesCategory.accounts'],
      populateOrderBy: {
        // Latest month first: order by year, then month.
        // eslint-disable-next-line perfectionist/sort-objects -- the key order is the sort order
        budgetTemplatesCategory: { year: QueryOrder.DESC, month: QueryOrder.DESC },
      },
      populateWhere: PopulateHint.INFER,
    },
  );
  if (!budget) {
    next(new NotFoundError('Budget not found')); return;
  }

  const budgetTemplates = budget.budgetTemplatesCategory.getItems();
  if (!budgetTemplates.length) {
    next(new NotFoundError('Budget template not found')); return;
  }

  const lastMonthBudgetTemplate = budgetTemplates.at(0);
  if (lastMonthBudgetTemplate === undefined) {
    next(new NotFoundError('Budget template not found')); return;
  }

  const accounts = lastMonthBudgetTemplate.accounts.getItems();

  return res.json({ accounts });
}

/**
 * The budget's forecast for the current month and the months after it (`months`, 3 to 12): what
 * each month plans, has spent so far (the current month only), is expected to spend from its
 * recurring items, and leaves of its planned income (`budget-forecast.service.ts`).
 */
export async function getBudgetForecast(req: Request, res: Response, next: NextFunction) {
  const { tenant, user } = authedContext(req);
  const {
    params: { budgetKey },
    query: { months },
  } = await zParse(getBudgetForecastRequestSchema, req);
  const now = new Date();
  // A window that reaches into next year needs next year's rows, copied from December.
  const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + months - 1, 1));
  if (lastMonth.getUTCFullYear() > now.getUTCFullYear()) await extendBudgetIntoYear(budgetKey, tenant.tenantKey, lastMonth.getUTCFullYear());

  const budget = await DI.em.findOne(
    Budget,
    { budgetKey, deletedAt: null },
    { populate: ['currencyKey', 'budgetTemplatesCategory', 'budgetTemplatesCategory.accounts'] },
  );
  if (!budget) {
    next(new NotFoundError('Budget not found')); return;
  }
  const incomes = await DI.em.find(BudgetTemplateIncome, { budgetKey: { budgetKey } });

  const forecast = await forecastBudget(DI.em, { budget, incomes, months, now, tenantKey: tenant.tenantKey, viewerAppuserKey: user.appuserKey });
  return res.json(forecast);
}

/**
 * Suggested monthly limits from the household's own spending, per budget category. The window is
 * the `months` complete months before the requested month; a category with too little history is
 * returned flagged rather than suggested.
 */
export async function getBudgets(_req: Request, res: Response) {
  const budgets = await DI.em.find(
    Budget,
    {
      deletedAt: undefined,
    },
    {
      populate: ['budgetTemplatesCategory'],
    },
  );
  const transformedData = budgets.map((b) => ({
    budgetKey: b.budgetKey,
    budgetTemplates: b.budgetTemplatesCategory.getItems().map((btc) => ({
      budgetTemplateCategoryKey: btc.budgetTemplateCategoryKey,
    })),
    description: b.description,
    name: b.name,
  }));
  return res.json({ budgets: transformedData });
}

export async function getBudgetsFull(req: Request, res: Response) {
  const { tenant, user } = authedContext(req);
  // Get current year and month
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  // Fetch all budgets for the user
  const findBudgets = (refresh: boolean) =>
    DI.em.find(
      Budget,
      {
        deletedAt: undefined,
      },
      {
        populate: ['currencyKey', 'budgetTemplatesCategory', 'budgetTemplatesCategory.accounts'],
        populateWhere: PopulateHint.INFER,
        refresh,
      },
    );
  let budgets = await findBudgets(false);

  // A budget with no rows for this year yet (the yearly extension has not reached it) starts the
  // year from last December.
  let extended = 0;
  for (const budget of budgets) {
    if (!budget.budgetTemplatesCategory.getItems().some((bt) => bt.year === year)) {
      extended += await ensureBudgetYear(DI.em, { budgetKey: budget.budgetKey, tenantKey: tenant.tenantKey, year });
    }
  }
  if (extended > 0) budgets = await findBudgets(true);

  if (!budgets.length) {
    return res.json({ budgets: [] });
  }

  // Fetch incomes for all budgets in a single query to avoid N+1 lookups inside the loop below.
  const allBudgetIncomes = await DI.em.find(BudgetTemplateIncome, {
    budgetKey: { budgetKey: { $in: budgets.map((b) => b.budgetKey) } },
  });
  const budgetIncomesByBudgetKey = new Map<number, BudgetTemplateIncome[]>();
  for (const income of allBudgetIncomes) {
    const key = income.budgetKey.budgetKey;
    const existing = budgetIncomesByBudgetKey.get(key);
    if (existing) {
      existing.push(income);
    } else {
      budgetIncomesByBudgetKey.set(key, [income]);
    }
  }

  const budgetsData = [];

  for (const budget of budgets) {
    const budgetIncomes = budgetIncomesByBudgetKey.get(budget.budgetKey) ?? [];

    const budgetTemplates = budget.budgetTemplatesCategory.getItems();

    // Filter for current month and year
    const currentMonthBudgetTemplates = budgetTemplates.filter((bt) => bt.year === year && bt.month === month);

    // Skip this budget if no templates found for current month
    if (currentMonthBudgetTemplates.length === 0) {
      continue;
    }

    const accounts = currentMonthBudgetTemplates.flatMap((template) => template.accounts.getItems());

    const { categories, completeness } = await getBudgetSpending({
      accountKeys: accounts.map((account) => account.accountKey),
      currency: budget.currencyKey,
      period: 'monthly',
      templateKeys: currentMonthBudgetTemplates.map((template) => template.budgetTemplateCategoryKey),
      tenantKey: tenant.tenantKey,
      viewerAppuserKey: user.appuserKey,
    });
    const { categories: budgetAmount, rolloverComplete } = await monthWithRollover(budget, categories, { month, tenantKey: tenant.tenantKey, viewerAppuserKey: user.appuserKey, year });

    budgetsData.push({
      accounts: currentMonthBudgetTemplates[0]!.accounts.getItems().map((account) => ({
        accountKey: account.accountKey,
        accountName: account.accountName,
      })),
      budgetKey: budget.budgetKey,
      categories: budgetAmount,
      completeness,
      currencyCode: budget.currencyKey.code,
      description: budget.description,
      incomes: budgetIncomes,
      month: currentMonthBudgetTemplates[0]!.month,
      name: budget.name,
      rolloverCarriesOverspend: budget.rolloverCarriesOverspend,
      rolloverComplete,
      year: currentMonthBudgetTemplates[0]!.year,
    });
  }

  return res.json({ budgets: budgetsData });
}

export async function getBudgetSuggestions(req: Request, res: Response, next: NextFunction) {
  const { tenant, user } = authedContext(req);
  const {
    params: { budgetKey },
    query: { month, months, year },
  } = await zParse(getBudgetSuggestionsRequestSchema, req);
  const budget = await DI.em.findOne(Budget, { budgetKey, deletedAt: null });
  if (!budget) {
    next(new NotFoundError('Budget not found')); return;
  }
  // The budget's own accounts when it has any; the service falls back to every visible account.
  const templates = await DI.em.find(
    BudgetTemplateCategory,
    { budgetKey: { budgetKey }, month, year },
    { populate: ['accounts'] },
  );
  const accountKeys = [...new Set(templates.flatMap((template) => template.accounts.getItems().map((account) => account.accountKey)))];

  const suggestions = await suggestBudgetAmounts({
    accountKeys,
    budgetKey,
    months,
    targetMonth: { month, year },
    tenantKey: tenant.tenantKey,
    viewerAppuserKey: user.appuserKey,
  });
  return res.json(suggestions);
}

export async function getBudgetTemplateByYear(req: Request, res: Response, next: NextFunction) {
  const { tenant, user } = authedContext(req);
  const {
    params: { budgetKey, year },
  } = await zParse(getBudgetTemplateByYearRequestSchema, req);
  await extendBudgetIntoYear(budgetKey, tenant.tenantKey, year);
  const budget = await DI.em.findOne(
    Budget,
    {
        budgetKey,
      budgetTemplatesCategory: {
        year,
      },
      deletedAt: undefined,
    },
    {
      populate: ['currencyKey', 'budgetTemplatesCategory', 'budgetTemplatesCategory.accounts'],
      populateWhere: PopulateHint.INFER,
    },
  );
  if (!budget) {
    next(new NotFoundError('Budget not found')); return;
  }

  const budgetIncomes = await DI.em.find(BudgetTemplateIncome, {
    budgetKey: { budgetKey },
  });

  const budgetTemplates = budget.budgetTemplatesCategory.getItems();
  if (!budgetTemplates.length) {
    next(new NotFoundError('Budget templates not found')); return;
  }
  const accounts = budgetTemplates.flatMap((template) => template.accounts.getItems());

  const { budgetAmount, completeness } = await getCategoriesDataForBudget(accounts, budgetTemplates, tenant.tenantKey, user.appuserKey, budget.currencyKey);
  return res.json({
    budget: {
      accounts: budget.budgetTemplatesCategory[0]!.accounts.getItems().map((account) => ({
        accountKey: account.accountKey,
        accountName: account.accountName,
      })),
      budgetKey: budget.budgetKey,
      categories: budgetAmount,
      currencyCode: budget.currencyKey.code,
      description: budget.description,
      incomes: budgetIncomes,
      name: budget.name,
      year: budget.budgetTemplatesCategory[0]!.year,
    },
    completeness,
  });
}

export async function getBudgetTemplateByYearAndMonth(req: Request, res: Response, next: NextFunction) {
  const { tenant, user } = authedContext(req);
  const {
    params: { budgetKey, month, year },
  } = await zParse(getBudgetTemplateByYearAndMonthRequestSchema, req);
  await extendBudgetIntoYear(budgetKey, tenant.tenantKey, year);
  // From December, the next month is in the next year: make sure it exists so it can be offered.
  if (month === 12) await extendBudgetIntoYear(budgetKey, tenant.tenantKey, year + 1);
  const budget = await DI.em.findOne(
    Budget,
    {
        budgetKey,
      deletedAt: undefined,
    },
    {
      populate: ['currencyKey', 'budgetTemplatesCategory', 'budgetTemplatesCategory.accounts'],
      populateWhere: PopulateHint.INFER,
    },
  );
  if (!budget) {
    next(new NotFoundError('Budget not found')); return;
  }

  const budgetIncomes = await DI.em.find(BudgetTemplateIncome, {
    budgetKey: { budgetKey },
  });

  const budgetTemplates = budget.budgetTemplatesCategory.getItems();
  if (!budgetTemplates.length) {
    next(new NotFoundError('Budget template not found')); return;
  }
  const currentMonthBudgetTemplates = budgetTemplates.filter((bt) => bt.year === year && bt.month === month);
  if (currentMonthBudgetTemplates.length === 0) {
    next(new NotFoundError('Budget templates not found')); return;
  }
  const accounts = currentMonthBudgetTemplates.flatMap((template) => template.accounts.getItems());

  const spendingInput = {
    accountKeys: accounts.map((account) => account.accountKey),
    currency: budget.currencyKey,
    period: 'monthly' as const,
    templateKeys: currentMonthBudgetTemplates.map((template) => template.budgetTemplateCategoryKey),
    tenantKey: tenant.tenantKey,
    viewerAppuserKey: user.appuserKey,
  };
  const { categories, completeness } = await getBudgetSpending(spendingInput);
  const { categories: budgetAmount, rolloverComplete } = await monthWithRollover(budget, categories, { month, tenantKey: tenant.tenantKey, viewerAppuserKey: user.appuserKey, year });

  // Create a date object for the 15th of the month to avoid timezone edge cases
  const currentDate = new Date(year, month - 1, 15); // month - 1 because Date constructor expects 0-based month
  const nextMonth = addMonths(currentDate, 1);
  const previousMonth = subMonths(currentDate, 1);

  // The budget holds every year's rows: describe the requested month from its own rows.
  const monthTemplate = currentMonthBudgetTemplates[0]!;
  return res.json({
    budget: {
      accounts: monthTemplate.accounts.getItems().map((account) => ({
        accountKey: account.accountKey,
        accountName: account.accountName,
      })),
      budgetKey: budget.budgetKey,
      categories: budgetAmount,
      currencyCode: budget.currencyKey.code,
      description: budget.description,
      incomes: budgetIncomes,
      month: monthTemplate.month,
      name: budget.name,
      rolloverCarriesOverspend: budget.rolloverCarriesOverspend,
      year: monthTemplate.year,
    },
    completeness,
    hasNextMonth: budgetTemplates.some(
      (budgetTemplate) =>
        budgetTemplate.month === nextMonth.getMonth() + 1 && budgetTemplate.year === nextMonth.getFullYear(),
    ),
    hasPreviousMonth: budgetTemplates.some(
      (budgetTemplate) =>
        budgetTemplate.month === previousMonth.getMonth() + 1 && budgetTemplate.year === previousMonth.getFullYear(),
    ),
    rolloverComplete,
  });
}

export async function getBudgetTemplateByYearUntilMonth(req: Request, res: Response, next: NextFunction) {
  const { tenant, user } = authedContext(req);
  const {
    params: { budgetKey, month, year },
  } = await zParse(getBudgetTemplateByYearUntilMonthRequestSchema, req);
  await extendBudgetIntoYear(budgetKey, tenant.tenantKey, year);

  const budget = await DI.em.findOne(
    Budget,
    {
        budgetKey,
      budgetTemplatesCategory: {
        month: {
          $lte: month,
        },
        year,
      },
      deletedAt: undefined,
    },
    {
      populate: ['currencyKey', 'budgetTemplatesCategory', 'budgetTemplatesCategory.accounts'],
      populateWhere: PopulateHint.INFER,
    },
  );
  if (!budget) {
    next(new NotFoundError('Budget not found')); return;
  }

  const budgetIncomes = await DI.em.find(BudgetTemplateIncome, {
    budgetKey: { budgetKey },
  });

  const budgetTemplates = budget.budgetTemplatesCategory.getItems();
  if (!budgetTemplates.length) {
    next(new NotFoundError('Budget templates not found')); return;
  }
  const accounts = budgetTemplates.flatMap((template) => template.accounts.getItems());

  const { budgetAmount, completeness } = await getCategoriesDataForBudget(accounts, budgetTemplates, tenant.tenantKey, user.appuserKey, budget.currencyKey);

  return res.json({
    budget: {
      accounts: budget.budgetTemplatesCategory[0]!.accounts.getItems().map((account) => ({
        accountKey: account.accountKey,
        accountName: account.accountName,
      })),
      budgetKey: budget.budgetKey,
      categories: budgetAmount,
      currencyCode: budget.currencyKey.code,
      description: budget.description,
      incomes: budgetIncomes,
      name: budget.name,
      year: budget.budgetTemplatesCategory[0]!.year,
    },
    completeness,
  });
}

export async function removeCategoryFromBudget(req: Request, res: Response, next: NextFunction) {
  const {
    params: { budgetKey, categoryKey },
    query: { deletePreviousMonths },
  } = await zParse(removeCategoryFromBudgetRequestSchema, req);

  // Verify budget ownership
  const budget = await DI.em.findOne(Budget, {
    budgetKey,
    deletedAt: undefined,
  });
  if (!budget) {
    next(new NotFoundError('Budget not found')); return;
  }

  // Verify category exists and user has access (system or user-owned)
  const category = await DI.em.findOne(Category, {
    categoryKey,
    deletedAt: undefined,
  });
  if (!category) {
    next(new NotFoundError('Category not found')); return;
  }

  // Get all child categories
  const childCategories = await DI.em.find(Category, {
    deletedAt: undefined,
    parentCategory: { categoryKey },
  });

  // Collect all category keys to delete (parent + children)
  const categoryKeysToDelete = [categoryKey, ...childCategories.map((c) => c.categoryKey)];

  // Build filter for deletion
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth() + 1;

  // If not deleting previous months, only delete from current month onwards (safer default)
  const deleteFilter = !deletePreviousMonths
    ? {
        $or: [
          { year: { $gt: currentYear } }, // Future years
          { month: { $gte: currentMonth }, year: currentYear }, // Current year, current month onwards
        ],
        budgetKey: budget,
        categoryKey: { categoryKey: { $in: categoryKeysToDelete } },
      }
    : {
        budgetKey: budget,
        categoryKey: { categoryKey: { $in: categoryKeysToDelete } },
      };

  // Delete BudgetTemplateCategory entries based on filter
  const budgetTemplateCategoriesToDelete = await DI.em.find(BudgetTemplateCategory, deleteFilter);

  await DI.em.remove(budgetTemplateCategoriesToDelete).flush();

  return res.sendStatus(StatusCodes.OK);
}

export async function updateBudgetAccounts(req: Request, res: Response, next: NextFunction) {
  const { appuserKey, tenantKey } = authedContext(req);
  const {
    body: { accountKeys },
    params: { budgetKey },
  } = await zParse(updateBudgetAccountsRequestSchema, req);

  // Only accounts visible to this authenticated tenant/user may be assigned. Keep this
  // query intentionally narrow so a missing result has the same generic error whether the
  // key is unknown, belongs to another tenant, or is another household member's private key.
  const accounts = await DI.em.find(Account, {
    $or: [{ isPrivate: false }, { accountOwnerAppuserKey: { appuserKey } }],
    accountKey: { $in: accountKeys },
    closed: false,
    deletedAt: undefined,
    tenantKey: { tenantKey },
  });
  if (accounts.length !== accountKeys.length) {
    next(new BadRequestError("One or more accounts don't exist or you don't own them")); return;
  }

  const budget = await DI.em.findOne(Budget, {
    budgetKey,
    deletedAt: undefined,
  });
  if (!budget) {
    next(new NotFoundError('Budget not found')); return;
  }

  const budgetTemplateCategories = await DI.em.find(
    BudgetTemplateCategory,
    {
      budgetKey: budget,
    },
    { populate: ['accounts'] },
  );
  if (budgetTemplateCategories.length === 0) {
    next(new BadRequestError('No budget templates for this year')); return;
  }

  const persistList = [];
  for (const budgetTemplateCategory of budgetTemplateCategories) {
    const currentBudgetTemplateCategoryAccounts = budgetTemplateCategory.accounts.getItems();

    const accountsToRemove = currentBudgetTemplateCategoryAccounts.filter(
      (account) => !accountKeys.includes(account.accountKey),
    );
    budgetTemplateCategory.accounts.remove(accountsToRemove);

    const newAccountsToAdd = accounts.filter(
      (account) => !currentBudgetTemplateCategoryAccounts.some((a) => a.accountKey === account.accountKey),
    );
    budgetTemplateCategory.accounts.add(newAccountsToAdd);
    persistList.push(budgetTemplateCategory);
  }
  await DI.em.persist(persistList).flush();
  return res.sendStatus(StatusCodes.OK);
}

export async function updateBudgetCategory(req: Request, res: Response, next: NextFunction) {
  const {
    body: { amount, applyToFollowingMonths, recurrency, rolloverEnabled },
    params: { budgetKey, categoryKey, month, year },
  } = await zParse(updateBudgetCategoryAmountRequestSchema, req);
  const budget = await DI.em.findOne(Budget, {
    budgetKey,
    deletedAt: undefined,
  });
  if (!budget) {
    next(new NotFoundError('Budget not found')); return;
  }

  // "Following months" are every stored month after this one, into later years too.
  const budgetTemplateCategories = await DI.em.find(BudgetTemplateCategory, {
    budgetKey: { budgetKey },
    categoryKey: {
      categoryKey,
    },
    ...(applyToFollowingMonths
      ? { $or: [{ month: { $gte: month }, year }, { year: { $gt: year } }] }
      : { month, year }),
  });
  const budgetTemplateCategory = budgetTemplateCategories.find((category) => category.year === year && category.month === month);
  if (!budgetTemplateCategory) {
    next(new NotFoundError('Budget template category not found')); return;
  }

  for (const budgetTemplateCategory of budgetTemplateCategories) {
    if (amount !== undefined) {
      budgetTemplateCategory.amountBudgeted = amount;
    }
    if (recurrency !== undefined) {
      budgetTemplateCategory.recurrency = recurrency;
    }
    if (rolloverEnabled !== undefined) {
      budgetTemplateCategory.rolloverEnabled = rolloverEnabled;
    }
  }

  await DI.em.persist(budgetTemplateCategories).flush();

  return res.sendStatus(StatusCodes.OK);
}

export async function updateBudgetTemplateAccounts(req: Request, res: Response, next: NextFunction) {
  const { appuserKey, tenantKey } = authedContext(req);
  const {
    body: { accountKeys },
    params: { budgetKey, budgetTemplateCategoryKey },
  } = await zParse(updateBudgetTemplateRequestSchema, req);

  // Match updateBudgetAccounts: assignment must be limited to active accounts visible to
  // this authenticated tenant/user, without disclosing why an account key was not found.
  const accounts = await DI.em.find(Account, {
    $or: [{ isPrivate: false }, { accountOwnerAppuserKey: { appuserKey } }],
    accountKey: { $in: accountKeys },
    closed: false,
    deletedAt: undefined,
    tenantKey: { tenantKey },
  });
  if (accounts.length !== accountKeys.length) {
    next(new BadRequestError("One or more accounts don't exist or you don't own them")); return;
  }

  const budget = await DI.em.findOne(Budget, {
    budgetKey,
    deletedAt: undefined,
  });
  if (!budget) {
    next(new NotFoundError('Budget not found')); return;
  }

  const budgetTemplateCategory = await DI.em.findOne(
    BudgetTemplateCategory,
    {
      budgetKey: budget,
      budgetTemplateCategoryKey,
    },
    { populate: ['accounts'] },
  );
  if (!budgetTemplateCategory) {
    next(new NotFoundError('Budget template category not found')); return;
  }
  const currentBudgetTemplateCategoryAccounts = budgetTemplateCategory.accounts.getItems();
  const accountsToRemove = currentBudgetTemplateCategoryAccounts.filter(
    (account) => !accountKeys.includes(account.accountKey),
  );
  budgetTemplateCategory.accounts.remove(accountsToRemove);

  const newAccountsToAdd = accounts.filter(
    (account) => !currentBudgetTemplateCategoryAccounts.some((a) => a.accountKey === account.accountKey),
  );
  budgetTemplateCategory.accounts.add(newAccountsToAdd);
  await DI.em.persist(budgetTemplateCategory).flush();
  return res.sendStatus(StatusCodes.OK);
}

async function getCategoriesDataForBudget(
  accounts: Account[],
  budgetTemplates: BudgetTemplateCategory[],
  tenantKey: number,
  viewerAppuserKey: number,
  currency: Currency,
) {
  const { categories: budgetAmount, completeness } = await getBudgetSpending({
    accountKeys: accounts.map((account) => account.accountKey),
    currency,
    period: 'annual',
    templateKeys: budgetTemplates.map((template) => template.budgetTemplateCategoryKey),
    tenantKey,
    viewerAppuserKey,
  });
  return { budgetAmount, completeness };
}

/**
 * A budget month's spending rows with each category's rollover added (`category_rolled_over`,
 * `category_available`, ...), and whether every carried amount rests on complete spending. `budget`
 * has all its rows populated, with their accounts.
 */
async function monthWithRollover(
  budget: Budget,
  categories: BudgetSpendingCategory[],
  scope: { month: number; tenantKey: number; viewerAppuserKey: number; year: number },
) {
  const rows = rolloverRowsOf(budget.budgetTemplatesCategory.getItems());
  const rollover = await getMonthRollover({ ...scope, carryOverspend: budget.rolloverCarriesOverspend, currency: budget.currencyKey, rows });
  return {
    categories: withRollover(categories, rollover),
    rolloverComplete: [...rollover.values()].every((category) => !category.rolledOverIncomplete),
  };
}

/**
 * Lazily start a year the budget does not have yet, from the December before: this year (should
 * the yearly extension have missed it) or next year. Earlier and later years are left alone.
 */
async function extendBudgetIntoYear(budgetKey: number, tenantKey: number, year: number) {
  const currentYear = new Date().getFullYear();
  if (year < currentYear || year > currentYear + 1) return;
  await ensureBudgetYear(DI.em, { budgetKey, tenantKey, year });
}
