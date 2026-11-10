import { QueryOrder } from '@mikro-orm/core';
import type { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { pick } from 'lodash-es';

import {
  createCategoryRequestSchema,
  deleteCategoryRequestSchema,
  updateCategoryRequestSchema,
} from '@app/validators/category';
import { zParse } from '@app/validators/parser';
import { AppuserTenant } from '@entity/AppuserTenant';
import { Category } from '@entity/Category';
import { authedUser } from '@middleware/authed-context';
import { loadCategorySpendingFlags, setCategoryCountsAsSpending } from '@service/transaction/category-spending';
import { pickTextColorBasedOnBgColorAdvanced } from '@utils/category';
import { BadRequestError, NotFoundError } from '@utils/errors';

import { DI } from '../app';

export async function createCategory(req: Request, res: Response, next: NextFunction) {
  const user = authedUser(req);
  const {
    body: { color, countsAsSpending, icon, name, parentCategoryKey },
  } = await zParse(createCategoryRequestSchema, req);
  // User-created categories are household-shared: scope to the user's tenant.
  const appuserTenant = await DI.em.getRepository(AppuserTenant).getAppuserTenantByAppuser(user);
  if (!appuserTenant) {
    next(new NotFoundError('Tenant not found'));
    return;
  }
  const category = new Category();
  category.appuserKey = user;
  category.tenantKey = appuserTenant.tenantKey;
  category.name = name;
  category.icon = icon;
  category.bgColor = color ?? '#f3f3f3';
  category.textColor = pickTextColorBasedOnBgColorAdvanced(color ?? '#f3f3f3');
  if (parentCategoryKey) {
    const parentCategory = await DI.em.findOne(Category, {
      $or: [
        { isSystemCategory: true, tenantKey: null },
        { isSystemCategory: false, tenantKey: appuserTenant.tenantKey },
      ],
      categoryKey: parentCategoryKey,
      deletedAt: undefined,
    });
    if (!parentCategory) {
      next(new NotFoundError('Parent category not found'));
      return;
    }
    category.parentCategory = parentCategory;
  }
  // A child starts with the household's value for its parent: a child of a category that is not
  // spending (investments, savings) is not spending either, unless the household switched it on.
  const flags = await loadCategorySpendingFlags(DI.em, appuserTenant.tenantKey.tenantKey);
  category.countsAsSpending = countsAsSpending ?? (category.parentCategory ? flags.ownValue(category.parentCategory) : true);
  await DI.em.persist(category).flush();
  const transformedData = pick(category, ['categoryKey', 'name', 'icon', 'bgColor', 'countsAsSpending']);
  return res.status(StatusCodes.CREATED).json({ category: transformedData });
}

export async function deleteCategory(req: Request, res: Response, next: NextFunction) {
  const user = authedUser(req);
  const {
    params: { categoryId },
  } = await zParse(deleteCategoryRequestSchema, req);
  const appuserTenant = await DI.em.getRepository(AppuserTenant).getAppuserTenantByAppuser(user);
  if (!appuserTenant) {
    next(new NotFoundError('Tenant not found'));
    return;
  }
  const category = await DI.em.findOne(Category, {
    categoryKey: categoryId,
    deletedAt: undefined,
    isSystemCategory: false,
    tenantKey: appuserTenant.tenantKey,
  });
  if (!category) {
    next(new NotFoundError('Category not found'));
    return;
  }
  category.deletedAt = new Date();
  await DI.em.persist(category).flush();
  return res.sendStatus(StatusCodes.OK);
}

/** Every category the household uses, with the household's value of "counts as spending" for each. */
export async function getCategories(req: Request, res: Response) {
  const appuserTenant = await DI.em.getRepository(AppuserTenant).getAppuserTenantByAppuser(authedUser(req));
  const flags = appuserTenant ? await loadCategorySpendingFlags(DI.em, appuserTenant.tenantKey.tenantKey) : undefined;
  const view = (category: Category) => ({
    ...pick(category, ['categoryKey', 'name', 'textColor', 'bgColor', 'icon', 'isSystemCategory']),
    countsAsSpending: flags ? flags.ownValue(category) : category.countsAsSpending,
  });
  const categories = await DI.em.find(
    Category,
    {
      deletedAt: undefined,
      parentCategory: null,
    },
    {
      orderBy: {
        childCategory: {
          name: QueryOrder.ASC,
        },
        name: QueryOrder.ASC,
      },
      populate: ['childCategory'],
    },
  );
  const transformedData = categories.map((category) => ({
    ...view(category),
    childCategory: category.childCategory.getItems().map(view),
  }));
  return res.json({ categories: transformedData });
}

/**
 * Edit a category. The household's own category takes every field. A built-in (system) category is
 * shared by every household, so only "counts as spending" can be set on it, and that for the
 * member's household only (`category-spending.ts`). Setting it also sets it on the category's
 * children.
 */
export async function updateCategory(req: Request, res: Response, next: NextFunction) {
  const user = authedUser(req);
  const {
    body: { color, countsAsSpending, icon, name },
    params: { categoryId },
  } = await zParse(updateCategoryRequestSchema, req);
  const appuserTenant = await DI.em.getRepository(AppuserTenant).getAppuserTenantByAppuser(user);
  if (!appuserTenant) {
    next(new NotFoundError('Tenant not found'));
    return;
  }
  const tenantKey = appuserTenant.tenantKey.tenantKey;
  const category = await DI.em.findOne(Category, {
    $or: [
      { isSystemCategory: true, tenantKey: null },
      { isSystemCategory: false, tenantKey: appuserTenant.tenantKey },
    ],
    categoryKey: categoryId,
    deletedAt: undefined,
  });
  if (!category) {
    next(new NotFoundError('Category not found'));
    return;
  }
  if (category.isSystemCategory) {
    if (color !== undefined || icon !== undefined || name !== undefined) {
      next(new BadRequestError('Only "counts as spending" can be changed on a built-in category'));
      return;
    }
  } else {
    category.name = name ?? category.name;
    category.icon = icon ?? category.icon;
    const bgColor = color ?? category.bgColor;
    category.bgColor = bgColor || '#f3f3f3';
    category.textColor = pickTextColorBasedOnBgColorAdvanced(bgColor || '#f3f3f3');
    await DI.em.persist(category).flush();
  }
  if (countsAsSpending !== undefined) await setCategoryCountsAsSpending(DI.em, tenantKey, category.categoryKey, countsAsSpending);
  const flags = await loadCategorySpendingFlags(DI.em, tenantKey);
  const transformedData = { ...pick(category, ['categoryKey', 'name', 'icon', 'bgColor']), countsAsSpending: flags.ownValue(category) };
  return res.json({ category: transformedData });
}
