import React from "react";

import { FilterUnionType } from "@/lib/utils/types";

import {
  Typography,
  type TypographyVariantType,
  type VariantPropsTypographyWithoutVariant,
} from "./Typography";

// Specify the variants you want to allow (linting error will be thrown when using exported
// component with a variant (1) not specified here or (2) not within TypographyVariant)
type AllowedVariants = FilterUnionType<TypographyVariantType, "blockquote">;
type HTMLTypographyElement = HTMLQuoteElement;

export interface BlockquoteProps
  extends React.HTMLAttributes<HTMLTypographyElement>,
    VariantPropsTypographyWithoutVariant {
  variant?: AllowedVariants;
}

const Blockquote = React.forwardRef<HTMLTypographyElement, BlockquoteProps>(
  ({ variant = "blockquote", ...props }, ref) => {
    return <Typography ref={ref} variant={variant} {...props} />;
  },
);
Blockquote.displayName = "Blockquote";

export default Blockquote;
