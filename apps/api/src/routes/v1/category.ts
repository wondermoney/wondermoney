import express from 'express';

import { createCategory, deleteCategory, getCategories, updateCategory } from '@controller/category';

const router = express.Router();

router.get('/', getCategories);
router.post('/', createCategory);
router.patch('/:categoryId', updateCategory);
router.delete('/:categoryId', deleteCategory);

export default router;
