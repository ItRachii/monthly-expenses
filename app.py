import streamlit as st
from db.database import init_db
from utils.auth import require_login

init_db()

st.set_page_config(
    page_title="Monthly Expense Tracker",
    page_icon="💸",
    layout="wide",
)

# ── Auth guard ─────────────────────────────────────────────────────────────────
require_login()

# ── Page content ───────────────────────────────────────────────────────────────
st.title("Monthly Expense Tracker")
st.markdown(
    """
    A shared expense tracker for two people. Use the sidebar to navigate.

    | Page | Description |
    |------|-------------|
    | **Add Expense** | Log a new expense — date, category, amount, payer, and split |
    | **Expense Log** | View, filter, and delete expenses; export to CSV |
    | **Monthly Summary** | Charts and per-person breakdown for any month |
    | **Settlement** | See the net balance and mark months as settled |

    ---
    **Split types explained**

    | Split | Meaning |
    |-------|---------|
    | `50-50` | Each person is responsible for half the amount |
    | `Person A` | Person A is responsible for the full amount |
    | `Person B` | Person B is responsible for the full amount |

    > The **Payer** field records who physically paid. The **Split** field records who owes what.
    > These are tracked independently so the balance is always accurate.
    """
)

st.sidebar.success("Select a page above to get started.")
