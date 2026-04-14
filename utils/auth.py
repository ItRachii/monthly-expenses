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
    """Render the mibu-branded login screen and stop the script."""

    # ── Styling ────────────────────────────────────────────────────────────────
    st.markdown(
        """
        <style>
        /* White background override */
        .stApp,
        [data-testid="stAppViewContainer"],
        [data-testid="stHeader"],
        section[data-testid="stSidebar"] { background-color: #ffffff !important; }

        /* Center and constrain content */
        .block-container {
            max-width: 480px !important;
            padding-top: 1.5rem !important;
            margin: 0 auto !important;
        }

        /* Dark rounded Sign In button */
        div[data-testid="stButton"] > button {
            background-color: #111111 !important;
            color: #ffffff !important;
            border: none !important;
            border-radius: 50px !important;
            padding: 0.65rem 2rem !important;
            font-size: 1rem !important;
            font-weight: 600 !important;
            letter-spacing: 0.01em !important;
        }
        div[data-testid="stButton"] > button:hover {
            background-color: #333333 !important;
            border: none !important;
        }

        footer, header { display: none !important; }
        </style>
        """,
        unsafe_allow_html=True,
    )

    # ── Main layout HTML ───────────────────────────────────────────────────────
    st.markdown(
        """
        <div style="text-align:center; background:#ffffff; padding:0.5rem 0 0;">

          <!-- Floating pills + illustration -->
          <div style="position:relative; width:320px; height:330px; margin:0 auto 0.5rem;">

            <!-- balance — top centre -->
            <span style="position:absolute; top:0; left:50%; transform:translateX(-50%);
                         border:1.8px solid #1a1a1a; border-radius:50px;
                         padding:7px 20px; font-size:14px; color:#1a1a1a;
                         background:#fff; white-space:nowrap;">balance</span>

            <!-- income — upper left -->
            <span style="position:absolute; top:66px; left:2px;
                         border:1.8px solid #1a1a1a; border-radius:50px;
                         padding:7px 20px; font-size:14px; color:#1a1a1a; background:#fff;">income</span>

            <!-- expenses — upper right -->
            <span style="position:absolute; top:66px; right:0;
                         border:1.8px solid #1a1a1a; border-radius:50px;
                         padding:7px 20px; font-size:14px; color:#1a1a1a; background:#fff;">expenses</span>

            <!-- fun — mid left -->
            <span style="position:absolute; top:144px; left:0;
                         border:1.8px solid #1a1a1a; border-radius:50px;
                         padding:7px 20px; font-size:14px; color:#1a1a1a; background:#fff;">fun</span>

            <!-- food — mid right -->
            <span style="position:absolute; top:144px; right:4px;
                         border:1.8px solid #1a1a1a; border-radius:50px;
                         padding:7px 20px; font-size:14px; color:#1a1a1a; background:#fff;">food</span>

            <!-- retire — lower left -->
            <span style="position:absolute; top:222px; left:2px;
                         border:1.8px solid #1a1a1a; border-radius:50px;
                         padding:7px 20px; font-size:14px; color:#1a1a1a; background:#fff;">retire</span>

            <!-- travel — lower right -->
            <span style="position:absolute; top:222px; right:0;
                         border:1.8px solid #1a1a1a; border-radius:50px;
                         padding:7px 20px; font-size:14px; color:#1a1a1a; background:#fff;">travel</span>

            <!-- Line-art character illustration -->
            <div style="position:absolute; top:16px; left:50%; transform:translateX(-50%);">
              <svg width="140" height="260" viewBox="0 0 140 260" fill="none"
                   xmlns="http://www.w3.org/2000/svg">
                <!-- Head -->
                <ellipse cx="70" cy="56" rx="32" ry="36" fill="white" stroke="#1a1a1a" stroke-width="2.5"/>
                <!-- Hair -->
                <path d="M39 50 Q37 20 70 13 Q103 20 101 50"
                      fill="none" stroke="#1a1a1a" stroke-width="2.5"/>
                <path d="M39 44 Q35 26 46 17" fill="none" stroke="#1a1a1a" stroke-width="2"/>
                <path d="M101 44 Q105 26 94 17" fill="none" stroke="#1a1a1a" stroke-width="2"/>
                <!-- Eyes -->
                <circle cx="57" cy="53" r="3.5" fill="#1a1a1a"/>
                <circle cx="83" cy="53" r="3.5" fill="#1a1a1a"/>
                <!-- Nose -->
                <path d="M70 61 Q68 68 70 70 Q72 68 70 61"
                      fill="none" stroke="#1a1a1a" stroke-width="1.6"/>
                <!-- Neck -->
                <path d="M61 91 L59 107" stroke="#1a1a1a" stroke-width="2.2"/>
                <path d="M79 91 L81 107" stroke="#1a1a1a" stroke-width="2.2"/>
                <!-- Blazer — left side -->
                <path d="M59 107 Q33 120 17 195" fill="none" stroke="#1a1a1a" stroke-width="2.5"/>
                <!-- Blazer — right side -->
                <path d="M81 107 Q107 120 123 195" fill="none" stroke="#1a1a1a" stroke-width="2.5"/>
                <!-- Blazer — hem -->
                <path d="M17 195 Q70 202 123 195" fill="none" stroke="#1a1a1a" stroke-width="2.5"/>
                <!-- Left lapel -->
                <path d="M59 107 L53 132 L70 125" fill="none" stroke="#1a1a1a" stroke-width="2"/>
                <!-- Right lapel -->
                <path d="M81 107 L87 132 L70 125" fill="none" stroke="#1a1a1a" stroke-width="2"/>
                <!-- Shirt collar -->
                <path d="M62 107 L70 117 L78 107" fill="none" stroke="#1a1a1a" stroke-width="1.6"/>
              </svg>
            </div>
          </div>

          <!-- mibu branding -->
          <div style="font-size:4.2rem; font-weight:900; color:#111111;
                      letter-spacing:-3px; line-height:1;
                      font-family:'Arial Black','Arial Bold',Gadget,sans-serif;">mibu</div>
          <p style="font-size:1rem; color:#666666; margin:0.4rem 0 1.6rem;
                    letter-spacing:0.03em;">your minimal budgeting app</p>
        </div>
        """,
        unsafe_allow_html=True,
    )

    # ── Sign In button ─────────────────────────────────────────────────────────
    col_l, col_c, col_r = st.columns([1, 2, 1])
    with col_c:
        st.button(
            "Sign In",
            on_click=st.login,
            use_container_width=True,
            type="primary",
            key="signin_btn",
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

