import spec from '../openapi/wondermoney.json';
import { ApiReference } from './api-reference';
import type { Document, HttpMethods, OperationItem } from 'fumadocs-openapi';

const methods = new Set<HttpMethods>(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);
const operations: OperationItem[] = Object.entries(spec.paths).flatMap(([path, item]) =>
  Object.entries(item ?? {}).flatMap(([method]) =>
    methods.has(method as HttpMethods) ? [{ path, method: method as HttpMethods }] : [],
  ),
);

export default function ApiReferencePage() {
  return <ApiReference document={spec as unknown as Document} operations={operations} />;
}
