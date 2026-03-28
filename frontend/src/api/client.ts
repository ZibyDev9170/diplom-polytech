const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api/v1";

export type HealthResponse = {
  status: string;
  service: string;
  database: string;
};

async function request<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`);

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export const apiClient = {
  getHealth: () => request<HealthResponse>("/health"),
};
