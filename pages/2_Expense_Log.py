import pandas as pd
import streamlit as st

from backend.database import get_session
from backend.models import Expense
from utils.calculations import CATEGORIES
from utils.groups import get_group_members, get_user_groups, is_group_member

st.title("Expense Log")

current_email = getattr(st.user, "email", "")

# ── Context Selector ──────────────────────────────────────────────────────────
user_groups = get_user_groups(current_email) if current_email else []
context_options = ["Personal"] + [g["name"] for g in user_groups]
group_by_name = {g["name"]: g for g in user_groups}

selected = st.selectbox("View expenses for:", context_options)

st.divider()

# ── Resolve context ───────────────────────────────────────────────────────────
if selected == "Personal":
    is_personal = True
    group_id = None
    member_email_to_name = {}
    member_emails = []
else:
    group_info = group_by_name[selected]
    group_id = group_info["id"]

    if not current_email or not is_group_member(group_id, current_email):
        st.error("You are not a member of this group.")
        st.stop()

    is_personal = False
    group_members = get_group_members(group_id)
    member_email_to_name = {m["email"]: m["display_name"] for m in group_members}
    member_emails = [m["email"] for m in group_members]


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

if is_personal:
    fc1, fc2 = st.columns(2)
    months = ["All"] + sorted(df["month"].unique().tolist(), reverse=True)
    selected_month = fc1.selectbox("Month", months)
    selected_category = fc2.selectbox("Category", ["All"] + CATEGORIES)

    filtered = df.copy()
    if selected_month != "All":
        filtered = filtered[filtered["month"] == selected_month]
    if selected_category != "All":
        filtered = filtered[filtered["category"] == selected_category]
else:
    fc1, fc2, fc3, fc4 = st.columns(4)
    months = ["All"] + sorted(df["month"].unique().tolist(), reverse=True)
    selected_month = fc1.selectbox("Month", months)
    selected_category = fc2.selectbox("Category", ["All"] + CATEGORIES)
    selected_payer = fc3.selectbox(
        "Payer", ["All"] + member_emails,
        format_func=lambda x: member_email_to_name.get(x, x),
    )
    # offer "50-50" in filter; matches both old "equal" and new "50-50" DB values
    split_filter_options = ["50-50"] + member_emails
    selected_split = fc4.selectbox(
        "Split", ["All"] + split_filter_options,
        format_func=lambda x: "Equal split (50-50)" if x == "50-50" else member_email_to_name.get(x, x),
    )

    filtered = df.copy()
    if selected_month != "All":
        filtered = filtered[filtered["month"] == selected_month]
    if selected_category != "All":
        filtered = filtered[filtered["category"] == selected_category]
    if selected_payer != "All":
        filtered = filtered[filtered["payer"] == selected_payer]
    if selected_split != "All":
        if selected_split == "50-50":
            filtered = filtered[filtered["split"].isin(["equal", "50-50"])]
        else:
            filtered = filtered[filtered["split"] == selected_split]

# ── Summary metrics ───────────────────────────────────────────────────────────
st.subheader("Summary")
m1, m2 = st.columns(2)
m1.metric("Expenses", len(filtered))
m2.metric("Total Spent", f"₹{filtered['amount'].sum():.2f}")

# ── Table ─────────────────────────────────────────────────────────────────────
st.subheader("Expenses")

if is_personal:
    display = filtered[["date", "category", "item", "amount"]].copy()
    display["date"] = display["date"].dt.date
    st.dataframe(
        display.rename(columns={
            "date": "Date",
            "category": "Category",
            "item": "Item",
            "amount": "Amount (₹)",
        }),
        width="stretch",
        hide_index=True,
    )
else:
    def _split_label(x):
        if x in ("equal", "50-50"):
            return "Equal split (50-50)"
        return member_email_to_name.get(x, x)

    display = filtered[["date", "category", "item", "amount", "payer", "split"]].copy()
    display["date"] = display["date"].dt.date
    display["payer"] = display["payer"].map(lambda x: member_email_to_name.get(x, x))
    display["split"] = display["split"].map(_split_label)
    st.dataframe(
        display.rename(columns={
            "date": "Date",
            "category": "Category",
            "item": "Item",
            "amount": "Amount (₹)",
            "payer": "Payer",
            "split": "Split",
        }),
        width="stretch",
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
        label_fn = lambda r: f"[{r['date'].date()}]  {r['category']}  —  {r['item']}  (₹{r['amount']:.2f})"
    else:
        label_fn = lambda r: (
            f"[{r['date'].date()}]  {r['category']}  —  {r['item']}"
            f"  (₹{r['amount']:.2f}, {member_email_to_name.get(r['payer'], r['payer'])})"
        )

    expense_labels = {row["id"]: label_fn(row) for _, row in filtered.iterrows()}
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
