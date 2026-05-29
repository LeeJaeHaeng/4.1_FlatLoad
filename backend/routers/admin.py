import json
import secrets
import hashlib
import hmac
import os
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete, update
from db.database import get_db
from db.models import AdminUser, Obstacle, ObstaclePhoto, Vote, Post, PostLike, Comment, CertifiedUser, DeleteNotification, AppSetting
from db.schemas import CertifiedUserCreate, CertifiedUserUpdate
from services import storage

router = APIRouter(prefix="/admin", tags=["admin"])

UPLOADS_DIR = storage.UPLOADS_DIR


def _hash_password(password: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120000)
    return f"pbkdf2_sha256$120000${salt}${digest.hex()}"


def _verify_password(password: str, password_hash: str) -> bool:
    try:
        algorithm, iterations, salt, expected = password_hash.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), int(iterations))
        return hmac.compare_digest(digest.hex(), expected)
    except Exception:
        return False


@router.post("/auth/login")
async def verify_admin_login(body: dict, db: AsyncSession = Depends(get_db)):
    username = str(body.get("id") or body.get("username") or "").strip()
    password = str(body.get("pw") or body.get("password") or "")
    if not username or not password:
        raise HTTPException(401, "아이디 또는 비밀번호가 올바르지 않습니다")

    row = (await db.execute(select(AdminUser).where(AdminUser.username == username))).scalar_one_or_none()
    if not row or not _verify_password(password, row.password_hash):
        raise HTTPException(401, "아이디 또는 비밀번호가 올바르지 않습니다")
    return {"ok": True}


@router.post("/auth/bootstrap")
async def bootstrap_admin_user(db: AsyncSession = Depends(get_db)):
    username = os.getenv("ADMIN_ID", "root")
    password = os.getenv("ADMIN_PW", "1234")
    row = (await db.execute(select(AdminUser).where(AdminUser.username == username))).scalar_one_or_none()
    if row:
        row.password_hash = _hash_password(password)
    else:
        db.add(AdminUser(username=username, password_hash=_hash_password(password)))
    await db.commit()
    return {"ok": True, "username": username}


def _obs_dict(row: Obstacle) -> dict:
    detections = None
    if row.ai_detections:
        try:
            detections = json.loads(row.ai_detections)
        except Exception:
            pass
    return {
        "id": row.id,
        "photoUrl": storage.public_image_url(row.photo_url),
        "latitude": row.latitude,
        "longitude": row.longitude,
        "createdAt": row.created_at.isoformat() if row.created_at else None,
        "userId": row.user_id,
        "userEmail": row.user_email,
        "displayName": row.display_name,
        "likes": row.likes,
        "dislikes": row.dislikes,
        "aiLabel": row.ai_label,
        "aiConfidence": row.ai_confidence,
        "aiDetections": detections,
        "isApproved": row.is_approved,
    }


# ── 통계 ──────────────────────────────────────────────────────────

@router.get("/stats")
async def get_stats(db: AsyncSession = Depends(get_db)):
    total_obstacles = (await db.execute(select(func.count(Obstacle.id)))).scalar()
    approved = (await db.execute(
        select(func.count(Obstacle.id)).where(Obstacle.is_approved == True)
    )).scalar()
    total_posts = (await db.execute(select(func.count(Post.id)))).scalar()
    total_comments = (await db.execute(select(func.count(Comment.id)))).scalar()
    return {
        "totalObstacles": total_obstacles,
        "approvedObstacles": approved,
        "pendingObstacles": total_obstacles - approved,
        "totalPosts": total_posts,
        "totalComments": total_comments,
    }


# ── 장애물 ────────────────────────────────────────────────────────

@router.get("/obstacles")
async def get_all_obstacles(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(Obstacle).order_by(Obstacle.created_at.desc())
    )).scalars().all()
    return [_obs_dict(r) for r in rows]


@router.patch("/obstacles/{obstacle_id}/approve")
async def toggle_approve(obstacle_id: int, db: AsyncSession = Depends(get_db)):
    obs = await db.get(Obstacle, obstacle_id)
    if not obs:
        raise HTTPException(404, "장애물을 찾을 수 없습니다")
    obs.is_approved = not obs.is_approved
    await db.commit()
    return {"id": obstacle_id, "isApproved": obs.is_approved}


@router.delete("/obstacles/{obstacle_id}")
async def delete_obstacle(obstacle_id: int, reason: str = "", db: AsyncSession = Depends(get_db)):
    obs = await db.get(Obstacle, obstacle_id)
    if not obs:
        raise HTTPException(404, "장애물을 찾을 수 없습니다")

    if obs.user_id:
        notif = DeleteNotification(
            user_id=obs.user_id,
            obstacle_id=obstacle_id,
            reason=reason or "관리자에 의해 삭제되었습니다.",
        )
        db.add(notif)

    if obs.photo_url and "/uploads/" in obs.photo_url:
        filename = obs.photo_url.split("/uploads/")[-1]
        file_path = UPLOADS_DIR / filename
        if file_path.exists():
            file_path.unlink()

    await db.execute(delete(Vote).where(Vote.obstacle_id == obstacle_id))
    await db.execute(delete(ObstaclePhoto).where(ObstaclePhoto.obstacle_id == obstacle_id))
    await db.delete(obs)
    await db.commit()
    return {"ok": True}


# ── 게시글 ────────────────────────────────────────────────────────

@router.get("/posts")
async def get_all_posts(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(Post).order_by(Post.created_at.desc())
    )).scalars().all()

    counts = {
        r.post_id: r.cnt
        for r in (await db.execute(
            select(Comment.post_id, func.count(Comment.id).label("cnt"))
            .group_by(Comment.post_id)
        )).all()
    }

    return [
        {
            "id": r.id,
            "title": r.title,
            "content": r.content,
            "userId": r.user_id,
            "userEmail": r.user_email,
            "displayName": r.display_name,
            "createdAt": r.created_at.isoformat() if r.created_at else None,
            "likes": r.likes,
            "commentCount": counts.get(r.id, 0),
        }
        for r in rows
    ]


@router.delete("/posts/{post_id}")
async def delete_post(post_id: int, db: AsyncSession = Depends(get_db)):
    post = await db.get(Post, post_id)
    if not post:
        raise HTTPException(404, "게시글을 찾을 수 없습니다")
    await db.execute(delete(Comment).where(Comment.post_id == post_id))
    await db.execute(delete(PostLike).where(PostLike.post_id == post_id))
    await db.delete(post)
    await db.commit()
    return {"ok": True}


@router.delete("/comments/{comment_id}")
async def delete_comment(comment_id: int, db: AsyncSession = Depends(get_db)):
    c = await db.get(Comment, comment_id)
    if not c:
        raise HTTPException(404, "댓글을 찾을 수 없습니다")
    await db.delete(c)
    await db.commit()
    return {"ok": True}


# ── 인증된 사용자 ────────────────────────────────────────────────────

def _cert_dict(row: CertifiedUser) -> dict:
    now = datetime.now(timezone.utc)
    expires = row.expires_at.replace(tzinfo=timezone.utc) if row.expires_at.tzinfo is None else row.expires_at
    days_left = max(0, (expires - now).days)
    return {
        "id": row.id,
        "name": row.name,
        "affiliation": row.affiliation,
        "apiKey": row.api_key,
        "createdAt": row.created_at.isoformat() if row.created_at else None,
        "expiresAt": row.expires_at.isoformat() if row.expires_at else None,
        "daysLeft": days_left,
    }


@router.get("/certified")
async def get_certified_users(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(CertifiedUser).order_by(CertifiedUser.created_at.desc())
    )).scalars().all()
    return [_cert_dict(r) for r in rows]


@router.post("/certified")
async def create_certified_user(body: CertifiedUserCreate, db: AsyncSession = Depends(get_db)):
    api_key = secrets.token_hex(32)
    expires_at = datetime.now(timezone.utc) + timedelta(days=365)
    user = CertifiedUser(
        name=body.name,
        affiliation=body.affiliation,
        api_key=api_key,
        expires_at=expires_at,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return {
        "id": user.id,
        "name": user.name,
        "affiliation": user.affiliation,
        "apiKey": user.api_key,
        "expiresAt": user.expires_at.isoformat(),
    }


@router.put("/certified/{user_id}")
async def update_certified_user(user_id: int, body: CertifiedUserUpdate, db: AsyncSession = Depends(get_db)):
    user = await db.get(CertifiedUser, user_id)
    if not user:
        raise HTTPException(404, "인증 사용자를 찾을 수 없습니다")
    user.name = body.name
    user.affiliation = body.affiliation
    await db.commit()
    return _cert_dict(user)


@router.delete("/certified/{user_id}")
async def delete_certified_user(user_id: int, db: AsyncSession = Depends(get_db)):
    user = await db.get(CertifiedUser, user_id)
    if not user:
        raise HTTPException(404, "인증 사용자를 찾을 수 없습니다")
    await db.delete(user)
    await db.commit()
    return {"ok": True}


# ── 앱 설정 ────────────────────────────────────────────────────────

@router.get("/settings")
async def get_settings(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(AppSetting))).scalars().all()
    return {r.key: r.value for r in rows}


@router.patch("/settings/{key}")
async def update_setting(key: str, body: dict, db: AsyncSession = Depends(get_db)):
    ALLOWED_KEYS = {"auto_approve_images"}
    if key not in ALLOWED_KEYS:
        raise HTTPException(400, "알 수 없는 설정 키입니다")
    value = str(body.get("value", "")).lower()
    if value not in ("true", "false"):
        raise HTTPException(400, "값은 'true' 또는 'false'여야 합니다")
    setting = await db.get(AppSetting, key)
    if setting is None:
        db.add(AppSetting(key=key, value=value))
    else:
        setting.value = value
    await db.commit()
    return {key: value}
