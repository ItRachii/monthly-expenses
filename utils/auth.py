"""
Authentication helper for the Monthly Expense Tracker.

Uses Streamlit's native OIDC support (st.login / st.user / st.logout),
available since Streamlit 1.42.  Credentials live in
.streamlit/secrets.toml (never committed; see secrets.toml.example).

Auto-logoff: Streamlit's identity cookie already expires after 30 days
of inactivity — no extra code required.
"""
# v2 — adds display_context_switcher for group/personal context switching
from pathlib import Path

import streamlit as st

LOGIN_ILLUSTRATION = Path(__file__).resolve().parent.parent / "assets" / "login-illustration.png"


def show_login_page() -> None:
    """Render the LEDGER split-screen login page."""

    # ── Global styles ──────────────────────────────────────────────────────────
    st.markdown(
        """
        <style>
        [data-testid="stHeader"], footer { display: none !important; }

        /* Hide sidebar completely on the login page */
        [data-testid="stSidebar"],
        [data-testid="stSidebarNav"],
        [data-testid="stSidebarNavItems"],
        [data-testid="stSidebarCollapseButton"],
        [data-testid="collapsedControl"],
        [data-testid="stSidebarHeader"],
        section[data-testid="stSidebar"] { display: none !important; }

        /* Ensure main content fills the screen now that sidebar is hidden */
        [data-testid="stAppViewContainer"] > .main,
        [data-testid="stMain"] { margin-left: 0 !important; }

        /* Remove default content padding so columns fill width */
        .block-container {
            max-width: 100% !important;
            padding: 0 !important;
        }

        /* Left panel: branding */
        .login-left {
            padding: 0 3rem;
            display: flex;
            flex-direction: column;
            justify-content: center;
            min-height: 88vh;
        }
        .ledger-title {
            font-size: 4.8rem;
            font-weight: 900;
            color: #FAFAFA;
            letter-spacing: 0.12em;
            line-height: 1;
            margin: 0 0 0.75rem;
        }
        .ledger-sub {
            font-size: 1rem;
            color: #8B9DB8;
            margin: 0 0 2.5rem;
            letter-spacing: 0.02em;
        }

        /* Right panel: illustration column */
        [data-testid="stColumn"]:nth-of-type(2) [data-testid="stVerticalBlock"] {
            min-height: 88vh;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 1.5rem;
            border-left: 1px solid rgba(255,255,255,0.08);
        }
        [data-testid="stColumn"]:nth-of-type(2) [data-testid="stImage"] img {
            max-width: 100%;
            height: auto;
            border-radius: 12px;
        }

        /* Slim down the sign-in button */
        div[data-testid="stButton"] > button {
            border-radius: 8px !important;
            padding: 0.55rem 1.6rem !important;
            font-size: 0.95rem !important;
            font-weight: 600 !important;
        }
        </style>
        """,
        unsafe_allow_html=True,
    )

    col_left, col_right = st.columns(2, gap="small")

    # ── Left half: app name + sign-in ─────────────────────────────────────────
    with col_left:
        st.markdown(
            """
            <div class="login-left">
              <div class="ledger-title">LEDGER</div>
              <div class="ledger-sub">Track every expense, own every dollar.</div>
            </div>
            """,
            unsafe_allow_html=True,
        )
        _, btn_col, _ = st.columns([0.08, 0.6, 0.32])
        with btn_col:
            st.button(
                "🔐  Sign in with Google",
                on_click=st.login,
                use_container_width=True,
                type="primary",
                key="google_login_btn",
            )

    # ── Right half: expense-tracking illustration ─────────────────────────────
    with col_right:
        if LOGIN_ILLUSTRATION.exists():
            st.image(str(LOGIN_ILLUSTRATION), use_container_width=True)
        else:
            st.warning(
                f"Login illustration not found at {LOGIN_ILLUSTRATION.relative_to(LOGIN_ILLUSTRATION.parents[1])}. "
                "Save the image to that path to display it here."
            )

    st.stop()


def register_user_if_needed() -> None:
    is_logged_in = getattr(st.user, "is_logged_in", None)
    if not is_logged_in:
        return
        
    from backend.database import get_session
    from backend.models import AppUser
    
    email = getattr(st.user, "email", "")
    fname = getattr(st.user, "name", "User").split()[0]
    
    if email:
        session = get_session()
        try:
            user = session.query(AppUser).filter_by(email=email).first()
            if not user:
                user_count = session.query(AppUser).count()
                role = "Person A" if user_count == 0 else "Person B"
                new_user = AppUser(
                    email=email,
                    first_name=fname,
                    system_role=role
                )
                session.add(new_user)
                session.commit()
                st.session_state.app_user = {
                    "email": new_user.email,
                    "first_name": new_user.first_name,
                    "username": new_user.username,
                    "system_role": new_user.system_role
                }
            else:
                st.session_state.app_user = {
                    "email": user.email,
                    "first_name": user.first_name,
                    "username": user.username,
                    "system_role": user.system_role
                }
        finally:
            session.close()

def display_user_profile() -> None:
    is_logged_in = getattr(st.user, "is_logged_in", None)
    if not is_logged_in:
        return

    with st.sidebar:
        avatar = getattr(st.user, "picture", None)
        app_user_dict = st.session_state.get("app_user", {})
        fname = getattr(st.user, "name", "User").split()[0]
        custom_name = app_user_dict.get("username") if app_user_dict else fname
        name = custom_name or getattr(st.user, "name", None) or getattr(st.user, "email", "")

        if avatar:
            st.markdown(
                f"""
                <div style="display: flex; align-items: center; margin-bottom: 20px;">
                    <img src="{avatar}" style="width: 32px; height: 32px; border-radius: 50%; margin-right: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <span style="font-size: 16px; font-weight: 600;">{name}</span>
                </div>
                """,
                unsafe_allow_html=True,
            )
        else:
            st.markdown(
                f"""
                <div style="display: flex; align-items: center; margin-bottom: 20px;">
                    <span style="font-size: 24px; margin-right: 12px;">👤</span>
                    <span style="font-size: 16px; font-weight: 600;">{name}</span>
                </div>
                """,
                unsafe_allow_html=True,
            )


def display_logout_button() -> None:
    is_logged_in = getattr(st.user, "is_logged_in", None)
    if not is_logged_in:
        return
        
    with st.sidebar:
        st.markdown("<hr style='margin-top: 20px; margin-bottom: 20px;'>", unsafe_allow_html=True)
        st.button("Sign out", on_click=st.logout, use_container_width=True)

@st.cache_data(ttl=60)
def get_user_names() -> dict:
    """
    Returns a mapping of system roles to current user display names.
    E.g. {"Person A": "Rachit", "Person B": "John", "50-50": "50-50"}
    """
    from backend.database import get_session
    from backend.models import AppUser
    
    mapping = {"Person A": "Person A", "Person B": "Person B", "50-50": "50-50"}
    session = get_session()
    try:
        users = session.query(AppUser).all()
        for u in users:
            display = u.username.strip() if (u.username and u.username.strip()) else u.first_name
            mapping[u.system_role] = display
    finally:
        session.close()
    return mapping
