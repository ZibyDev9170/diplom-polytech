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
};
