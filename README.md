# Review Management System

Веб-система для централизованного сбора, хранения, обработки и анализа отзывов о товарах.

## Стек

- Backend: FastAPI, SQLAlchemy, Alembic
- Frontend: React, TypeScript, Vite, React Router
- Database: PostgreSQL
- Infrastructure: Docker Compose

## Структура

```text
backend/   FastAPI-приложение, настройки БД, миграции Alembic
frontend/  React-приложение с роутингом и базовым layout
infra/     место для инфраструктурных файлов
```

## Быстрый старт

В текущей рабочей копии `.env` уже создан, поэтому проект запускается одной командой:

```bash
docker compose up --build
```

После нового клонирования сначала создайте `.env` из примера:

```bash
cp .env.example .env
docker compose up --build
```

После запуска:

- Frontend: http://localhost:5173
- Backend health: http://localhost:8000/health
- Backend API health: http://localhost:8000/api/v1/health
- Swagger: http://localhost:8000/docs
- PostgreSQL: `localhost:5433`

## Основные Docker-команды

Запустить проект в фоне:

```bash
docker compose up --build -d
```

Посмотреть состояние контейнеров:

```bash
docker compose ps
```

Посмотреть логи:

```bash
docker compose logs -f
```

Остановить контейнеры без удаления данных БД:

```bash
docker compose down
```

Остановить контейнеры и удалить данные БД:

```bash
docker compose down -v
```

## Проверка связи frontend -> backend

Внутри Docker-сети backend доступен по имени сервиса `backend`:

```bash
docker compose exec frontend node -e "fetch('http://backend:8000/health').then(r => r.text()).then(console.log)"
```

В браузере frontend обращается к API через базовый URL из `VITE_API_BASE_URL`.
По умолчанию это `/api/v1`, а Vite проксирует `/api` на backend.

## Миграции БД

Миграции применяются автоматически при старте backend-контейнера:

```bash
docker compose up backend
```

Создать новую миграцию:

```bash
docker compose exec backend alembic revision --autogenerate -m "add reviews"
```

Применить миграции вручную:

```bash
docker compose exec backend alembic upgrade head
```

## Аутентификация

Основные endpoint:

- `POST /api/v1/auth/login` — вход по email и паролю, ответ содержит JWT
- `GET /api/v1/auth/me` — текущий пользователь по Bearer-токену
- `GET /api/v1/auth/admin-check` — пример endpoint, защищенного ролью `admin`

Пароли хэшируются через bcrypt. После 5 неудачных попыток входа пользователь блокируется на 10 минут. Попытки входа для существующих пользователей записываются в `auth.login_attempts`.

Пользователи не добавляются в seed-данных. Сейчас seeded только роли, статусы, источники отзывов и допустимые переходы статусов.

## Безопасность

- Пароли пользователей хранятся только в виде bcrypt-хэшей.
- Все бизнес-endpoint требуют Bearer JWT, кроме `POST /api/v1/auth/login` и `/health`.
- Управление пользователями и ролями доступно только администратору.
- Отзывы доступны ролям `admin`, `manager`, `support`; аналитик не может открыть или изменить отзывы.
- Каталог и интеграции доступны ролям `admin` и `manager`.
- Аналитика доступна только ролям `admin` и `analyst`.
- CORS ограничивается списком `CORS_ORIGINS`; wildcard `*` намеренно не используется.
- Для production-контура можно включить `FORCE_HTTPS=true` и задать явный список `TRUSTED_HOSTS`.
- В целевом контуре frontend должен обращаться к API по относительному `/api/v1` или HTTPS URL.

## Локальная разработка без Docker

Backend:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

## Git

Основные ветки проекта:

- `main` — стабильная ветка
- `develop` — ветка активной разработки
