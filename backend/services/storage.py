import asyncio
import uuid
import os
import base64
from pathlib import Path
from dotenv import load_dotenv
from urllib.parse import urlparse

load_dotenv()

UPLOADS_DIR = Path(os.getenv("UPLOADS_DIR", str(Path(__file__).parent.parent / "uploads")))
try:
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
except OSError:
    pass

API_BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8000")


def _as_data_url(file_bytes: bytes, content_type: str) -> str:
    mime = content_type if "/" in content_type else "image/jpeg"
    encoded = base64.b64encode(file_bytes).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def _upload_sync(file_bytes: bytes, content_type: str) -> str:
    ext = "jpg" if "jpeg" in content_type or "jpg" in content_type else content_type.split("/")[-1]
    filename = f"{uuid.uuid4()}.{ext}"
    dest = UPLOADS_DIR / filename
    try:
        dest.write_bytes(file_bytes)
        return f"/uploads/{filename}"
    except OSError:
        return _as_data_url(file_bytes, content_type)


async def upload_image(file_bytes: bytes, content_type: str = "image/jpeg") -> str:
    """이미지를 서버 디스크에 저장하고 DB에 넣을 상대 경로를 반환한다."""
    return await asyncio.to_thread(_upload_sync, file_bytes, content_type)


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
