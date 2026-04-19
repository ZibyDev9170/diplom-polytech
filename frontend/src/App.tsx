import { Navigate, Route, Routes } from "react-router-dom";

import { ProtectedRoute } from "./auth/ProtectedRoute";
import { useAuth } from "./auth/AuthContext";
import { AppLayout } from "./layouts/AppLayout";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { CatalogPage } from "./pages/CatalogPage";
import { ForbiddenPage } from "./pages/ForbiddenPage";
import { IntegrationPage } from "./pages/IntegrationPage";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { ReviewDetailPage, ReviewsPage } from "./pages/ReviewsPage";
import { UsersPage } from "./pages/UsersPage";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/403" element={<ForbiddenPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route index element={<RoleLandingRedirect />} />
          <Route element={<ProtectedRoute roles={["admin", "manager", "support"]} />}>
            <Route path="reviews" element={<ReviewsPage />} />
            <Route path="reviews/:reviewId" element={<ReviewDetailPage />} />
          </Route>
          <Route element={<ProtectedRoute roles={["admin", "manager"]} />}>
            <Route path="catalog" element={<CatalogPage />} />
          </Route>
          <Route element={<ProtectedRoute roles={["admin", "manager"]} />}>
            <Route path="integration" element={<IntegrationPage />} />
          </Route>
          <Route element={<ProtectedRoute roles={["admin", "analyst"]} />}>
            <Route path="analytics" element={<AnalyticsPage />} />
          </Route>
          <Route element={<ProtectedRoute roles={["admin"]} />}>
            <Route path="users" element={<UsersPage />} />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}

function RoleLandingRedirect() {
  const { user } = useAuth();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <Navigate to={getLandingPathByRole(user.role.code)} replace />;
}

function getLandingPathByRole(roleCode: string) {
  if (roleCode === "admin") {
    return "/users";
  }

  if (roleCode === "analyst") {
    return "/analytics";
  }

  return "/reviews";
}
