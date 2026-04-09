import datetime

import pandas as pd
import streamlit as st

from db.database import get_session
from db.models import Expense, Settlement
from utils.auth import require_login
from utils.calculations import PEOPLE, add_owe_columns, compute_net_balance

setup()
require_login()

st.set_page_config(page_title="Settlement", page_icon="💰", layout="wide")
require_login()
st.title("Settlement")


def load_expenses() -> pd.DataFrame:
    session = get_session()
    try:
        rows = session.query(Expense).order_by(Expense.date.asc()).all()
        return pd.DataFrame([
            {
                "id": r.id,
                "date": r.date,
                "category": r.category,
                "item": r.item,
                "amount": r.amount,
                "payer": r.payer,
                "split": r.split,
            }
            for r in rows
        ])
    finally:
        session.close()


def load_settlements() -> pd.DataFrame:
    session = get_session()
    try:
        rows = session.query(Settlement).order_by(Settlement.settled_at.desc()).all()
        return pd.DataFrame([
            {
                "id": r.id,
                "month": r.month,
                "settled_at": r.settled_at,
                "settled_by": r.settled_by,
                "amount": r.amount,
                "note": r.note,
            }
            for r in rows
        ])
    finally:
        session.close()


df = load_expenses()

if df.empty:
    st.info("No expenses recorded yet.")
    st.stop()

df["date"] = pd.to_datetime(df["date"])
df["month"] = df["date"].dt.to_period("M").astype(str)

settlements_df = load_settlements()
settled_months = set(settlements_df["month"].tolist()) if not settlements_df.empty else set()

months = sorted(df["month"].unique().tolist(), reverse=True)
selected_month = st.selectbox("Select Month", months)

month_df = df[df["month"] == selected_month].copy()
month_df = add_owe_columns(month_df)

balance, balance_desc = compute_net_balance(month_df)
is_settled = selected_month in settled_months

# ── Balance for selected month ────────────────────────────────────────────────
st.subheader(f"Balance — {selected_month}")

if is_settled:
    st.success(f"This month is marked as **settled**.")
    rec = settlements_df[settlements_df["month"] == selected_month].iloc[0]
    c1, c2, c3 = st.columns(3)
    c1.metric("Amount Settled", f"₹{rec['amount']:.2f}")
    c2.metric("Settled By", rec["settled_by"])
    c3.metric("Settled On", str(rec["settled_at"])[:10])
    if rec["note"]:
        st.info(f"Note: {rec['note']}")
else:
    total = month_df["amount"].sum()
    c1, c2, c3 = st.columns(3)
    c1.metric("Total Spent", f"₹{total:.2f}")
    c2.metric("Net Balance", f"₹{abs(balance):.2f}")
    c3.metric("Status", "Unsettled")

    if abs(balance) < 0.01:
        st.success("No balance to settle — you're even for this month!")
    else:
        st.warning(f"**{balance_desc}**")

        st.subheader("Mark as Settled")
        with st.form("settle_form"):
            # Pre-select the person who owes (they make the payment)
            default_index = 1 if balance > 0 else 0   # balance>0 → B owes A → B pays
            settled_by = st.radio(
                "Who is making the payment?",
                PEOPLE,
                index=default_index,
                horizontal=True,
            )
            note = st.text_input("Note (optional)", placeholder="e.g. Bank transfer on 2024-04-01")
            confirm = st.form_submit_button("Confirm Settlement", type="primary")

        if confirm:
            session = get_session()
            try:
                session.add(Settlement(
                    month=selected_month,
                    settled_at=datetime.datetime.now(),
                    settled_by=settled_by,
                    amount=abs(balance),
                    note=note.strip() or None,
                ))
                session.commit()
            finally:
                session.close()
            st.success(f"{selected_month} marked as settled. {settled_by} paid ₹{abs(balance):.2f}.")
            st.rerun()

# ── Settlement history ────────────────────────────────────────────────────────
st.subheader("Settlement History")

if settlements_df.empty:
    st.info("No settlements recorded yet.")
else:
    history = settlements_df[["month", "settled_at", "settled_by", "amount", "note"]].copy()
    history["settled_at"] = history["settled_at"].astype(str).str[:16]
    st.dataframe(
        history.rename(columns={
            "month": "Month",
            "settled_at": "Settled At",
            "settled_by": "Settled By",
            "amount": "Amount (₹)",
            "note": "Note",
        }),
        use_container_width=True,
        hide_index=True,
    )
