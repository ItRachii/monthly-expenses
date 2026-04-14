"""SMTP email helper for sending group invite notifications."""
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import streamlit as st


def _get_smtp_config() -> dict:
    """
    Read SMTP credentials from Streamlit secrets.

    Supports three key layouts — use whichever matches your secrets.toml:

    Layout 1 — same keys as a .env file (recommended, matches the working app):
        SMTP_SERVER   = "smtp.gmail.com"
        SMTP_PORT     = "587"
        SMTP_USERNAME = "you@gmail.com"
        SMTP_PASSWORD = "abcd efgh ijkl mnop"   # spaces are stripped automatically
        EMAIL_FROM    = "you@gmail.com"          # optional

    Layout 2 — nested [smtp] section:
        [smtp]
        host = "smtp.gmail.com"  port = 587
        username = "you@gmail.com"  password = "..."

    Layout 3 — flat smtp_ keys:
        smtp_host = "smtp.gmail.com"  smtp_username = "..."  etc.
    """
    s = st.secrets

    # Layout 1: uppercase .env-style keys (SMTP_SERVER, SMTP_USERNAME, ...)
    if "SMTP_USERNAME" in s:
        return {
            "host": str(s.get("SMTP_SERVER", "smtp.gmail.com")),
            "port": int(s.get("SMTP_PORT", 587)),
            "username": str(s["SMTP_USERNAME"]).strip(),
            "password": str(s["SMTP_PASSWORD"]).strip(),
            "from_email": str(s.get("EMAIL_FROM", s["SMTP_USERNAME"])).strip(),
        }

    # Layout 2: [smtp] section
    if "smtp" in s:
        cfg = s["smtp"]
        raw_pass = str(cfg["password"])
        return {
            "host": str(cfg.get("host", "smtp.gmail.com")),
            "port": int(cfg.get("port", 587)),
            "username": str(cfg["username"]).strip(),
            "password": raw_pass.replace(" ", "").strip(),
            "from_email": str(cfg.get("from_email", cfg["username"])).strip(),
        }

    # Layout 3: flat smtp_ keys
    raw_pass = str(s["smtp_password"])
    return {
        "host": str(s.get("smtp_host", "smtp.gmail.com")),
        "port": int(s.get("smtp_port", 587)),
        "username": str(s["smtp_username"]).strip(),
        "password": raw_pass.replace(" ", "").strip(),
        "from_email": str(s.get("smtp_from", s["smtp_username"])).strip(),
    }


def send_invite_email(to_email: str, group_name: str, invited_by: str) -> tuple:
    """
    Send a group invite notification via SMTP.

    Mirrors the logic from the working EmailService:
      - Strips spaces from the App Password
      - Tries port 587 (STARTTLS) first
      - Falls back to port 465 (SSL) on any SMTP failure

    Returns (True, None) on success or (False, error_string) on failure.
    Never raises — all exceptions are caught and returned as the error string.
    """
    try:
        cfg = _get_smtp_config()
    except Exception as e:
        return False, f"Could not read SMTP credentials from secrets: {e}"

    if not cfg["username"] or not cfg["password"]:
        return False, "SMTP_USERNAME or SMTP_PASSWORD is missing from secrets."

    html_body = f"""
    <html>
    <body style="font-family: Arial, sans-serif; color: #333;">
      <p>Hi,</p>
      <p>
        <strong>{invited_by}</strong> has invited you to join the group
        <strong>"{group_name}"</strong> on <em>Monthly Expense Tracker</em>.
      </p>
      <p>Sign in to the app to accept or decline the invite.</p>
      <hr style="border:none; border-top:1px solid #eee;">
      <p style="color:#888; font-size:12px;">— Monthly Expense Tracker</p>
    </body>
    </html>
    """

    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"You've been invited to join '{group_name}'"
    msg["From"] = cfg["from_email"]
    msg["To"] = to_email
    msg.attach(MIMEText(html_body, "html"))

    # ── Attempt 1: port 587 STARTTLS ─────────────────────────────────────────
    first_error = None
    try:
        server = smtplib.SMTP(cfg["host"], cfg["port"], timeout=15)
        server.starttls()
        server.login(cfg["username"], cfg["password"])
        server.sendmail(cfg["from_email"], to_email, msg.as_string())
        server.quit()
        return True, None
    except Exception as e:
        first_error = str(e)

    # ── Fallback: port 465 SSL ────────────────────────────────────────────────
    try:
        server = smtplib.SMTP_SSL(cfg["host"], 465, timeout=15)
        server.login(cfg["username"], cfg["password"])
        server.sendmail(cfg["from_email"], to_email, msg.as_string())
        server.quit()
        return True, None
    except Exception as e:
        return False, f"Port {cfg['port']} error: {first_error} | Port 465 error: {e}"

