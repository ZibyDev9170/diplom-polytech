import { NavLink, Outlet } from "react-router-dom";

export function AppLayout() {
  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Основная навигация">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            RM
          </span>
          <span>Отзывы</span>
        </div>

        <nav className="nav-list">
          <NavLink to="/">Обзор</NavLink>
        </nav>
      </aside>

      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
