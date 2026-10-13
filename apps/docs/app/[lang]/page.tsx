import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isLocale, type Locale } from '@/lib/i18n';
import { absoluteUrl, homeLanguageAlternates, homePath } from '@/lib/metadata';

type LandingLink = {
  title: string;
  description?: string;
  href: string;
};

function localizedHref(lang: Locale, href: string) {
  return `/${lang}${href.startsWith('/') ? href : `/${href}`}`;
}

function CardLink({ lang, link }: { lang: Locale; link: LandingLink }) {
  return (
    <Link
      href={localizedHref(lang, link.href)}
      className="group rounded-2xl border border-fd-border bg-fd-background p-5 transition hover:border-fd-foreground/20 hover:bg-fd-accent/30"
    >
      <h3 className="text-base font-semibold text-fd-foreground group-hover:text-fd-primary">{link.title}</h3>
      {link.description ? <p className="mt-2 text-sm leading-6 text-fd-muted-foreground">{link.description}</p> : null}
    </Link>
  );
}

function PathStep({ lang, index, link }: { lang: Locale; index: number; link: LandingLink }) {
  return (
    <li>
      <Link href={localizedHref(lang, link.href)} className="flex items-start gap-3 rounded-xl p-2 transition hover:bg-fd-accent/30">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-fd-border text-xs font-semibold text-fd-foreground">
          {index}
        </span>
        <span className="text-sm font-medium leading-6 text-fd-foreground">{link.title}</span>
      </Link>
    </li>
  );
}

type LandingCopy = {
  eyebrow: string;
  title: string;
  description: string;
  primaryCta: string;
  secondaryCta: string;
  tasksTitle: string;
  tasks: LandingLink[];
  pathTitle: string;
  pathDescription: string;
  pathSteps: LandingLink[];
  popularTitle: string;
  popularLinks: LandingLink[];
  supportTitle: string;
  supportDescription: string;
  supportCta: string;
  mainSiteCta: string;
};

const copy: Record<Locale, LandingCopy> = {
  en: {
    eyebrow: 'WonderMoney Docs',
    title: 'What do you need help with?',
    description:
      'Find the right guide for setup, account data, budgets, portfolio metrics, households, security, and troubleshooting.',
    primaryCta: 'Start with setup guide',
    secondaryCta: 'Open all docs',
    tasksTitle: 'Choose a task',
    tasks: [
      {
        title: 'Get started',
        description: 'Create your account, sign in, and understand the dashboard basics.',
        href: '/docs/start-here',
      },
      {
        title: 'Connect or import account data',
        description: 'Connect banks, add manual accounts, import CSV files, and review transactions.',
        href: '/docs/accounts-transactions',
      },
      {
        title: 'Plan your budget',
        description: 'Use envelope-style budgeting, choose categories, and track monthly spending.',
        href: '/docs/budgets',
      },
      {
        title: 'Understand portfolio numbers',
        description: 'Learn portfolio value, returns, allocation, benchmarks, and currency effects.',
        href: '/docs/portfolio-investments/portfolio-metrics-explained',
      },
      {
        title: 'Fix a problem',
        description: 'Troubleshoot sign-in, bank connections, imports, budgets, and portfolio issues.',
        href: '/docs/troubleshooting',
      },
      {
        title: 'Share with your household',
        description: 'Invite a partner, keep accounts private, and manage who is in your household.',
        href: '/docs/household',
      },
      {
        title: 'Manage security and privacy',
        description: 'Review privacy settings, read-only access, and two-factor authentication.',
        href: '/docs/settings-security-privacy',
      },
    ],
    pathTitle: 'Recommended setup path',
    pathDescription: 'New to WonderMoney? Follow this order to start by adding the most useful data.',
    pathSteps: [
      { title: 'Connect your first account', href: '/docs/start-here/connect-first-bank-account' },
      { title: 'Understand transactions', href: '/docs/accounts-transactions/understand-transactions' },
      { title: 'Budget with envelopes', href: '/docs/budgets/envelope-method' },
      { title: 'Understand portfolio metrics', href: '/docs/portfolio-investments/portfolio-metrics-explained' },
    ],
    popularTitle: 'Popular articles',
    popularLinks: [
      { title: 'Create an account', href: '/docs/start-here/create-account' },
      { title: 'Connect your first bank account', href: '/docs/start-here/connect-first-bank-account' },
      { title: 'Understand transactions', href: '/docs/accounts-transactions/understand-transactions' },
      { title: 'Budgeting with the envelope method', href: '/docs/budgets/envelope-method' },
      { title: 'Portfolio metrics explained', href: '/docs/portfolio-investments/portfolio-metrics-explained' },
      { title: 'Glossary', href: '/docs/glossary' },
      { title: 'Contact support', href: '/docs/troubleshooting/contact-support' },
    ],
    supportTitle: 'Still stuck?',
    supportDescription: 'If the docs do not answer your question, contact support or return to the main WonderMoney site.',
    supportCta: 'Contact support',
    mainSiteCta: 'Visit WonderMoney',
  },
  pt: {
    eyebrow: 'Documentação WonderMoney',
    title: 'Em que precisa de ajuda?',
    description:
      'Encontre o guia certo para configuração, dados de contas, orçamentos, métricas de carteira, agregado familiar, segurança e resolução de problemas.',
    primaryCta: 'Começar pelo guia inicial',
    secondaryCta: 'Abrir toda a documentação',
    tasksTitle: 'Escolha uma tarefa',
    tasks: [
      {
        title: 'Começar',
        description: 'Crie a conta, inicie sessão e compreenda as bases do painel.',
        href: '/docs/start-here',
      },
      {
        title: 'Ligar ou importar dados de contas',
        description: 'Ligue bancos, adicione contas manuais, importe ficheiros CSV e reveja movimentos.',
        href: '/docs/accounts-transactions',
      },
      {
        title: 'Planear o orçamento',
        description: 'Use o método dos envelopes, escolha categorias e acompanhe os gastos mensais.',
        href: '/docs/budgets',
      },
      {
        title: 'Compreender os valores da carteira',
        description: 'Veja o valor da carteira, rentabilidades, distribuição, índices de referência e efeitos cambiais.',
        href: '/docs/portfolio-investments/portfolio-metrics-explained',
      },
      {
        title: 'Resolver um problema',
        description: 'Resolva problemas de acesso, ligações bancárias, importações, orçamentos e carteira.',
        href: '/docs/troubleshooting',
      },
      {
        title: 'Partilhar com o seu agregado',
        description: 'Convide um parceiro, mantenha contas privadas e gira quem faz parte do agregado.',
        href: '/docs/household',
      },
      {
        title: 'Gerir segurança e privacidade',
        description: 'Veja definições de privacidade, acesso apenas de leitura e autenticação de dois fatores.',
        href: '/docs/settings-security-privacy',
      },
    ],
    pathTitle: 'Caminho recomendado',
    pathDescription: 'Está a começar na WonderMoney? Siga esta ordem para começar por adicionar os dados mais úteis.',
    pathSteps: [
      { title: 'Ligar a primeira conta', href: '/docs/start-here/connect-first-bank-account' },
      { title: 'Compreender movimentos', href: '/docs/accounts-transactions/understand-transactions' },
      { title: 'Orçamentar com envelopes', href: '/docs/budgets/envelope-method' },
      { title: 'Compreender métricas da carteira', href: '/docs/portfolio-investments/portfolio-metrics-explained' },
    ],
    popularTitle: 'Artigos populares',
    popularLinks: [
      { title: 'Criar uma conta', href: '/docs/start-here/create-account' },
      { title: 'Ligar a primeira conta bancária', href: '/docs/start-here/connect-first-bank-account' },
      { title: 'Compreender movimentos', href: '/docs/accounts-transactions/understand-transactions' },
      { title: 'Orçamentar com o método dos envelopes', href: '/docs/budgets/envelope-method' },
      { title: 'Métricas da carteira explicadas', href: '/docs/portfolio-investments/portfolio-metrics-explained' },
      { title: 'Glossário', href: '/docs/glossary' },
      { title: 'Contactar suporte', href: '/docs/troubleshooting/contact-support' },
    ],
    supportTitle: 'Ainda precisa de ajuda?',
    supportDescription:
      'Se a documentação não responder à sua pergunta, contacte o suporte ou volte ao site principal da WonderMoney.',
    supportCta: 'Contactar suporte',
    mainSiteCta: 'Visitar WonderMoney',
  },
  es: {
    eyebrow: 'Documentación de WonderMoney',
    title: '¿En qué necesitas ayuda?',
    description:
      'Encuentra la guía adecuada para la configuración, datos de cuentas, presupuestos, métricas de cartera, hogar, seguridad y resolución de problemas.',
    primaryCta: 'Empezar por la guía inicial',
    secondaryCta: 'Abrir toda la documentación',
    tasksTitle: 'Elige una tarea',
    tasks: [
      {
        title: 'Empezar',
        description: 'Crea la cuenta, inicia sesión y entiende los aspectos básicos del panel.',
        href: '/docs/start-here',
      },
      {
        title: 'Conectar o importar datos de cuentas',
        description: 'Conecta bancos, añade cuentas manuales, importa archivos CSV y revisa movimientos.',
        href: '/docs/accounts-transactions',
      },
      {
        title: 'Planificar el presupuesto',
        description: 'Usa el método de sobres, elige categorías y haz seguimiento del gasto mensual.',
        href: '/docs/budgets',
      },
      {
        title: 'Entender los valores de la cartera',
        description: 'Consulta el valor de la cartera, rentabilidades, distribución, índices de referencia y efectos cambiarios.',
        href: '/docs/portfolio-investments/portfolio-metrics-explained',
      },
      {
        title: 'Resolver un problema',
        description: 'Soluciona problemas de acceso, conexiones bancarias, importaciones, presupuestos y cartera.',
        href: '/docs/troubleshooting',
      },
      {
        title: 'Compartir con tu hogar',
        description: 'Invita a tu pareja, mantén cuentas privadas y gestiona quién forma parte del hogar.',
        href: '/docs/household',
      },
      {
        title: 'Gestionar seguridad y privacidad',
        description: 'Consulta ajustes de privacidad, acceso de solo lectura y autenticación de dos factores.',
        href: '/docs/settings-security-privacy',
      },
    ],
    pathTitle: 'Camino recomendado',
    pathDescription: '¿Empiezas con WonderMoney? Sigue este orden para empezar añadiendo los datos más útiles.',
    pathSteps: [
      { title: 'Conectar la primera cuenta', href: '/docs/start-here/connect-first-bank-account' },
      { title: 'Entender los movimientos', href: '/docs/accounts-transactions/understand-transactions' },
      { title: 'Presupuestar con sobres', href: '/docs/budgets/envelope-method' },
      { title: 'Entender las métricas de la cartera', href: '/docs/portfolio-investments/portfolio-metrics-explained' },
    ],
    popularTitle: 'Artículos populares',
    popularLinks: [
      { title: 'Crear una cuenta', href: '/docs/start-here/create-account' },
      { title: 'Conectar la primera cuenta bancaria', href: '/docs/start-here/connect-first-bank-account' },
      { title: 'Entender los movimientos', href: '/docs/accounts-transactions/understand-transactions' },
      { title: 'Presupuestar con el método de sobres', href: '/docs/budgets/envelope-method' },
      { title: 'Métricas de cartera explicadas', href: '/docs/portfolio-investments/portfolio-metrics-explained' },
      { title: 'Glosario', href: '/docs/glossary' },
      { title: 'Contactar con soporte', href: '/docs/troubleshooting/contact-support' },
    ],
    supportTitle: '¿Aún necesitas ayuda?',
    supportDescription:
      'Si la documentación no responde a tu pregunta, contacta con el soporte o vuelve al sitio principal de WonderMoney.',
    supportCta: 'Contactar con soporte',
    mainSiteCta: 'Visitar WonderMoney',
  },
};

export async function generateMetadata({ params }: PageProps<'/[lang]'>): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();

  const localeCopy = copy[lang];

  return {
    title: localeCopy.title,
    description: localeCopy.description,
    alternates: {
      canonical: absoluteUrl(homePath(lang)),
      languages: homeLanguageAlternates(),
    },
    openGraph: {
      title: localeCopy.title,
      description: localeCopy.description,
      url: absoluteUrl(homePath(lang)),
    },
    twitter: {
      title: localeCopy.title,
      description: localeCopy.description,
    },
  };
}

export default async function HomePage({ params }: PageProps<'/[lang]'>) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();

  const localeCopy = copy[lang];

  return (
    <main className="min-h-screen px-6 py-12 sm:py-16">
      <div className="mx-auto flex max-w-6xl flex-col gap-12">
        <section className="rounded-3xl border border-fd-border bg-fd-background p-8 sm:p-10">
          <p className="text-sm font-medium text-fd-muted-foreground">{localeCopy.eyebrow}</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-fd-foreground sm:text-6xl">{localeCopy.title}</h1>
          <p className="mt-5 max-w-3xl text-base leading-7 text-fd-muted-foreground sm:text-lg">{localeCopy.description}</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href={localizedHref(lang, '/docs/start-here')}
              className="rounded-full bg-fd-primary px-5 py-3 text-sm font-medium text-fd-primary-foreground transition hover:opacity-90"
            >
              {localeCopy.primaryCta}
            </Link>
            <Link
              href={localizedHref(lang, '/docs')}
              className="rounded-full border border-fd-border px-5 py-3 text-sm font-medium text-fd-foreground transition hover:bg-fd-accent/40"
            >
              {localeCopy.secondaryCta}
            </Link>
          </div>
        </section>

        <section>
          <h2 className="mb-5 text-2xl font-semibold text-fd-foreground">{localeCopy.tasksTitle}</h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {localeCopy.tasks.map((task) => (
              <li key={task.title}>
                <CardLink lang={lang} link={task} />
              </li>
            ))}
          </ul>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-3xl border border-fd-border bg-fd-background p-6 sm:p-8">
            <h2 className="text-2xl font-semibold text-fd-foreground">{localeCopy.pathTitle}</h2>
            <p className="mt-3 text-sm leading-6 text-fd-muted-foreground">{localeCopy.pathDescription}</p>
            <ol className="mt-6 space-y-2">
              {localeCopy.pathSteps.map((step, index) => (
                <PathStep key={step.title} lang={lang} index={index + 1} link={step} />
              ))}
            </ol>
          </div>

          <div className="rounded-3xl border border-fd-border bg-fd-background p-6 sm:p-8">
            <h2 className="text-2xl font-semibold text-fd-foreground">{localeCopy.popularTitle}</h2>
            <ul className="mt-5 space-y-3">
              {localeCopy.popularLinks.map((link) => (
                <li key={link.title}>
                  <Link
                    href={localizedHref(lang, link.href)}
                    className="flex items-center justify-between rounded-xl border border-fd-border px-4 py-3 text-sm font-medium text-fd-foreground transition hover:border-fd-foreground/20 hover:bg-fd-accent/30"
                  >
                    <span>{link.title}</span>
                    <span aria-hidden="true">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="rounded-3xl border border-fd-border bg-fd-background p-6 sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-fd-foreground">{localeCopy.supportTitle}</h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-fd-muted-foreground">{localeCopy.supportDescription}</p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link
                href={localizedHref(lang, '/docs/troubleshooting/contact-support')}
                className="rounded-full bg-fd-primary px-5 py-3 text-sm font-medium text-fd-primary-foreground transition hover:opacity-90"
              >
                {localeCopy.supportCta}
              </Link>
              <Link
                href="https://wonder.money"
                className="rounded-full border border-fd-border px-5 py-3 text-sm font-medium text-fd-foreground transition hover:bg-fd-accent/40"
              >
                {localeCopy.mainSiteCta}
              </Link>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
