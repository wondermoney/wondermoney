import { useTranslations } from "@/lib/reactTranslations";
import { Tag, CalendarCheck } from "lucide-react";

const stats = [
    { icon: CalendarCheck, key: "lp.social.trial" },
    { icon: Tag, key: "lp.social.price" },
];

export default function SocialProof() {
    const { t } = useTranslations();

    return (
        <section className="py-12">
            <div className="mx-auto max-w-2xl px-6 lg:px-8">
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                    {stats.map(({ icon: Icon, key }) => (
                        <div
                            key={key}
                            className="flex flex-col items-center gap-2 rounded-card border border-border bg-background px-6 py-6 text-center"
                        >
                            <Icon className="h-6 w-6 text-primary" aria-hidden="true" />
                            <span className="text-sm font-medium text-foreground">{t(key)}</span>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}
