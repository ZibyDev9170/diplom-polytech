import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import {
  ReviewDetail,
  ReviewListItem,
  ReviewListParams,
  ReviewReferenceData,
  apiClient,
} from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useNotifications } from "../notifications/NotificationContext";

type ReviewFilters = {
  q: string;
  productId: string;
  statusId: string;
  sourceId: string;
  rating: string;
  assignedUserId: string;
  dateFrom: string;
  dateTo: string;
};

type ReviewFormState = {
  productId: string;
  sourceId: string;
  reviewText: string;
  rating: string;
  reviewDate: string;
  externalId: string;
};

type ReviewFormField = keyof ReviewFormState;

type CombinedHistoryItem = {
  id: string;
  occurredAt: string;
  title: string;
  description: string;
  extra?: string;
};

const REVIEWS_PER_PAGE = 10;

const emptyFilters: ReviewFilters = {
  q: "",
  productId: "",
  statusId: "",
  sourceId: "",
  rating: "",
  assignedUserId: "",
  dateFrom: "",
  dateTo: "",
};

const emptyReviewForm: ReviewFormState = {
  productId: "",
  sourceId: "",
  reviewText: "",
  rating: "",
  reviewDate: "",
  externalId: "",
};

const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const dateTimeFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function ReviewsPage() {
  const { token } = useAuth();
  const { notify } = useNotifications();
  const navigate = useNavigate();
  const [referenceData, setReferenceData] = useState<ReviewReferenceData | null>(null);
  const [reviews, setReviews] = useState<ReviewListItem[]>([]);
  const [filters, setFilters] = useState<ReviewFilters>(emptyFilters);
  const [totalReviews, setTotalReviews] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [isReferenceLoading, setIsReferenceLoading] = useState(true);
  const [isReviewsLoading, setIsReviewsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createForm, setCreateForm] = useState<ReviewFormState>(emptyReviewForm);
  const [isSaving, setIsSaving] = useState(false);
  const [isMobileFiltersOpen, setIsMobileFiltersOpen] = useState(false);
  const [mobileFilters, setMobileFilters] = useState<ReviewFilters>(emptyFilters);

  const loadReviews = useCallback(
    async (page: number, nextFilters: ReviewFilters) => {
      if (!token) {
        setError("Не удалось получить токен авторизации.");
        setIsReviewsLoading(false);
        return;
      }

      setIsReviewsLoading(true);

      try {
        const response = await apiClient.getReviews(
          token,
          buildReviewListParams(nextFilters, page),
        );
        setReviews(response.items);
        setTotalReviews(response.total);
        setError(null);
      } catch (requestError) {
        setReviews([]);
        setTotalReviews(0);
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Не удалось загрузить отзывы.",
        );
      } finally {
        setIsReviewsLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    if (!token) {
      setIsReferenceLoading(false);
      setError("Не удалось получить токен авторизации.");
      return;
    }

    let isMounted = true;

    apiClient
      .getReviewReferenceData(token)
      .then((data) => {
        if (isMounted) {
          setReferenceData(data);
        }
      })
      .catch((requestError: Error) => {
        if (isMounted) {
          setError(requestError.message);
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsReferenceLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [token]);

  useEffect(() => {
    loadReviews(currentPage, filters);
  }, [currentPage, filters, loadReviews]);

  const totalPages = Math.max(1, Math.ceil(totalReviews / REVIEWS_PER_PAGE));

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const manualSourceId = useMemo(() => {
    const manualSource = referenceData?.sources.find((source) => source.code === "manual");

    return manualSource ? String(manualSource.id) : "";
  }, [referenceData]);

  const handleFilterChange = (field: keyof ReviewFilters, value: string) => {
    setCurrentPage(1);
    setFilters((current) => ({ ...current, [field]: value }));
  };

  const resetFilters = () => {
    setCurrentPage(1);
    setFilters(emptyFilters);
  };

  const openMobileFilters = () => {
    setMobileFilters(filters);
    setIsMobileFiltersOpen(true);
  };

  const closeMobileFilters = () => {
    setIsMobileFiltersOpen(false);
  };

  const handleMobileFilterChange = (field: keyof ReviewFilters, value: string) => {
    setMobileFilters((current) => ({ ...current, [field]: value }));
  };

  const applyMobileFilters = () => {
    setCurrentPage(1);
    setFilters(mobileFilters);
    setIsMobileFiltersOpen(false);
  };

  const resetMobileFilters = () => {
    setCurrentPage(1);
    setFilters(emptyFilters);
    setMobileFilters(emptyFilters);
    setIsMobileFiltersOpen(false);
  };

  const openCreateModal = () => {
    setCreateForm({
      ...emptyReviewForm,
      sourceId: manualSourceId,
      reviewDate: getTodayInputValue(),
    });
    setIsCreateModalOpen(true);
  };

  const closeCreateModal = () => {
    if (!isSaving) {
      setIsCreateModalOpen(false);
      setCreateForm(emptyReviewForm);
    }
  };

  const handleCreateFieldChange = (field: ReviewFormField, value: string) => {
    setCreateForm((current) => ({ ...current, [field]: value }));
  };

  const handleCreateSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!token) {
      return;
    }

    const payload = validateReviewForm(createForm, notify);
    if (!payload) {
      return;
    }

    setIsSaving(true);

    try {
      await apiClient.createReview(token, payload);
      notify({
        type: "success",
        title: "Успешное действие",
        message: "Отзыв успешно создан.",
      });
      setIsCreateModalOpen(false);
      setCreateForm(emptyReviewForm);
      setCurrentPage(1);
      await loadReviews(1, filters);
    } catch (requestError) {
      notify({
        type: "error",
        title: "Ошибка сохранения",
        message:
          requestError instanceof Error
            ? requestError.message
            : "Не удалось создать отзыв.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const isLoading = isReferenceLoading || isReviewsLoading;

  return (
    <section className="reviews-page">
      <div className="reviews-toolbar">
        <label className="reviews-search">
          <span className="sr-only">Поиск по отзывам</span>
          <span className="reviews-search-icon" aria-hidden="true" />
          <input
            placeholder="Поиск..."
            type="search"
            value={filters.q}
            onChange={(event) => handleFilterChange("q", event.target.value)}
          />
          {filters.q ? (
            <button
              aria-label="Очистить поиск"
              className="reviews-search-clear"
              onClick={() => handleFilterChange("q", "")}
              type="button"
            >
              ×
            </button>
          ) : null}
        </label>

        <button
          className="primary-button users-add-button reviews-add-button"
          type="button"
          onClick={openCreateModal}
        >
          Добавить отзыв
        </button>
      </div>

      <div className="reviews-filters">
        <FilterSelect
          label="Товары"
          value={filters.productId}
          onChange={(value) => handleFilterChange("productId", value)}
        >
          <option value="">Все</option>
          {referenceData?.products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name}
            </option>
          ))}
        </FilterSelect>

        <FilterSelect
          label="Статус"
          value={filters.statusId}
          onChange={(value) => handleFilterChange("statusId", value)}
        >
          <option value="">Все</option>
          {referenceData?.statuses.map((statusItem) => (
            <option key={statusItem.id} value={statusItem.id}>
              {statusItem.name}
            </option>
          ))}
        </FilterSelect>

        <FilterSelect
          label="Оценка"
          value={filters.rating}
          onChange={(value) => handleFilterChange("rating", value)}
        >
          <option value="">Все</option>
          {[1, 2, 3, 4, 5].map((rating) => (
            <option key={rating} value={rating}>
              {rating}
            </option>
          ))}
        </FilterSelect>

        <FilterSelect
          label="Источник"
          value={filters.sourceId}
          onChange={(value) => handleFilterChange("sourceId", value)}
        >
          <option value="">Все</option>
          {referenceData?.sources.map((source) => (
            <option key={source.id} value={source.id}>
              {source.name}
            </option>
          ))}
        </FilterSelect>

        <FilterSelect
          label="Ответственный"
          value={filters.assignedUserId}
          onChange={(value) => handleFilterChange("assignedUserId", value)}
        >
          <option value="">Все</option>
          {referenceData?.users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.full_name}
            </option>
          ))}
        </FilterSelect>

        <label className="reviews-filter-field">
          <span>Дата с</span>
          <input
            type="date"
            value={filters.dateFrom}
            onChange={(event) => handleFilterChange("dateFrom", event.target.value)}
          />
        </label>

        <label className="reviews-filter-field">
          <span>Дата по</span>
          <input
            type="date"
            value={filters.dateTo}
            onChange={(event) => handleFilterChange("dateTo", event.target.value)}
          />
        </label>

        <button className="secondary-button reviews-reset-button" type="button" onClick={resetFilters}>
          Сбросить
        </button>
      </div>

      <p className="reviews-found reviews-found--desktop">Найдено отзывов: {totalReviews}</p>

      <div className="reviews-mobile-summary-bar">
        <p className="reviews-found">Найдено отзывов: {totalReviews}</p>
        <button
          aria-expanded={isMobileFiltersOpen}
          className="reviews-filter-toggle"
          onClick={openMobileFilters}
          type="button"
        >
          <img src="/images/icons/filter.svg" alt="" aria-hidden="true" />
          <span>Фильтр</span>
        </button>
      </div>

      <div className="reviews-table-panel">
        {isLoading ? (
          <p className="users-state">Загружаем отзывы...</p>
        ) : error ? (
          <p className="users-state users-state--error">{error}</p>
        ) : (
          <div className="reviews-table-scroll">
            <table className="reviews-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Товар</th>
                  <th>Текст</th>
                  <th>Оценка</th>
                  <th>Статус</th>
                  <th>Источник</th>
                  <th>Ответственный</th>
                  <th>Дата</th>
                </tr>
              </thead>
              <tbody>
                {reviews.length > 0 ? (
                  reviews.map((review) => (
                    <tr
                      className="reviews-table-row"
                      key={review.id}
                      onClick={() => navigate(`/reviews/${review.id}`)}
                    >
                      <td>{review.id}</td>
                      <td>{review.product.name}</td>
                      <td className="review-text-cell">{review.review_text}</td>
                      <td>{formatRating(review.rating)}</td>
                      <td>
                        <span className="status-badge status-badge--review">
                          {review.status.name}
                        </span>
                      </td>
                      <td>{review.source.name}</td>
                      <td>{review.assigned_user?.full_name || "Не назначен"}</td>
                      <td>{formatDate(review.review_date)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={8}>Отзывы пока не добавлены.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="reviews-mobile-list">
        {isLoading ? (
          <p className="users-state">Загружаем отзывы...</p>
        ) : error ? (
          <p className="users-state users-state--error">{error}</p>
        ) : reviews.length > 0 ? (
          reviews.map((review) => (
              <button
                className="review-mobile-card"
                key={review.id}
                type="button"
                onClick={() => navigate(`/reviews/${review.id}`)}
              >
                <span>ID {review.id}</span>
                <strong>{review.product.name}</strong>
                <span>{review.review_text}</span>
                <span>{review.status.name}</span>
              </button>
            ))
        ) : (
          <p className="users-state">Отзывы пока не добавлены.</p>
        )}
      </div>

      {!isLoading && !error ? (
        <ReviewsPagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
        />
      ) : null}

      {isCreateModalOpen && referenceData ? (
        <ReviewFormModal
          form={createForm}
          isSaving={isSaving}
          referenceData={referenceData}
          submitText="Сохранить"
          title="Добавить отзыв"
          onChange={handleCreateFieldChange}
          onClose={closeCreateModal}
          onSubmit={handleCreateSubmit}
        />
      ) : null}

      <div
        aria-hidden={!isMobileFiltersOpen}
        className={`reviews-filter-drawer-overlay ${
          isMobileFiltersOpen ? "is-open" : ""
        }`}
        onClick={closeMobileFilters}
      >
        <aside
          aria-label="Фильтры отзывов"
          className="reviews-filter-drawer"
          onClick={(event) => event.stopPropagation()}
        >
          <header className="reviews-filter-drawer-header">
            <h2>Фильтры</h2>
            <button
              aria-label="Закрыть фильтры"
              className="notice-close"
              onClick={closeMobileFilters}
              type="button"
            >
              ×
            </button>
          </header>

          <div className="reviews-filter-drawer-content">
            <label className="reviews-search reviews-search--drawer">
              <span className="sr-only">Поиск по отзывам</span>
              <span className="reviews-search-icon" aria-hidden="true" />
              <input
                placeholder="Поиск..."
                type="search"
                value={mobileFilters.q}
                onChange={(event) => handleMobileFilterChange("q", event.target.value)}
              />
              {mobileFilters.q ? (
                <button
                  aria-label="Очистить поиск"
                  className="reviews-search-clear"
                  onClick={() => handleMobileFilterChange("q", "")}
                  type="button"
                >
                  ×
                </button>
              ) : null}
            </label>

            <ReviewFiltersFields
              filters={mobileFilters}
              referenceData={referenceData}
              onChange={handleMobileFilterChange}
            />
          </div>

          <footer className="reviews-filter-drawer-actions">
            <button className="secondary-button" type="button" onClick={resetMobileFilters}>
              Сбросить
            </button>
            <button className="primary-button" type="button" onClick={applyMobileFilters}>
              Применить
            </button>
          </footer>
        </aside>
      </div>
    </section>
  );
}

export function ReviewDetailPage() {
  const { reviewId } = useParams();
  const navigate = useNavigate();
  const { token } = useAuth();
  const { notify } = useNotifications();
  const [referenceData, setReferenceData] = useState<ReviewReferenceData | null>(null);
  const [review, setReview] = useState<ReviewDetail | null>(null);
  const [responseText, setResponseText] = useState("");
  const [editForm, setEditForm] = useState<ReviewFormState>(emptyReviewForm);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isSavingResponse, setIsSavingResponse] = useState(false);
  const [isChangingStatus, setIsChangingStatus] = useState(false);
  const [isChangingAssignee, setIsChangingAssignee] = useState(false);

  const numericReviewId = Number(reviewId);

  const loadReview = useCallback(async () => {
    if (!token || !numericReviewId) {
      setError("Отзыв не найден.");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    try {
      const [reviewResponse, referenceResponse] = await Promise.all([
        apiClient.getReview(token, numericReviewId),
        apiClient.getReviewReferenceData(token),
      ]);
      setReview(reviewResponse);
      setReferenceData(referenceResponse);
      setResponseText(reviewResponse.response?.response_text || "");
      setError(null);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось загрузить карточку отзыва.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [numericReviewId, token]);

  useEffect(() => {
    loadReview();
  }, [loadReview]);

  const openEditModal = () => {
    if (!review) {
      return;
    }

    setEditForm({
      productId: String(review.product.id),
      sourceId: String(review.source.id),
      reviewText: review.review_text,
      rating: String(review.rating),
      reviewDate: review.review_date,
      externalId: review.external_id || "",
    });
    setIsEditModalOpen(true);
  };

  const closeEditModal = () => {
    if (!isSavingEdit) {
      setIsEditModalOpen(false);
      setEditForm(emptyReviewForm);
    }
  };

  const handleEditFieldChange = (field: ReviewFormField, value: string) => {
    setEditForm((current) => ({ ...current, [field]: value }));
  };

  const handleEditSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!token || !review) {
      return;
    }

    const payload = validateReviewForm(editForm, notify);
    if (!payload) {
      return;
    }

    setIsSavingEdit(true);

    try {
      const updatedReview = await apiClient.updateReview(token, review.id, payload);
      setReview(updatedReview);
      setResponseText(updatedReview.response?.response_text || "");
      setIsEditModalOpen(false);
      notify({
        type: "success",
        title: "Успешное действие",
        message: "Отзыв успешно обновлен.",
      });
    } catch (requestError) {
      notify({
        type: "error",
        title: "Ошибка сохранения",
        message:
          requestError instanceof Error
            ? requestError.message
            : "Не удалось обновить отзыв.",
      });
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleStatusChange = async (statusId: string) => {
    if (!token || !review || !statusId || Number(statusId) === review.status.id) {
      return;
    }

    setIsChangingStatus(true);

    try {
      const updatedReview = await apiClient.changeReviewStatus(
        token,
        review.id,
        Number(statusId),
      );
      setReview(updatedReview);
      notify({
        type: "success",
        title: "Успешное действие",
        message: "Статус отзыва изменен.",
      });
    } catch (requestError) {
      notify({
        type: "error",
        title: "Ошибка смены статуса",
        message:
          requestError instanceof Error
            ? requestError.message
            : "Не удалось изменить статус.",
      });
    } finally {
      setIsChangingStatus(false);
    }
  };

  const handleAssigneeChange = async (assignedUserId: string) => {
    if (!token || !review) {
      return;
    }

    const nextAssignedUserId = assignedUserId ? Number(assignedUserId) : null;
    if ((review.assigned_user?.id || null) === nextAssignedUserId) {
      return;
    }

    setIsChangingAssignee(true);

    try {
      const updatedReview = await apiClient.assignReviewUser(
        token,
        review.id,
        nextAssignedUserId,
      );
      setReview(updatedReview);
      notify({
        type: "success",
        title: "Успешное действие",
        message: nextAssignedUserId
          ? "Ответственный назначен."
          : "Ответственный снят.",
      });
    } catch (requestError) {
      notify({
        type: "error",
        title: "Ошибка назначения",
        message:
          requestError instanceof Error
            ? requestError.message
            : "Не удалось изменить ответственного.",
      });
    } finally {
      setIsChangingAssignee(false);
    }
  };

  const handleResponseSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!token || !review) {
      return;
    }

    const normalizedResponse = responseText.trim();
    if (!normalizedResponse) {
      notify({
        type: "error",
        title: "Ошибка сохранения",
        message: "Нельзя отправить пустой ответ на отзыв.",
      });
      return;
    }

    setIsSavingResponse(true);

    try {
      const updatedReview = await apiClient.saveReviewResponse(
        token,
        review.id,
        normalizedResponse,
      );
      setReview(updatedReview);
      setResponseText(updatedReview.response?.response_text || "");
      notify({
        type: "success",
        title: "Успешное действие",
        message: "Ответ на отзыв сохранен.",
      });
    } catch (requestError) {
      notify({
        type: "error",
        title: "Ошибка сохранения",
        message:
          requestError instanceof Error
            ? requestError.message
            : "Не удалось сохранить ответ.",
      });
    } finally {
      setIsSavingResponse(false);
    }
  };

  const sortedStatusHistory = useMemo(
    () =>
      [...(review?.status_history || [])].sort(
        (first, second) =>
          new Date(second.changed_at).getTime() - new Date(first.changed_at).getTime(),
      ),
    [review?.status_history],
  );
  const sortedAssignmentHistory = useMemo(
    () =>
      [...(review?.assignment_history || [])].sort(
        (first, second) =>
          new Date(second.assigned_at).getTime() - new Date(first.assigned_at).getTime(),
      ),
    [review?.assignment_history],
  );
  const combinedHistory = useMemo<CombinedHistoryItem[]>(() => {
    const statusItems = sortedStatusHistory.map((historyItem) => ({
      id: `status-${historyItem.id}`,
      occurredAt: historyItem.changed_at,
      title: `${historyItem.from_status?.name || "Создан"} → ${
        historyItem.to_status.name
      }`,
      description: `${formatDateTime(historyItem.changed_at)}, ${
        historyItem.changed_by_user.full_name
      }`,
    }));
    const assignmentItems = sortedAssignmentHistory.map((historyItem) => ({
      id: `assignment-${historyItem.id}`,
      occurredAt: historyItem.assigned_at,
      title: `Ответственный: ${historyItem.assigned_user.full_name}`,
      description: `Назначил ${historyItem.assigned_by_user.full_name}, ${formatDateTime(
        historyItem.assigned_at,
      )}`,
      extra: historyItem.unassigned_at
        ? `Снято ${formatDateTime(historyItem.unassigned_at)}`
        : undefined,
    }));

    return [...statusItems, ...assignmentItems].sort(
      (first, second) =>
        new Date(second.occurredAt).getTime() - new Date(first.occurredAt).getTime(),
    );
  }, [sortedAssignmentHistory, sortedStatusHistory]);

  if (isLoading) {
    return <p className="users-state">Загружаем карточку отзыва...</p>;
  }

  if (error || !review || !referenceData) {
    return <p className="users-state users-state--error">{error || "Отзыв не найден."}</p>;
  }

  return (
    <section className="review-detail-page">
      <div className="review-detail-actions">
        <button className="review-back-button" type="button" onClick={() => navigate("/reviews")}>
          <img src="/images/icons/arrow-left.svg" alt="" aria-hidden="true" />
          <span>Вернуться к списку</span>
        </button>
        <button
          className="primary-button users-add-button review-edit-button"
          type="button"
          onClick={openEditModal}
        >
          Редактировать
        </button>
      </div>

      <section className="review-detail-section review-info-section">
        <header className="review-section-header">
          <h2>Основная информация</h2>
        </header>

        <div className="review-info-layout">
          <dl className="review-info-grid">
            <div>
              <dt>ID</dt>
              <dd>{review.external_id || review.id}</dd>
            </div>
            <div>
              <dt>Оценка</dt>
              <dd>{formatRating(review.rating)}</dd>
            </div>
            <div>
              <dt>Товар</dt>
              <dd>{review.product.name}</dd>
            </div>
            <div>
              <dt>Источник</dt>
              <dd>{review.source.name}</dd>
            </div>
            <div>
              <dt>Статус</dt>
              <dd>{review.status.name}</dd>
            </div>
            <div>
              <dt>Дата</dt>
              <dd>{formatDate(review.review_date)}</dd>
            </div>
            <div>
              <dt>Ответственный</dt>
              <dd>{review.assigned_user?.full_name || "Не назначен"}</dd>
            </div>
          </dl>

          <div className="review-text-box">{review.review_text}</div>
        </div>
      </section>

      <section className="review-detail-section">
        <h2>Управление обработкой</h2>
        <div className="review-management-grid">
          <label>
            <span>Изменить ответственного</span>
            <select
              disabled={isChangingAssignee}
              value={review.assigned_user?.id || ""}
              onChange={(event) => handleAssigneeChange(event.target.value)}
            >
              <option value="">Все</option>
              {referenceData.users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.full_name}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Изменить статус</span>
            <select
              disabled={isChangingStatus}
              value={review.status.id}
              onChange={(event) => handleStatusChange(event.target.value)}
            >
              {referenceData.statuses.map((statusItem) => (
                <option key={statusItem.id} value={statusItem.id}>
                  {statusItem.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="review-detail-section">
        <h2>Ответ на отзыв</h2>
        <form className="review-response-form" onSubmit={handleResponseSubmit}>
          <label>
            <span className="sr-only">Текст ответа</span>
            <textarea
              placeholder="Текст ответа..."
              value={responseText}
              onChange={(event) => setResponseText(event.target.value)}
            />
          </label>
          <button className="primary-button review-response-button" disabled={isSavingResponse} type="submit">
            {isSavingResponse ? "Отправляем..." : "Отправить"}
          </button>
        </form>
      </section>

      <section className="review-detail-section">
        <h2>История изменений</h2>
        <div className="review-history-grid">
          <HistoryList title="Статусы">
            {sortedStatusHistory.length > 0 ? (
              sortedStatusHistory.map((historyItem) => (
                <li key={historyItem.id}>
                  <strong>
                    {historyItem.from_status?.name || "Создан"} → {historyItem.to_status.name}
                  </strong>
                  <span>
                    {formatDateTime(historyItem.changed_at)},{" "}
                    {historyItem.changed_by_user.full_name}
                  </span>
                </li>
              ))
            ) : (
              <li>История статусов пока пуста.</li>
            )}
          </HistoryList>

          <HistoryList title="Назначения">
            {sortedAssignmentHistory.length > 0 ? (
              sortedAssignmentHistory.map((historyItem) => (
                <li key={historyItem.id}>
                  <strong>{historyItem.assigned_user.full_name}</strong>
                  <span>
                    Назначил {historyItem.assigned_by_user.full_name},{" "}
                    {formatDateTime(historyItem.assigned_at)}
                  </span>
                  {historyItem.unassigned_at ? (
                    <span>Снято {formatDateTime(historyItem.unassigned_at)}</span>
                  ) : null}
                </li>
              ))
            ) : (
              <li>История назначений пока пуста.</li>
            )}
          </HistoryList>
        </div>
        <ul className="review-history-mobile-list">
          {combinedHistory.length > 0 ? (
            combinedHistory.map((historyItem) => (
              <li key={historyItem.id}>
                <strong>{historyItem.title}</strong>
                <span>{historyItem.description}</span>
                {historyItem.extra ? <span>{historyItem.extra}</span> : null}
              </li>
            ))
          ) : (
            <li>История изменений пока пуста.</li>
          )}
        </ul>
      </section>

      {isEditModalOpen ? (
        <ReviewFormModal
          form={editForm}
          isSaving={isSavingEdit}
          referenceData={referenceData}
          submitText="Сохранить"
          title="Изменить отзыв"
          onChange={handleEditFieldChange}
          onClose={closeEditModal}
          onSubmit={handleEditSubmit}
        />
      ) : null}
    </section>
  );
}

function ReviewFormModal({
  form,
  isSaving,
  referenceData,
  submitText,
  title,
  onChange,
  onClose,
  onSubmit,
}: {
  form: ReviewFormState;
  isSaving: boolean;
  referenceData: ReviewReferenceData;
  submitText: string;
  title: string;
  onChange: (field: ReviewFormField, value: string) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="modal-overlay" role="presentation" onMouseDown={onClose}>
      <form
        className="user-modal review-modal"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={onSubmit}
      >
        <header className="modal-header">
          <h2>{title}</h2>
          <button
            aria-label="Закрыть окно"
            className="notice-close"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </header>

        <div className="modal-body review-modal-body">
          <label>
            <span>Внешний ID</span>
            <input
              placeholder="Необязательно"
              type="text"
              value={form.externalId}
              onChange={(event) => onChange("externalId", event.target.value)}
            />
          </label>

          <label>
            <span>
              Товар<span className="required-mark">*</span>
            </span>
            <select
              value={form.productId}
              onChange={(event) => onChange("productId", event.target.value)}
            >
              <option value="">Выбрать товар</option>
              {referenceData.products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          </label>

          <label className="review-modal-textarea">
            <span>
              Текст отзыва<span className="required-mark">*</span>
            </span>
            <textarea
              placeholder="Текст отзыва..."
              value={form.reviewText}
              onChange={(event) => onChange("reviewText", event.target.value)}
            />
          </label>

          <div className="review-form-row">
            <label>
              <span>
                Оценка<span className="required-mark">*</span>
              </span>
              <select
                value={form.rating}
                onChange={(event) => onChange("rating", event.target.value)}
              >
                <option value="">Все</option>
                {[1, 2, 3, 4, 5].map((rating) => (
                  <option key={rating} value={rating}>
                    {rating}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>
                Источник<span className="required-mark">*</span>
              </span>
              <select
                value={form.sourceId}
                onChange={(event) => onChange("sourceId", event.target.value)}
              >
                <option value="">Все</option>
                {referenceData.sources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>
                Дата<span className="required-mark">*</span>
              </span>
              <input
                type="date"
                value={form.reviewDate}
                onChange={(event) => onChange("reviewDate", event.target.value)}
              />
            </label>
          </div>
        </div>

        <footer className="modal-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            Отменить
          </button>
          <button className="primary-button" disabled={isSaving} type="submit">
            {isSaving ? "Сохраняем..." : submitText}
          </button>
        </footer>
      </form>
    </div>
  );
}

function ReviewFiltersFields({
  filters,
  referenceData,
  onChange,
}: {
  filters: ReviewFilters;
  referenceData: ReviewReferenceData | null;
  onChange: (field: keyof ReviewFilters, value: string) => void;
}) {
  return (
    <>
      <FilterSelect
        label="Товары"
        value={filters.productId}
        onChange={(value) => onChange("productId", value)}
      >
        <option value="">Все</option>
        {referenceData?.products.map((product) => (
          <option key={product.id} value={product.id}>
            {product.name}
          </option>
        ))}
      </FilterSelect>

      <FilterSelect
        label="Статус"
        value={filters.statusId}
        onChange={(value) => onChange("statusId", value)}
      >
        <option value="">Все</option>
        {referenceData?.statuses.map((statusItem) => (
          <option key={statusItem.id} value={statusItem.id}>
            {statusItem.name}
          </option>
        ))}
      </FilterSelect>

      <FilterSelect
        label="Оценка"
        value={filters.rating}
        onChange={(value) => onChange("rating", value)}
      >
        <option value="">Все</option>
        {[1, 2, 3, 4, 5].map((rating) => (
          <option key={rating} value={rating}>
            {rating}
          </option>
        ))}
      </FilterSelect>

      <FilterSelect
        label="Источник"
        value={filters.sourceId}
        onChange={(value) => onChange("sourceId", value)}
      >
        <option value="">Все</option>
        {referenceData?.sources.map((source) => (
          <option key={source.id} value={source.id}>
            {source.name}
          </option>
        ))}
      </FilterSelect>

      <FilterSelect
        label="Ответственный"
        value={filters.assignedUserId}
        onChange={(value) => onChange("assignedUserId", value)}
      >
        <option value="">Все</option>
        {referenceData?.users.map((user) => (
          <option key={user.id} value={user.id}>
            {user.full_name}
          </option>
        ))}
      </FilterSelect>

      <label className="reviews-filter-field">
        <span>Дата с</span>
        <input
          type="date"
          value={filters.dateFrom}
          onChange={(event) => onChange("dateFrom", event.target.value)}
        />
      </label>

      <label className="reviews-filter-field">
        <span>Дата по</span>
        <input
          type="date"
          value={filters.dateTo}
          onChange={(event) => onChange("dateTo", event.target.value)}
        />
      </label>
    </>
  );
}

function FilterSelect({
  children,
  label,
  value,
  onChange,
}: {
  children: React.ReactNode;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="reviews-filter-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    </label>
  );
}

function ReviewsPagination({
  currentPage,
  totalPages,
  onPageChange,
}: {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) {
    return null;
  }

  const pages = Array.from({ length: totalPages }, (_, index) => index + 1);

  return (
    <nav className="users-pagination" aria-label="Пагинация отзывов">
      <button
        className="pagination-button"
        disabled={currentPage === 1}
        onClick={() => onPageChange(currentPage - 1)}
        type="button"
      >
        Назад
      </button>
      {pages.map((page) => (
        <button
          aria-current={page === currentPage ? "page" : undefined}
          className={`pagination-button ${page === currentPage ? "is-active" : ""}`}
          key={page}
          onClick={() => onPageChange(page)}
          type="button"
        >
          {page}
        </button>
      ))}
      <button
        className="pagination-button"
        disabled={currentPage === totalPages}
        onClick={() => onPageChange(currentPage + 1)}
        type="button"
      >
        Вперед
      </button>
    </nav>
  );
}

function HistoryList({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <div className="review-history-list">
      <h3>{title}</h3>
      <ul>{children}</ul>
    </div>
  );
}

function validateReviewForm(
  form: ReviewFormState,
  notify: ReturnType<typeof useNotifications>["notify"],
) {
  const productId = Number(form.productId);
  const sourceId = Number(form.sourceId);
  const rating = Number(form.rating);
  const reviewText = form.reviewText.trim();
  const reviewDate = form.reviewDate;
  const externalId = form.externalId.trim();

  if (!productId || !sourceId || !rating || !reviewText || !reviewDate) {
    notify({
      type: "error",
      title: "Ошибка сохранения",
      message: "Нельзя сохранить отзыв с незаполненными обязательными полями.",
    });
    return null;
  }

  if (rating < 1 || rating > 5) {
    notify({
      type: "error",
      title: "Ошибка сохранения",
      message: "Оценка должна быть от 1 до 5.",
    });
    return null;
  }

  return {
    product_id: productId,
    source_id: sourceId,
    review_text: reviewText,
    rating,
    review_date: reviewDate,
    external_id: externalId || null,
  };
}

function buildReviewListParams(filters: ReviewFilters, page: number): ReviewListParams {
  return {
    q: filters.q.trim() || undefined,
    product_id: filters.productId ? Number(filters.productId) : undefined,
    status_id: filters.statusId ? Number(filters.statusId) : undefined,
    source_id: filters.sourceId ? Number(filters.sourceId) : undefined,
    date_from: filters.dateFrom || undefined,
    date_to: filters.dateTo || undefined,
    rating: filters.rating ? Number(filters.rating) : undefined,
    assigned_user_id: filters.assignedUserId ? Number(filters.assignedUserId) : undefined,
    limit: REVIEWS_PER_PAGE,
    offset: (page - 1) * REVIEWS_PER_PAGE,
  };
}

function formatDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return dateFormatter.format(date);
}

function formatDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return dateTimeFormatter.format(date);
}

function formatRating(rating: number) {
  return `${rating} ${rating === 1 ? "звезда" : rating < 5 ? "звезды" : "звезд"}`;
}

function getTodayInputValue() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}
