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
import UsersPage from "@/pages/dashboard/admin/users";

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
        <Route path="budget/summary" element={<Navigate to="/dashboard/budget" replace />} />
        <Route path="budget/health" element={<Navigate to="/dashboard/budget" replace />} />
        <Route path="budget/subscriptions" element={<Navigate to="/dashboard/budget" replace />} />
        <Route path="admin/users" element={<UsersPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
