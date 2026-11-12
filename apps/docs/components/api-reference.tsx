'use client';

import { createOpenAPIPage } from 'fumadocs-openapi/ui';
import type { Document, OperationItem } from 'fumadocs-openapi';

const OpenAPIPage = createOpenAPIPage();

export function ApiReference({ document, operations }: { document: Document; operations: OperationItem[] }) {
  return (
    <div className="not-prose my-8">
      <OpenAPIPage payload={{ bundled: document }} operations={operations} showTitle={false} showDescription={false} />
    </div>
  );
}
