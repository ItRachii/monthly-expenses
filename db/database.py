from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

DATABASE_URL = "sqlite:///expenses.db"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine)
Base = declarative_base()


def get_session():
    return SessionLocal()


def init_db():
    from db.models import Expense, Settlement  # noqa: F401 — registers models with Base.metadata
    Base.metadata.create_all(bind=engine)
