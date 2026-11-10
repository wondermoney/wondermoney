import { Shield, Lock, Landmark, CreditCard } from "lucide-react";
import { useTranslations } from "@/lib/reactTranslations";

const items = [
    { icon: Landmark, key: "lp.trustBar.openBanking" },
    { icon: Shield, key: "lp.trustBar.gdpr" },
    { icon: Lock, key: "lp.trustBar.readOnly" },
    { icon: CreditCard, key: "lp.trustBar.noCard" },
];

export default function AdTrustBar() {
    const { t } = useTranslations();

    return (
        <div className="border-y border-border bg-paper-2 py-4">
            <div className="mx-auto max-w-7xl px-6 lg:px-8">
                <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-muted-foreground">
                    {items.map(({ icon: Icon, key }) => (
                        <div key={key} className="flex items-center gap-1.5">
                            <Icon className="h-4 w-4 text-primary" />
                            <span>{t(key)}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
