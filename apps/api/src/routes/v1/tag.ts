import express from 'express';

import { createTag, deleteTag, getTags, updateTag } from '@controller/tag';

const router = express.Router();

router.get('/', getTags);
router.post('/', createTag);
router.patch('/:tagId', updateTag);
router.delete('/:tagId', deleteTag);

export default router;
