from sqlalchemy import Column, Integer, String, Float, DateTime, Text, UniqueConstraint, func
from db.database import Base

class Obstacle(Base):
    __tablename__ = "obstacles"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    photo_url   = Column(String, nullable=False)        # Firebase Storage URL
    latitude    = Column(Float, nullable=False)
    longitude   = Column(Float, nullable=False)
    created_at  = Column(DateTime(timezone=True), server_default=func.now())
    user_id     = Column(String, nullable=False, default="")
    user_email  = Column(String, nullable=False, default="")
    display_name = Column(String, nullable=False, default="")
    likes       = Column(Integer, nullable=False, default=0)
    dislikes    = Column(Integer, nullable=False, default=0)
    # YOLOv4 분석 결과
    ai_label    = Column(String, nullable=True)         # 감지된 장애물 종류
    ai_confidence = Column(Float, nullable=True)        # 신뢰도 0~1


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
