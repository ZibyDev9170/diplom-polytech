import { useCallback, useEffect, useMemo, useState } from "react";

import {
  ExternalReviewsPayload,
  ImportBatch,
  ImportItem,
  apiClient,
} from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Pagination } from "../components/Pagination";
import { useNotifications } from "../notifications/NotificationContext";

type IntegrationFormState = {
  offset: string;
  limit: string;
};

const initialFormState: IntegrationFormState = {
  offset: "0",
  limit: "20",
};

const IMPORT_HISTORY_PER_PAGE = 5;
const IMPORT_ITEMS_PER_PAGE = 10;
const IMPORT_BATCH_LOAD_LIMIT = 100;

const dateTimeFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function IntegrationPage() {
  const { token } = useAuth();
  const { notify } = useNotifications();
  const [form, setForm] = useState<IntegrationFormState>(initialFormState);
  const [previewPayload, setPreviewPayload] = useState<ExternalReviewsPayload | null>(null);
  const [lastBatch, setLastBatch] = useState<ImportBatch | null>(null);
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isBatchesLoading, setIsBatchesLoading] = useState(true);
  const [historyPage, setHistoryPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const importParams = useMemo(
    () => ({
      offset: normalizeNumberInput(form.offset, 0, Number.MAX_SAFE_INTEGER, 0),
      limit: normalizeNumberInput(form.limit, 1, 100, 20),
    }),
    [form.limit, form.offset],
  );
  const validationError = useMemo(() => getIntegrationFormError(form), [form]);
  const historyTotalPages = Math.max(
    1,
    Math.ceil(batches.length / IMPORT_HISTORY_PER_PAGE),
  );
  const paginatedBatches = batches.slice(
    (historyPage - 1) * IMPORT_HISTORY_PER_PAGE,
    historyPage * IMPORT_HISTORY_PER_PAGE,
  );

  const loadBatches = useCallback(async () => {
    if (!token) {
      setIsBatchesLoading(false);
      return;
    }

    setIsBatchesLoading(true);

    try {
      const response = await loadAllImportBatches(token);
      setBatches(response);
      setHistoryPage(1);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось загрузить историю импортов.",
      );
    } finally {
      setIsBatchesLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadBatches();
  }, [loadBatches]);

  useEffect(() => {
    if (historyPage > historyTotalPages) {
      setHistoryPage(historyTotalPages);
    }
  }, [historyPage, historyTotalPages]);

  const handlePreview = async () => {
    if (!token) {
      return;
    }

    if (validationError) {
      notify({
        type: "error",
        title: "Ошибка",
        message: validationError,
      });
      return;
    }

    setIsPreviewLoading(true);
    setError(null);

    try {
      const response = await apiClient.getPerekrestokPayload(token, importParams);
      setPreviewPayload(response);
      notify({
        type: "success",
        title: "Предпросмотр готов",
        message: `Получено отзывов: ${response.reviews.length}.`,
      });
    } catch (requestError) {
      setPreviewPayload(null);
      notify({
        type: "error",
        title: "Ошибка предпросмотра",
        message:
          requestError instanceof Error
            ? requestError.message
            : "Не удалось получить данные источника.",
      });
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const handleImport = async () => {
    if (!token) {
      return;
    }

    if (validationError) {
      notify({
        type: "error",
        title: "Ошибка",
        message: validationError,
      });
      return;
    }

    setIsImporting(true);
    setError(null);

    try {
      const response = await apiClient.importPerekrestokReviews(token, importParams);
      setLastBatch(response);
      setPreviewPayload(null);
      await loadBatches();
      notify({
        type: "success",
        title: "Импорт завершен",
        message: `Добавлено: ${response.success_count}, пропущено: ${response.skipped_count}, ошибок: ${response.failed_count}.`,
      });
    } catch (requestError) {
      notify({
        type: "error",
        title: "Ошибка импорта",
        message:
          requestError instanceof Error
            ? requestError.message
            : "Не удалось импортировать отзывы.",
      });
    } finally {
      setIsImporting(false);
    }
  };

  const handleFieldChange = (field: keyof IntegrationFormState, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  return (
    <section className="integration-page">
      <section className="integration-panel">
        <div className="integration-source-info">
          <p className="eyebrow">Perekrestok Reviews</p>
          <p>
            Открытый источник отзывов. Если товара с нужным SKU нет в
            каталоге, он будет создан автоматически. Уже загруженные отзывы
            пропускаются по внешнему ID.
          </p>
        </div>

        <div className="integration-controls">
          <label className="analytics-filter-field">
            Смещение
            <input
              min="0"
              type="number"
              value={form.offset}
              onChange={(event) => handleFieldChange("offset", event.target.value)}
            />
          </label>
          <label className="analytics-filter-field">
            Количество
            <input
              max="100"
              min="1"
              type="number"
              value={form.limit}
              onChange={(event) => handleFieldChange("limit", event.target.value)}
            />
          </label>
          <button
            className="secondary-button"
            disabled={isPreviewLoading || isImporting}
            title={validationError || undefined}
            type="button"
            onClick={handlePreview}
          >
            {isPreviewLoading ? "Загрузка..." : "Предпросмотр"}
          </button>
          <button
            className="primary-button users-add-button integration-import-button"
            disabled={isImporting || isPreviewLoading}
            title={validationError || undefined}
            type="button"
            onClick={handleImport}
          >
            {isImporting ? "Импорт..." : "Импортировать отзывы"}
          </button>
        </div>
      </section>

      {error ? <p className="users-state users-state--error">{error}</p> : null}

      <section className="integration-kpi-grid">
        <IntegrationKpi title="Источник" value="Perekrestok" caption="Hugging Face" />
        <IntegrationKpi title="Смещение" value={String(importParams.offset)} caption="offset" />
        <IntegrationKpi title="Количество" value={String(importParams.limit)} caption="limit" />
      </section>

      {previewPayload ? (
        <section className="integration-panel">
          <header className="integration-section-header">
            <h2>Предпросмотр</h2>
            <span>{previewPayload.reviews.length} отзывов</span>
          </header>
          <div className="integration-preview-list">
            {previewPayload.reviews.slice(0, 5).map((review) => (
              <article className="integration-preview-card" key={review.external_id}>
                <strong>{review.product_name || review.product_sku || "Товар"}</strong>
                <span>ID: {review.external_id}</span>
                <span>Оценка: {review.rating}</span>
                <p>{review.review_text}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {lastBatch ? <ImportBatchSection title="Последний импорт" batch={lastBatch} /> : null}

      <section className="integration-panel">
        <header className="integration-section-header">
          <h2>История импортов</h2>
          <span>{isBatchesLoading ? "Загрузка..." : `${batches.length} пакетов`}</span>
        </header>
        {isBatchesLoading ? (
          <p className="users-state">Загружаем историю...</p>
        ) : batches.length > 0 ? (
          <>
            <div className="integration-batches-list">
              {paginatedBatches.map((batch) => (
                <ImportBatchSummary key={batch.id} batch={batch} />
              ))}
            </div>
            <Pagination
              ariaLabel="Пагинация истории импортов"
              currentPage={historyPage}
              totalPages={historyTotalPages}
              onPageChange={setHistoryPage}
            />
          </>
        ) : (
          <p className="users-state">Пакетов импорта пока нет.</p>
        )}
      </section>
    </section>
  );
}

function IntegrationKpi({
  title,
  value,
  caption,
}: {
  title: string;
  value: string;
  caption: string;
}) {
  return (
    <article className="analytics-kpi-card">
      <div>
        <h2>{title}</h2>
        <strong>{value}</strong>
        <span>{caption}</span>
      </div>
    </article>
  );
}

function ImportBatchSection({ title, batch }: { title: string; batch: ImportBatch }) {
  const [itemsPage, setItemsPage] = useState(1);
  const itemsTotalPages = Math.max(
    1,
    Math.ceil(batch.items.length / IMPORT_ITEMS_PER_PAGE),
  );
  const paginatedItems = batch.items.slice(
    (itemsPage - 1) * IMPORT_ITEMS_PER_PAGE,
    itemsPage * IMPORT_ITEMS_PER_PAGE,
  );

  useEffect(() => {
    setItemsPage(1);
  }, [batch.id]);

  useEffect(() => {
    if (itemsPage > itemsTotalPages) {
      setItemsPage(itemsTotalPages);
    }
  }, [itemsPage, itemsTotalPages]);

  return (
    <section className="integration-panel">
      <header className="integration-section-header">
        <h2>{title}</h2>
        <span>Пакет #{batch.id}</span>
      </header>
      <ImportBatchSummary batch={batch} />
      <div className="integration-items-table-scroll">
        <table className="analytics-table integration-items-table">
          <thead>
            <tr>
              <th>External ID</th>
              <th>Статус</th>
              <th>Ошибка</th>
            </tr>
          </thead>
          <tbody>
            {paginatedItems.map((item) => (
              <tr key={item.id}>
                <td>{item.external_review_id}</td>
                <td>
                  <ImportStatusBadge status={item.import_status} />
                </td>
                <td>{item.error_message || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="integration-items-mobile-list">
        {paginatedItems.map((item) => (
          <ImportItemCard key={item.id} item={item} />
        ))}
      </div>
      <Pagination
        ariaLabel={`Пагинация элементов пакета ${batch.id}`}
        currentPage={itemsPage}
        totalPages={itemsTotalPages}
        onPageChange={setItemsPage}
      />
    </section>
  );
}

function ImportBatchSummary({ batch }: { batch: ImportBatch }) {
  return (
    <article className="integration-batch-card">
      <div>
        <span>Пакет</span>
        <strong>#{batch.id}</strong>
      </div>
      <div>
        <span>Источник</span>
        <strong>{batch.source.name}</strong>
      </div>
      <div>
        <span>Статус</span>
        <strong>{formatBatchStatus(batch.status)}</strong>
      </div>
      <div>
        <span>Всего</span>
        <strong>{batch.total_count}</strong>
      </div>
      <div>
        <span>Добавлено</span>
        <strong>{batch.success_count}</strong>
      </div>
      <div>
        <span>Пропущено</span>
        <strong>{batch.skipped_count}</strong>
      </div>
      <div>
        <span>Ошибки</span>
        <strong>{batch.failed_count}</strong>
      </div>
      <div>
        <span>Дата</span>
        <strong>{formatDateTime(batch.started_at)}</strong>
      </div>
    </article>
  );
}

function ImportItemCard({ item }: { item: ImportItem }) {
  return (
    <article className="analytics-mobile-card">
      <div>
        <span>External ID</span>
        <strong>{item.external_review_id}</strong>
      </div>
      <div>
        <span>Статус</span>
        <strong>{formatImportStatus(item.import_status)}</strong>
      </div>
      <div>
        <span>Ошибка</span>
        <strong>{item.error_message || "—"}</strong>
      </div>
    </article>
  );
}

function ImportStatusBadge({ status }: { status: string }) {
  const className = [
    "status-badge",
    status === "success" ? "status-badge--active" : "",
    status === "failed" ? "status-badge--blocked" : "",
    status === "skipped" ? "status-badge--review" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return <span className={className}>{formatImportStatus(status)}</span>;
}

async function loadAllImportBatches(token: string) {
  const batches: ImportBatch[] = [];
  let offset = 0;

  for (;;) {
    const response = await apiClient.getImportBatches(token, {
      limit: IMPORT_BATCH_LOAD_LIMIT,
      offset,
    });

    batches.push(...response);

    if (response.length < IMPORT_BATCH_LOAD_LIMIT) {
      return batches;
    }

    offset += IMPORT_BATCH_LOAD_LIMIT;
  }
}

function normalizeNumberInput(
  value: string,
  minValue: number,
  maxValue: number,
  fallback: number,
) {
  const normalizedValue = Number(value);

  if (!Number.isInteger(normalizedValue)) {
    return fallback;
  }

  return Math.min(maxValue, Math.max(minValue, normalizedValue));
}

function getIntegrationFormError(form: IntegrationFormState) {
  const offset = Number(form.offset);
  const limit = Number(form.limit);

  if (!Number.isInteger(offset) || offset < 0) {
    return "Смещение должно быть целым числом от 0.";
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return "Количество должно быть целым числом от 1 до 100.";
  }

  return null;
}

function formatImportStatus(status: string) {
  if (status === "success") {
    return "Успешно";
  }

  if (status === "failed") {
    return "Ошибка";
  }

  if (status === "skipped") {
    return "Пропущено";
  }

  return status;
}

function formatBatchStatus(status: string) {
  if (status === "completed") {
    return "Завершен";
  }

  if (status === "partially_completed") {
    return "Частично";
  }

  if (status === "failed") {
    return "Ошибка";
  }

  return status;
}

function formatDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return dateTimeFormatter.format(date);
}
