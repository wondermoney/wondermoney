import React from "react";

import type { FilterUnionType } from "@/lib/utils/types";

import {
  Typography,
  type TypographyVariantType,
  type VariantPropsTypographyWithoutVariant,
} from "./Typography";

// Specify the variants you want to allow (linting error will be thrown when using exported component with a variant (1) not specified here or (2) not within TypographyVariant)
type AllowedVariants = FilterUnionType<
  TypographyVariantType,
  "span" | "p" | "lead" | "smallText" | "largeText" | "mutedText"
>;
type HTMLTypographyElement = HTMLParagraphElement;

interface TextProps
  extends React.HTMLAttributes<HTMLTypographyElement>,
    VariantPropsTypographyWithoutVariant {
  variant?: AllowedVariants;
  as?: string;
}

const Text = React.forwardRef<HTMLTypographyElement, TextProps>(
  ({ variant = "span", as, ...props }, ref) => {
    return <Typography ref={ref} variant={variant} as={as} {...props} />;
  },
);
Text.displayName = "Text";

export default Text;
