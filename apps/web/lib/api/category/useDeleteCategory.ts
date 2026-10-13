import { useMutation } from "@tanstack/react-query";

import api from "../api";

export interface CategoryDeleteRequest {
  categoryKey: number;
}

const useEditCategory = () => {
  return useMutation({
    mutationFn: ({ categoryKey }: CategoryDeleteRequest) =>
      api.delete(`/v1/category/${categoryKey}`),
  });
};

export default useEditCategory;
