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
import { pickTextColorBasedOnBgColorAdvanced } from '@utils/category';
import { NotFoundError } from '@utils/errors';

import { DI } from '../app';

export async function createCategory(req: Request, res: Response, next: NextFunction) {
  const user = authedUser(req);
  const {
    body: { color, icon, name, parentCategoryKey },
  } = await zParse(createCategoryRequestSchema, req);
  // User-created categories are household-shared (RAD-343): scope to the user's tenant.
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
  await DI.em.persist(category).flush();
  const transformedData = pick(category, ['categoryKey', 'name', 'icon', 'bgColor']);
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

export async function getCategories(_req: Request, res: Response) {
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
    ...pick(category, ['categoryKey', 'name', 'textColor', 'bgColor', 'icon', 'isSystemCategory']),
    childCategory: category.childCategory
      .getItems()
      .map((childCategory) =>
        pick(childCategory, ['categoryKey', 'name', 'textColor', 'bgColor', 'icon', 'isSystemCategory']),
      ),
  }));
  return res.json({ categories: transformedData });
}

export async function updateCategory(req: Request, res: Response, next: NextFunction) {
  const user = authedUser(req);
  const {
    body: { color, icon, name },
    params: { categoryId },
  } = await zParse(updateCategoryRequestSchema, req);
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
  category.name = name ?? category.name;
  category.icon = icon ?? category.icon;
  const bgColor = color ?? category.bgColor;
  category.bgColor = bgColor || '#f3f3f3';
  category.textColor = pickTextColorBasedOnBgColorAdvanced(bgColor || '#f3f3f3');
  await DI.em.persist(category).flush();
  const transformedData = pick(category, ['categoryKey', 'name', 'icon', 'bgColor']);
  return res.json({ category: transformedData });
}
