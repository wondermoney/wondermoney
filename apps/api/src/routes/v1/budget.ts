import express from 'express';

import {
  addBudgetCategory,
  createBudget,
  deleteBudget,
  deleteBudgetCategory,
  editBudget,
  getBudget,
  getBudgetAccounts,
  getBudgets,
  getBudgetsFull,
  getBudgetTemplateByYear,
  getBudgetTemplateByYearAndMonth,
  getBudgetTemplateByYearUntilMonth,
  removeCategoryFromBudget,
  updateBudgetAccounts,
  updateBudgetCategory,
  updateBudgetTemplateAccounts,
} from '@controller/budget';

const router = express.Router();

router.get('/', getBudgets);
router.get('/full', getBudgetsFull);
router.get('/:budgetKey', getBudget);
router.get('/:budgetKey/accounts', getBudgetAccounts);
router.get('/:budgetKey/:year/:month', getBudgetTemplateByYearAndMonth);
router.get('/:budgetKey/:year', getBudgetTemplateByYear);
router.get('/:budgetKey/:year/until/:month', getBudgetTemplateByYearUntilMonth);
router.post('/:budgetKey/category', addBudgetCategory);
router.delete('/:budgetKey/category/:categoryKey', removeCategoryFromBudget);
router.patch('/:budgetKey/accounts', updateBudgetAccounts);
router.patch('/:budgetKey/:budgetTemplateCategoryKey', updateBudgetTemplateAccounts);
router.patch('/:budgetKey/:year/:month/:categoryKey', updateBudgetCategory);
router.delete('/:budgetKey/:year/:month/:categoryKey', deleteBudgetCategory);
router.post('/', createBudget);
router.patch('/:budgetKey', editBudget);
router.delete('/:budgetKey', deleteBudget);

export default router;
