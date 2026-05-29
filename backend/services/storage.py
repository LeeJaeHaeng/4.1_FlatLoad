import asyncio
import json
import logging
import uuid
import os
from datetime import datetime, timezone
from pathlib import Path
from dotenv import load_dotenv
from urllib.parse import quote, unquote, urlparse

import httpx

load_dotenv()

logger = logging.getLogger(__name__)

UPLOADS_DIR = Path(os.getenv("UPLOADS_DIR", str(Path(__file__).parent.parent / "uploads")))
try:
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
except OSError:
    pass

API_BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8000")
SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SECRET_KEY = (
    os.getenv("SUPABASE_SECRET_KEY")
    or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    or ""
)
SUPABASE_STORAGE_BUCKET = os.getenv("SUPABASE_STORAGE_BUCKET", "upload image")
SUPABASE_STORAGE_PREFIX = os.getenv("SUPABASE_STORAGE_PREFIX", "obstacles").strip("/") or "obstacles"
SUPABASE_CACHE_CONTROL = os.getenv("SUPABASE_CACHE_CONTROL", "3600")
SUPABASE_TIMEOUT_SECONDS = float(os.getenv("SUPABASE_TIMEOUT_SECONDS", "30"))


def _is_supabase_configured() -> bool:
    return bool(SUPABASE_URL and SUPABASE_SECRET_KEY and SUPABASE_STORAGE_BUCKET)


def _encode_path(path: str) -> str:
    return "/".join(quote(part, safe="") for part in path.split("/"))


def _extension_for_content_type(content_type: str) -> str:
    mime = (content_type or "image/jpeg").split(";", 1)[0].strip().lower()
    if mime in {"image/jpeg", "image/jpg"}:
        return "jpg"
    if mime == "image/png":
        return "png"
    if mime == "image/webp":
        return "webp"
    if mime == "image/gif":
        return "gif"
    return "bin"


def _public_supabase_url(object_path: str) -> str:
    bucket = quote(SUPABASE_STORAGE_BUCKET, safe="")
    return f"{SUPABASE_URL}/storage/v1/object/public/{bucket}/{_encode_path(object_path)}"


def _supabase_headers(content_type: str | None = None) -> dict[str, str]:
    headers = {
        "Authorization": f"Bearer {SUPABASE_SECRET_KEY}",
        "apikey": SUPABASE_SECRET_KEY,
    }
    if content_type:
        headers["Content-Type"] = content_type
        headers["Cache-Control"] = SUPABASE_CACHE_CONTROL
    return headers


def _upload_to_supabase(file_bytes: bytes, content_type: str) -> str:
    ext = _extension_for_content_type(content_type)
    dated_path = datetime.now(timezone.utc).strftime("%Y/%m")
    object_path = f"{SUPABASE_STORAGE_PREFIX}/{dated_path}/{uuid.uuid4()}.{ext}"
    bucket = quote(SUPABASE_STORAGE_BUCKET, safe="")
    url = f"{SUPABASE_URL}/storage/v1/object/{bucket}/{_encode_path(object_path)}"

    with httpx.Client(timeout=SUPABASE_TIMEOUT_SECONDS) as client:
        response = client.post(
            url,
            content=file_bytes,
            headers=_supabase_headers(content_type or "application/octet-stream"),
        )
        response.raise_for_status()

    return _public_supabase_url(object_path)


def _delete_from_supabase(stored_url: str) -> bool:
    if not _is_supabase_configured() or not stored_url:
        return False

    parsed = urlparse(stored_url)
    parsed_base = urlparse(SUPABASE_URL)
    if parsed.netloc != parsed_base.netloc:
        return False

    public_prefix = "/storage/v1/object/public/"
    if not parsed.path.startswith(public_prefix):
        return False

    remainder = parsed.path[len(public_prefix):]
    bucket_part, _, object_part = remainder.partition("/")
    if not object_part or unquote(bucket_part) != SUPABASE_STORAGE_BUCKET:
        return False

    object_path = unquote(object_part)
    delete_url = f"{SUPABASE_URL}/storage/v1/object/{quote(SUPABASE_STORAGE_BUCKET, safe='')}"
    body = json.dumps({"prefixes": [object_path]}).encode("utf-8")

    with httpx.Client(timeout=SUPABASE_TIMEOUT_SECONDS) as client:
        response = client.request(
            "DELETE",
            delete_url,
            content=body,
            headers=_supabase_headers("application/json"),
        )
        response.raise_for_status()

    return True


def _upload_to_local(file_bytes: bytes, content_type: str) -> str:
    ext = _extension_for_content_type(content_type)
    filename = f"{uuid.uuid4()}.{ext}"
    dest = UPLOADS_DIR / filename
    dest.write_bytes(file_bytes)
    return f"/uploads/{filename}"


def _upload_sync(file_bytes: bytes, content_type: str) -> str:
    if _is_supabase_configured():
        try:
            return _upload_to_supabase(file_bytes, content_type)
        except Exception as exc:
            logger.warning("Supabase storage upload failed; falling back to local/DB storage: %s", exc)

    try:
        return _upload_to_local(file_bytes, content_type)
    except OSError as exc:
        logger.warning("Local image upload failed; using database photo fallback: %s", exc)
        return ""


def _delete_local_upload(stored_url: str) -> bool:
    parsed = urlparse(stored_url)
    upload_path = parsed.path if parsed.path else stored_url
    if not upload_path.startswith("/uploads/"):
        return False

    filename = Path(upload_path.split("/uploads/", 1)[1]).name
    if not filename:
        return False

    file_path = UPLOADS_DIR / filename
    if file_path.exists():
        file_path.unlink()
    return True


async def upload_image(file_bytes: bytes, content_type: str = "image/jpeg") -> str:
    """Store an image and return the URL saved in the obstacle row."""
    return await asyncio.to_thread(_upload_sync, file_bytes, content_type)


async def delete_image(stored_url: str | None) -> None:
    if not stored_url:
        return

    def _delete_sync() -> None:
        try:
            if _delete_from_supabase(stored_url):
                return
            _delete_local_upload(stored_url)
        except Exception as exc:
            logger.warning("Image delete failed for %s: %s", stored_url, exc)

    await asyncio.to_thread(_delete_sync)


def public_image_url(stored_url: str | None) -> str:
    """DB의 상대/구 absolute 업로드 경로를 현재 서버에서 접근 가능한 URL로 변환한다."""
    if not stored_url:
        return ""

    parsed = urlparse(stored_url)
    if parsed.scheme and parsed.netloc and "/uploads/" not in parsed.path:
        return stored_url

    upload_path = parsed.path if parsed.path else stored_url
    if upload_path.startswith("/api/"):
        return f"{API_BASE_URL.rstrip('/')}{upload_path}"

    if not upload_path.startswith("/uploads/"):
        return stored_url

    filename = upload_path.split("/uploads/", 1)[1]
    if not filename or not (UPLOADS_DIR / filename).exists():
        return ""

    return f"{API_BASE_URL.rstrip('/')}/uploads/{filename}"
