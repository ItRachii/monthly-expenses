"""SMTP email helper for sending group invite notifications."""
import smtplib
import ssl
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
        password   = "your_app_password"
        from_email = "you@gmail.com"   # optional, defaults to username

    Flat-key fallback also supported:
        smtp_host, smtp_port, smtp_username, smtp_password, smtp_from
    """
    secrets = st.secrets
    if "smtp" in secrets:
        cfg = secrets["smtp"]
        return {
            "host": str(cfg["host"]),
            "port": int(cfg.get("port", 587)),
            "username": str(cfg["username"]),
            "password": str(cfg["password"]),
            "from_email": str(cfg.get("from_email", cfg["username"])),
        }
    # Flat-key fallback
    return {
        "host": str(secrets["smtp_host"]),
        "port": int(secrets.get("smtp_port", 587)),
        "username": str(secrets["smtp_username"]),
        "password": str(secrets["smtp_password"]),
        "from_email": str(secrets.get("smtp_from", secrets["smtp_username"])),
    }


def send_invite_email(to_email: str, group_name: str, invited_by: str) -> None:
    """
    Send a group invite notification via SMTP.

    Supports port 587 (STARTTLS) and port 465 (SSL).
    Raises on failure so the caller can surface a useful error.
    """
    cfg = _get_smtp_config()

    body = (
        f"Hi,\n\n"
        f"{invited_by} has invited you to join the group \"{group_name}\" "
        f"on Monthly Expense Tracker.\n\n"
        f"Sign in to the app to accept or decline the invite.\n\n"
        f"— Monthly Expense Tracker"
    )

    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = f"You've been invited to join '{group_name}'"
    msg["From"] = cfg["from_email"]
    msg["To"] = to_email

    port = cfg["port"]

    if port == 465:
        context = ssl.create_default_context()
        with smtplib.SMTP_SSL(cfg["host"], port, context=context, timeout=30) as server:
            server.login(cfg["username"], cfg["password"])
            server.sendmail(cfg["from_email"], [to_email], msg.as_string())
    else:
        # Port 587 (Gmail standard) — STARTTLS
        with smtplib.SMTP(cfg["host"], port, timeout=30) as server:
            server.ehlo()
            server.starttls()
            server.ehlo()
            server.login(cfg["username"], cfg["password"])
            server.sendmail(cfg["from_email"], [to_email], msg.as_string())
