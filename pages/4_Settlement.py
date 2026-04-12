import datetime

import pandas as pd
import streamlit as st

from db.database import get_session
from db.models import Expense, Settlement
from utils.auth import get_user_names
from utils.calculations import PEOPLE, add_owe_columns, compute_net_balance
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
    st.title("Settlement — Personal")
    is_personal = True
    group_id = None
    user_names = get_user_names()
    member_email_to_name = {}
    payer_options = PEOPLE
    payer_fmt = lambda x: user_names.get(x, x)

else:
    group_id = ctx["group_id"]
    group_name = ctx.get("group_name", "Group")

    if not current_email or not is_group_member(group_id, current_email):
        st.error("⛔ You are not a member of this group.")
        st.stop()

    st.title(f"Settlement — {group_name}")
    is_personal = False

    group_members = get_group_members(group_id)
    member_email_to_name = {m["email"]: m["display_name"] for m in group_members}
    member_emails = [m["email"] for m in group_members]
    user_names = member_email_to_name
    payer_options = member_emails
    payer_fmt = lambda x: member_email_to_name.get(x, x)


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


def load_settlements() -> pd.DataFrame:
    session = get_session()
    try:
        q = session.query(Settlement)
        if is_personal:
            q = q.filter(Settlement.owner_email == current_email)
        else:
            q = q.filter(Settlement.group_id == group_id)
        rows = q.order_by(Settlement.settled_at.desc()).all()
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
is_settled = selected_month in settled_months

# ── Personal Settlement ───────────────────────────────────────────────────────
if is_personal:
    month_df = add_owe_columns(month_df)
    balance, balance_desc = compute_net_balance(month_df)
    balance_desc = (
        balance_desc
        .replace("Person A", user_names.get("Person A", "Person A"))
        .replace("Person B", user_names.get("Person B", "Person B"))
    )

    st.subheader(f"Balance — {selected_month}")

    if is_settled:
        st.success("This month is marked as **settled**.")
        rec = settlements_df[settlements_df["month"] == selected_month].iloc[0]
        c1, c2, c3 = st.columns(3)
        c1.metric("Amount Settled", f"₹{rec['amount']:.2f}")
        c2.metric("Settled By", user_names.get(rec["settled_by"], rec["settled_by"]))
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
                default_index = 1 if balance > 0 else 0
                settled_by = st.radio(
                    "Who is making the payment?",
                    PEOPLE,
                    index=default_index,
                    horizontal=True,
                    format_func=lambda x: user_names.get(x, x),
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
                        owner_email=current_email,
                        group_id=None,
                    ))
                    session.commit()
                finally:
                    session.close()
                st.success(f"{selected_month} marked as settled. {user_names.get(settled_by, settled_by)} paid ₹{abs(balance):.2f}.")
                st.rerun()

# ── Group Settlement ──────────────────────────────────────────────────────────
else:
    n_members = len(group_members)
    total = month_df["amount"].sum()

    st.subheader(f"Balance — {selected_month}")

    if is_settled:
        st.success("This month is marked as **settled**.")
        rec = settlements_df[settlements_df["month"] == selected_month].iloc[0]
        c1, c2, c3 = st.columns(3)
        c1.metric("Amount Settled", f"₹{rec['amount']:.2f}")
        c2.metric("Settled By", member_email_to_name.get(rec["settled_by"], rec["settled_by"]))
        c3.metric("Settled On", str(rec["settled_at"])[:10])
        if rec["note"]:
            st.info(f"Note: {rec['note']}")
    else:
        # Per-member net balance
        st.write(f"**Total spent this month:** ₹{total:.2f}")
        if n_members:
            equal_share = round(total / n_members, 2)
            st.write(f"Equal share per member: ₹{equal_share:.2f}")

            net_balances = []
            for member in group_members:
                em = member["email"]
                paid = month_df.loc[month_df["payer"] == em, "amount"].sum()
                # Responsibility: expenses fully assigned to them + their equal share
                resp = (
                    month_df.loc[month_df["split"] == em, "amount"].sum()
                    + month_df.loc[month_df["split"] == "equal", "amount"].sum() / n_members
                )
                net = round(paid - resp, 2)   # positive = others owe them, negative = they owe others
                net_balances.append({
                    "Member": member["display_name"],
                    "Paid (₹)": paid,
                    "Owes (₹)": resp,
                    "Net (₹)": net,
                    "Status": f"Gets back ₹{net:.2f}" if net > 0.01 else (f"Owes ₹{abs(net):.2f}" if net < -0.01 else "Settled"),
                })

            st.dataframe(pd.DataFrame(net_balances), width='stretch', hide_index=True)

            if abs(total) > 0.01 and not is_settled:
                st.subheader("Mark as Settled")
                with st.form("group_settle_form"):
                    settled_by = st.selectbox(
                        "Who is making the settlement payment?",
                        payer_options,
                        format_func=payer_fmt,
                    )
                    settle_amount = st.number_input("Settlement Amount (₹)", min_value=0.01, value=float(round(total / n_members, 2)), step=0.01, format="%.2f")
                    note = st.text_input("Note (optional)")
                    confirm = st.form_submit_button("Confirm Settlement", type="primary")

                if confirm:
                    session = get_session()
                    try:
                        session.add(Settlement(
                            month=selected_month,
                            settled_at=datetime.datetime.now(),
                            settled_by=settled_by,
                            amount=settle_amount,
                            note=note.strip() or None,
                            owner_email=None,
                            group_id=group_id,
                        ))
                        session.commit()
                    finally:
                        session.close()
                    st.success(f"{selected_month} marked as settled by {member_email_to_name.get(settled_by, settled_by)}.")
                    st.rerun()

# ── Settlement History ────────────────────────────────────────────────────────
st.subheader("Settlement History")

if settlements_df.empty:
    st.info("No settlements recorded yet.")
else:
    history = settlements_df[["month", "settled_at", "settled_by", "amount", "note"]].copy()
    history["settled_at"] = history["settled_at"].astype(str).str[:16]
    history["settled_by"] = history["settled_by"].map(lambda x: user_names.get(x, x))
    st.dataframe(
        history.rename(columns={
            "month": "Month",
            "settled_at": "Settled At",
            "settled_by": "Settled By",
            "amount": "Amount (₹)",
            "note": "Note",
        }),
        width='stretch',
        hide_index=True,
    )
