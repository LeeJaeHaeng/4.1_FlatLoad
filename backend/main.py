from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
from pathlib import Path
from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from db.database import create_tables, get_db
from db.models import CertifiedUser
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


@app.post("/api/certified/verify")
async def verify_certified_key(body: dict, db: AsyncSession = Depends(get_db)):
    key = body.get("api_key", "")
    if not key:
        return {"valid": False}
    result = await db.execute(select(CertifiedUser).where(CertifiedUser.api_key == key))
    user = result.scalar_one_or_none()
    if not user:
        return {"valid": False}
    now = datetime.now(timezone.utc)
    expires = user.expires_at.replace(tzinfo=timezone.utc) if user.expires_at.tzinfo is None else user.expires_at
    days_left = (expires - now).days
    if days_left <= 0:
        return {"valid": False, "reason": "expired"}
    return {
        "valid": True,
        "name": user.name,
        "affiliation": user.affiliation,
        "daysLeft": days_left,
    }
