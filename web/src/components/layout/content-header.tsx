import { useLocation, useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import {
  Bell,
  User,
  LogOut,
  Shield,
  ChevronRight,
  Palette,
  Check,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/auth-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { navItems } from "./sidebar-nav-items";
import { THEMES, useTheme } from "@/lib/theme";

// derive breadcrumbs from pathname
function useBreadcrumbs() {
  const { pathname } = useLocation();
  const segments = pathname.split("/").filter(Boolean);

  const crumbs: { label: string; path: string }[] = [];
  let accumulated = "";

  for (const segment of segments) {
    accumulated += `/${segment}`;

    // find matching nav item for a human-readable label
    const navItem = navItems.find((item) => item.path === accumulated);
    const label = navItem
      ? navItem.label
      : segment.charAt(0).toUpperCase() + segment.slice(1);

    crumbs.push({ label, path: accumulated });
  }

  return crumbs;
}

function getRoleBadgeClasses(role?: string) {
  switch (role) {
    case "admin":
      return "bg-destructive/10 text-destructive border-destructive/30";
    case "user":
      return "bg-primary/10 text-primary border-primary/30";
    case "guest":
      return "bg-accent/10 text-accent border-accent/30";
    default:
      return "bg-primary/10 text-primary border-primary/30";
  }
}

export function ContentHeader() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, logout, isGuest, isAdmin } = useAuth();
  const breadcrumbs = useBreadcrumbs();
  const [theme, setTheme] = useTheme();

  const handleLogout = async () => {
    await logout();
    queryClient.clear();
    navigate("/login");
  };

  return (
    <motion.header
      className="sticky top-0 z-30 flex items-center justify-between border-b border-border/50 bg-background/60 backdrop-blur-lg px-4 md:px-6 py-3"
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* left: breadcrumb */}
      <div className="flex items-center gap-3 min-w-0">
        <nav className="flex items-center gap-1 text-xs text-muted-foreground min-w-0">
          {breadcrumbs.map((crumb, idx) => (
            <div key={crumb.path} className="flex items-center gap-1 min-w-0">
              {idx > 0 && (
                <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/40" />
              )}
              {idx === breadcrumbs.length - 1 ? (
                <span className="truncate text-foreground font-medium tracking-wide">
                  {crumb.label.toUpperCase()}
                </span>
              ) : (
                <button
                  onClick={() => navigate(crumb.path)}
                  className="truncate hover:text-primary transition-colors"
                >
                  {crumb.label}
                </button>
              )}
            </div>
          ))}
        </nav>
      </div>

      {/* right: actions */}
      <div className="flex items-center gap-2 shrink-0">
        {isGuest && (
          <Badge
            variant="outline"
            className="text-[10px] bg-accent/10 text-accent border-accent/30 hidden sm:flex"
          >
            Guest Mode
          </Badge>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="relative text-muted-foreground hover:text-primary hover:bg-primary/10 h-8 w-8"
              aria-label="Color scheme"
            >
              <Palette className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Color scheme
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {THEMES.map((t) => (
              <DropdownMenuItem
                key={t.id}
                onClick={() => setTheme(t.id)}
                className="flex items-center gap-3"
              >
                <span
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border"
                  style={{ background: t.swatches[0] }}
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: t.swatches[1] }}
                  />
                </span>
                <span className="flex flex-col">
                  <span className="text-xs">{t.label}</span>
                  <span className="text-[10px] text-muted-foreground">{t.blurb}</span>
                </span>
                {theme === t.id && <Check className="ml-auto h-3.5 w-3.5 text-primary" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant="ghost"
          size="icon"
          className="relative text-muted-foreground hover:text-primary hover:bg-primary/10 h-8 w-8"
        >
          <Bell className="h-4 w-4" />
          <span className="absolute -top-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-destructive text-[9px] text-destructive-foreground">
            3
          </span>
        </Button>

        <div className="w-px h-5 bg-border/50 mx-1 hidden md:block" />

        {/* user dropdown — desktop only, mobile has logout in bottom nav overflow */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="hidden md:flex text-muted-foreground hover:text-primary hover:bg-primary/10 h-8 w-8"
            >
              <User className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="flex flex-col gap-1">
                <span className="text-xs truncate">{user?.email}</span>
                <Badge className={cn("w-fit text-[10px]", getRoleBadgeClasses(user?.role))}>
                  {user?.role?.toUpperCase()}
                </Badge>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {isAdmin && (
              <DropdownMenuItem onClick={() => navigate("/dashboard/admin/users")}>
                <Shield className="mr-2 h-3.5 w-3.5" />
                User Management
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={handleLogout} className="text-destructive">
              <LogOut className="mr-2 h-3.5 w-3.5" />
              Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </motion.header>
  );
}
