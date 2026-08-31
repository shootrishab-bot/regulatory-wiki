import logging
import smtplib
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any, Dict, List

from .config import Config

logger = logging.getLogger(__name__)


class AlertSystem:
    """Sends email alerts for tracked Status changes AND, uniquely for FIU-IND,
    for any brand-new Adjudication/Penalty Order.

    WHY A SEPARATE ALERT PATH FOR NEW PENALTY ORDERS (not just cci_scraper's
    Status-change pattern): a Status change only fires for a document that was
    already in the database and then changed. A brand-new penalty order (a
    fresh Binance- or Bybit-scale case appearing on Compliance_Orders/
    orders.html for the first time) has no prior row to diff against, so a
    Status-change-only alert would never catch it -- yet for FIU-IND
    specifically, a new penalty order is the single most time-sensitive real
    event this wiki tracks, more so than a later Status edit on an existing
    document. database.py's is_new_penalty_order column and
    get_new_penalty_orders() exist specifically to make this a first-class
    signal rather than an afterthought bolted onto the Status-change query.

    Skips silently (with a log warning, not a crash) if SMTP settings aren't
    configured -- alerting is a nice-to-have on top of the change_log/
    is_new_penalty_order columns, not a hard dependency, same as cci_scraper's."""

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

        subject = f"FIU-IND Watcher: {len(changes)} document status change(s) detected"
        body = self._build_status_change_body(changes)
        return self._send(subject, body, f"status-change alert for {len(changes)} document(s)")

    def send_new_penalty_order_alert(self, new_orders: List[Dict[str, Any]]) -> bool:
        if not new_orders:
            return False
        if not self.config.alerts_configured:
            logger.warning(
                "%d new Adjudication/Penalty Order(s) detected but SMTP is not configured "
                "(set SMTP_HOST, ALERT_EMAIL_FROM, ALERT_EMAIL_TO) -- skipping email alert",
                len(new_orders),
            )
            return False

        subject = f"FIU-IND Watcher: {len(new_orders)} NEW Adjudication/Penalty Order(s)"
        body = self._build_new_penalty_order_body(new_orders)
        return self._send(subject, body, f"new-penalty-order alert for {len(new_orders)} document(s)")

    def _send(self, subject: str, body: str, log_label: str) -> bool:
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
            logger.info("Sent %s", log_label)
            return True
        except Exception as exc:
            logger.error("Failed to send %s: %s", log_label, exc)
            return False

    @staticmethod
    def _build_status_change_body(changes: List[Dict[str, Any]]) -> str:
        lines = [f"FIU-IND Watcher detected {len(changes)} document status change(s):", ""]
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

    @staticmethod
    def _build_new_penalty_order_body(new_orders: List[Dict[str, Any]]) -> str:
        lines = [
            f"FIU-IND Watcher found {len(new_orders)} NEW Adjudication / Penalty Order(s) "
            "on this run:",
            "",
        ]
        for doc in new_orders:
            lines.append(f"- {doc.get('title', '(untitled)')}")
            details = [d for d in (doc.get("date"), doc.get("subject")) if d]
            if details:
                lines.append(f"    {' | '.join(details)}")
            if doc.get("url"):
                lines.append(f"    {doc['url']}")
            lines.append("")
        lines.append(f"Generated {datetime.now().isoformat()}")
        return "\n".join(lines)
