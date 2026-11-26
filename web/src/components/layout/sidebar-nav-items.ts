import {
  LayoutDashboard,
  MessageSquareText,
  PenTool,
  SquareKanban,
  Wallet,
  Receipt,
  TrendingUp,
  SlidersHorizontal,
  Server,
  BarChart3,
  FileText,
  Users,
  DatabaseBackup,
  ArrowLeftRight,
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

// Which nav item should light up for a given pathname: the longest item path
// that is either an exact match or a path-segment prefix of the location.
// So /dashboard/draw/:boardId highlights "Draw" without also lighting up
// "Dashboard". Returns null when nothing owns the route.
export function matchNavPath(pathname: string, paths: string[]): string | null {
  let best: string | null = null;
  for (const path of paths) {
    if (pathname === path || pathname.startsWith(`${path}/`)) {
      if (best === null || path.length > best.length) best = path;
    }
  }
  return best;
}

export const navItems: NavItem[] = [
  {
    label: "Dashboard",
    icon: LayoutDashboard,
    path: "/dashboard",
    section: "overview",
  },
  {
    label: "Feed",
    icon: MessageSquareText,
    path: "/dashboard/feed",
    section: "overview",
  },
  {
    label: "Draw",
    icon: PenTool,
    path: "/dashboard/draw",
    section: "overview",
  },
  {
    label: "Kanban",
    icon: SquareKanban,
    path: "/dashboard/kanban",
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
    label: "Exchange",
    icon: ArrowLeftRight,
    path: "/dashboard/exchange",
    section: "finance",
  },
  {
    label: "Services",
    icon: Server,
    path: "/dashboard/services",
    section: "system",
  },
  {
    label: "Settings",
    icon: SlidersHorizontal,
    path: "/dashboard/settings",
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
  {
    label: "Backups",
    icon: DatabaseBackup,
    path: "/dashboard/admin/backups",
    section: "admin",
    adminOnly: true,
  },
];
