import hashlib
import os

import streamlit as st

from db.database import get_session

_DEFAULT_USERS = [
    ("person_a", "Person A", "PersonA@123"),
    ("person_b", "Person B", "PersonB@123"),
]


# ── Password helpers ──────────────────────────────────────────────────────────

def hash_password(password: str) -> str:
    """Return a 'salt:hash' string using PBKDF2-HMAC-SHA256."""
    salt = os.urandom(16).hex()
    key = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt.encode("utf-8"), 260_000
    )
    return f"{salt}:{key.hex()}"


def verify_password(password: str, stored: str) -> bool:
    """Verify a plain password against a stored 'salt:hash' string."""
    try:
        salt, key = stored.split(":", 1)
        new_key = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), salt.encode("utf-8"), 260_000
        )
        return new_key.hex() == key
    except Exception:
        return False


# ── DB helpers ────────────────────────────────────────────────────────────────

def seed_default_users() -> None:
    """Insert default users on first run (no-op if users already exist)."""
    from db.models import User

    session = get_session()
    try:
        if session.query(User).count() == 0:
            for username, display_name, password in _DEFAULT_USERS:
                session.add(User(
                    username=username,
                    password_hash=hash_password(password),
                    display_name=display_name,
                ))
            session.commit()
    finally:
        session.close()


def authenticate(username: str, password: str):
    """Return a user dict if credentials are valid, else None."""
    from db.models import User

    session = get_session()
    try:
        user = session.query(User).filter_by(username=username.strip().lower()).first()
        if user and verify_password(password, user.password_hash):
            return {"username": user.username, "display_name": user.display_name}
        return None
    finally:
        session.close()


def setup() -> None:
    """Initialise the DB and seed default users. Call at the top of every page."""
    from db.database import init_db
    init_db()
    seed_default_users()


# ── Streamlit auth ────────────────────────────────────────────────────────────

def require_login() -> None:
    """
    Enforce authentication. If not logged in, show the login form and stop.
    If logged in, render the user info + logout button in the sidebar.
    """
    if not st.session_state.get("logged_in", False):
        _show_login_form()
        st.stop()

    # Sidebar: logged-in user + logout
    with st.sidebar:
        st.markdown(f"Signed in as **{st.session_state.display_name}**")
        if st.button("Logout", key="_logout"):
            st.session_state.logged_in = False
            st.session_state.username = None
            st.session_state.display_name = None
            st.rerun()
        st.divider()


def _show_login_form() -> None:
    """Render the centred login card."""
    st.markdown(
        """
        <style>
        /* hide the default sidebar on the login screen */
        [data-testid="stSidebar"] { display: none; }
        </style>
        """,
        unsafe_allow_html=True,
    )

    _, col, _ = st.columns([1, 1.4, 1])
    with col:
        st.markdown(
            "<h2 style='text-align:center; margin-bottom:0'>💸 Expense Tracker</h2>",
            unsafe_allow_html=True,
        )
        st.markdown(
            "<p style='text-align:center; color:gray; margin-top:4px'>Sign in to continue</p>",
            unsafe_allow_html=True,
        )
        st.divider()

        with st.form("login_form"):
            username = st.text_input("Username", placeholder="e.g. person_a")
            password = st.text_input("Password", type="password")
            submitted = st.form_submit_button(
                "Sign In", type="primary", use_container_width=True
            )

        if submitted:
            if not username.strip() or not password:
                st.error("Enter both username and password.")
            else:
                user = authenticate(username, password)
                if user:
                    st.session_state.logged_in = True
                    st.session_state.username = user["username"]
                    st.session_state.display_name = user["display_name"]
                    st.rerun()
                else:
                    st.error("Invalid username or password.")
