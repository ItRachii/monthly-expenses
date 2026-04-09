import datetime

import streamlit as st

from db.database import get_session
from db.models import Expense
from utils.auth import get_user_names
from utils.calculations import CATEGORIES, PEOPLE, SPLIT_OPTIONS, compute_owes

st.title("Add Expense")

user_names = get_user_names()

with st.form("add_expense_form", clear_on_submit=True):
    col1, col2 = st.columns(2)

    with col1:
        date = st.date_input("Date", value=datetime.date.today())
        category = st.selectbox("Category", CATEGORIES)
        item = st.text_input("Item / Description", placeholder="e.g. Weekly groceries")

    with col2:
        amount = st.number_input("Amount (₹)", min_value=1.0, step=1.0, format="%.2f")
        payer = st.radio("Who paid?", PEOPLE, horizontal=True, format_func=lambda x: user_names.get(x, x))
        split = st.radio("Split", SPLIT_OPTIONS, horizontal=True, format_func=lambda x: user_names.get(x, x))

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
            )
            session.add(expense)
            session.commit()
        finally:
            session.close()

        a_owes, b_owes = compute_owes(amount, split)

        st.success(f"Expense saved: **{item.strip()}** — ₹{amount:.2f}")

        c1, c2, c3, c4 = st.columns(4)
        c1.metric("Total Amount", f"₹{amount:.2f}")
        c2.metric("Paid by", user_names.get(payer, payer))
        c3.metric(f"{user_names.get('Person A', 'Person A')} Owe", f"₹{a_owes:.2f}")
        c4.metric(f"{user_names.get('Person B', 'Person B')} Owe", f"₹{b_owes:.2f}")
