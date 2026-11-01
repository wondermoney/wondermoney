"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { distance } from "fastest-levenshtein";
import { TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo } from "react";
import { HexColorPicker } from "react-colorful";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/Form";
import { Category as CategoryType } from "@/lib/api/category/useCategories";
import useCreateCategory from "@/lib/api/category/useCreateCategory";
import useEditCategory from "@/lib/api/category/useEditCategory";
import { getCategoryTranslationKey } from "@/lib/utils/categories";
import { invalidateCategories } from "@/lib/utils/queryInvalidation";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/Select";
import CategoryIconPicker from "./CategoryIconPicker";

const categoryFormSchema = z.object({
  name: z.string().min(1, "Category name is required"),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Invalid color format"),
  icon: z.string().optional(),
  parentCategoryKey: z.string().nullable(),
});

type CategoryFormData = z.infer<typeof categoryFormSchema>;

// Generate a random hex color
const generateRandomColor = (): string => {
  const letters = "0123456789ABCDEF";
  let color = "#";
  for (let i = 0; i < 6; i++) {
    color += letters[Math.floor(Math.random() * 16)];
  }
  return color;
};

interface CategoryFormProps {
  categories: CategoryType[];
  editingCategory?: CategoryType | null;
  onFormReset?: () => void;
}

const CategoryForm: React.FC<CategoryFormProps> = ({
  categories,
  editingCategory,
  onFormReset,
}) => {
  const queryClient = useQueryClient();
  const t = useTranslations();
  const useCreateCategoryMutation = useCreateCategory();
  const useEditCategoryMutation = useEditCategory();

  const isEditing = !!editingCategory;

  const methods = useForm({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: {
      color: generateRandomColor(),
      name: "",
      icon: "",
      parentCategoryKey: null,
    },
  });

  const {
    handleSubmit,
    formState: { isSubmitting },
    reset,
  } = methods;

  // Watch for changes to detect duplicates
  const watchedName = useWatch({ control: methods.control, name: "name" });
  const watchedColor = useWatch({ control: methods.control, name: "color" });

  // Categories are already flattened, so we can use them directly
  const allCategories = categories;

  // Check for existing category with same or similar name
  const nameCheck = useMemo(() => {
    if (!watchedName || watchedName.trim() === "")
      return { isDuplicate: false, isSimilar: false };

    const trimmedName = watchedName.trim();
    let isDuplicate = false;
    let isSimilar = false;

    allCategories.forEach((category) => {
      if (isEditing && category.categoryKey === editingCategory?.categoryKey) {
        return; // Don't consider the category being edited as a duplicate
      }

      // Exact match
      if (category.name === trimmedName) {
        isDuplicate = true;
        return;
      }

      // Fuzzy match (similar names with small edit distance)
      const editDistance = distance(
        category.name.toLowerCase(),
        trimmedName.toLowerCase(),
      );
      const similarity =
        editDistance / Math.max(category.name.length, trimmedName.length);

      // Consider it similar if edit distance is <= 2 and similarity ratio < 0.3
      if (editDistance <= 2 && similarity < 0.3 && category.name.length > 2) {
        isSimilar = true;
      }
    });

    return { isDuplicate, isSimilar };
  }, [allCategories, watchedName, isEditing, editingCategory]);

  // Check for existing category with same color
  const isDuplicateColor = useMemo(() => {
    if (!watchedColor) return false;

    return allCategories.some((category) => {
      if (isEditing && category.categoryKey === editingCategory?.categoryKey) {
        return false; // Don't consider the category being edited as a duplicate
      }
      return category.bgColor === watchedColor;
    });
  }, [allCategories, watchedColor, isEditing, editingCategory]);

  // Update form when editing category changes
  useEffect(() => {
    if (editingCategory) {
      reset({
        name: editingCategory.name,
        color: editingCategory.bgColor,
        icon: editingCategory.icon || "",
        parentCategoryKey: null, // Categories don't track parent relationships in the form
      });
    } else {
      reset({
        color: generateRandomColor(),
        name: "",
        icon: "",
        parentCategoryKey: null,
      });
    }
  }, [editingCategory, reset]);

  const onSubmit = useCallback(
    async (data: CategoryFormData) => {
      try {
        if (isEditing && editingCategory) {
          await useEditCategoryMutation.mutateAsync({
            categoryKey: editingCategory.categoryKey,
            name: data.name,
            color: data.color,
            icon: data.icon,
          });
          toast.success(t("toast-update-category-success"));
        } else {
          await useCreateCategoryMutation.mutateAsync({
            name: data.name,
            color: data.color,
            icon: data.icon,
            parentCategoryKey: data.parentCategoryKey ?? undefined,
          });
          toast.success(t("toast-create-category-success"));
        }

        await invalidateCategories(queryClient);

        reset({
          color: generateRandomColor(),
          name: "",
          icon: "",
          parentCategoryKey: null,
        });

        onFormReset?.();
      } catch (error) {
        console.error("Error saving category:", error);
      }
    },
    [
      isEditing,
      editingCategory,
      useEditCategoryMutation,
      useCreateCategoryMutation,
      queryClient,
      reset,
      onFormReset,
      t,
    ],
  );

  const handleCancel = useCallback(() => {
    reset({
      color: generateRandomColor(),
      name: "",
      icon: "",
      parentCategoryKey: null,
    });
    onFormReset?.();
  }, [reset, onFormReset]);

  return (
    <div className="space-y-4">
      {isEditing && (
        <div className="rounded-md p-3">
          <p className="text-info-text text-sm">
            {t("editing-category")}: <strong>{editingCategory.name}</strong>
          </p>
        </div>
      )}

      <Form {...methods}>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <FormField
              control={methods.control}
              name="color"
              render={({ field: { onChange, value } }) => (
                <FormItem>
                  <FormLabel className="font-semibold" required>
                    {t("color")}
                  </FormLabel>
                  <FormControl>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="input"
                          className="w-full justify-start"
                          type="button"
                        >
                          <div
                            className="mr-2 size-4 rounded-full border"
                            style={{ backgroundColor: value }}
                          />
                          {value}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-64">
                        <HexColorPicker
                          color={value || ""}
                          onChange={onChange}
                        />
                        <div className="mt-2">
                          <Input
                            value={value || ""}
                            onChange={(e) => onChange(e.target.value)}
                            placeholder="#000000"
                            className="text-center"
                          />
                        </div>
                      </PopoverContent>
                    </Popover>
                  </FormControl>
                  {isDuplicateColor && (
                    <div className="text-warning-text flex items-center gap-1 text-sm">
                      <TriangleAlert className="size-4" />
                      {t("color-already-in-use")}
                    </div>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={methods.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-semibold" required>
                    {t("name")}
                  </FormLabel>
                  <FormControl>
                    <Input type="text" placeholder={t("name")} {...field} />
                  </FormControl>
                  {nameCheck.isDuplicate && (
                    <div className="text-warning-text flex items-center gap-1 text-sm">
                      <TriangleAlert className="size-4" />
                      {t("name-already-in-use")}
                    </div>
                  )}
                  {!nameCheck.isDuplicate && nameCheck.isSimilar && (
                    <div className="text-warning-text flex items-center gap-1 text-sm">
                      <TriangleAlert className="size-4" />
                      {t("similar-name-exists")}
                    </div>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={methods.control}
              name="icon"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-semibold" required>
                    {t("icon")}
                  </FormLabel>
                  <FormControl>
                    <CategoryIconPicker
                      selectedIcon={field.value}
                      onIconSelect={field.onChange}
                      color={watchedColor}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={methods.control}
              name="parentCategoryKey"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-semibold">
                    {t("parent-category")}
                  </FormLabel>
                  <Select
                    value={field.value ?? "none"}
                    onValueChange={(value) =>
                      field.onChange(value === "none" ? null : value)
                    }
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={t("none")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="none">{t("none")}</SelectItem>
                      {categories
                        .filter(
                          (c) =>
                            !c.childCategory || c.childCategory.length === 0,
                        ) // Only show parent categories
                        .map((c) => (
                          <SelectItem
                            key={c.categoryKey}
                            value={c.categoryKey.toString()}
                            disabled={
                              isEditing &&
                              c.categoryKey === editingCategory?.categoryKey
                            }
                          >
                            <div className="flex items-center gap-2">
                              <div
                                className="size-3 rounded-full"
                                style={{ backgroundColor: c.bgColor }}
                              />
                              {c.isSystemCategory
                                ? t(getCategoryTranslationKey(c.name))
                                : c.name}
                            </div>
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="flex gap-2 pt-2">
            <Button
              type="submit"
              loading={isSubmitting}
              disabled={isSubmitting}
              className="flex-1 md:flex-none"
            >
              {isEditing ? t("update") : t("create")}
            </Button>

            {isEditing && (
              <Button
                type="button"
                variant="outline"
                onClick={handleCancel}
                className="flex-1 md:flex-none"
              >
                {t("cancel")}
              </Button>
            )}
          </div>
        </form>
      </Form>
    </div>
  );
};

export default CategoryForm;
