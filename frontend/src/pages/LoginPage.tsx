import { FormEvent, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";

import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useNotifications } from "../notifications/NotificationContext";

type LocationState = {
  from?: {
    pathname?: string;
  };
};

type AuthNotice = {
  type: "error";
  title: string;
  message: string;
};

export function LoginPage() {
  const { user, login } = useAuth();
  const { notify } = useNotifications();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as LocationState | null;
  const redirectPath = state?.from?.pathname || "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState<AuthNotice | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (user) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    setIsSubmitting(true);

    try {
      await login(email, password);
      notify({
        type: "success",
        title: "Успешное действие",
        message: "Вход выполнен успешно.",
      });
      navigate(redirectPath, { replace: true });
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.status === 423) {
        setNotice({
          type: "error",
          title: "Ошибка",
          message: "Слишком много попыток входа. Попробуйте через 10 минут.",
        });
      } else if (requestError instanceof ApiError) {
        setNotice({
          type: "error",
          title: "Ошибка",
          message: "Проверьте почту и пароль.",
        });
      } else {
        setNotice({
          type: "error",
          title: "Ошибка",
          message: "Не удалось выполнить вход.",
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleCloseNotice() {
    setNotice(null);
  }

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <div className="auth-header">
          <img
            className="auth-logo"
            src="/images/icons/logo.svg"
            alt=""
            aria-hidden="true"
          />
          <h1>ReviewManager</h1>
          <p>Вход в систему</p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label>
            <span>Почта</span>
            <input
              autoComplete="email"
              disabled={isSubmitting}
              name="email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="example@mail.ru"
              required
              type="email"
              value={email}
            />
          </label>

          <label>
            <span>Пароль</span>
            <input
              autoComplete="current-password"
              disabled={isSubmitting}
              name="password"
              onChange={(event) => setPassword(event.target.value)}
              placeholder="********"
              required
              type="password"
              value={password}
            />
          </label>

          {notice ? (
            <div className={`notice-card notice-card--${notice.type}`} role="alert">
              <header className="notice-header">
                <h2>{notice.title}</h2>
                <button
                  aria-label="Закрыть уведомление"
                  className="notice-close"
                  onClick={handleCloseNotice}
                  type="button"
                >
                  ×
                </button>
              </header>
              <p>{notice.message}</p>
            </div>
          ) : null}

          <button className="primary-button" disabled={isSubmitting} type="submit">
            {isSubmitting ? "Входим..." : "Войти"}
          </button>
        </form>
      </section>
    </main>
  );
}
