"use client";

import {
  Baby,
  Briefcase,
  Building,
  Calendar,
  Car,
  Coffee,
  CreditCard,
  Dumbbell,
  Fuel,
  Gamepad2,
  Gift,
  GraduationCap,
  Heart,
  Home,
  Lightbulb,
  MapPin,
  Music,
  PawPrint,
  PiggyBank,
  Plane,
  Shirt,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  Star,
  Stethoscope,
  TrendingUp,
  Users,
  Utensils,
  Wifi,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

// Curated list of category-relevant icons
const CATEGORY_ICONS = [
  { name: "Home", icon: Home, keywords: ["house", "rent", "mortgage"] },
  {
    name: "ShoppingCart",
    icon: ShoppingCart,
    keywords: ["grocery", "shopping", "food"],
  },
  {
    name: "ShoppingBag",
    icon: ShoppingBag,
    keywords: ["retail", "clothes", "shopping"],
  },
  {
    name: "Utensils",
    icon: Utensils,
    keywords: ["restaurant", "food", "dining"],
  },
  { name: "Coffee", icon: Coffee, keywords: ["cafe", "drinks", "beverage"] },
  { name: "Car", icon: Car, keywords: ["transport", "vehicle", "auto"] },
  { name: "Plane", icon: Plane, keywords: ["travel", "flight", "vacation"] },
  { name: "Fuel", icon: Fuel, keywords: ["gas", "petrol", "station"] },
  {
    name: "CreditCard",
    icon: CreditCard,
    keywords: ["payment", "card", "finance"],
  },
  {
    name: "PiggyBank",
    icon: PiggyBank,
    keywords: ["savings", "money", "bank"],
  },
  {
    name: "TrendingUp",
    icon: TrendingUp,
    keywords: ["investment", "stocks", "growth"],
  },
  {
    name: "Gift",
    icon: Gift,
    keywords: ["present", "birthday", "celebration"],
  },
  {
    name: "Stethoscope",
    icon: Stethoscope,
    keywords: ["health", "medical", "doctor"],
  },
  {
    name: "GraduationCap",
    icon: GraduationCap,
    keywords: ["education", "school", "learning"],
  },
  {
    name: "Briefcase",
    icon: Briefcase,
    keywords: ["work", "business", "office"],
  },
  {
    name: "Smartphone",
    icon: Smartphone,
    keywords: ["phone", "mobile", "tech"],
  },
  { name: "Wifi", icon: Wifi, keywords: ["internet", "connection", "tech"] },
  {
    name: "Lightbulb",
    icon: Lightbulb,
    keywords: ["utilities", "electric", "power"],
  },
  {
    name: "Building",
    icon: Building,
    keywords: ["office", "work", "business"],
  },
  { name: "Users", icon: Users, keywords: ["family", "social", "people"] },
  { name: "Heart", icon: Heart, keywords: ["health", "love", "care"] },
  {
    name: "Dumbbell",
    icon: Dumbbell,
    keywords: ["fitness", "gym", "exercise"],
  },
  {
    name: "Music",
    icon: Music,
    keywords: ["entertainment", "audio", "streaming"],
  },
  {
    name: "Gamepad2",
    icon: Gamepad2,
    keywords: ["gaming", "entertainment", "fun"],
  },
  { name: "Shirt", icon: Shirt, keywords: ["clothing", "fashion", "apparel"] },
  { name: "Baby", icon: Baby, keywords: ["children", "kids", "family"] },
  { name: "PawPrint", icon: PawPrint, keywords: ["pets", "animals", "vet"] },
  {
    name: "Calendar",
    icon: Calendar,
    keywords: ["events", "schedule", "appointments"],
  },
  { name: "MapPin", icon: MapPin, keywords: ["location", "places", "address"] },
  { name: "Star", icon: Star, keywords: ["favorite", "special", "premium"] },
];

interface CategoryIconPickerProps {
  selectedIcon?: string;
  onIconSelect: (iconName: string) => void;
  color?: string;
  compact?: boolean;
}

const CategoryIconPicker: React.FC<CategoryIconPickerProps> = ({
  selectedIcon,
  onIconSelect,
  color = "#000000",
  compact = false,
}) => {
  const t = useTranslations();
  const [searchTerm, setSearchTerm] = useState("");
  const [isOpen, setIsOpen] = useState(false);

  const filteredIcons = CATEGORY_ICONS.filter(
    ({ name, keywords }) =>
      name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      keywords.some((keyword) =>
        keyword.toLowerCase().includes(searchTerm.toLowerCase()),
      ),
  );

  const selectedIconData = CATEGORY_ICONS.find(
    (icon) => icon.name === selectedIcon,
  );
  const SelectedIconComponent = selectedIconData?.icon;

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="input"
          className={
            compact ? "w-full justify-center p-2" : "h-10 w-full justify-start"
          }
          type="button"
        >
          {SelectedIconComponent ? (
            compact ? (
              <SelectedIconComponent className="size-6" style={{ color }} />
            ) : (
              <div className="flex items-center gap-2">
                <SelectedIconComponent className="size-4" style={{ color }} />
                <span className="text-sm">{selectedIcon}</span>
              </div>
            )
          ) : (
            <span className="text-muted-foreground text-sm">
              {compact ? "?" : t("select-icon")}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0">
        <div className="flex flex-col">
          <div className="border-b p-3">
            <Input
              placeholder={t("search-icons")}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="max-h-64 overflow-y-auto p-3">
            <div className="grid grid-cols-6 gap-2">
              {filteredIcons.map(({ name, icon: IconComponent }) => (
                <Button
                  key={name}
                  variant="input"
                  size="sm"
                  className="h-10 w-10 p-0"
                  onClick={() => {
                    onIconSelect(name);
                    setIsOpen(false);
                  }}
                  title={name}
                >
                  <IconComponent
                    className="size-4"
                    style={{ color: selectedIcon === name ? "white" : color }}
                  />
                </Button>
              ))}
            </div>
            {filteredIcons.length === 0 && (
              <div className="text-muted-foreground py-6 text-center text-sm">
                {t("no-icons-found")}
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default CategoryIconPicker;
