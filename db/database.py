import os
import streamlit as st
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

try:
    if "DATABASE_URL" in st.secrets:
        DATABASE_URL = st.secrets["DATABASE_URL"]
    else:
        DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///expenses.db")
except Exception:
    DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///expenses.db")

# SQLAlchemy requires postgresql:// instead of postgres:// 
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

if DATABASE_URL.startswith("sqlite"):
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
else:
    engine = create_engine(DATABASE_URL)

SessionLocal = sessionmaker(bind=engine)
Base = declarative_base()


def get_session():
    return SessionLocal()


def _add_column_if_missing(table: str, column: str, col_type: str):
    """Safely add a column to a table if it doesn't already exist (SQLite / Postgres)."""
    from sqlalchemy import text, inspect as sa_inspect
    from sqlalchemy.exc import ProgrammingError, OperationalError

    # Check via reflection first to avoid dirty transaction state on Postgres
    try:
        insp = sa_inspect(engine)
        existing_cols = [c["name"] for c in insp.get_columns(table)]
        if column in existing_cols:
            return
    except Exception:
        pass  # fallback: attempt the ALTER and ignore errors

    with engine.begin() as conn:
        try:
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}"))
        except (ProgrammingError, OperationalError):
            # Column already exists or table doesn't exist — safe to ignore
            pass


def migrate_db():
    """
    Apply additive schema migrations so existing data is preserved when
    new nullable columns are introduced.
    """
    # expenses: add owner_email and group_id if they are missing
    _add_column_if_missing("expenses", "owner_email", "VARCHAR")
    _add_column_if_missing("expenses", "group_id", "INTEGER")
    # settlements: add owner_email and group_id if they are missing
    _add_column_if_missing("settlements", "owner_email", "VARCHAR")
    _add_column_if_missing("settlements", "group_id", "INTEGER")
    # groups: add description if missing (old schema had name, invite_code, created_by, created_at)
    _add_column_if_missing("groups", "description", "VARCHAR")
    _add_column_if_missing("groups", "active", "INTEGER DEFAULT 1")
    # group_members: add role if missing (old schema had id, group_id, email, display_name, joined_at)
    _add_column_if_missing("group_members", "role", "VARCHAR")


def init_db():
    from db.models import Expense, Settlement, AppUser, Group, GroupMember, GroupInvite  # noqa: F401
    Base.metadata.create_all(bind=engine)
    migrate_db()
