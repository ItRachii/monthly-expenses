"""SMTP email helper for sending group invite notifications."""
import smtplib
import ssl
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import streamlit as st


def _get_smtp_config() -> dict:
    """
    Read SMTP config from Streamlit secrets.

    Supports a [smtp] section:
        [smtp]
        host     = "smtp.gmail.com"
        port     = 587
        username = "you@example.com"
        password = "app_password"
        from_email = "you@example.com"   # optional, defaults to username

    Or flat keys (smtp_host, smtp_port, smtp_username, smtp_password, smtp_from).
    """
    secrets = st.secrets
    if "smtp" in secrets:
        cfg = secrets["smtp"]
        return {
            "host": cfg["host"],
            "port": int(cfg.get("port", 587)),
            "username": cfg["username"],
            "password": cfg["password"],
            "from_email": cfg.get("from_email", cfg["username"]),
        }
    # Flat-key fallback
    return {
        "host": secrets["smtp_host"],
        "port": int(secrets.get("smtp_port", 587)),
        "username": secrets["smtp_username"],
        "password": secrets["smtp_password"],
        "from_email": secrets.get("smtp_from", secrets["smtp_username"]),
    }


def send_invite_email(to_email: str, group_name: str, invited_by: str) -> None:
    """
    Send a group invite notification email.

    Raises smtplib.SMTPException (or similar) on failure so the caller can
    surface a warning without hiding that the DB invite was recorded.
    """
    cfg = _get_smtp_config()

    subject = f"You've been invited to join '{group_name}'"
    body = (
        f"Hi,\n\n"
        f"{invited_by} has invited you to join the group \"{group_name}\" "
        f"on Monthly Expense Tracker.\n\n"
        f"Sign in to the app to accept or decline the invite.\n\n"
        f"— Monthly Expense Tracker"
    )

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = cfg["from_email"]
    msg["To"] = to_email
    msg.attach(MIMEText(body, "plain"))

    port = cfg["port"]
    context = ssl.create_default_context()

    if port == 465:
        with smtplib.SMTP_SSL(cfg["host"], port, context=context) as server:
            server.login(cfg["username"], cfg["password"])
            server.sendmail(cfg["from_email"], to_email, msg.as_string())
    else:
        # Port 587 or 25 — STARTTLS
        with smtplib.SMTP(cfg["host"], port, timeout=10) as server:
            server.ehlo()
            server.starttls(context=context)
            server.ehlo()
            server.login(cfg["username"], cfg["password"])
            server.sendmail(cfg["from_email"], to_email, msg.as_string())
