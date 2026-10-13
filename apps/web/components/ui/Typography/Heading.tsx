import React from "react";

import type { FilterUnionType } from "@/lib/utils/types";

import {
  Typography,
  type TypographyVariantType,
  type VariantPropsTypographyWithoutVariant,
} from "./Typography";

// Specify the variants you want to allow (linting error will be thrown when using exported
// component with a variant (1) not specified here or (2) not within TypographyVariant)
type AllowedVariants = FilterUnionType<
  TypographyVariantType,
  "h1" | "h2" | "h3" | "h4" | "h5" | "h6"
>;
type HTMLTypographyElement = HTMLHeadingElement;

interface HeadingProps
  extends React.HTMLAttributes<HTMLTypographyElement>,
    VariantPropsTypographyWithoutVariant {
  variant: AllowedVariants;
}

const Heading = React.forwardRef<HTMLTypographyElement, HeadingProps>(
  ({ variant, ...props }, ref) => {
    return <Typography ref={ref} variant={variant} {...props} />;
  },
);
Heading.displayName = "Heading";

export default Heading;
