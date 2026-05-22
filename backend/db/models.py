from sqlalchemy import Column, Integer, String, Float, DateTime, Text, Boolean, UniqueConstraint, func
from db.database import Base

class CertifiedUser(Base):
    __tablename__ = "certified_users"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    name        = Column(String, nullable=False)
    affiliation = Column(String, nullable=False, default="")
    api_key     = Column(String(64), nullable=False, unique=True)
    created_at  = Column(DateTime(timezone=True), server_default=func.now())
    expires_at  = Column(DateTime(timezone=True), nullable=False)


class Obstacle(Base):
    __tablename__ = "obstacles"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    photo_url   = Column(String, nullable=True)         # Firebase Storage URL (없으면 빈 문자열)
    latitude    = Column(Float, nullable=False)
    longitude   = Column(Float, nullable=False)
    created_at  = Column(DateTime(timezone=True), server_default=func.now())
    user_id     = Column(String, nullable=False, default="")
    user_email  = Column(String, nullable=False, default="")
    display_name = Column(String, nullable=False, default="")
    likes       = Column(Integer, nullable=False, default=0)
    dislikes    = Column(Integer, nullable=False, default=0)
    ai_label      = Column(String, nullable=True)
    ai_confidence = Column(Float, nullable=True)
    ai_detections = Column(Text, nullable=True)   # JSON: [{label,confidence,bbox}]
    is_approved   = Column(Boolean, nullable=False, default=True)
    is_certified  = Column(Boolean, nullable=False, default=False)


class Vote(Base):
    __tablename__ = "votes"
    __table_args__ = (UniqueConstraint("obstacle_id", "user_id"),)

    id          = Column(Integer, primary_key=True, autoincrement=True)
    obstacle_id = Column(Integer, nullable=False)
    user_id     = Column(String, nullable=False)
    vote_type   = Column(String, nullable=False)        # 'like' | 'dislike'


class Post(Base):
    __tablename__ = "posts"

    id           = Column(Integer, primary_key=True, autoincrement=True)
    title        = Column(String, nullable=False)
    content      = Column(Text, nullable=False)
    user_id      = Column(String, nullable=False, default="")
    user_email   = Column(String, nullable=False, default="")
    display_name = Column(String, nullable=False, default="")
    created_at   = Column(DateTime(timezone=True), server_default=func.now())
    likes        = Column(Integer, nullable=False, default=0)
    is_certified = Column(Boolean, nullable=False, default=False)


class PostLike(Base):
    __tablename__ = "post_likes"
    __table_args__ = (UniqueConstraint("post_id", "user_id"),)

    id      = Column(Integer, primary_key=True, autoincrement=True)
    post_id = Column(Integer, nullable=False)
    user_id = Column(String, nullable=False)


class Comment(Base):
    __tablename__ = "comments"

    id           = Column(Integer, primary_key=True, autoincrement=True)
    post_id      = Column(Integer, nullable=False)
    content      = Column(Text, nullable=False)
    user_id      = Column(String, nullable=False, default="")
    user_email   = Column(String, nullable=False, default="")
    display_name = Column(String, nullable=False, default="")
    created_at   = Column(DateTime(timezone=True), server_default=func.now())
    is_certified = Column(Boolean, nullable=False, default=False)
