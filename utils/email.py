"""SMTP email helper for sending group invite notifications."""
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import streamlit as st


def _get_smtp_config() -> dict:
    """
    Read SMTP config from Streamlit secrets.

    Expected secrets.toml layout:
        [smtp]
        host       = "smtp.gmail.com"
        port       = 587
        username   = "you@gmail.com"
        password   = "abcd efgh ijkl mnop"   # spaces OK — they are stripped automatically
        from_email = "you@gmail.com"          # optional, defaults to username

    Flat-key fallback also supported:
        smtp_host, smtp_port, smtp_username, smtp_password, smtp_from
    """
    secrets = st.secrets
    if "smtp" in secrets:
        cfg = secrets["smtp"]
        raw_pass = str(cfg["password"])
        return {
            "host": str(cfg["host"]),
            "port": int(cfg.get("port", 587)),
            "username": str(cfg["username"]).strip(),
            # Gmail App Passwords are shown with spaces in the UI — strip them
            "password": raw_pass.replace(" ", "").strip(),
            "from_email": str(cfg.get("from_email", cfg["username"])).strip(),
        }
    # Flat-key fallback
    raw_pass = str(secrets["smtp_password"])
    return {
        "host": str(secrets["smtp_host"]),
        "port": int(secrets.get("smtp_port", 587)),
        "username": str(secrets["smtp_username"]).strip(),
        "password": raw_pass.replace(" ", "").strip(),
        "from_email": str(secrets.get("smtp_from", secrets["smtp_username"])).strip(),
    }


def send_invite_email(to_email: str, group_name: str, invited_by: str) -> bool:
    """
    Send a group invite notification via SMTP.

    Tries port 587 (STARTTLS) first; falls back to port 465 (SSL) if that fails.
    Returns True on success, False on failure.
    Errors are returned as the second element of a (bool, str) tuple.
    """
    cfg = _get_smtp_config()

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
    try:
        server = smtplib.SMTP(cfg["host"], cfg["port"], timeout=15)
        server.starttls()
        server.login(cfg["username"], cfg["password"])
        server.sendmail(cfg["from_email"], to_email, msg.as_string())
        server.quit()
        return True, None
    except (smtplib.SMTPAuthenticationError, smtplib.SMTPException) as e:
        first_error = str(e)

    # ── Fallback: port 465 SSL ────────────────────────────────────────────────
    try:
        server = smtplib.SMTP_SSL(cfg["host"], 465, timeout=15)
        server.login(cfg["username"], cfg["password"])
        server.sendmail(cfg["from_email"], to_email, msg.as_string())
        server.quit()
        return True, None
    except Exception as e:
        return False, f"Port 587 error: {first_error} | Port 465 error: {e}"
