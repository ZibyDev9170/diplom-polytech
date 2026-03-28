"""Initial migration scaffold.

Revision ID: 202604180001
Revises:
Create Date: 2026-04-18
"""

from alembic import op

revision = "202604180001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Business tables will be added in the next feature migrations.
    pass


def downgrade() -> None:
    pass
