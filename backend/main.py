from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
from pathlib import Path
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from db.database import create_tables, get_db
from db.models import CertifiedUser, DeleteNotification
from db.schemas import CertifiedUserCreate, DeleteNotificationOut
from routers import obstacles, community, analyze, admin
from services import detector


@asynccontextmanager
async def lifespan(app: FastAPI):
    await create_tables()
    detector.load_model()
    yield


app = FastAPI(title="FlatRoad API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(obstacles.router)
app.include_router(community.router)
app.include_router(analyze.router)
app.include_router(admin.router)

uploads_dir = Path(__file__).parent / "uploads"
uploads_dir.mkdir(exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(uploads_dir)), name="uploads")


@app.get("/")
async def root():
    return {
        "status": "ok",
        "model_ready": detector.MODEL_READY,
        "classes": detector.class_names,
    }


# ── 기관 인증 키 검증 ─────────────────────────────────────────────

@app.post("/api/certified/verify")
async def verify_certified_key(body: CertifiedUserCreate, db: AsyncSession = Depends(get_db)):
    cert = (await db.execute(
        select(CertifiedUser).where(CertifiedUser.certified_key == body.certified_key)
    )).scalar_one_or_none()
    return {"verified": cert is not None}


# ── 삭제 알림 ─────────────────────────────────────────────────────

@app.get("/api/route/notifications/{user_id}", response_model=list[DeleteNotificationOut])
async def get_delete_notifications(user_id: str, db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(DeleteNotification)
        .where(DeleteNotification.user_id == user_id, DeleteNotification.is_read == False)
        .order_by(DeleteNotification.created_at.desc())
    )).scalars().all()
    return [
        DeleteNotificationOut(
            id=r.id,
            userId=r.user_id,
            obstacleId=r.obstacle_id,
            reason=r.reason,
            isRead=r.is_read,
            createdAt=r.created_at.isoformat(),
        )
        for r in rows
    ]


@app.patch("/api/route/notifications/{notif_id}/read")
async def mark_notification_read(notif_id: int, db: AsyncSession = Depends(get_db)):
    notif = await db.get(DeleteNotification, notif_id)
    if not notif:
        return {"ok": False}
    notif.is_read = True
    await db.commit()
    return {"ok": True}
