import os
import sys

current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
sys.path.append(parent_dir)

from db.database import engine, get_session
from db.models import AppUser

def main():
    print("Listing AppUser records...")
    session = get_session()
    try:
        users = session.query(AppUser).all()
        for u in users:
            print(f"Email: {u.email}, First Name: {u.first_name}, Username: {u.username}, Role: {u.system_role}")
    finally:
        session.close()

if __name__ == "__main__":
    main()
