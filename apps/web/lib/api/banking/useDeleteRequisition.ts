import { useMutation } from "@tanstack/react-query";

import api from "../api";

export interface RequisitionDeleteRequest {
  requisitionKey: string | number;
}

const useDeleteRequisition = () => {
  return useMutation({
    mutationFn: ({ requisitionKey }: RequisitionDeleteRequest) =>
      api.delete(`/v1/banking/requisition/${requisitionKey}`),
  });
};

export default useDeleteRequisition;
