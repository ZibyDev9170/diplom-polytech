"""Create domain schemas and review management tables.

Revision ID: 202604180002
Revises: 202604180001
Create Date: 2026-04-18
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "202604180002"
down_revision = "202604180001"
branch_labels = None
depends_on = None


BATCH_STATUSES = "'pending', 'running', 'completed', 'failed', 'partially_completed'"
ITEM_STATUSES = "'pending', 'success', 'failed', 'skipped'"


def upgrade() -> None:
    create_schemas()
    create_auth_tables()
    create_catalog_tables()
    create_review_tables()
    create_audit_tables()
    create_integration_tables()
    create_indexes()
    seed_reference_data()
    create_materialized_views()


def downgrade() -> None:
    op.execute("DROP MATERIALIZED VIEW IF EXISTS analytics.mv_status_distribution")
    op.execute("DROP MATERIALIZED VIEW IF EXISTS analytics.mv_reviews_dynamics")
    op.execute("DROP MATERIALIZED VIEW IF EXISTS analytics.mv_product_rating_summary")

    op.drop_table("import_items", schema="integration")
    op.drop_table("import_batches", schema="integration")
    op.drop_table("audit_logs", schema="audit")
    op.drop_table("review_responses", schema="reviews")
    op.drop_table("review_status_history", schema="reviews")
    op.drop_table("review_assignments", schema="reviews")
    op.drop_table("reviews", schema="reviews")
    op.drop_table("allowed_status_transitions", schema="catalog")
    op.drop_table("review_statuses", schema="catalog")
    op.drop_table("review_sources", schema="catalog")
    op.drop_table("products", schema="catalog")
    op.drop_table("login_attempts", schema="auth")
    op.drop_table("users", schema="auth")
    op.drop_table("roles", schema="auth")

    for schema in ("analytics", "integration", "audit", "reviews", "catalog", "auth"):
        op.execute(sa.text(f"DROP SCHEMA IF EXISTS {schema} CASCADE"))


def create_schemas() -> None:
    for schema in ("auth", "catalog", "reviews", "audit", "integration", "analytics"):
        op.execute(sa.text(f"CREATE SCHEMA IF NOT EXISTS {schema}"))


def create_auth_tables() -> None:
    op.create_table(
        "roles",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("code", sa.String(length=50), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_auth_roles"),
        sa.UniqueConstraint("code", name="uq_auth_roles_code"),
        sa.CheckConstraint("length(trim(code)) > 0", name="ck_auth_roles_code_not_blank"),
        sa.CheckConstraint("length(trim(name)) > 0", name="ck_auth_roles_name_not_blank"),
        schema="auth",
    )

    op.create_table(
        "users",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("full_name", sa.String(length=255), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("role_id", sa.BigInteger(), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column(
            "failed_login_attempts",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column("blocked_until", postgresql.TIMESTAMP(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_auth_users"),
        sa.ForeignKeyConstraint(["role_id"], ["auth.roles.id"], name="fk_auth_users_role_id"),
        sa.UniqueConstraint("email", name="uq_auth_users_email"),
        sa.CheckConstraint(
            "failed_login_attempts >= 0",
            name="ck_auth_users_failed_login_attempts_non_negative",
        ),
        schema="auth",
    )

    op.create_table(
        "login_attempts",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "attempt_time",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("is_success", sa.Boolean(), nullable=False),
        sa.Column("ip_address", postgresql.INET(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_auth_login_attempts"),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["auth.users.id"],
            name="fk_auth_login_attempts_user_id",
        ),
        schema="auth",
    )


def create_catalog_tables() -> None:
    op.create_table(
        "products",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("sku", sa.String(length=100), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column(
            "created_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_catalog_products"),
        sa.UniqueConstraint("sku", name="uq_catalog_products_sku"),
        sa.CheckConstraint(
            "length(trim(name)) > 0",
            name="ck_catalog_products_name_not_blank",
        ),
        sa.CheckConstraint("length(trim(sku)) > 0", name="ck_catalog_products_sku_not_blank"),
        schema="catalog",
    )

    op.create_table(
        "review_sources",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("code", sa.String(length=50), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_catalog_review_sources"),
        sa.UniqueConstraint("code", name="uq_catalog_review_sources_code"),
        sa.CheckConstraint(
            "length(trim(code)) > 0",
            name="ck_catalog_review_sources_code_not_blank",
        ),
        sa.CheckConstraint(
            "length(trim(name)) > 0",
            name="ck_catalog_review_sources_name_not_blank",
        ),
        schema="catalog",
    )

    op.create_table(
        "review_statuses",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("code", sa.String(length=50), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("sort_order", sa.SmallInteger(), nullable=False),
        sa.Column("is_terminal", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_catalog_review_statuses"),
        sa.UniqueConstraint("code", name="uq_catalog_review_statuses_code"),
        sa.CheckConstraint(
            "length(trim(code)) > 0",
            name="ck_catalog_review_statuses_code_not_blank",
        ),
        sa.CheckConstraint(
            "length(trim(name)) > 0",
            name="ck_catalog_review_statuses_name_not_blank",
        ),
        sa.CheckConstraint(
            "sort_order >= 0",
            name="ck_catalog_review_statuses_sort_order_non_negative",
        ),
        schema="catalog",
    )

    op.create_table(
        "allowed_status_transitions",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("from_status_id", sa.BigInteger(), nullable=False),
        sa.Column("to_status_id", sa.BigInteger(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_catalog_allowed_status_transitions"),
        sa.ForeignKeyConstraint(
            ["from_status_id"],
            ["catalog.review_statuses.id"],
            name="fk_catalog_allowed_status_transitions_from_status_id",
        ),
        sa.ForeignKeyConstraint(
            ["to_status_id"],
            ["catalog.review_statuses.id"],
            name="fk_catalog_allowed_status_transitions_to_status_id",
        ),
        sa.UniqueConstraint(
            "from_status_id",
            "to_status_id",
            name="uq_catalog_allowed_status_transitions_from_to",
        ),
        sa.CheckConstraint(
            "from_status_id <> to_status_id",
            name="ck_catalog_allowed_status_transitions_not_same_status",
        ),
        schema="catalog",
    )


def create_review_tables() -> None:
    op.create_table(
        "reviews",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("external_id", sa.String(length=255), nullable=True),
        sa.Column("product_id", sa.BigInteger(), nullable=False),
        sa.Column("source_id", sa.BigInteger(), nullable=False),
        sa.Column("review_text", sa.Text(), nullable=False),
        sa.Column("rating", sa.SmallInteger(), nullable=False),
        sa.Column("review_date", sa.Date(), nullable=False),
        sa.Column("status_id", sa.BigInteger(), nullable=False),
        sa.Column("assigned_user_id", sa.BigInteger(), nullable=True),
        sa.Column("created_by_user_id", sa.BigInteger(), nullable=True),
        sa.Column("updated_by_user_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "created_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_reviews_reviews"),
        sa.ForeignKeyConstraint(
            ["product_id"],
            ["catalog.products.id"],
            name="fk_reviews_reviews_product_id",
        ),
        sa.ForeignKeyConstraint(
            ["source_id"],
            ["catalog.review_sources.id"],
            name="fk_reviews_reviews_source_id",
        ),
        sa.ForeignKeyConstraint(
            ["status_id"],
            ["catalog.review_statuses.id"],
            name="fk_reviews_reviews_status_id",
        ),
        sa.ForeignKeyConstraint(
            ["assigned_user_id"],
            ["auth.users.id"],
            name="fk_reviews_reviews_assigned_user_id",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"],
            ["auth.users.id"],
            name="fk_reviews_reviews_created_by_user_id",
        ),
        sa.ForeignKeyConstraint(
            ["updated_by_user_id"],
            ["auth.users.id"],
            name="fk_reviews_reviews_updated_by_user_id",
        ),
        sa.UniqueConstraint(
            "source_id",
            "external_id",
            name="uq_reviews_reviews_source_external_id",
        ),
        sa.CheckConstraint("rating BETWEEN 1 AND 5", name="ck_reviews_reviews_rating_range"),
        sa.CheckConstraint(
            "length(trim(review_text)) > 0",
            name="ck_reviews_reviews_review_text_not_blank",
        ),
        schema="reviews",
    )

    op.create_table(
        "review_assignments",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("review_id", sa.BigInteger(), nullable=False),
        sa.Column("assigned_user_id", sa.BigInteger(), nullable=False),
        sa.Column("assigned_by_user_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "assigned_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("unassigned_at", postgresql.TIMESTAMP(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_reviews_review_assignments"),
        sa.ForeignKeyConstraint(
            ["review_id"],
            ["reviews.reviews.id"],
            name="fk_reviews_review_assignments_review_id",
        ),
        sa.ForeignKeyConstraint(
            ["assigned_user_id"],
            ["auth.users.id"],
            name="fk_reviews_review_assignments_assigned_user_id",
        ),
        sa.ForeignKeyConstraint(
            ["assigned_by_user_id"],
            ["auth.users.id"],
            name="fk_reviews_review_assignments_assigned_by_user_id",
        ),
        sa.CheckConstraint(
            "unassigned_at IS NULL OR unassigned_at >= assigned_at",
            name="ck_reviews_review_assignments_unassigned_after_assigned",
        ),
        schema="reviews",
    )

    op.create_table(
        "review_status_history",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("review_id", sa.BigInteger(), nullable=False),
        sa.Column("from_status_id", sa.BigInteger(), nullable=True),
        sa.Column("to_status_id", sa.BigInteger(), nullable=False),
        sa.Column("changed_by_user_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "changed_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_reviews_review_status_history"),
        sa.ForeignKeyConstraint(
            ["review_id"],
            ["reviews.reviews.id"],
            name="fk_reviews_review_status_history_review_id",
        ),
        sa.ForeignKeyConstraint(
            ["from_status_id"],
            ["catalog.review_statuses.id"],
            name="fk_reviews_review_status_history_from_status_id",
        ),
        sa.ForeignKeyConstraint(
            ["to_status_id"],
            ["catalog.review_statuses.id"],
            name="fk_reviews_review_status_history_to_status_id",
        ),
        sa.ForeignKeyConstraint(
            ["changed_by_user_id"],
            ["auth.users.id"],
            name="fk_reviews_review_status_history_changed_by_user_id",
        ),
        sa.CheckConstraint(
            "from_status_id IS NULL OR from_status_id <> to_status_id",
            name="ck_reviews_review_status_history_status_changed",
        ),
        schema="reviews",
    )

    op.create_table(
        "review_responses",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("review_id", sa.BigInteger(), nullable=False),
        sa.Column("response_text", sa.Text(), nullable=False),
        sa.Column("created_by_user_id", sa.BigInteger(), nullable=False),
        sa.Column("updated_by_user_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "created_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_reviews_review_responses"),
        sa.ForeignKeyConstraint(
            ["review_id"],
            ["reviews.reviews.id"],
            name="fk_reviews_review_responses_review_id",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"],
            ["auth.users.id"],
            name="fk_reviews_review_responses_created_by_user_id",
        ),
        sa.ForeignKeyConstraint(
            ["updated_by_user_id"],
            ["auth.users.id"],
            name="fk_reviews_review_responses_updated_by_user_id",
        ),
        sa.UniqueConstraint("review_id", name="uq_reviews_review_responses_review_id"),
        sa.CheckConstraint(
            "length(trim(response_text)) > 0",
            name="ck_reviews_review_responses_response_text_not_blank",
        ),
        schema="reviews",
    )


def create_audit_tables() -> None:
    op.create_table(
        "audit_logs",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("entity_type", sa.String(length=100), nullable=False),
        sa.Column("entity_id", sa.BigInteger(), nullable=False),
        sa.Column("action", sa.String(length=50), nullable=False),
        sa.Column("old_values_json", postgresql.JSONB(), nullable=True),
        sa.Column("new_values_json", postgresql.JSONB(), nullable=True),
        sa.Column(
            "created_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_audit_logs"),
        sa.ForeignKeyConstraint(["user_id"], ["auth.users.id"], name="fk_audit_logs_user_id"),
        sa.CheckConstraint(
            "length(trim(entity_type)) > 0",
            name="ck_audit_logs_entity_type_not_blank",
        ),
        sa.CheckConstraint("entity_id > 0", name="ck_audit_logs_entity_id_positive"),
        sa.CheckConstraint("length(trim(action)) > 0", name="ck_audit_logs_action_not_blank"),
        schema="audit",
    )


def create_integration_tables() -> None:
    op.create_table(
        "import_batches",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("source_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "started_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("finished_at", postgresql.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("total_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("success_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("failed_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_integration_import_batches"),
        sa.ForeignKeyConstraint(
            ["source_id"],
            ["catalog.review_sources.id"],
            name="fk_integration_import_batches_source_id",
        ),
        sa.CheckConstraint(
            f"status IN ({BATCH_STATUSES})",
            name="ck_integration_import_batches_status",
        ),
        sa.CheckConstraint(
            "total_count >= 0",
            name="ck_integration_import_batches_total_count_non_negative",
        ),
        sa.CheckConstraint(
            "success_count >= 0",
            name="ck_integration_import_batches_success_count_non_negative",
        ),
        sa.CheckConstraint(
            "failed_count >= 0",
            name="ck_integration_import_batches_failed_count_non_negative",
        ),
        sa.CheckConstraint(
            "success_count + failed_count <= total_count",
            name="ck_integration_import_batches_counts_not_greater_total",
        ),
        sa.CheckConstraint(
            "finished_at IS NULL OR finished_at >= started_at",
            name="ck_integration_import_batches_finished_after_started",
        ),
        schema="integration",
    )

    op.create_table(
        "import_items",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("batch_id", sa.BigInteger(), nullable=False),
        sa.Column("external_review_id", sa.String(length=255), nullable=False),
        sa.Column("payload_json", postgresql.JSONB(), nullable=False),
        sa.Column("import_status", sa.String(length=50), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_integration_import_items"),
        sa.ForeignKeyConstraint(
            ["batch_id"],
            ["integration.import_batches.id"],
            name="fk_integration_import_items_batch_id",
        ),
        sa.UniqueConstraint(
            "batch_id",
            "external_review_id",
            name="uq_integration_import_items_batch_external_review_id",
        ),
        sa.CheckConstraint(
            "length(trim(external_review_id)) > 0",
            name="ck_integration_import_items_external_review_id_not_blank",
        ),
        sa.CheckConstraint(
            f"import_status IN ({ITEM_STATUSES})",
            name="ck_integration_import_items_import_status",
        ),
        schema="integration",
    )


def create_indexes() -> None:
    op.create_index("ix_auth_users_email", "users", ["email"], schema="auth")
    op.create_index(
        "ix_reviews_reviews_product_id",
        "reviews",
        ["product_id"],
        schema="reviews",
    )
    op.create_index(
        "ix_reviews_reviews_status_id",
        "reviews",
        ["status_id"],
        schema="reviews",
    )
    op.create_index(
        "ix_reviews_reviews_review_date",
        "reviews",
        ["review_date"],
        schema="reviews",
    )
    op.create_index("ix_reviews_reviews_rating", "reviews", ["rating"], schema="reviews")
    op.create_index(
        "ix_reviews_reviews_assigned_user_id",
        "reviews",
        ["assigned_user_id"],
        schema="reviews",
    )


def seed_reference_data() -> None:
    op.execute(
        """
        INSERT INTO auth.roles (code, name, description)
        VALUES
            ('admin', 'Администратор', 'Полный доступ к системе и настройкам'),
            ('manager', 'Менеджер', 'Контроль обработки отзывов и назначений'),
            ('support', 'Специалист поддержки', 'Работа с отзывами и ответами'),
            ('analyst', 'Аналитик', 'Просмотр аналитики и отчетов')
        ON CONFLICT (code) DO NOTHING;
        """
    )

    op.execute(
        """
        INSERT INTO catalog.review_statuses (code, name, sort_order, is_terminal)
        VALUES
            ('new', 'Новый', 10, false),
            ('in_progress', 'В работе', 20, false),
            ('response_required', 'Требует ответа', 30, false),
            ('answered', 'Ответ опубликован', 40, false),
            ('closed', 'Закрыт', 50, true),
            ('rejected', 'Отклонен', 60, true)
        ON CONFLICT (code) DO NOTHING;
        """
    )

    op.execute(
        """
        INSERT INTO catalog.review_sources (code, name)
        VALUES
            ('website', 'Сайт интернет-магазина'),
            ('marketplace', 'Маркетплейс'),
            ('api', 'Внешний API'),
            ('manual', 'Ручной ввод')
        ON CONFLICT (code) DO NOTHING;
        """
    )

    op.execute(
        """
        INSERT INTO catalog.allowed_status_transitions (from_status_id, to_status_id)
        SELECT from_status.id, to_status.id
        FROM (
            VALUES
                ('new', 'in_progress'),
                ('new', 'rejected'),
                ('in_progress', 'response_required'),
                ('in_progress', 'closed'),
                ('response_required', 'answered'),
                ('answered', 'closed')
        ) AS transition(from_code, to_code)
        JOIN catalog.review_statuses AS from_status ON from_status.code = transition.from_code
        JOIN catalog.review_statuses AS to_status ON to_status.code = transition.to_code
        ON CONFLICT (from_status_id, to_status_id) DO NOTHING;
        """
    )


def create_materialized_views() -> None:
    op.execute(
        """
        CREATE MATERIALIZED VIEW analytics.mv_product_rating_summary AS
        SELECT
            p.id AS product_id,
            p.name AS product_name,
            count(r.id)::bigint AS reviews_count,
            coalesce(round(avg(r.rating)::numeric, 2), 0)::numeric(3, 2) AS average_rating,
            count(r.id) FILTER (WHERE r.rating <= 2)::bigint AS negative_reviews_count
        FROM catalog.products AS p
        LEFT JOIN reviews.reviews AS r ON r.product_id = p.id
        GROUP BY p.id, p.name;
        """
    )

    op.execute(
        """
        CREATE UNIQUE INDEX ux_analytics_mv_product_rating_summary_product_id
        ON analytics.mv_product_rating_summary (product_id);
        """
    )

    op.execute(
        """
        CREATE MATERIALIZED VIEW analytics.mv_reviews_dynamics AS
        SELECT
            r.review_date AS review_day,
            count(r.id)::bigint AS reviews_count,
            round(avg(r.rating)::numeric, 2)::numeric(3, 2) AS average_rating
        FROM reviews.reviews AS r
        GROUP BY r.review_date;
        """
    )

    op.execute(
        """
        CREATE UNIQUE INDEX ux_analytics_mv_reviews_dynamics_review_day
        ON analytics.mv_reviews_dynamics (review_day);
        """
    )

    op.execute(
        """
        CREATE MATERIALIZED VIEW analytics.mv_status_distribution AS
        SELECT
            s.id AS status_id,
            s.name AS status_name,
            count(r.id)::bigint AS reviews_count,
            coalesce(
                round(
                    count(r.id)::numeric * 100 / nullif(sum(count(r.id)) OVER (), 0),
                    2
                ),
                0
            )::numeric(5, 2) AS share_percent
        FROM catalog.review_statuses AS s
        LEFT JOIN reviews.reviews AS r ON r.status_id = s.id
        GROUP BY s.id, s.name;
        """
    )

    op.execute(
        """
        CREATE UNIQUE INDEX ux_analytics_mv_status_distribution_status_id
        ON analytics.mv_status_distribution (status_id);
        """
    )
