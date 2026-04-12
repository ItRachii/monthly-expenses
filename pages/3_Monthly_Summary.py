import pandas as pd
import streamlit as st

from db.database import get_session, init_db
from db.models import Expense
from utils.auth import get_user_names
from utils.calculations import add_owe_columns, compute_net_balance
from utils.groups import (
    get_active_context,
    is_personal_context,
    get_context_group_id,
    get_group_members,
    is_group_member,
)
from utils.charts import (
    category_bar_chart,
    category_pie_chart,
    monthly_trend_chart,
    per_person_bar_chart,
)

# ── Resolve current context ───────────────────────────────────────────────────
ctx = get_active_context()
current_email = getattr(st.user, "email", "")

if ctx["type"] == "personal":
    st.title("Monthly Summary — Personal")
    is_personal = True
    group_id = None
    user_names = get_user_names()
    member_email_to_name = {}

else:
    group_id = ctx["group_id"]
    group_name = ctx.get("group_name", "Group")

    if not current_email or not is_group_member(group_id, current_email):
        st.error("⛔ You are not a member of this group.")
        st.stop()

    st.title(f"Monthly Summary — {group_name}")
    is_personal = False

    group_members = get_group_members(group_id)
    member_email_to_name = {m["email"]: m["display_name"] for m in group_members}
    user_names = member_email_to_name


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

# ── Personal: classic "Person A / Person B" summary ──────────────────────────
if is_personal:
    month_df = add_owe_columns(month_df)
    balance, balance_desc = compute_net_balance(month_df)
    balance_desc = (
        balance_desc
        .replace("Person A", user_names.get("Person A", "Person A"))
        .replace("Person B", user_names.get("Person B", "Person B"))
    )

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
    else:
        st.warning(f"**{balance_desc}**")

    # ── Charts ─────────────────────────────────────────────────────────────────
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

    # ── Expense table ────────────────────────────────────────────────────────
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

# ── Group: per-member summary ─────────────────────────────────────────────────
else:
    st.subheader(f"Overview — {selected_month}")
    total = month_df["amount"].sum()
    n_members = len(group_members)

    st.metric("Total Spent", f"₹{total:.2f}")

    # Per-member paid vs equal share
    if n_members:
        equal_share = round(total / n_members, 2)
        cols = st.columns(n_members)
        for i, member in enumerate(group_members):
            em = member["email"]
            paid = month_df.loc[month_df["payer"] == em, "amount"].sum()
            # Compute responsibility: expenses where split == em or split == "equal"
            resp = (
                month_df.loc[month_df["split"] == em, "amount"].sum()
                + month_df.loc[month_df["split"] == "equal", "amount"].sum() / n_members
            )
            cols[i].metric(
                member["display_name"],
                f"Paid ₹{paid:.2f}",
                delta=f"owes ₹{resp:.2f}",
            )

    # ── Charts ─────────────────────────────────────────────────────────────
    st.subheader("Spending Breakdown")
    tab_pie, tab_bar, tab_trend = st.tabs(
        ["Category (Pie)", "Category (Bar)", "Monthly Trend"]
    )
    with tab_pie:
        st.plotly_chart(category_pie_chart(month_df), use_container_width=True)
    with tab_bar:
        st.plotly_chart(category_bar_chart(month_df), use_container_width=True)
    with tab_trend:
        st.plotly_chart(monthly_trend_chart(df), use_container_width=True)

    # ── Expense table ────────────────────────────────────────────────────────
    st.subheader("Expense Detail")
    display = month_df[["date", "category", "item", "amount", "payer", "split"]].copy()
    display["date"] = display["date"].dt.date
    display["payer"] = display["payer"].map(lambda x: member_email_to_name.get(x, x))
    display["split"] = display["split"].map(lambda x: "Equal Split" if x == "equal" else member_email_to_name.get(x, x))
    st.dataframe(
        display.rename(columns={
            "date": "Date",
            "category": "Category",
            "item": "Item",
            "amount": "Amount (₹)",
            "payer": "Payer",
            "split": "Split",
        }),
        use_container_width=True,
        hide_index=True,
    )
