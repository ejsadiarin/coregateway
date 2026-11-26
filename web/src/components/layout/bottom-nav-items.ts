import {
  ArrowLeftRight,
  BarChart3,
  DatabaseBackup,
  FileText,
  LayoutDashboard,
  MessageSquareText,
  PenTool,
  Receipt,
  Server,
  SlidersHorizontal,
  SquareKanban,
  TrendingUp,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { matchNavPath } from "./sidebar-nav-items";

// The phone's bottom nav: its tabs, in order, and what sits under More.
export interface BottomNavItem {
  label: string;
  icon: LucideIcon;
  path: string;
  disabled?: boolean;
  adminOnly?: boolean;
}

export const primaryItems: BottomNavItem[] = [
  { label: "Feed", icon: MessageSquareText, path: "/dashboard/feed" },
  { label: "Home", icon: LayoutDashboard, path: "/dashboard" },
  { label: "Budget", icon: Wallet, path: "/dashboard/budget" },
  { label: "Expenses", icon: Receipt, path: "/dashboard/budget/expenses" },
  { label: "Services", icon: Server, path: "/dashboard/services" },
];

export const overflowItems: BottomNavItem[] = [
{ label: "Draw", icon: PenTool, path: "/dashboard/draw" },
{ label: "Kanban", icon: SquareKanban, path: "/dashboard/kanban" },
{ label: "Incomes", icon: TrendingUp, path: "/dashboard/budget/incomes" },
{ label: "Settings", icon: SlidersHorizontal, path: "/dashboard/settings" },
{ label: "Exchange", icon: ArrowLeftRight, path: "/dashboard/exchange" },
{ label: "Analytics", icon: BarChart3, path: "/analytics", disabled: true },
{ label: "Logs", icon: FileText, path: "/logs", disabled: true },
{ label: "Users", icon: Users, path: "/dashboard/admin/users", adminOnly: true },
{ label: "Backups", icon: DatabaseBackup, path: "/dashboard/admin/backups", adminOnly: true },
];

// bottomTabOf is the bottom-nav tab a page sits under, or null for a page
// under More or under none. It matches against every nav path first, so
// /dashboard/kanban is Kanban (under More), not Home.
export function bottomTabOf(pathname: string): string | null {
  const path = matchNavPath(pathname, [...primaryItems, ...overflowItems].map((i) => i.path));
  return primaryItems.some((i) => i.path === path) ? path : null;
}
