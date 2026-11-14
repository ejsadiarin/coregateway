import {
  Briefcase,
  Bus,
  CreditCard,
  Gift,
  GraduationCap,
  HeartPulse,
  House,
  Laptop,
  PiggyBank,
  Plane,
  Receipt,
  Repeat,
  ShoppingBag,
  Sparkles,
  Tag as TagIcon,
  Utensils,
  Wallet,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { hueOf, type Hue } from "@/lib/ledger";
import type { Category, Tag } from "@/types/api";

// Each hue as a filled chip (bg + text) and as the rounded square that
// opens a row. Tailwind needs the class names spelled out.
const HUE: Record<Hue, { chip: string; ring: string; bar: string }> = {
  amber: { chip: "bg-amber-500/15 text-amber-300", ring: "ring-amber-300", bar: "bg-amber-400" },
  sky: { chip: "bg-sky-400/15 text-sky-300", ring: "ring-sky-300", bar: "bg-sky-400" },
  violet: { chip: "bg-violet-400/20 text-violet-300", ring: "ring-violet-300", bar: "bg-violet-400" },
  rose: { chip: "bg-rose-400/15 text-rose-300", ring: "ring-rose-300", bar: "bg-rose-400" },
  teal: { chip: "bg-teal-400/15 text-teal-300", ring: "ring-teal-300", bar: "bg-teal-400" },
  lime: { chip: "bg-lime-400/15 text-lime-300", ring: "ring-lime-300", bar: "bg-lime-400" },
  fuchsia: { chip: "bg-fuchsia-400/15 text-fuchsia-300", ring: "ring-fuchsia-300", bar: "bg-fuchsia-400" },
  orange: { chip: "bg-orange-400/15 text-orange-300", ring: "ring-orange-300", bar: "bg-orange-400" },
  blue: { chip: "bg-blue-400/15 text-blue-300", ring: "ring-blue-300", bar: "bg-blue-400" },
  yellow: { chip: "bg-yellow-300/15 text-yellow-200", ring: "ring-yellow-200", bar: "bg-yellow-400" },
  pink: { chip: "bg-pink-400/15 text-pink-300", ring: "ring-pink-300", bar: "bg-pink-400" },
};
const NO_CATEGORY = { chip: "bg-muted text-muted-foreground", ring: "ring-muted-foreground", bar: "bg-muted-foreground" };

export const hueClasses = (category?: Category) => {
  const h = hueOf(category);
  return h ? HUE[h] : NO_CATEGORY;
};

// The icon a category gets from its name.
const ICONS: [RegExp, LucideIcon][] = [
  [/food|meal|grocer|coffee|drink|snack|dining/i, Utensils],
  [/transport|commute|ride|fare|gas|fuel|car/i, Bus],
  [/subscri/i, CreditCard],
  [/bill|install|utilit|loan|debt/i, Receipt],
  [/shop|cloth|gadget/i, ShoppingBag],
  [/allowance|baon/i, Wallet],
  [/salary|wage|pay/i, Briefcase],
  [/gift/i, Gift],
  [/freelance|commission|side/i, Laptop],
  [/school|tuition|educ|univ/i, GraduationCap],
  [/health|medic|pharm/i, HeartPulse],
  [/rent|house|home/i, House],
  [/travel|trip|flight/i, Plane],
  [/saving|invest/i, PiggyBank],
  [/electric|internet|phone|load/i, Zap],
  [/fun|entertain|leisure/i, Sparkles],
];

export function categoryIcon(category?: Pick<Category, "name">): LucideIcon {
  if (!category) return TagIcon;
  return ICONS.find(([re]) => re.test(category.name))?.[1] ?? TagIcon;
}

const CHIP = "inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-xs font-medium leading-none";

export function CategoryChip({ category }: { category?: Category }) {
  if (!category) return null;
  return <span className={cn(CHIP, hueClasses(category).chip)}>{category.name}</span>;
}

export function TagChip({ tag }: { tag: Tag }) {
  return <span className={cn(CHIP, "border border-pink-300/35 px-2 text-pink-200")}>#{tag.name}</span>;
}

export function NeedChip() {
  return <span className={cn(CHIP, "bg-emerald-400/15 text-emerald-300")}>Need</span>;
}

export function RuleChip({ children }: { children: ReactNode }) {
  return (
    <span className={cn(CHIP, "bg-primary/15 text-[#f4a084]")}>
      <Repeat className="h-3 w-3" aria-hidden />
      {children}
    </span>
  );
}

export function StatusChip({ status }: { status: "pending" | "skipped" }) {
  return (
    <span className={cn(CHIP, "border border-accent/40 px-2", status === "skipped" ? "text-muted-foreground" : "text-accent")}>
      {status === "pending" ? "Pending" : "Skipped"}
    </span>
  );
}

// CategoryBadge is the rounded square with the category's icon that opens
// a row.
export function CategoryBadge({ category, className }: { category?: Category; className?: string }) {
  const Icon = categoryIcon(category);
  return (
    <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", hueClasses(category).chip, className)}>
      <Icon className="h-[18px] w-[18px]" aria-hidden />
    </span>
  );
}
