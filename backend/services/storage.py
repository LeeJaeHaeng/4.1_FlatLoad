import asyncio
import threading
import uuid
import os

import firebase_admin
from firebase_admin import credentials, storage
from dotenv import load_dotenv

load_dotenv()

_lock = threading.Lock()
_initialized = False


def _init() -> None:
    global _initialized
    if _initialized:
        return
    with _lock:
        if _initialized:
            return
        cred_path = os.getenv("FIREBASE_CREDENTIALS_PATH", "./firebase-adminsdk.json")
        bucket_name = os.getenv("FIREBASE_STORAGE_BUCKET", "")
        firebase_admin.initialize_app(
            credentials.Certificate(cred_path),
            {"storageBucket": bucket_name},
        )
        _initialized = True


def _upload_sync(file_bytes: bytes, content_type: str) -> str:
    _init()
    bucket = storage.bucket()
    blob = bucket.blob(f"obstacles/{uuid.uuid4()}.jpg")
    blob.upload_from_string(file_bytes, content_type=content_type)
    blob.make_public()
    return blob.public_url


async def upload_image(file_bytes: bytes, content_type: str = "image/jpeg") -> str:
    """Firebase Storage에 이미지를 업로드하고 공개 URL을 반환한다."""
    return await asyncio.to_thread(_upload_sync, file_bytes, content_type)
