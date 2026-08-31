import logging
import smtplib
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any, Dict, List

from .config import Config

logger = logging.getLogger(__name__)


class AlertSystem:
    """Sends email alerts for tracked Status changes. Skips silently (with a log
    warning, not a crash) if SMTP settings aren't configured -- alerting is a
    nice-to-have on top of the change_log table, not a hard dependency."""

    def __init__(self, config: Config):
        self.config = config

    def send_status_change_alert(self, changes: List[Dict[str, Any]]) -> bool:
        if not changes:
            return False
        if not self.config.alerts_configured:
            logger.warning(
                "%d status change(s) detected but SMTP is not configured "
                "(set SMTP_HOST, ALERT_EMAIL_FROM, ALERT_EMAIL_TO) -- skipping email alert",
                len(changes),
            )
            return False

        subject = f"CCI Watcher: {len(changes)} document status change(s) detected"
        body = self._build_body(changes)

        msg = MIMEMultipart()
        msg["From"] = self.config.ALERT_EMAIL_FROM
        msg["To"] = self.config.ALERT_EMAIL_TO
        msg["Subject"] = subject
        msg.attach(MIMEText(body, "plain"))

        try:
            with smtplib.SMTP(self.config.SMTP_HOST, self.config.SMTP_PORT) as server:
                server.starttls()
                if self.config.SMTP_USER:
                    server.login(self.config.SMTP_USER, self.config.SMTP_PASSWORD)
                server.sendmail(self.config.ALERT_EMAIL_FROM, self.config.ALERT_EMAIL_TO, msg.as_string())
            logger.info("Sent status-change alert email for %d document(s)", len(changes))
            return True
        except Exception as exc:
            logger.error("Failed to send status-change alert email: %s", exc)
            return False

    @staticmethod
    def _build_body(changes: List[Dict[str, Any]]) -> str:
        lines = [f"CCI Watcher detected {len(changes)} document status change(s):", ""]
        for c in changes:
            lines.append(f"- {c.get('title', '(untitled)')}")
            lines.append(
                f"    {c.get('status_old_value')} -> {c.get('status_new_value')}"
                f"  (at {c.get('status_changed_at')})"
            )
            if c.get("url"):
                lines.append(f"    {c['url']}")
            lines.append("")
        lines.append(f"Generated {datetime.now().isoformat()}")
        return "\n".join(lines)
