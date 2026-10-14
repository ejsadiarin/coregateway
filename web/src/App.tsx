import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/contexts/query-context";
import { EntrancePortal } from "@/components/entrance/entrance-portal";
import LoginPage from "@/pages/login";
import RegisterPage from "@/pages/register";
import { DashboardLayout } from "@/pages/dashboard/layout";
import DashboardPage from "@/pages/dashboard/page";
import ServicesPage from "@/pages/dashboard/services";
import BudgetPage from "@/pages/dashboard/budget/page";
import ExpensesPage from "@/pages/dashboard/budget/expenses";
import IncomesPage from "@/pages/dashboard/budget/incomes";
import SettingsPage from "@/pages/dashboard/budget/settings";
import Budget2Page from "@/pages/dashboard/budget2";
import Budget3Page from "@/pages/dashboard/budget3";
import Budget4Page from "@/pages/dashboard/budget4";
import UsersPage from "@/pages/dashboard/admin/users";

// tldraw stays out of the dashboard bundle: this chunk loads only on /dashboard/draw.
const DrawPage = lazy(() => import("@/pages/dashboard/draw/page"));

// Kept inline (not imported from the draw page) so the fallback itself
// doesn't pull the tldraw chunk into the dashboard bundle.
function DrawFallback() {
  return (
    <div className="flex h-full min-h-[500px] items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<EntrancePortal />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      <Route
        path="/dashboard"
        element={
          <QueryClientProvider client={queryClient}>
            <DashboardLayout />
          </QueryClientProvider>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="services" element={<ServicesPage />} />
        <Route path="budget" element={<BudgetPage />} />
        <Route path="budget/expenses" element={<ExpensesPage />} />
        <Route path="budget/incomes" element={<IncomesPage />} />
          <Route path="budget/settings" element={<SettingsPage />} />
          <Route path="budget2" element={<Budget2Page />} />
          <Route path="budget3" element={<Budget3Page />} />
          <Route path="budget4" element={<Budget4Page />} />
        <Route path="budget/summary" element={<Navigate to="/dashboard/budget" replace />} />
        <Route path="budget/health" element={<Navigate to="/dashboard/budget" replace />} />
        <Route path="budget/subscriptions" element={<Navigate to="/dashboard/budget" replace />} />
        <Route path="admin/users" element={<UsersPage />} />
        <Route
          path="draw/:boardId?"
          element={
            <Suspense fallback={<DrawFallback />}>
              <DrawPage />
            </Suspense>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
