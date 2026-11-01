"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import useCategories from "@/lib/api/category/useCategories";

import { Spinner } from "../ui/Spinner";
import { Heading, Text } from "../ui/Typography";
import CategoriesTable from "./CategoriesTable";
import CategoryForm from "./CategoryForm";
import { CategoryWithUI, transformCategoryToUI } from "./types";

const UserCategoriesTable: React.FC = () => {
  const t = useTranslations();
  const [editingCategory, setEditingCategory] = useState<CategoryWithUI | null>(
    null,
  );

  const { data, isLoading } = useCategories(undefined, {
    select: (data) => {
      if (data.categories.length > 0) {
        return {
          categories: data.categories
            .map((c) => transformCategoryToUI(c))
            .sort((a, b) => {
              // System categories first, custom categories at the bottom
              if (a.isSystemCategory && !b.isSystemCategory) return -1;
              if (!a.isSystemCategory && b.isSystemCategory) return 1;
              return 0;
            }),
        };
      }
      return { categories: [] };
    },
  });

  const handleEditCategory = (category: CategoryWithUI) => {
    setEditingCategory(category);
  };

  const handleFormReset = () => {
    setEditingCategory(null);
  };

  const categories = data?.categories;
  const allCategoriesFlattened = useMemo(() => {
    if (!categories) return [];

    return categories.flatMap((c) => [
      {
        name: c.name,
        categoryKey: c.categoryKey,
        textColor: c.textColor,
        bgColor: c.bgColor,
        icon: c.icon,
        isSystemCategory: c.isSystemCategory,
      },
      ...c.subRows.map((subCategory) => ({
        name: subCategory.name,
        categoryKey: subCategory.categoryKey,
        textColor: subCategory.textColor,
        bgColor: subCategory.bgColor,
        icon: subCategory.icon,
        isSystemCategory: subCategory.isSystemCategory,
      })),
    ]);
  }, [categories]);

  if (isLoading || !data) {
    return <Spinner />;
  }

  return (
    <div className="space-y-6">
      <div>
        <Heading variant="h2">{t("navigation.categories")}</Heading>
        <Text variant="lead" className="mt-1 text-sm">
          {t("categories-description")}
        </Text>
      </div>

      <CategoriesTable
        categories={data.categories}
        onEditCategory={handleEditCategory}
      />

      <div className="space-y-6">
        <Heading variant="h4">
          {editingCategory ? t("edit-category") : t("add-category")}
        </Heading>
        <CategoryForm
          categories={allCategoriesFlattened}
          editingCategory={
            editingCategory
              ? {
                  name: editingCategory.name,
                  categoryKey: editingCategory.categoryKey,
                  textColor: editingCategory.textColor,
                  bgColor: editingCategory.bgColor,
                  icon: editingCategory.icon,
                  isSystemCategory: editingCategory.isSystemCategory,
                }
              : null
          }
          onFormReset={handleFormReset}
        />
      </div>
    </div>
  );
};

export default UserCategoriesTable;
