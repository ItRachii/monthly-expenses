import datetime

import streamlit as st

from db.database import get_session
from db.models import Expense
from utils.auth import get_user_names
from utils.calculations import CATEGORIES, PEOPLE, SPLIT_OPTIONS, compute_owes
from utils.groups import (
    get_active_context,
    is_personal_context,
    get_context_group_id,
    get_group_members,
    is_group_member,
    get_group,
)

# ── Resolve current context ───────────────────────────────────────────────────
ctx = get_active_context()
current_email = getattr(st.user, "email", "")

if ctx["type"] == "personal":
    st.title("Add Expense — Personal")
    is_personal = True
    group_id = None
    group_members = []
    user_names = get_user_names()

    # For personal context keep the classic Person A / Person B payer & split
    payer_options = PEOPLE
    split_options = SPLIT_OPTIONS
    payer_fmt = lambda x: user_names.get(x, x)
    split_fmt = lambda x: user_names.get(x, x)

else:
    group_id = ctx["group_id"]
    group_name = ctx.get("group_name", "Group")

    # Gate: only members may add expenses
    if not current_email or not is_group_member(group_id, current_email):
        st.error("⛔ You are not a member of this group.")
        st.stop()

    st.title(f"Add Expense — {group_name}")
    is_personal = False

    group_members = get_group_members(group_id)

    # Build payer / split options from group member emails & names
    member_email_to_name = {m["email"]: m["display_name"] for m in group_members}
    member_emails = [m["email"] for m in group_members]

    payer_options = member_emails
    # Split: "equal" means split equally among all members; or assign to one member
    split_options = ["equal"] + member_emails
    payer_fmt = lambda x: member_email_to_name.get(x, x)
    split_fmt = lambda x: "Equal Split" if x == "equal" else member_email_to_name.get(x, x)
    user_names = {}   # not used for group context display

# ── Form ──────────────────────────────────────────────────────────────────────
with st.form("add_expense_form", clear_on_submit=True):
    col1, col2 = st.columns(2)

    with col1:
        date = st.date_input("Date", value=datetime.date.today())
        category = st.selectbox("Category", CATEGORIES)
        item = st.text_input("Item / Description", placeholder="e.g. Weekly groceries")

    with col2:
        amount = st.number_input("Amount (₹)", min_value=1.0, step=1.0, format="%.2f")
        payer = st.selectbox("Who paid?", payer_options, format_func=payer_fmt)
        split = st.selectbox("Split", split_options, format_func=split_fmt)

    submitted = st.form_submit_button("Add Expense", type="primary", use_container_width=True)

if submitted:
    if not item.strip():
        st.error("Please enter an item description.")
    else:
        session = get_session()
        try:
            expense = Expense(
                date=date,
                category=category,
                item=item.strip(),
                amount=amount,
                payer=payer,
                split=split,
                owner_email=current_email if is_personal else None,
                group_id=group_id,
            )
            session.add(expense)
            session.commit()
        finally:
            session.close()

        if is_personal:
            a_owes, b_owes = compute_owes(amount, split)
            st.success(f"Expense saved: **{item.strip()}** — ₹{amount:.2f}")
            c1, c2, c3, c4 = st.columns(4)
            c1.metric("Total Amount", f"₹{amount:.2f}")
            c2.metric("Paid by", user_names.get(payer, payer))
            c3.metric(f"{user_names.get('Person A', 'Person A')} Owe", f"₹{a_owes:.2f}")
            c4.metric(f"{user_names.get('Person B', 'Person B')} Owe", f"₹{b_owes:.2f}")
        else:
            n_members = len(group_members)
            if split == "equal":
                each_owes = round(amount / n_members, 2) if n_members else 0
                st.success(f"Expense saved: **{item.strip()}** — ₹{amount:.2f}")
                st.info(f"Each of the {n_members} members owes ₹{each_owes:.2f}")
            else:
                payer_name = member_email_to_name.get(payer, payer)
                split_name = member_email_to_name.get(split, split)
                st.success(f"Expense saved: **{item.strip()}** — ₹{amount:.2f}")
                c1, c2, c3 = st.columns(3)
                c1.metric("Total Amount", f"₹{amount:.2f}")
                c2.metric("Paid by", payer_name)
                c3.metric("Responsible", split_name)
