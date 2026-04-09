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


def init_db():
    from db.models import Expense, Settlement, AppUser  # noqa: F401 — registers models with Base.metadata
    Base.metadata.create_all(bind=engine)
