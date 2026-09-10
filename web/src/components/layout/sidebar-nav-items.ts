import {
  LayoutDashboard,
  Wallet,
  Receipt,
  TrendingUp,
  SlidersHorizontal,
  Server,
  BarChart3,
  FileText,
  Users,
  type LucideIcon,
} from "lucide-react";

export type NavSection = "overview" | "finance" | "system" | "admin";

export interface NavItem {
  label: string;
  icon: LucideIcon;
  path: string;
  section: NavSection;
  adminOnly?: boolean;
  disabled?: boolean;
}

export const sectionLabels: Record<NavSection, string> = {
  overview: "OVERVIEW",
  finance: "FINANCE",
  system: "SYSTEM",
  admin: "ADMIN",
};

export const navItems: NavItem[] = [
  {
    label: "Dashboard",
    icon: LayoutDashboard,
    path: "/dashboard",
    section: "overview",
  },
  {
    label: "Budget",
    icon: Wallet,
    path: "/dashboard/budget",
    section: "finance",
  },
  {
    label: "Expenses",
    icon: Receipt,
    path: "/dashboard/budget/expenses",
    section: "finance",
  },
  {
    label: "Incomes",
    icon: TrendingUp,
    path: "/dashboard/budget/incomes",
    section: "finance",
  },
  {
    label: "Settings",
    icon: SlidersHorizontal,
    path: "/dashboard/budget/settings",
    section: "finance",
  },
  {
    label: "Services",
    icon: Server,
    path: "/dashboard/services",
    section: "system",
  },
  {
    label: "Analytics",
    icon: BarChart3,
    path: "/analytics",
    section: "system",
    disabled: true,
  },
  {
    label: "Logs",
    icon: FileText,
    path: "/logs",
    section: "system",
    disabled: true,
  },
  {
    label: "Users",
    icon: Users,
    path: "/dashboard/admin/users",
    section: "admin",
    adminOnly: true,
  },
];
