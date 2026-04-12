"""
Group management helpers for the Monthly Expense Tracker.

Groups are private shared workspaces.  Only members can see or add expenses
for a group.  The creator is automatically an admin member.
Invites are sent by email — if the invitee is already a registered user the
invite shows immediately in their UI.
"""
from __future__ import annotations

import datetime
from typing import Optional

import streamlit as st


# ── Context helpers ──────────────────────────────────────────────────────────


def get_active_context() -> dict:
    """
    Return the currently active context dict.

    Shape:
      {"type": "personal", "email": str}          # personal expenses
      {"type": "group", "group_id": int, "group_name": str}  # group expenses
    """
    return st.session_state.get("active_context", {"type": "personal", "email": ""})


def set_active_context(ctx: dict):
    st.session_state["active_context"] = ctx


def is_personal_context() -> bool:
    return get_active_context().get("type") == "personal"


def get_context_group_id() -> Optional[int]:
    ctx = get_active_context()
    return ctx.get("group_id") if ctx.get("type") == "group" else None


# ── Group CRUD ───────────────────────────────────────────────────────────────


def create_group(name: str, description: str, creator_email: str) -> int:
    """Create a group and add creator as admin. Returns new group id."""
    import secrets
    from db.database import get_session
    from db.models import Group, GroupMember

    session = get_session()
    try:
        now = datetime.datetime.now()
        group = Group(
            name=name.strip(),
            description=description.strip() or None,
            invite_code=secrets.token_hex(8),   # satisfies legacy NOT NULL column
            created_by=creator_email,
            created_at=now,
        )
        session.add(group)
        session.flush()  # get group.id
        member = GroupMember(
            group_id=group.id,
            email=creator_email,
            display_name=None,
            role="admin",
            joined_at=now,
        )
        session.add(member)
        session.commit()
        return group.id
    finally:
        session.close()


def get_user_groups(user_email: str) -> list[dict]:
    """Return all groups the user is a member of."""
    from db.database import get_session
    from db.models import Group, GroupMember

    session = get_session()
    try:
        rows = (
            session.query(Group, GroupMember)
            .join(GroupMember, Group.id == GroupMember.group_id)
            .filter(GroupMember.email == user_email)
            .order_by(Group.created_at.desc())
            .all()
        )
        return [
            {
                "id": g.id,
                "name": g.name,
                "description": g.description,
                "created_by": g.created_by,
                "created_at": g.created_at,
                "role": m.role or "member",
            }
            for g, m in rows
        ]
    finally:
        session.close()


def get_group(group_id: int) -> Optional[dict]:
    """Fetch a single group by id."""
    from db.database import get_session
    from db.models import Group

    session = get_session()
    try:
        g = session.query(Group).filter_by(id=group_id).first()
        if not g:
            return None
        return {
            "id": g.id,
            "name": g.name,
            "description": g.description,
            "created_by": g.created_by,
            "created_at": g.created_at,
        }
    finally:
        session.close()


def get_group_members(group_id: int) -> list[dict]:
    """Return all current members of a group with their display info."""
    from db.database import get_session
    from db.models import GroupMember, AppUser

    session = get_session()
    try:
        rows = (
            session.query(GroupMember, AppUser)
            .outerjoin(AppUser, GroupMember.email == AppUser.email)
            .filter(GroupMember.group_id == group_id)
            .all()
        )
        result = []
        for m, u in rows:
            if u:
                display = u.username.strip() if (u.username and u.username.strip()) else u.first_name
            else:
                # Fallback if user hasn't registered yet
                display = m.display_name or m.email
            result.append({
                "email": m.email,
                "display_name": display,
                "role": m.role or "member",
                "joined_at": m.joined_at,
            })
        return result
    finally:
        session.close()


def is_group_member(group_id: int, user_email: str) -> bool:
    from db.database import get_session
    from db.models import GroupMember

    session = get_session()
    try:
        return (
            session.query(GroupMember)
            .filter_by(group_id=group_id, email=user_email)
            .first()
        ) is not None
    finally:
        session.close()


def remove_member(group_id: int, user_email: str):
    """Remove a member from a group (admin action or self-leave)."""
    from db.database import get_session
    from db.models import GroupMember

    session = get_session()
    try:
        session.query(GroupMember).filter_by(group_id=group_id, email=user_email).delete()
        session.commit()
    finally:
        session.close()


def delete_group(group_id: int):
    """Delete a group and all its members/invites (cascade)."""
    from db.database import get_session
    from db.models import Group

    session = get_session()
    try:
        session.query(Group).filter_by(id=group_id).delete()
        session.commit()
    finally:
        session.close()


# ── Invites ───────────────────────────────────────────────────────────────────


def send_invite(group_id: int, invited_email: str, invited_by: str) -> str:
    """
    Create an invite record.  Returns 'ok', 'already_member', or 'already_invited'.
    """
    from db.database import get_session
    from db.models import GroupInvite, GroupMember

    email = invited_email.strip().lower()
    session = get_session()
    try:
        # Already a member?
        existing_member = (
            session.query(GroupMember)
            .filter_by(group_id=group_id, email=email)
            .first()
        )
        if existing_member:
            return "already_member"

        # Already a pending invite?
        existing_invite = (
            session.query(GroupInvite)
            .filter_by(group_id=group_id, invited_email=email, status="pending")
            .first()
        )
        if existing_invite:
            return "already_invited"

        invite = GroupInvite(
            group_id=group_id,
            invited_email=email,
            invited_by=invited_by,
            status="pending",
            created_at=datetime.datetime.now(),
        )
        session.add(invite)
        session.commit()
        return "ok"
    finally:
        session.close()


def get_pending_invites_for_user(user_email: str) -> list[dict]:
    """Return pending invites for this user (matched by email)."""
    from db.database import get_session
    from db.models import GroupInvite, Group

    session = get_session()
    try:
        rows = (
            session.query(GroupInvite, Group)
            .join(Group, GroupInvite.group_id == Group.id)
            .filter(
                GroupInvite.invited_email == user_email.lower(),
                GroupInvite.status == "pending",
            )
            .all()
        )
        return [
            {
                "invite_id": inv.id,
                "group_id": inv.group_id,
                "group_name": grp.name,
                "group_description": grp.description,
                "invited_by": inv.invited_by,
                "created_at": inv.created_at,
            }
            for inv, grp in rows
        ]
    finally:
        session.close()


def respond_to_invite(invite_id: int, accept: bool, user_email: str):
    """Accept or decline an invite."""
    from db.database import get_session
    from db.models import GroupInvite, GroupMember

    session = get_session()
    try:
        invite = session.query(GroupInvite).filter_by(id=invite_id).first()
        if not invite or invite.invited_email != user_email.lower():
            return
        invite.status = "accepted" if accept else "declined"
        invite.responded_at = datetime.datetime.now()

        if accept:
            member = GroupMember(
                group_id=invite.group_id,
                email=user_email,
                display_name=None,
                role="member",
                joined_at=datetime.datetime.now(),
            )
            session.add(member)

        session.commit()
    finally:
        session.close()


def get_group_invites(group_id: int) -> list[dict]:
    """Return all invites (any status) for a group (for admin view)."""
    from db.database import get_session
    from db.models import GroupInvite

    session = get_session()
    try:
        rows = session.query(GroupInvite).filter_by(group_id=group_id).all()
        return [
            {
                "id": inv.id,
                "invited_email": inv.invited_email,
                "invited_by": inv.invited_by,
                "status": inv.status,
                "created_at": inv.created_at,
                "responded_at": inv.responded_at,
            }
            for inv in rows
        ]
    finally:
        session.close()


def cancel_invite(invite_id: int):
    """Cancel (delete) a pending invite."""
    from db.database import get_session
    from db.models import GroupInvite

    session = get_session()
    try:
        session.query(GroupInvite).filter_by(id=invite_id).delete()
        session.commit()
    finally:
        session.close()
