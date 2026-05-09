import { type ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";

import {
  ExternalSourceFieldMapping,
  ExternalSourcePreviewResponse,
  ExternalSourceRequestPayload,
  ExternalReviewPayloadItem,
  ExternalReviewsPayload,
  GenericReviewImportPayload,
  ImportBatch,
  ImportItem,
  ReviewSource,
  apiClient,
} from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Pagination } from "../components/Pagination";
import { useNotifications } from "../notifications/NotificationContext";

type IntegrationFormState = {
  offset: string;
  limit: string;
};

type UniversalIntegrationFormState = {
  selectedSourceId: string;
  endpointUrl: string;
  reviewsPath: string;
  externalIdPath: string;
  productIdPath: string;
  productSkuPath: string;
  productNamePath: string;
  reviewTextPath: string;
  ratingPath: string;
  reviewDatePath: string;
};

type UniversalSourceMode = "api" | "file";

type StoredIntegrationTemplate = {
  mode: UniversalSourceMode;
  endpointUrl: string;
  reviewsPath: string;
  externalIdPath: string;
  productIdPath: string;
  productSkuPath: string;
  productNamePath: string;
  reviewTextPath: string;
  ratingPath: string;
  reviewDatePath: string;
};

type MappingPreviewResult = {
  payload?: GenericReviewImportPayload;
  previewPayload: ExternalReviewsPayload;
  sourceName: string | null;
  sourceCode: string;
  totalCount: number;
  invalidCount: number;
  errors: string[];
};

type MappedImportPreparationSuccess = {
  success: true;
  payload: GenericReviewImportPayload;
  preview: MappingPreviewResult;
};

type MappedImportPreparationFailure = {
  success: false;
  error: string;
};

type ReviewPreviewValidationSuccess = {
  success: true;
  review: ExternalReviewPayloadItem;
};

type ReviewPreviewValidationFailure = {
  success: false;
  error: string;
};

type IntegrationHistoryState = {
  lastBatch: ImportBatch | null;
  batches: ImportBatch[];
  isBatchesLoading: boolean;
  historyPage: number;
  historyTotalPages: number;
  paginatedBatches: ImportBatch[];
  error: string | null;
  setError: (value: string | null) => void;
  setLastBatch: (batch: ImportBatch | null) => void;
  loadBatches: () => Promise<void>;
  setHistoryPage: (page: number) => void;
};

const initialFormState: IntegrationFormState = {
  offset: "0",
  limit: "20",
};

const initialUniversalFormState: UniversalIntegrationFormState = {
  selectedSourceId: "",
  endpointUrl: "",
  reviewsPath: "",
  externalIdPath: "",
  productIdPath: "",
  productSkuPath: "",
  productNamePath: "",
  reviewTextPath: "",
  ratingPath: "",
  reviewDatePath: "",
};

const IMPORT_HISTORY_PER_PAGE = 5;
const IMPORT_ITEMS_PER_PAGE = 10;
const IMPORT_BATCH_LOAD_LIMIT = 100;
const TEMPLATE_STORAGE_PREFIX = "integration-template:";
const DEFAULT_REMOTE_OFFSET = 0;
const DEFAULT_REMOTE_LIMIT = 20;

const dateTimeFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const structurePreviewDefaults = {
  reviewsPath: "data.reviews",
  externalIdPath: "external_id",
  productIdPath: "product_id",
  productSkuPath: "",
  productNamePath: "product_name",
  reviewTextPath: "review_text",
  ratingPath: "rating",
  reviewDatePath: "",
};

const structurePreviewSampleValues = {
  externalId: "source-123456",
  productId: "123456",
  productSku: "source-123456",
  productName: "Название товара 1",
  reviewText: "Текст отзыва 1",
  rating: 5,
  reviewDate: "2026-05-09",
};

export function IntegrationPage() {
  const history = useIntegrationHistory();
  const { token } = useAuth();
  const { notify } = useNotifications();
  const [form, setForm] = useState<IntegrationFormState>(initialFormState);
  const [previewPayload, setPreviewPayload] = useState<ExternalReviewsPayload | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const importParams = useMemo(
    () => ({
      offset: normalizeNumberInput(form.offset, 0, Number.MAX_SAFE_INTEGER, 0),
      limit: normalizeNumberInput(form.limit, 1, 100, 20),
    }),
    [form.limit, form.offset],
  );
  const validationError = useMemo(() => getIntegrationFormError(form), [form]);

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
    history.setError(null);

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
    history.setError(null);

    try {
      const response = await apiClient.importPerekrestokReviews(token, importParams);
      history.setLastBatch(response);
      setPreviewPayload(null);
      await history.loadBatches();
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
            Готовый сценарий для источника Перекресток. Если товара с нужным SKU нет в
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

      {history.error ? <p className="users-state users-state--error">{history.error}</p> : null}

      <section className="integration-kpi-grid">
        <IntegrationKpi title="Источник" value="Perekrestok" caption="Hugging Face" />
        <IntegrationKpi title="Смещение" value={String(importParams.offset)} caption="offset" />
        <IntegrationKpi title="Количество" value={String(importParams.limit)} caption="limit" />
      </section>

      {previewPayload ? (
        <PreviewSection
          countLabel={`${previewPayload.reviews.length} отзывов`}
          reviews={previewPayload.reviews}
          title="Предпросмотр"
        />
      ) : null}

      <IntegrationSharedSections history={history} />
    </section>
  );
}

export function UniversalIntegrationPage() {
  const history = useIntegrationHistory();
  const { token } = useAuth();
  const { notify } = useNotifications();
  const historyErrorSetter = history.setError;
  const [universalMode, setUniversalMode] = useState<UniversalSourceMode>("api");
  const [form, setForm] = useState<UniversalIntegrationFormState>(initialUniversalFormState);
  const [sources, setSources] = useState<ReviewSource[]>([]);
  const [previewResult, setPreviewResult] = useState<MappingPreviewResult | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isSourcesLoading, setIsSourcesLoading] = useState(true);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [hasSavedTemplate, setHasSavedTemplate] = useState(false);

  useEffect(() => {
    if (!token) {
      setIsSourcesLoading(false);
      return;
    }

    const loadSources = async () => {
      setIsSourcesLoading(true);

      try {
        const response = await apiClient.getCatalogReviewSources(token);
        setSources(response);
        setForm((current) => {
          if (!current.selectedSourceId) {
            return current;
          }

          const hasSelectedSource = response.some(
            (source) => String(source.id) === current.selectedSourceId,
          );

          return hasSelectedSource
            ? current
            : { ...current, selectedSourceId: "" };
        });
      } catch (requestError) {
        historyErrorSetter(
          requestError instanceof Error
            ? requestError.message
            : "Не удалось загрузить источники отзывов.",
        );
      } finally {
        setIsSourcesLoading(false);
      }
    };

    loadSources();
  }, [historyErrorSetter, token]);

  const selectedSource =
    sources.find((source) => String(source.id) === form.selectedSourceId) ?? null;
  const structurePreview = useMemo(
    () => buildStructurePreviewJson(form),
    [form],
  );
  const historyError = history.error;
  const clearHistoryError = history.setError;

  useEffect(() => {
    if (!historyError) {
      return;
    }

    notify({
      type: "error",
      title: "Ошибка",
      message: historyError,
    });
    clearHistoryError(null);
  }, [clearHistoryError, historyError, notify]);

  useEffect(() => {
    if (!form.selectedSourceId) {
      setHasSavedTemplate(false);
      return;
    }

    const storedTemplate = readStoredIntegrationTemplate(form.selectedSourceId);
    setHasSavedTemplate(Boolean(storedTemplate));
    setSelectedFile(null);
    setPreviewResult(null);

    if (!storedTemplate) {
      setUniversalMode("api");
      setForm((current) => ({
        ...buildDefaultUniversalFormState(),
        selectedSourceId: current.selectedSourceId,
      }));
      return;
    }

    setUniversalMode(storedTemplate.mode);
    setForm((current) => ({
      ...current,
      ...storedTemplate,
      selectedSourceId: current.selectedSourceId,
    }));
  }, [form.selectedSourceId]);

  const handleFieldChange = (field: keyof UniversalIntegrationFormState, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleSourceChange = (value: string) => {
    setForm((current) => ({ ...current, selectedSourceId: value }));
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0] ?? null;
    if (!nextFile) {
      setSelectedFile(null);
      return;
    }

    if (!isJsonFile(nextFile)) {
      setSelectedFile(null);
      event.target.value = "";
      notify({
        type: "error",
        title: "Неверный файл",
        message: "Загрузите файл в формате JSON.",
      });
      return;
    }

    setSelectedFile(nextFile);
  };

  const handleSaveTemplate = () => {
    if (!form.selectedSourceId) {
      notify({
        type: "error",
        title: "Ошибка",
        message: "Сначала выберите источник для сохранения шаблона.",
      });
      return;
    }

    saveIntegrationTemplate(form.selectedSourceId, buildStoredTemplate(form, universalMode));
    setHasSavedTemplate(true);
    notify({
      type: "success",
      title: "Шаблон сохранен",
      message: "Настройки маппинга сохранены для выбранного источника.",
    });
  };

  const handleResetTemplate = () => {
    if (!form.selectedSourceId) {
      return;
    }

    removeIntegrationTemplate(form.selectedSourceId);
    setHasSavedTemplate(false);
    setUniversalMode("api");
    setSelectedFile(null);
    setPreviewResult(null);
    setForm((current) => ({
      ...buildDefaultUniversalFormState(),
      selectedSourceId: current.selectedSourceId,
    }));
    notify({
      type: "success",
      title: "Шаблон удален",
      message: "Сохраненные настройки для источника очищены.",
    });
  };

  const handleRemotePreview = async () => {
    if (!token) {
      return;
    }

    const validationError = getUniversalIntegrationFormError(
      form,
      selectedSource,
      universalMode,
      selectedFile,
    );
    if (validationError) {
      setPreviewResult(null);
      notify({
        type: "error",
        title: "Ошибка",
        message: validationError,
      });
      return;
    }

    setIsPreviewLoading(true);
    history.setError(null);

    try {
      const response = await apiClient.previewExternalSourceReviews(token, buildRemoteImportPayload(form, selectedSource));
      const mappedPreview = mapRemotePreviewResponseToLocalPreview(response);
      setPreviewResult(mappedPreview);
      notify({
        type: mappedPreview.invalidCount > 0 ? "error" : "success",
        title: mappedPreview.invalidCount > 0 ? "Есть замечания" : "Предпросмотр готов",
        message: buildPreviewNotificationMessage(mappedPreview),
      });
    } catch (requestError) {
      setPreviewResult(null);
      notify({
        type: "error",
        title: "Ошибка предпросмотра",
        message:
          requestError instanceof Error
            ? requestError.message
            : "Не удалось получить отзывы по ссылке.",
      });
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const handleFilePreview = async () => {
    const validationError = getUniversalIntegrationFormError(
      form,
      selectedSource,
      universalMode,
      selectedFile,
    );
    if (validationError) {
      setPreviewResult(null);
      notify({
        type: "error",
        title: "Ошибка",
        message: validationError,
      });
      return;
    }

    try {
      const rawPayload = await readJsonFile(selectedFile);
      const preparation = prepareMappedImportFromPayload(rawPayload, form, selectedSource);
      if (!preparation.success) {
        setPreviewResult(null);
        notify({
          type: "error",
          title: "Ошибка",
          message: preparation.error,
        });
        return;
      }

      setPreviewResult(preparation.preview);
      notify({
        type: preparation.preview.invalidCount > 0 ? "error" : "success",
        title: preparation.preview.invalidCount > 0 ? "Есть замечания" : "Предпросмотр готов",
        message: buildPreviewNotificationMessage(preparation.preview),
      });
    } catch (requestError) {
      setPreviewResult(null);
      notify({
        type: "error",
        title: "Ошибка чтения файла",
        message:
          requestError instanceof Error
            ? requestError.message
            : "Не удалось прочитать JSON-файл.",
      });
    }
  };

  const handleFileImport = async () => {
    if (!token) {
      return;
    }

    const validationError = getUniversalIntegrationFormError(
      form,
      selectedSource,
      universalMode,
      selectedFile,
    );
    if (validationError) {
      notify({
        type: "error",
        title: "Ошибка",
        message: validationError,
      });
      return;
    }

    let preparation: MappedImportPreparationSuccess | MappedImportPreparationFailure;

    try {
      const rawPayload = await readJsonFile(selectedFile);
      preparation = prepareMappedImportFromPayload(rawPayload, form, selectedSource);
    } catch (requestError) {
      notify({
        type: "error",
        title: "Ошибка чтения файла",
        message:
          requestError instanceof Error
            ? requestError.message
            : "Не удалось прочитать JSON-файл.",
      });
      return;
    }

    if (!preparation.success) {
      notify({
        type: "error",
        title: "Ошибка",
        message: preparation.error,
      });
      return;
    }

    setIsImporting(true);
    history.setError(null);

    try {
      const response = await apiClient.importExternalReviews(token, preparation.payload);
      history.setLastBatch(response);
      setPreviewResult(preparation.preview);
      await history.loadBatches();
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

  const handleRemoteImport = async () => {
    if (!token) {
      return;
    }

    const validationError = getUniversalIntegrationFormError(
      form,
      selectedSource,
      universalMode,
      selectedFile,
    );
    if (validationError) {
      notify({
        type: "error",
        title: "Ошибка",
        message: validationError,
      });
      return;
    }

    setIsImporting(true);
    history.setError(null);

    try {
      const payload = buildRemoteImportPayload(form, selectedSource);
      const response = await apiClient.importExternalSourceReviews(token, payload);
      history.setLastBatch(response);
      await history.loadBatches();
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
            : "Не удалось импортировать отзывы по ссылке.",
      });
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <section className="integration-page">
      <p className="eyebrow">Импорт отзывов</p>

      <section className="integration-panel">
        <div className="integration-editor-toolbar">
          <div
            className="catalog-segmented integration-editor-segmented"
            role="tablist"
            aria-label="Режим универсальной интеграции"
          >
            <button
              className={`catalog-segment ${universalMode === "api" ? "is-active" : ""}`}
              type="button"
              onClick={() => setUniversalMode("api")}
            >
              По ссылке
            </button>
            <button
              className={`catalog-segment ${universalMode === "file" ? "is-active" : ""}`}
              type="button"
              onClick={() => setUniversalMode("file")}
            >
              Из файла
            </button>
          </div>

          <div className="integration-template-actions">
            <button
              className="primary-button"
              disabled={!form.selectedSourceId}
              type="button"
              onClick={handleSaveTemplate}
            >
              Сохранить шаблон
            </button>
            <button
              className="secondary-button"
              disabled={!form.selectedSourceId || !hasSavedTemplate}
              type="button"
              onClick={handleResetTemplate}
            >
              Сбросить шаблон
            </button>
          </div>
        </div>

        <div className="integration-generic-grid">
          <label className="analytics-filter-field">
            <FieldLabel label="Источник" />
            <select
              disabled={isSourcesLoading || sources.length === 0}
              value={form.selectedSourceId}
              onChange={(event) => handleSourceChange(event.target.value)}
            >
              <option value="">
                {isSourcesLoading
                  ? "Загрузка источников..."
                  : sources.length === 0
                    ? "Нет источников"
                    : "Выберите источник"}
              </option>
              {sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name}
                </option>
              ))}
            </select>
          </label>
          <label className="analytics-filter-field">
            <FieldLabel label="Код источника" />
            <input
              readOnly
              placeholder="Выберите источник"
              type="text"
              value={selectedSource?.code ?? ""}
            />
          </label>
        </div>

        {universalMode === "api" ? (
          <div className="integration-generic-grid integration-generic-grid--single-wide">
            <label className="analytics-filter-field">
              <FieldLabel
                label="Ссылка на JSON API"
                tooltip="Можно использовать подстановки {offset} и {limit} прямо в ссылке."
              />
              <input
                placeholder="https://example.com/api/reviews"
                type="url"
                value={form.endpointUrl}
                onChange={(event) => handleFieldChange("endpointUrl", event.target.value)}
              />
            </label>
          </div>
        ) : (
          <label className="analytics-filter-field integration-file-field">
            <FieldLabel label="Файл JSON" />
            <input
              accept=".json,application/json"
              type="file"
              onChange={handleFileChange}
            />
          </label>
        )}

        <section className="integration-mapping-grid">
          <label className="analytics-filter-field">
            <FieldLabel label="Путь к массиву отзывов" />
            <input
              placeholder={structurePreviewDefaults.reviewsPath}
              type="text"
              value={form.reviewsPath}
              onChange={(event) => handleFieldChange("reviewsPath", event.target.value)}
            />
          </label>
          <label className="analytics-filter-field">
            <FieldLabel
              label="Внешний ID"
              tooltip={`Пример значения: ${structurePreviewSampleValues.externalId}`}
            />
            <input
              placeholder={structurePreviewDefaults.externalIdPath}
              type="text"
              value={form.externalIdPath}
              onChange={(event) => handleFieldChange("externalIdPath", event.target.value)}
            />
          </label>
          <label className="analytics-filter-field">
            <FieldLabel
              label="ID товара"
              tooltip={`Пример значения: ${structurePreviewSampleValues.productId}`}
            />
            <input
              placeholder={structurePreviewDefaults.productIdPath}
              type="text"
              value={form.productIdPath}
              onChange={(event) => handleFieldChange("productIdPath", event.target.value)}
            />
          </label>
          <label className="analytics-filter-field">
            <FieldLabel
              label="SKU товара"
              tooltip="Если не указать SKU явно, система возьмет значение из ID товара."
            />
            <input
              type="text"
              value={form.productSkuPath}
              onChange={(event) => handleFieldChange("productSkuPath", event.target.value)}
            />
          </label>
          <label className="analytics-filter-field">
            <FieldLabel label="Название товара" />
            <input
              placeholder={structurePreviewDefaults.productNamePath}
              type="text"
              value={form.productNamePath}
              onChange={(event) => handleFieldChange("productNamePath", event.target.value)}
            />
          </label>
          <label className="analytics-filter-field">
            <FieldLabel label="Текст отзыва" />
            <input
              placeholder={structurePreviewDefaults.reviewTextPath}
              type="text"
              value={form.reviewTextPath}
              onChange={(event) => handleFieldChange("reviewTextPath", event.target.value)}
            />
          </label>
          <label className="analytics-filter-field">
            <FieldLabel label="Оценка" />
            <input
              placeholder={structurePreviewDefaults.ratingPath}
              type="text"
              value={form.ratingPath}
              onChange={(event) => handleFieldChange("ratingPath", event.target.value)}
            />
          </label>
          <label className="analytics-filter-field">
            <FieldLabel
              label="Дата отзыва"
              tooltip="Если не указать дату явно, система подставит сегодняшнюю дату."
            />
            <input
              type="text"
              value={form.reviewDatePath}
              onChange={(event) => handleFieldChange("reviewDatePath", event.target.value)}
            />
          </label>
        </section>

        <div className="integration-controls integration-controls--custom">
          <button
            className="secondary-button"
            disabled={isPreviewLoading || isImporting || isSourcesLoading}
            type="button"
            onClick={universalMode === "api" ? handleRemotePreview : handleFilePreview}
          >
            {isPreviewLoading ? "Загрузка..." : "Проверить источник"}
          </button>
          <button
            className="primary-button users-add-button integration-import-button"
            disabled={isImporting || isPreviewLoading || isSourcesLoading}
            type="button"
            onClick={universalMode === "api" ? handleRemoteImport : handleFileImport}
          >
            {isImporting ? "Импорт..." : "Импортировать отзывы"}
          </button>
        </div>
      </section>

      <section className="integration-panel integration-example-panel">
        <header className="integration-section-header">
          <h2>Структура загружаемого источника</h2>
          <span>Пути указываются через точку, например data.reviews или product.sku</span>
        </header>
        <JsonStructurePreview json={structurePreview} />
      </section>

      <section className="integration-kpi-grid">
        <IntegrationKpi
          title="Источник"
          value={previewResult?.sourceName || selectedSource?.name || "Не указан"}
          caption={previewResult?.sourceCode || selectedSource?.code || "source_code"}
        />
        <IntegrationKpi
          title="Валидные отзывы"
          value={String(previewResult?.previewPayload.reviews.length ?? 0)}
          caption="готовы к импорту"
        />
        <IntegrationKpi
          title="Ошибки формата"
          value={String(previewResult?.invalidCount ?? 0)}
          caption={universalMode === "api" ? "проверка по маппингу" : "проверка файла"}
        />
      </section>

      {previewResult ? (
        <>
          <PreviewSection
            countLabel={`${previewResult.previewPayload.reviews.length} валидных из ${previewResult.totalCount}`}
            reviews={previewResult.previewPayload.reviews}
            title="Предпросмотр"
          />
        </>
      ) : null}

      <IntegrationSharedSections history={history} />
    </section>
  );
}

function IntegrationSharedSections({ history }: { history: IntegrationHistoryState }) {
  return (
    <>
      {history.lastBatch ? (
        <ImportBatchSection title="Последний импорт" batch={history.lastBatch} />
      ) : null}

      <section className="integration-panel">
        <header className="integration-section-header">
          <h2>История импортов</h2>
          <span>{history.isBatchesLoading ? "Загрузка..." : `${history.batches.length} пакетов`}</span>
        </header>
        {history.isBatchesLoading ? (
          <p className="users-state">Загружаем историю...</p>
        ) : history.batches.length > 0 ? (
          <>
            <div className="integration-batches-list">
              {history.paginatedBatches.map((batch) => (
                <ImportBatchSummary key={batch.id} batch={batch} />
              ))}
            </div>
            <Pagination
              ariaLabel="Пагинация истории импортов"
              currentPage={history.historyPage}
              totalPages={history.historyTotalPages}
              onPageChange={history.setHistoryPage}
            />
          </>
        ) : (
          <p className="users-state">Пакетов импорта пока нет.</p>
        )}
      </section>
    </>
  );
}

function JsonStructurePreview({ json }: { json: string }) {
  const lines = json.split("\n");

  return (
    <div className="integration-code-editor" aria-label="Предпросмотр структуры JSON">
      <div className="integration-code-editor-header">
        <span>source.json</span>
        <span>JSON</span>
      </div>
      <div className="integration-code-block integration-code-block--editor">
        {lines.map((line, index) => (
          <div className="integration-code-line" key={`${index + 1}-${line}`}>
            <span className="integration-code-line-number">{index + 1}</span>
            <code
              className="integration-code-line-content"
              dangerouslySetInnerHTML={{ __html: highlightJsonLine(line) }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function FieldLabel({ label, tooltip }: { label: string; tooltip?: string }) {
  const [isTooltipOpen, setIsTooltipOpen] = useState(false);

  return (
    <span className="integration-field-label">
      <span>{label}</span>
      {tooltip ? (
        <span
          className="integration-info"
          onMouseEnter={() => setIsTooltipOpen(true)}
          onMouseLeave={() => setIsTooltipOpen(false)}
        >
          <button
            aria-expanded={isTooltipOpen}
            aria-label={tooltip}
            className="integration-info-button"
            type="button"
            onMouseEnter={() => setIsTooltipOpen(true)}
            onMouseLeave={() => setIsTooltipOpen(false)}
            onBlur={() => setIsTooltipOpen(false)}
            onClick={() => setIsTooltipOpen((current) => !current)}
            onFocus={() => setIsTooltipOpen(true)}
          >
            <img alt="" aria-hidden="true" src="/images/icons/info.svg" />
          </button>
          <span
            className={`integration-tooltip ${isTooltipOpen ? "is-visible" : ""}`}
            role="tooltip"
          >
            {tooltip}
          </span>
        </span>
      ) : null}
    </span>
  );
}

function PreviewSection({
  title,
  countLabel,
  reviews,
}: {
  title: string;
  countLabel: string;
  reviews: ExternalReviewPayloadItem[];
}) {
  return (
    <section className="integration-panel">
      <header className="integration-section-header">
        <h2>{title}</h2>
        <span>{countLabel}</span>
      </header>
      <div className="integration-preview-list">
        {reviews.slice(0, 5).map((review) => (
          <article className="integration-preview-card" key={review.external_id}>
            <strong>{review.product_name || review.product_sku || "Товар"}</strong>
            <span>ID: {review.external_id}</span>
            <span>Оценка: {review.rating}</span>
            <p>{review.review_text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function useIntegrationHistory(): IntegrationHistoryState {
  const { token } = useAuth();
  const [lastBatch, setLastBatch] = useState<ImportBatch | null>(null);
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [isBatchesLoading, setIsBatchesLoading] = useState(true);
  const [historyPage, setHistoryPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const historyTotalPages = Math.max(1, Math.ceil(batches.length / IMPORT_HISTORY_PER_PAGE));
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
      setError(null);
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

  return {
    lastBatch,
    batches,
    isBatchesLoading,
    historyPage,
    historyTotalPages,
    paginatedBatches,
    error,
    setError,
    setLastBatch,
    loadBatches,
    setHistoryPage,
  };
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

function mapRemotePreviewResponseToLocalPreview(
  preview: ExternalSourcePreviewResponse,
): MappingPreviewResult {
  return {
    previewPayload: {
      source_code: preview.source_code,
      reviews: preview.reviews,
    },
    sourceName: preview.source_name,
    sourceCode: preview.source_code,
    totalCount: preview.total_count,
    invalidCount: preview.invalid_count,
    errors: preview.errors,
  };
}

function buildStructurePreviewJson(form: UniversalIntegrationFormState) {
  const reviewSample: Record<string, unknown> = {};
  const reviewsPath = normalizeText(form.reviewsPath) || structurePreviewDefaults.reviewsPath;

  setPreviewPathValue(
    reviewSample,
    normalizeText(form.externalIdPath) || structurePreviewDefaults.externalIdPath,
    structurePreviewSampleValues.externalId,
  );
  setPreviewPathValue(
    reviewSample,
    normalizeText(form.productIdPath) || structurePreviewDefaults.productIdPath,
    structurePreviewSampleValues.productId,
  );

  const productSkuPath = normalizeText(form.productSkuPath) || structurePreviewDefaults.productSkuPath;
  if (productSkuPath) {
    setPreviewPathValue(reviewSample, productSkuPath, structurePreviewSampleValues.productSku);
  }

  setPreviewPathValue(
    reviewSample,
    normalizeText(form.productNamePath) || structurePreviewDefaults.productNamePath,
    structurePreviewSampleValues.productName,
  );
  setPreviewPathValue(
    reviewSample,
    normalizeText(form.reviewTextPath) || structurePreviewDefaults.reviewTextPath,
    structurePreviewSampleValues.reviewText,
  );
  setPreviewPathValue(
    reviewSample,
    normalizeText(form.ratingPath) || structurePreviewDefaults.ratingPath,
    structurePreviewSampleValues.rating,
  );
  const reviewDatePath =
    normalizeText(form.reviewDatePath) || structurePreviewDefaults.reviewDatePath;
  if (reviewDatePath) {
    setPreviewPathValue(reviewSample, reviewDatePath, structurePreviewSampleValues.reviewDate);
  }

  const root: Record<string, unknown> = {};
  setPreviewPathValue(root, reviewsPath, [reviewSample]);

  return JSON.stringify(root, null, 2);
}

function buildPreviewNotificationMessage(preview: MappingPreviewResult) {
  if (preview.invalidCount === 0) {
    return `Получено отзывов: ${preview.previewPayload.reviews.length}.`;
  }

  const firstError = preview.errors[0];
  return firstError
    ? `Валидных отзывов: ${preview.previewPayload.reviews.length}, с ошибками: ${preview.invalidCount}. Первая ошибка: ${firstError}`
    : `Валидных отзывов: ${preview.previewPayload.reviews.length}, с ошибками: ${preview.invalidCount}.`;
}

function buildDefaultUniversalFormState(): UniversalIntegrationFormState {
  return {
    ...initialUniversalFormState,
  };
}

function buildStoredTemplate(
  form: UniversalIntegrationFormState,
  mode: UniversalSourceMode,
): StoredIntegrationTemplate {
  return {
    mode,
    endpointUrl: form.endpointUrl,
    reviewsPath: form.reviewsPath,
    externalIdPath: form.externalIdPath,
    productIdPath: form.productIdPath,
    productSkuPath: form.productSkuPath,
    productNamePath: form.productNamePath,
    reviewTextPath: form.reviewTextPath,
    ratingPath: form.ratingPath,
    reviewDatePath: form.reviewDatePath,
  };
}

function getIntegrationTemplateStorageKey(sourceId: string) {
  return `${TEMPLATE_STORAGE_PREFIX}${sourceId}`;
}

function readStoredIntegrationTemplate(sourceId: string): StoredIntegrationTemplate | null {
  try {
    const rawValue = localStorage.getItem(getIntegrationTemplateStorageKey(sourceId));
    if (!rawValue) {
      return null;
    }

    const parsedValue = JSON.parse(rawValue) as Partial<StoredIntegrationTemplate>;
    return {
      mode: parsedValue.mode === "file" ? "file" : "api",
      endpointUrl: typeof parsedValue.endpointUrl === "string" ? parsedValue.endpointUrl : "",
      reviewsPath: typeof parsedValue.reviewsPath === "string" ? parsedValue.reviewsPath : "",
      externalIdPath:
        typeof parsedValue.externalIdPath === "string" ? parsedValue.externalIdPath : "",
      productIdPath:
        typeof parsedValue.productIdPath === "string" ? parsedValue.productIdPath : "",
      productSkuPath:
        typeof parsedValue.productSkuPath === "string" ? parsedValue.productSkuPath : "",
      productNamePath:
        typeof parsedValue.productNamePath === "string" ? parsedValue.productNamePath : "",
      reviewTextPath:
        typeof parsedValue.reviewTextPath === "string" ? parsedValue.reviewTextPath : "",
      ratingPath: typeof parsedValue.ratingPath === "string" ? parsedValue.ratingPath : "",
      reviewDatePath:
        typeof parsedValue.reviewDatePath === "string" ? parsedValue.reviewDatePath : "",
    };
  } catch {
    return null;
  }
}

function saveIntegrationTemplate(sourceId: string, template: StoredIntegrationTemplate) {
  localStorage.setItem(getIntegrationTemplateStorageKey(sourceId), JSON.stringify(template));
}

function removeIntegrationTemplate(sourceId: string) {
  localStorage.removeItem(getIntegrationTemplateStorageKey(sourceId));
}

function setPreviewPathValue(target: Record<string, unknown>, rawPath: string, value: unknown) {
  const normalizedPath = normalizeText(rawPath);
  if (!normalizedPath) {
    return;
  }

  const pathSegments = normalizedPath
    .replace(/^\$\./, "")
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (pathSegments.length === 0) {
    return;
  }

  let currentValue: Record<string, unknown> = target;

  for (let index = 0; index < pathSegments.length; index += 1) {
    const segment = pathSegments[index];
    const isLast = index === pathSegments.length - 1;

    if (isLast) {
      currentValue[segment] = value;
      return;
    }

    const nextValue = currentValue[segment];
    if (!nextValue || typeof nextValue !== "object" || Array.isArray(nextValue)) {
      currentValue[segment] = {};
    }

    currentValue = currentValue[segment] as Record<string, unknown>;
  }
}

function highlightJsonLine(line: string) {
  return escapeHtml(line)
    .replace(
      /(&quot;[^&]+&quot;)(?=\s*:)/g,
      '<span class="integration-code-token integration-code-token--key">$1</span>',
    )
    .replace(
      /:\s*(&quot;.*?&quot;)/g,
      ': <span class="integration-code-token integration-code-token--string">$1</span>',
    )
    .replace(
      /:\s*(-?\d+(?:\.\d+)?)/g,
      ': <span class="integration-code-token integration-code-token--number">$1</span>',
    )
    .replace(
      /:\s*(true|false|null)/g,
      ': <span class="integration-code-token integration-code-token--literal">$1</span>',
    );
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildRemoteImportPayload(
  form: UniversalIntegrationFormState,
  selectedSource: ReviewSource | null,
): ExternalSourceRequestPayload {
  return {
    source_code: selectedSource?.code || "",
    ...(selectedSource?.name ? { source_name: selectedSource.name } : {}),
    endpoint_url: form.endpointUrl.trim(),
    offset: DEFAULT_REMOTE_OFFSET,
    limit: DEFAULT_REMOTE_LIMIT,
    ...(normalizeText(form.reviewsPath)
      ? { reviews_path: normalizeText(form.reviewsPath) }
      : {}),
    mapping: buildFieldMapping(form),
  };
}

function getUniversalIntegrationFormError(
  form: UniversalIntegrationFormState,
  selectedSource: ReviewSource | null,
  mode: UniversalSourceMode,
  selectedFile: File | null,
) {
  if (!selectedSource) {
    return "Нужно выбрать источник из списка.";
  }

  if (mode === "api") {
    if (!normalizeText(form.endpointUrl)) {
      return "Нужно указать ссылку на JSON API.";
    }

    try {
      const url = new URL(form.endpointUrl.trim());
      if (!["http:", "https:"].includes(url.protocol)) {
        return "Ссылка должна начинаться с http:// или https://";
      }
    } catch {
      return "Ссылка на источник указана некорректно.";
    }
  } else if (!selectedFile) {
    return "Нужно выбрать JSON-файл.";
  } else if (!isJsonFile(selectedFile)) {
    return "Можно загружать только JSON-файлы.";
  }

  if (!normalizeText(form.externalIdPath)) {
    return "Нужно указать путь к внешнему ID.";
  }

  if (!normalizeText(form.reviewTextPath)) {
    return "Нужно указать путь к тексту отзыва.";
  }

  if (!normalizeText(form.ratingPath)) {
    return "Нужно указать путь к оценке.";
  }

  if (!normalizeText(form.productIdPath) && !normalizeText(form.productSkuPath)) {
    return "Нужно указать путь хотя бы к ID товара или SKU товара.";
  }

  return null;
}

function isJsonFile(file: File) {
  const fileName = file.name.toLowerCase();
  const fileType = file.type.toLowerCase();

  return (
    fileName.endsWith(".json") ||
    fileType === "application/json" ||
    fileType === "text/json"
  );
}

async function readJsonFile(file: File | null): Promise<unknown> {
  if (!file) {
    throw new Error("JSON-файл не выбран.");
  }

  if (!isJsonFile(file)) {
    throw new Error("Можно загружать только JSON-файлы.");
  }

  const fileText = await file.text();

  try {
    return JSON.parse(fileText);
  } catch {
    throw new Error("Файл не удалось разобрать как JSON.");
  }
}

function prepareMappedImportFromPayload(
  payload: unknown,
  form: UniversalIntegrationFormState,
  selectedSource: ReviewSource | null,
): MappedImportPreparationSuccess | MappedImportPreparationFailure {
  if (!selectedSource) {
    return { success: false, error: "Нужно выбрать источник из списка." };
  }

  let rawReviews: unknown;

  try {
    rawReviews = resolveJsonPath(payload, form.reviewsPath);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Не удалось найти массив отзывов.",
    };
  }

  if (!Array.isArray(rawReviews)) {
    return {
      success: false,
      error: "Путь к массиву отзывов должен указывать на массив JSON-объектов.",
    };
  }

  const slicedReviews = rawReviews.slice(
    DEFAULT_REMOTE_OFFSET,
    DEFAULT_REMOTE_OFFSET + DEFAULT_REMOTE_LIMIT,
  );

  if (slicedReviews.length === 0) {
    return { success: false, error: "В выбранном источнике массив отзывов пустой." };
  }

  const mapping = buildFieldMapping(form);
  const validReviews: ExternalReviewPayloadItem[] = [];
  const errors: string[] = [];

  slicedReviews.forEach((rawReview, index) => {
    const mappingResult = mapReviewByFieldMapping(rawReview, mapping, index + 1);
    if (!mappingResult.success) {
      errors.push(mappingResult.error);
      return;
    }

    const validation = validatePreviewReview(mappingResult.review, index + 1);
    if (!validation.success) {
      errors.push(validation.error);
      return;
    }

    validReviews.push(validation.review);
  });

  if (validReviews.length === 0) {
    return {
      success: false,
      error: "Не найдено ни одного валидного отзыва после применения маппинга.",
    };
  }

  const payloadForImport: GenericReviewImportPayload = {
    source_code: selectedSource.code,
    source_name: selectedSource.name,
    reviews: validReviews,
  };

  return {
    success: true,
    payload: payloadForImport,
    preview: {
      payload: payloadForImport,
      previewPayload: {
        source_code: selectedSource.code,
        reviews: validReviews,
      },
      sourceName: selectedSource.name,
      sourceCode: selectedSource.code,
      totalCount: slicedReviews.length,
      invalidCount: errors.length,
      errors,
    },
  };
}

function buildFieldMapping(form: UniversalIntegrationFormState): ExternalSourceFieldMapping {
  return {
    external_id: normalizeText(form.externalIdPath),
    ...(normalizeText(form.productIdPath)
      ? { product_id: normalizeText(form.productIdPath) }
      : {}),
    ...(normalizeText(form.productSkuPath)
      ? { product_sku: normalizeText(form.productSkuPath) }
      : {}),
    ...(normalizeText(form.productNamePath)
      ? { product_name: normalizeText(form.productNamePath) }
      : {}),
    review_text: normalizeText(form.reviewTextPath),
    rating: normalizeText(form.ratingPath),
    review_date: normalizeText(form.reviewDatePath) || "=today",
  };
}

function mapReviewByFieldMapping(
  rawReview: unknown,
  mapping: ExternalSourceFieldMapping,
  position: number,
): ReviewPreviewValidationSuccess | ReviewPreviewValidationFailure {
  if (!rawReview || typeof rawReview !== "object") {
    return { success: false, error: `Запись ${position}: элемент должен быть JSON-объектом.` };
  }

  const rawRecord = rawReview as Record<string, unknown>;

  try {
    const mappedReview: Record<string, unknown> = {
      external_id: getRequiredPathValue(rawRecord, mapping.external_id),
      review_text: getRequiredPathValue(rawRecord, mapping.review_text),
      rating: getRequiredPathValue(rawRecord, mapping.rating),
      review_date: normalizeMappedDateValue(getRequiredPathValue(rawRecord, mapping.review_date)),
      source_payload: rawRecord,
    };

    if (mapping.product_id) {
      const productId = getOptionalPathValue(rawRecord, mapping.product_id);
      if (productId) {
        mappedReview.product_id = productId;
      }
    }

    if (mapping.product_sku) {
      const productSku = getOptionalPathValue(rawRecord, mapping.product_sku);
      if (productSku) {
        mappedReview.product_sku = productSku;
      }
    } else if (mappedReview.product_id) {
      mappedReview.product_sku = String(mappedReview.product_id);
    }

    if (mapping.product_name) {
      const productName = getOptionalPathValue(rawRecord, mapping.product_name);
      if (productName) {
        mappedReview.product_name = productName;
      }
    }

    return {
      success: true,
      review: mappedReview as ExternalReviewPayloadItem,
    };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? `Запись ${position}: ${error.message}`
          : `Запись ${position}: не удалось применить маппинг.`,
    };
  }
}

function getRequiredPathValue(rawRecord: Record<string, unknown>, path: string) {
  const value = getOptionalPathValue(rawRecord, path);
  if (value === "" || value === null || value === undefined) {
    throw new Error(`не найдено значение по пути ${path}`);
  }

  return value;
}

function getOptionalPathValue(rawRecord: Record<string, unknown>, path: string) {
  if (path.startsWith("=")) {
    return resolveLocalMappingConstant(path);
  }

  const resolvedValue = resolveJsonPath(rawRecord, path);

  if (resolvedValue === null || resolvedValue === undefined) {
    return "";
  }

  if (typeof resolvedValue === "string") {
    return resolvedValue.trim();
  }

  if (typeof resolvedValue === "number") {
    return resolvedValue;
  }

  return String(resolvedValue);
}

function resolveJsonPath(payload: unknown, rawPath: string) {
  const normalizedPath = normalizeText(rawPath);
  if (!normalizedPath) {
    return payload;
  }

  const path = normalizedPath.startsWith("$.") ? normalizedPath.slice(2) : normalizedPath;
  if (path === "$") {
    return payload;
  }

  return path.split(".").reduce<unknown>((currentValue, segment) => {
    if (currentValue === null || currentValue === undefined) {
      throw new Error(`не найден путь ${normalizedPath}`);
    }

    const trimmedSegment = segment.trim();
    if (!trimmedSegment) {
      return currentValue;
    }

    if (Array.isArray(currentValue)) {
      const index = Number(trimmedSegment);
      if (!Number.isInteger(index) || index < 0 || index >= currentValue.length) {
        throw new Error(`не найден путь ${normalizedPath}`);
      }

      return currentValue[index];
    }

    if (typeof currentValue === "object") {
      const record = currentValue as Record<string, unknown>;
      if (!(trimmedSegment in record)) {
        throw new Error(`не найден путь ${normalizedPath}`);
      }

      return record[trimmedSegment];
    }

    throw new Error(`не найден путь ${normalizedPath}`);
  }, payload);
}

function normalizeMappedDateValue(value: unknown) {
  if (typeof value === "string") {
    const trimmedValue = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmedValue)) {
      return trimmedValue;
    }

    const datePart = trimmedValue.includes("T") ? trimmedValue.split("T", 1)[0] : trimmedValue;
    if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
      return datePart;
    }
  }

  return value;
}

function resolveLocalMappingConstant(path: string) {
  const normalizedConstant = path.slice(1).trim();

  if (!normalizedConstant) {
    return "";
  }

  if (normalizedConstant.toLowerCase() === "today") {
    return new Date().toISOString().slice(0, 10);
  }

  return normalizedConstant;
}

function validatePreviewReview(
  rawReview: unknown,
  position: number,
): ReviewPreviewValidationSuccess | ReviewPreviewValidationFailure {
  if (!rawReview || typeof rawReview !== "object") {
    return { success: false, error: `Запись ${position}: элемент должен быть JSON-объектом.` };
  }

  const reviewRecord = rawReview as Record<string, unknown>;
  const externalId = normalizeText(reviewRecord.external_id);
  const reviewText = normalizeText(reviewRecord.review_text);
  const productSku = normalizeText(reviewRecord.product_sku);
  const productName = normalizeText(reviewRecord.product_name);
  const reviewDate = normalizeReviewDate(reviewRecord.review_date);
  const rating = normalizeRating(reviewRecord.rating);
  const productId = normalizeProductId(reviewRecord.product_id);

  if (!externalId) {
    return { success: false, error: `Запись ${position}: external_id обязателен.` };
  }

  if (!reviewText) {
    return { success: false, error: `Запись ${position}: review_text обязателен.` };
  }

  if (rating === null) {
    return {
      success: false,
      error: `Запись ${position}: rating должен быть числом от 1 до 5.`,
    };
  }

  if (!reviewDate) {
    return {
      success: false,
      error: `Запись ${position}: review_date должен быть в формате YYYY-MM-DD.`,
    };
  }

  if (productId === null && !productSku) {
    return {
      success: false,
      error: `Запись ${position}: нужен product_id или product_sku.`,
    };
  }

  return {
    success: true,
    review: {
      external_id: externalId,
      ...(productId !== null ? { product_id: productId } : {}),
      ...(productSku ? { product_sku: productSku } : {}),
      ...(productName ? { product_name: productName } : {}),
      review_text: reviewText,
      rating,
      review_date: reviewDate,
      ...(typeof reviewRecord.source_payload === "object" && reviewRecord.source_payload
        ? { source_payload: reviewRecord.source_payload as Record<string, unknown> }
        : {}),
    },
  };
}

function normalizeText(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function normalizeReviewDate(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  const normalizedValue = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalizedValue) ? normalizedValue : "";
}

function normalizeRating(value: unknown) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return null;
  }

  const integerValue = Math.round(numericValue);
  return integerValue >= 1 && integerValue <= 5 ? integerValue : null;
}

function normalizeProductId(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const numericValue = Number(value);
  return Number.isInteger(numericValue) && numericValue > 0 ? numericValue : null;
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
