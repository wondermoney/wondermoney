import { useTranslations } from "@/lib/reactTranslations";
import activobank from "@/assets/institutions/activobank.svg";
import bpi from "@/assets/institutions/bpi.png";
import cgd from "@/assets/institutions/cgd.png";
import degiro from "@/assets/institutions/degiro.svg";
import interactiveBrokers from "@/assets/institutions/interactive-brokers.svg";
import millennium from "@/assets/institutions/millennium-bcp.svg";
import novobanco from "@/assets/institutions/novobanco.svg";
import revolut from "@/assets/institutions/revolut.svg";
import santander from "@/assets/institutions/santander.svg";

/**
 * Institutions the product actually supports, shown as "works with", never as
 * partners. Banks are the most-connected Portuguese institutions in the app's
 * Enable Banking picker (apps/web/lib/api/banking/sort-banks.ts in the
 * monorepo); brokers are the two with tested portfolio-file imports
 * (apps/web/cypress/e2e/portfolio-import/cases.ts). Logos come from each
 * institution's own website and render as one muted tone through a CSS mask.
 */
type Mark = {
  name: string;
  src: string;
  /** width / height of the artwork */
  ratio: number;
};

const banks: Mark[] = [
  { name: "Caixa Geral de Depósitos", src: cgd.src, ratio: 130 / 94 },
  { name: "Millennium bcp", src: millennium.src, ratio: 160 / 48 },
  { name: "Santander", src: santander.src, ratio: 180 / 32 },
  { name: "novobanco", src: novobanco.src, ratio: 212.26 / 31 },
  { name: "ActivoBank", src: activobank.src, ratio: 317 / 51 },
  { name: "BPI", src: bpi.src, ratio: 200 / 84 },
  { name: "Revolut", src: revolut.src, ratio: 145 / 32 },
];

const brokers: Mark[] = [
  { name: "DEGIRO", src: degiro.src, ratio: 72.2 / 10.2 },
  { name: "Interactive Brokers", src: interactiveBrokers.src, ratio: 452 / 69 },
];

/** Equal optical area: a wide wordmark sits lower than a compact mark. */
function heightFor(ratio: number) {
  return Math.round(Math.min(30, Math.max(18, Math.sqrt(2400 / ratio))));
}

type Size = "default" | "large";

const LARGE_HEIGHT = 28;

function MarkRow({ label, marks, size }: { label: string; marks: Mark[]; size: Size }) {
  return (
    <div>
      <p className="text-sm text-muted-foreground">{label}</p>
      <ul className={size === "large" ? "mt-5 grid grid-cols-2 items-center gap-x-8 gap-y-8 sm:grid-cols-4" : "mt-3 flex flex-wrap items-center gap-x-6 gap-y-4"}>
        {marks.map((mark) => {
          // Large: every mark one height in a grid cell, a wide wordmark shrinking to its cell.
          const height = size === "large" ? LARGE_HEIGHT : heightFor(mark.ratio);
          const mask = `url("${mark.src}") center / contain no-repeat`;
          return (
            <li key={mark.name} className="flex min-w-0">
              <span
                role="img"
                aria-label={mark.name}
                title={mark.name}
                className="block bg-muted-foreground"
                style={{
                  height,
                  width: Math.round(height * mark.ratio),
                  maxWidth: "100%",
                  mask,
                  WebkitMask: mask,
                }}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** `large` is the homepage's works-with section, where the marks are the section's visual. */
export default function InstitutionMarks({ size = "default" }: { size?: Size }) {
  const { t } = useTranslations();

  return (
    <div className={size === "large" ? "space-y-12" : "space-y-6 pt-4"}>
      <MarkRow label={t("homepage.features.item1.banksLabel")} marks={banks} size={size} />
      <MarkRow
        label={t("homepage.features.item1.brokersLabel")}
        marks={brokers}
        size={size}
      />
    </div>
  );
}
