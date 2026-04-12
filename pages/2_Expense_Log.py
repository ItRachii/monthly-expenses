import pandas as pd
import streamlit as st

from db.database import get_session
from db.models import Expense
from utils.auth import get_user_names
from utils.calculations import CATEGORIES, PEOPLE, SPLIT_OPTIONS, add_owe_columns
from utils.groups import (
    get_active_context,
    is_personal_context,
    get_context_group_id,
    get_group_members,
    is_group_member,
)

# ── Resolve current context ───────────────────────────────────────────────────
ctx = get_active_context()
current_email = getattr(st.user, "email", "")

if ctx["type"] == "personal":
    st.title("Expense Log — Personal")
    is_personal = True
    group_id = None
    user_names = get_user_names()
    payer_options = PEOPLE
    split_filter_options = SPLIT_OPTIONS

else:
    group_id = ctx["group_id"]
    group_name = ctx.get("group_name", "Group")

    if not current_email or not is_group_member(group_id, current_email):
        st.error("⛔ You are not a member of this group.")
        st.stop()

    st.title(f"Expense Log — {group_name}")
    is_personal = False

    group_members = get_group_members(group_id)
    member_email_to_name = {m["email"]: m["display_name"] for m in group_members}
    member_emails = [m["email"] for m in group_members]
    user_names = member_email_to_name
    payer_options = member_emails
    split_filter_options = ["equal"] + member_emails


def load_expenses() -> pd.DataFrame:
    session = get_session()
    try:
        q = session.query(Expense)
        if is_personal:
            q = q.filter(Expense.owner_email == current_email)
        else:
            q = q.filter(Expense.group_id == group_id)
        rows = q.order_by(Expense.date.desc(), Expense.id.desc()).all()
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

# ── Filters ───────────────────────────────────────────────────────────────────
st.subheader("Filters")
fc1, fc2, fc3, fc4 = st.columns(4)

months = ["All"] + sorted(df["month"].unique().tolist(), reverse=True)
selected_month = fc1.selectbox("Month", months)
selected_category = fc2.selectbox("Category", ["All"] + CATEGORIES)
selected_payer = fc3.selectbox("Payer", ["All"] + payer_options, format_func=lambda x: user_names.get(x, x))
selected_split = fc4.selectbox("Split", ["All"] + split_filter_options, format_func=lambda x: "Equal Split" if x == "equal" else user_names.get(x, x))

filtered = df.copy()
if selected_month != "All":
    filtered = filtered[filtered["month"] == selected_month]
if selected_category != "All":
    filtered = filtered[filtered["category"] == selected_category]
if selected_payer != "All":
    filtered = filtered[filtered["payer"] == selected_payer]
if selected_split != "All":
    filtered = filtered[filtered["split"] == selected_split]

# ── Summary metrics ───────────────────────────────────────────────────────────
st.subheader("Summary")

if is_personal:
    filtered_with_owes = add_owe_columns(filtered.copy())
    m1, m2, m3, m4 = st.columns(4)
    m1.metric("Expenses", len(filtered))
    m2.metric("Total Spent", f"₹{filtered['amount'].sum():.2f}")
    m3.metric(f"{user_names.get('Person A', 'Person A')}'s Share", f"₹{filtered_with_owes['person_a_owes'].sum():.2f}")
    m4.metric(f"{user_names.get('Person B', 'Person B')}'s Share", f"₹{filtered_with_owes['person_b_owes'].sum():.2f}")
else:
    m1, m2 = st.columns(2)
    m1.metric("Expenses", len(filtered))
    m2.metric("Total Spent", f"₹{filtered['amount'].sum():.2f}")

# ── Table ─────────────────────────────────────────────────────────────────────
st.subheader("Expenses")

if is_personal:
    filtered_display = add_owe_columns(filtered.copy())
    display = filtered_display[["date", "category", "item", "amount", "payer", "split", "person_a_owes", "person_b_owes"]].copy()
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
else:
    display = filtered[["date", "category", "item", "amount", "payer", "split"]].copy()
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
    if is_personal:
        payer_disp = lambda r: user_names.get(r["payer"], r["payer"])
    else:
        payer_disp = lambda r: member_email_to_name.get(r["payer"], r["payer"])

    expense_labels = {
        row["id"]: f"[{row['date'].date()}]  {row['category']}  —  {row['item']}  (₹{row['amount']:.2f}, {payer_disp(row)})"
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
