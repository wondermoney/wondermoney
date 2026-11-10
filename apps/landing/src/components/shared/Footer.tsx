import { cn } from "@/lib/utils";
import EmailCaptureForm from "./EmailCaptureForm";
import logo from "../../assets/logo.png";
import us from "@/assets/flag/us.svg";
import pt from "@/assets/flag/pt.svg";
import es from "@/assets/flag/es.svg";
import fr from "@/assets/flag/fr.svg";
import de from "@/assets/flag/de.svg";
import it from "@/assets/flag/it.svg";
import {
  toLocalizedPath,
  toLocalizedPathname,
  toToolsHubPath,
} from "@/lib/routes";
import { getTranslations } from "@/lib/translations";
import { GITHUB_URL, selfHostingDocsUrl } from "@/lib/openSource";
import type { Lang } from "@/lib/i18nLocale";

export type Props = {
  className?: string;
  locale: Lang;
};

const languages = [
  { code: "en", name: "English", logo: us.src },
  { code: "pt", name: "Português", logo: pt.src },
  { code: "es", name: "Español", logo: es.src },
  { code: "fr", name: "Français", logo: fr.src },
  { code: "de", name: "Deutsch", logo: de.src },
  { code: "it", name: "Italiano", logo: it.src },
] as const satisfies ReadonlyArray<{ code: Lang; name: string; logo: string }>;

export default function Footer({ className, locale }: Props) {
  const t = getTranslations(locale);
  const activeLanguage =
    languages.find((language) => language.code === locale) ?? languages[0];

  const navigation = {
    // solutions: [
    //   { name: "Marketing", href: "#" },
    //   { name: "Analytics", href: "#" },
    //   { name: "Commerce", href: "#" },
    //   { name: "Insights", href: "#" },
    // ],
    // The same feature destinations the header's Features menu carries.
    features: (
      [
        ["header.nav.accounts.name", "featureAccounts"],
        ["header.nav.budgeting.name", "featureBudgeting"],
        ["header.nav.categorization.name", "featureCategorization"],
        ["header.nav.portfolio.name", "featurePortfolio"],
        ["header.nav.reports.name", "featureReports"],
        ["header.nav.privacy.name", "featurePrivacy"],
      ] as const
    ).map(([nameKey, routeId]) => ({
      name: t(nameKey),
      href: toLocalizedPath(routeId, locale),
    })),
    resources: [{ name: t("footer.tools"), href: toToolsHubPath(locale) }],
    support: [
      {
        name: t("footer.faq"),
        href: "https://app.wonder.money/faq",
      },
      { name: t("footer.documentation"), href: "https://docs.wonder.money" },
      // { name: "Guides", href: "#" },
      // { name: "API Status", href: "#" },
    ],
    openSource: [
      { name: t("footer.selfHosting"), href: selfHostingDocsUrl(locale) },
      { name: t("footer.github"), href: GITHUB_URL },
    ],
    company: [
      { name: t("footer.about"), href: toLocalizedPath("pageAbout", locale) },
      // { name: "Blog", href: "#" },
      // { name: "Jobs", href: "#" },
      // { name: "Press", href: "#" },
      // { name: "Partners", href: "#" },
    ],
    legal: [
      // { name: "Claim", href: "#" },
      {
        name: t("footer.privacy"),
        href: "https://docs.wonder.money/about/privacy-policy",
      },
      {
        name: t("footer.terms"),
        href: "https://docs.wonder.money/about/terms-of-service",
      },
      {
        name: t("footer.cookiePolicy"),
        href: "https://docs.wonder.money/about/cookie-policy",
      },
      {
        name: t("footer.accessibilityStatement"),
        href: "https://docs.wonder.money/about/accessibility-statement",
      },
      {
        name: t("footer.refundPolicy"),
        href: "https://docs.wonder.money/about/refund-cancellation-policy",
      },
    ],
    social: [
      {
        name: "Discord",
        href: "https://discord.gg/9qKZ7gEaAP",
        icon: (props: React.SVGProps<SVGSVGElement>) => (
          <svg
            aria-hidden="true"
            width="20px"
            height="20px"
            viewBox="0 0.013 0.6 0.6"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            {...props}
          >
            <g clipPath="url(#clip0_537_21)">
              <path
                d="M0.508 0.114a0.49 0.49 0 0 0 -0.122 -0.039 0.002 0.002 0 0 0 -0.002 0.001c-0.005 0.01 -0.011 0.022 -0.015 0.032 -0.046 -0.007 -0.092 -0.007 -0.137 0 -0.004 -0.01 -0.01 -0.022 -0.015 -0.032a0.002 0.002 0 0 0 -0.002 -0.001c-0.043 0.007 -0.084 0.021 -0.122 0.039a0.002 0.002 0 0 0 -0.001 0.001C0.013 0.232 -0.008 0.348 0.002 0.461a0.002 0.002 0 0 0 0.001 0.001 0.495 0.495 0 0 0 0.15 0.077 0.002 0.002 0 0 0 0.002 -0.001c0.012 -0.016 0.022 -0.033 0.031 -0.051a0.002 0.002 0 0 0 -0.001 -0.003 0.325 0.325 0 0 1 -0.047 -0.023 0.002 0.002 0 0 1 0 -0.003q0.005 -0.004 0.009 -0.007a0.002 0.002 0 0 1 0.002 0c0.098 0.046 0.205 0.046 0.302 0a0.002 0.002 0 0 1 0.002 0q0.004 0.004 0.009 0.007a0.002 0.002 0 0 1 0 0.003q-0.022 0.013 -0.047 0.023a0.002 0.002 0 0 0 -0.001 0.003c0.009 0.018 0.019 0.035 0.031 0.051a0.002 0.002 0 0 0 0.002 0.001 0.492 0.492 0 0 0 0.15 -0.077 0.002 0.002 0 0 0 0.001 -0.001c0.013 -0.132 -0.021 -0.246 -0.089 -0.347a0.002 0.002 0 0 0 -0.001 -0.001M0.201 0.392c-0.03 0 -0.054 -0.028 -0.054 -0.061s0.024 -0.061 0.054 -0.061c0.03 0 0.054 0.028 0.054 0.061 0 0.034 -0.024 0.061 -0.054 0.061m0.199 0c-0.03 0 -0.054 -0.028 -0.054 -0.061s0.024 -0.061 0.054 -0.061c0.03 0 0.054 0.028 0.054 0.061 0 0.034 -0.024 0.061 -0.054 0.061"
                fill="currentColor"
              />
            </g>
            <defs>
              <clipPath id="clip0_537_21">
                <path
                  width="24"
                  height="24"
                  fill="white"
                  d="M0 0H0.6V0.6H0V0z"
                />
              </clipPath>
            </defs>
          </svg>
        ),
      },
      /* {
        name: "Facebook",
        href: "https://www.facebook.com/wondermoneyapp/",
        icon: (props: React.SVGProps<SVGSVGElement>) => (
          <svg fill="currentColor" viewBox="0 0 24 24" {...props}>
            <path
              fillRule="evenodd"
              d="M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.878v-6.987h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.988C18.343 21.128 22 16.991 22 12z"
              clipRule="evenodd"
            />
          </svg>
        ),
      },
      {
        name: "Instagram",
        href: "#",
        icon: (props: React.SVGProps<SVGSVGElement>) => (
          <svg fill="currentColor" viewBox="0 0 24 24" {...props}>
            <path
              fillRule="evenodd"
              d="M12.315 2c2.43 0 2.784.013 3.808.06 1.064.049 1.791.218 2.427.465a4.902 4.902 0 011.772 1.153 4.902 4.902 0 011.153 1.772c.247.636.416 1.363.465 2.427.048 1.067.06 1.407.06 4.123v.08c0 2.643-.012 2.987-.06 4.043-.049 1.064-.218 1.791-.465 2.427a4.902 4.902 0 01-1.153 1.772 4.902 4.902 0 01-1.772 1.153c-.636.247-1.363.416-2.427.465-1.067.048-1.407.06-4.123.06h-.08c-2.643 0-2.987-.012-4.043-.06-1.064-.049-1.791-.218-2.427-.465a4.902 4.902 0 01-1.772-1.153 4.902 4.902 0 01-1.153-1.772c-.247-.636-.416-1.363-.465-2.427-.047-1.024-.06-1.379-.06-3.808v-.63c0-2.43.013-2.784.06-3.808.049-1.064.218-1.791.465-2.427a4.902 4.902 0 011.153-1.772A4.902 4.902 0 015.45 2.525c.636-.247 1.363-.416 2.427-.465C8.901 2.013 9.256 2 11.685 2h.63zm-.081 1.802h-.468c-2.456 0-2.784.011-3.807.058-.975.045-1.504.207-1.857.344-.467.182-.8.398-1.15.748-.35.35-.566.683-.748 1.15-.137.353-.3.882-.344 1.857-.047 1.023-.058 1.351-.058 3.807v.468c0 2.456.011 2.784.058 3.807.045.975.207 1.504.344 1.857.182.466.399.8.748 1.15.35.35.683.566 1.15.748.353.137.882.3 1.857.344 1.054.048 1.37.058 4.041.058h.08c2.597 0 2.917-.01 3.96-.058.976-.045 1.505-.207 1.858-.344.466-.182.8-.398 1.15-.748.35-.35.566-.683.748-1.15.137-.353.3-.882.344-1.857.048-1.055.058-1.37.058-4.041v-.08c0-2.597-.01-2.917-.058-3.96-.045-.976-.207-1.505-.344-1.858a3.097 3.097 0 00-.748-1.15 3.098 3.098 0 00-1.15-.748c-.353-.137-.882-.3-1.857-.344-1.023-.047-1.351-.058-3.807-.058zM12 6.865a5.135 5.135 0 110 10.27 5.135 5.135 0 010-10.27zm0 1.802a3.333 3.333 0 100 6.666 3.333 3.333 0 000-6.666zm5.338-3.205a1.2 1.2 0 110 2.4 1.2 1.2 0 010-2.4z"
              clipRule="evenodd"
            />
          </svg>
        ),
      },
      {
        name: "X",
        href: "#",
        icon: (props: React.SVGProps<SVGSVGElement>) => (
          <svg fill="currentColor" viewBox="0 0 24 24" {...props}>
            <path d="M13.6823 10.6218L20.2391 3H18.6854L12.9921 9.61788L8.44486 3H3.2002L10.0765 13.0074L3.2002 21H4.75404L10.7663 14.0113L15.5685 21H20.8131L13.6819 10.6218H13.6823ZM11.5541 13.0956L10.8574 12.0991L5.31391 4.16971H7.70053L12.1742 10.5689L12.8709 11.5655L18.6861 19.8835H16.2995L11.5541 13.096V13.0956Z" />
          </svg>
        ),
      }, */
    ],
  };

  const linkClass =
    "rounded-sm text-sm leading-6 text-ink-2 transition-colors hover:text-foreground";

  // Four index columns: what the product does, where to read more, the code,
  // and who makes it.
  const columns: Array<{
    title: string;
    items: Array<{ name: string; href: string }>;
    social?: typeof navigation.social;
  }> = [
    { title: t("header.features"), items: navigation.features },
    {
      title: t("footer.resources"),
      items: [...navigation.resources, ...navigation.support],
    },
    { title: t("footer.openSource"), items: navigation.openSource },
    {
      title: t("footer.company"),
      items: navigation.company,
      social: navigation.social,
    },
  ];

  return (
    <footer
      className={cn("mt-16 border-t border-border bg-background md:mt-24", className)}
      aria-labelledby="footer-heading"
    >
      <h2 id="footer-heading" className="sr-only">
        Footer
      </h2>
      <div className="mx-auto max-w-7xl px-6 pb-8 pt-16 sm:pt-20 lg:px-8">
        <div className="grid grid-cols-2 gap-x-8 gap-y-12 sm:grid-cols-4 lg:grid-cols-12 lg:gap-x-10">
          {columns.map((column) => (
            <div key={column.title} className="min-w-0 lg:col-span-2">
              <h3 className="text-sm font-medium text-foreground">
                {column.title}
              </h3>
              <ul role="list" className="mt-4 space-y-2.5">
                {column.items.map((item) => (
                  <li key={item.href}>
                    <a href={item.href} className={linkClass}>
                      {item.name}
                    </a>
                  </li>
                ))}
                {column.social?.map((item) => (
                  <li key={item.href}>
                    <a
                      href={item.href}
                      className={cn(linkClass, "inline-flex items-center gap-2")}
                    >
                      <item.icon className="h-4 w-4" aria-hidden="true" />
                      {item.name}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {/* The free guide, beside the index */}
          <div className="col-span-2 min-w-0 sm:col-span-4 lg:col-span-4 lg:col-start-9">
            <EmailCaptureForm locale={locale} source="footer" variant="footer" />
          </div>
        </div>

        {/* The wordmark and what WonderMoney is */}
        <div className="mt-16 flex flex-col gap-4 border-t border-border pt-8 sm:flex-row sm:items-center sm:gap-8">
          <img className="h-7 w-auto self-start sm:self-center" src={logo.src} alt="WonderMoney" />
          <p className="max-w-xl text-sm leading-6 text-muted-foreground">
            {t("footer.description")}
          </p>
        </div>

        {/* Legal row: the legal documents and copyright, then the language switcher */}
        <div className="mt-8 flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0 space-y-3">
            <h3 className="sr-only">{t("footer.legal")}</h3>
            <ul
              role="list"
              className="flex flex-wrap gap-x-6 gap-y-2"
            >
              {navigation.legal.map((item) => (
                <li key={item.href}>
                  <a
                    href={item.href}
                    className="rounded-sm text-xs leading-5 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {item.name}
                  </a>
                </li>
              ))}
            </ul>
            <p className="text-xs leading-5 text-muted-foreground">
              &copy; {new Date().getFullYear()} WonderMoney.{" "}
              {t("footer.copyright")}
            </p>
          </div>
          <div className="flex items-end">
            <div>
              <label
                htmlFor="footer-language"
                className="mb-2 block text-xs font-medium text-muted-foreground"
              >
                {t("footer.language")}
              </label>
              <select
                id="footer-language"
                value={activeLanguage.code}
                onChange={(event) => {
                  const code = event.target.value;
                  const nextLang = languages.find(
                    (language) => language.code === code,
                  )?.code;

                  if (!nextLang) {
                    return;
                  }

                  const localizedPathname = toLocalizedPathname(
                    window.location.pathname,
                    nextLang,
                  );
                  const nextSearchParams = new URLSearchParams(
                    window.location.search,
                  );
                  nextSearchParams.delete("market");
                  const nextSearch = nextSearchParams.toString();
                  const nextUrl =
                    localizedPathname +
                    (nextSearch ? `?${nextSearch}` : "") +
                    window.location.hash;

                  window.location.assign(nextUrl);
                }}
                className="h-9 rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground"
              >
                {languages.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
