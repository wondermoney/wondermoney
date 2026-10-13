import { useMutation } from "@tanstack/react-query";

import api from "../api";

export interface CategoryEditRequest {
  categoryKey: number;
  name?: string;
  icon?: string;
  color?: string;
}

export interface CategoryEditResponse {
  categoryKey: number;
  name: string;
  icon?: string;
  color?: string;
}

const useEditCategory = () => {
  return useMutation({
    mutationFn: ({ categoryKey, name, icon, color }: CategoryEditRequest) =>
      api.patch<CategoryEditRequest>(`/v1/category/${categoryKey}`, {
        name,
        icon,
        color,
      }),
  });
};

export default useEditCategory;
