"use client";

import Image from "next/image";
import type { ReactNode } from "react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Carousel,
  type CarouselApi,
  CarouselContent,
  CarouselItem,
} from "@/components/ui/carousel";
import { cn } from "@/lib/utils";

export type OnboardingSlide = {
  img?: string;
  preview?: ReactNode;
  content: string;
};

interface OnboardingCarouselProps {
  slides: OnboardingSlide[];
  onComplete: () => void;
  nextLabel: string;
  completeLabel: string;
}

export function OnboardingCarousel({
  slides,
  onComplete,
  nextLabel,
  completeLabel,
}: OnboardingCarouselProps) {
  const [api, setApi] = React.useState<CarouselApi>();
  // Read the slide position straight from Embla, re-reading when it moves.
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      if (!api) return () => {};
      api.on("select", onChange);
      api.on("reInit", onChange);
      return () => {
        api.off("select", onChange);
        api.off("reInit", onChange);
      };
    },
    [api],
  );
  const current = React.useSyncExternalStore(
    subscribe,
    () => api?.selectedScrollSnap() ?? 0,
    () => 0,
  );
  const count = React.useSyncExternalStore(
    subscribe,
    () => api?.scrollSnapList().length ?? 0,
    () => 0,
  );

  const isLastSlide = current === count - 1;

  function handleNext() {
    if (isLastSlide) {
      onComplete();
    } else {
      api?.scrollNext();
    }
  }

  return (
    <div className="px-4 py-2 md:px-0">
      <Carousel setApi={setApi}>
        <CarouselContent>
          {slides.map((slide, index) => (
            <CarouselItem key={index}>
              <Card className="h-full">
                <CardContent className="flex flex-col items-center justify-center p-6">
                  {slide.preview ? (
                    <div className="mb-4 max-h-70 w-full overflow-y-auto rounded-md">
                      {slide.preview}
                    </div>
                  ) : slide.img ? (
                    <div className="bg-muted/10 relative mb-4 flex h-50 w-full items-center justify-center rounded-md">
                      <Image
                        src={slide.img}
                        alt=""
                        fill
                        style={{ objectFit: "contain" }}
                      />
                    </div>
                  ) : null}
                  <p className="text-muted-foreground mt-2 text-center">
                    {slide.content}
                  </p>
                </CardContent>
              </Card>
            </CarouselItem>
          ))}
        </CarouselContent>
      </Carousel>

      <div className="mt-4 flex justify-center gap-2">
        {Array.from({ length: count }).map((_, index) => (
          <button
            key={index}
            type="button"
            className={cn(
              "h-2 w-2 rounded-full transition-colors",
              index === current ? "bg-primary" : "bg-muted",
            )}
            onClick={() => api?.scrollTo(index)}
          />
        ))}
      </div>

      <div className="mt-4">
        <Button onClick={handleNext} className="w-full">
          {isLastSlide ? completeLabel : nextLabel}
        </Button>
      </div>
    </div>
  );
}
