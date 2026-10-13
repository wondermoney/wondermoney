"use client";

import {
  CheckCircle2,
  Clock,
  ExternalLink,
  MessageSquare,
  Users,
  Zap,
} from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";

import { Alert, AlertDescription } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Heading, Text } from "@/components/ui/Typography";
import { RoadmapStatus } from "@/lib/types/roadmap";

interface WorkInProgressProps {
  title: string;
  description: string;
  features: string[];
  timeline?: string;
  primaryAction?: {
    text: string;
    onClick: () => void;
  };
  secondaryAction?: {
    text: string;
    onClick: () => void;
  };
  illustration?: string;
  roadmapStatus?: RoadmapStatus;
  onCannyClick?: () => void;
}

const WorkInProgress: React.FC<WorkInProgressProps> = ({
  title,
  description,
  features,
  timeline = "Soon",
  primaryAction,
  secondaryAction,
  illustration = "/undraw_work_in_progress_2.svg",
  roadmapStatus,
  onCannyClick,
}) => {
  const t = useTranslations();

  const getRoadmapBadgeStyle = (status?: RoadmapStatus) => {
    switch (status) {
      case RoadmapStatus.UNDER_REVIEW:
        return "border-yellow-200 bg-yellow-100 text-yellow-800";
      case RoadmapStatus.PLANNED:
        return "border-blue-200 bg-blue-100 text-blue-800";
      case RoadmapStatus.IN_PROGRESS:
        return "border-green-200 bg-green-100 text-green-800";
      case RoadmapStatus.SHIPPED:
        return "border-purple-200 bg-purple-100 text-purple-800";
      default:
        return "border-gray-200 bg-gray-100 text-gray-800";
    }
  };

  const getRoadmapStatusTranslation = (status?: RoadmapStatus) => {
    switch (status) {
      case RoadmapStatus.UNDER_REVIEW:
        return t("wip-roadmap-status-under-review");
      case RoadmapStatus.PLANNED:
        return t("wip-roadmap-status-planned");
      case RoadmapStatus.IN_PROGRESS:
        return t("wip-roadmap-status-in-progress");
      case RoadmapStatus.SHIPPED:
        return t("wip-roadmap-status-shipped");
      default:
        return status;
    }
  };

  return (
    <div className="mx-auto grid w-full max-w-6xl items-center gap-8 p-4 md:p-8 lg:grid-cols-2 lg:gap-12">
      {/* Left side - Content */}
      <div className="space-y-6 lg:space-y-8">
        {/* Status Badge */}
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="secondary"
            className="border-orange-200 bg-orange-100 text-orange-800"
          >
            <Clock className="mr-1 h-3 w-3" />
            {timeline}
          </Badge>
          {roadmapStatus && (
            <Badge
              variant="outline"
              className={getRoadmapBadgeStyle(roadmapStatus)}
            >
              {getRoadmapStatusTranslation(roadmapStatus)}
            </Badge>
          )}
        </div>

        {/* Main Content */}
        <div className="space-y-4">
          <Heading variant="h2">{title}</Heading>
          <Text className="text-muted-foreground text-lg leading-relaxed">
            {description}
          </Text>
        </div>

        {/* Feature Preview */}
        {features.length > 0 && (
          <Card className="animate-gradient border-2 border-purple-200 bg-gradient-to-r from-purple-50 via-pink-50 to-blue-50">
            <CardContent className="p-6">
              <div className="mb-4 flex items-center gap-2">
                <Zap className="h-5 w-5 text-blue-600" />
                <Text className="font-semibold text-blue-900">
                  {t("wip-coming-features")}
                </Text>
              </div>
              <ul className="space-y-3">
                {features.map((feature, index) => (
                  <li key={index} className="flex items-start gap-3">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-500" />
                    <Text className="text-sm text-gray-700">{feature}</Text>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Action Buttons */}
        <div className="flex flex-col gap-3 sm:flex-row">
          {primaryAction && (
            <Button size="lg" onClick={primaryAction.onClick}>
              {primaryAction.text}
            </Button>
          )}
          {secondaryAction && (
            <Button
              size="lg"
              variant="outline"
              className="px-8"
              onClick={secondaryAction.onClick}
            >
              {secondaryAction.text}
            </Button>
          )}
          <Button
            size="lg"
            variant="ghost"
            onClick={() => {
              onCannyClick?.();
              window.open("https://wondermoney.canny.io/", "_blank");
            }}
          >
            <MessageSquare className="mr-2 h-4 w-4" />
            {t("wip-vote-feedback")}
            <ExternalLink className="ml-2 h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Right side - Illustration */}
      <div className="relative flex justify-center lg:justify-end">
        <div className="relative aspect-square w-full max-w-md">
          <Image
            src={illustration}
            alt={title}
            fill
            className="object-contain"
            priority
          />
        </div>
      </div>
    </div>
  );
};

export default WorkInProgress;
