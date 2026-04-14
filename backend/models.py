import uuid
from sqlalchemy import Column, Integer, String, Float, Date, DateTime, Boolean, ForeignKey
from sqlalchemy.orm import relationship
from backend.database import Base


class Expense(Base):
    __tablename__ = "expenses"

    id = Column(Integer, primary_key=True, autoincrement=True)
    date = Column(Date, nullable=False)
    category = Column(String, nullable=False)
    item = Column(String, nullable=False)
    amount = Column(Float, nullable=False)
    payer = Column(String, nullable=False)
    split = Column(String, nullable=False)

    # Context: either personal (owner_email set, group_id null)
    #          or group  (group_id set, owner_email null)
    owner_email = Column(String, nullable=True)
    group_id = Column(String, ForeignKey("groups.id"), nullable=True)


class Settlement(Base):
    __tablename__ = "settlements"

    id = Column(Integer, primary_key=True, autoincrement=True)
    month = Column(String, nullable=False)          # "YYYY-MM"
    settled_at = Column(DateTime, nullable=False)
    settled_by = Column(String, nullable=False)
    amount = Column(Float, nullable=False)
    note = Column(String, nullable=True)

    # Context
    owner_email = Column(String, nullable=True)
    group_id = Column(String, ForeignKey("groups.id"), nullable=True)


class AppUser(Base):
    __tablename__ = "app_users"

    email = Column(String, primary_key=True)
    first_name = Column(String, nullable=False)
    username = Column(String, nullable=True)
    system_role = Column(String, nullable=False)     # "Person A" or "Person B"


class Group(Base):
    __tablename__ = "groups"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)      # added via migration
    invite_code = Column(String, nullable=True)      # legacy NOT NULL column — always populated on insert
    created_by = Column(String, ForeignKey("app_users.email"), nullable=False)
    created_at = Column(DateTime, nullable=False)
    active = Column(Integer, nullable=False, default=1)

    members = relationship("GroupMember", back_populates="group", cascade="all, delete-orphan")
    invites = relationship("GroupInvite", back_populates="group", cascade="all, delete-orphan")


class GroupMember(Base):
    """
    Existing DB column names: id, group_id, email, display_name, joined_at
    We add:  role  (migrated in)
    Note: 'email' is the member's email; 'display_name' is kept for backwards
    compatibility but the app prefers AppUser.username / first_name via join.
    """
    __tablename__ = "group_members"

    id = Column(Integer, primary_key=True, autoincrement=True)
    group_id = Column(String, ForeignKey("groups.id"), nullable=False)
    email = Column(String, ForeignKey("app_users.email"), nullable=False)  # member's email
    display_name = Column(String, nullable=True)                            # optional cached name
    role = Column(String, nullable=True, default="member")                  # "admin" or "member"
    joined_at = Column(DateTime, nullable=False)

    group = relationship("Group", back_populates="members")


class GroupInvite(Base):
    __tablename__ = "group_invites"

    id = Column(Integer, primary_key=True, autoincrement=True)
    group_id = Column(String, ForeignKey("groups.id"), nullable=False)
    invited_email = Column(String, nullable=False)
    invited_by = Column(String, ForeignKey("app_users.email"), nullable=False)
    status = Column(String, nullable=False, default="pending")   # "pending", "accepted", "declined"
    created_at = Column(DateTime, nullable=False)
    responded_at = Column(DateTime, nullable=True)

    group = relationship("Group", back_populates="invites")

