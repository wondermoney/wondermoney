import { create } from "@kodingdotninja/use-tailwind-breakpoint";
import defaultConfig from "tailwindcss/defaultTheme";

export const { useBreakpoint } = create({ ...defaultConfig.screens });
