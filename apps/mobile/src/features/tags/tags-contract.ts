import { z } from 'zod'

import { readEndpoint, writeEndpoint } from '@/lib/api/runtime-schema'

/** The API's default for a tag created without a colour; also what an unreadable colour reads as. */
export const DEFAULT_TAG_COLOR = '#94a3b8'
/** The API caps a transaction at this many tags. */
export const MAX_TAGS_PER_TRANSACTION = 50
export const TAG_NAME_MAX_LENGTH = 64

const id = z.number().int().positive().safe()
const hexColor = /^#[0-9a-f]{6}$/i

/**
 * A household tag as `/v1/tag` and every transaction row return it. The colour
 * is tolerated rather than required: a missing or non-hex value reads as the
 * default grey, so one odd row never fails a whole transaction list.
 */
export const tagSchema = z.object({
  tagKey: id,
  name: z.string().min(1).max(255),
  color: z.string().nullish(),
}).transform((tag) => ({
  tagKey: tag.tagKey,
  name: tag.name,
  color: tag.color && hexColor.test(tag.color) ? tag.color.toLowerCase() : DEFAULT_TAG_COLOR,
}))

export type TagDto = z.infer<typeof tagSchema>

export const tagsResponseSchema = z.object({ tags: z.array(tagSchema) })

export const tagsEndpoint = readEndpoint({
  method: 'GET',
  path: '/v1/tag',
  schema: tagsResponseSchema,
})

/** A new tag's name, trimmed, as the API validates it. */
export const tagNameSchema = z.string().trim().min(1).max(TAG_NAME_MAX_LENGTH)

export const createTagEndpoint = writeEndpoint({
  method: 'POST',
  path: '/v1/tag',
  schema: z.object({ tag: tagSchema }),
  successStatuses: [201],
})

/** The tag keys a transaction should carry: positive, each once, at most fifty. */
export function freezeTagIds(tagIds: readonly number[]): readonly number[] {
  const unique = [...new Set(tagIds.map((value) => id.parse(value)))]
  if (unique.length > MAX_TAGS_PER_TRANSACTION) throw new Error(`At most ${MAX_TAGS_PER_TRANSACTION} tags per transaction.`)
  return Object.freeze(unique)
}

/** `PUT /v1/account/transaction/:id/tags` replaces the list and answers the new one. */
export function createSetTransactionTagsEndpoint(transactionId: number) {
  return writeEndpoint({
    method: 'PUT',
    path: `/v1/account/transaction/${id.parse(transactionId)}/tags`,
    schema: z.object({ tags: z.array(tagSchema) }),
  })
}

/** Case- and space-insensitive, the way the API decides two names are the same tag. */
export const sameTagName = (left: string, right: string) => (
  left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase()
)
