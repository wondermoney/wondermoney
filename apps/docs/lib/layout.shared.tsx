import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import type { Locale } from './i18n';
import { appName, gitConfig, mainSiteUrl, supportUrl } from './shared';

const labels: Record<Locale, { docs: string; mainSite: string; support: string }> = {
  en: {
    docs: 'Documentation',
    mainSite: 'Main site',
    support: 'Support',
  },
  pt: {
    docs: 'Documentação',
    mainSite: 'Site principal',
    support: 'Suporte',
  },
  es: {
    docs: 'Documentación',
    mainSite: 'Sitio principal',
    support: 'Soporte',
  },
};

export function baseOptions(locale: Locale): BaseLayoutProps {
  const copy = labels[locale];

  return {
    nav: {
      title: appName,
      url: `/${locale}`,
    },
    links: [
      {
        text: copy.docs,
        url: `/${locale}/docs`,
        active: 'nested-url',
      },
      {
        text: copy.mainSite,
        url: mainSiteUrl,
        external: true,
      },
      {
        text: copy.support,
        url: supportUrl,
        external: true,
      },
    ],
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
