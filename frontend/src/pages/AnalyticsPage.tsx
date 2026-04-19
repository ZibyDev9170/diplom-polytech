import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

import {
  AnalyticsDynamicsItem,
  AnalyticsProductDetail,
  AnalyticsProductSummary,
  AnalyticsSummary,
  Product,
  RatingDistributionItem,
  apiClient,
} from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Pagination } from "../components/Pagination";
import { useNotifications } from "../notifications/NotificationContext";

type AnalyticsFilters = {
  productId: string;
  dateFrom: string;
  dateTo: string;
};

const PRODUCTS_PER_PAGE = 5;
const TOOLTIP_HORIZONTAL_PADDING = 170;

const emptySummary: AnalyticsSummary = {
  average_rating: 0,
  total_reviews: 0,
  negative_reviews_count: 0,
  negative_share_percent: 0,
};

const emptyFilters: AnalyticsFilters = {
  productId: "",
  dateFrom: "",
  dateTo: "",
};

const shortDateFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
});

export function AnalyticsPage() {
  const { token } = useAuth();
  const { notify } = useNotifications();
  const [filters, setFilters] = useState<AnalyticsFilters>(emptyFilters);
  const [products, setProducts] = useState<Product[]>([]);
  const [summary, setSummary] = useState<AnalyticsSummary>(emptySummary);
  const [dynamics, setDynamics] = useState<AnalyticsDynamicsItem[]>([]);
  const [productStats, setProductStats] = useState<AnalyticsProductSummary[]>([]);
  const [productAnalytics, setProductAnalytics] = useState<AnalyticsProductDetail | null>(
    null,
  );
  const [currentPage, setCurrentPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedProductId = parsePositiveInt(filters.productId);

  const analyticsParams = useMemo(
    () => ({
      ...(selectedProductId ? { product_id: selectedProductId } : {}),
      ...(filters.dateFrom ? { date_from: filters.dateFrom } : {}),
      ...(filters.dateTo ? { date_to: filters.dateTo } : {}),
    }),
    [filters.dateFrom, filters.dateTo, selectedProductId],
  );

  const periodParams = useMemo(
    () => ({
      ...(filters.dateFrom ? { date_from: filters.dateFrom } : {}),
      ...(filters.dateTo ? { date_to: filters.dateTo } : {}),
    }),
    [filters.dateFrom, filters.dateTo],
  );

  const loadAnalytics = useCallback(async () => {
    if (!token) {
      setError("Не удалось получить токен авторизации.");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    try {
      const [summaryResponse, dynamicsResponse, productsResponse] = await Promise.all([
        apiClient.getAnalyticsSummary(token, analyticsParams),
        apiClient.getAnalyticsDynamics(token, analyticsParams),
        apiClient.getAnalyticsProducts(token, periodParams),
      ]);

      const productResponse = selectedProductId
        ? await apiClient.getAnalyticsProduct(token, selectedProductId, periodParams)
        : null;

      setProducts(buildProductsFromAnalytics(productsResponse));
      setSummary(summaryResponse);
      setDynamics(dynamicsResponse);
      setProductStats(productsResponse);
      setProductAnalytics(productResponse);
      setError(null);
    } catch (requestError) {
      setSummary(emptySummary);
      setDynamics([]);
      setProductStats([]);
      setProductAnalytics(null);
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось загрузить аналитику.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [analyticsParams, periodParams, selectedProductId, token]);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  const totalPages = Math.max(1, Math.ceil(productStats.length / PRODUCTS_PER_PAGE));
  const paginatedProductStats = productStats.slice(
    (currentPage - 1) * PRODUCTS_PER_PAGE,
    currentPage * PRODUCTS_PER_PAGE,
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [filters.dateFrom, filters.dateTo]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const handleFilterChange = (field: keyof AnalyticsFilters, value: string) => {
    setFilters((current) => ({ ...current, [field]: value }));
  };

  const resetFilters = () => {
    setFilters(emptyFilters);
    setCurrentPage(1);
  };

  const handleExport = async () => {
    if (!token) {
      return;
    }

    setIsExporting(true);

    try {
      const blob = await apiClient.exportAnalyticsCsv(token, analyticsParams);
      downloadBlob(blob, "analytics_product_summary.csv");
      notify({
        type: "success",
        title: "Успешное действие",
        message: "CSV-отчет успешно экспортирован.",
      });
    } catch (requestError) {
      notify({
        type: "error",
        title: "Ошибка",
        message:
          requestError instanceof Error
            ? requestError.message
            : "Не удалось экспортировать CSV.",
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <section className="analytics-page">
      <div className="analytics-filters">
        <label className="analytics-filter-field analytics-filter-field--product">
          Товар
          <select
            value={filters.productId}
            onChange={(event) => handleFilterChange("productId", event.target.value)}
          >
            <option value="">Все</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
        </label>

        <div className="analytics-filter-field analytics-filter-field--period">
          <span>Период</span>
          <div className="analytics-period-fields">
            <input
              aria-label="Дата начала периода"
              type="date"
              value={filters.dateFrom}
              onChange={(event) => handleFilterChange("dateFrom", event.target.value)}
            />
            <input
              aria-label="Дата окончания периода"
              type="date"
              value={filters.dateTo}
              onChange={(event) => handleFilterChange("dateTo", event.target.value)}
            />
          </div>
        </div>

        <button
          className="secondary-button analytics-reset-button"
          type="button"
          onClick={resetFilters}
        >
          Сбросить
        </button>

        <button
          className="primary-button analytics-export-button"
          type="button"
          disabled={isExporting}
          onClick={handleExport}
        >
          <img src="/images/icons/download.svg" alt="" aria-hidden="true" />
          {isExporting ? "Экспорт..." : "Экспорт CSV"}
        </button>
      </div>

      {error ? <p className="users-state users-state--error">{error}</p> : null}

      <div className="analytics-kpi-grid" aria-busy={isLoading}>
        <KpiCard
          icon="/images/icons/star.svg"
          tone="blue"
          title="Средняя оценка"
          value={formatNumber(summary.average_rating)}
          caption="из 5"
        />
        <KpiCard
          icon="/images/icons/growth.svg"
          tone="green"
          title="Количество отзывов"
          value={formatInteger(summary.total_reviews)}
          caption="всего"
        />
        <KpiCard
          icon="/images/icons/danger.svg"
          tone="red"
          title="Доля негативных"
          value={`${formatNumber(summary.negative_share_percent)}%`}
          caption={`${formatInteger(summary.negative_reviews_count)} отзывов`}
        />
      </div>

      <div className="analytics-charts-grid">
        <section className="analytics-panel">
          <h2>Динамика отзывов по времени</h2>
          <DynamicsLineChart items={dynamics} isLoading={isLoading} />
        </section>

        <section className="analytics-panel">
          <h2>
            {selectedProductId
              ? "Распределение оценок по товару"
              : "Распределение отзывов по товарам"}
          </h2>
          {selectedProductId ? (
            <RatingDistributionChart
              items={productAnalytics?.rating_distribution ?? []}
              isLoading={isLoading}
            />
          ) : (
          <ProductsDistributionChart
            items={productStats}
            isLoading={isLoading}
            onProductSelect={(productId) =>
              handleFilterChange("productId", String(productId))
            }
          />
          )}
        </section>
      </div>

      <section className="analytics-table-panel">
        <h2>Детальная статистика по товарам</h2>
        <div className="analytics-table-scroll">
          <table className="analytics-table">
            <thead>
              <tr>
                <th>Товар</th>
                <th>Количество отзывов</th>
                <th>Средняя оценка</th>
                <th>Доля негативных</th>
              </tr>
            </thead>
            <tbody>
              {paginatedProductStats.map((product) => (
                <tr key={product.product_id}>
                  <td title={product.product_name}>
                    {truncateText(product.product_name, 50)}
                  </td>
                  <td>{formatInteger(product.reviews_count)}</td>
                  <td>{formatNumber(product.average_rating)}</td>
                  <td>{formatNumber(product.negative_share_percent)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!isLoading && paginatedProductStats.length === 0 ? (
            <p className="users-state">По выбранным фильтрам данных нет.</p>
          ) : null}
          {isLoading ? <p className="users-state">Загружаем аналитику...</p> : null}
        </div>
        <div className="analytics-mobile-list">
          {paginatedProductStats.map((product) => (
            <article className="analytics-mobile-card" key={product.product_id}>
              <div>
                <span>Товар</span>
                <strong>{product.product_name}</strong>
              </div>
              <div>
                <span>Количество отзывов</span>
                <strong>{formatInteger(product.reviews_count)}</strong>
              </div>
              <div>
                <span>Средняя оценка</span>
                <strong>{formatNumber(product.average_rating)}</strong>
              </div>
              <div>
                <span>Доля негативных</span>
                <strong>{formatNumber(product.negative_share_percent)}%</strong>
              </div>
            </article>
          ))}
          {!isLoading && paginatedProductStats.length === 0 ? (
            <p className="users-state">По выбранным фильтрам данных нет.</p>
          ) : null}
          {isLoading ? <p className="users-state">Загружаем аналитику...</p> : null}
        </div>
        {totalPages > 1 ? (
          <Pagination
            ariaLabel="Пагинация детальной статистики"
            className="analytics-pagination"
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
          />
        ) : null}
      </section>
    </section>
  );
}

type KpiCardProps = {
  icon: string;
  tone: "blue" | "green" | "red";
  title: string;
  value: string;
  caption: string;
};

function KpiCard({ icon, tone, title, value, caption }: KpiCardProps) {
  return (
    <article className="analytics-kpi-card">
      <div className={`analytics-kpi-icon analytics-kpi-icon--${tone}`}>
        <img src={icon} alt="" aria-hidden="true" />
      </div>
      <div>
        <h2>{title}</h2>
        <strong>{value}</strong>
        <span>{caption}</span>
      </div>
    </article>
  );
}

function DynamicsLineChart({
  items,
  isLoading,
}: {
  items: AnalyticsDynamicsItem[];
  isLoading: boolean;
}) {
  const [tooltip, setTooltip] = useState<FloatingTooltipState | null>(null);
  const [scrollRef, containerWidth] = useElementWidth<HTMLDivElement>();
  const isMobile = useMediaQuery("(max-width: 760px)");
  const showLineTooltip = (
    target: HTMLElement,
    content: TooltipContent,
    forceToggle = false,
  ) => {
    if (forceToggle && tooltip) {
      setTooltip(null);
      return;
    }

    setTooltip(
      buildFloatingTooltipFromRect(target.getBoundingClientRect(), content),
    );
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
  }, [items]);

  if (!isLoading && items.length === 0) {
    return <ChartEmptyState />;
  }

  const visibleItemsCount = isMobile ? 4 : 7;
  const height = 210;
  const padding = { top: 28, right: 34, bottom: 42, left: 46 };
  const availableWidth = Math.max(containerWidth, isMobile ? 320 : 560);
  const availableDrawableWidth = availableWidth - padding.left - padding.right;
  const itemStep =
    items.length > visibleItemsCount
      ? availableDrawableWidth / Math.max(visibleItemsCount - 1, 1)
      : availableDrawableWidth / Math.max(items.length - 1, 1);
  const width =
    items.length > visibleItemsCount
      ? padding.left + padding.right + Math.max(items.length - 1, 0) * itemStep
      : availableWidth;
  const maxCount = Math.max(1, ...items.map((item) => item.reviews_count));
  const drawableHeight = height - padding.top - padding.bottom;
  const points = items.map((item, index) => {
    const x =
      items.length === 1
        ? padding.left + availableDrawableWidth / 2
        : padding.left + index * itemStep;
    const y =
      padding.top +
      drawableHeight -
      (item.reviews_count / maxCount) * drawableHeight;

    return { ...item, x, y };
  });
  const linePath = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");

  return (
    <div className="analytics-line-scroll" ref={scrollRef}>
      <div className="analytics-line-plot" style={{ width, height }}>
        <svg
          className="analytics-line-chart"
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="Динамика количества отзывов по дням"
        >
          <line
            x1={padding.left}
            x2={width - padding.right}
            y1={height - padding.bottom}
            y2={height - padding.bottom}
          />
          <line
            x1={padding.left}
            x2={padding.left}
            y1={padding.top}
            y2={height - padding.bottom}
          />
          {linePath ? <path d={linePath} /> : null}
          {points.map((point) => (
            <g key={point.review_day}>
              <circle cx={point.x} cy={point.y} r="5" />
              <text className="analytics-chart-value" x={point.x} y={point.y - 10}>
                {point.reviews_count}
              </text>
              <text
                className="analytics-chart-label"
                x={point.x}
                y={height - padding.bottom + 24}
              >
                {formatShortDate(point.review_day)}
              </text>
            </g>
          ))}
        </svg>
        {points.map((point) => (
          <span
            aria-label={buildDynamicsTooltip(point)}
            className="analytics-line-point-hit"
            key={point.review_day}
            onBlur={() => setTooltip(null)}
            onFocus={(event) =>
              showLineTooltip(
                event.currentTarget,
                buildDynamicsTooltipContent(point),
              )
            }
            onMouseEnter={(event) =>
              !isMobile &&
              setTooltip(
                buildFloatingTooltipFromEvent(
                  event.clientX,
                  event.clientY,
                  buildDynamicsTooltipContent(point),
                ),
              )
            }
            onMouseLeave={() => !isMobile && setTooltip(null)}
            onMouseMove={(event) =>
              !isMobile &&
              setTooltip(
                buildFloatingTooltipFromEvent(
                  event.clientX,
                  event.clientY,
                  buildDynamicsTooltipContent(point),
                ),
              )
            }
            onClick={(event) => {
              if (!isMobile) {
                return;
              }

              showLineTooltip(
                event.currentTarget,
                buildDynamicsTooltipContent(point),
                true,
              );
            }}
            role="img"
            style={
              {
                left: point.x,
                top: point.y,
              } as CSSProperties
            }
            tabIndex={0}
          />
        ))}
      </div>
      <FloatingTooltip tooltip={tooltip} />
    </div>
  );
}

function ProductsDistributionChart({
  items,
  isLoading,
  onProductSelect,
}: {
  items: AnalyticsProductSummary[];
  isLoading: boolean;
  onProductSelect: (productId: number) => void;
}) {
  const [scrollRef, containerWidth] = useElementWidth<HTMLDivElement>();
  const isMobile = useMediaQuery("(max-width: 760px)");

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = 0;
    }
  }, [items]);

  if (!isLoading && items.length === 0) {
    return <ChartEmptyState />;
  }

  const maxCount = Math.max(1, ...items.map((item) => item.reviews_count));
  const visibleItemsCount = isMobile ? 3 : 5;
  const gap = 16;
  const availableWidth = Math.max(containerWidth, isMobile ? 300 : 520);
  const barWidth = Math.max(
    72,
    (availableWidth - gap * (visibleItemsCount - 1)) / visibleItemsCount,
  );
  const chartWidth =
    items.length > visibleItemsCount
      ? items.length * barWidth + gap * Math.max(items.length - 1, 0)
      : availableWidth;

  return (
    <div className="analytics-bar-scroll" ref={scrollRef}>
      <div
        className="analytics-bar-chart"
        style={{
          gridAutoColumns: `${barWidth}px`,
          justifyContent: items.length <= visibleItemsCount ? "center" : "start",
          minWidth: chartWidth,
        }}
      >
        {items.map((item) => (
          <BarItem
            key={item.product_id}
            label={item.product_name}
            value={item.reviews_count}
            maxValue={maxCount}
            tooltipTitle={item.product_name}
            tooltipLines={buildRatingTooltipLines(item.rating_distribution)}
            onSelect={() => onProductSelect(item.product_id)}
          />
        ))}
      </div>
    </div>
  );
}

function RatingDistributionChart({
  items,
  isLoading,
}: {
  items: RatingDistributionItem[];
  isLoading: boolean;
}) {
  const normalizedItems =
    items.length > 0
      ? items
      : Array.from({ length: 5 }, (_, index) => ({
          rating: index + 1,
          reviews_count: 0,
        }));
  const maxCount = Math.max(1, ...normalizedItems.map((item) => item.reviews_count));

  if (!isLoading && normalizedItems.every((item) => item.reviews_count === 0)) {
    return <ChartEmptyState />;
  }

  return (
    <div className="analytics-bar-chart analytics-bar-chart--ratings">
      {normalizedItems.map((item) => (
        <BarItem
          key={item.rating}
          label={`${item.rating}`}
          value={item.reviews_count}
          maxValue={maxCount}
          hasTooltip={false}
        />
      ))}
    </div>
  );
}

function BarItem({
  label,
  value,
  maxValue,
  tooltipTitle,
  tooltipLines = [],
  hasTooltip = true,
  onSelect,
}: {
  label: string;
  value: number;
  maxValue: number;
  tooltipTitle?: string;
  tooltipLines?: string[];
  hasTooltip?: boolean;
  onSelect?: () => void;
}) {
  const heightPercent = maxValue > 0 ? Math.max(4, (value / maxValue) * 100) : 0;
  const shouldShowTooltip = hasTooltip && tooltipLines.length > 0;

  return (
    <div
      className={`analytics-bar-item ${onSelect ? "analytics-bar-item--selectable" : ""}`}
    >
      <div className="analytics-bar-track">
        <span
          className="analytics-bar-value"
          style={{ bottom: value > 0 ? `calc(${heightPercent}% + 6px)` : "6px" }}
        >
          {formatInteger(value)}
        </span>
        <span
          className="analytics-bar-fill"
          style={{ height: value > 0 ? `${heightPercent}%` : 0 }}
        />
      </div>
      <strong>{label}</strong>
      {shouldShowTooltip ? (
        <BarFloatingTooltip
          title={tooltipTitle || label}
          lines={tooltipLines}
          onSelect={onSelect}
        />
      ) : null}
    </div>
  );
}

type FloatingTooltipState = {
  title: string;
  lines: string[];
  x: number;
  y: number;
  placement: "top" | "bottom";
};

type TooltipContent = {
  title: string;
  lines: string[];
};

function BarFloatingTooltip({
  title,
  lines,
  onSelect,
}: {
  title: string;
  lines: string[];
  onSelect?: () => void;
}) {
  const [tooltip, setTooltip] = useState<FloatingTooltipState | null>(null);
  const content = useMemo(() => ({ title, lines }), [lines, title]);
  const isMobile = useMediaQuery("(max-width: 760px)");
  const showTooltip = (target: HTMLElement, forceToggle = false) => {
    if (forceToggle && tooltip) {
      setTooltip(null);
      return;
    }

    setTooltip(buildFloatingTooltipFromRect(target.getBoundingClientRect(), content));
  };

  return (
    <span
      className="analytics-bar-tooltip-hit"
      onBlur={() => setTooltip(null)}
      onFocus={(event) => showTooltip(event.currentTarget)}
      onMouseEnter={(event) =>
        !isMobile &&
        setTooltip(buildFloatingTooltipFromEvent(event.clientX, event.clientY, content))
      }
      onMouseLeave={() => !isMobile && setTooltip(null)}
      onMouseMove={(event) =>
        !isMobile &&
        setTooltip(buildFloatingTooltipFromEvent(event.clientX, event.clientY, content))
      }
      onClick={(event) => {
        if (onSelect) {
          onSelect();
          return;
        }

        if (!isMobile) {
          return;
        }

        showTooltip(event.currentTarget, true);
      }}
      onKeyDown={(event) => {
        if (!onSelect || (event.key !== "Enter" && event.key !== " ")) {
          return;
        }

        event.preventDefault();
        onSelect();
      }}
      role={onSelect ? "button" : undefined}
      tabIndex={0}
    >
      <FloatingTooltip tooltip={tooltip} />
    </span>
  );
}

function FloatingTooltip({ tooltip }: { tooltip: FloatingTooltipState | null }) {
  if (!tooltip) {
    return null;
  }

  return (
    <span
      className={`analytics-floating-tooltip analytics-floating-tooltip--${tooltip.placement}`}
      role="tooltip"
      style={{ left: tooltip.x, top: tooltip.y }}
    >
      <b>{tooltip.title}</b>
      {tooltip.lines.map((line) => (
        <span key={line}>{line}</span>
      ))}
    </span>
  );
}

function ChartEmptyState() {
  return <p className="analytics-empty">Недостаточно данных для диаграммы.</p>;
}

function buildProductsFromAnalytics(items: AnalyticsProductSummary[]): Product[] {
  return items.map((item) => ({
    id: item.product_id,
    name: item.product_name,
    sku: "",
    is_active: true,
  }));
}

function truncateText(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function parsePositiveInt(value: string): number | undefined {
  const parsedValue = Number(value);

  return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : undefined;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 2,
  }).format(value);
}

function formatInteger(value: number) {
  return new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 0,
  }).format(value);
}

function formatShortDate(value: string) {
  return shortDateFormatter.format(new Date(value));
}

function buildDynamicsTooltip(item: AnalyticsDynamicsItem) {
  const productLines = item.products.length
    ? item.products.map(
        (product) =>
          `${product.product_name}: ${formatInteger(product.reviews_count)}`,
      )
    : ["Нет отзывов"];

  return [
    formatShortDate(item.review_day),
    `Всего отзывов: ${formatInteger(item.reviews_count)}`,
    ...productLines,
  ].join("\n");
}

function buildDynamicsTooltipContent(item: AnalyticsDynamicsItem): TooltipContent {
  return {
    title: formatShortDate(item.review_day),
    lines: [
      `Всего отзывов: ${formatInteger(item.reviews_count)}`,
      ...(item.products.length > 0
        ? item.products.map(
            (product) =>
              `${product.product_name}: ${formatInteger(product.reviews_count)}`,
          )
        : ["Нет отзывов"]),
    ],
  };
}

function buildRatingTooltipLines(items: RatingDistributionItem[]) {
  const countsByRating = new Map(
    items.map((item) => [item.rating, item.reviews_count] as const),
  );

  return Array.from(
    { length: 5 },
    (_, index) => {
      const rating = 5 - index;

      return `${rating}: ${formatInteger(countsByRating.get(rating) ?? 0)}`;
    },
  );
}

function buildFloatingTooltipFromEvent(
  clientX: number,
  clientY: number,
  content: TooltipContent,
): FloatingTooltipState {
  return {
    ...content,
    ...getFloatingTooltipPosition(clientX, clientY, content.lines.length),
  };
}

function buildFloatingTooltipFromRect(
  rect: DOMRect,
  content: TooltipContent,
): FloatingTooltipState {
  return buildFloatingTooltipFromEvent(
    rect.left + rect.width / 2,
    rect.top + rect.height / 2,
    content,
  );
}

function getFloatingTooltipPosition(
  clientX: number,
  clientY: number,
  linesCount: number,
): Pick<FloatingTooltipState, "x" | "y" | "placement"> {
  const viewportWidth =
    typeof window === "undefined" ? 1024 : window.innerWidth;
  const viewportHeight =
    typeof window === "undefined" ? 768 : window.innerHeight;
  const minX = Math.min(
    TOOLTIP_HORIZONTAL_PADDING,
    Math.max(100, viewportWidth / 2 - 12),
  );
  const maxX = Math.max(minX, viewportWidth - minX);
  const x = Math.min(Math.max(clientX, minX), maxX);
  const estimatedTooltipHeight = 38 + linesCount * 22;
  const viewportGap = 12;

  if (clientY < estimatedTooltipHeight + 48) {
    const maxBottomY = Math.max(
      viewportGap,
      viewportHeight - estimatedTooltipHeight - viewportGap,
    );

    return {
      x,
      y: Math.min(Math.max(clientY + 18, viewportGap), maxBottomY),
      placement: "bottom",
    };
  }

  return {
    x,
    y: Math.min(
      Math.max(clientY - 10, estimatedTooltipHeight + viewportGap),
      viewportHeight - viewportGap,
    ),
    placement: "top",
  };
}

function useElementWidth<T extends HTMLElement>() {
  const elementRef = useRef<T>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = elementRef.current;

    if (!element) {
      return;
    }

    const updateWidth = () => {
      setWidth(element.clientWidth);
    };

    updateWidth();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateWidth);

      return () => {
        window.removeEventListener("resize", updateWidth);
      };
    }

    const resizeObserver = new ResizeObserver(updateWidth);
    resizeObserver.observe(element);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  return [elementRef, width] as const;
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mediaQueryList = window.matchMedia(query);
    const updateMatches = () => setMatches(mediaQueryList.matches);

    updateMatches();
    mediaQueryList.addEventListener("change", updateMatches);

    return () => {
      mediaQueryList.removeEventListener("change", updateMatches);
    };
  }, [query]);

  return matches;
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
