import { Navigate, Outlet, useLocation } from "react-router-dom";

import { RoleCode } from "../api/client";
import { useAuth } from "./AuthContext";

type ProtectedRouteProps = {
  roles?: RoleCode[];
};

export function ProtectedRoute({ roles }: ProtectedRouteProps) {
  const { user, isLoading, hasRole } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <section className="page">
        <p className="muted">Проверяем сессию...</p>
      </section>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (roles && !hasRole(roles)) {
    return <Navigate to="/403" replace />;
  }

  return <Outlet />;
}
