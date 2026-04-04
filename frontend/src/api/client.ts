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

export type LoginResponse = {
  access_token: string;
  token_type: "bearer";
  expires_in: number;
  user: CurrentUser;
};

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

async function getErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown };

    if (typeof body.detail === "string") {
      return body.detail;
    }
  } catch {
    return `Request failed with status ${response.status}`;
  }

  return `Request failed with status ${response.status}`;
}

export const apiClient = {
  getHealth: () => request<HealthResponse>("/health"),
  login: (email: string, password: string) =>
    request<LoginResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  getCurrentUser: (token: string) => request<CurrentUser>("/auth/me", { token }),
};
