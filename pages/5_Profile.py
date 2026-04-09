import streamlit as st
from db.database import get_session
from utils.auth import require_login
from db.models import AppUser

require_login()

st.set_page_config(page_title="Profile", page_icon="👤", layout="wide")
st.title("User Profile")

st.markdown("Customize your display name across the application.")

if "app_user" in st.session_state:
    user = st.session_state.app_user
    
    with st.form("profile_form"):
        st.write(f"**Email:** {user['email']}")
        st.write(f"**First Name:** {user['first_name']}")
        st.write(f"**System Role:** {user['system_role']}")
        
        # Determine current username for default value
        current_username = user.get("username", "") or ""
        
        new_username = st.text_input("Username (Optional)", value=current_username, placeholder="Enter an alias or custom display name")
        
        submitted = st.form_submit_button("Save Profile")
        
        if submitted:
            session = get_session()
            try:
                db_user = session.query(AppUser).filter_by(email=user['email']).first()
                db_user.username = new_username.strip() if new_username.strip() else None
                session.commit()
                st.session_state.app_user = {
                    "email": db_user.email,
                    "first_name": db_user.first_name,
                    "username": db_user.username,
                    "system_role": db_user.system_role
                }
                
                # Clear the cache for user names
                st.cache_data.clear()
                
                st.success("Profile updated successfully!")
                st.rerun()
            finally:
                session.close()
else:
    st.error("User profile not found. Please try logging in again.")
