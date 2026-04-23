import asyncio
import json
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, update
from db.database import get_db
from db.models import Obstacle, Vote
from db.schemas import ObstacleOut, VoteRequest, VoteOut, TopContributor
from services import storage, detector

router = APIRouter(prefix="/api/obstacles", tags=["obstacles"])

def _to_out(row: Obstacle) -> ObstacleOut:
    detections = None
    if row.ai_detections:
        try:
            detections = json.loads(row.ai_detections)
        except Exception:
            pass
    return ObstacleOut(
        id=row.id,
        photoUri=row.photo_url,
        latitude=row.latitude,
        longitude=row.longitude,
        createdAt=row.created_at.isoformat(),
        userId=row.user_id,
        userEmail=row.user_email,
        displayName=row.display_name,
        likes=row.likes,
        dislikes=row.dislikes,
        aiLabel=row.ai_label,
        aiConfidence=row.ai_confidence,
        aiDetections=detections,
    )


@router.get("", response_model=list[ObstacleOut])
async def get_all_obstacles(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Obstacle).order_by(Obstacle.created_at.desc()))
    return [_to_out(r) for r in result.scalars().all()]


@router.post("", response_model=ObstacleOut)
async def create_obstacle(
    photo: UploadFile = File(...),
    latitude: float   = Form(...),
    longitude: float  = Form(...),
    user_id: str      = Form(""),
    user_email: str   = Form(""),
    display_name: str = Form(""),
    db: AsyncSession  = Depends(get_db),
):
    image_bytes = await photo.read()

    # Firebase 업로드 + Detectron2 추론 병렬 실행 (속도 최적화)
    async def _safe_detect() -> list:
        if not detector.MODEL_READY:
            return []
        try:
            return await asyncio.to_thread(detector.detect, image_bytes)
        except Exception as e:
            print(f"[Detectron2] 분석 실패: {e}")
            return []

    photo_url, detections = await asyncio.gather(
        storage.upload_image(image_bytes, photo.content_type or "image/jpeg"),
        _safe_detect(),
    )

    ai_label, ai_confidence, ai_detections_json = None, None, None
    if detections:
        top = detections[0]
        ai_label      = top["label"]
        ai_confidence = top["confidence"]
        ai_detections_json = json.dumps(detections, ensure_ascii=False)

    obs = Obstacle(
        photo_url     = photo_url,
        latitude      = latitude,
        longitude     = longitude,
        user_id       = user_id,
        user_email    = user_email,
        display_name  = display_name,
        ai_label      = ai_label,
        ai_confidence = ai_confidence,
        ai_detections = ai_detections_json,
    )
    db.add(obs)
    await db.commit()
    await db.refresh(obs)
    return _to_out(obs)


@router.post("/{obstacle_id}/vote", response_model=VoteOut)
async def vote_obstacle(
    obstacle_id: int,
    body: VoteRequest,
    db: AsyncSession = Depends(get_db),
):
    if body.vote_type not in ("like", "dislike"):
        raise HTTPException(400, "vote_type must be 'like' or 'dislike'")

    obs = await db.get(Obstacle, obstacle_id)
    if not obs:
        raise HTTPException(404, "장애물을 찾을 수 없습니다")

    existing = (await db.execute(
        select(Vote).where(Vote.obstacle_id == obstacle_id, Vote.user_id == body.user_id)
    )).scalar_one_or_none()

    new_vote: str | None

    if existing and existing.vote_type == body.vote_type:
        # 같은 투표 → 취소
        await db.delete(existing)
        col = "likes" if body.vote_type == "like" else "dislikes"
        await db.execute(
            update(Obstacle).where(Obstacle.id == obstacle_id)
            .values({col: func.greatest(0, getattr(Obstacle, col) - 1)})
        )
        new_vote = None
    elif existing:
        # 반대 투표로 변경
        existing.vote_type = body.vote_type
        if body.vote_type == "like":
            await db.execute(update(Obstacle).where(Obstacle.id == obstacle_id)
                .values(likes=Obstacle.likes + 1, dislikes=func.greatest(0, Obstacle.dislikes - 1)))
        else:
            await db.execute(update(Obstacle).where(Obstacle.id == obstacle_id)
                .values(dislikes=Obstacle.dislikes + 1, likes=func.greatest(0, Obstacle.likes - 1)))
        new_vote = body.vote_type
    else:
        # 신규 투표
        db.add(Vote(obstacle_id=obstacle_id, user_id=body.user_id, vote_type=body.vote_type))
        col = "likes" if body.vote_type == "like" else "dislikes"
        await db.execute(
            update(Obstacle).where(Obstacle.id == obstacle_id)
            .values({col: getattr(Obstacle, col) + 1})
        )
        new_vote = body.vote_type

    await db.commit()
    await db.refresh(obs)
    return VoteOut(likes=obs.likes, dislikes=obs.dislikes, userVote=new_vote)


@router.get("/{obstacle_id}/vote/{user_id}")
async def get_user_vote(obstacle_id: int, user_id: str, db: AsyncSession = Depends(get_db)):
    row = (await db.execute(
        select(Vote).where(Vote.obstacle_id == obstacle_id, Vote.user_id == user_id)
    )).scalar_one_or_none()
    return {"userVote": row.vote_type if row else None}


@router.get("/mine/{user_id}", response_model=list[ObstacleOut])
async def get_my_obstacles(user_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Obstacle).where(Obstacle.user_id == user_id).order_by(Obstacle.created_at.desc())
    )
    return [_to_out(r) for r in result.scalars().all()]


@router.get("/contributors/top", response_model=list[TopContributor])
async def get_top_contributors(limit: int = 3, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(
            Obstacle.user_id,
            Obstacle.display_name,
            Obstacle.user_email,
            func.sum(Obstacle.likes).label("totalLikes"),
        )
        .where(Obstacle.user_id != "")
        .group_by(Obstacle.user_id, Obstacle.display_name, Obstacle.user_email)
        .order_by(func.sum(Obstacle.likes).desc())
        .limit(limit)
    )
    return [
        TopContributor(userId=r.user_id, displayName=r.display_name,
                       userEmail=r.user_email, totalLikes=r.totalLikes or 0)
        for r in result.all()
    ]
