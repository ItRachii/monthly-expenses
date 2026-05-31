import os
import sys

current_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.append(current_dir)

from backend.database import get_session
from backend.models import GroupInvite

def main():
    session = get_session()
    try:
        invites = session.query(GroupInvite).all()
        print(f"Total invites found: {len(invites)}")
        for inv in invites:
            print(f"ID: {inv.id}, Group: {inv.group_id}, Invited: {inv.invited_email}, Status: {inv.status}")
    finally:
        session.close()

if __name__ == "__main__":
    main()
