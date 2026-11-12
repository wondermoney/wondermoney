import defaultMdxComponents from 'fumadocs-ui/mdx';
import { DocsImage } from '@/components/docs-image';
import ApiReferencePage from '@/components/ApiReference';
import type { MDXComponents } from 'mdx/types';

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    DocsImage,
    ApiReferencePage,
    ...components,
  } satisfies MDXComponents;
}

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
