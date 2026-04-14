"""
Groups management page.

Features:
- View all groups the current user belongs to
- Create a new group
- Invite other users by email
- Accept / decline pending invites
- Leave a group; delete a group (admin only)
- Manage members (admin only)
"""

import streamlit as st

from utils.groups import (
    create_group,
    get_user_groups,
    get_group,
    get_group_members,
    get_group_invites,
    get_pending_invites_for_user,
    send_invite,
    respond_to_invite,
    remove_member,
    delete_group,
    cancel_invite,
)

current_email = getattr(st.user, "email", "")

if not current_email:
    st.error("Please sign in to manage groups.")
    st.stop()

st.title("👥 Groups")

if "group_creation_msg" in st.session_state:
    st.success(st.session_state.pop("group_creation_msg"))

# ─────────────────────────────────────────────────────────────────────────────
# Pending Invites Banner
# ─────────────────────────────────────────────────────────────────────────────
pending = get_pending_invites_for_user(current_email)
if pending:
    st.markdown("---")
    st.subheader(f"📬 Pending Invites ({len(pending)})")
    for inv in pending:
        with st.container(border=True):
            c1, c2, c3 = st.columns([4, 1, 1])
            c1.markdown(
                f"**{inv['group_name']}**"
                + (f" — {inv['group_description']}" if inv['group_description'] else "")
                + f"\n\n_Invited by {inv['invited_by']}_"
            )
            if c2.button("✅ Accept", key=f"accept_{inv['invite_id']}"):
                respond_to_invite(inv["invite_id"], accept=True, user_email=current_email)
                st.success(f"Joined **{inv['group_name']}**!")
                st.rerun()
            if c3.button("❌ Decline", key=f"decline_{inv['invite_id']}"):
                respond_to_invite(inv["invite_id"], accept=False, user_email=current_email)
                st.info("Invite declined.")
                st.rerun()
    st.markdown("---")

# ─────────────────────────────────────────────────────────────────────────────
# My Groups
# ─────────────────────────────────────────────────────────────────────────────
my_groups = get_user_groups(current_email)

tab_my, tab_create = st.tabs(["My Groups", "Create New Group"])

with tab_my:
    if not my_groups:
        st.info("You are not part of any group yet. Create one or wait for an invite!")
    else:
        for g in my_groups:
            with st.expander(f"{'👑' if g['role'] == 'admin' else '👤'} **{g['name']}**" + (f" — {g['description']}" if g['description'] else ""), expanded=False):
                members = get_group_members(g["id"])
                is_admin = g["role"] == "admin"

                # ── Member list ──────────────────────────────────────────
                st.markdown("**Members**")
                cols = st.columns([3, 2, 1])
                cols[0].write("Name")
                cols[1].write("Role")
                cols[2].write("Action")
                for m in members:
                    mc1, mc2, mc3 = st.columns([3, 2, 1])
                    mc1.write(m["display_name"] + (" _(you)_" if m["email"] == current_email else ""))
                    mc2.write(m["role"].capitalize())
                    if is_admin and m["email"] != current_email:
                        if mc3.button("Remove", key=f"rm_{g['id']}_{m['email']}"):
                            remove_member(g["id"], m["email"])
                            st.success(f"Removed {m['display_name']}.")
                            st.rerun()

                st.markdown("---")

                # ── Invite section ───────────────────────────────────────
                st.markdown("**Invite by Email**")

                # Display invite result from previous submission (survives rerun)
                _inv_key = f"invite_result_{g['id']}"
                if _inv_key in st.session_state:
                    _res = st.session_state.pop(_inv_key)
                    if _res["level"] == "success":
                        st.success(_res["msg"])
                    elif _res["level"] == "error":
                        st.error(_res["msg"])
                    else:
                        st.warning(_res["msg"])

                with st.form(f"invite_form_{g['id']}"):
                    invite_email = st.text_input("Email address", placeholder="friend@email.com", key=f"inv_email_{g['id']}")
                    send_btn = st.form_submit_button("Send Invite")
                    if send_btn:
                        _email = invite_email.strip()
                        if not _email:
                            st.session_state[_inv_key] = {"level": "error", "msg": "Please enter an email address."}
                        else:
                            result = send_invite(g["id"], _email, invited_by=current_email)
                            if result == "ok":
                                from utils.email import send_invite_email
                                ok, err = send_invite_email(
                                    to_email=_email,
                                    group_name=g["name"],
                                    invited_by=current_email,
                                )
                                if ok:
                                    st.session_state[_inv_key] = {
                                        "level": "success",
                                        "msg": f"Invite recorded and email sent to **{_email}**.",
                                    }
                                else:
                                    st.session_state[_inv_key] = {
                                        "level": "error",
                                        "msg": f"Invite recorded for **{_email}** but email failed: {err}",
                                    }
                            elif result == "already_member":
                                st.session_state[_inv_key] = {"level": "warning", "msg": "That person is already a member of this group."}
                            elif result == "already_invited":
                                st.session_state[_inv_key] = {"level": "warning", "msg": "A pending invite already exists for that email."}
                        st.rerun()

                # ── Pending invites for this group (admin only) ──────────
                if is_admin:
                    invites = get_group_invites(g["id"])
                    pending_invites = [i for i in invites if i["status"] == "pending"]
                    if pending_invites:
                        st.markdown(f"**Pending Invites ({len(pending_invites)})**")
                        for inv in pending_invites:
                            ic1, ic2 = st.columns([4, 1])
                            ic1.write(inv["invited_email"])
                            if ic2.button("Cancel", key=f"cancel_inv_{inv['id']}"):
                                cancel_invite(inv["id"])
                                st.success("Invite cancelled.")
                                st.rerun()

                st.markdown("---")

                # ── Danger zone ──────────────────────────────────────────
                with st.expander("⚠️ Danger Zone", expanded=False):
                    if current_email != g["created_by"]:
                        st.caption("Leave this group:")
                        if st.button("Leave Group", key=f"leave_{g['id']}", type="secondary"):
                            remove_member(g["id"], current_email)
                            st.success(f"Left **{g['name']}**.")
                            st.rerun()
                    else:
                        st.caption("Delete this group (you are the creator). This cannot be undone.")
                        col_del, col_conf = st.columns(2)
                        if "confirm_delete" not in st.session_state:
                            st.session_state["confirm_delete"] = {}
                        if col_del.button("Delete Group", key=f"del_{g['id']}", type="secondary"):
                            st.session_state["confirm_delete"][g["id"]] = True
                        if st.session_state["confirm_delete"].get(g["id"]):
                            st.warning("Are you sure? All group expenses and invites will be lost.")
                            if st.button("Yes, delete permanently", key=f"del_confirm_{g['id']}"):
                                delete_group(g["id"])
                                st.session_state["confirm_delete"].pop(g["id"], None)
                                st.success(f"Group **{g['name']}** deleted.")
                                st.rerun()


# ─────────────────────────────────────────────────────────────────────────────
# Create Group
# ─────────────────────────────────────────────────────────────────────────────
with tab_create:
    st.subheader("Create a New Group")
    with st.form("create_group_form", clear_on_submit=True):
        group_name = st.text_input("Group Name *", placeholder="e.g. Apartment Mates")
        group_desc = st.text_area("Description (optional)", placeholder="What is this group for?", height=80)
        create_btn = st.form_submit_button("Create Group", type="primary")

        if create_btn:
            if not group_name.strip():
                st.error("Please enter a group name.")
            else:
                new_id = create_group(
                    name=group_name.strip(),
                    description=group_desc.strip(),
                    creator_email=current_email,
                )
                
                st.session_state["group_creation_msg"] = f"Group **{group_name.strip()}** created! You are the admin."
                st.rerun()

