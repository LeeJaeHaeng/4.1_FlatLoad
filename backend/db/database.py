from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import text
from sqlalchemy.pool import NullPool
from dotenv import load_dotenv
import os

load_dotenv()

def _normalize_database_url(url: str) -> str:
    if url.startswith("postgresql+asyncpg://") or url.startswith("sqlite+aiosqlite:"):
        return url
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+asyncpg://", 1)
    return url


DATABASE_URL = _normalize_database_url(
    os.getenv("DATABASE_URL", "postgresql+asyncpg://postgres:postgres@localhost:5432/flatroad")
)
IS_SQLITE = DATABASE_URL.startswith("sqlite+aiosqlite:")
IS_SUPABASE = "supabase.co" in DATABASE_URL
USE_NULL_POOL = os.getenv("DB_USE_NULL_POOL", "").lower() in {"1", "true", "yes"} or IS_SUPABASE
DISABLE_STATEMENT_CACHE = (
    os.getenv("DB_DISABLE_STATEMENT_CACHE", "").lower() in {"1", "true", "yes"}
    or ":6543" in DATABASE_URL
    or "pooler.supabase.com" in DATABASE_URL
)

if IS_SQLITE:
    engine = create_async_engine(DATABASE_URL, echo=False)
else:
    engine_options = {"echo": False}
    connect_args = {}
    if IS_SUPABASE:
        connect_args["ssl"] = True
    if DISABLE_STATEMENT_CACHE:
        connect_args["statement_cache_size"] = 0
    if connect_args:
        engine_options["connect_args"] = connect_args
    if USE_NULL_POOL:
        engine_options["poolclass"] = NullPool
    else:
        engine_options.update({"pool_size": 10, "max_overflow": 20})
    engine = create_async_engine(DATABASE_URL, **engine_options)
AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

class Base(DeclarativeBase):
    pass

async def get_db():
    async with AsyncSessionLocal() as session:
        yield session

async def create_tables():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        if IS_SQLITE:
            await conn.execute(text(
                "INSERT OR IGNORE INTO app_settings (key, value) VALUES ('auto_approve_images', 'true')"
            ))
            return

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
        await conn.execute(text(
            "ALTER TABLE obstacles ADD COLUMN IF NOT EXISTS is_certified BOOLEAN NOT NULL DEFAULT FALSE"
        ))
        await conn.execute(text(
            "ALTER TABLE posts ADD COLUMN IF NOT EXISTS is_certified BOOLEAN NOT NULL DEFAULT FALSE"
        ))
        await conn.execute(text(
            "ALTER TABLE comments ADD COLUMN IF NOT EXISTS is_certified BOOLEAN NOT NULL DEFAULT FALSE"
        ))
        await conn.execute(text(
            "CREATE TABLE IF NOT EXISTS app_settings (key VARCHAR PRIMARY KEY, value VARCHAR NOT NULL)"
        ))
        await conn.execute(text(
            "INSERT INTO app_settings (key, value) VALUES ('auto_approve_images', 'true') ON CONFLICT (key) DO NOTHING"
        ))
