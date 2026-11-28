import { lazy, Suspense } from "react";
import { MotionConfig } from "motion/react";
import { Routes, Route, Navigate } from "react-router-dom";
import { LastSeenProvider } from "@/contexts/last-seen-provider";
import { OnlineOnly } from "@/components/layout/needs-connection";
import { EntrancePortal } from "@/components/entrance/entrance-portal";
import LoginPage from "@/pages/login";
import RegisterPage from "@/pages/register";
import { DashboardLayout } from "@/pages/dashboard/layout";
import DashboardPage from "@/pages/dashboard/page";
import ServicesPage from "@/pages/dashboard/services";
import BudgetPage from "@/pages/dashboard/budget/page";
import ExpensesPage from "@/pages/dashboard/budget/expenses";
import IncomesPage from "@/pages/dashboard/budget/incomes";
import SettingsPage from "@/pages/dashboard/settings";
import UsersPage from "@/pages/dashboard/admin/users";
import BackupsPage from "@/pages/dashboard/admin/backups";
import KanbanBoardsPage from "@/pages/dashboard/kanban/boards";
import KanbanBoardPage from "@/pages/dashboard/kanban/board";
import KanbanRemindersPage from "@/pages/dashboard/kanban/reminders";
import FeedPage from "@/pages/dashboard/feed/page";
import ExchangePage from "@/pages/dashboard/exchange";
import SharePage from "@/pages/share/page";
import { DrawEditorSkeleton } from "@/pages/dashboard/draw/skeleton";

// Excalidraw stays out of the dashboard bundle: this chunk loads only on
// /dashboard/draw/:boardId.
const DrawPage = lazy(() => import("@/pages/dashboard/draw/page"));
// The boards list carries no canvas code, so it splits into its own tiny chunk.
const BoardsPage = lazy(() => import("@/pages/dashboard/draw/boards"));

// The boards list is not the editor, so it gets a list-shaped fallback.
function BoardsSkeleton() {
  return (
    <div role="status" aria-label="Loading boards" className="mx-auto max-w-3xl p-6">
      <div className="h-7 w-32 animate-pulse rounded bg-muted" />
      <div className="mt-5 h-10 w-full animate-pulse rounded-lg bg-muted/40" />
      <div className="mt-6 space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-12 animate-pulse rounded-lg bg-muted/30" />
        ))}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <Routes>
      <Route path="/" element={<EntrancePortal />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/share" element={<SharePage />} />

      <Route
        path="/dashboard"
        element={
          <LastSeenProvider>
            <DashboardLayout />
          </LastSeenProvider>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="feed" element={<FeedPage />} />
        <Route path="services" element={<ServicesPage />} />
        <Route path="exchange" element={<ExchangePage />} />
        <Route path="budget" element={<BudgetPage />} />
        <Route path="budget/expenses" element={<ExpensesPage />} />
        <Route path="budget/incomes" element={<IncomesPage />} />
        <Route path="budget/settings" element={<Navigate to="/dashboard/settings#budget" replace />} />
        <Route path="budget/summary" element={<Navigate to="/dashboard/budget" replace />} />
        <Route path="budget/health" element={<Navigate to="/dashboard/budget" replace />} />
        <Route path="budget/subscriptions" element={<Navigate to="/dashboard/budget" replace />} />
        <Route
          path="admin/users"
          element={
            <OnlineOnly what="Users">
              <UsersPage />
            </OnlineOnly>
          }
        />
        <Route
          path="admin/backups"
          element={
            <OnlineOnly what="Backups">
              <BackupsPage />
            </OnlineOnly>
          }
        />
        <Route path="kanban" element={<KanbanBoardsPage />} />
        <Route path="kanban/settings" element={<Navigate to="/dashboard/settings#reminders" replace />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="kanban/reminders" element={<KanbanRemindersPage />} />
        <Route path="kanban/:boardId" element={<KanbanBoardPage />} />
        <Route
          path="draw"
          element={
            <Suspense fallback={<BoardsSkeleton />}>
              <BoardsPage />
            </Suspense>
          }
        />
        <Route
          path="draw/:boardId"
          element={
            <Suspense fallback={<DrawEditorSkeleton />}>
              <DrawPage />
            </Suspense>
          }
        />
      </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </MotionConfig>
  );
}
