import streamlit as st
from db.database import init_db, engine, get_session
from db.models import Expense
from utils.auth import (
    show_login_page,
    register_user_if_needed,
    display_user_profile,
    display_context_switcher,
    display_logout_button,
)

st.set_page_config(
    page_title="Monthly Expense Tracker",
    page_icon="💸",
    layout="wide",
)

init_db()


def home_page():
    st.title("Monthly Expense Tracker")
    st.markdown(
        """
        Track your **personal** expenses or collaborate in **groups** with others.
        Use the sidebar context switcher to toggle between Personal and a Group.

        | Page | Description |
        |------|-------------|
        | **Add Expense** | Log a new expense — date, category, amount, payer, and split |
        | **Expense Log** | View, filter, and delete expenses; export to CSV |
        | **Monthly Summary** | Charts and per-person breakdown for any month |
        | **Settlement** | See the net balance and mark months as settled |
        | **Groups** | Create groups, send invites, manage members |

        ---
        **Split types explained**

        | Split | Meaning |
        |-------|---------|
        | `50-50` | Each person is responsible for half the amount |
        | `Person X` | That person is responsible for the full amount |

        > The **Payer** field records who physically paid. The **Split** field records who owes what.
        > These are tracked independently so the balance is always accurate.
        """
    )


# 1. Auth Guard
is_logged_in = getattr(st.user, "is_logged_in", None)
if is_logged_in is False:
    show_login_page()
    st.stop()

if is_logged_in:
    register_user_if_needed()
    
# 2. Sidebar Profile rendering (Top)
if is_logged_in:
    display_user_profile()

# 3. Context switcher (below profile)
if is_logged_in:
    display_context_switcher()

# 4. Sidebar Navigation (Middle)
home = st.Page(home_page, title="Home", icon="🏠")
add_exp = st.Page("pages/1_Add_Expense.py", title="Add Expense", icon="➕")
log_page = st.Page("pages/2_Expense_Log.py", title="Expense Log", icon="📋")
summary = st.Page("pages/3_Monthly_Summary.py", title="Monthly Summary", icon="📊")
settlement = st.Page("pages/4_Settlement.py", title="Settlement", icon="💰")
profile = st.Page("pages/5_Profile.py", title="Profile", icon="👤")
groups = st.Page("pages/6_Groups.py", title="Groups", icon="👥")

pg = st.navigation([home, add_exp, log_page, summary, settlement, groups, profile])

# 5. Sidebar Logout rendering (Bottom)
if is_logged_in:
    display_logout_button()

# 6. Run Selected Page
pg.run()
