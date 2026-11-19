// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { AxiosError } from "axios";
import type { ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";

import api from "../api";
import useLinkLoanRepayment from "./useLinkLoanRepayment";

const originalAdapter = api.defaults.adapter;

afterEach(() => {
  cleanup();
  api.defaults.adapter = originalAdapter;
});

test("links a mortgage payment using the selected transaction and the reviewed allocation", async () => {
  const allocation = {
    totalPaymentAmount: 508.63,
    principalAmount: 152.59,
    interestAmount: 356.04,
    feeAmount: 0,
  };
  api.defaults.adapter = async (config) => {
    const url = new URL(api.getUri(config));
    const response = {
      config,
      data: {},
      headers: {},
      status: 201,
      statusText: "Created",
    };
    if (url.searchParams.get("transactionKey") !== "77") {
      throw new AxiosError(
        "Missing or incorrect transactionKey query parameter",
        AxiosError.ERR_BAD_REQUEST,
        config,
        undefined,
        { ...response, status: 400, statusText: "Bad Request" },
      );
    }

    expect(config.method).toBe("post");
    expect(url.pathname).toBe("/v1/loan/11/repayments/link");
    expect(JSON.parse(config.data)).toEqual(allocation);
    return response;
  };

  const client = new QueryClient();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useLinkLoanRepayment(), { wrapper });

  await act(async () => {
    await expect(
      result.current.mutateAsync({
        loanId: 11,
        payload: { transactionKey: 77, ...allocation },
      }),
    ).resolves.toMatchObject({ status: 201 });
  });

  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["loan", 11] });
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: ["loan", 11, "repayments"],
  });
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: ["loan", 11, "repayment-candidates"],
  });
});
