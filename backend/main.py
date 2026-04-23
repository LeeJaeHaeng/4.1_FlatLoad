from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
from pathlib import Path
from db.database import create_tables
from routers import obstacles, community, analyze
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
