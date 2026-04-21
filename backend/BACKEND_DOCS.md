# FlatRoad 백엔드 / AI 개발 문서

> **담당자: 이재행** | 작업 범위: 백엔드 서버 설계·구현, AI 모델 연동, DB 설계, 앱-서버 연동, 지도 필터 기능 디버깅
> 최종 수정: 2026-04-20

---

## 1. 프로젝트 개요

### 서비스 목표
전동이동보조기기(전동휠체어 등) 사용자를 위한 **안전 경로 안내 서비스 — FlatRoad**

| 핵심 기능 | 설명 |
|-----------|------|
| 안전 경로 탐색 | 인도·보행자 도로 기반, 계단·경사·좁은 길 회피 (Valhalla wheelchair 프로파일) |
| 장애물 데이터 수집 | 사용자가 직접 촬영한 장애물 사진을 GPS와 함께 저장 (크라우드소싱) |
| AI 장애물 분류 | YOLOv5 모델이 사진을 분석, 볼라드(통행 방해 구조물) 자동 탐지 |
| 공유 DB | 모든 사용자의 장애물 데이터를 서버에 공유 저장 → 경로 경고에 활용 |
| 커뮤니티 | 게시글·댓글·좋아요 (로컬 SQLite → 서버 공유 DB로 이관) |

### AI 모델의 역할 (이재행 담당)
```
사용자 촬영
    ↓
백엔드 POST /api/obstacles (사진 + GPS)
    ↓
YOLOv5 자동 분석 → "Bollard 87% 신뢰도"
    ↓
PostgreSQL 저장 (ai_label, ai_confidence 컬럼)
    ↓
모든 사용자 지도에 볼라드 마커 표시
    ↓
경로 계산 시 50m 이내 볼라드 → ⚠️ 경고
```

---

## 2. 시스템 아키텍처

```
┌──────────────────────────────────────────────────────┐
│             Expo Go 앱 (React Native)                 │
│  ContributeScreen │ MapScreen │ CommunityScreen       │
│         utils/api.ts (API 클라이언트)                 │
└──────────────┬───────────────────────────────────────┘
               │ HTTP REST API (같은 WiFi 또는 ngrok)
               ▼
┌──────────────────────────────────────────────────────┐
│         FastAPI 서버 — 이재행 구현                    │
│  host: 0.0.0.0:8000 (로컬 PC)                        │
│                                                      │
│  routers/obstacles.py   →  장애물 CRUD + 투표         │
│  routers/community.py   →  게시글·댓글               │
│  routers/analyze.py     →  AI 단독 분석               │
│                                                      │
│  services/yolo.py       →  YOLOv5 추론               │
│  services/storage.py    →  Firebase Storage 업로드    │
└──────┬───────────────────────────┬───────────────────┘
       │                           │
       ▼                           ▼
┌─────────────┐         ┌──────────────────────┐
│ PostgreSQL  │         │  Firebase Storage     │
│ 17 (로컬)   │         │  (장애물 사진 URL)     │
│ flatroad DB │         └──────────────────────┘
└─────────────┘
```

---

## 3. 기술 스택

| 항목 | 기술 | 버전 |
|------|------|------|
| 언어 | Python | 3.13.7 |
| 웹 프레임워크 | FastAPI | 0.115 |
| 비동기 DB 드라이버 | asyncpg | 0.31 |
| ORM | SQLAlchemy (async) | 2.0 |
| 데이터베이스 | PostgreSQL | 17 |
| AI 프레임워크 | YOLOv5 | 7.0.14 |
| 딥러닝 | PyTorch | 2.11 (CPU) |
| 이미지 처리 | Pillow | 12.x |
| 파일 스토리지 | Firebase Storage | firebase-admin 7.4 |
| ASGI 서버 | Uvicorn | 0.44 |

---

## 4. AI 모델 상세 — 이재행

### 모델 정보
| 항목 | 내용 |
|------|------|
| 모델 구조 | YOLOv5s (Small, 283 layers) |
| 가중치 파일 | `backend/best.pt` (14MB) |
| 원본 출처 | GitHub: Tibet-Fox/Hack_Festa |
| 학습 환경 | Google Colab |
| 감지 클래스 수 | 1개 |
| 감지 클래스명 | **Bollard (볼라드)** |
| 입력 해상도 | 640×640 px |
| Confidence Threshold | 0.4 (40%) |
| NMS IoU Threshold | 0.45 |
| 추론 환경 | CPU (torch-2.11+cpu) |

### 볼라드(Bollard)란?
보행로·광장에 설치되는 원통형 금속/콘크리트 구조물.
차량 진입 차단 목적이지만 전동휠체어의 통행을 막는 주요 장애물.

### 학습 과정 (이미지분석모델만들기.ipynb 기반)
1. 볼라드 이미지 웹 크롤링 수집
2. Train 80% / Validation 20% 분할
3. YOLOv5s Transfer Learning (COCO pretrained → Bollard fine-tuning)
4. 최종 가중치 `best.pt` 저장

### PyTorch 2.6 호환성 이슈 해결 (이재행)
PyTorch 2.6부터 `torch.load()` 기본값이 `weights_only=True`로 변경되어
구버전 YOLOv5 모델 로드 시 오류 발생.

**해결 방법**: `torch.load` 래퍼 패치 적용
```python
_orig_load = torch.load
def _load_compat(*args, **kwargs):
    kwargs.setdefault('weights_only', False)
    return _orig_load(*args, **kwargs)
torch.load = _load_compat
```

### 추론 흐름
```python
이미지 bytes 입력
    → PIL Image 변환 (RGB)
    → yolov5.load('best.pt')로 추론 (size=640)
    → results.pandas().xyxy[0] 로 결과 추출
    → bbox 정규화 (0~1)
    → [{"label":"Bollard","confidence":0.87,"bbox":[cx,cy,w,h]}]
```

---

## 5. 데이터베이스 설계 — 이재행

### obstacles (장애물 테이블)
```sql
CREATE TABLE obstacles (
    id             SERIAL PRIMARY KEY,
    photo_url      TEXT    NOT NULL,        -- Firebase Storage URL
    latitude       FLOAT   NOT NULL,
    longitude      FLOAT   NOT NULL,
    created_at     TIMESTAMPTZ DEFAULT now(),
    user_id        TEXT    DEFAULT '',
    user_email     TEXT    DEFAULT '',
    display_name   TEXT    DEFAULT '',
    likes          INTEGER DEFAULT 0,
    dislikes       INTEGER DEFAULT 0,
    ai_label       TEXT,                   -- YOLOv5 결과 (Bollard / NULL)
    ai_confidence  FLOAT                   -- 신뢰도 0.0~1.0
);
```

### votes (투표 테이블)
```sql
CREATE TABLE votes (
    id           SERIAL PRIMARY KEY,
    obstacle_id  INTEGER NOT NULL,
    user_id      TEXT    NOT NULL,
    vote_type    TEXT    NOT NULL,         -- 'like' | 'dislike'
    UNIQUE(obstacle_id, user_id)           -- 중복 투표 방지
);
```

### posts / post_likes / comments (커뮤니티)
```sql
CREATE TABLE posts (
    id           SERIAL PRIMARY KEY,
    title        TEXT NOT NULL,
    content      TEXT NOT NULL,
    user_id      TEXT DEFAULT '',
    user_email   TEXT DEFAULT '',
    display_name TEXT DEFAULT '',
    created_at   TIMESTAMPTZ DEFAULT now(),
    likes        INTEGER DEFAULT 0
);

CREATE TABLE post_likes (
    id      SERIAL PRIMARY KEY,
    post_id INTEGER NOT NULL,
    user_id TEXT    NOT NULL,
    UNIQUE(post_id, user_id)
);

CREATE TABLE comments (
    id           SERIAL PRIMARY KEY,
    post_id      INTEGER NOT NULL,
    content      TEXT    NOT NULL,
    user_id      TEXT    DEFAULT '',
    user_email   TEXT    DEFAULT '',
    display_name TEXT    DEFAULT '',
    created_at   TIMESTAMPTZ DEFAULT now()
);
```

> **테이블 자동 생성**: 서버 최초 실행 시 `SQLAlchemy create_all()`로 자동 생성됨

---

## 6. API 명세 — 이재행

### 장애물 API `/api/obstacles`

#### GET /api/obstacles
전체 장애물 목록 조회 (지도 표시용)
```json
// 응답 예시
[
  {
    "id": 1,
    "photoUri": "https://storage.googleapis.com/...",
    "latitude": 37.5665,
    "longitude": 126.9780,
    "createdAt": "2026-04-20T12:00:00+00:00",
    "userId": "abc123",
    "userEmail": "user@example.com",
    "displayName": "홍길동",
    "likes": 5,
    "dislikes": 1,
    "aiLabel": "Bollard",
    "aiConfidence": 0.87
  }
]
```

#### POST /api/obstacles
장애물 등록 — **AI 분석 자동 실행**
```
Content-Type: multipart/form-data

photo:        [이미지 파일 .jpg]
latitude:     37.5665
longitude:    126.9780
user_id:      "firebase_uid"
user_email:   "user@example.com"
display_name: "홍길동"
```
처리 순서:
1. Firebase Storage에 이미지 업로드 → URL 획득
2. YOLOv5로 이미지 분석 → ai_label, ai_confidence
3. PostgreSQL에 전체 데이터 저장
4. 저장된 레코드 반환

#### POST /api/obstacles/{id}/vote
```json
// 요청
{"user_id": "abc123", "vote_type": "like"}

// 응답
{"likes": 6, "dislikes": 1, "userVote": "like"}
```
- 같은 타입 재투표 → 취소 (toggle)
- 반대 타입 투표 → 변경

#### GET /api/obstacles/mine/{user_id}
내가 등록한 장애물 목록

#### GET /api/obstacles/contributors/top?limit=3
좋아요 TOP 3 기여자
```json
[{"userId":"...", "displayName":"홍길동", "userEmail":"...", "totalLikes":15}]
```

### AI 분석 API `/api/analyze`

#### GET /api/analyze/status
```json
{"ready": true, "classes": ["Bollard"], "message": "모델 준비 완료"}
```

#### POST /api/analyze
이미지만 단독으로 AI 분석 (장애물 저장 없음)
```
Content-Type: multipart/form-data
photo: [이미지 파일]
```
```json
// 응답
[{"label": "Bollard", "confidence": 0.87, "bbox": [0.45, 0.52, 0.18, 0.31]}]
```

### 커뮤니티 API `/api/community`

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/community/posts` | 게시글 목록 (댓글 수 포함) |
| POST | `/api/community/posts` | 게시글 작성 |
| DELETE | `/api/community/posts/{id}?user_id=` | 본인 게시글 삭제 |
| POST | `/api/community/posts/{id}/like?user_id=` | 좋아요 토글 |
| GET | `/api/community/posts/{id}/liked/{user_id}` | 좋아요 여부 |
| GET | `/api/community/posts/{id}/comments` | 댓글 목록 |
| POST | `/api/community/posts/{id}/comments` | 댓글 작성 |
| DELETE | `/api/community/comments/{id}?user_id=` | 본인 댓글 삭제 |

---

## 7. 길찾기 AI 연동 구조

### 볼라드 → 경로 경고 흐름
```
MapScreen: GET /api/obstacles
    → AI 확인 볼라드 목록 (ai_label="Bollard", ai_confidence≥0.5)

경로 계산 후 (Valhalla wheelchair 프로파일):
    → 경로 포인트 배열 생성
    → 각 볼라드와 경로 포인트 간 Haversine 거리 계산
    → 50m 이내 볼라드 수 → obstacleCount 표시
    → 지도에 ⚠️ 경고 마커 표시
```

### AI 신뢰도 등급
| ai_confidence | 표시 |
|---------------|------|
| ≥ 0.7 | 🔴 확인된 볼라드 |
| 0.4~0.7 | 🟡 추정 볼라드 |
| < 0.4 | 미표시 (필터링) |

---

## 8. 앱 ↔ 서버 연동 구조

### API 클라이언트 (`utils/api.ts`)
앱에서 백엔드를 호출하는 모든 함수 정의.
서버 연결 실패 시 로컬 SQLite로 자동 폴백.

```typescript
// 설정
export const API_BASE_URL = 'http://192.168.0.40:8000';
// PC의 WiFi IP — 폰과 같은 네트워크 필요
```

### ContributeScreen 연동
1. 사진 촬영 후 저장 버튼 → `apiCreateObstacle()` 호출
2. 서버가 AI 분석 후 응답 → AI 결과를 Alert으로 표시
3. 서버 연결 실패 시 → 로컬 SQLite에 저장 (폴백)

### MapScreen 연동
1. 화면 포커스 시 → `apiGetObstacles()` 호출 (서버 전체 장애물)
2. 실패 시 → `getAllObstaclesWithBase64()` (로컬 SQLite 폴백)

---

## 9. 환경 설정 파일

### .env
```ini
# PostgreSQL (로컬)
DATABASE_URL=postgresql+asyncpg://postgres:0000@localhost:5432/flatroad

# Firebase Admin SDK
FIREBASE_CREDENTIALS_PATH=./firebase-adminsdk.json
FIREBASE_STORAGE_BUCKET=map2026-233a5.firebasestorage.app

# YOLOv5 모델
YOLO_MODEL=./best.pt

# 서버 포트
PORT=8000
```

---

## 10. 실행 방법 (이재행 작성)

### 사전 준비 (최초 1회)

#### 1) Python 가상환경 및 패키지 설치
```powershell
cd "C:\Users\leejh\OneDrive\바탕 화면\4-1\종합프로젝트\FlatRoad\backend"
python -m venv venv
./venv/Scripts/pip install -r requirements.txt
```

#### 2) PostgreSQL 설치 (이미 완료)
- winget으로 PostgreSQL 17 설치됨
- DB: `flatroad` 생성 완료
- 계정: `postgres` / 비밀번호: `0000`

#### 3) Firebase 서비스 계정 설정 (이미지 업로드 필요 시)
1. Firebase 콘솔(console.firebase.google.com) → 프로젝트 `map2026-233a5`
2. 프로젝트 설정 → 서비스 계정 → 새 비공개 키 생성
3. 다운로드한 JSON → `backend/firebase-adminsdk.json` 으로 저장

---

### 매일 서버 실행 방법

```powershell
# backend 폴더에서
cd "C:\Users\leejh\OneDrive\바탕 화면\4-1\종합프로젝트\FlatRoad\backend"

# 외부(폰) 접속 허용하려면 --host 0.0.0.0 추가
./venv/Scripts/uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

서버 시작 시 콘솔에 아래 로그 확인:
```
[YOLO] 모델 로드 완료 — 클래스: ['Bollard']
INFO: Application startup complete.
```

---

### Expo Go 앱에서 테스트

#### 전제 조건
- PC와 휴대폰이 **동일한 WiFi** 연결
- PC WiFi IP: `192.168.0.40`
- 백엔드 서버 실행 중

#### 방화벽 허용 (관리자 PowerShell, 최초 1회)
```powershell
New-NetFirewallRule -DisplayName 'FlatRoad Backend 8000' -Direction Inbound -Protocol TCP -LocalPort 8000 -Action Allow
```

#### 앱 실행
```powershell
# 프로젝트 루트에서 (backend 폴더 아님)
cd "C:\Users\leejh\OneDrive\바탕 화면\4-1\종합프로젝트\FlatRoad"
npm start
```
QR코드 → Expo Go 앱으로 스캔

#### 연결 확인
폰 브라우저에서: `http://192.168.0.40:8000`
```json
{"status": "ok", "yolo_ready": true}
```
→ 이 화면이 뜨면 정상

#### AI 테스트 방법
1. Expo Go에서 "기여하기" 탭 → 촬영하기
2. 볼라드(노란/회색 원통형 구조물) 촬영
3. 저장 버튼 → AI 분석 결과 팝업 확인
   ```
   저장 완료
   장애물 정보가 저장되었습니다.
   🤖 AI 분석 결과: Bollard (신뢰도 87%)
   ```

---

### API 문서 (Swagger UI)
서버 실행 후 브라우저에서:
- **로컬**: http://localhost:8000/docs
- **폰에서**: http://192.168.0.40:8000/docs

---

## 11. 파일 구조

```
backend/
├── main.py               ← FastAPI 앱 진입점, 서버 시작 시 DB 생성 + YOLO 로드
├── best.pt               ← YOLOv5s 학습 모델 (볼라드 감지, 14MB)
├── requirements.txt      ← Python 의존 패키지
├── .env                  ← 환경변수 (비공개, git 제외)
├── .env.example          ← 환경변수 템플릿
├── SETUP.md              ← 간단 실행 가이드
├── BACKEND_DOCS.md       ← 이 문서 (상세 개발 문서)
├── venv/                 ← Python 가상환경
│
├── db/
│   ├── database.py       ← PostgreSQL 비동기 연결 (asyncpg + SQLAlchemy)
│   ├── models.py         ← ORM 모델 (obstacles, votes, posts, post_likes, comments)
│   └── schemas.py        ← Pydantic 입출력 스키마 (앱 camelCase 맞춤)
│
├── routers/
│   ├── obstacles.py      ← 장애물 CRUD, 투표, 기여자 랭킹 API
│   ├── community.py      ← 게시글, 댓글, 좋아요 API
│   └── analyze.py        ← AI 단독 분석 API
│
└── services/
    ├── yolo.py           ← YOLOv5 모델 로드 및 추론 (PyTorch 호환 패치 포함)
    └── storage.py        ← Firebase Storage 이미지 업로드

utils/
└── api.ts                ← 앱용 백엔드 API 클라이언트 (폴백 포함)
```

---

## 12. 작업 이력 — 이재행

| 날짜 | 작업 내용 |
|------|-----------|
| 2026-04-20 | YOLOv5 `best.pt` 모델 GitHub(Tibet-Fox/Hack_Festa)에서 확보 및 다운로드 |
| 2026-04-20 | FastAPI 백엔드 서버 초기 구축 (main.py, CORS, lifespan) |
| 2026-04-20 | PostgreSQL 17 winget 설치, `flatroad` DB 생성, 계정 설정 |
| 2026-04-20 | SQLAlchemy async 기반 ORM 모델 설계 (5개 테이블) |
| 2026-04-20 | Pydantic 스키마 설계 (앱 인터페이스 camelCase 호환) |
| 2026-04-20 | 장애물 CRUD API 구현 (등록·조회·투표·기여자 랭킹) |
| 2026-04-20 | 커뮤니티 API 구현 (게시글·댓글·좋아요) |
| 2026-04-20 | YOLOv5 추론 서비스 구현 (`services/yolo.py`) |
| 2026-04-20 | AI 분석 API 구현 (`/api/analyze`) |
| 2026-04-20 | Firebase Storage 연동 서비스 구현 |
| 2026-04-20 | ultralytics→yolov5 패키지 교체 (YOLOv5/YOLOv8 호환성 문제 해결) |
| 2026-04-20 | PyTorch 2.6 `weights_only` 호환성 패치 적용 |
| 2026-04-20 | YOLOv5 모델 로드 성공 확인 (`클래스: ['Bollard']`) |
| 2026-04-20 | `utils/api.ts` 앱용 API 클라이언트 구현 (폴백 포함) |
| 2026-04-20 | ContributeScreen AI 분석 결과 표시 연동 |
| 2026-04-20 | MapScreen 서버 장애물 조회 연동 |
| 2026-04-20 | Expo Go 테스트 환경 구성 (WiFi IP: 192.168.0.40) |
| 2026-04-20 | MapScreen 필터 버튼(경사로·엘리베이터·장애인화장실) 디버깅 및 수정 |
| 2026-04-20 | 엘리베이터·장애인화장실 데이터 소스 Overpass → Kakao 로컬 검색 API로 교체 |
| 2026-04-20 | 경사로 필터도 Kakao API로 전환 (무장애·배리어프리·휠체어경사로 키워드 병렬 조회) |
| 2026-04-20 | 루트 .env 생성 (EXPO_PUBLIC_KAKAO_REST_KEY, EXPO_PUBLIC_API_BASE_URL) |
| 2026-04-20 | 데모 모드 적용 — Firebase 로그인 제거, 고정 데모 유저로 교체 |
| 2026-04-20 | MyPageScreen 로그인 UI 제거, 데모 프로필 화면으로 교체 |

---

## 13. 잔여 작업

| 우선순위 | 항목 | 설명 |
|----------|------|------|
| 🔴 높음 | Firebase 서비스 계정 JSON 발급 | 이미지 업로드 기능 활성화 필요 |
| 🔴 높음 | 방화벽 포트 8000 허용 | 관리자 PowerShell 1회 실행 필요 |
| 🟡 중간 | GitHub PR 병합 | AlphaXen/testmap에 Collaborator 권한 획득 후 진행 |
| 🟡 중간 | AI 신뢰도 기반 마커 차등 표시 | confidence에 따라 색상 구분 |
| 🟢 낮음 | ngrok / 클라우드 배포 | 실사용 환경에서 고정 URL 필요 |

---

## 14. 지도 필터 기능 구조 — 이재행

### 개요

홈(지도) 화면 상단의 `경사로 / 엘리베이터 / 장애인화장실` 필터 버튼을 누르면
주변 시설을 지도에 아이콘으로 표시하는 기능.
**별도 백엔드 API 없이** OpenStreetMap의 Overpass API를 앱에서 직접 호출.

### 데이터 소스

| 필터 | 데이터 출처 | 검색 키워드 |
| ---- | ---------- | ---------- |
| 경사로 | **Kakao 로컬 검색 API** | `무장애`, `배리어프리`, `휠체어경사로` (3개 병렬) |
| 엘리베이터 | **Kakao 로컬 검색 API** | `엘리베이터` |
| 장애인화장실 | **Kakao 로컬 검색 API** | `장애인화장실` |

### 검색 범위

현재 위치 기준 반경 약 **5km** (위도·경도 ±0.05°)

### 흐름

```text
사용자가 필터 버튼 탭
    ↓
toggleFilter('엘리베이터') 호출 (MapScreen.tsx)
    ↓
Overpass API POST 요청 (https://overpass-api.de/api/interpreter)
    - 현재 위치 bbox 계산
    - OSM 쿼리 전송 (timeout 25초)
    ↓
결과 elements 파싱 (lat/lon 추출)
    ↓
WebView.injectJavaScript → addFacilityMarker(lat, lng, 'elevator')
    ↓
Leaflet 지도에 🛗 아이콘 마커 추가
    ↓
Alert: "주변 엘리베이터 N개를 찾았습니다"
```

### 마커 스타일

| 타입 | 아이콘 | 색상 |
|------|--------|------|
| ramp (경사로) | ♿ | 초록 (#4CAF50) |
| elevator (엘리베이터) | 🛗 | 파랑 (#2196F3) |
| toilet (장애인화장실) | 🚻 | 보라 (#9C27B0) |
| slope (경사·계단 경고) | ⚠️ | 주황 (#FF5722) |

### 필터 버튼 토글

- **비활성 → 활성**: Overpass API 조회 → 마커 추가 → 칩 주황색으로 표시
- **활성 → 비활성**: `clearFacilityMarkers(type)` 호출 → 해당 타입 마커 일괄 제거

### 디버깅 이력 (2026-04-20)

**문제**: 필터 버튼을 눌러도 지도에 아무것도 표시되지 않음

**원인 분석**:

1. Overpass 쿼리 태그 조건이 너무 엄격 → 한국 OSM 데이터에 해당 태그 적용률 낮음
2. 검색 반경이 좁음 (±0.03° ≈ 3km)
3. 결과 0개여도 아무 피드백 없음 → 사용자가 정상 동작과 구분 불가
4. location이 null인 경우 아무 반응 없이 종료 (안내 없음)

**해결**:

- Overpass 쿼리에 유사 태그 다수 추가 (OR 조건 확장)
- 검색 반경 ±0.05°로 확대
- 결과 개수 Alert 추가 (0개 / N개 모두 안내)
- location null 시 안내 메시지 표시
- fetch timeout 20초 AbortController 추가

---

## 15. 간트차트 대비 실제 진행 현황 — 이재행

> 기준일: 2026-04-20  
> 프로젝트 기간: 2026-03-03 ~ 2026-06-11

### 완료 / 진행 현황

| # | 간트 작업명 | 계획 기간 | 상태 | 실제 작업 내용 |
|---|------------|----------|------|---------------|
| 1 | 공개 보행로 데이터 수집 | 03-03 ~ 03-07 | ✅ 완료 | 공개 보행로 데이터 수집 완료 |
| 2 | 현장 이미지 촬영 및 수집 | 03-08 ~ 03-14 | ✅ 완료 | 볼라드 등 장애물 현장 이미지 수집 완료 |
| 3 | 이미지 라벨링(Annotation) | 03-15 ~ 03-26 | ✅ 완료 | YOLO 포맷 라벨링 완료 |
| 4 | 데이터 정제 및 포맷 변환 | 03-27 ~ 04-02 | ✅ 완료 | 학습 데이터셋 포맷 변환 완료 |
| 5 | ~~Detectron2~~ → **YOLOv5** 모델 구조 설계 | 04-03 ~ 04-09 | ✅ 완료 (변경) | **프레임워크 변경**: Detectron2 → YOLOv5. 사전학습 모델(best.pt) 구조 분석 및 FastAPI 연동 설계 완료 |
| 6 | 학습/검증/테스트셋 분리 | 04-10 ~ 04-16 | ✅ 완료 (단축) | YOLOv5 best.pt 사전학습 모델 활용으로 직접 학습 단계 대폭 단축. 대신 **백엔드 서버 구축**에 전환 |
| 7 | 모델 학습 실행 | 04-17 ~ 04-30 | 🔄 진행 중 | GitHub(Tibet-Fox/Hack_Festa)에서 볼라드 탐지 best.pt 확보, FastAPI 서버에 인프라 완성. 직접 학습 불필요 판단 → 추가 튜닝 및 성능 검증으로 대체 예정 |
| 8 | 성능 평가 및 튜닝 | 05-01 ~ 05-14 | ⏳ 예정 | 실제 데이터로 볼라드 탐지 정확도 측정 및 threshold 튜닝 |
| 9 | 데이터 분석 및 결과 검토 | 05-15 ~ 05-28 | ⏳ 예정 | AI 분류 결과 정합성 분석, 오탐률 검토 |
| 10 | 결과 분석 및 보고서 작성 | 05-29 ~ 06-05 | ⏳ 예정 | 성능 지표(mAP, precision, recall) 정리 |
| 11 | 최종 점검 및 발표 준비 | 06-06 ~ 06-07 | ⏳ 예정 | 시연 환경 최종 점검 |

### 계획 대비 변경 사항

| 구분 | 계획 | 실제 | 사유 |
|------|------|------|------|
| AI 프레임워크 | Detectron2 | **YOLOv5** | 실시간 추론 속도 및 모바일 백엔드 연동 편의성 우수. PyTorch 기반으로 서버 스택 통일 |
| 모델 학습 방식 | 직접 학습 (full train) | **사전학습 모델(best.pt) 활용** | 볼라드 탐지 특화 사전학습 모델 확보로 학습 기간 단축 |
| 추가 작업 (Gantt 미포함) | — | **FastAPI 백엔드 서버 전체 구축** | 장애물 공유 DB, 커뮤니티, AI API 서버 역할 담당. 팀 전체 백엔드 인프라 구축 |
| 추가 작업 (Gantt 미포함) | — | **지도 필터 기능 디버깅 및 Kakao API 연동** | Overpass API 오류 수정, 한국 장애편의시설 데이터 Kakao 로컬 검색으로 전환 |
| 추가 작업 (Gantt 미포함) | — | **데모 모드 전환** | Firebase 로그인 제거, 고정 데모 유저로 교체하여 시연 안정성 확보 |

### 현재 진행률

```
완료  ████████████░░░░░░░░  6/11 작업 완료 (tasks 1~6)
진행  ░░░░░░░░░░░█░░░░░░░░  task 7 진행 중 (04-20 기준)
예정  ░░░░░░░░░░░░████████  tasks 8~11 예정
```

---

## 16. 트러블슈팅

| 문제 | 원인 | 해결 방법 |
|------|------|-----------|
| `ultralytics.YOLO`로 best.pt 로드 실패 | YOLOv5 모델을 YOLOv8 라이브러리로 로드 시도 | `yolov5` 전용 패키지로 교체 |
| PyTorch weights_only 오류 | PyTorch 2.6 기본값 변경 (`weights_only=True`) | `torch.load` 래퍼 패치 |
| PostgreSQL 연결 거부 (10061) | DB 미설치 | winget으로 PostgreSQL 17 설치 |
| psql 비밀번호 설정 불가 | pg_hba.conf scram-sha-256 인증 | trust 모드 임시 적용 후 비밀번호 설정·복원 |
| 서비스 재시작 권한 없음 | 일반 계정에서 service 명령 실행 | 관리자 PowerShell에서 실행 |
| 폰에서 백엔드 접속 불가 | localhost는 PC 내부만 접근 가능 | `--host 0.0.0.0` + WiFi IP 사용 |
