"""
Authentication helper for the Monthly Expense Tracker.

Uses Streamlit's native OIDC support (st.login / st.user / st.logout),
available since Streamlit 1.42.  Credentials live in
.streamlit/secrets.toml (never committed; see secrets.toml.example).

Auto-logoff: Streamlit's identity cookie already expires after 30 days
of inactivity — no extra code required.
"""
# v2 — adds display_context_switcher for group/personal context switching
import streamlit as st


def show_login_page() -> None:
    """Render a branded login screen and stop the script."""

    st.markdown(
        """
        <style>
        .block-container { max-width: 480px; padding-top: 4rem; }
        </style>
        """,
        unsafe_allow_html=True,
    )

    # ── Line-art character illustration ───────────────────────────────────────
    st.markdown(
        """
        <div style="display:flex; justify-content:center; margin-bottom:2rem;">
          <svg width="180" height="260" viewBox="0 0 180 260" fill="none"
               xmlns="http://www.w3.org/2000/svg">
            <!-- Head -->
            <ellipse cx="90" cy="66" rx="38" ry="43" fill="none" stroke="#FAFAFA" stroke-width="2.5"/>
            <!-- Hair — top arc + side wisps -->
            <path d="M54 60 Q52 26 90 16 Q128 26 126 60"
                  fill="none" stroke="#FAFAFA" stroke-width="2.5"/>
            <path d="M54 53 Q49 32 62 21" fill="none" stroke="#FAFAFA" stroke-width="2"/>
            <path d="M126 53 Q131 32 118 21" fill="none" stroke="#FAFAFA" stroke-width="2"/>
            <!-- Eyes -->
            <circle cx="75" cy="63" r="4" fill="#FAFAFA"/>
            <circle cx="105" cy="63" r="4" fill="#FAFAFA"/>
            <!-- Nose -->
            <path d="M90 72 Q88 80 90 83 Q92 80 90 72"
                  fill="none" stroke="#FAFAFA" stroke-width="1.8"/>
            <!-- Neck -->
            <path d="M80 108 L78 124" stroke="#FAFAFA" stroke-width="2.2"/>
            <path d="M100 108 L102 124" stroke="#FAFAFA" stroke-width="2.2"/>
            <!-- Blazer — left shoulder/side -->
            <path d="M78 124 Q48 138 28 220"
                  fill="none" stroke="#FAFAFA" stroke-width="2.5"/>
            <!-- Blazer — right shoulder/side -->
            <path d="M102 124 Q132 138 152 220"
                  fill="none" stroke="#FAFAFA" stroke-width="2.5"/>
            <!-- Blazer — hem -->
            <path d="M28 220 Q90 228 152 220"
                  fill="none" stroke="#FAFAFA" stroke-width="2.5"/>
            <!-- Left lapel -->
            <path d="M78 124 L70 152 L90 144"
                  fill="none" stroke="#FAFAFA" stroke-width="2"/>
            <!-- Right lapel -->
            <path d="M102 124 L110 152 L90 144"
                  fill="none" stroke="#FAFAFA" stroke-width="2"/>
            <!-- Shirt collar -->
            <path d="M82 124 L90 136 L98 124"
                  fill="none" stroke="#FAFAFA" stroke-width="1.8"/>
          </svg>
        </div>
        """,
        unsafe_allow_html=True,
    )

    # ── Google sign-in button ──────────────────────────────────────────────────
    col_l, col_c, col_r = st.columns([1, 2, 1])
    with col_c:
        st.button(
            "🔐  Sign in with Google",
            on_click=st.login,
            use_container_width=True,
            type="primary",
            key="google_login_btn",
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

