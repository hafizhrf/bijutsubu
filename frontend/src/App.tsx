import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";
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
import SettingsPage from "@/pages/SettingsPage";
import OverviewPage from "@/pages/OverviewPage";
// Imported for its side effect too: rehydration applies the saved theme
// before any route renders.
import "@/store/settingsStore";

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
            <Route path="/settings" element={<SettingsPage />} />
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
