"""Document storage: validation, encryption of sensitive files, signed download links."""
import mimetypes

from django.conf import settings
from django.core import signing
from django.core.files.base import ContentFile
from rest_framework.exceptions import ValidationError

from .crypto import decrypt_bytes, encrypt_bytes
from .models import SENSITIVE_CATEGORIES, Document

ALLOWED_TYPES = {
    "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif",
    "application/pdf",
}
SIGNING_SALT = "rowms.document.download"
LINK_MAX_AGE = 60 * 30  # seconds


def derive_project(doc):
    for rel, path in (
        ("asset", "project"), ("agreement", "project"), ("compensation", "project"),
        ("crop_assessment", "project"), ("milestone", "asset.project"), ("payment", "compensation.project"),
    ):
        obj = getattr(doc, rel, None)
        if obj is not None:
            for attr in path.split("."):
                obj = getattr(obj, attr)
            return obj
    return None


def store_document(doc: Document, upload):
    """Validate an uploaded file and attach it to ``doc`` (encrypting sensitive files)."""
    if upload is None:
        raise ValidationError({"file": "A file is required."})
    max_bytes = settings.MAX_DOCUMENT_SIZE_MB * 1024 * 1024
    if upload.size > max_bytes:
        raise ValidationError({"file": f"File is larger than {settings.MAX_DOCUMENT_SIZE_MB} MB."})
    ctype = (getattr(upload, "content_type", None) or mimetypes.guess_type(upload.name)[0] or "").lower()
    if ctype not in ALLOWED_TYPES:
        raise ValidationError({"file": "Only photos (JPG, PNG, WEBP, HEIC) and PDF files are allowed."})

    doc.is_sensitive = doc.category in SENSITIVE_CATEGORIES
    doc.original_name = (upload.name or "")[:255]
    doc.content_type = ctype
    doc.size_bytes = upload.size
    if doc.project_id is None:
        doc.project = derive_project(doc)

    data = upload.read()
    if doc.is_sensitive:
        data = encrypt_bytes(data)
        doc.is_encrypted = True
    doc.file.save(upload.name or "upload.bin", ContentFile(data), save=False)
    doc.save()
    return doc


def read_document_bytes(doc: Document) -> bytes:
    with doc.file.open("rb") as fh:
        data = fh.read()
    return decrypt_bytes(data) if doc.is_encrypted else data


def signed_download_url(doc, user):
    token = signing.dumps({"d": str(doc.id), "u": user.id}, salt=SIGNING_SALT, compress=True)
    return f"/api/documents/{doc.id}/download/?t={token}"


def verify_download_token(token, doc_id):
    try:
        data = signing.loads(token, salt=SIGNING_SALT, max_age=LINK_MAX_AGE)
    except signing.BadSignature:
        return None
    if data.get("d") != str(doc_id):
        return None
    return data.get("u")
