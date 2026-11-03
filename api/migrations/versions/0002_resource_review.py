"""Add human-reviewed resource discovery records."""
from alembic import op
import sqlalchemy as sa

revision = "0002_resource_review"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade():
    existing = sa.inspect(op.get_bind())
    if existing.has_table("curated_resources"):
        curated_columns = {column["name"] for column in existing.get_columns("curated_resources")}
        if "clinic_approved" not in curated_columns:
            op.add_column(
                "curated_resources",
                sa.Column("clinic_approved", sa.Boolean(), nullable=False, server_default=sa.false()),
            )
        if "clinic_approval_evidence" not in curated_columns:
            op.add_column(
                "curated_resources",
                sa.Column("clinic_approval_evidence", sa.Text(), nullable=False, server_default=sa.text("''")),
            )
    if not existing.has_table("resource_candidates"):
        op.create_table(
            "resource_candidates",
            sa.Column("id", sa.String(length=100), primary_key=True),
            sa.Column("title", sa.String(length=240), nullable=False),
            sa.Column("source_name", sa.String(length=160), nullable=False),
            sa.Column("source_url", sa.Text(), nullable=False, unique=True),
            sa.Column("discovered_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("link_status", sa.String(length=80), nullable=False),
            sa.Column("access_status", sa.String(length=80), nullable=False),
            sa.Column("license_info", sa.String(length=500), nullable=False),
            sa.Column("age_range", sa.String(length=120), nullable=False),
            sa.Column("mat_relevance", sa.Text(), nullable=False),
            sa.Column("safety_notes", sa.Text(), nullable=False),
            sa.Column("review_notes", sa.Text(), nullable=False),
            sa.Column("status", sa.String(length=20), nullable=False),
            sa.Column("clinic_approved", sa.Boolean(), nullable=False),
            sa.Column("clinic_approval_evidence", sa.Text(), nullable=False),
            sa.Column("reviewer_role", sa.String(length=120), nullable=True),
            sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        )
    if not existing.has_table("resource_discovery_runs"):
        op.create_table(
            "resource_discovery_runs",
            sa.Column("run_date", sa.String(length=10), primary_key=True),
            sa.Column("request_count", sa.Integer(), nullable=False),
        )


def downgrade():
    op.drop_table("resource_discovery_runs")
    op.drop_table("resource_candidates")
