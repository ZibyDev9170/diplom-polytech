import { FormEvent, useEffect, useMemo, useState } from "react";

import { ManagedUser, Role, apiClient } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useNotifications } from "../notifications/NotificationContext";

type UserModalMode = "create" | "edit";

type UserFormState = {
  fullName: string;
  email: string;
  password: string;
  roleId: string;
};

const emptyUserForm: UserFormState = {
  fullName: "",
  email: "",
  password: "",
  roleId: "",
};

const MOBILE_USERS_PER_PAGE = 10;
const DESKTOP_RESERVED_HEIGHT = 300;
const DESKTOP_ROW_HEIGHT = 53;
const MIN_DESKTOP_USERS_PER_PAGE = 5;
const MOBILE_VIEWPORT_QUERY = "(max-width: 760px)";

const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

function calculateUsersPerPage() {
  if (typeof window === "undefined") {
    return MOBILE_USERS_PER_PAGE;
  }

  if (window.matchMedia(MOBILE_VIEWPORT_QUERY).matches) {
    return MOBILE_USERS_PER_PAGE;
  }

  const availableTableHeight = window.innerHeight - DESKTOP_RESERVED_HEIGHT;

  return Math.max(
    MIN_DESKTOP_USERS_PER_PAGE,
    Math.floor(availableTableHeight / DESKTOP_ROW_HEIGHT),
  );
}

export function UsersPage() {
  const { token, user: currentUser } = useAuth();
  const { notify } = useNotifications();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalMode, setModalMode] = useState<UserModalMode | null>(null);
  const [editingUser, setEditingUser] = useState<ManagedUser | null>(null);
  const [form, setForm] = useState<UserFormState>(emptyUserForm);
  const [isSaving, setIsSaving] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [usersPerPage, setUsersPerPage] = useState(calculateUsersPerPage);
  const [isMobileCreateOpen, setIsMobileCreateOpen] = useState(false);
  const [mobileCreateForm, setMobileCreateForm] = useState<UserFormState>(emptyUserForm);
  const [expandedMobileUserId, setExpandedMobileUserId] = useState<number | null>(null);
  const [mobileEditForm, setMobileEditForm] = useState<UserFormState>(emptyUserForm);
  const [isMobileCreateSaving, setIsMobileCreateSaving] = useState(false);
  const [mobileSavingUserId, setMobileSavingUserId] = useState<number | null>(null);

  useEffect(() => {
    if (!token) {
      setIsLoading(false);
      setError("Не удалось получить токен авторизации.");
      return;
    }

    let isMounted = true;

    Promise.all([apiClient.getUsers(token), apiClient.getRoles(token)])
      .then(([usersResponse, rolesResponse]) => {
        if (!isMounted) {
          return;
        }

        setUsers(usersResponse);
        setRoles(rolesResponse);
        setError(null);
      })
      .catch((requestError: Error) => {
        if (isMounted) {
          setError(requestError.message);
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [token]);

  const isModalOpen = modalMode !== null;
  const modalTitle = modalMode === "edit" ? "Изменить пользователя" : "Создать пользователя";
  const sortedUsers = useMemo(
    () => [...users].sort((first, second) => first.id - second.id),
    [users],
  );
  const totalPages = Math.max(1, Math.ceil(sortedUsers.length / usersPerPage));
  const paginatedUsers = useMemo(() => {
    const startIndex = (currentPage - 1) * usersPerPage;

    return sortedUsers.slice(startIndex, startIndex + usersPerPage);
  }, [currentPage, sortedUsers, usersPerPage]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  useEffect(() => {
    const updateUsersPerPage = () => {
      setUsersPerPage(calculateUsersPerPage());
    };

    updateUsersPerPage();
    window.addEventListener("resize", updateUsersPerPage);

    return () => {
      window.removeEventListener("resize", updateUsersPerPage);
    };
  }, []);

  const openCreateModal = () => {
    setEditingUser(null);
    setForm(emptyUserForm);
    setModalMode("create");
  };

  const openEditModal = (selectedUser: ManagedUser) => {
    setEditingUser(selectedUser);
    setForm({
      fullName: selectedUser.full_name,
      email: selectedUser.email,
      password: "",
      roleId: String(selectedUser.role.id),
    });
    setModalMode("edit");
  };

  const closeModal = () => {
    if (isSaving) {
      return;
    }

    resetModal();
  };

  const resetModal = () => {
    setModalMode(null);
    setEditingUser(null);
    setForm(emptyUserForm);
  };

  const validateUserForm = (sourceForm: UserFormState, mode: UserModalMode) => {
    const fullName = sourceForm.fullName.trim();
    const email = sourceForm.email.trim();
    const password = sourceForm.password.trim();
    const roleId = Number(sourceForm.roleId);

    if (!fullName || !email || !roleId || (mode === "create" && !password)) {
      notify({
        type: "error",
        title: "Ошибка сохранения",
        message: "Нельзя сохранить пользователя с незаполненными полями.",
      });
      return null;
    }

    if (mode === "create" && password.length < 8) {
      notify({
        type: "error",
        title: "Ошибка сохранения",
        message: "Пароль должен содержать минимум 8 символов.",
      });
      return null;
    }

    return { fullName, email, password, roleId };
  };

  const handleFormSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!token || !modalMode) {
      return;
    }

    const validatedForm = validateUserForm(form, modalMode);

    if (!validatedForm) {
      return;
    }

    setIsSaving(true);

    try {
      if (modalMode === "create") {
        const createdUser = await apiClient.createUser(token, {
          full_name: validatedForm.fullName,
          email: validatedForm.email,
          password: validatedForm.password,
          role_id: validatedForm.roleId,
        });
        setUsers((current) => [...current, createdUser]);
        setCurrentPage(Math.ceil((users.length + 1) / usersPerPage));
        notify({
          type: "success",
          title: "Успешное действие",
          message: "Пользователь успешно создан.",
        });
      } else if (editingUser) {
        const updatedUser = await apiClient.updateUser(token, editingUser.id, {
          full_name: validatedForm.fullName,
          email: validatedForm.email,
          role_id: validatedForm.roleId,
        });
        replaceUser(updatedUser);
        notify({
          type: "success",
          title: "Успешное действие",
          message: "Пользователь успешно обновлен.",
        });
      }

      resetModal();
    } catch (requestError) {
      notify({
        type: "error",
        title: "Ошибка сохранения",
        message:
          requestError instanceof Error
            ? requestError.message
            : "Не удалось сохранить пользователя.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const openMobileCreateForm = () => {
    setExpandedMobileUserId(null);
    setMobileEditForm(emptyUserForm);
    setMobileCreateForm(emptyUserForm);
    setIsMobileCreateOpen((current) => !current);
  };

  const toggleMobileUser = (selectedUser: ManagedUser) => {
    setIsMobileCreateOpen(false);

    if (expandedMobileUserId === selectedUser.id) {
      setExpandedMobileUserId(null);
      return;
    }

    setExpandedMobileUserId(selectedUser.id);
    setMobileEditForm({
      fullName: selectedUser.full_name,
      email: selectedUser.email,
      password: "",
      roleId: String(selectedUser.role.id),
    });
  };

  const handleMobileCreateSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!token) {
      return;
    }

    const validatedForm = validateUserForm(mobileCreateForm, "create");

    if (!validatedForm) {
      return;
    }

    setIsMobileCreateSaving(true);

    try {
      const createdUser = await apiClient.createUser(token, {
        full_name: validatedForm.fullName,
        email: validatedForm.email,
        password: validatedForm.password,
        role_id: validatedForm.roleId,
      });
      setUsers((current) => [...current, createdUser]);
      setCurrentPage(Math.ceil((users.length + 1) / usersPerPage));
      setMobileCreateForm(emptyUserForm);
      setIsMobileCreateOpen(false);
      setExpandedMobileUserId(createdUser.id);
      setMobileEditForm({
        fullName: createdUser.full_name,
        email: createdUser.email,
        password: "",
        roleId: String(createdUser.role.id),
      });
      notify({
        type: "success",
        title: "Успешное действие",
        message: "Пользователь успешно создан.",
      });
    } catch (requestError) {
      notify({
        type: "error",
        title: "Ошибка сохранения",
        message:
          requestError instanceof Error
            ? requestError.message
            : "Не удалось сохранить пользователя.",
      });
    } finally {
      setIsMobileCreateSaving(false);
    }
  };

  const handleMobileUpdateSubmit = async (
    event: FormEvent<HTMLFormElement>,
    selectedUser: ManagedUser,
  ) => {
    event.preventDefault();

    if (!token) {
      return;
    }

    const validatedForm = validateUserForm(mobileEditForm, "edit");

    if (!validatedForm) {
      return;
    }

    setMobileSavingUserId(selectedUser.id);

    try {
      const updatedUser = await apiClient.updateUser(token, selectedUser.id, {
        full_name: validatedForm.fullName,
        email: validatedForm.email,
        role_id: validatedForm.roleId,
      });
      replaceUser(updatedUser);
      setMobileEditForm({
        fullName: updatedUser.full_name,
        email: updatedUser.email,
        password: "",
        roleId: String(updatedUser.role.id),
      });
      notify({
        type: "success",
        title: "Успешное действие",
        message: "Пользователь успешно обновлен.",
      });
    } catch (requestError) {
      notify({
        type: "error",
        title: "Ошибка сохранения",
        message:
          requestError instanceof Error
            ? requestError.message
            : "Не удалось сохранить пользователя.",
      });
    } finally {
      setMobileSavingUserId(null);
    }
  };

  const handleToggleBlock = async (selectedUser: ManagedUser) => {
    if (!token) {
      return;
    }

    try {
      const updatedUser = selectedUser.is_active
        ? await apiClient.blockUser(token, selectedUser.id)
        : await apiClient.unblockUser(token, selectedUser.id);

      replaceUser(updatedUser);
      notify({
        type: "success",
        title: "Успешное действие",
        message: selectedUser.is_active
          ? "Пользователь заблокирован."
          : "Пользователь разблокирован.",
      });
    } catch (requestError) {
      notify({
        type: "error",
        title: "Ошибка изменения статуса",
        message:
          requestError instanceof Error
            ? requestError.message
            : "Не удалось изменить статус пользователя.",
      });
    }
  };

  const replaceUser = (updatedUser: ManagedUser) => {
    setUsers((current) =>
      current.map((user) => (user.id === updatedUser.id ? updatedUser : user)),
    );
  };

  const handlePageChange = (nextPage: number) => {
    setCurrentPage(nextPage);
    setIsMobileCreateOpen(false);
    setExpandedMobileUserId(null);
    setMobileCreateForm(emptyUserForm);
    setMobileEditForm(emptyUserForm);
  };

  return (
    <section className="users-page">
      <div className="users-toolbar">
        <p className="eyebrow">Управление пользователями системы</p>

        <button
          className="primary-button users-add-button users-add-button--desktop"
          type="button"
          onClick={openCreateModal}
        >
          Добавить пользователя
        </button>
        <button
          className="primary-button users-add-button users-add-button--mobile"
          type="button"
          onClick={openMobileCreateForm}
        >
          {isMobileCreateOpen ? "Скрыть форму" : "Добавить пользователя"}
        </button>
      </div>

      <div className="users-table-panel">
        {isLoading ? (
          <p className="users-state">Загружаем пользователей...</p>
        ) : error ? (
          <p className="users-state users-state--error">{error}</p>
        ) : (
          <div className="users-table-scroll">
            <table className="users-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>ФИО</th>
                  <th>Email</th>
                  <th>Роль</th>
                  <th>Статус</th>
                  <th>Дата создания</th>
                  <th>Действия</th>
                </tr>
              </thead>
              <tbody>
                {sortedUsers.length > 0 ? (
                  paginatedUsers.map((managedUser) => (
                    <tr key={managedUser.id}>
                      <td>{managedUser.id}</td>
                      <td>{managedUser.full_name}</td>
                      <td>{managedUser.email}</td>
                      <td>{managedUser.role.name}</td>
                      <td>
                        <span
                          className={`status-badge ${
                            managedUser.is_active
                              ? "status-badge--active"
                              : "status-badge--blocked"
                          }`}
                        >
                          {managedUser.is_active ? "Активен" : "Заблокирован"}
                        </span>
                      </td>
                      <td>{formatDate(managedUser.created_at)}</td>
                      <td>
                        <div className="table-actions">
                          <button
                            aria-label="Редактировать пользователя"
                            className="icon-button"
                            onClick={() => openEditModal(managedUser)}
                            type="button"
                          >
                            <img src="/images/icons/edit.svg" alt="" aria-hidden="true" />
                          </button>
                          <button
                            aria-label={
                              managedUser.is_active
                                ? "Заблокировать пользователя"
                                : "Разблокировать пользователя"
                            }
                            className="icon-button"
                            disabled={managedUser.id === currentUser?.id}
                            onClick={() => handleToggleBlock(managedUser)}
                            title={
                              managedUser.id === currentUser?.id
                                ? "Нельзя заблокировать текущего пользователя"
                                : undefined
                            }
                            type="button"
                          >
                            <img
                              src={
                                managedUser.is_active
                                  ? "/images/icons/lock.svg"
                                  : "/images/icons/unlock.svg"
                              }
                              alt=""
                              aria-hidden="true"
                            />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7}>Пользователи пока не добавлены.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="users-mobile-list">
        {isLoading ? (
          <p className="users-state">Загружаем пользователей...</p>
        ) : error ? (
          <p className="users-state users-state--error">{error}</p>
        ) : (
          <>
            {isMobileCreateOpen ? (
              <form
                className="mobile-user-card mobile-user-card--create"
                onSubmit={handleMobileCreateSubmit}
              >
                <p className="mobile-card-title">Создать пользователя</p>
                <div className="mobile-card-form">
                  <label>
                    <span>
                      ФИО<span className="required-mark">*</span>
                    </span>
                    <input
                      value={mobileCreateForm.fullName}
                      onChange={(event) =>
                        setMobileCreateForm((current) => ({
                          ...current,
                          fullName: event.target.value,
                        }))
                      }
                      type="text"
                    />
                  </label>
                  <label>
                    <span>
                      Email<span className="required-mark">*</span>
                    </span>
                    <input
                      value={mobileCreateForm.email}
                      onChange={(event) =>
                        setMobileCreateForm((current) => ({
                          ...current,
                          email: event.target.value,
                        }))
                      }
                      type="email"
                    />
                  </label>
                  <label>
                    <span>
                      Пароль<span className="required-mark">*</span>
                    </span>
                    <input
                      value={mobileCreateForm.password}
                      onChange={(event) =>
                        setMobileCreateForm((current) => ({
                          ...current,
                          password: event.target.value,
                        }))
                      }
                      type="password"
                    />
                  </label>
                  <label>
                    <span>
                      Роль<span className="required-mark">*</span>
                    </span>
                    <select
                      value={mobileCreateForm.roleId}
                      onChange={(event) =>
                        setMobileCreateForm((current) => ({
                          ...current,
                          roleId: event.target.value,
                        }))
                      }
                    >
                      <option value="">Выберите роль</option>
                      {roles.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <footer className="mobile-card-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => {
                      setIsMobileCreateOpen(false);
                      setMobileCreateForm(emptyUserForm);
                    }}
                  >
                    Отменить
                  </button>
                  <button
                    className="primary-button"
                    disabled={isMobileCreateSaving}
                    type="submit"
                  >
                    {isMobileCreateSaving ? "Добавляем..." : "Добавить"}
                  </button>
                </footer>
              </form>
            ) : null}

            {paginatedUsers.length > 0 ? (
              paginatedUsers.map((managedUser) => {
                const isExpanded = expandedMobileUserId === managedUser.id;

                return (
                  <article
                    className={`mobile-user-card ${isExpanded ? "is-expanded" : ""}`}
                    key={managedUser.id}
                  >
                    <div className="mobile-user-summary">
                      <button
                        className="mobile-user-summary-trigger"
                        onClick={() => toggleMobileUser(managedUser)}
                        type="button"
                      >
                        <span>ID {managedUser.id}</span>
                        <strong>{managedUser.full_name}</strong>
                        <span>{managedUser.email}</span>
                      </button>
                      <button
                        aria-label={
                          managedUser.is_active
                            ? "Заблокировать пользователя"
                            : "Разблокировать пользователя"
                        }
                        className="icon-button mobile-summary-lock"
                        disabled={managedUser.id === currentUser?.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          handleToggleBlock(managedUser);
                        }}
                        type="button"
                      >
                        <img
                          src={
                            managedUser.is_active
                              ? "/images/icons/lock.svg"
                              : "/images/icons/unlock.svg"
                          }
                          alt=""
                          aria-hidden="true"
                        />
                      </button>
                    </div>

                    <div className="mobile-user-card-panel">
                      <form
                        aria-hidden={!isExpanded}
                        className="mobile-user-card-content"
                        onSubmit={(event) => handleMobileUpdateSubmit(event, managedUser)}
                      >
                        <div className="mobile-card-details">
                          <div>
                            <span>Дата создания</span>
                            <strong>{formatDate(managedUser.created_at)}</strong>
                          </div>
                          <div>
                            <span>Статус</span>
                            <span
                              className={`status-badge ${
                                managedUser.is_active
                                  ? "status-badge--active"
                                  : "status-badge--blocked"
                              }`}
                            >
                              {managedUser.is_active ? "Активен" : "Заблокирован"}
                            </span>
                          </div>
                        </div>

                        <div className="mobile-card-form">
                          <label>
                            <span>
                              ФИО<span className="required-mark">*</span>
                            </span>
                            <input
                              disabled={!isExpanded}
                              value={isExpanded ? mobileEditForm.fullName : managedUser.full_name}
                              onChange={(event) =>
                                setMobileEditForm((current) => ({
                                  ...current,
                                  fullName: event.target.value,
                                }))
                              }
                              type="text"
                            />
                          </label>
                          <label>
                            <span>
                              Email<span className="required-mark">*</span>
                            </span>
                            <input
                              disabled={!isExpanded}
                              value={isExpanded ? mobileEditForm.email : managedUser.email}
                              onChange={(event) =>
                                setMobileEditForm((current) => ({
                                  ...current,
                                  email: event.target.value,
                                }))
                              }
                              type="email"
                            />
                          </label>
                          <label>
                            <span>
                              Роль<span className="required-mark">*</span>
                            </span>
                            <select
                              disabled={!isExpanded}
                              value={
                                isExpanded ? mobileEditForm.roleId : String(managedUser.role.id)
                              }
                              onChange={(event) =>
                                setMobileEditForm((current) => ({
                                  ...current,
                                  roleId: event.target.value,
                                }))
                              }
                            >
                              <option value="">Выберите роль</option>
                              {roles.map((role) => (
                                <option key={role.id} value={role.id}>
                                  {role.name}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>

                        <footer className="mobile-card-actions">
                          <button
                            className="secondary-button"
                            disabled={!isExpanded}
                            type="button"
                            onClick={() => toggleMobileUser(managedUser)}
                          >
                            Отменить
                          </button>
                          <button
                            className="primary-button"
                            disabled={!isExpanded || mobileSavingUserId === managedUser.id}
                            type="submit"
                          >
                            {mobileSavingUserId === managedUser.id
                              ? "Сохраняем..."
                              : "Сохранить"}
                          </button>
                        </footer>
                      </form>
                    </div>
                  </article>
                );
              })
            ) : (
              <p className="users-state">Пользователи пока не добавлены.</p>
            )}
          </>
        )}
      </div>

      {!isLoading && !error ? (
        <UsersPagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={handlePageChange}
        />
      ) : null}

      {isModalOpen ? (
        <div className="modal-overlay" role="presentation" onMouseDown={closeModal}>
          <form
            className="user-modal"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={handleFormSubmit}
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
              <label>
                <span>
                  ФИО<span className="required-mark">*</span>
                </span>
                <input
                  value={form.fullName}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, fullName: event.target.value }))
                  }
                  type="text"
                />
              </label>
              <label>
                <span>
                  Email<span className="required-mark">*</span>
                </span>
                <input
                  value={form.email}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, email: event.target.value }))
                  }
                  type="email"
                />
              </label>
              {modalMode === "create" ? (
                <label>
                  <span>
                    Пароль<span className="required-mark">*</span>
                  </span>
                  <input
                    value={form.password}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, password: event.target.value }))
                    }
                    type="password"
                  />
                </label>
              ) : null}
              <label>
                <span>
                  Роль<span className="required-mark">*</span>
                </span>
                <select
                  value={form.roleId}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, roleId: event.target.value }))
                  }
                >
                  <option value="">Выберите роль</option>
                  {roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </select>
              </label>
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

function UsersPagination({
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
    <nav className="users-pagination" aria-label="Пагинация пользователей">
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

function formatDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return dateFormatter.format(date);
}
