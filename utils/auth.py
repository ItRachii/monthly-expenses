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
    """Render the LEDGER split-screen login page."""
    import os

    # ── Minimal CSS: only targets Streamlit shell elements, never custom divs ──
    st.markdown(
        """
        <style>
        [data-testid="stHeader"], footer { display: none !important; }
        .block-container { max-width: 100% !important; padding: 2rem 3rem !important; }
        </style>
        """,
        unsafe_allow_html=True,
    )

    col_left, col_right = st.columns(2, gap="large")

    # ── Left half ──────────────────────────────────────────────────────────────
    with col_left:
        # Push content down to roughly mid-screen
        for _ in range(8):
            st.write("")

        st.markdown(
            "<p style='font-size:4.5rem;font-weight:900;color:#FAFAFA;"
            "letter-spacing:0.12em;line-height:1;margin:0 0 0.6rem;'>LEDGER</p>",
            unsafe_allow_html=True,
        )
        st.markdown(
            "<p style='font-size:1rem;color:#8B9DB8;margin:0 0 2rem;'>Track every expense, own every dollar.</p>",
            unsafe_allow_html=True,
        )
        st.button(
            "🔐  Sign in with Google",
            on_click=st.login,
            type="primary",
            key="google_login_btn",
        )

    # ── Right half: image ──────────────────────────────────────────────────────
    with col_right:
        hero_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static", "login_hero.png")
        if os.path.exists(hero_path):
            st.image(hero_path, use_container_width=True)

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
                new_user = AppUser(
                    email=email,
                    first_name=fname,
                    system_role="member"
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


