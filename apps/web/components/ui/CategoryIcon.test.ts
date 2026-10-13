import assert from "node:assert/strict";

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
import { test } from "vitest";

import { getCategoryIconByIconName } from "./CategoryIcon";

test("getCategoryIconByIconName renders icon names emitted by the custom category picker", () => {
  for (const [name, Icon] of [
    ["Baby", Baby],
    ["Briefcase", Briefcase],
    ["Building", Building],
    ["Calendar", Calendar],
    ["Car", Car],
    ["Coffee", Coffee],
    ["CreditCard", CreditCard],
    ["Dumbbell", Dumbbell],
    ["Fuel", Fuel],
    ["Gamepad2", Gamepad2],
    ["Gift", Gift],
    ["GraduationCap", GraduationCap],
    ["Heart", Heart],
    ["Home", Home],
    ["Lightbulb", Lightbulb],
    ["MapPin", MapPin],
    ["Music", Music],
    ["PawPrint", PawPrint],
    ["PiggyBank", PiggyBank],
    ["Plane", Plane],
    ["Shirt", Shirt],
    ["ShoppingBag", ShoppingBag],
    ["ShoppingCart", ShoppingCart],
    ["Smartphone", Smartphone],
    ["Star", Star],
    ["Stethoscope", Stethoscope],
    ["TrendingUp", TrendingUp],
    ["Users", Users],
    ["Utensils", Utensils],
    ["Wifi", Wifi],
  ] as const) {
    assert.equal(getCategoryIconByIconName(name), Icon, name);
  }
});

test("getCategoryIconByIconName keeps rendering existing kebab-case category icons", () => {
  assert.equal(getCategoryIconByIconName("shopping-cart"), ShoppingCart);
  assert.equal(getCategoryIconByIconName("credit-card"), CreditCard);
  assert.equal(getCategoryIconByIconName("dumbbell"), Dumbbell);
  assert.equal(getCategoryIconByIconName("graduation-cap"), GraduationCap);
});
