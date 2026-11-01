import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";

export interface ChildCategory {
  categoryKey: number;
  name: string;
  bgColor: string;
  textColor: string;
  icon?: string;
  isSystemCategory: boolean;
}

export interface Category extends ChildCategory {
  childCategory?: ChildCategory[];
}

export interface CategoryRow extends Omit<Category, "childCategory"> {
  subRows: CategoryRow[];
  parentCategoryKey?: number | null;
}

export interface GetCategoriesResponse {
  categories: Category[];
}

async function getCategories(
  apiClient: AxiosInstance = api,
): Promise<GetCategoriesResponse> {
  const { data } = await apiClient.get<GetCategoriesResponse>("/v1/category");
  return data;
}

export default function useCategories<R = GetCategoriesResponse>(
  params?: { fromDate?: Date },
  options?: Omit<
    UseQueryOptions<GetCategoriesResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["categories", params],
    queryFn: () => getCategories(),
    ...options,
  });
}
