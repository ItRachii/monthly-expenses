import pandas as pd
import streamlit as st

from db.database import get_session, init_db
from db.models import Expense
from utils.auth import require_login, get_user_names
from utils.calculations import add_owe_columns, compute_net_balance
from utils.charts import (
    category_bar_chart,
    category_pie_chart,
    monthly_trend_chart,
    per_person_bar_chart,
)

st.set_page_config(page_title="Monthly Summary", page_icon="📊", layout="wide")
require_login()
st.title("Monthly Summary")

user_names = get_user_names()

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


df = load_expenses()

if df.empty:
    st.info("No expenses recorded yet.")
    st.stop()

df["date"] = pd.to_datetime(df["date"])
df["month"] = df["date"].dt.to_period("M").astype(str)

months = sorted(df["month"].unique().tolist(), reverse=True)
selected_month = st.selectbox("Select Month", months)

month_df = df[df["month"] == selected_month].copy()
month_df = add_owe_columns(month_df)

balance, balance_desc = compute_net_balance(month_df)
# Replace names in description
balance_desc = balance_desc.replace("Person A", user_names.get("Person A", "Person A")).replace("Person B", user_names.get("Person B", "Person B"))

# ── Key metrics ───────────────────────────────────────────────────────────────
st.subheader(f"Overview — {selected_month}")

total = month_df["amount"].sum()
a_paid = month_df.loc[month_df["payer"] == "Person A", "amount"].sum()
b_paid = month_df.loc[month_df["payer"] == "Person B", "amount"].sum()
a_share = month_df["person_a_owes"].sum()
b_share = month_df["person_b_owes"].sum()

r1c1, r1c2, r1c3 = st.columns(3)
r1c1.metric("Total Spent", f"₹{total:.2f}")
r1c2.metric(f"{user_names.get('Person A', 'Person A')} Paid", f"₹{a_paid:.2f}", delta=f"share ₹{a_share:.2f}")
r1c3.metric(f"{user_names.get('Person B', 'Person B')} Paid", f"₹{b_paid:.2f}", delta=f"share ₹{b_share:.2f}")

if abs(balance) < 0.01:
    st.success(balance_desc)
elif balance > 0:
    st.warning(f"**{balance_desc}**")
else:
    st.warning(f"**{balance_desc}**")

# ── Charts ────────────────────────────────────────────────────────────────────
st.subheader("Spending Breakdown")
tab_pie, tab_bar, tab_person, tab_trend = st.tabs(
    ["Category (Pie)", "Category (Bar)", "Per Person", "Monthly Trend"]
)

with tab_pie:
    st.plotly_chart(category_pie_chart(month_df), use_container_width=True)

with tab_bar:
    st.plotly_chart(category_bar_chart(month_df), use_container_width=True)

with tab_person:
    st.plotly_chart(per_person_bar_chart(month_df, user_names), use_container_width=True)

with tab_trend:
    st.plotly_chart(monthly_trend_chart(df), use_container_width=True)

# ── Expense detail table ──────────────────────────────────────────────────────
st.subheader("Expense Detail")
display = month_df[["date", "category", "item", "amount", "payer", "split", "person_a_owes", "person_b_owes"]].copy()
display["date"] = display["date"].dt.date
display = display.replace({"payer": user_names, "split": user_names})

st.dataframe(
    display.rename(columns={
        "date": "Date",
        "category": "Category",
        "item": "Item",
        "amount": "Amount (₹)",
        "payer": "Payer",
        "split": "Split",
        "person_a_owes": f"{user_names.get('Person A', 'Person A')} Share (₹)",
        "person_b_owes": f"{user_names.get('Person B', 'Person B')} Share (₹)",
    }),
    use_container_width=True,
    hide_index=True,
)
