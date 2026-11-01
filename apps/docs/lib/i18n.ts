import { defineI18n } from 'fumadocs-core/i18n';
import { i18nProvider, uiTranslations } from 'fumadocs-ui/i18n';

export const locales = ['en', 'pt', 'es'] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale = 'en' satisfies Locale;

export const i18n = defineI18n({
  languages: [...locales],
  defaultLanguage: defaultLocale,
  hideLocale: 'never',
  parser: 'dir',
});

export function isLocale(value: string): value is Locale {
  return locales.includes(value as Locale);
}

const translations = i18n
  .translations()
  .extend(uiTranslations())
  .add('ui', {
    pt: {
      search: 'Pesquisar',
      searchNoResult: 'Sem resultados',
      searchOpen: 'Abrir pesquisa',
      searchClose: 'Fechar pesquisa',
      toc: 'Nesta página',
      tocNoHeadings: 'Sem títulos',
      tocInline: 'Nesta página',
      chooseLanguage: 'Escolher idioma',
      nextPage: 'Página seguinte',
      previousPage: 'Página anterior',
      chooseTheme: 'Escolher tema',
      editOnGithub: 'Editar no GitHub',
      themeToggle: 'Alternar tema',
      themeLight: 'Claro',
      themeDark: 'Escuro',
      themeSystem: 'Sistema',
      codeBlockCopy: 'Copiar código',
      codeBlockCopied: 'Copiado',
      accordionCopyAnchor: 'Copiar ligação da secção',
      headingCopyAnchor: 'Copiar ligação da secção',
      pageActionsCopyMarkdown: 'Copiar Markdown',
      pageActionsOpen: 'Abrir ações da página',
      pageActionsOpenGitHub: 'Abrir no GitHub',
      pageActionsViewMarkdown: 'Ver Markdown',
      sidebarOpen: 'Abrir menu',
      sidebarCollapse: 'Recolher menu',
      notFoundTitle: 'Página não encontrada',
      notFoundDescription: 'A página que procura não existe.',
      notFoundLink: 'Voltar à documentação',
    },
    es: {
      search: 'Buscar',
      searchNoResult: 'Sin resultados',
      searchOpen: 'Abrir búsqueda',
      searchClose: 'Cerrar búsqueda',
      toc: 'En esta página',
      tocNoHeadings: 'Sin títulos',
      tocInline: 'En esta página',
      chooseLanguage: 'Elegir idioma',
      nextPage: 'Página siguiente',
      previousPage: 'Página anterior',
      chooseTheme: 'Elegir tema',
      editOnGithub: 'Editar en GitHub',
      themeToggle: 'Cambiar tema',
      themeLight: 'Claro',
      themeDark: 'Oscuro',
      themeSystem: 'Sistema',
      codeBlockCopy: 'Copiar código',
      codeBlockCopied: 'Copiado',
      accordionCopyAnchor: 'Copiar enlace de la sección',
      headingCopyAnchor: 'Copiar enlace de la sección',
      pageActionsCopyMarkdown: 'Copiar Markdown',
      pageActionsOpen: 'Abrir acciones de la página',
      pageActionsOpenGitHub: 'Abrir en GitHub',
      pageActionsViewMarkdown: 'Ver Markdown',
      sidebarOpen: 'Abrir menú',
      sidebarCollapse: 'Cerrar menú',
      notFoundTitle: 'Página no encontrada',
      notFoundDescription: 'La página que buscas no existe.',
      notFoundLink: 'Volver a la documentación',
    },
  });

export function getI18nProvider(locale: string) {
  return i18nProvider(translations, isLocale(locale) ? locale : defaultLocale);
}
