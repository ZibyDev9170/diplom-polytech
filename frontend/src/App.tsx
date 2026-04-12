import { Navigate, Route, Routes } from "react-router-dom";

import { ProtectedRoute } from "./auth/ProtectedRoute";
import { useAuth } from "./auth/AuthContext";
import { AppLayout } from "./layouts/AppLayout";
import { CatalogPage } from "./pages/CatalogPage";
import { ForbiddenPage } from "./pages/ForbiddenPage";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { PlaceholderPage } from "./pages/PlaceholderPage";
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
          <Route path="reviews" element={<ReviewsPage />} />
          <Route path="reviews/:reviewId" element={<ReviewDetailPage />} />
          <Route element={<ProtectedRoute roles={["admin", "manager", "analyst"]} />}>
            <Route path="catalog" element={<CatalogPage />} />
          </Route>
          <Route element={<ProtectedRoute roles={["admin", "analyst"]} />}>
            <Route
              path="analytics"
              element={
                <PlaceholderPage
                  eyebrow="Аналитика"
                  text="Здесь появятся динамика отзывов, распределение статусов и рейтинг товаров."
                />
              }
            />
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
