import {
  type QueryClient,
  useMutation,
  useQuery,
  type UseQueryOptions,
} from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";

/**
 * A household tag, as `/v1/tag` and every transaction row return it.
 *
 * Tags belong to the household, not to a member: both partners see and edit the
 * same list. Names are unique per household ignoring case (409 `tag_name_taken`).
 */
export interface Tag {
  tagKey: number;
  name: string;
  /** `#rrggbb`, lower case. */
  color: string;
}

export interface GetTagsResponse {
  tags: Tag[];
}

/** The API's own default; a tag created without a colour gets it. */
export const DEFAULT_TAG_COLOR = "#94a3b8";

/** The API caps a transaction at this many tags. */
export const MAX_TAGS_PER_TRANSACTION = 50;

export const tagsKey = ["tags"] as const;

export async function getTags(
  apiClient: AxiosInstance = api,
): Promise<GetTagsResponse> {
  const { data } = await apiClient.get<GetTagsResponse>("/v1/tag");
  return data;
}

export default function useTags<R = GetTagsResponse>(
  options?: Omit<
    UseQueryOptions<GetTagsResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: tagsKey,
    queryFn: () => getTags(),
    ...options,
  });
}

/**
 * After a tag is renamed, recoloured or deleted, every list that renders it is
 * stale: the tag list itself, both transaction lists (rows carry their tags) and
 * any report filtered by it.
 */
export const invalidateTags = async (qc: QueryClient) => {
  await Promise.all([
    qc.invalidateQueries({ queryKey: tagsKey }),
    qc.invalidateQueries({ queryKey: ["accounts-transactions"] }),
    qc.invalidateQueries({ queryKey: ["accounts-transactions-infinite"] }),
    qc.invalidateQueries({ queryKey: ["account-transactions"] }),
    qc.invalidateQueries({ queryKey: ["reports"] }),
  ]);
};

export interface CreateTagRequest {
  name: string;
  color?: string;
}

export function useCreateTag() {
  return useMutation({
    mutationFn: async (request: CreateTagRequest) => {
      const { data } = await api.post<{ tag: Tag }>("/v1/tag", request);
      return data.tag;
    },
  });
}

export interface EditTagRequest {
  tagKey: number;
  name?: string;
  color?: string;
}

export function useEditTag() {
  return useMutation({
    mutationFn: async ({ tagKey, ...changes }: EditTagRequest) => {
      const { data } = await api.patch<{ tag: Tag }>(
        `/v1/tag/${tagKey}`,
        changes,
      );
      return data.tag;
    },
  });
}

export function useDeleteTag() {
  return useMutation({
    mutationFn: (tagKey: number) => api.delete(`/v1/tag/${tagKey}`),
  });
}

export interface SetTransactionTagsRequest {
  transactionKey: number;
  tagKeys: number[];
}

/** Replaces the transaction's tags with exactly `tagKeys` and answers the new list. */
export function useSetTransactionTags() {
  return useMutation({
    mutationFn: async ({
      transactionKey,
      tagKeys,
    }: SetTransactionTagsRequest) => {
      const { data } = await api.put<{ tags: Tag[] }>(
        `/v1/account/transaction/${transactionKey}/tags`,
        { tagIds: tagKeys },
      );
      return data.tags;
    },
  });
}
