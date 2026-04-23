import asyncio
import uuid
import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

UPLOADS_DIR = Path(__file__).parent.parent / "uploads"
UPLOADS_DIR.mkdir(exist_ok=True)

API_BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8000")


def _upload_sync(file_bytes: bytes, content_type: str) -> str:
    ext = "jpg" if "jpeg" in content_type or "jpg" in content_type else content_type.split("/")[-1]
    filename = f"{uuid.uuid4()}.{ext}"
    dest = UPLOADS_DIR / filename
    dest.write_bytes(file_bytes)
    return f"{API_BASE_URL}/uploads/{filename}"


async def upload_image(file_bytes: bytes, content_type: str = "image/jpeg") -> str:
    """이미지를 서버 디스크에 저장하고 공개 URL을 반환한다."""
    return await asyncio.to_thread(_upload_sync, file_bytes, content_type)
