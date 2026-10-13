import { Category } from '@entity/Category';

import { ExtendedEntityRepository } from './_ExtendedEntityRepository';

export class CategoryRepository extends ExtendedEntityRepository<Category> {
  public getBudgetDefaultCategories = () => {
    return this.find({ deletedAt: undefined, isDefaultBudgetCategory: true }, { populate: ['parentCategory'] });
  };
}
