import { useMutation } from "@tanstack/react-query";

import api from "../api";

export interface CreateCategoryRequest {
  name: string;
  icon?: string;
  color?: string;
  parentCategoryKey?: string;
}

export interface CreateCategoryResponse {
  category: {
    categoryKey: number;
    name: string;
    icon?: string;
    color?: string;
  };
}

const useCreateCategory = () => {
  return useMutation({
    mutationFn: ({
      name,
      icon,
      color,
      parentCategoryKey,
    }: CreateCategoryRequest) =>
      api.post<CreateCategoryResponse>(`/v1/category`, {
        name,
        icon,
        color,
        parentCategoryKey,
      }),
  });
};

export default useCreateCategory;
