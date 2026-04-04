import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

type NotificationType = "success" | "error" | "info";

type Notification = {
  id: number;
  type: NotificationType;
  title: string;
  message: string;
};

type NotificationInput = Omit<Notification, "id">;

type NotificationContextValue = {
  notify: (notification: NotificationInput) => void;
  closeNotification: (id: number) => void;
};

const NotificationContext = createContext<NotificationContextValue | null>(null);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const closeNotification = useCallback((id: number) => {
    setNotifications((current) =>
      current.filter((notification) => notification.id !== id),
    );
  }, []);

  const notify = useCallback(
    (notification: NotificationInput) => {
      const id = Date.now() + Math.random();
      setNotifications((current) => [...current, { ...notification, id }]);

      window.setTimeout(() => {
        closeNotification(id);
      }, 5000);
    },
    [closeNotification],
  );

  const value = useMemo(
    () => ({
      notify,
      closeNotification,
    }),
    [closeNotification, notify],
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}
      <div className="notification-viewport" aria-live="polite">
        {notifications.map((notification) => (
          <NotificationCard
            key={notification.id}
            notification={notification}
            onClose={() => closeNotification(notification.id)}
          />
        ))}
      </div>
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationContext);

  if (!context) {
    throw new Error("useNotifications must be used inside NotificationProvider");
  }

  return context;
}

function NotificationCard({
  notification,
  onClose,
}: {
  notification: Notification;
  onClose: () => void;
}) {
  return (
    <article className={`notice-card notice-card--${notification.type}`}>
      <header className="notice-header">
        <h2>{notification.title}</h2>
        <button
          aria-label="Закрыть уведомление"
          className="notice-close"
          onClick={onClose}
          type="button"
        >
          ×
        </button>
      </header>
      <p>{notification.message}</p>
    </article>
  );
}
