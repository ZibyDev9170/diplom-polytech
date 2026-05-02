import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AnalyticsPage } from "../pages/AnalyticsPage";
import { CatalogPage } from "../pages/CatalogPage";
import { IntegrationPage } from "../pages/IntegrationPage";
import { LoginPage } from "../pages/LoginPage";
import { ReviewsPage } from "../pages/ReviewsPage";
import { UsersPage } from "../pages/UsersPage";

const { mockUseAuth, mockUseNotifications, mockApiClient } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  mockUseNotifications: vi.fn(),
  mockApiClient: {
    getUsers: vi.fn(),
    getRoles: vi.fn(),
    getReviewReferenceData: vi.fn(),
    getReviews: vi.fn(),
    getAnalyticsSummary: vi.fn(),
    getAnalyticsDynamics: vi.fn(),
    getAnalyticsProducts: vi.fn(),
    getAnalyticsProduct: vi.fn(),
    getImportBatches: vi.fn(),
    getCatalogProducts: vi.fn(),
    getCatalogReviewStatuses: vi.fn(),
    getCatalogReviewSources: vi.fn(),
  },
}));

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("../notifications/NotificationContext", () => ({
  useNotifications: () => mockUseNotifications(),
}));

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");

  return {
    ...actual,
    apiClient: mockApiClient,
  };
});

function renderWithRoute(element: ReactNode, path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={path} element={element} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Frontend smoke tests", () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({
      user: {
        id: 1,
        full_name: "Администратор",
        email: "admin@example.ru",
        is_active: true,
        role: { id: 1, code: "admin", name: "Администратор" },
      },
      token: "test-token",
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
      hasRole: vi.fn(() => true),
    });
    mockUseNotifications.mockReturnValue({
      notify: vi.fn(),
      closeNotification: vi.fn(),
    });
    window.innerHeight = 1200;
  });

  it("renders login page", () => {
    mockUseAuth.mockReturnValue({
      user: null,
      token: null,
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
      hasRole: vi.fn(() => false),
    });

    render(
      <MemoryRouter initialEntries={["/login"]}>
        <LoginPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "ReviewManager" })).toBeInTheDocument();
    expect(screen.getByLabelText("Почта")).toBeInTheDocument();
    expect(screen.getByLabelText("Пароль")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Войти" })).toBeInTheDocument();
  });

  it("renders users page with table data", async () => {
    mockApiClient.getUsers.mockResolvedValue([
      {
        id: 1,
        full_name: "Иван Админ",
        email: "admin@example.ru",
        role: { id: 1, code: "admin", name: "Администратор" },
        is_active: true,
        blocked_until: null,
        created_at: "2026-04-30T10:00:00Z",
        updated_at: "2026-04-30T10:00:00Z",
      },
    ]);
    mockApiClient.getRoles.mockResolvedValue([
      { id: 1, code: "admin", name: "Администратор" },
      { id: 2, code: "manager", name: "Менеджер" },
    ]);

    renderWithRoute(<UsersPage />, "/users");

    expect((await screen.findAllByText("Иван Админ")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Добавить пользователя")[0]).toBeInTheDocument();
  });

  it("renders reviews page with reference data and list", async () => {
    mockApiClient.getReviewReferenceData.mockResolvedValue({
      products: [{ id: 10, name: "Термокружка Travel", sku: "TRAVEL-001", is_active: true }],
      statuses: [
        {
          id: 1,
          code: "new",
          name: "Новый",
          sort_order: 1,
          is_terminal: false,
        },
      ],
      sources: [{ id: 1, code: "manual", name: "Ручной ввод" }],
      users: [
        {
          id: 2,
          full_name: "Оператор",
          email: "support@example.ru",
          role: { id: 3, code: "support", name: "Поддержка" },
        },
      ],
    });
    mockApiClient.getReviews.mockResolvedValue({
      items: [
        {
          id: 100,
          external_id: null,
          product: {
            id: 10,
            name: "Термокружка Travel",
            sku: "TRAVEL-001",
            is_active: true,
          },
          source: { id: 1, code: "manual", name: "Ручной ввод" },
          review_text: "Отлично держит температуру целый день.",
          rating: 5,
          review_date: "2026-04-30",
          status: {
            id: 1,
            code: "new",
            name: "Новый",
            sort_order: 1,
            is_terminal: false,
          },
          assigned_user: null,
          created_at: "2026-04-30T10:00:00Z",
          updated_at: "2026-04-30T10:00:00Z",
        },
      ],
      total: 1,
      limit: 10,
      offset: 0,
    });

    renderWithRoute(<ReviewsPage />, "/reviews");

    expect((await screen.findAllByText("Термокружка Travel")).length).toBeGreaterThan(0);
    expect(screen.getByText("Добавить отзыв")).toBeInTheDocument();
    expect(screen.getAllByText("Найдено отзывов: 1")[0]).toBeInTheDocument();
  });

  it("renders analytics page with summary and products", async () => {
    mockApiClient.getAnalyticsSummary.mockResolvedValue({
      average_rating: 4.2,
      total_reviews: 12,
      negative_reviews_count: 2,
      negative_share_percent: 16.67,
    });
    mockApiClient.getAnalyticsDynamics.mockResolvedValue([
      {
        review_day: "2026-04-29",
        reviews_count: 5,
        average_rating: 4.4,
        products: [{ product_id: 1, product_name: "Наушники Pulse", reviews_count: 3 }],
      },
    ]);
    mockApiClient.getAnalyticsProducts.mockResolvedValue([
      {
        product_id: 1,
        product_name: "Наушники Pulse",
        reviews_count: 8,
        average_rating: 4.1,
        negative_reviews_count: 1,
        negative_share_percent: 12.5,
        rating_distribution: [
          { rating: 1, reviews_count: 1 },
          { rating: 2, reviews_count: 0 },
          { rating: 3, reviews_count: 1 },
          { rating: 4, reviews_count: 2 },
          { rating: 5, reviews_count: 4 },
        ],
      },
    ]);

    renderWithRoute(<AnalyticsPage />, "/analytics");

    expect((await screen.findAllByText("Средняя оценка")).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Экспорт CSV" })).toBeInTheDocument();
    expect((await screen.findAllByText("Наушники Pulse")).length).toBeGreaterThan(0);
  });

  it("renders catalog page with products section", async () => {
    mockApiClient.getCatalogProducts.mockResolvedValue([
      {
        id: 1,
        name: "Беспроводные наушники Pulse",
        sku: "PULSE-001",
        is_active: true,
        created_at: "2026-04-30T10:00:00Z",
      },
    ]);
    mockApiClient.getCatalogReviewStatuses.mockResolvedValue([
      {
        id: 1,
        code: "new",
        name: "Новый",
        sort_order: 1,
        is_terminal: false,
      },
    ]);
    mockApiClient.getCatalogReviewSources.mockResolvedValue([
      { id: 1, code: "manual", name: "Ручной ввод" },
    ]);

    renderWithRoute(<CatalogPage />, "/catalog");

    expect((await screen.findAllByText("Беспроводные наушники Pulse")).length).toBeGreaterThan(0);
    expect(screen.getByText("Товары")).toBeInTheDocument();
    expect(screen.getByText("Статусы")).toBeInTheDocument();
    expect(screen.getByText("Источники")).toBeInTheDocument();
  });

  it("renders integration page with history", async () => {
    mockApiClient.getImportBatches.mockResolvedValue([
      {
        id: 1,
        source: { id: 1, code: "marketplace", name: "Маркетплейс" },
        started_at: "2026-04-30T10:00:00Z",
        finished_at: "2026-04-30T10:02:00Z",
        status: "completed",
        total_count: 10,
        success_count: 8,
        failed_count: 1,
        skipped_count: 1,
        items: [],
      },
    ]);

    renderWithRoute(<IntegrationPage />, "/integration");

    expect(await screen.findByText("Perekrestok Reviews")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Предпросмотр" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Импортировать отзывы" })).toBeInTheDocument();
  });
});
