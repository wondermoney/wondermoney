import { QueryOrder } from '@mikro-orm/core';
import type { Request, Response } from 'express';
import { pick } from 'lodash-es';

import { DI } from '@app/app';
import { AccountFinancialInstitution } from '@entity/AccountFinancialInstitution';
import { Category } from '@entity/Category';
import { Currency } from '@entity/Currency';
import { FinancialBroker } from '@entity/FinancialBroker';
import { FinancialTransactionType } from '@entity/FinancialTransactionType';
import { TransactionType } from '@entity/TransactionType';

interface CategoryChildItem {
  bgColor: string;
  categoryKey: number;
  icon?: string;
  isSystemCategory: boolean;
  name: string;
  textColor: string;
}

interface CategoryQueryItem {
  $or: { appuserKey?: null | { appuserKey: number }; isSystemCategory: boolean }[];
  deletedAt: undefined;
  parentCategory: undefined;
}

interface CategoryResult {
  bgColor: string;
  categoryKey: number;
  childCategory: { getItems: () => CategoryChildItem[] };
  icon?: string;
  isSystemCategory: boolean;
  name: string;
  textColor: string;
}

interface StaticConfigs {
  accountFinancialInstitutions: { accountFinancialInstitutionKey: number; displayName?: string; logoUrl?: string }[];
  brokers: { displayName?: string; financialBrokerKey: number; name: string }[];
  currencies: { code: string; currencyKey: number; description?: string }[];
  financialTransactionTypes: { financialTransactionTypeKey: number; name: string }[];
  transactionTypes: { name: string; transactionTypeKey: number }[];
}

const STATIC_CONFIGS_TTL_MS = 5 * 60 * 1000;

export async function getConfigs(req: Request, res: Response) {
  const appuser = req.user;
  if (!appuser) throw new Error('Authenticated user is required to load configs');

  const [staticConfigs, categories] = await Promise.all([
    getStaticConfigs(),
    DI.em.find(
      Category,
      {
        deletedAt: undefined,
        parentCategory: undefined,
      } as CategoryQueryItem,
      {
        populate: ['childCategory'],
      },
    ),
  ]);

  const categoriesData = (categories as CategoryResult[]).map((category) => ({
    ...pick(category, ['categoryKey', 'name', 'textColor', 'bgColor', 'icon', 'isSystemCategory']),
    childCategory: category.childCategory.getItems().map((childCategory) =>
      pick(childCategory, ['categoryKey', 'name', 'textColor', 'bgColor', 'icon', 'isSystemCategory']),
    ),
  }));

  return res.json({
    brokers: staticConfigs.brokers,
    categories: categoriesData,
    currencies: staticConfigs.currencies,
    financialInstitutions: staticConfigs.accountFinancialInstitutions,
    financialTransactionTypes: staticConfigs.financialTransactionTypes,
    transactionTypes: staticConfigs.transactionTypes,
  });
}

let staticConfigsCache: null | { expiresAt: number; value: StaticConfigs } = null;
let staticConfigsPending: null | Promise<StaticConfigs> = null;

function getStaticConfigs(): Promise<StaticConfigs> {
  if (staticConfigsCache && staticConfigsCache.expiresAt > Date.now()) return Promise.resolve(staticConfigsCache.value);
  if (staticConfigsPending) return staticConfigsPending;

  staticConfigsPending = Promise.all([
    DI.em.find(TransactionType, {}, { disableIdentityMap: true, fields: ['transactionTypeKey', 'name'], orderBy: { name: QueryOrder.ASC } }),
    DI.em.find(Currency, { isActive: true }, { disableIdentityMap: true, fields: ['currencyKey', 'code', 'description'], orderBy: { code: QueryOrder.ASC } }),
    DI.em.find(
      AccountFinancialInstitution,
      {},
      { disableIdentityMap: true, fields: ['accountFinancialInstitutionKey', 'displayName', 'logoUrl', 'name'], orderBy: { name: QueryOrder.ASC } },
    ),
    DI.em.find(FinancialBroker, {}, { disableIdentityMap: true, fields: ['financialBrokerKey', 'name', 'displayName'] }),
    DI.em.find(FinancialTransactionType, {}, { disableIdentityMap: true, fields: ['financialTransactionTypeKey', 'name'] }),
  ])
    .then(([transactionTypes, currencies, accountFinancialInstitutions, brokers, financialTransactionTypes]) => ({
      accountFinancialInstitutions: accountFinancialInstitutions.map((institution) =>
        pick(institution, ['accountFinancialInstitutionKey', 'displayName', 'logoUrl']),
      ),
      brokers: brokers.map((broker) => pick(broker, ['financialBrokerKey', 'name', 'displayName'])),
      currencies: currencies.map((currency) => pick(currency, ['currencyKey', 'code', 'description'])),
      financialTransactionTypes: financialTransactionTypes.map((financialTransactionType) =>
        pick(financialTransactionType, ['financialTransactionTypeKey', 'name']),
      ),
      transactionTypes: transactionTypes.map((transactionType) => pick(transactionType, ['transactionTypeKey', 'name'])),
    }))
    .then((value) => {
      staticConfigsCache = { expiresAt: Date.now() + STATIC_CONFIGS_TTL_MS, value };
      return value;
    })
    .finally(() => {
      staticConfigsPending = null;
    });

  return staticConfigsPending;
}
