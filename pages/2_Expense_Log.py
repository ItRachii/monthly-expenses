import pandas as pd
import streamlit as st

from db.database import get_session
from db.models import Expense
from utils.auth import require_login
from utils.calculations import CATEGORIES, PEOPLE, SPLIT_OPTIONS, add_owe_columns

setup()
require_login()

st.set_page_config(page_title="Expense Log", page_icon="📋", layout="wide")
require_login()
st.title("Expense Log")


def load_expenses() -> pd.DataFrame:
    session = get_session()
    try:
        rows = session.query(Expense).order_by(Expense.date.desc(), Expense.id.desc()).all()
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
    st.info("No expenses recorded yet. Head to **Add Expense** to get started.")
    st.stop()

df["date"] = pd.to_datetime(df["date"])
df["month"] = df["date"].dt.to_period("M").astype(str)

# ── Filters ──────────────────────────────────────────────────────────────────
st.subheader("Filters")
fc1, fc2, fc3, fc4 = st.columns(4)

months = ["All"] + sorted(df["month"].unique().tolist(), reverse=True)
selected_month = fc1.selectbox("Month", months)
selected_category = fc2.selectbox("Category", ["All"] + CATEGORIES)
selected_payer = fc3.selectbox("Payer", ["All"] + PEOPLE)
selected_split = fc4.selectbox("Split", ["All"] + SPLIT_OPTIONS)

filtered = df.copy()
if selected_month != "All":
    filtered = filtered[filtered["month"] == selected_month]
if selected_category != "All":
    filtered = filtered[filtered["category"] == selected_category]
if selected_payer != "All":
    filtered = filtered[filtered["payer"] == selected_payer]
if selected_split != "All":
    filtered = filtered[filtered["split"] == selected_split]

filtered = add_owe_columns(filtered)

# ── Summary metrics ───────────────────────────────────────────────────────────
st.subheader("Summary")
m1, m2, m3, m4 = st.columns(4)
m1.metric("Expenses", len(filtered))
m2.metric("Total Spent", f"₹{filtered['amount'].sum():.2f}")
m3.metric("Person A's Share", f"₹{filtered['person_a_owes'].sum():.2f}")
m4.metric("Person B's Share", f"₹{filtered['person_b_owes'].sum():.2f}")

# ── Table ─────────────────────────────────────────────────────────────────────
st.subheader("Expenses")
display = filtered[["date", "category", "item", "amount", "payer", "split", "person_a_owes", "person_b_owes"]].copy()
display["date"] = display["date"].dt.date

st.dataframe(
    display.rename(columns={
        "date": "Date",
        "category": "Category",
        "item": "Item",
        "amount": "Amount (₹)",
        "payer": "Payer",
        "split": "Split",
        "person_a_owes": "Person A Share (₹)",
        "person_b_owes": "Person B Share (₹)",
    }),
    use_container_width=True,
    hide_index=True,
)

# ── Export ────────────────────────────────────────────────────────────────────
csv = display.to_csv(index=False)
st.download_button(
    label="Export to CSV",
    data=csv,
    file_name="expenses_export.csv",
    mime="text/csv",
)

# ── Delete ────────────────────────────────────────────────────────────────────
st.subheader("Delete an Expense")

if filtered.empty:
    st.info("No expenses match the current filters.")
else:
    expense_labels = {
        row["id"]: f"[{row['date'].date()}]  {row['category']}  —  {row['item']}  (₹{row['amount']:.2f}, {row['payer']})"
        for _, row in filtered.iterrows()
    }
    selected_id = st.selectbox(
        "Select expense to delete",
        options=list(expense_labels.keys()),
        format_func=lambda x: expense_labels[x],
    )
    if st.button("Delete Selected", type="secondary"):
        session = get_session()
        try:
            session.query(Expense).filter(Expense.id == selected_id).delete()
            session.commit()
        finally:
            session.close()
        st.success("Expense deleted.")
        st.rerun()
