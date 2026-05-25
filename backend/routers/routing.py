from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from db.database import get_db
from db.models import Obstacle, DeleteNotification

router = APIRouter(prefix="/api/route", tags=["routing"])


class AvoidLocationsRequest(BaseModel):
    from_lat: float
    from_lng: float
    to_lat: float
    to_lng: float


@router.post("/avoid-locations")
async def get_avoid_locations(req: AvoidLocationsRequest, db: AsyncSession = Depends(get_db)):
    """신뢰도 기반으로 필터링된 장애물 좌표 목록 반환. 클라이언트가 Valhalla 호출 시 avoid_locations로 사용."""
    buf = 0.015  # ~1.5km 버퍼

    result = await db.execute(
        select(Obstacle).where(
            Obstacle.latitude  >= min(req.from_lat, req.to_lat)  - buf,
            Obstacle.latitude  <= max(req.from_lat, req.to_lat)  + buf,
            Obstacle.longitude >= min(req.from_lng, req.to_lng)  - buf,
            Obstacle.longitude <= max(req.from_lng, req.to_lng)  + buf,
            Obstacle.is_approved == True,
            # 비추천이 추천보다 3 이상 많으면 신뢰도 낮은 제보로 간주해 우회 제외
            Obstacle.dislikes <= Obstacle.likes + 2,
        )
    )
    obstacles = result.scalars().all()

    avoid_locs = [
        {"lat": o.latitude, "lon": o.longitude}
        for o in obstacles
    ][:50]

    return {"avoid_locations": avoid_locs}


@router.get("/notifications/{user_id}")
async def get_delete_notifications(user_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(DeleteNotification)
        .where(DeleteNotification.user_id == user_id, DeleteNotification.is_read == False)
        .order_by(DeleteNotification.created_at.desc())
    )
    rows = result.scalars().all()
    return [
        {"id": r.id, "obstacleId": r.obstacle_id, "reason": r.reason, "createdAt": r.created_at.isoformat()}
        for r in rows
    ]


@router.post("/notifications/{notification_id}/read")
async def mark_notification_read(notification_id: int, db: AsyncSession = Depends(get_db)):
    notif = await db.get(DeleteNotification, notification_id)
    if notif:
        notif.is_read = True
        await db.commit()
    return {"ok": True}
