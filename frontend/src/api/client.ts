const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api/v1";

export type RoleCode = "admin" | "manager" | "support" | "analyst" | string;

export type HealthResponse = {
  status: string;
  service: string;
  database: string;
};

export type Role = {
  id: number;
  code: RoleCode;
  name: string;
};

export type CurrentUser = {
  id: number;
  full_name: string;
  email: string;
  role: Role;
  is_active: boolean;
};

export type ManagedUser = CurrentUser & {
  blocked_until: string | null;
  created_at: string;
  updated_at: string;
};

export type Product = {
  id: number;
  name: string;
  sku: string;
  is_active: boolean;
};

export type CatalogProduct = Product & {
  created_at: string;
};

export type ReviewSource = {
  id: number;
  code: string;
  name: string;
};

export type ReviewStatus = {
  id: number;
  code: string;
  name: string;
  sort_order: number;
  is_terminal: boolean;
};

export type ReviewUser = {
  id: number;
  full_name: string;
  email: string;
  role: Role | null;
};

export type ReviewListItem = {
  id: number;
  external_id: string | null;
  product: Product;
  source: ReviewSource;
  review_text: string;
  rating: number;
  review_date: string;
  status: ReviewStatus;
  assigned_user: ReviewUser | null;
  created_at: string;
  updated_at: string;
};

export type ReviewResponseInfo = {
  id: number;
  review_id: number;
  response_text: string;
  created_by_user: ReviewUser;
  updated_by_user: ReviewUser;
  created_at: string;
  updated_at: string;
};

export type ReviewStatusHistoryItem = {
  id: number;
  from_status: ReviewStatus | null;
  to_status: ReviewStatus;
  changed_by_user: ReviewUser;
  changed_at: string;
  comment: string | null;
};

export type ReviewAssignmentHistoryItem = {
  id: number;
  assigned_user: ReviewUser;
  assigned_by_user: ReviewUser;
  assigned_at: string;
  unassigned_at: string | null;
};

export type ReviewDetail = ReviewListItem & {
  created_by_user: ReviewUser | null;
  updated_by_user: ReviewUser;
  response: ReviewResponseInfo | null;
  status_history: ReviewStatusHistoryItem[];
  assignment_history: ReviewAssignmentHistoryItem[];
};

export type ReviewListResponse = {
  items: ReviewListItem[];
  total: number;
  limit: number;
  offset: number;
};

export type ReviewReferenceData = {
  products: Product[];
  statuses: ReviewStatus[];
  sources: ReviewSource[];
  users: ReviewUser[];
};

export type AnalyticsSummary = {
  average_rating: number;
  total_reviews: number;
  negative_reviews_count: number;
  negative_share_percent: number;
};

export type AnalyticsDynamicsItem = {
  review_day: string;
  reviews_count: number;
  average_rating: number;
  products: DynamicsProductBreakdown[];
};

export type DynamicsProductBreakdown = {
  product_id: number;
  product_name: string;
  reviews_count: number;
};

export type AnalyticsProductSummary = {
  product_id: number;
  product_name: string;
  reviews_count: number;
  average_rating: number;
  negative_reviews_count: number;
  negative_share_percent: number;
  rating_distribution: RatingDistributionItem[];
};

export type RatingDistributionItem = {
  rating: number;
  reviews_count: number;
};

export type AnalyticsProductDetail = {
  product: Product;
  summary: AnalyticsSummary;
  rating_distribution: RatingDistributionItem[];
};

export type ExternalReviewPayloadItem = {
  external_id: string;
  product_sku?: string;
  product_name?: string;
  review_text: string;
  rating: number;
  review_date: string;
  source_payload?: Record<string, unknown>;
};

export type ExternalReviewsPayload = {
  source_code: string;
  reviews: ExternalReviewPayloadItem[];
};

export type ImportItem = {
  id: number;
  external_review_id: string;
  import_status: "success" | "failed" | "skipped" | "pending" | string;
  error_message: string | null;
  payload_json: Record<string, unknown>;
  created_at: string;
};

export type ImportBatch = {
  id: number;
  source: ReviewSource;
  started_at: string;
  finished_at: string | null;
  status: string;
  total_count: number;
  success_count: number;
  failed_count: number;
  skipped_count: number;
  items: ImportItem[];
};

export type LoginResponse = {
  access_token: string;
  token_type: "bearer";
  expires_in: number;
  user: CurrentUser;
};

export type CreateUserPayload = {
  full_name: string;
  email: string;
  password: string;
  role_id: number;
};

export type UpdateUserPayload = {
  full_name: string;
  email: string;
  role_id: number;
};

export type UpdateUserRolePayload = {
  role_id: number;
};

export type ReviewListParams = {
  q?: string;
  product_id?: number;
  status_id?: number;
  source_id?: number;
  date_from?: string;
  date_to?: string;
  rating?: number;
  assigned_user_id?: number;
  limit?: number;
  offset?: number;
};

export type AnalyticsParams = {
  product_id?: number;
  date_from?: string;
  date_to?: string;
};

export type PerekrestokImportParams = {
  offset?: number;
  limit?: number;
};

export type ImportBatchListParams = {
  offset?: number;
  limit?: number;
};

export type CreateReviewPayload = {
  product_id: number;
  source_id: number;
  review_text: string;
  rating: number;
  review_date: string;
  external_id?: string | null;
  assigned_user_id?: number | null;
};

export type UpdateReviewPayload = {
  product_id?: number;
  source_id?: number;
  review_text?: string;
  rating?: number;
  review_date?: string;
  external_id?: string | null;
};

export type CreateProductPayload = {
  name: string;
  sku: string;
  is_active: boolean;
};

export type UpdateProductPayload = Partial<CreateProductPayload>;

export type CreateReviewSourcePayload = {
  code: string;
  name: string;
};

export type UpdateReviewSourcePayload = Partial<CreateReviewSourcePayload>;

export type CreateReviewStatusPayload = {
  code: string;
  name: string;
  sort_order: number;
  is_terminal: boolean;
};

export type UpdateReviewStatusPayload = Partial<CreateReviewStatusPayload>;

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type RequestOptions = RequestInit & {
  token?: string | null;
};

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { token, headers, ...fetchOptions } = options;
  const requestHeaders = new Headers(headers);

  if (!requestHeaders.has("Content-Type") && fetchOptions.body) {
    requestHeaders.set("Content-Type", "application/json");
  }

  if (token) {
    requestHeaders.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...fetchOptions,
    headers: requestHeaders,
  });

  if (!response.ok) {
    throw new ApiError(response.status, await getErrorMessage(response));
  }

  return response.json() as Promise<T>;
}

async function requestBlob(path: string, options: RequestOptions = {}): Promise<Blob> {
  const { token, headers, ...fetchOptions } = options;
  const requestHeaders = new Headers(headers);

  if (token) {
    requestHeaders.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...fetchOptions,
    headers: requestHeaders,
  });

  if (!response.ok) {
    throw new ApiError(response.status, await getErrorMessage(response));
  }

  return response.blob();
}

function buildQueryString<T extends object>(params: T) {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }

    searchParams.set(key, String(value));
  });

  const queryString = searchParams.toString();

  return queryString ? `?${queryString}` : "";
}

async function getErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {
      detail?: unknown;
      errors?: unknown;
    };

    if (typeof body.detail === "string") {
      if (Array.isArray(body.errors) && body.errors.length > 0) {
        return `${body.detail}: ${body.errors.map(formatApiErrorItem).join("; ")}`;
      }

      return body.detail;
    }

    if (Array.isArray(body.detail) && body.detail.length > 0) {
      return body.detail.map(formatApiErrorItem).join("; ");
    }
  } catch {
    return `Request failed with status ${response.status}`;
  }

  return `Request failed with status ${response.status}`;
}

function formatApiErrorItem(error: unknown): string {
  if (!error || typeof error !== "object") {
    return String(error);
  }

  const errorRecord = error as Record<string, unknown>;
  const field = errorRecord.field ?? errorRecord.loc;
  const message = errorRecord.message ?? errorRecord.msg;

  if (field && message) {
    const normalizedField = Array.isArray(field) ? field.join(".") : String(field);

    return `${normalizedField}: ${String(message)}`;
  }

  if (message) {
    return String(message);
  }

  return JSON.stringify(errorRecord);
}

export const apiClient = {
  getHealth: () => request<HealthResponse>("/health"),
  login: (email: string, password: string) =>
    request<LoginResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  getCurrentUser: (token: string) => request<CurrentUser>("/auth/me", { token }),
  getRoles: (token: string) => request<Role[]>("/users/roles", { token }),
  getUsers: (token: string) => request<ManagedUser[]>("/users", { token }),
  createUser: (token: string, payload: CreateUserPayload) =>
    request<ManagedUser>("/users", {
      method: "POST",
      token,
      body: JSON.stringify(payload),
    }),
  updateUser: (token: string, userId: number, payload: UpdateUserPayload) =>
    request<ManagedUser>(`/users/${userId}`, {
      method: "PATCH",
      token,
      body: JSON.stringify(payload),
    }),
  updateUserRole: (token: string, userId: number, payload: UpdateUserRolePayload) =>
    request<ManagedUser>(`/users/${userId}/role`, {
      method: "PATCH",
      token,
      body: JSON.stringify(payload),
    }),
  blockUser: (token: string, userId: number) =>
    request<ManagedUser>(`/users/${userId}/block`, {
      method: "PATCH",
      token,
    }),
  unblockUser: (token: string, userId: number) =>
    request<ManagedUser>(`/users/${userId}/unblock`, {
      method: "PATCH",
      token,
    }),
  getReviewReferenceData: (token: string) =>
    request<ReviewReferenceData>("/reviews/reference-data", { token }),
  getReviews: (token: string, params: ReviewListParams = {}) =>
    request<ReviewListResponse>(`/reviews${buildQueryString(params)}`, { token }),
  getReview: (token: string, reviewId: number) =>
    request<ReviewDetail>(`/reviews/${reviewId}`, { token }),
  createReview: (token: string, payload: CreateReviewPayload) =>
    request<ReviewDetail>("/reviews", {
      method: "POST",
      token,
      body: JSON.stringify(payload),
    }),
  updateReview: (token: string, reviewId: number, payload: UpdateReviewPayload) =>
    request<ReviewDetail>(`/reviews/${reviewId}`, {
      method: "PATCH",
      token,
      body: JSON.stringify(payload),
    }),
  changeReviewStatus: (token: string, reviewId: number, statusId: number) =>
    request<ReviewDetail>(`/reviews/${reviewId}/status`, {
      method: "PATCH",
      token,
      body: JSON.stringify({ status_id: statusId }),
    }),
  assignReviewUser: (token: string, reviewId: number, assignedUserId: number | null) =>
    request<ReviewDetail>(`/reviews/${reviewId}/assignment`, {
      method: "PATCH",
      token,
      body: JSON.stringify({ assigned_user_id: assignedUserId }),
    }),
  saveReviewResponse: (token: string, reviewId: number, responseText: string) =>
    request<ReviewDetail>(`/reviews/${reviewId}/response`, {
      method: "PUT",
      token,
      body: JSON.stringify({ response_text: responseText }),
    }),
  getAnalyticsSummary: (token: string, params: AnalyticsParams = {}) =>
    request<AnalyticsSummary>(`/analytics/summary${buildQueryString(params)}`, {
      token,
    }),
  getAnalyticsDynamics: (token: string, params: AnalyticsParams = {}) =>
    request<AnalyticsDynamicsItem[]>(`/analytics/dynamics${buildQueryString(params)}`, {
      token,
    }),
  getAnalyticsProducts: (token: string, params: AnalyticsParams = {}) =>
    request<AnalyticsProductSummary[]>(`/analytics/products${buildQueryString(params)}`, {
      token,
    }),
  getAnalyticsProduct: (
    token: string,
    productId: number,
    params: Omit<AnalyticsParams, "product_id"> = {},
  ) =>
    request<AnalyticsProductDetail>(
      `/analytics/products/${productId}${buildQueryString(params)}`,
      { token },
    ),
  exportAnalyticsCsv: (token: string, params: AnalyticsParams = {}) =>
    requestBlob(`/analytics/export.csv${buildQueryString(params)}`, { token }),
  getPerekrestokPayload: (token: string, params: PerekrestokImportParams = {}) =>
    request<ExternalReviewsPayload>(
      `/integration/perekrestok/reviews/payload${buildQueryString(params)}`,
      { token },
    ),
  importPerekrestokReviews: (token: string, params: PerekrestokImportParams = {}) =>
    request<ImportBatch>(
      `/integration/perekrestok/reviews/import${buildQueryString(params)}`,
      {
        method: "POST",
        token,
      },
    ),
  getImportBatches: (token: string, params: ImportBatchListParams = {}) =>
    request<ImportBatch[]>(`/integration/import-batches${buildQueryString(params)}`, {
      token,
    }),
  getImportBatch: (token: string, batchId: number) =>
    request<ImportBatch>(`/integration/import-batches/${batchId}`, { token }),
  getCatalogProducts: (token: string) =>
    request<CatalogProduct[]>("/catalog/products", { token }),
  createCatalogProduct: (token: string, payload: CreateProductPayload) =>
    request<CatalogProduct>("/catalog/products", {
      method: "POST",
      token,
      body: JSON.stringify(payload),
    }),
  updateCatalogProduct: (token: string, productId: number, payload: UpdateProductPayload) =>
    request<CatalogProduct>(`/catalog/products/${productId}`, {
      method: "PATCH",
      token,
      body: JSON.stringify(payload),
    }),
  getCatalogReviewStatuses: (token: string) =>
    request<ReviewStatus[]>("/catalog/review-statuses", { token }),
  createCatalogReviewStatus: (token: string, payload: CreateReviewStatusPayload) =>
    request<ReviewStatus>("/catalog/review-statuses", {
      method: "POST",
      token,
      body: JSON.stringify(payload),
    }),
  updateCatalogReviewStatus: (
    token: string,
    statusId: number,
    payload: UpdateReviewStatusPayload,
  ) =>
    request<ReviewStatus>(`/catalog/review-statuses/${statusId}`, {
      method: "PATCH",
      token,
      body: JSON.stringify(payload),
    }),
  getCatalogReviewSources: (token: string) =>
    request<ReviewSource[]>("/catalog/review-sources", { token }),
  createCatalogReviewSource: (token: string, payload: CreateReviewSourcePayload) =>
    request<ReviewSource>("/catalog/review-sources", {
      method: "POST",
      token,
      body: JSON.stringify(payload),
    }),
  updateCatalogReviewSource: (
    token: string,
    sourceId: number,
    payload: UpdateReviewSourcePayload,
  ) =>
    request<ReviewSource>(`/catalog/review-sources/${sourceId}`, {
      method: "PATCH",
      token,
      body: JSON.stringify(payload),
    }),
};
