"use client";

import {
  ArrowLeft,
  Baby,
  BadgeDollarSign,
  Banknote,
  BarChart3,
  Book,
  Box,
  Briefcase,
  Building,
  Building2,
  Bus,
  Calendar,
  Car,
  Check,
  CircleAlert,
  CircleHelp,
  CircleQuestionMark,
  Clapperboard,
  CloudLightning,
  Coffee,
  Coins,
  Construction,
  CookingPot,
  CreditCard,
  Cross,
  Cylinder,
  Dices,
  Droplet,
  Dumbbell,
  File,
  Film,
  Flame,
  Folder,
  Fuel,
  Gamepad2,
  Gavel,
  Gift,
  GraduationCap,
  Heart,
  HeartHandshake,
  HeartPulse,
  Home,
  Hotel,
  House,
  Inbox,
  Landmark,
  Laugh,
  Lightbulb,
  type LucideIcon,
  Mail,
  MapPin,
  Minus,
  Music,
  Navigation,
  Package2,
  Palmtree,
  PawPrint,
  Phone,
  PiggyBank,
  Pizza,
  Plane,
  PlaneTakeoff,
  Radio,
  Receipt,
  Shield,
  ShieldCheck,
  Shirt,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  Smile,
  Star,
  Stethoscope,
  Theater,
  TrendingUp,
  Tv,
  Undo2,
  User,
  Users,
  Utensils,
  Volleyball,
  Wifi,
  Wine,
  Wrench,
  Zap,
} from "lucide-react";
import { createElement } from "react";

import type { Category } from "@/lib/api/category/useCategories";
import { cn } from "@/lib/utils";

const getCategoryIconByCategoryName = (
  category: Category["name"],
): LucideIcon => {
  switch (category) {
    case "Income":
      return Banknote; // Placeholder for GiReceiveMoney
    case "Cash":
      return Banknote; // Placeholder for FaMoneyBill
    case "Loans":
      return Receipt; // Placeholder for GiPayMoney
    case "Cheque":
      return Banknote; // Placeholder for FaMoneyCheckAlt
    case "Savings & Investments":
      return BarChart3; // Placeholder for FaRegChartBar
    case "Returned Payments":
      return Undo2; // Placeholder for IoIosReturnLeft
    case "Entertainment":
      return Film; // Placeholder for BiMovie
    case "Other":
      return Folder; // Placeholder for BsFolder
    case "Food & Drinks":
      return Pizza; // Placeholder for MdOutlineFastfood
    case "Transportation":
      return Car; // Placeholder for BiCar
    case "Travel":
      return Palmtree; // Placeholder for FaUmbrellaBeach
    case "Bank Fees":
      return Banknote; // Placeholder for MdMoneyOff
    case "Debt collection":
      return Banknote; // Placeholder for MdMoneyOff
    case "Government & Non-profit":
      return Landmark; // Placeholder for RiGovernmentLine
    case "Rent & Utilities":
      return CloudLightning; // Placeholder for BsLightningCharge
    case "Personal & Healthcare":
      return User; // Placeholder for FiUser
    case "Services":
      return Building2; // Placeholder for GrBusinessService
    case "General Merchandise":
      return Shirt; // Placeholder for GiClothes
    default:
      return Folder; // Default placeholder
  }
};

export const getCategoryIconByIconName = (icon: string): LucideIcon => {
  const normalizedIcon = icon
    .replaceAll(/([a-z])([A-Z])/g, "$1-$2")
    .replaceAll("_", "-")
    .toLowerCase();

  switch (normalizedIcon) {
    case "badge-dollar-sign":
      return BadgeDollarSign;
    case "banknote":
      return Banknote;
    case "briefcase":
      return Briefcase;
    case "building":
      return Building;
    case "building-2":
      return Building2;
    case "bus":
      return Bus;
    case "calendar":
      return Calendar;
    case "coins":
      return Coins;
    case "coffee":
      return Coffee;
    case "cooking-pot":
      return CookingPot;
    case "check":
      return Check;
    case "chart-bar":
      return BarChart3;
    case "arrow-left":
      return ArrowLeft;
    case "clapperboard":
      return Clapperboard;
    case "folder":
      return Folder;
    case "pizza":
      return Pizza;
    case "car":
      return Car;
    case "cross":
      return Cross;
    case "plane":
      return Plane;
    case "plane-takeoff":
      return PlaneTakeoff;
    case "minus":
      return Minus;
    case "landmark":
      return Landmark;
    case "home":
      return Home;
    case "house":
      return House;
    case "users":
      return Users;
    case "inbox":
      return Inbox;
    case "shirt":
      return Shirt;
    case "question":
      return CircleHelp;
    case "credit-card":
      return CreditCard;
    case "fuel":
      return Fuel;
    case "wine":
      return Wine;
    case "hotel":
      return Hotel;
    case "heart-handshake":
      return HeartHandshake;
    case "gavel":
      return Gavel;
    case "exclamation":
      return CircleAlert;
    case "flame":
      return Flame;
    case "shield":
      return Shield;
    case "shield-check":
      return ShieldCheck;
    case "zap":
      return Zap;
    case "phone":
      return Phone;
    case "droplet":
      return Droplet;
    case "smile":
      return Smile;
    case "heart-pulse":
      return HeartPulse;
    case "dumbbell":
      return Dumbbell;
    case "dices":
      return Dices;
    case "music":
      return Music;
    case "tv":
      return Tv;
    case "theater":
      return Theater;
    case "book":
      return Book;
    case "mail":
      return Mail;
    case "baby":
      return Baby;
    case "file":
      return File;
    case "box":
      return Box;
    case "paw-print":
      return PawPrint;
    case "shopping-cart":
      return ShoppingCart;
    case "cart":
      return ShoppingCart;
    case "gift":
      return Gift;
    case "gamepad2":
    case "gamepad-2":
      return Gamepad2;
    case "navigation":
      return Navigation;
    case "heart":
      return Heart;
    case "lightbulb":
      return Lightbulb;
    case "map-pin":
      return MapPin;
    case "piggy-bank":
      return PiggyBank;
    case "tree-palm":
      return Palmtree;
    case "construction":
      return Construction;
    case "cylinder":
      return Cylinder;
    case "radio-tower":
      return Radio;
    case "utensils":
      return Utensils;
    case "shopping-bag":
      return ShoppingBag;
    case "smartphone":
      return Smartphone;
    case "star":
      return Star;
    case "stethoscope":
      return Stethoscope;
    case "trending-up":
      return TrendingUp;
    case "wifi":
      return Wifi;
    case "package-2":
      return Package2;
    case "wrench":
      return Wrench;
    case "volleyball":
      return Volleyball;
    case "graduation-cap":
      return GraduationCap;
    case "laugh":
      return Laugh;
    default:
      return Folder; // Default placeholder
  }
};

interface CategoryIconProps {
  category?: string;
  icon?: string;
  width?: string;
  height?: string;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * The ink for a category icon drawn in its category's colour. The stored
 * colours are pastel fills (they back chips and chart slices), and a pastel
 * stroke on the canvas measures well under the 3:1 an icon needs. Mixing it
 * into the foreground keeps the hue and clears contrast in both themes: dark
 * ink in light mode, light ink in dark mode.
 */
export const categoryIconStyle = (
  color: string | null | undefined,
): React.CSSProperties | undefined =>
  color
    ? { color: `color-mix(in oklch, ${color} 45%, var(--foreground))` }
    : undefined;

const CategoryIcon: React.FC<CategoryIconProps> = ({
  category,
  icon,
  width,
  height,
  className,
  style,
}) => {
  // The lookups return module-level lucide components, so rendering them with
  // createElement keeps the component identity stable between renders.
  if (category) {
    return createElement(getCategoryIconByCategoryName(category), {
      width: width ?? "20px",
      height: height ?? "20px",
      className: cn("text-foreground/70", className),
      strokeWidth: 2,
      style,
    });
  }
  if (icon) {
    return createElement(getCategoryIconByIconName(icon), {
      width: width ?? "20px",
      height: height ?? "20px",
      // No colour class: the icon draws in `currentColor`, so it takes the
      // ink of the text it sits beside and a caller's `text-*` just works.
      className,
      strokeWidth: 2,
      style,
    });
  }
  console.error("Category or icon is required");
  return (
    <CircleQuestionMark className="text-foreground/70 size-5" strokeWidth={2} />
  );
};

export default CategoryIcon;
