import express from 'express';

import {
  assignGoalMoney,
  createGoal,
  deleteGoal,
  deleteGoalAccount,
  deleteGoalTransactionFunding,
  fundGoalTransaction,
  getAvailableToAssign,
  getGoal,
  getGoalActivity,
  getGoalDebtStrategy,
  linkGoalAccount,
  listGoals,
  moveGoalMoneyOut,
  restoreGoal,
  updateGoal,
} from '@controller/goal';

const router = express.Router();

router.get('/', listGoals);
router.post('/', createGoal);
router.get('/available-to-assign', getAvailableToAssign);
router.get('/debt-strategy', getGoalDebtStrategy);
router.get('/:goalKey/activity', getGoalActivity);
router.post('/:goalKey/assign', assignGoalMoney);
router.post('/:goalKey/move-out', moveGoalMoneyOut);
router.post('/:goalKey/fund-transaction', fundGoalTransaction);
router.delete('/:goalKey/fund-transaction/:fundingKey', deleteGoalTransactionFunding);
router.post('/:goalKey/accounts', linkGoalAccount);
router.delete('/:goalKey/accounts/:accountKey', deleteGoalAccount);
router.get('/:goalKey', getGoal);
router.patch('/:goalKey', updateGoal);
router.delete('/:goalKey', deleteGoal);
router.post('/:goalKey/restore', restoreGoal);

export default router;
