import asyncio
import json
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, update
from db.database import get_db
from db.models import Obstacle, ObstaclePhoto, Vote, CertifiedUser, DeleteNotification, AppSetting
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
        photoUri=storage.public_image_url(row.photo_url),
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
        isCertified=row.is_certified,
    )


@router.get("", response_model=list[ObstacleOut])
async def get_all_obstacles(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Obstacle).order_by(Obstacle.created_at.desc()))
    return [_to_out(r) for r in result.scalars().all()]


@router.post("", response_model=ObstacleOut)
async def create_obstacle(
    photo: UploadFile = File(...),
    latitude: float        = Form(...),
    longitude: float       = Form(...),
    user_id: str           = Form(""),
    user_email: str        = Form(""),
    display_name: str      = Form(""),
    certified_key: str     = Form(""),
    manual_label: str      = Form(""),
    preview_ai_label: str          = Form("", alias="ai_label"),
    preview_ai_confidence: str     = Form("", alias="ai_confidence"),
    preview_ai_detections: str     = Form("", alias="ai_detections"),
    db: AsyncSession       = Depends(get_db),
):
    image_bytes = await photo.read()

    # 미리보기에서 분석한 결과가 있으면 저장 시 Roboflow를 다시 호출하지 않는다.
    async def _safe_detect() -> list:
        if preview_ai_label.strip() or preview_ai_detections.strip():
            return []
        if manual_label.strip():
            return []
        if not detector.MODEL_READY:
            return []
        try:
            return await asyncio.to_thread(detector.detect, image_bytes)
        except Exception as e:
            print(f"[Roboflow] 분석 실패: {e}")
            return []

    detections = await _safe_detect()

    ai_label, ai_confidence, ai_detections_json = None, None, None
    if preview_ai_detections.strip():
        try:
            parsed = json.loads(preview_ai_detections)
            if isinstance(parsed, list):
                ai_detections_json = json.dumps(parsed, ensure_ascii=False)
        except Exception:
            ai_detections_json = None
    if manual_label.strip():
        ai_label = manual_label.strip()
    elif preview_ai_label.strip():
        ai_label = preview_ai_label.strip()
        try:
            ai_confidence = float(preview_ai_confidence) if preview_ai_confidence.strip() else None
        except ValueError:
            ai_confidence = None
    elif detections:
        top = detections[0]
        ai_label           = top["label"]
        ai_confidence      = top["confidence"]
        ai_detections_json = json.dumps(detections, ensure_ascii=False)

    is_certified = False
    if certified_key:
        cert = (await db.execute(
            select(CertifiedUser).where(
                CertifiedUser.api_key == certified_key,
                CertifiedUser.expires_at > datetime.now(timezone.utc),
            )
        )).scalar_one_or_none()
        if cert:
            is_certified = True

    auto_approve_setting = (await db.execute(
        select(AppSetting).where(AppSetting.key == "auto_approve_images")
    )).scalar_one_or_none()
    is_approved = (auto_approve_setting is None or auto_approve_setting.value == "true")

    obs = Obstacle(
        photo_url     = None,
        latitude      = latitude,
        longitude     = longitude,
        user_id       = user_id,
        user_email    = user_email,
        display_name  = display_name,
        ai_label      = ai_label,
        ai_confidence = ai_confidence,
        ai_detections = ai_detections_json,
        is_certified  = is_certified,
        is_approved   = is_approved,
    )
    db.add(obs)
    await db.commit()
    await db.refresh(obs)

    obs.photo_url = f"/api/obstacles/{obs.id}/photo"
    db.add(ObstaclePhoto(
        obstacle_id=obs.id,
        content_type=photo.content_type or "image/jpeg",
        image_bytes=image_bytes,
    ))
    await db.commit()
    await db.refresh(obs)
    return _to_out(obs)


@router.get("/{obstacle_id}/photo")
async def get_obstacle_photo(obstacle_id: int, db: AsyncSession = Depends(get_db)):
    photo = await db.get(ObstaclePhoto, obstacle_id)
    if not photo:
        raise HTTPException(404, "사진을 찾을 수 없습니다")
    return Response(
        content=bytes(photo.image_bytes),
        media_type=photo.content_type,
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


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


@router.patch("/{obstacle_id}/label")
async def update_obstacle_label(
    obstacle_id: int,
    body: dict,
    db: AsyncSession = Depends(get_db),
):
    selected_label = body.get("selected_label", "")
    if not selected_label:
        raise HTTPException(400, "selected_label is required")

    obs = await db.get(Obstacle, obstacle_id)
    if not obs:
        raise HTTPException(404, "장애물을 찾을 수 없습니다")

    if obs.ai_detections:
        try:
            detections = json.loads(obs.ai_detections)
            valid_labels = [d["label"] for d in detections]
            if selected_label not in valid_labels:
                raise HTTPException(400, "선택한 레이블이 감지 결과에 없습니다")
            for d in detections:
                if d["label"] == selected_label:
                    obs.ai_label = selected_label
                    obs.ai_confidence = d["confidence"]
                    break
        except json.JSONDecodeError:
            raise HTTPException(500, "감지 데이터 파싱 오류")
    else:
        obs.ai_label = selected_label

    await db.commit()
    await db.refresh(obs)
    return _to_out(obs)



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
