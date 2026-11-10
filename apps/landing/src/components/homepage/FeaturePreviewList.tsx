import type { ReactNode } from "react";

import { Badge } from "../ui/badge";

interface FeaturePreview {
  id: string;
  title: string;
  description: string;
  status?: string;
  /** Shown under the description, e.g. the institutions a feature works with. */
  supporting?: ReactNode;
  preview: ReactNode;
}

interface FeaturePreviewListProps {
  features: FeaturePreview[];
}

export default function FeaturePreviewList({
  features,
}: FeaturePreviewListProps) {
  return (
    <div className="flex flex-col gap-12">
      {features.map((feature) => (
        <div
          key={feature.id}
          className="grid gap-6 lg:grid-cols-[1fr_1.1fr] items-start"
        >
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <h3 className="text-xl font-semibold text-foreground">
                {feature.title}
              </h3>
              {feature.status && (
                <Badge variant="secondary">{feature.status}</Badge>
              )}
            </div>
            <p className="text-base text-muted-foreground">
              {feature.description}
            </p>
            {feature.supporting}
          </div>
          <div>{feature.preview}</div>
        </div>
      ))}
    </div>
  );
}
