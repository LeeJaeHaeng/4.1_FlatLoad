from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import text
from dotenv import load_dotenv
import os

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://postgres:postgres@localhost:5432/flatroad")

engine = create_async_engine(DATABASE_URL, echo=False, pool_size=10, max_overflow=20)
AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

class Base(DeclarativeBase):
    pass

async def get_db():
    async with AsyncSessionLocal() as session:
        yield session

async def create_tables():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # 신규 컬럼 마이그레이션 (기존 DB 호환)
        await conn.execute(text(
            "ALTER TABLE obstacles ADD COLUMN IF NOT EXISTS ai_detections TEXT"
        ))
        # photo_url NOT NULL 제약 해제 (Firebase 미설정 환경 지원)
        await conn.execute(text(
            "ALTER TABLE obstacles ALTER COLUMN photo_url DROP NOT NULL"
        ))
        await conn.execute(text(
            "ALTER TABLE obstacles ADD COLUMN IF NOT EXISTS is_approved BOOLEAN NOT NULL DEFAULT TRUE"
        ))
