import React from "react";

import type { FilterUnionType } from "@/lib/utils/types";

import {
  Typography,
  type TypographyVariantType,
  type VariantPropsTypographyWithoutVariant,
} from "./Typography";

// Specify the variants you want to allow (linting error will be thrown when using exported
// component with a variant (1) not specified here or (2) not within TypographyVariant)
type AllowedVariants = FilterUnionType<TypographyVariantType, "inlineCode">;
// using React.ElementRef<"code"> instead of HTMLXElement because HTMLCodeElement is not a valid
// HTML element type
type HTMLTypographyElement = React.ElementRef<"code">;

interface CodeProps
  extends React.HTMLAttributes<HTMLTypographyElement>,
    VariantPropsTypographyWithoutVariant {
  variant?: AllowedVariants;
}

const Code = React.forwardRef<HTMLTypographyElement, CodeProps>(
  ({ variant = "inlineCode", ...props }, ref) => {
    return <Typography ref={ref} variant={variant} {...props} />;
  },
);
Code.displayName = "Code";

export default Code;
