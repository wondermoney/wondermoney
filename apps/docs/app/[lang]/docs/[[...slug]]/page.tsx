import { getPageImage, getPageMarkdownUrl, source } from '@/lib/source';
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  MarkdownCopyButton,
  ViewOptionsPopover,
} from 'fumadocs-ui/layouts/docs/page';
import { notFound } from 'next/navigation';
import { getMDXComponents } from '@/components/mdx';
import type { Metadata } from 'next';
import { createRelativeLink } from 'fumadocs-ui/mdx';
import { gitConfig } from '@/lib/shared';
import { isLocale } from '@/lib/i18n';
import { absoluteUrl, docsLanguageAlternates } from '@/lib/metadata';
import { breadcrumbJsonLd, docsBreadcrumbItems, docsPageJsonLd } from '@/lib/schema';
import { JsonLd } from '@/components/json-ld';

export default async function Page(props: PageProps<'/[lang]/docs/[[...slug]]'>) {
  const params = await props.params;
  if (!isLocale(params.lang)) notFound();

  const page = source.getPage(params.slug, params.lang);
  if (!page) notFound();

  const MDX = page.data.body;
  const markdownUrl = getPageMarkdownUrl(page).url;
  const pageUrl = absoluteUrl(page.url);
  const breadcrumbItems = docsBreadcrumbItems(params.lang, page.slugs, page.data.title);

  return (
    <>
      <JsonLd data={docsPageJsonLd({ locale: params.lang, title: page.data.title, description: page.data.description, url: pageUrl })} />
      <JsonLd data={breadcrumbJsonLd(breadcrumbItems)} />
      <DocsPage toc={page.data.toc} full={page.data.full}>
        <DocsTitle>{page.data.title}</DocsTitle>
        <DocsDescription className="mb-0">{page.data.description}</DocsDescription>
        <div className="flex flex-row items-center gap-2 border-b pb-6">
          <MarkdownCopyButton markdownUrl={markdownUrl} />
          <ViewOptionsPopover
            markdownUrl={markdownUrl}
            githubUrl={`https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.branch}/content/docs/${page.path}`}
          />
        </div>
        <DocsBody>
          <MDX
            components={getMDXComponents({
              a: createRelativeLink(source, page),
            })}
          />
        </DocsBody>
      </DocsPage>
    </>
  );
}

export async function generateStaticParams() {
  return source.generateParams('slug', 'lang');
}

export async function generateMetadata(
  props: PageProps<'/[lang]/docs/[[...slug]]'>,
): Promise<Metadata> {
  const params = await props.params;
  if (!isLocale(params.lang)) notFound();

  const page = source.getPage(params.slug, params.lang);
  if (!page) notFound();

  return {
    title: page.data.title,
    description: page.data.description,
    alternates: {
      canonical: absoluteUrl(page.url),
      languages: docsLanguageAlternates(page.slugs),
    },
    openGraph: {
      title: page.data.title,
      description: page.data.description,
      url: absoluteUrl(page.url),
      images: getPageImage(page).url,
    },
  };
}
