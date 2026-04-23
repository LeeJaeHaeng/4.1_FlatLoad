# FlatRoad 백엔드 / AI 개발 문서

> **담당자: 이재행** | 작업 범위: 백엔드 서버 설계·구현, AI 모델 연동, DB 설계, 앱-서버 연동, 지도 필터 기능 디버깅
> 최종 수정: 2026-04-23

---

## 1. 프로젝트 개요

### 서비스 목표

전동이동보조기기(전동휠체어 등) 사용자를 위한 **안전 경로 안내 서비스 — FlatRoad**

| 핵심 기능 | 설명 |
|-----------|------|
| 안전 경로 탐색 | 보행자 도로 기반, 장애물 우회 (Valhalla pedestrian 프로파일 + avoid_locations) |
| 일반 경로 탐색 | 자동차 기준 경로 (OSRM driving 프로파일) |
| 음성 길안내 | 실시간 TTS 음성 안내 (expo-speech, 한국어) |
| 장애물 데이터 수집 | 사용자가 직접 촬영한 장애물 사진을 GPS와 함께 저장 (크라우드소싱) |
| AI 장애물 분류 | Detectron2 RetinaNet 모델이 사진을 분석, 보행 장애물 자동 탐지 (13개 클래스) |
| AI 감지 시각화 | 기여목록에서 바운딩 박스 + 레이블 오버레이로 감지 결과 확인 |
| 공유 DB | 모든 사용자의 장애물 데이터를 서버에 공유 저장 → 경로 경고에 활용 |
| 커뮤니티 | 게시글·댓글·좋아요 |

### AI 모델의 역할

```text
사용자 촬영
    ↓
백엔드 POST /api/obstacles (사진 + GPS)
    ↓
[병렬 실행]
├── Firebase Storage 업로드 → URL 획득
└── Detectron2 RetinaNet 자동 분석 → [{label, confidence, bbox}]
    ↓
PostgreSQL 저장 (ai_label, ai_confidence, ai_detections 컬럼)
    ↓
모든 사용자 지도에 장애물 마커 표시
    ↓
경로 계산 시 장애물 → 우회 경로 생성 (avoid_locations) + ⚠️ 경고 표시
```

---

## 2. 시스템 아키텍처

```text
┌──────────────────────────────────────────────────────────────┐
│               Expo Go 앱 (React Native)                       │
│  ContributeScreen │ MapScreen │ CommunityScreen               │
│          utils/api.ts (타임아웃 포함 API 클라이언트)           │
└─────────────────────────┬────────────────────────────────────┘
                           │ HTTP REST API
                           │ (Tailscale VPN: 100.x.x.x:8000)
                           ▼
┌──────────────────────────────────────────────────────────────┐
│           FastAPI 서버 — 이재행 구현 (이 PC, 포트 8000)       │
│  host: 0.0.0.0 → Tailscale IP: 100.95.227.34                │
│                                                              │
│  routers/obstacles.py   →  장애물 CRUD + 투표                 │
│  routers/community.py   →  게시글·댓글                       │
│  routers/analyze.py     →  AI 단독 분석                       │
│                                                              │
│  services/detector.py   →  Detectron2 추론 (asyncio.to_thread)│
│  services/storage.py    →  Firebase Storage (asyncio.to_thread)│
└──────────┬────────────────────────────┬──────────────────────┘
           │ asyncpg                     │ firebase-admin
           │ Tailscale VPN              │
           ▼                            ▼
┌──────────────────────┐    ┌──────────────────────┐
│ PostgreSQL 17         │    │  Firebase Storage     │
│ 원격 PC              │    │  (장애물 사진 URL)     │
│ 100.106.237.52:5432  │    └──────────────────────┘
│ safe_route_db        │
└──────────────────────┘

외부 API:
  - Valhalla (valhalla1.openstreetmap.de) → 보행자 경로 + 장애물 우회
  - OSRM (router.project-osrm.org)        → 자동차 일반 경로
  - Kakao Local API                        → 목적지 검색 / 필터(경사로·엘리베이터·화장실)
  - Kakao Maps JS SDK                      → 지도 렌더링 (WebView)
  - Overpass API                           → 계단·경사 경고 마커
```

---

## 3. 기술 스택

### 백엔드

| 항목 | 기술 | 버전 |
|------|------|------|
| 언어 | Python | 3.13 |
| 웹 프레임워크 | FastAPI | 0.115 |
| 비동기 DB 드라이버 | asyncpg | 0.29 |
| ORM | SQLAlchemy (async) | 2.0 |
| 데이터베이스 | PostgreSQL | 17 |
| AI 프레임워크 | Detectron2 | 0.6 |
| 모델 구조 | RetinaNet R-50-FPN 3x | — |
| 딥러닝 | PyTorch | 2.x |
| 이미지 처리 | Pillow + NumPy | — |
| 파일 스토리지 | Firebase Storage | firebase-admin 6.5 |
| ASGI 서버 | Uvicorn | 0.30 |
| VPN | Tailscale | — |

### 프론트엔드 (앱)

| 항목 | 기술 | 버전 |
|------|------|------|
| 프레임워크 | React Native + Expo | SDK 54 |
| 지도 | Kakao Maps JS SDK (WebView) | — |
| 음성 안내 | expo-speech | 14.0.8 |
| 위치 | expo-location | — |
| 카메라 | expo-camera | — |
| 로컬 DB | expo-sqlite | — |

---

## 4. AI 모델 상세 — 이재행

### 모델 정보

| 항목 | 내용 |
|------|------|
| 모델 구조 | RetinaNet R-50-FPN 3x |
| 가중치 파일 | `retinanet_r_50_fpn_3x_aihub_final.pth` (프로젝트 루트, 298MB) |
| 원본 출처 | GitHub: visionNoob/detectron2_aihub_tutorial |
| 학습 환경 | Google Colab (AIHub 인도 보행 데이터셋) |
| 감지 클래스 수 | **13개** |
| 입력 해상도 | 가변 (Detectron2 자동 리사이즈) |
| Score Threshold | 0.5 (50%) |
| NMS Threshold | 0.2 |
| Anchor Aspect Ratios | `[[0.65, 1.0, 2.47, 5.2, 18.12]]` (학습 시 커스텀 앵커) |
| 추론 환경 | CPU (CUDA 없는 환경) / GPU 자동 감지 |

### 감지 클래스 목록 (AIHub 13-class, 순서 고정)

| 인덱스 | 클래스 | 한국어 | 설명 |
|--------|--------|--------|------|
| 0 | person | 사람 | |
| 1 | pole | 전봇대 | 전신주·기둥 |
| 2 | bollard | 볼라드 | 통행 방해 구조물 |
| 3 | tree_trunk | 나무 | 가로수 줄기 |
| 4 | car | 자동차 | 승용차 |
| 5 | traffic_light | 신호등 | |
| 6 | truck | 트럭 | |
| 7 | bus | 버스 | |
| 8 | traffic_sign | 표지판 | 도로 표지판 |
| 9 | motorcycle | 오토바이 | |
| 10 | movable_signage | 이동간판 | 이동형 간판 |
| 11 | potted_plant | 화분 | |
| 12 | wheelchair | 휠체어 | |

### 앵커 자동 감지 로직

체크포인트 파일에 학습 당시 `cfg` YAML이 저장된 경우 해당 앵커를 우선 사용하고,
없거나 COCO 기본값(`[[0.5, 1.0, 2.0]]`)인 경우 AIHub 커스텀 앵커를 적용한다.

```python
# services/detector.py 내 _load_checkpoint_anchors() 참고
COCO 기본값 → AIHub 커스텀 [[0.65, 1.0, 2.47, 5.2, 18.12]] 적용
체크포인트 저장값 → 체크포인트 앵커 우선 사용
```

서버 시작 로그:

```text
[Detectron2] AIHub 커스텀 앵커 적용: [[0.65, 1.0, 2.47, 5.2, 18.12]]
[Detectron2] 모델 로드 완료 — classes=13, device=cpu
```

### 추론 흐름

```text
이미지 bytes 입력
    → PIL Image 변환 (RGB → BGR, NumPy)
    → DefaultPredictor(cfg)(img_bgr)
    → instances.pred_boxes, scores, pred_classes 추출
    → bbox 정규화 (픽셀 → 0~1, cx/cy/w/h)
    → confidence 내림차순 정렬
    → [{"label":"bollard","confidence":0.82,"bbox":[cx,cy,w,h]}, ...]
```

### 업로드 + 추론 병렬 실행 (성능 최적화)

기존에는 Firebase Storage 업로드 완료 후 Detectron2 추론을 순차 실행하여 총 **10~20초** 소요.  
`asyncio.gather`로 병렬화하여 **max(업로드시간, 추론시간)** 으로 단축.

```python
# routers/obstacles.py
photo_url, detections = await asyncio.gather(
    storage.upload_image(image_bytes, content_type),   # Firebase I/O
    asyncio.to_thread(detector.detect, image_bytes),   # CPU 추론
)
```

---

## 5. 데이터베이스 설계 — 이재행

### obstacles (장애물 테이블)

```sql
CREATE TABLE obstacles (
    id             SERIAL PRIMARY KEY,
    photo_url      TEXT    NOT NULL,
    latitude       FLOAT   NOT NULL,
    longitude      FLOAT   NOT NULL,
    created_at     TIMESTAMPTZ DEFAULT now(),
    user_id        TEXT    DEFAULT '',
    user_email     TEXT    DEFAULT '',
    display_name   TEXT    DEFAULT '',
    likes          INTEGER DEFAULT 0,
    dislikes       INTEGER DEFAULT 0,
    ai_label       TEXT,             -- 최고 신뢰도 감지 클래스 (예: "bollard")
    ai_confidence  FLOAT,            -- 신뢰도 0~1 (예: 0.82)
    ai_detections  TEXT              -- JSON: [{label,confidence,bbox:[cx,cy,w,h]}, ...]
);
```

> `ai_detections`: 전체 감지 결과를 JSON 문자열로 저장.
> bbox는 `[cx, cy, w, h]` 정규화 좌표(0~1) 형식.
> 앱에서 파싱 후 이미지 위에 바운딩 박스 오버레이로 시각화.

**자동 마이그레이션**: 기존 DB에 컬럼이 없어도 서버 시작 시 자동 추가.

```python
# db/database.py create_tables()
await conn.execute(text(
    "ALTER TABLE obstacles ADD COLUMN IF NOT EXISTS ai_detections TEXT"
))
```

### votes (투표 테이블)

```sql
CREATE TABLE votes (
    id           SERIAL PRIMARY KEY,
    obstacle_id  INTEGER NOT NULL,
    user_id      TEXT    NOT NULL,
    vote_type    TEXT    NOT NULL,   -- 'like' | 'dislike'
    UNIQUE(obstacle_id, user_id)
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
[
  {
    "id": 1,
    "photoUri": "https://storage.googleapis.com/...",
    "latitude": 37.5665,
    "longitude": 126.9780,
    "createdAt": "2026-04-23T12:00:00+00:00",
    "userId": "demo-user-001",
    "userEmail": "demo@flatroad.app",
    "displayName": "데모 사용자",
    "likes": 5,
    "dislikes": 1,
    "aiLabel": "bollard",
    "aiConfidence": 0.82,
    "aiDetections": [
      {"label": "bollard", "confidence": 0.82, "bbox": [0.45, 0.52, 0.05, 0.12]},
      {"label": "person",  "confidence": 0.71, "bbox": [0.23, 0.50, 0.10, 0.30]}
    ]
  }
]
```

#### POST /api/obstacles

장애물 등록 — **Firebase 업로드 + AI 분석 병렬 실행**

```
Content-Type: multipart/form-data

photo:        [이미지 파일 .jpg]
latitude:     37.5665
longitude:    126.9780
user_id:      "demo-user-001"
user_email:   "demo@flatroad.app"
display_name: "데모 사용자"
```

처리 순서 (병렬):
1. `asyncio.gather` 로 Firebase Storage 업로드 + Detectron2 추론 **동시** 실행
2. 전체 감지 결과를 JSON으로 직렬화 → `ai_detections` 컬럼에 저장
3. 최고 신뢰도 결과 → `ai_label`, `ai_confidence` 컬럼에 저장
4. PostgreSQL에 전체 데이터 저장 후 반환

#### POST /api/obstacles/{id}/vote

```json
// 요청
{"user_id": "demo-user-001", "vote_type": "like"}

// 응답
{"likes": 6, "dislikes": 1, "userVote": "like"}
```

같은 타입 재투표 → 취소(toggle) / 반대 타입 투표 → 변경

#### GET /api/obstacles/mine/{user_id}

내가 등록한 장애물 목록 (aiDetections 포함)

#### GET /api/obstacles/contributors/top?limit=3

좋아요 TOP 3 기여자

```json
[{"userId":"...", "displayName":"데모 사용자", "userEmail":"...", "totalLikes":15}]
```

### AI 분석 API `/api/analyze`

#### GET /api/analyze/status

```json
{
  "ready": true,
  "classes": ["person","pole","bollard","tree_trunk","car","traffic_light",
              "truck","bus","traffic_sign","motorcycle","movable_signage",
              "potted_plant","wheelchair"],
  "message": "모델 준비 완료"
}
```

#### POST /api/analyze

이미지만 단독으로 AI 분석 (장애물 저장 없음)

```json
[
  {"label": "bollard",  "confidence": 0.82, "bbox": [0.45, 0.52, 0.05, 0.12]},
  {"label": "person",   "confidence": 0.71, "bbox": [0.23, 0.50, 0.10, 0.30]}
]
```

bbox 형식: `[cx, cy, w, h]` — 이미지 크기 대비 정규화 0~1 값

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

## 7. 길찾기 구조 — 이재행

### 경로 종류

| 모드 | 엔진 | 프로파일 | 용도 |
|------|------|---------|------|
| 안전 길찾기 | Valhalla (openstreetmap.de) | `pedestrian` | 보행자 경로 + 장애물 우회 |
| 일반 경로 | OSRM (project-osrm.org) | `driving` | 자동차 기준 최단 경로 |

### 안전 길찾기 — Valhalla pedestrian

```text
MapScreen: GET /api/obstacles → 전체 장애물 목록

경로 계산 요청 (Valhalla POST /route):
  costing: 'pedestrian'
  costing_options:
    walking_speed: 4.5
    step_penalty: 30      (계단 패널티)
    alley_factor: 2.0     (골목 기피)
  avoid_locations: [       (장애물 우회)
    경로 bbox 내 장애물 좌표 (최대 50개)
  ]

응답:
  → Encoded Polyline (precision=6) 디코딩
  → maneuvers[] (방향 지시 목록)
  → 경로 포인트 50m 이내 장애물 수 → obstacleCount 표시
```

장애물 필터링 기준: 출발지~목적지 bounding box 기준 ±0.015°(약 1.5km) 버퍼 내 장애물, 최대 50개

### 일반 경로 — OSRM driving

```text
GET https://router.project-osrm.org/route/v1/driving/{lng,lat};{lng,lat}
    ?geometries=geojson&overview=full

→ GeoJSON LineString 좌표 파싱
→ 거리·시간 표시 (자동차 기준)
```

### 음성 TTS 안내 흐름

```text
안내 시작 버튼 탭
    → "안내를 시작합니다. N미터 후 {지시}"

단계 변경 (currentManeuverIdx 증가)
    → "{현재 지시}. N미터 후 {다음 지시}"  (선행 안내)

경로 80m 이탈 감지
    → "경로를 이탈했습니다. 경로를 재탐색합니다."
    → Valhalla 재탐색

목적지 10m 이내 도착
    → "목적지에 도착했습니다."
    → 내비게이션 자동 종료

안내 종료 버튼 탭
    → Speech.stop()
```

TTS 구현: `expo-speech` (`Speech.speak(text, { language: 'ko-KR', rate: 1.05 })`)

---

## 8. AI 감지 결과 시각화 — 이재행

### 데이터 흐름

```text
POST /api/obstacles
    → ai_detections = [{label, confidence, bbox:[cx,cy,w,h]}, ...]
    → JSON 문자열로 DB 저장

GET /api/obstacles/mine/{user_id}
    → ai_detections JSON 파싱 → 앱 전달

ContributeScreen (내 기여목록)
    → 썸네일에 "AI" 뱃지 표시 (감지 결과 있는 경우)
    → 상위 감지 결과 레이블 + 신뢰도 표시 (예: 🤖 볼라드 · 82%)
    → 항목 탭 → 상세 모달
        ├── 원본 이미지
        ├── 바운딩 박스 오버레이 (색상별 Rectangle + 레이블)
        └── 감지 객체 목록 + 신뢰도 바 차트
```

### bbox 좌표 변환 (정규화 → 픽셀)

```typescript
// bbox = [cx, cy, w, h] (0~1 정규화)
const x      = (cx - w/2) * imgWidth;
const y      = (cy - h/2) * imgHeight;
const width  = w * imgWidth;
const height = h * imgHeight;
```

---

## 9. 앱 ↔ 서버 연동 구조

### API 클라이언트 (`utils/api.ts`)

모든 HTTP 요청에 `AbortController`로 타임아웃 적용:

```typescript
async function apiFetch(url, options?, timeoutMs = 12000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
```

| 함수 | 타임아웃 | 비고 |
|------|---------|------|
| `apiCreateObstacle` | 30초 | Firebase 업로드 + AI 추론 |
| `apiCheckAiStatus` | 5초 | 상태 확인용 |
| 나머지 모두 | 12초 | 기본값 |

### ContributeScreen 연동

```text
촬영 → 저장 버튼
    → apiCreateObstacle() (30s 타임아웃)
    → 서버: 병렬 업로드 + AI 추론 (~10~15초 → ~5~8초로 단축)
    → Alert: "AI 감지: 볼라드 (신뢰도 82%)"
    → 목록 새로고침 (aiDetections 포함)

내 기여목록 로딩
    → apiGetMyObstacles() (12s 타임아웃)
    → 실패 시 로컬 SQLite 폴백
```

### MapScreen 연동

```text
화면 포커스 시
    → apiGetObstacles() → 장애물 마커 렌더링
    → 실패 시 로컬 SQLite 폴백

목적지 검색
    → Kakao Local API (REST API 키)

지도 렌더링
    → Kakao Maps JS SDK (JS 앱 키, WebView baseUrl: http://localhost)
```

---

## 10. 지도 필터 기능 구조 — 이재행

### 개요

홈(지도) 화면 상단의 `경사로 / 엘리베이터 / 장애인화장실` 필터 버튼을 누르면
주변 시설을 지도에 아이콘으로 표시하는 기능.
**별도 백엔드 API 없이** Kakao 로컬 검색 API를 앱에서 직접 호출.

### 데이터 소스

| 필터 | 데이터 출처 | 검색 키워드 |
|------|------------|------------|
| 경사로 | Kakao 로컬 검색 API | `무장애`, `배리어프리`, `휠체어경사로` (3개 순차 조회) |
| 엘리베이터 | Kakao 로컬 검색 API | `엘리베이터` |
| 장애인화장실 | Kakao 로컬 검색 API | `장애인화장실` |

검색 반경: 현재 위치 기준 3km, 페이지당 15개, 최대 3페이지

### 마커 스타일

| 타입 | 아이콘 | 색상 |
|------|--------|------|
| ramp (경사로) | ♿ | 초록 (#4CAF50) |
| elevator (엘리베이터) | 🛗 | 파랑 (#2196F3) |
| toilet (장애인화장실) | 🚻 | 보라 (#9C27B0) |
| slope (계단·경사 경고) | ⚠️ | 주황 (#FF5722) |

---

## 11. 환경 설정 파일

### backend/.env

```ini
DATABASE_URL=postgresql+asyncpg://postgres:1234@100.106.237.52:5432/safe_route_db

FIREBASE_CREDENTIALS_PATH=./firebase-adminsdk.json
FIREBASE_STORAGE_BUCKET=map2026-233a5.firebasestorage.app

DETECTRON2_WEIGHTS=../retinanet_r_50_fpn_3x_aihub_final.pth
DETECTRON2_SCORE_THRESH=0.5

PORT=8000
```

> `DATABASE_URL` 호스트: Tailscale VPN IP `100.106.237.52` (원격 PC)

### 루트 .env (앱용)

```ini
EXPO_PUBLIC_KAKAO_REST_KEY=<카카오 REST API 키>
EXPO_PUBLIC_KAKAO_JS_KEY=<카카오 JS 앱 키>
EXPO_PUBLIC_API_BASE_URL=http://100.72.221.111:8000
```

> `EXPO_PUBLIC_API_BASE_URL`: Tailscale IP 사용. 같은 WiFi인 경우 로컬 IP 사용 가능.

---

## 12. 실행 방법

### PostgreSQL 원격 연결 설정 (원격 PC — 최초 1회)

```powershell
# 1. postgresql.conf 수정
listen_addresses = '*'

# 2. pg_hba.conf 수정 (Tailscale 대역 허용)
host  all  all  100.64.0.0/10  scram-sha-256

# 3. 방화벽 허용
New-NetFirewallRule -DisplayName "PostgreSQL 5432" -Direction Inbound -Protocol TCP -LocalPort 5432 -Action Allow

# 4. 서비스 재시작
Restart-Service postgresql-x64-17
```

### Detectron2 설치 (Windows, 최초 1회)

```powershell
# VS Build Tools 2022 설치 필요 (C++ 빌드 도구 포함)
# 이후 VS 개발자 명령 프롬프트에서:

cd backend
python -m venv venv
./venv/Scripts/pip install torch torchvision
./venv/Scripts/pip install -r requirements.txt

# Detectron2 소스 빌드 (Windows는 wheel 없음)
cmd /c "vcvars64.bat && set DISTUTILS_USE_SDK=1 && pip install git+https://github.com/facebookresearch/detectron2.git --no-build-isolation"
```

> `--no-build-isolation`: pip 격리 환경에 torch 없어서 실패하는 문제 방지
> `DISTUTILS_USE_SDK=1`: MSVC 환경 초기화 충돌 방지

### 매일 서버 실행

```powershell
cd "C:\Users\leejh\OneDrive\바탕 화면\4-1\종합프로젝트\FlatRoad\backend"
./venv/Scripts/uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### 연결 확인

```
GET http://localhost:8000
→ {"status":"ok","model_ready":true,"classes":["person","pole","bollard",...]}

GET http://localhost:8000/api/analyze/status
→ {"ready":true,"classes":[...13개...],"message":"모델 준비 완료"}
```

### AI 테스트 (curl)

```powershell
curl -X POST http://localhost:8000/api/analyze -F "photo=@test.jpg"
```

---

## 13. 파일 구조

```
FlatRoad/
├── retinanet_r_50_fpn_3x_aihub_final.pth  ← Detectron2 AIHub 모델 (298MB, git 제외)
├── .env                                    ← 앱용 환경변수 (git 제외)
├── App.tsx
├── screens/
│   ├── MapScreen.tsx                       ← Kakao Maps, 길찾기, 음성안내, 필터
│   ├── ContributeScreen.tsx                ← 촬영, 기여목록, AI 감지 시각화
│   ├── CommunityScreen.tsx
│   ├── MyPageScreen.tsx
│   └── NotificationScreen.tsx
├── utils/
│   ├── api.ts                              ← 백엔드 API 클라이언트 (타임아웃 포함)
│   └── database.ts                         ← 로컬 SQLite 폴백
└── context/
    └── AuthContext.tsx                     ← 데모 모드 고정 유저

backend/
├── main.py               ← FastAPI 앱 진입점 (lifespan: create_tables + load_model)
├── requirements.txt      ← Python 의존 패키지
├── .env                  ← 서버 환경변수 (git 제외)
├── .env.example          ← 환경변수 템플릿
├── SETUP.md              ← 빠른 실행 가이드
├── BACKEND_DOCS.md       ← 이 문서
├── venv/                 ← Python 가상환경
├── db/
│   ├── database.py       ← PostgreSQL 비동기 연결 + 자동 마이그레이션
│   ├── models.py         ← ORM 모델 (5개 테이블, ai_detections 포함)
│   └── schemas.py        ← Pydantic 스키마 (aiDetections 포함)
├── routers/
│   ├── obstacles.py      ← 장애물 CRUD, 투표, 기여자 랭킹 (병렬 업로드+추론)
│   ├── community.py      ← 게시글, 댓글, 좋아요
│   └── analyze.py        ← AI 단독 분석 엔드포인트
└── services/
    ├── detector.py       ← Detectron2 RetinaNet 추론 서비스 (asyncio.to_thread)
    └── storage.py        ← Firebase Storage 이미지 업로드 (asyncio.to_thread)
```

---

## 14. 작업 이력 — 이재행

| 날짜 | 작업 내용 |
|------|-----------|
| 2026-04-20 | FastAPI 백엔드 서버 초기 구축 (main.py, CORS, lifespan) |
| 2026-04-20 | PostgreSQL 17 설치, `safe_route_db` DB 생성 |
| 2026-04-20 | SQLAlchemy async ORM 모델 설계 (5개 테이블) |
| 2026-04-20 | Pydantic 스키마 설계 (앱 인터페이스 camelCase 호환) |
| 2026-04-20 | 장애물 CRUD API 구현 (등록·조회·투표·기여자 랭킹) |
| 2026-04-20 | 커뮤니티 API 구현 (게시글·댓글·좋아요) |
| 2026-04-20 | Firebase Storage 연동 서비스 구현 |
| 2026-04-20 | `utils/api.ts` 앱용 API 클라이언트 구현 (폴백 포함) |
| 2026-04-20 | ContributeScreen AI 분석 결과 표시 연동 |
| 2026-04-20 | MapScreen 서버 장애물 조회 연동 |
| 2026-04-20 | MapScreen 필터(경사로·엘리베이터·장애인화장실) 구현 |
| 2026-04-20 | Overpass API → Kakao 로컬 검색 API로 데이터 소스 전환 |
| 2026-04-20 | 데모 모드 적용 — Firebase 로그인 제거, 고정 데모 유저로 교체 |
| 2026-04-23 | **AI 모델 교체: YOLOv5(1 class) → Detectron2 RetinaNet(13 classes, AIHub)** |
| 2026-04-23 | 체크포인트 앵커 자동 감지 로직 구현 (`_load_checkpoint_anchors`) |
| 2026-04-23 | Firebase Storage init 레이스컨디션 수정 (`threading.Lock`) |
| 2026-04-23 | `*.pth` gitignore 추가, 불필요 파일 정리 |
| 2026-04-23 | requirements.txt Detectron2 기준으로 업데이트 |
| 2026-04-23 | **Kakao Maps JS SDK로 지도 전면 교체** (Leaflet WebView → Kakao Maps WebView) |
| 2026-04-23 | 목적지 검색 Nominatim → Kakao Local API로 교체 |
| 2026-04-23 | **PostgreSQL 원격 연결 설정** — Tailscale VPN(100.106.237.52) 경유 |
| 2026-04-23 | pg_hba.conf Tailscale 대역(100.64.0.0/10) 허용, 방화벽 규칙 추가 |
| 2026-04-23 | **Detectron2 Windows 소스 빌드 성공** (VS Build Tools 2022, DISTUTILS_USE_SDK=1) |
| 2026-04-23 | Firebase Storage 업로드 비동기 처리 (`asyncio.to_thread`) — 이벤트 루프 블로킹 해소 |
| 2026-04-23 | Detectron2 추론 비동기 처리 (`asyncio.to_thread`) — 이벤트 루프 블로킹 해소 |
| 2026-04-23 | `utils/api.ts` 전체 fetch에 AbortController 타임아웃 적용 (업로드 30s, 기본 12s) |
| 2026-04-23 | **길찾기 개선**: 안전경로=Valhalla pedestrian + avoid_locations, 일반경로=OSRM driving |
| 2026-04-23 | **Firebase 업로드 + Detectron2 추론 병렬화** (`asyncio.gather`) — 처리 시간 단축 |
| 2026-04-23 | **`ai_detections` 컬럼 추가** (전체 bbox JSON 저장), 기존 DB 자동 마이그레이션 |
| 2026-04-23 | **AI 감지 시각화** — ContributeScreen 상세 모달, 바운딩 박스 오버레이, 신뢰도 바 차트 |
| 2026-04-23 | **TTS 음성 길안내** — expo-speech 연동, 단계별 선행 안내, 도착·이탈 음성 |
| 2026-04-23 | TTS 한국어 수정 — Valhalla `language: 'ko'` 추가, 모든 안내 문구 `getManeuverLabel()` 한국어 레이블 고정 (영어 instruction 차단) |

---

## 15. 간트차트 대비 실제 진행 현황 — 이재행

> 기준일: 2026-04-23
> 프로젝트 기간: 2026-03-03 ~ 2026-06-11

| # | 간트 작업명 | 계획 기간 | 상태 | 실제 작업 내용 |
|---|------------|----------|------|---------------|
| 1 | 공개 보행로 데이터 수집 | 03-03 ~ 03-07 | ✅ 완료 | 공개 보행로 데이터 수집 완료 |
| 2 | 현장 이미지 촬영 및 수집 | 03-08 ~ 03-14 | ✅ 완료 | 장애물 현장 이미지 수집 완료 |
| 3 | 이미지 라벨링(Annotation) | 03-15 ~ 03-26 | ✅ 완료 | YOLO 포맷 라벨링 완료 |
| 4 | 데이터 정제 및 포맷 변환 | 03-27 ~ 04-02 | ✅ 완료 | 학습 데이터셋 포맷 변환 완료 |
| 5 | AI 모델 구조 설계 | 04-03 ~ 04-09 | ✅ 완료 (변경) | **Detectron2 RetinaNet R-50-FPN 3x (AIHub 13-class)** 채택. FastAPI 연동 설계 완료 |
| 6 | 학습/검증/테스트셋 분리 | 04-10 ~ 04-16 | ✅ 완료 | AIHub 공개 사전학습 모델 활용으로 직접 학습 단축 |
| 7 | 모델 학습 실행 | 04-17 ~ 04-30 | ✅ 완료 | 사전학습 모델 확보 및 FastAPI 서버 인프라 완성 |
| 8 | 성능 평가 및 튜닝 | 05-01 ~ 05-14 | ⏳ 예정 | 실제 데이터로 13-class 탐지 정확도 측정 및 threshold 튜닝 |
| 9 | 데이터 분석 및 결과 검토 | 05-15 ~ 05-28 | ⏳ 예정 | AI 분류 결과 정합성 분석, 오탐률 검토 |
| 10 | 결과 분석 및 보고서 작성 | 05-29 ~ 06-05 | ⏳ 예정 | 성능 지표(mAP, precision, recall) 정리 |
| 11 | 최종 점검 및 발표 준비 | 06-06 ~ 06-07 | ⏳ 예정 | 시연 환경 최종 점검 |

### 계획 대비 변경 사항

| 구분 | 계획 | 실제 | 사유 |
|------|------|------|------|
| AI 프레임워크 | YOLOv5 | **Detectron2 RetinaNet** | AIHub 공식 사전학습 모델 활용. 13-class로 다양한 보행 장애물 탐지 가능 |
| 감지 클래스 | 1개 (Bollard) | **13개** (AIHub 보행 데이터셋 전체) | 볼라드 외 사람·기둥·나무·차량 등 실제 보행 장애 요소 전부 커버 |
| 모델 학습 | 직접 학습 | **AIHub 공개 사전학습 모델 활용** | 대규모 보행 데이터로 학습된 모델 확보로 품질↑ 기간↓ |
| 지도 | Leaflet | **Kakao Maps JS SDK** | 국내 지도 품질 개선, 카카오 로컬 검색 통합 |
| DB 연결 | 로컬 | **Tailscale VPN 원격 연결** | 팀 간 공유 DB 실현 |
| 추가 작업 | — | **FastAPI 백엔드 서버 전체 구축** | 장애물 공유 DB, 커뮤니티, AI API 서버 역할 |
| 추가 작업 | — | **음성 TTS 길안내** | expo-speech로 실시간 한국어 내비게이션 음성 구현 |
| 추가 작업 | — | **AI 감지 결과 시각화** | 바운딩 박스 오버레이 + 신뢰도 차트로 사용자 확인 가능 |
| 추가 작업 | — | **업로드·추론 병렬화** | asyncio.gather로 처리 시간 단축 |

---

## 16. 트러블슈팅

| 문제 | 원인 | 해결 방법 |
|------|------|-----------|
| PostgreSQL 연결 거부 (10061) | DB 미설치 | PostgreSQL 17 설치 |
| psql 비밀번호 설정 불가 | pg_hba.conf scram-sha-256 인증 | trust 모드 임시 적용 후 비밀번호 설정·복원 |
| 폰에서 백엔드 접속 불가 | localhost는 PC 내부만 접근 가능 | Tailscale VPN IP 사용 |
| 원격 DB 연결 타임아웃 | PostgreSQL이 localhost만 리슨 | `listen_addresses = '*'` + 방화벽 5432 허용 |
| Detectron2 설치 실패 (torch 없음) | pip 격리 빌드 환경에 torch 미설치 | `--no-build-isolation` 옵션 추가 |
| Detectron2 설치 실패 (MSVC 충돌) | DISTUTILS_USE_SDK 미설정 | `set DISTUTILS_USE_SDK=1` 선행 실행 |
| Firebase Storage 업로드 무한로딩 | `blob.upload_from_string()` 이벤트 루프 블로킹 | `asyncio.to_thread` 로 스레드 풀 이동 |
| 기여목록 새로고침만 표시 | fetch 타임아웃 없어 무기한 대기 | `apiFetch` wrapper로 12s 타임아웃 적용 |
| Kakao Maps 로드 안됨 | Kakao JS SDK 도메인 미등록 | Kakao Developers 콘솔 → Web 플랫폼 → `http://localhost` 추가 |
| Detectron2 모델 로드 실패 | 모델 파일 경로 불일치 | `.env`의 `DETECTRON2_WEIGHTS` 경로 확인, 프로젝트 루트에 `.pth` 파일 위치 |
| 추론 결과 0개 (빈 배열) | Score threshold가 너무 높음 | `DETECTRON2_SCORE_THRESH=0.3`으로 낮춰 테스트 |
| 앵커 불일치로 인한 오탐 | 학습 시 커스텀 앵커 사용 | `_load_checkpoint_anchors()`가 AIHub 커스텀 앵커 자동 적용 |
| Firebase Storage 초기화 중복 오류 | 동시 요청 시 `initialize_app()` 중복 호출 | `threading.Lock`으로 이중 초기화 방지 |

---

## 17. 잔여 작업

| 우선순위 | 항목 | 설명 |
|----------|------|------|
| 🔴 높음 | Kakao Developers 도메인 등록 | `http://localhost` Web 플랫폼 추가 (지도 로드 필수) |
| 🟡 중간 | AI 신뢰도 기반 마커 차등 표시 | confidence에 따라 색상 구분 |
| 🟡 중간 | Detectron2 GPU 환경 구성 | 추론 속도 개선 (현재 CPU, ~3~5s) |
| 🟢 낮음 | ngrok / 클라우드 배포 | 실사용 환경에서 고정 URL 필요 |
| 🟢 낮음 | AI 성능 평가 | mAP, precision, recall 측정 |
