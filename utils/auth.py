"""
Authentication helper for the Monthly Expense Tracker.

Uses Streamlit's native OIDC support (st.login / st.user / st.logout),
available since Streamlit 1.42.  Credentials live in
.streamlit/secrets.toml (never committed; see secrets.toml.example).

Auto-logoff: Streamlit's identity cookie already expires after 30 days
of inactivity — no extra code required.
"""

import streamlit as st


def show_login_page() -> None:
    """Render a branded login screen and stop the script."""
    st.set_page_config(
        page_title="Monthly Expense Tracker — Sign In",
        page_icon="💸",
        layout="centered",
    )

    # ── Styling ────────────────────────────────────────────────────────────────
    st.markdown(
        """
        <style>
        /* Center the login card */
        .block-container { max-width: 480px; padding-top: 5rem; }

        /* Card */
        .login-card {
            background: linear-gradient(135deg, #1C1F26 0%, #12151C 100%);
            border: 1px solid rgba(76, 114, 176, 0.35);
            border-radius: 20px;
            padding: 2.5rem 2rem 2rem;
            text-align: center;
            box-shadow: 0 8px 40px rgba(0,0,0,0.45);
        }

        /* Emoji logo */
        .login-emoji { font-size: 3.5rem; display: block; margin-bottom: 0.4rem; }

        /* Headline */
        .login-title {
            font-size: 1.7rem;
            font-weight: 700;
            color: #FAFAFA;
            margin: 0 0 0.25rem;
        }
        .login-subtitle {
            font-size: 0.95rem;
            color: #8B9DB8;
            margin-bottom: 1.8rem;
        }

        /* Divider */
        .login-divider {
            border: none;
            border-top: 1px solid rgba(255,255,255,0.08);
            margin: 1.5rem 0;
        }

        /* Footer note */
        .login-note {
            font-size: 0.78rem;
            color: #5A6A80;
            margin-top: 1rem;
        }
        </style>
        """,
        unsafe_allow_html=True,
    )

    # ── Card HTML ──────────────────────────────────────────────────────────────
    st.markdown(
        """
        <div class="login-card">
          <span class="login-emoji">💸</span>
          <p class="login-title">Monthly Expense Tracker</p>
          <p class="login-subtitle">Shared expense tracking for two people.</p>
          <hr class="login-divider">
        </div>
        """,
        unsafe_allow_html=True,
    )

    # Centered Google login button
    col_l, col_c, col_r = st.columns([1, 2, 1])
    with col_c:
        st.button(
            "🔐  Sign in with Google",
            on_click=st.login,
            use_container_width=True,
            type="primary",
            key="google_login_btn",
        )

    st.markdown(
        '<p class="login-note">Sessions expire automatically after 30 days of inactivity.</p>',
        unsafe_allow_html=True,
    )
    st.stop()


def require_login() -> None:
    """
    Call at the top of every page.

    - If st.user.is_logged_in is unavailable (OIDC not configured), skips auth.
    - If the user is not authenticated, renders the login screen and stops.
    - If the user is authenticated, injects a sidebar logout button.
    """
    # Guard: st.user.is_logged_in only exists when [auth] secrets are configured.
    is_logged_in = getattr(st.user, "is_logged_in", None)

    if is_logged_in is None:
        # Auth not configured — skip auth entirely (dev mode / missing secrets).
        return

    if not is_logged_in:
        show_login_page()

    # Auto-register user in database if they don't exist
    from db.database import get_session
    from db.models import AppUser
    
    email = getattr(st.user, "email", "")
    fname = getattr(st.user, "name", "User").split()[0]
    
    if email:
        session = get_session()
        try:
            user = session.query(AppUser).filter_by(email=email).first()
            if not user:
                # Count current users to assign role
                user_count = session.query(AppUser).count()
                role = "Person A" if user_count == 0 else "Person B"
                
                # If there are already >= 2 users, we can just assign them a transient role
                # but let's stick to Person B for anyone > 1
                
                new_user = AppUser(
                    email=email,
                    first_name=fname,
                    system_role=role
                )
                session.add(new_user)
                session.commit()
                st.session_state.app_user = new_user
            else:
                st.session_state.app_user = user
        finally:
            session.close()

    # ── Sidebar: user info + logout ────────────────────────────────────────────
    with st.sidebar:
        avatar = getattr(st.user, "picture", None)
        # Use custom username if set, else display first name, else full name
        custom_name = st.session_state.app_user.username if "app_user" in st.session_state and st.session_state.app_user.username else fname
        
        name = custom_name or getattr(st.user, "name", None) or email

        if avatar:
            col_av, col_txt = st.columns([1, 3])
            with col_av:
                st.image(avatar, width=48)
            with col_txt:
                st.markdown(f"**{name}**")
                st.caption(email)
        else:
            st.markdown(f"👤 **{name}**")
            if email:
                st.caption(email)

        st.divider()
        st.button("Sign out", on_click=st.logout, use_container_width=True)
        st.divider()

@st.cache_data(ttl=60)
def get_user_names() -> dict:
    """
    Returns a mapping of system roles to current user display names.
    E.g. {"Person A": "Rachit", "Person B": "John", "50-50": "50-50"}
    """
    from db.database import get_session
    from db.models import AppUser
    
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
