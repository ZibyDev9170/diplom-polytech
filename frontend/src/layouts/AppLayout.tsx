import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";

import { RoleCode } from "../api/client";
import { useAuth } from "../auth/AuthContext";

type NavigationItem = {
  to: string;
  label: string;
  roles: RoleCode[];
  icon?: string;
  collapsedIcon: string;
};

const navigationItems: NavigationItem[] = [
  {
    to: "/reviews",
    label: "Отзывы",
    roles: ["admin", "manager", "support"],
    icon: "/images/icons/message-square.svg",
    collapsedIcon: "/images/icons/message-square.svg",
  },
  {
    to: "/catalog",
    label: "Каталог",
    roles: ["admin", "manager"],
    icon: "/images/icons/catalog.svg",
    collapsedIcon: "/images/icons/catalog.svg",
  },
  {
    to: "/integration",
    label: "Интеграции",
    roles: ["admin", "manager"],
    icon: "/images/icons/download.svg",
    collapsedIcon: "/images/icons/download.svg",
  },
  {
    to: "/analytics",
    label: "Аналитика",
    roles: ["admin", "analyst"],
    icon: "/images/icons/bar-chart.svg",
    collapsedIcon: "/images/icons/bar-chart.svg",
  },
  {
    to: "/users",
    label: "Пользователи",
    roles: ["admin"],
    icon: "/images/icons/user.svg",
    collapsedIcon: "/images/icons/user.svg",
  },
];

const SIDEBAR_CONTENT_TRANSITION_MS = 160;
const SIDEBAR_WIDTH_TRANSITION_MS = 160;

export function AppLayout() {
  const { user, logout, hasRole } = useAuth();
  const location = useLocation();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isSidebarCompact, setIsSidebarCompact] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const sidebarTransitionTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (sidebarTransitionTimer.current) {
        window.clearTimeout(sidebarTransitionTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!isMobileMenuOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsMobileMenuOpen(false);
      }
    };

    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isMobileMenuOpen]);

  const handleSidebarToggle = () => {
    if (sidebarTransitionTimer.current) {
      window.clearTimeout(sidebarTransitionTimer.current);
    }

    if (isSidebarCompact) {
      setIsSidebarCollapsed(false);
      sidebarTransitionTimer.current = window.setTimeout(() => {
        setIsSidebarCompact(false);
      }, SIDEBAR_WIDTH_TRANSITION_MS);
      return;
    }

    setIsSidebarCompact(true);
    sidebarTransitionTimer.current = window.setTimeout(() => {
      setIsSidebarCollapsed(true);
    }, SIDEBAR_CONTENT_TRANSITION_MS);
  };

  const availableNavigationItems = navigationItems.filter((item) => hasRole(item.roles));
  const handleMobileLogout = () => {
    setIsMobileMenuOpen(false);
    logout();
  };
  const appShellClassName = [
    "app-shell",
    isSidebarCollapsed ? "sidebar-collapsed" : "",
    isSidebarCompact ? "sidebar-compact" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const currentSection =
    location.pathname.startsWith("/reviews/")
      ? "Карточка отзыва"
      : availableNavigationItems.find((item) => {
          if (item.to === "/") {
            return location.pathname === "/";
          }

          return location.pathname.startsWith(item.to);
        })?.label || "Раздел";

  return (
    <div className={appShellClassName}>
      <aside aria-label="Основная навигация">
        <div className="brand">
          <span className="brand-full">ReviewManager</span>
          <span className="brand-short">RM</span>
        </div>
        <div className="sidebar">
          <nav className="nav-list">
            {availableNavigationItems.map((item) => (
              <NavLink
                aria-label={item.label}
                className="nav-link"
                key={item.to}
                title={item.label}
                to={item.to}
              >
                <span className="nav-short" aria-hidden="true">
                  <img src={item.collapsedIcon} alt="" aria-hidden="true" />
                </span>
                {item.icon ? (
                  <img className="nav-icon" src={item.icon} alt="" aria-hidden="true" />
                ) : null}
                <span className="nav-full">{item.label}</span>
              </NavLink>
            ))}
          </nav>
        </div>
        <div className="sidebar-logout">
          <button className="ghost-button" type="button" onClick={logout}>
            <img src="/images/icons/log-out.svg" alt="" aria-hidden="true" />
            <span>Выйти</span>
          </button>
        </div>
      </aside>

      <div className="main-area">
        <header className="topbar">
          <div className="topbar-heading">
            <button
              aria-label={
                isSidebarCompact ? "Развернуть боковое меню" : "Свернуть боковое меню"
              }
              aria-pressed={isSidebarCompact}
              className="sidebar-toggle"
              onClick={handleSidebarToggle}
              type="button"
            >
              <img src="/images/icons/sidebar.svg" alt="" aria-hidden="true" />
            </button>
            <h1 className="topbar-title">{currentSection}</h1>
          </div>
          {user ? (
            <div className="topbar-user" aria-label="Текущий пользователь">
              <p className="user-name">{user.full_name}</p>
              <p className="user-role">{user.role.name}</p>
            </div>
          ) : null}
          <button
            aria-label="Открыть мобильное меню"
            aria-expanded={isMobileMenuOpen}
            className="mobile-menu-toggle"
            onClick={() => setIsMobileMenuOpen(true)}
            type="button"
          >
            <img src="/images/icons/menu.svg" alt="" aria-hidden="true" />
          </button>
        </header>

        <main className="content">
          <Outlet />
        </main>
      </div>

      <div
        aria-hidden={!isMobileMenuOpen}
        className={`mobile-drawer-overlay ${isMobileMenuOpen ? "is-open" : ""}`}
        onClick={() => setIsMobileMenuOpen(false)}
      >
        <aside
          aria-label="Мобильное меню"
          className="mobile-drawer"
          onClick={(event) => event.stopPropagation()}
        >
          {user ? (
            <div className="mobile-drawer-user">
              <p className="user-name">{user.full_name}</p>
              <p className="user-role">{user.role.name}</p>
            </div>
          ) : null}

          <nav className="mobile-nav-list">
            {availableNavigationItems.map((item) => (
              <NavLink className="mobile-nav-link" key={item.to} to={item.to}>
                <img src={item.icon || item.collapsedIcon} alt="" aria-hidden="true" />
                <span>{item.label}</span>
              </NavLink>
            ))}
          </nav>

          <button className="mobile-logout-button" type="button" onClick={handleMobileLogout}>
            <img src="/images/icons/log-out.svg" alt="" aria-hidden="true" />
            <span>Выйти</span>
          </button>
        </aside>
      </div>
    </div>
  );
}
