import firebase_admin
from firebase_admin import credentials, storage
from dotenv import load_dotenv
import os, uuid

load_dotenv()

_initialized = False

def _init():
    global _initialized
    if _initialized:
        return
    cred_path = os.getenv("FIREBASE_CREDENTIALS_PATH", "./firebase-adminsdk.json")
    bucket_name = os.getenv("FIREBASE_STORAGE_BUCKET", "")
    cred = credentials.Certificate(cred_path)
    firebase_admin.initialize_app(cred, {"storageBucket": bucket_name})
    _initialized = True

async def upload_image(file_bytes: bytes, content_type: str = "image/jpeg") -> str:
    """Firebase Storage에 이미지 업로드 후 공개 URL 반환"""
    _init()
    bucket = storage.bucket()
    filename = f"obstacles/{uuid.uuid4()}.jpg"
    blob = bucket.blob(filename)
    blob.upload_from_string(file_bytes, content_type=content_type)
    blob.make_public()
    return blob.public_url
