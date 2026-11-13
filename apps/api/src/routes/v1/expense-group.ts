import express from 'express';

import {
  addExpenseGroupMember,
  createExpenseGroup,
  deleteExpenseGroup,
  deleteGroupSettlement,
  getExpenseGroup,
  getGroupBalances,
  getGroupExpense,
  getSettlementSuggestions,
  listExpenseGroups,
  listGroupExpenses,
  listGroupSettlements,
  recordGroupSettlement,
  removeExpenseGroupMember,
  shareGroupExpense,
  unshareGroupExpense,
  updateExpenseGroup,
  updateExpenseGroupMember,
} from '@controller/expense-group';

const router = express.Router();

router.get('/', listExpenseGroups);
router.post('/', createExpenseGroup);
router.get('/:groupId', getExpenseGroup);
router.patch('/:groupId', updateExpenseGroup);
router.delete('/:groupId', deleteExpenseGroup);
router.get('/:groupId/balances', getGroupBalances);
router.post('/:groupId/members', addExpenseGroupMember);
router.patch('/:groupId/members/:memberId', updateExpenseGroupMember);
router.delete('/:groupId/members/:memberId', removeExpenseGroupMember);
router.get('/:groupId/shares', listGroupExpenses);
router.post('/:groupId/shares', shareGroupExpense);
router.get('/:groupId/shares/:transactionId', getGroupExpense);
router.delete('/:groupId/shares/:transactionId', unshareGroupExpense);
router.get('/:groupId/settlements/suggestions', getSettlementSuggestions);
router.get('/:groupId/settlements', listGroupSettlements);
router.post('/:groupId/settlements', recordGroupSettlement);
router.delete('/:groupId/settlements/:settlementId', deleteGroupSettlement);

export default router;
