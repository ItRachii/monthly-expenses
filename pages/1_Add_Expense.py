import datetime

import streamlit as st

from backend.database import get_session
from backend.models import Expense
from utils.calculations import CATEGORIES
from utils.groups import get_group_members, get_user_groups, is_group_member

st.title("Add Expense")

current_email = getattr(st.user, "email", "")

# ── Context Selector ──────────────────────────────────────────────────────────
user_groups = get_user_groups(current_email) if current_email else []
context_options = ["Personal"] + [g["name"] for g in user_groups]
group_by_name = {g["name"]: g for g in user_groups}

selected = st.selectbox("Add expense to:", context_options)

st.divider()

# ── Resolve context ───────────────────────────────────────────────────────────
if selected == "Personal":
    is_personal = True
    group_id = None
    group_members = []
    member_email_to_name = {}
    member_emails = []
else:
    group_info = group_by_name[selected]
    group_id = group_info["id"]

    if not current_email or not is_group_member(group_id, current_email):
        st.error("You are not a member of this group.")
        st.stop()

    is_personal = False
    # Always fetched fresh — new members appear immediately without needing a reload
    group_members = get_group_members(group_id)
    member_email_to_name = {m["email"]: m["display_name"] for m in group_members}
    member_emails = [m["email"] for m in group_members]

# ── Form ──────────────────────────────────────────────────────────────────────
with st.form("add_expense_form", clear_on_submit=True):
    col1, col2 = st.columns(2)

    with col1:
        date = st.date_input("Date", value=datetime.date.today())
        category = st.selectbox("Category", CATEGORIES)
        item = st.text_input("Item / Description", placeholder="e.g. Weekly groceries")

    with col2:
        amount = st.number_input("Amount (₹)", min_value=1.0, step=1.0, format="%.2f")
        if not is_personal:
            payer = st.selectbox(
                "Who paid?",
                member_emails,
                format_func=lambda x: member_email_to_name.get(x, x),
            )
            split_options = ["50-50"] + member_emails
            split = st.selectbox(
                "Split",
                split_options,
                format_func=lambda x: "Equal split among all" if x == "50-50" else member_email_to_name.get(x, x),
            )

    submitted = st.form_submit_button("Add Expense", type="primary", use_container_width=True)

if submitted:
    if not item.strip():
        st.error("Please enter an item description.")
    elif not is_personal and not member_emails:
        st.error("This group has no members.")
    else:
        session = get_session()
        try:
            expense = Expense(
                date=date,
                category=category,
                item=item.strip(),
                amount=amount,
                payer=current_email if is_personal else payer,
                split="personal" if is_personal else split,
                owner_email=current_email if is_personal else None,
                group_id=group_id,
            )
            session.add(expense)
            session.commit()
        finally:
            session.close()

        if is_personal:
            st.success(f"Expense saved: **{item.strip()}** — ₹{amount:.2f}")
        else:
            n_members = len(group_members)
            payer_name = member_email_to_name.get(payer, payer)
            if split == "50-50":
                each = round(amount / n_members, 2) if n_members else 0
                st.success(f"Expense saved: **{item.strip()}** — ₹{amount:.2f}")
                st.info(f"Split equally among {n_members} members — ₹{each:.2f} each")
            else:
                split_name = member_email_to_name.get(split, split)
                st.success(f"Expense saved: **{item.strip()}** — ₹{amount:.2f}")
                c1, c2, c3 = st.columns(3)
                c1.metric("Total Amount", f"₹{amount:.2f}")
                c2.metric("Paid by", payer_name)
                c3.metric("Responsible", split_name)
