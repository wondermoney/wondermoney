// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import type { Dictionary, EntityManager } from '@mikro-orm/core';

import { Category } from '@entity/Category';
import { Seeder } from '@mikro-orm/seeder';
import { Recurrency } from '@utils/budget';

export class SubCategorySeeder extends Seeder {
  async run(em: EntityManager, ctx: Dictionary): Promise<void> {
    const ctxSubCategoryEntities = [];
    // Parent Category: HOUSING
    ctxSubCategoryEntities.push(
      em.create(Category, {
        bgColor: ctx.categories[0].bgColor,
        defaultHouseholdMultiplier: 0.25,
        icon: 'home',
        isDefaultBudgetCategory: true,
        isSystemCategory: true,
        name: 'RENT_MORTGAGE',
        parentCategory: ctx.categories[0],
        recurrency: Recurrency.MONTHLY,
        textColor: ctx.categories[0].textColor,
      }),
    );
    ctxSubCategoryEntities.push(
      em.create(Category, {
        bgColor: ctx.categories[0].bgColor,
        defaultHouseholdAmount: 30,
        icon: 'home',
        isDefaultBudgetCategory: false,
        isSystemCategory: true,
        name: 'CONDOMINIUM',
        parentCategory: ctx.categories[0],
        recurrency: Recurrency.MONTHLY,
        textColor: ctx.categories[0].textColor,
      }),
    );
    ctxSubCategoryEntities.push(
      em.create(Category, {
        bgColor: ctx.categories[0].bgColor,
        defaultHouseholdMultiplier: 0.7,
        icon: 'construction',
        isDefaultBudgetCategory: false,
        isSystemCategory: true,
        name: 'MAINTENANCE',
        parentCategory: ctx.categories[0],
        recurrency: Recurrency.MONTHLY,
        textColor: ctx.categories[0].textColor,
      }),
    );

    // Parent Category: UTILITIES
    ctxSubCategoryEntities.push(
      em.create(Category, {
        bgColor: ctx.categories[1].bgColor,
        defaultIndividualAdultAmount: 30,
        icon: 'zap',
        isDefaultBudgetCategory: true,
        isSystemCategory: true,
        name: 'ELECTRICITY',
        parentCategory: ctx.categories[1],
        recurrency: Recurrency.MONTHLY,
        textColor: ctx.categories[1].textColor,
      }),
    );
    ctxSubCategoryEntities.push(
      em.create(Category, {
        bgColor: ctx.categories[1].bgColor,
        defaultIndividualAmount: 12,
        icon: 'droplet',
        isDefaultBudgetCategory: true,
        isSystemCategory: true,
        name: 'WATER',
        parentCategory: ctx.categories[1],
        recurrency: Recurrency.MONTHLY,
        textColor: ctx.categories[1].textColor,
      }),
    );
    ctxSubCategoryEntities.push(
      em.create(Category, {
        bgColor: ctx.categories[1].bgColor,
        defaultIndividualAmount: 15,
        icon: 'cylinder',
        isDefaultBudgetCategory: true,
        isSystemCategory: true,
        name: 'GAS',
        parentCategory: ctx.categories[1],
        recurrency: Recurrency.MONTHLY,
        textColor: ctx.categories[1].textColor,
      }),
    );
    ctxSubCategoryEntities.push(
      em.create(Category, {
        bgColor: ctx.categories[1].bgColor,
        defaultHouseholdAmount: 50,
        icon: 'radio-tower',
        isDefaultBudgetCategory: true,
        isSystemCategory: true,
        name: 'TV_PHONE_INTERNET',
        parentCategory: ctx.categories[1],
        recurrency: Recurrency.MONTHLY,
        textColor: ctx.categories[1].textColor,
      }),
    );

    // Parent Category: FOOD
    ctxSubCategoryEntities.push(
      em.create(Category, {
        bgColor: ctx.categories[2].bgColor,
        defaultIndividualAmount: 175,
        icon: 'cart',
        isDefaultBudgetCategory: true,
        isSystemCategory: true,
        name: 'GROCERIES',
        parentCategory: ctx.categories[2],
        recurrency: Recurrency.MONTHLY,
        textColor: ctx.categories[2].textColor,
      }),
    );
    ctxSubCategoryEntities.push(
      em.create(Category, {
        bgColor: ctx.categories[2].bgColor,
        defaultHouseholdMultiplier: 0.07,
        icon: 'utensils',
        isDefaultBudgetCategory: true,
        isSystemCategory: true,
        name: 'CAFE_RESTAURANTS_BARS',
        parentCategory: ctx.categories[2],
        recurrency: Recurrency.MONTHLY,
        textColor: ctx.categories[2].textColor,
      }),
    );
    ctxSubCategoryEntities.push(
      em.create(Category, {
        bgColor: ctx.categories[2].bgColor,
        defaultHouseholdMultiplier: 0.03,
        icon: 'package-2',
        isDefaultBudgetCategory: true,
        isSystemCategory: true,
        name: 'FOOD_DELIVERY',
        parentCategory: ctx.categories[2],
        recurrency: Recurrency.MONTHLY,
        textColor: ctx.categories[2].textColor,
      }),
    );

    // Parent Category: TRANSPORTATION
    ctxSubCategoryEntities.push(
      em.create(Category, {
        bgColor: ctx.categories[3].bgColor,
        defaultIndividualAdultAmount: 60,
        icon: 'fuel',
        isDefaultBudgetCategory: true,
        isSystemCategory: true,
        name: 'FUEL',
        parentCategory: ctx.categories[3],
        recurrency: Recurrency.MONTHLY,
        textColor: ctx.categories[3].textColor,
      }),
    );
    ctxSubCategoryEntities.push(
      em.create(Category, {
        bgColor: ctx.categories[3].bgColor,
        defaultIndividualAdultAmount: 40,
        icon: 'bus',
        isDefaultBudgetCategory: true,
        isSystemCategory: true,
        name: 'PUBLIC_TRANSPORT',
        parentCategory: ctx.categories[3],
        recurrency: Recurrency.MONTHLY,
        textColor: ctx.categories[3].textColor,
      }),
    );
    ctxSubCategoryEntities.push(
      em.create(Category, {
        bgColor: ctx.categories[3].bgColor,
        defaultHouseholdAmount: 400,
        icon: 'wrench',
        isDefaultBudgetCategory: true,
        isSystemCategory: true,
        name: 'VEHICLE_MAINTENANCE',
        parentCategory: ctx.categories[3],
        recurrency: Recurrency.ANNUALLY,
        textColor: ctx.categories[3].textColor,
      }),
    );
    ctxSubCategoryEntities.push(
      em.create(Category, {
        bgColor: ctx.categories[3].bgColor,
        defaultHouseholdAmount: 600,
        icon: 'shield-check',
        isDefaultBudgetCategory: true,
        isSystemCategory: true,
        name: 'VEHICLE_INSURANCE',
        parentCategory: ctx.categories[3],
        recurrency: Recurrency.ANNUALLY,
        textColor: ctx.categories[3].textColor,
      }),
    );

    // Parent Category: ENTERTAINMENT
    ctxSubCategoryEntities.push(
      em.create(Category, {
        bgColor: ctx.categories[4].bgColor,
        defaultHouseholdMultiplier: 0.025,
        icon: 'volleyball',
        isDefaultBudgetCategory: true,
        isSystemCategory: true,
        name: 'HOBBIES_AND_LEISURE',
        parentCategory: ctx.categories[4],
        recurrency: Recurrency.MONTHLY,
        textColor: ctx.categories[4].textColor,
      }),
    );
    ctxSubCategoryEntities.push(
      em.create(Category, {
        bgColor: ctx.categories[4].bgColor,
        defaultHouseholdAmount: 20,
        icon: 'tv',
        isDefaultBudgetCategory: true,
        isSystemCategory: true,
        name: 'STREAMING_SERVICES',
        parentCategory: ctx.categories[4],
        recurrency: Recurrency.MONTHLY,
        textColor: ctx.categories[4].textColor,
      }),
    );

    // Parent Category: OTHER
    ctxSubCategoryEntities.push(
      em.create(Category, {
        bgColor: ctx.categories[5].bgColor,
        defaultHouseholdMultiplier: 0.5,
        icon: 'gift',
        isDefaultBudgetCategory: true,
        isSystemCategory: true,
        name: 'GIFTS',
        parentCategory: ctx.categories[5],
        recurrency: Recurrency.ANNUALLY,
        textColor: ctx.categories[5].textColor,
      }),
    );
    ctxSubCategoryEntities.push(
      em.create(Category, {
        bgColor: ctx.categories[5].bgColor,
        defaultHouseholdMultiplier: 1,
        icon: 'plane-takeoff',
        isDefaultBudgetCategory: true,
        isSystemCategory: true,
        name: 'TRAVEL',
        parentCategory: ctx.categories[5],
        recurrency: Recurrency.ANNUALLY,
        textColor: ctx.categories[5].textColor,
      }),
    );

    // Parent Category: DEPENDENTS
    ctxSubCategoryEntities.push(
      em.create(Category, {
        bgColor: ctx.categories[6].bgColor,
        defaultIndividualDependentAmount: 100,
        icon: 'graduation-cap',
        isDefaultBudgetCategory: true,
        isSystemCategory: true,
        name: 'EDUCATION',
        parentCategory: ctx.categories[6],
        recurrency: Recurrency.MONTHLY,
        textColor: ctx.categories[6].textColor,
      }),
    );
    ctxSubCategoryEntities.push(
      em.create(Category, {
        bgColor: ctx.categories[6].bgColor,
        defaultIndividualDependentAmount: 50,
        icon: 'laugh',
        isDefaultBudgetCategory: true,
        isSystemCategory: true,
        name: 'LEISURE',
        parentCategory: ctx.categories[6],
        recurrency: Recurrency.MONTHLY,
        textColor: ctx.categories[6].textColor,
      }),
    );

    // Parent Category: WELLNESS
    ctxSubCategoryEntities.push(
      em.create(Category, {
        bgColor: ctx.categories[7].bgColor,
        defaultHouseholdMultiplier: 0.05,
        icon: 'cross',
        isDefaultBudgetCategory: true,
        isSystemCategory: true,
        name: 'HEALTH',
        parentCategory: ctx.categories[7],
        recurrency: Recurrency.MONTHLY,
        textColor: ctx.categories[7].textColor,
      }),
    );
    ctxSubCategoryEntities.push(
      em.create(Category, {
        bgColor: ctx.categories[7].bgColor,
        defaultIndividualAdultAmount: 35,
        icon: 'dumbbell',
        isDefaultBudgetCategory: true,
        isSystemCategory: true,
        name: 'GYM_AND_SPORTS',
        parentCategory: ctx.categories[7],
        recurrency: Recurrency.MONTHLY,
        textColor: ctx.categories[7].textColor,
      }),
    );

    ctxSubCategoryEntities.push(
      em.create(Category, {
        bgColor: ctx.categories[8].bgColor,
        icon: 'banknote',
        isDefaultBudgetCategory: false,
        isSystemCategory: true,
        name: 'SALARY',
        parentCategory: ctx.categories[8],
        recurrency: Recurrency.MONTHLY,
        textColor: ctx.categories[8].textColor,
      }),
    );

    ctx.subCategories = ctxSubCategoryEntities;
  }
}
