from pydantic import BaseModel
from datetime import datetime
from typing import Optional

# ── 인증된 사용자 ────────────────────────────────────────────────────

class CertifiedUserCreate(BaseModel):
    name: str
    affiliation: str = ""

class CertifiedUserUpdate(BaseModel):
    name: str
    affiliation: str = ""

class CertifiedUserOut(BaseModel):
    id: int
    name: str
    affiliation: str
    apiKey: str
    createdAt: str
    expiresAt: str
    daysLeft: int

    model_config = {"from_attributes": True}

class CertifiedUserCreated(BaseModel):
    id: int
    name: str
    affiliation: str
    apiKey: str
    expiresAt: str

# ── 장애물 ────────────────────────────────────────────────────────

class ObstacleCreate(BaseModel):
    latitude: float
    longitude: float
    user_id: str = ""
    user_email: str = ""
    display_name: str = ""

class ObstacleOut(BaseModel):
    id: int
    photoUri: str           # 앱 인터페이스 맞춤 (camelCase)
    latitude: float
    longitude: float
    createdAt: str
    userId: str
    userEmail: str
    displayName: str
    likes: int
    dislikes: int
    aiLabel: Optional[str] = None
    aiConfidence: Optional[float] = None
    aiDetections: Optional[list] = None  # [{label,confidence,bbox:[cx,cy,w,h]}]
    isCertified: bool = False

    model_config = {"from_attributes": True}

class VoteRequest(BaseModel):
    user_id: str
    vote_type: str          # 'like' | 'dislike'

class VoteOut(BaseModel):
    likes: int
    dislikes: int
    userVote: Optional[str]

class TopContributor(BaseModel):
    userId: str
    displayName: str
    userEmail: str
    totalLikes: int

# ── 커뮤니티 ────────────────────────────────────────────────────────

class PostCreate(BaseModel):
    title: str
    content: str
    user_id: str = ""
    user_email: str = ""
    display_name: str = ""
    certified_key: str = ""

class PostOut(BaseModel):
    id: int
    title: str
    content: str
    userId: str
    userEmail: str
    displayName: str
    createdAt: str
    likes: int
    commentCount: int = 0
    isCertified: bool = False

    model_config = {"from_attributes": True}

class CommentCreate(BaseModel):
    content: str
    user_id: str = ""
    user_email: str = ""
    display_name: str = ""
    certified_key: str = ""

class CommentOut(BaseModel):
    id: int
    postId: int
    content: str
    userId: str
    userEmail: str
    displayName: str
    createdAt: str
    isCertified: bool = False

    model_config = {"from_attributes": True}

# ── AI 분석 ────────────────────────────────────────────────────────

class AnalyzeOut(BaseModel):
    label: str
    confidence: float
    bbox: list[float]       # [x, y, w, h] 정규화값 0~1
