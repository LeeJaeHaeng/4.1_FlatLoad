import asyncio
import threading
import uuid
import os

from dotenv import load_dotenv

load_dotenv()

_lock = threading.Lock()
_initialized = False
_firebase_available = False


def _init() -> None:
    global _initialized, _firebase_available
    if _initialized:
        return
    with _lock:
        if _initialized:
            return
        cred_path = os.getenv("FIREBASE_CREDENTIALS_PATH", "./firebase-adminsdk.json")
        bucket_name = os.getenv("FIREBASE_STORAGE_BUCKET", "")
        if not os.path.exists(cred_path) or not bucket_name:
            print(f"[Storage] firebase-adminsdk.json 없음 또는 버킷 미설정 — Firebase 업로드 비활성화")
            _initialized = True
            _firebase_available = False
            return
        try:
            import firebase_admin
            from firebase_admin import credentials, storage as fb_storage
            firebase_admin.initialize_app(
                credentials.Certificate(cred_path),
                {"storageBucket": bucket_name},
            )
            _firebase_available = True
        except Exception as e:
            print(f"[Storage] Firebase 초기화 실패: {e} — 업로드 비활성화")
            _firebase_available = False
        _initialized = True


def _upload_sync(file_bytes: bytes, content_type: str) -> str:
    _init()
    if not _firebase_available:
        return ""
    from firebase_admin import storage as fb_storage
    bucket = fb_storage.bucket()
    blob = bucket.blob(f"obstacles/{uuid.uuid4()}.jpg")
    blob.upload_from_string(file_bytes, content_type=content_type)
    blob.make_public()
    return blob.public_url


async def upload_image(file_bytes: bytes, content_type: str = "image/jpeg") -> str:
    """Firebase Storage에 이미지를 업로드하고 공개 URL을 반환한다. 자격증명 없으면 빈 문자열 반환."""
    return await asyncio.to_thread(_upload_sync, file_bytes, content_type)
