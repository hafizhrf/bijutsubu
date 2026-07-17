import { BrowserRouter, Navigate, Route, Routes, useSearchParams } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useAuthStore } from "@/store/authStore";
import { AppLayout } from "@/components/layout/AppLayout";
import { BrandTransition } from "@/components/layout/BrandTransition";
import LoginPage from "@/pages/LoginPage";
import RegisterPage from "@/pages/RegisterPage";
import DocumentsPage from "@/pages/DocumentsPage";
import DashboardPage from "@/pages/DashboardPage";
import DashboardDetailPage from "@/pages/DashboardDetailPage";
import CollectionsPage from "@/pages/CollectionsPage";
import LogsPage from "@/pages/LogsPage";
import KnowledgePage from "@/pages/KnowledgePage";
import OverviewPage from "@/pages/OverviewPage";
import PricingPage from "@/pages/PricingPage";
import AdminPage from "@/pages/AdminPage";
import { SETTINGS_SECTIONS } from "@/components/settings/SettingsDialog";
// Imported for its side effect too: rehydration applies the saved theme
// before any route renders.
import "@/store/settingsStore";

/** Back-compat: the old /settings page now opens as a modal via ?settings=. */
function SettingsRedirect() {
  const [params] = useSearchParams();
  const section = params.get("section") ?? "account";
  const valid = (SETTINGS_SECTIONS as readonly string[]).includes(section) ? section : "account";
  return <Navigate to={`/overview?settings=${valid}`} replace />;
}

function AdminRoute() { const isAdmin = useAuthStore((state) => state.user?.isAdmin); return isAdmin ? <AdminPage /> : <Navigate to="/overview" replace />; }

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route path="/overview" element={<OverviewPage />} />
            <Route path="/documents" element={<DocumentsPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/dashboard/:id" element={<DashboardDetailPage />} />
            <Route path="/collections" element={<CollectionsPage />} />
            <Route path="/knowledge" element={<KnowledgePage />} />
            <Route path="/logs" element={<LogsPage />} />
            <Route path="/pricing" element={<PricingPage />} />
            <Route path="/admin" element={<AdminRoute />} />
            <Route path="/settings" element={<SettingsRedirect />} />
          </Route>
        </Route>

        <Route path="/analytics" element={<Navigate to="/dashboard" replace />} />
        <Route path="/" element={<Navigate to="/overview" replace />} />
        <Route path="*" element={<Navigate to="/overview" replace />} />
      </Routes>
      <BrandTransition />
    </BrowserRouter>
  );
}

export default App;
