import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import {
  CatalogProduct,
  ReviewSource,
  ReviewStatus,
  apiClient,
} from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useNotifications } from "../notifications/NotificationContext";

type CatalogSection = "products" | "statuses" | "sources";
type CatalogModalMode = "create" | "edit";

type ProductFormState = {
  name: string;
  sku: string;
  isActive: boolean;
};

type StatusFormState = {
  code: string;
  name: string;
  sortOrder: string;
  isTerminal: boolean;
};

type SourceFormState = {
  code: string;
  name: string;
};

const emptyProductForm: ProductFormState = {
  name: "",
  sku: "",
  isActive: true,
};

const emptyStatusForm: StatusFormState = {
  code: "",
  name: "",
  sortOrder: "0",
  isTerminal: false,
};

const emptySourceForm: SourceFormState = {
  code: "",
  name: "",
};

const catalogSections: Array<{ id: CatalogSection; label: string }> = [
  { id: "products", label: "Товары" },
  { id: "statuses", label: "Статусы" },
  { id: "sources", label: "Источники" },
];

const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export function CatalogPage() {
  const { token } = useAuth();
  const { notify } = useNotifications();
  const [activeSection, setActiveSection] = useState<CatalogSection>("products");
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [statuses, setStatuses] = useState<ReviewStatus[]>([]);
  const [sources, setSources] = useState<ReviewSource[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalMode, setModalMode] = useState<CatalogModalMode | null>(null);
  const [editingProduct, setEditingProduct] = useState<CatalogProduct | null>(null);
  const [editingStatus, setEditingStatus] = useState<ReviewStatus | null>(null);
  const [editingSource, setEditingSource] = useState<ReviewSource | null>(null);
  const [productForm, setProductForm] = useState<ProductFormState>(emptyProductForm);
  const [statusForm, setStatusForm] = useState<StatusFormState>(emptyStatusForm);
  const [sourceForm, setSourceForm] = useState<SourceFormState>(emptySourceForm);
  const [isSaving, setIsSaving] = useState(false);
  const [expandedMobileKey, setExpandedMobileKey] = useState<string | null>(null);
  const [mobileProductForm, setMobileProductForm] =
    useState<ProductFormState>(emptyProductForm);
  const [mobileStatusForm, setMobileStatusForm] = useState<StatusFormState>(emptyStatusForm);
  const [mobileSourceForm, setMobileSourceForm] = useState<SourceFormState>(emptySourceForm);
  const [mobileSavingKey, setMobileSavingKey] = useState<string | null>(null);

  const loadCatalog = useCallback(async () => {
    if (!token) {
      setIsLoading(false);
      setError("Не удалось получить токен авторизации.");
      return;
    }

    setIsLoading(true);

    try {
      const [productsResponse, statusesResponse, sourcesResponse] = await Promise.all([
        apiClient.getCatalogProducts(token),
        apiClient.getCatalogReviewStatuses(token),
        apiClient.getCatalogReviewSources(token),
      ]);

      setProducts(productsResponse);
      setStatuses(statusesResponse);
      setSources(sourcesResponse);
      setError(null);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось загрузить каталог.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    setExpandedMobileKey(null);
    setMobileProductForm(emptyProductForm);
    setMobileStatusForm(emptyStatusForm);
    setMobileSourceForm(emptySourceForm);
  }, [activeSection]);

  const activeTitle = useMemo(() => {
    if (activeSection === "products") {
      return "Добавить товар";
    }

    if (activeSection === "statuses") {
      return "Добавить статус";
    }

    return "Добавить источник";
  }, [activeSection]);

  const modalTitle = useMemo(() => {
    const action = modalMode === "edit" ? "Изменить" : "Создать";

    if (activeSection === "products") {
      return `${action} товар`;
    }

    if (activeSection === "statuses") {
      return `${action} статус`;
    }

    return `${action} источник`;
  }, [activeSection, modalMode]);

  const openCreateModal = () => {
    resetForms();
    setModalMode("create");
  };

  const openProductEditModal = (product: CatalogProduct) => {
    setActiveSection("products");
    setEditingProduct(product);
    setProductForm({
      name: product.name,
      sku: product.sku,
      isActive: product.is_active,
    });
    setModalMode("edit");
  };

  const openStatusEditModal = (statusItem: ReviewStatus) => {
    setActiveSection("statuses");
    setEditingStatus(statusItem);
    setStatusForm({
      code: statusItem.code,
      name: statusItem.name,
      sortOrder: String(statusItem.sort_order),
      isTerminal: statusItem.is_terminal,
    });
    setModalMode("edit");
  };

  const openSourceEditModal = (source: ReviewSource) => {
    setActiveSection("sources");
    setEditingSource(source);
    setSourceForm({
      code: source.code,
      name: source.name,
    });
    setModalMode("edit");
  };

  const closeModal = () => {
    if (!isSaving) {
      setModalMode(null);
      resetForms();
    }
  };

  const resetForms = () => {
    setEditingProduct(null);
    setEditingStatus(null);
    setEditingSource(null);
    setProductForm(emptyProductForm);
    setStatusForm(emptyStatusForm);
    setSourceForm(emptySourceForm);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!token || !modalMode) {
      return;
    }

    setIsSaving(true);

    try {
      if (activeSection === "products") {
        await saveProduct(token, modalMode);
      } else if (activeSection === "statuses") {
        await saveStatus(token, modalMode);
      } else {
        await saveSource(token, modalMode);
      }

      notify({
        type: "success",
        title: "Успешное действие",
        message: "Каталог успешно обновлен.",
      });
      setModalMode(null);
      resetForms();
    } catch (requestError) {
      notify({
        type: "error",
        title: "Ошибка сохранения",
        message:
          requestError instanceof Error
            ? requestError.message
            : "Не удалось сохранить элемент каталога.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const saveProduct = async (authToken: string, mode: CatalogModalMode) => {
    const name = productForm.name.trim();
    const sku = productForm.sku.trim();

    if (!name || !sku) {
      throw new Error("Нельзя сохранить товар с незаполненными полями.");
    }

    if (mode === "create") {
      const createdProduct = await apiClient.createCatalogProduct(authToken, {
        name,
        sku,
        is_active: productForm.isActive,
      });
      setProducts((current) => [...current, createdProduct].sort(sortProducts));
      return;
    }

    if (!editingProduct) {
      return;
    }

    const updatedProduct = await apiClient.updateCatalogProduct(authToken, editingProduct.id, {
      name,
      sku,
      is_active: productForm.isActive,
    });
    setProducts((current) =>
      current
        .map((product) => (product.id === updatedProduct.id ? updatedProduct : product))
        .sort(sortProducts),
    );
  };

  const saveStatus = async (authToken: string, mode: CatalogModalMode) => {
    const code = statusForm.code.trim();
    const name = statusForm.name.trim();
    const sortOrder = Number(statusForm.sortOrder);

    if (!code || !name || !statusForm.sortOrder.trim()) {
      throw new Error("Нельзя сохранить статус с незаполненными полями.");
    }

    if (!Number.isInteger(sortOrder) || sortOrder < 0) {
      throw new Error("Порядок сортировки должен быть неотрицательным целым числом.");
    }

    if (mode === "create") {
      const createdStatus = await apiClient.createCatalogReviewStatus(authToken, {
        code,
        name,
        sort_order: sortOrder,
        is_terminal: statusForm.isTerminal,
      });
      setStatuses((current) => [...current, createdStatus].sort(sortStatuses));
      return;
    }

    if (!editingStatus) {
      return;
    }

    const updatedStatus = await apiClient.updateCatalogReviewStatus(
      authToken,
      editingStatus.id,
      {
        code,
        name,
        sort_order: sortOrder,
        is_terminal: statusForm.isTerminal,
      },
    );
    setStatuses((current) =>
      current
        .map((statusItem) =>
          statusItem.id === updatedStatus.id ? updatedStatus : statusItem,
        )
        .sort(sortStatuses),
    );
  };

  const saveSource = async (authToken: string, mode: CatalogModalMode) => {
    const code = sourceForm.code.trim();
    const name = sourceForm.name.trim();

    if (!code || !name) {
      throw new Error("Нельзя сохранить источник с незаполненными полями.");
    }

    if (mode === "create") {
      const createdSource = await apiClient.createCatalogReviewSource(authToken, {
        code,
        name,
      });
      setSources((current) => [...current, createdSource].sort(sortSources));
      return;
    }

    if (!editingSource) {
      return;
    }

    const updatedSource = await apiClient.updateCatalogReviewSource(
      authToken,
      editingSource.id,
      { code, name },
    );
    setSources((current) =>
      current
        .map((source) => (source.id === updatedSource.id ? updatedSource : source))
        .sort(sortSources),
    );
  };

  const toggleMobileProduct = (product: CatalogProduct) => {
    const key = buildCatalogKey("products", product.id);

    if (expandedMobileKey === key) {
      setExpandedMobileKey(null);
      setMobileProductForm(emptyProductForm);
      return;
    }

    setExpandedMobileKey(key);
    setMobileProductForm({
      name: product.name,
      sku: product.sku,
      isActive: product.is_active,
    });
  };

  const toggleMobileStatus = (statusItem: ReviewStatus) => {
    const key = buildCatalogKey("statuses", statusItem.id);

    if (expandedMobileKey === key) {
      setExpandedMobileKey(null);
      setMobileStatusForm(emptyStatusForm);
      return;
    }

    setExpandedMobileKey(key);
    setMobileStatusForm({
      code: statusItem.code,
      name: statusItem.name,
      sortOrder: String(statusItem.sort_order),
      isTerminal: statusItem.is_terminal,
    });
  };

  const toggleMobileSource = (source: ReviewSource) => {
    const key = buildCatalogKey("sources", source.id);

    if (expandedMobileKey === key) {
      setExpandedMobileKey(null);
      setMobileSourceForm(emptySourceForm);
      return;
    }

    setExpandedMobileKey(key);
    setMobileSourceForm({
      code: source.code,
      name: source.name,
    });
  };

  const handleMobileProductSubmit = async (
    event: FormEvent<HTMLFormElement>,
    product: CatalogProduct,
  ) => {
    event.preventDefault();

    if (!token) {
      return;
    }

    const name = mobileProductForm.name.trim();
    const sku = mobileProductForm.sku.trim();

    if (!name || !sku) {
      notify({
        type: "error",
        title: "Ошибка сохранения",
        message: "Нельзя сохранить товар с незаполненными полями.",
      });
      return;
    }

    const key = buildCatalogKey("products", product.id);
    setMobileSavingKey(key);

    try {
      const updatedProduct = await apiClient.updateCatalogProduct(token, product.id, {
        name,
        sku,
        is_active: mobileProductForm.isActive,
      });
      setProducts((current) =>
        current
          .map((item) => (item.id === updatedProduct.id ? updatedProduct : item))
          .sort(sortProducts),
      );
      setExpandedMobileKey(null);
      notify({
        type: "success",
        title: "Успешное действие",
        message: "Товар успешно обновлен.",
      });
    } catch (requestError) {
      notifyCatalogSaveError(notify, requestError);
    } finally {
      setMobileSavingKey(null);
    }
  };

  const handleMobileStatusSubmit = async (
    event: FormEvent<HTMLFormElement>,
    statusItem: ReviewStatus,
  ) => {
    event.preventDefault();

    if (!token) {
      return;
    }

    const code = mobileStatusForm.code.trim();
    const name = mobileStatusForm.name.trim();
    const sortOrder = Number(mobileStatusForm.sortOrder);

    if (!code || !name || !mobileStatusForm.sortOrder.trim()) {
      notify({
        type: "error",
        title: "Ошибка сохранения",
        message: "Нельзя сохранить статус с незаполненными полями.",
      });
      return;
    }

    if (!Number.isInteger(sortOrder) || sortOrder < 0) {
      notify({
        type: "error",
        title: "Ошибка сохранения",
        message: "Порядок сортировки должен быть неотрицательным целым числом.",
      });
      return;
    }

    const key = buildCatalogKey("statuses", statusItem.id);
    setMobileSavingKey(key);

    try {
      const updatedStatus = await apiClient.updateCatalogReviewStatus(
        token,
        statusItem.id,
        {
          code,
          name,
          sort_order: sortOrder,
          is_terminal: mobileStatusForm.isTerminal,
        },
      );
      setStatuses((current) =>
        current
          .map((item) => (item.id === updatedStatus.id ? updatedStatus : item))
          .sort(sortStatuses),
      );
      setExpandedMobileKey(null);
      notify({
        type: "success",
        title: "Успешное действие",
        message: "Статус успешно обновлен.",
      });
    } catch (requestError) {
      notifyCatalogSaveError(notify, requestError);
    } finally {
      setMobileSavingKey(null);
    }
  };

  const handleMobileSourceSubmit = async (
    event: FormEvent<HTMLFormElement>,
    source: ReviewSource,
  ) => {
    event.preventDefault();

    if (!token) {
      return;
    }

    const code = mobileSourceForm.code.trim();
    const name = mobileSourceForm.name.trim();

    if (!code || !name) {
      notify({
        type: "error",
        title: "Ошибка сохранения",
        message: "Нельзя сохранить источник с незаполненными полями.",
      });
      return;
    }

    const key = buildCatalogKey("sources", source.id);
    setMobileSavingKey(key);

    try {
      const updatedSource = await apiClient.updateCatalogReviewSource(token, source.id, {
        code,
        name,
      });
      setSources((current) =>
        current
          .map((item) => (item.id === updatedSource.id ? updatedSource : item))
          .sort(sortSources),
      );
      setExpandedMobileKey(null);
      notify({
        type: "success",
        title: "Успешное действие",
        message: "Источник успешно обновлен.",
      });
    } catch (requestError) {
      notifyCatalogSaveError(notify, requestError);
    } finally {
      setMobileSavingKey(null);
    }
  };

  return (
    <section className="catalog-page">
      <div className="catalog-toolbar">
        <div className="catalog-segmented" role="tablist" aria-label="Раздел каталога">
          {catalogSections.map((section) => (
            <button
              aria-selected={activeSection === section.id}
              className={`catalog-segment ${activeSection === section.id ? "is-active" : ""}`}
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              role="tab"
              type="button"
            >
              {section.label}
            </button>
          ))}
        </div>

        <button className="primary-button users-add-button" type="button" onClick={openCreateModal}>
          {activeTitle}
        </button>
      </div>

      <div className="users-table-panel catalog-table-panel">
        {isLoading ? (
          <p className="users-state">Загружаем каталог...</p>
        ) : error ? (
          <p className="users-state users-state--error">{error}</p>
        ) : (
          <div className="users-table-scroll">
            {activeSection === "products" ? (
              <ProductsTable products={products} onEdit={openProductEditModal} />
            ) : null}
            {activeSection === "statuses" ? (
              <StatusesTable statuses={statuses} onEdit={openStatusEditModal} />
            ) : null}
            {activeSection === "sources" ? (
              <SourcesTable sources={sources} onEdit={openSourceEditModal} />
            ) : null}
          </div>
        )}
      </div>

      <div className="catalog-mobile-list">
        {isLoading ? (
          <p className="users-state">Загружаем каталог...</p>
        ) : error ? (
          <p className="users-state users-state--error">{error}</p>
        ) : activeSection === "products" ? (
          products.length > 0 ? (
            products.map((product) => {
              const key = buildCatalogKey("products", product.id);
              const isExpanded = expandedMobileKey === key;

              return (
                <article
                  className={`catalog-mobile-card ${isExpanded ? "is-expanded" : ""}`}
                  key={product.id}
                >
                  <button
                    className="catalog-mobile-summary"
                    onClick={() => toggleMobileProduct(product)}
                    type="button"
                  >
                    <span>ID {product.id}</span>
                    <strong>{product.name}</strong>
                    <span>{product.sku}</span>
                  </button>
                  <div className="catalog-mobile-card-panel">
                    <form
                      className="catalog-mobile-card-content"
                      onSubmit={(event) => handleMobileProductSubmit(event, product)}
                    >
                      <div className="mobile-card-details">
                        <div>
                          <span>Статус</span>
                          <span
                            className={`status-badge ${
                              product.is_active
                                ? "status-badge--active"
                                : "status-badge--blocked"
                            }`}
                          >
                            {product.is_active ? "Активен" : "Отключен"}
                          </span>
                        </div>
                        <div>
                          <span>Дата создания</span>
                          <strong>{formatDate(product.created_at)}</strong>
                        </div>
                      </div>
                      <div className="mobile-card-form">
                        <ProductForm form={mobileProductForm} onChange={setMobileProductForm} />
                      </div>
                      <footer className="mobile-card-actions">
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() => toggleMobileProduct(product)}
                        >
                          Отменить
                        </button>
                        <button
                          className="primary-button"
                          disabled={mobileSavingKey === key}
                          type="submit"
                        >
                          {mobileSavingKey === key ? "Сохраняем..." : "Сохранить"}
                        </button>
                      </footer>
                    </form>
                  </div>
                </article>
              );
            })
          ) : (
            <p className="users-state">Товары пока не добавлены.</p>
          )
        ) : activeSection === "statuses" ? (
          statuses.length > 0 ? (
            statuses.map((statusItem) => {
              const key = buildCatalogKey("statuses", statusItem.id);
              const isExpanded = expandedMobileKey === key;

              return (
                <article
                  className={`catalog-mobile-card ${isExpanded ? "is-expanded" : ""}`}
                  key={statusItem.id}
                >
                  <button
                    className="catalog-mobile-summary"
                    onClick={() => toggleMobileStatus(statusItem)}
                    type="button"
                  >
                    <span>ID {statusItem.id}</span>
                    <strong>{statusItem.name}</strong>
                    <span>{statusItem.code}</span>
                  </button>
                  <div className="catalog-mobile-card-panel">
                    <form
                      className="catalog-mobile-card-content"
                      onSubmit={(event) => handleMobileStatusSubmit(event, statusItem)}
                    >
                      <div className="mobile-card-details">
                        <div>
                          <span>Сортировка</span>
                          <strong>{statusItem.sort_order}</strong>
                        </div>
                        <div>
                          <span>Финальный</span>
                          <strong>{statusItem.is_terminal ? "Да" : "Нет"}</strong>
                        </div>
                      </div>
                      <div className="mobile-card-form">
                        <StatusForm form={mobileStatusForm} onChange={setMobileStatusForm} />
                      </div>
                      <footer className="mobile-card-actions">
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() => toggleMobileStatus(statusItem)}
                        >
                          Отменить
                        </button>
                        <button
                          className="primary-button"
                          disabled={mobileSavingKey === key}
                          type="submit"
                        >
                          {mobileSavingKey === key ? "Сохраняем..." : "Сохранить"}
                        </button>
                      </footer>
                    </form>
                  </div>
                </article>
              );
            })
          ) : (
            <p className="users-state">Статусы пока не добавлены.</p>
          )
        ) : sources.length > 0 ? (
          sources.map((source) => {
            const key = buildCatalogKey("sources", source.id);
            const isExpanded = expandedMobileKey === key;

            return (
              <article
                className={`catalog-mobile-card ${isExpanded ? "is-expanded" : ""}`}
                key={source.id}
              >
                <button
                  className="catalog-mobile-summary"
                  onClick={() => toggleMobileSource(source)}
                  type="button"
                >
                  <span>ID {source.id}</span>
                  <strong>{source.name}</strong>
                  <span>{source.code}</span>
                </button>
                <div className="catalog-mobile-card-panel">
                  <form
                    className="catalog-mobile-card-content"
                    onSubmit={(event) => handleMobileSourceSubmit(event, source)}
                  >
                    <div className="mobile-card-form">
                      <SourceForm form={mobileSourceForm} onChange={setMobileSourceForm} />
                    </div>
                    <footer className="mobile-card-actions">
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => toggleMobileSource(source)}
                      >
                        Отменить
                      </button>
                      <button
                        className="primary-button"
                        disabled={mobileSavingKey === key}
                        type="submit"
                      >
                        {mobileSavingKey === key ? "Сохраняем..." : "Сохранить"}
                      </button>
                    </footer>
                  </form>
                </div>
              </article>
            );
          })
        ) : (
          <p className="users-state">Источники пока не добавлены.</p>
        )}
      </div>

      {modalMode ? (
        <div className="modal-overlay" role="presentation" onMouseDown={closeModal}>
          <form
            className="user-modal catalog-modal"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={handleSubmit}
          >
            <header className="modal-header">
              <h2>{modalTitle}</h2>
              <button
                aria-label="Закрыть окно"
                className="notice-close"
                onClick={closeModal}
                type="button"
              >
                ×
              </button>
            </header>

            <div className="modal-body">
              {activeSection === "products" ? (
                <ProductForm form={productForm} onChange={setProductForm} />
              ) : null}
              {activeSection === "statuses" ? (
                <StatusForm form={statusForm} onChange={setStatusForm} />
              ) : null}
              {activeSection === "sources" ? (
                <SourceForm form={sourceForm} onChange={setSourceForm} />
              ) : null}
            </div>

            <footer className="modal-actions">
              <button className="secondary-button" type="button" onClick={closeModal}>
                Отменить
              </button>
              <button className="primary-button" disabled={isSaving} type="submit">
                {isSaving ? "Сохраняем..." : "Сохранить"}
              </button>
            </footer>
          </form>
        </div>
      ) : null}
    </section>
  );
}

function ProductsTable({
  products,
  onEdit,
}: {
  products: CatalogProduct[];
  onEdit: (product: CatalogProduct) => void;
}) {
  return (
    <table className="users-table catalog-table">
      <thead>
        <tr>
          <th>ID</th>
          <th>Название</th>
          <th>SKU</th>
          <th>Статус</th>
          <th>Дата создания</th>
          <th>Действия</th>
        </tr>
      </thead>
      <tbody>
        {products.length > 0 ? (
          products.map((product) => (
            <tr key={product.id}>
              <td>{product.id}</td>
              <td>{product.name}</td>
              <td>{product.sku}</td>
              <td>
                <span
                  className={`status-badge ${
                    product.is_active ? "status-badge--active" : "status-badge--blocked"
                  }`}
                >
                  {product.is_active ? "Активен" : "Отключен"}
                </span>
              </td>
              <td>{formatDate(product.created_at)}</td>
              <td>
                <TableEditButton label="Редактировать товар" onClick={() => onEdit(product)} />
              </td>
            </tr>
          ))
        ) : (
          <tr>
            <td colSpan={6}>Товары пока не добавлены.</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function StatusesTable({
  statuses,
  onEdit,
}: {
  statuses: ReviewStatus[];
  onEdit: (statusItem: ReviewStatus) => void;
}) {
  return (
    <table className="users-table catalog-table">
      <thead>
        <tr>
          <th>ID</th>
          <th>Код</th>
          <th>Название</th>
          <th>Сортировка</th>
          <th>Финальный</th>
          <th>Действия</th>
        </tr>
      </thead>
      <tbody>
        {statuses.length > 0 ? (
          statuses.map((statusItem) => (
            <tr key={statusItem.id}>
              <td>{statusItem.id}</td>
              <td>{statusItem.code}</td>
              <td>{statusItem.name}</td>
              <td>{statusItem.sort_order}</td>
              <td>{statusItem.is_terminal ? "Да" : "Нет"}</td>
              <td>
                <TableEditButton
                  label="Редактировать статус"
                  onClick={() => onEdit(statusItem)}
                />
              </td>
            </tr>
          ))
        ) : (
          <tr>
            <td colSpan={6}>Статусы пока не добавлены.</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function SourcesTable({
  sources,
  onEdit,
}: {
  sources: ReviewSource[];
  onEdit: (source: ReviewSource) => void;
}) {
  return (
    <table className="users-table catalog-table">
      <thead>
        <tr>
          <th>ID</th>
          <th>Код</th>
          <th>Название</th>
          <th>Действия</th>
        </tr>
      </thead>
      <tbody>
        {sources.length > 0 ? (
          sources.map((source) => (
            <tr key={source.id}>
              <td>{source.id}</td>
              <td>{source.code}</td>
              <td>{source.name}</td>
              <td>
                <TableEditButton
                  label="Редактировать источник"
                  onClick={() => onEdit(source)}
                />
              </td>
            </tr>
          ))
        ) : (
          <tr>
            <td colSpan={4}>Источники пока не добавлены.</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function TableEditButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button aria-label={label} className="icon-button" onClick={onClick} type="button">
      <img src="/images/icons/edit.svg" alt="" aria-hidden="true" />
    </button>
  );
}

function ProductForm({
  form,
  onChange,
}: {
  form: ProductFormState;
  onChange: (form: ProductFormState) => void;
}) {
  return (
    <>
      <label>
        <span>
          Название<span className="required-mark">*</span>
        </span>
        <input
          type="text"
          value={form.name}
          onChange={(event) => onChange({ ...form, name: event.target.value })}
        />
      </label>
      <label>
        <span>
          SKU<span className="required-mark">*</span>
        </span>
        <input
          type="text"
          value={form.sku}
          onChange={(event) => onChange({ ...form, sku: event.target.value })}
        />
      </label>
      <label>
        <span>Статус</span>
        <select
          value={form.isActive ? "active" : "inactive"}
          onChange={(event) =>
            onChange({ ...form, isActive: event.target.value === "active" })
          }
        >
          <option value="active">Активен</option>
          <option value="inactive">Отключен</option>
        </select>
      </label>
    </>
  );
}

function StatusForm({
  form,
  onChange,
}: {
  form: StatusFormState;
  onChange: (form: StatusFormState) => void;
}) {
  return (
    <>
      <label>
        <span>
          Код<span className="required-mark">*</span>
        </span>
        <input
          type="text"
          value={form.code}
          onChange={(event) => onChange({ ...form, code: event.target.value })}
        />
      </label>
      <label>
        <span>
          Название<span className="required-mark">*</span>
        </span>
        <input
          type="text"
          value={form.name}
          onChange={(event) => onChange({ ...form, name: event.target.value })}
        />
      </label>
      <label>
        <span>
          Порядок сортировки<span className="required-mark">*</span>
        </span>
        <input
          min="0"
          step="1"
          type="number"
          value={form.sortOrder}
          onChange={(event) => onChange({ ...form, sortOrder: event.target.value })}
        />
      </label>
      <label>
        <span>Финальный статус</span>
        <select
          value={form.isTerminal ? "true" : "false"}
          onChange={(event) =>
            onChange({ ...form, isTerminal: event.target.value === "true" })
          }
        >
          <option value="false">Нет</option>
          <option value="true">Да</option>
        </select>
      </label>
    </>
  );
}

function SourceForm({
  form,
  onChange,
}: {
  form: SourceFormState;
  onChange: (form: SourceFormState) => void;
}) {
  return (
    <>
      <label>
        <span>
          Код<span className="required-mark">*</span>
        </span>
        <input
          type="text"
          value={form.code}
          onChange={(event) => onChange({ ...form, code: event.target.value })}
        />
      </label>
      <label>
        <span>
          Название<span className="required-mark">*</span>
        </span>
        <input
          type="text"
          value={form.name}
          onChange={(event) => onChange({ ...form, name: event.target.value })}
        />
      </label>
    </>
  );
}

function sortProducts(first: CatalogProduct, second: CatalogProduct) {
  return first.id - second.id;
}

function sortStatuses(first: ReviewStatus, second: ReviewStatus) {
  return first.sort_order - second.sort_order || first.id - second.id;
}

function sortSources(first: ReviewSource, second: ReviewSource) {
  return first.id - second.id;
}

function buildCatalogKey(section: CatalogSection, id: number) {
  return `${section}:${id}`;
}

function notifyCatalogSaveError(
  notify: ReturnType<typeof useNotifications>["notify"],
  requestError: unknown,
) {
  notify({
    type: "error",
    title: "Ошибка сохранения",
    message:
      requestError instanceof Error
        ? requestError.message
        : "Не удалось сохранить элемент каталога.",
  });
}

function formatDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return dateFormatter.format(date);
}
