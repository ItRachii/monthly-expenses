import pandas as pd
import streamlit as st

from backend.database import get_session
from backend.models import Expense
from utils.calculations import CATEGORIES
from utils.groups import get_group_members, get_user_groups, is_group_member
from utils.charts import category_bar_chart, category_pie_chart, monthly_trend_chart

st.title("Monthly Summary")

current_email = getattr(st.user, "email", "")

# ── Context Selector ──────────────────────────────────────────────────────────
user_groups = get_user_groups(current_email) if current_email else []
context_options = ["Personal"] + [g["name"] for g in user_groups]
group_by_name = {g["name"]: g for g in user_groups}

selected = st.selectbox("View summary for:", context_options)

st.divider()

# ── Resolve context ───────────────────────────────────────────────────────────
if selected == "Personal":
    is_personal = True
    group_id = None
    member_email_to_name = {}
    group_members = []
else:
    group_info = group_by_name[selected]
    group_id = group_info["id"]

    if not current_email or not is_group_member(group_id, current_email):
        st.error("You are not a member of this group.")
        st.stop()

    is_personal = False
    group_members = get_group_members(group_id)
    member_email_to_name = {m["email"]: m["display_name"] for m in group_members}


def load_expenses() -> pd.DataFrame:
    session = get_session()
    try:
        q = session.query(Expense)
        if is_personal:
            q = q.filter(Expense.owner_email == current_email)
        else:
            q = q.filter(Expense.group_id == group_id)
        rows = q.order_by(Expense.date.asc()).all()
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

# ── Personal: simple spending summary ────────────────────────────────────────
if is_personal:
    total = month_df["amount"].sum()

    st.subheader(f"Overview — {selected_month}")
    c1, c2 = st.columns(2)
    c1.metric("Total Spent", f"₹{total:.2f}")
    c2.metric("Transactions", len(month_df))

    st.subheader("Spending Breakdown")
    tab_pie, tab_bar, tab_trend = st.tabs(["Category (Pie)", "Category (Bar)", "Monthly Trend"])
    with tab_pie:
        st.plotly_chart(category_pie_chart(month_df), width="stretch")
    with tab_bar:
        st.plotly_chart(category_bar_chart(month_df), width="stretch")
    with tab_trend:
        st.plotly_chart(monthly_trend_chart(df), width="stretch")

    st.subheader("Expense Detail")
    display = month_df[["date", "category", "item", "amount"]].copy()
    display["date"] = display["date"].dt.date
    st.dataframe(
        display.rename(columns={
            "date": "Date", "category": "Category",
            "item": "Item", "amount": "Amount (₹)",
        }),
        width="stretch",
        hide_index=True,
    )

# ── Group: per-member summary ─────────────────────────────────────────────────
else:
    n_members = len(group_members)
    total = month_df["amount"].sum()

    st.subheader(f"Overview — {selected_month}")
    st.metric("Total Spent", f"₹{total:.2f}")

    if n_members:
        equal_share = round(total / n_members, 2)
        cols = st.columns(n_members)
        for i, member in enumerate(group_members):
            em = member["email"]
            paid = month_df.loc[month_df["payer"] == em, "amount"].sum()
            # 50-50 (or legacy "equal") splits equally; otherwise full responsibility
            resp = (
                month_df.loc[month_df["split"] == em, "amount"].sum()
                + month_df.loc[month_df["split"].isin(["equal", "50-50"]), "amount"].sum() / n_members
            )
            cols[i].metric(
                member["display_name"],
                f"Paid ₹{paid:.2f}",
                delta=f"owes ₹{resp:.2f}",
            )

    st.subheader("Spending Breakdown")
    tab_pie, tab_bar, tab_trend = st.tabs(["Category (Pie)", "Category (Bar)", "Monthly Trend"])
    with tab_pie:
        st.plotly_chart(category_pie_chart(month_df), width="stretch")
    with tab_bar:
        st.plotly_chart(category_bar_chart(month_df), width="stretch")
    with tab_trend:
        st.plotly_chart(monthly_trend_chart(df), width="stretch")

    st.subheader("Expense Detail")
    display = month_df[["date", "category", "item", "amount", "payer", "split"]].copy()
    display["date"] = display["date"].dt.date
    display["payer"] = display["payer"].map(lambda x: member_email_to_name.get(x, x))
    display["split"] = display["split"].map(
        lambda x: "Equal split (50-50)" if x in ("equal", "50-50") else member_email_to_name.get(x, x)
    )
    st.dataframe(
        display.rename(columns={
            "date": "Date", "category": "Category", "item": "Item",
            "amount": "Amount (₹)", "payer": "Payer", "split": "Split",
        }),
        width="stretch",
        hide_index=True,
    )
