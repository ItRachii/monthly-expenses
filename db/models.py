from sqlalchemy import Column, Integer, String, Float, Date, DateTime
from db.database import Base


class Expense(Base):
    __tablename__ = "expenses"

    id = Column(Integer, primary_key=True, autoincrement=True)
    date = Column(Date, nullable=False)
    category = Column(String, nullable=False)
    item = Column(String, nullable=False)
    amount = Column(Float, nullable=False)
    payer = Column(String, nullable=False)   # "Person A" or "Person B"
    split = Column(String, nullable=False)   # "50-50", "Person A", "Person B"


class Settlement(Base):
    __tablename__ = "settlements"

    id = Column(Integer, primary_key=True, autoincrement=True)
    month = Column(String, nullable=False)          # "YYYY-MM"
    settled_at = Column(DateTime, nullable=False)
    settled_by = Column(String, nullable=False)     # who made the payment
    amount = Column(Float, nullable=False)          # net amount transferred
    note = Column(String, nullable=True)
