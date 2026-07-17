import { useEffect } from "react";
import type { ReactNode } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useAuthStore } from "@/store/authStore";
import { me } from "@/api/auth";

interface ProtectedRouteProps {
  children?: ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);

  useEffect(() => {
    if (!token || (user?.displayName && user.createdAt && typeof user.isAdmin === "boolean")) return;
    void me().then(({ user: refreshed }) => setUser(refreshed)).catch(() => undefined);
  }, [setUser, token, user?.createdAt, user?.displayName]);

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  return children ? <>{children}</> : <Outlet />;
}
