import json
import secrets
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete, update
from db.database import get_db
from db.models import Obstacle, Vote, Post, PostLike, Comment, CertifiedUser, DeleteNotification, AppSetting
from db.schemas import CertifiedUserCreate, CertifiedUserUpdate

router = APIRouter(prefix="/admin", tags=["admin"])

UPLOADS_DIR = Path(__file__).parent.parent / "uploads"


def _obs_dict(row: Obstacle) -> dict:
    detections = None
    if row.ai_detections:
        try:
            detections = json.loads(row.ai_detections)
        except Exception:
            pass
    return {
        "id": row.id,
        "photoUrl": row.photo_url,
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
            reason=reason or None,
        )
        db.add(notif)

    if obs.photo_url:
        filename = obs.photo_url.split("/uploads/")[-1]
        file_path = UPLOADS_DIR / filename
        if file_path.exists():
            file_path.unlink()

    await db.execute(delete(Vote).where(Vote.obstacle_id == obstacle_id))
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


# ── 인증 사용자 관리 ────────────────────────────────────────────────

@router.get("/certified")
async def list_certified(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(CertifiedUser).order_by(CertifiedUser.created_at.desc())
    )).scalars().all()
    return [
        {
            "id": r.id,
            "userId": r.user_id,
            "displayName": r.display_name,
            "certifiedKey": r.certified_key,
            "createdAt": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


@router.post("/certified")
async def create_certified(body: CertifiedUserCreate, db: AsyncSession = Depends(get_db)):
    key = body.certified_key or secrets.token_urlsafe(16)
    cert = CertifiedUser(user_id=body.user_id, display_name=body.display_name, certified_key=key)
    db.add(cert)
    await db.commit()
    await db.refresh(cert)
    return {"id": cert.id, "userId": cert.user_id, "certifiedKey": cert.certified_key}


@router.patch("/certified/{cert_id}")
async def update_certified(cert_id: int, body: CertifiedUserUpdate, db: AsyncSession = Depends(get_db)):
    cert = await db.get(CertifiedUser, cert_id)
    if not cert:
        raise HTTPException(404, "인증 사용자를 찾을 수 없습니다")
    if body.display_name is not None:
        cert.display_name = body.display_name
    if body.certified_key is not None:
        cert.certified_key = body.certified_key
    await db.commit()
    return {"ok": True}


@router.delete("/certified/{cert_id}")
async def delete_certified(cert_id: int, db: AsyncSession = Depends(get_db)):
    cert = await db.get(CertifiedUser, cert_id)
    if not cert:
        raise HTTPException(404, "인증 사용자를 찾을 수 없습니다")
    await db.delete(cert)
    await db.commit()
    return {"ok": True}


# ── 자동 승인 설정 ────────────────────────────────────────────────

@router.get("/settings/auto-approve")
async def get_auto_approve(db: AsyncSession = Depends(get_db)):
    setting = (await db.execute(
        select(AppSetting).where(AppSetting.key == "auto_approve")
    )).scalar_one_or_none()
    return {"autoApprove": setting is None or setting.value == "true"}


@router.patch("/settings/auto-approve")
async def set_auto_approve(enabled: bool, db: AsyncSession = Depends(get_db)):
    setting = (await db.execute(
        select(AppSetting).where(AppSetting.key == "auto_approve")
    )).scalar_one_or_none()
    if setting:
        setting.value = "true" if enabled else "false"
    else:
        db.add(AppSetting(key="auto_approve", value="true" if enabled else "false"))
    await db.commit()
    return {"autoApprove": enabled}
