"""Encryption helpers for sensitive data (bank account numbers, KYC documents).

Uses Fernet (AES-128-CBC + HMAC). The key comes from the FIELD_ENCRYPTION_KEY
setting; in development a key is derived from SECRET_KEY. In production set
FIELD_ENCRYPTION_KEY explicitly and keep it safe - losing it means encrypted
data cannot be read.
"""
import base64
import hashlib
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings
from django.db import models


@lru_cache(maxsize=1)
def _fernet():
    key = getattr(settings, "FIELD_ENCRYPTION_KEY", "") or ""
    if not key:
        digest = hashlib.sha256(("rowms-dev-" + settings.SECRET_KEY).encode()).digest()
        key = base64.urlsafe_b64encode(digest).decode()
    return Fernet(key.encode() if isinstance(key, str) else key)


def encrypt_bytes(data: bytes) -> bytes:
    return _fernet().encrypt(data)


def decrypt_bytes(token: bytes) -> bytes:
    return _fernet().decrypt(token)


PREFIX = "enc$"


class EncryptedTextField(models.TextField):
    """Text field stored encrypted in the database, transparent in Python."""

    def from_db_value(self, value, expression, connection):
        if value is None or value == "":
            return value
        if value.startswith(PREFIX):
            try:
                return decrypt_bytes(value[len(PREFIX):].encode()).decode()
            except InvalidToken:
                return ""
        return value

    def get_prep_value(self, value):
        value = super().get_prep_value(value)
        if value is None or value == "":
            return value
        if isinstance(value, str) and value.startswith(PREFIX):
            return value
        return PREFIX + encrypt_bytes(str(value).encode()).decode()
