import { Route, Routes } from "react-router-dom";

import { ProtectedRoute } from "./auth/ProtectedRoute";
import { AppLayout } from "./layouts/AppLayout";
import { DashboardPage } from "./pages/DashboardPage";
import { ForbiddenPage } from "./pages/ForbiddenPage";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { PlaceholderPage } from "./pages/PlaceholderPage";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/403" element={<ForbiddenPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route
            path="reviews"
            element={
              <PlaceholderPage
                eyebrow="Отзывы"
                text="Здесь появятся список отзывов, фильтры, статусы и назначение ответственных."
              />
            }
          />
          <Route element={<ProtectedRoute roles={["admin", "manager", "analyst"]} />}>
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
            <Route
              path="users"
              element={
                <PlaceholderPage
                  eyebrow="Пользователи"
                  text="Здесь появятся пользователи, роли и активность входов."
                />
              }
            />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
