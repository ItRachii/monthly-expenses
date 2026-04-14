import streamlit as st
from backend.database import init_db, engine, get_session
from backend.models import Expense
from utils.auth import (
    show_login_page,
    register_user_if_needed,
    display_user_profile,
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
        Use the selector at the top of each page to switch between Personal and a Group.

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

    current_email = getattr(st.user, "email", "")
    if current_email:
        from utils.groups import get_pending_invites_for_user, respond_to_invite
        pending = get_pending_invites_for_user(current_email)
        if pending:
            st.divider()
            st.subheader(f"📬 You have {len(pending)} pending group invite{'s' if len(pending) > 1 else ''}!")
            for inv in pending:
                with st.container(border=True):
                    c1, c2, c3 = st.columns([4, 1, 1])
                    c1.markdown(
                        f"**{inv['group_name']}**"
                        + (f" — {inv['group_description']}" if inv['group_description'] else "")
                        + f"\n\n_Invited by {inv['invited_by']}_"
                    )
                    if c2.button("✅ Accept", key=f"home_accept_{inv['invite_id']}"):
                        respond_to_invite(inv["invite_id"], accept=True, user_email=current_email)
                        st.success(f"Joined **{inv['group_name']}**!")
                        st.rerun()
                    if c3.button("❌ Decline", key=f"home_decline_{inv['invite_id']}"):
                        respond_to_invite(inv["invite_id"], accept=False, user_email=current_email)
                        st.info("Invite declined.")
                        st.rerun()

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

# 3. Sidebar Navigation (Middle)
home = st.Page(home_page, title="Home", icon="🏠")
add_exp = st.Page("pages/1_Add_Expense.py", title="Add Expense", icon="➕")
log_page = st.Page("pages/2_Expense_Log.py", title="Expense Log", icon="📋")
summary = st.Page("pages/3_Monthly_Summary.py", title="Monthly Summary", icon="📊")
settlement = st.Page("pages/4_Settlement.py", title="Settlement", icon="💰")
profile = st.Page("pages/5_Profile.py", title="Profile", icon="👤")
groups = st.Page("pages/6_Groups.py", title="Groups", icon="👥")

pg = st.navigation([home, add_exp, log_page, summary, settlement, groups, profile])

# 4. Sidebar Logout rendering (Bottom)
if is_logged_in:
    display_logout_button()

# 5. Run Selected Page
pg.run()

