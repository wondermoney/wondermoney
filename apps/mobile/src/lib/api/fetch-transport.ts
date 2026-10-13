import type { HttpRequest, HttpTransport } from './client'

export type FetchTransportOptions = Readonly<{
  baseUrl: string
  fetchImpl?: typeof fetch
}>

const invalidBaseUrl = () => new Error('Invalid API base URL.')
const invalidEndpointPath = () => new Error('Invalid API endpoint path.')

const parseBaseUrl = (value: string): URL => {
  try {
    const url = new URL(value)
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:')
      || url.username !== ''
      || url.password !== ''
      || (url.pathname !== '' && url.pathname !== '/')
      || url.search !== ''
      || url.hash !== ''
    ) throw invalidBaseUrl()
    return url
  } catch {
    throw invalidBaseUrl()
  }
}

const endpointUrl = (baseUrl: URL, path: unknown): URL => {
  if (typeof path !== 'string' || !path.startsWith('/v1/') || path.includes('#') || path.includes('\\')) {
    throw invalidEndpointPath()
  }

  try {
    const url = new URL(path, baseUrl)
    const decodedPathname = decodeURIComponent(url.pathname).replace(/\\/g, '/')
    if (
      url.origin !== baseUrl.origin
      || !url.pathname.startsWith('/v1/')
      || !decodedPathname.startsWith('/v1/')
      || decodedPathname.split('/').includes('..')
    ) throw invalidEndpointPath()
    return url
  } catch {
    throw invalidEndpointPath()
  }
}

const serializeBody = (body: unknown): string => {
  try {
    const serialized = JSON.stringify(body)
    if (serialized === undefined) throw new Error()
    return serialized
  } catch {
    throw new Error('Request body could not be serialized.')
  }
}

const parseResponseBody = async (
  response: Response,
  method: HttpRequest['method'],
  responseType: HttpRequest['responseType'],
): Promise<unknown> => {
  if (method === 'HEAD' || response.status === 204) return undefined

  const text = await response.text()
  if (responseType === 'text') return text
  if (text.length === 0) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

export const createFetchTransport = ({
  baseUrl,
  fetchImpl = globalThis.fetch,
}: FetchTransportOptions): HttpTransport => {
  const validatedBaseUrl = parseBaseUrl(baseUrl)

  return {
    request: async (request) => {
      const url = endpointUrl(validatedBaseUrl, request.path)
      const headers: Record<string, string> = {
        Authorization: request.headers.Authorization,
        Accept: 'application/json',
      }
      const canHaveBody = request.method !== 'GET' && request.method !== 'HEAD'
      const rawBody = canHaveBody ? request.body : undefined
      // multipart/form-data uploads (currently only OCR receipt-scan) skip JSON serialization and
      // let fetch set its own boundary-bearing Content-Type; every other endpoint sends a plain
      // JSON-serializable body and is unaffected.
      const isFormData = rawBody instanceof FormData
      const body = rawBody === undefined ? undefined : isFormData ? rawBody : serializeBody(rawBody)
      if (body !== undefined && !isFormData) headers['Content-Type'] = 'application/json'

      const response = await fetchImpl(url.toString(), {
        method: request.method,
        headers,
        ...(body === undefined ? {} : { body }),
        signal: request.signal,
        credentials: 'omit',
        redirect: 'error',
      })

      return {
        status: response.status,
        body: await parseResponseBody(response, request.method, request.responseType),
      }
    },
  }
}
