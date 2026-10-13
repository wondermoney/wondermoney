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
import { authedContext } from '@middleware/authed-context';
import { getBudgetSpending } from '@service/budget/spending';
import { calculateAmountBudgeted } from '@utils/budget';
import { BadRequestError, NotFoundError } from '@utils/errors';
import {
  addBudgetCategoryRequestSchema,
  createBudgetRequestSchema,
  deleteBudgetCategoryRequestSchema,
  deleteBudgetRequestSchema,
  getBudgetRequestSchema,
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

  // Create budget template categories for ALL 12 months of the year for complete year analysis
  const budgetTemplateCategories = [];
  for (let month = 1; month <= 12; month++) {
    const budgetTemplateCategory = new BudgetTemplateCategory();
    budgetTemplateCategory.budgetKey = budget;
    budgetTemplateCategory.categoryKey = category;
    budgetTemplateCategory.amountBudgeted = amountBudgeted;
    budgetTemplateCategory.recurrency = recurrency || category.recurrency;
    budgetTemplateCategory.year = currentYear;
    budgetTemplateCategory.month = month;
    budgetTemplateCategories.push(budgetTemplateCategory);
  }

  await DI.em.persist(budgetTemplateCategories).flush();
  return res.sendStatus(StatusCodes.CREATED);
}

export async function createBudget(req: Request, res: Response, next: NextFunction) {
  const { user } = authedContext(req);
  const {
    body: { dependentsNum, houseHoldSize, incomes },
  } = await zParse(createBudgetRequestSchema, req);

  // Budgets are household-shared (RAD-343): scope to the user's tenant.
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
  const budget = await DI.em.findOneOrFail(Budget, {
    budgetKey,
    deletedAt: undefined,
  });
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
    body: { description, name },
    params: { budgetKey },
  } = await zParse(updateBudgetRequestSchema, req);
  const budget = await DI.em.findOneOrFail(Budget, {
    budgetKey,
    deletedAt: undefined,
  });
  budget.name = name;
  budget.description = description;
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
        budgetTemplatesCategory: {
          month: QueryOrder.DESC,
          year: QueryOrder.DESC,
        },
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
  const budgets = await DI.em.find(
    Budget,
    {
        deletedAt: undefined,
    },
    {
      populate: ['currencyKey', 'budgetTemplatesCategory', 'budgetTemplatesCategory.accounts'],
      populateWhere: PopulateHint.INFER,
    },
  );

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

    const budgetAmount = await getBudgetSpending({
      accountKeys: accounts.map((account) => account.accountKey),
      period: 'monthly',
      templateKeys: currentMonthBudgetTemplates.map((template) => template.budgetTemplateCategoryKey),
      tenantKey: tenant.tenantKey,
      viewerAppuserKey: user.appuserKey,
    });

    budgetsData.push({
      accounts: currentMonthBudgetTemplates[0]!.accounts.getItems().map((account) => ({
        accountKey: account.accountKey,
        accountName: account.accountName,
      })),
      budgetKey: budget.budgetKey,
      categories: budgetAmount,
      currencyCode: budget.currencyKey.code,
      description: budget.description,
      incomes: budgetIncomes,
      month: currentMonthBudgetTemplates[0]!.month,
      name: budget.name,
      year: currentMonthBudgetTemplates[0]!.year,
    });
  }

  return res.json({ budgets: budgetsData });
}

export async function getBudgetTemplateByYear(req: Request, res: Response, next: NextFunction) {
  const { tenant, user } = authedContext(req);
  const {
    params: { budgetKey, year },
  } = await zParse(getBudgetTemplateByYearRequestSchema, req);
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

  const budgetAmount = await getCategoriesDataForBudget(accounts, budgetTemplates, tenant.tenantKey, user.appuserKey);
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
  });
}

export async function getBudgetTemplateByYearAndMonth(req: Request, res: Response, next: NextFunction) {
  const { tenant, user } = authedContext(req);
  const {
    params: { budgetKey, month, year },
  } = await zParse(getBudgetTemplateByYearAndMonthRequestSchema, req);
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

  const budgetAmount = await getBudgetSpending({
    accountKeys: accounts.map((account) => account.accountKey),
    period: 'monthly',
    templateKeys: currentMonthBudgetTemplates.map((template) => template.budgetTemplateCategoryKey),
    tenantKey: tenant.tenantKey,
    viewerAppuserKey: user.appuserKey,
  });

  // Create a date object for the 15th of the month to avoid timezone edge cases
  const currentDate = new Date(year, month - 1, 15); // month - 1 because Date constructor expects 0-based month
  const nextMonth = addMonths(currentDate, 1);
  const previousMonth = subMonths(currentDate, 1);

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
      month: budget.budgetTemplatesCategory[0]!.month,
      name: budget.name,
      year: budget.budgetTemplatesCategory[0]!.year,
    },
    hasNextMonth: budgetTemplates.some(
      (budgetTemplate) =>
        budgetTemplate.month === nextMonth.getMonth() + 1 && budgetTemplate.year === nextMonth.getFullYear(),
    ),
    hasPreviousMonth: budgetTemplates.some(
      (budgetTemplate) =>
        budgetTemplate.month === previousMonth.getMonth() + 1 && budgetTemplate.year === previousMonth.getFullYear(),
    ),
  });
}

export async function getBudgetTemplateByYearUntilMonth(req: Request, res: Response, next: NextFunction) {
  const { tenant, user } = authedContext(req);
  const {
    params: { budgetKey, month, year },
  } = await zParse(getBudgetTemplateByYearUntilMonthRequestSchema, req);

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

  const budgetAmount = await getCategoriesDataForBudget(accounts, budgetTemplates, tenant.tenantKey, user.appuserKey);

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
    body: { amount, applyToFollowingMonths, recurrency },
    params: { budgetKey, categoryKey, month, year },
  } = await zParse(updateBudgetCategoryAmountRequestSchema, req);
  const budget = await DI.em.findOne(Budget, {
    budgetKey,
    deletedAt: undefined,
  });
  if (!budget) {
    next(new NotFoundError('Budget not found')); return;
  }

  const budgetTemplateCategories = await DI.em.find(BudgetTemplateCategory, {
    budgetKey: { budgetKey },
    categoryKey: {
      categoryKey,
    },
    month: applyToFollowingMonths ? { $gte: month, $lte: 12 } : month,
    year,
  });
  const budgetTemplateCategory = budgetTemplateCategories.find((category) => category.month === month);
  if (!budgetTemplateCategory) {
    next(new NotFoundError('Budget template category not found')); return;
  }

  if (applyToFollowingMonths && budgetTemplateCategories.length !== 13 - month) {
    next(new NotFoundError('Budget template category for next months not found')); return;
  }

  for (const budgetTemplateCategory of budgetTemplateCategories) {
    if (amount !== undefined) {
      budgetTemplateCategory.amountBudgeted = amount;
    }
    if (recurrency !== undefined) {
      budgetTemplateCategory.recurrency = recurrency;
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

  const budgetTemplateCategory = await DI.em.findOneOrFail(
    BudgetTemplateCategory,
    {
      budgetKey: budget,
      budgetTemplateCategoryKey,
    },
    { populate: ['accounts'] },
  );
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
) {
  return getBudgetSpending({
    accountKeys: accounts.map((account) => account.accountKey),
    period: 'annual',
    templateKeys: budgetTemplates.map((template) => template.budgetTemplateCategoryKey),
    tenantKey,
    viewerAppuserKey,
  });
}
