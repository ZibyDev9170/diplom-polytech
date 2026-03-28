import { useEffect, useState } from "react";

import { HealthResponse, apiClient } from "../api/client";

export function DashboardPage() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .getHealth()
      .then((data) => {
        setHealth(data);
        setError(null);
      })
      .catch((requestError: Error) => {
        setHealth(null);
        setError(requestError.message);
      });
  }, []);

  return (
    <section className="page">
      <p className="eyebrow">Review Management System</p>
      <h1>Панель управления отзывами</h1>
      <p className="lead">
        Каркас готов для модулей авторизации, отзывов, аналитики и интеграций.
      </p>

      <div className="status-panel">
        <h2>Связь с API</h2>
        {health ? (
          <dl className="status-grid">
            <div>
              <dt>Backend</dt>
              <dd>{health.status}</dd>
            </div>
            <div>
              <dt>База данных</dt>
              <dd>{health.database}</dd>
            </div>
            <div>
              <dt>Сервис</dt>
              <dd>{health.service}</dd>
            </div>
          </dl>
        ) : (
          <p className="muted">
            {error
              ? `Не удалось получить /health: ${error}`
              : "Проверяем доступность backend..."}
          </p>
        )}
      </div>
    </section>
  );
}
