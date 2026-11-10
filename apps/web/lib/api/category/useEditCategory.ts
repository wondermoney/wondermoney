import { useMutation } from "@tanstack/react-query";

import api from "../api";

export interface CategoryEditRequest {
  categoryKey: number;
  name?: string;
  icon?: string;
  color?: string;
  countsAsSpending?: boolean;
}

const useEditCategory = () => {
  return useMutation({
    mutationFn: ({
      categoryKey,
      name,
      icon,
      color,
      countsAsSpending,
    }: CategoryEditRequest) =>
      api.patch<CategoryEditRequest>(`/v1/category/${categoryKey}`, {
        name,
        icon,
        color,
        countsAsSpending,
      }),
  });
};

export default useEditCategory;
