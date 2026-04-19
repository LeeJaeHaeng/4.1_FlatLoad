from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from db.database import create_tables
from routers import obstacles, community, analyze
from services import yolo


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 서버 시작 시 DB 테이블 생성 + YOLO 모델 로드
    await create_tables()
    yolo.load_model()
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


@app.get("/")
async def root():
    return {"status": "ok", "yolo_ready": yolo.YOLO_READY}
