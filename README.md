# 관리자 대시보드 임시 로그인 기능: id: root pw: 1234

# FlatRoad — 전동이동보조기기 안전 경로 안내 서비스

> 전동휠체어·전동스쿠터 등 전동이동보조기기 사용자를 위한 크라우드소싱 장애물 지도 및 AI 기반 안전 경로 안내 앱

---

## 서비스 개요

전동이동보조기기 사용자는 볼라드·계단·경사 등 보행 장애물로 인해 이동 중 예상치 못한 위험을 겪는다.  
FlatRoad는 사용자가 직접 장애물을 촬영·공유하고, AI가 자동 분류하여 모든 사용자의 지도에 반영하는 **크라우드소싱 안전지도** 서비스이다.

| 핵심 기능 | 설명 |
|-----------|------|
| 안전 경로 탐색 | 보행자 도로 기반, 등록된 장애물 자동 우회 (Valhalla pedestrian + avoid_locations) |
| 일반 경로 탐색 | 자동차 기준 최단 경로 (OSRM driving) |
| 음성 길안내 | 한국어 TTS 실시간 내비게이션 (expo-speech) |
| AI 장애물 탐지 | Detectron2 RetinaNet이 사진 분석, 13개 클래스 보행 장애물 자동 탐지 |
| AI 감지 시각화 | 기여목록에서 바운딩 박스 + 신뢰도 오버레이로 감지 결과 직접 확인 |
| 장애물 공유 DB | 사용자 촬영 장애물을 서버에 공유 저장 → 경로 우회 및 경고에 활용 |
| 장애편의시설 필터 | 현재 위치 기반 경사로·엘리베이터·장애인화장실 지도 표시 (Kakao Local API) |
| 커뮤니티 | 게시글·댓글·좋아요 기반 정보 공유 |

---

## 시스템 아키텍처

```
┌──────────────────────────────────────────────────────────────┐
│               Expo Go 앱 (React Native)                       │
│  MapScreen │ ContributeScreen │ CommunityScreen               │
│          utils/api.ts (AbortController 타임아웃 포함)          │
└─────────────────────────┬────────────────────────────────────┘
                           │ HTTP REST API
                           │ (Tailscale VPN: 100.x.x.x:8000)
                           ▼
┌──────────────────────────────────────────────────────────────┐
│           FastAPI 백엔드 서버 (Python 3.13)                   │
│  host: 0.0.0.0:8000 / Tailscale IP: 100.95.227.34           │
│                                                              │
│  routers/obstacles.py  →  장애물 CRUD + 투표                  │
│  routers/community.py  →  게시글·댓글·좋아요                  │
│  routers/analyze.py    →  AI 단독 분석                        │
│                                                              │
│  services/detector.py  →  Detectron2 추론 (asyncio.to_thread) │
│  services/storage.py   →  Firebase Storage (asyncio.to_thread)│
└──────────┬────────────────────────────┬──────────────────────┘
           │ asyncpg / Tailscale VPN     │ firebase-admin
           ▼                            ▼
┌──────────────────────┐    ┌──────────────────────┐
│ PostgreSQL 17 (원격)  │    │  Firebase Storage     │
│ 100.106.237.52:5432  │    │  (장애물 사진 URL)     │
│ safe_route_db        │    └──────────────────────┘
└──────────────────────┘

외부 API:
  Valhalla (openstreetmap.de)  →  보행자 경로 + 장애물 우회
  OSRM (project-osrm.org)      →  자동차 일반 경로
  Kakao Maps JS SDK             →  지도 렌더링 (WebView)
  Kakao Local Search API        →  목적지 검색 / 장애편의시설 필터
  Overpass API                  →  계단·경사 경고 마커
```

---

## 기술 스택

### 프론트엔드 (앱)

| 항목 | 기술 | 비고 |
|------|------|------|
| 프레임워크 | React Native (Expo SDK 54) | |
| 언어 | TypeScript | |
| 지도 | Kakao Maps JS SDK | WebView 내 렌더링 |
| 안전 경로 | Valhalla (pedestrian + avoid_locations) | 장애물 우회 |
| 일반 경로 | OSRM (driving) | 자동차 기준 |
| 음성 안내 | expo-speech | 한국어 TTS |
| 장애편의시설 | Kakao Local Search REST API | |
| 위치 | expo-location | GPS + 나침반 |
| 카메라 | expo-camera | 장애물 촬영 |
| 로컬 DB | expo-sqlite | 서버 연결 실패 시 폴백 |

### 백엔드 (서버)

| 항목 | 기술 | 비고 |
|------|------|------|
| 프레임워크 | FastAPI (Python 3.13) | |
| AI 모델 | Detectron2 RetinaNet R-50-FPN 3x | AIHub 13-class |
| 딥러닝 | PyTorch 2.x | CPU 추론 |
| ORM | SQLAlchemy async + asyncpg | |
| DB | PostgreSQL 17 | Tailscale VPN 원격 연결 |
| 이미지 저장 | Firebase Storage | firebase-admin |
| VPN | Tailscale | 팀 간 원격 DB 공유 |

---

## 프로젝트 구조

```
FlatRoad/
├── screens/
│   ├── MapScreen.tsx          ← 카카오 지도, 길찾기, 음성안내, 필터
│   ├── ContributeScreen.tsx   ← 장애물 촬영·등록, AI 감지 시각화
│   ├── CommunityScreen.tsx    ← 게시판
│   └── MyPageScreen.tsx       ← 설정, 앱 정보
├── context/
│   └── AuthContext.tsx        ← 데모 유저 컨텍스트
├── utils/
│   ├── api.ts                 ← 백엔드 API 클라이언트 (타임아웃 포함)
│   └── database.ts            ← 로컬 SQLite 폴백
├── .env                       ← 앱 환경변수 (git 제외)
│
└── backend/
    ├── main.py                ← FastAPI 진입점 (lifespan: DB생성+모델로드)
    ├── requirements.txt
    ├── .env                   ← 서버 환경변수 (git 제외)
    ├── .env.example           ← 환경변수 템플릿
    ├── BACKEND_DOCS.md        ← 백엔드 상세 개발 문서 (이재행)
    ├── SETUP.md               ← 빠른 실행 가이드
    ├── db/
    │   ├── database.py        ← 비동기 DB 연결 + 자동 마이그레이션
    │   ├── models.py          ← ORM 모델 (5개 테이블)
    │   └── schemas.py         ← Pydantic 스키마
    ├── routers/
    │   ├── obstacles.py       ← 장애물 CRUD, 투표, 기여자 랭킹
    │   ├── community.py       ← 게시글, 댓글, 좋아요
    │   └── analyze.py         ← AI 단독 분석
    └── services/
        ├── detector.py        ← Detectron2 RetinaNet 추론
        └── storage.py         ← Firebase Storage 업로드
```

---

## AI 추론 파이프라인

```
사용자 장애물 촬영
    ↓
POST /api/obstacles (이미지 + GPS 좌표)
    ↓
[asyncio.gather — 병렬 실행]
├── Firebase Storage 업로드  →  photo_url
└── Detectron2 RetinaNet 추론  →  [{label, confidence, bbox}, ...]
    ↓
PostgreSQL 저장:
  ai_label      = "bollard"          (최고 신뢰도 클래스)
  ai_confidence = 0.82               (신뢰도)
  ai_detections = JSON(전체 결과)    (bbox 포함)
    ↓
지도: 전체 사용자에게 장애물 마커 표시
    ↓
경로 계산: avoid_locations로 장애물 자동 우회
```

### AI 모델 정보

| 항목 | 내용 |
|------|------|
| 모델 구조 | RetinaNet R-50-FPN 3x |
| 가중치 파일 | `retinanet_r_50_fpn_3x_aihub_final.pth` (298MB, git 제외) |
| 학습 데이터 | AIHub 인도 보행 데이터셋 |
| 감지 클래스 | 13개 (사람·볼라드·전봇대·나무·차량·신호등·트럭·버스·표지판·오토바이·이동간판·화분·휠체어) |
| Score Threshold | 0.5 |
| 추론 환경 | CPU (CUDA 감지 시 자동 GPU 전환) |

---

## 길찾기 기능

### 안전 길찾기 (Valhalla)

- **엔진**: Valhalla `pedestrian` 프로파일
- **장애물 우회**: 경로 주변 1.5km 내 등록된 장애물을 `avoid_locations`로 자동 우회
- **계단 경고**: Overpass API로 경로 위 계단·급경사 위치 ⚠️ 마커 표시

### 일반 경로 (OSRM)

- **엔진**: OSRM `driving` 프로파일 (자동차 기준 최단 경로)

### 음성 TTS 길안내

| 이벤트 | 음성 안내 |
|--------|----------|
| 안내 시작 | "안내를 시작합니다. N미터 후 {지시}" |
| 단계 변경 | "{현재 지시}. N미터 후 {다음 지시}" |
| 경로 이탈 | "경로를 이탈했습니다. 경로를 재탐색합니다." |
| 목적지 도착 | "목적지에 도착했습니다." |

---

## AI 감지 결과 시각화

기여하기 탭 → 내 기여목록에서 장애물 항목 탭 → 상세 모달:

- 원본 사진 위 **바운딩 박스 오버레이** (색상별 클래스 구분)
- 각 감지 객체 한국어 레이블 + **신뢰도 바 차트**
- 썸네일에 `AI` 뱃지 + 최상위 감지 결과 표시

---

## 지도 필터 기능

현재 위치 기반 반경 3km 내 장애편의시설 실시간 표시

| 필터 | 아이콘 | 검색 키워드 |
|------|--------|-----------|
| 경사로 | ♿ 초록 | `무장애`, `배리어프리`, `휠체어경사로` |
| 엘리베이터 | 🛗 파랑 | `엘리베이터` |
| 장애인화장실 | 🚻 보라 | `장애인화장실` |

- 데이터 소스: Kakao Local Search REST API
- 최대 45개 표시 (키워드당 3페이지 × 15개), 중복 좌표 자동 제거

---

## 백엔드 API 목록

| 메서드 | 엔드포인트 | 설명 |
|--------|-----------|------|
| GET | `/` | 서버 상태 + 모델 로드 여부 |
| GET | `/api/obstacles` | 전체 장애물 조회 (aiDetections 포함) |
| POST | `/api/obstacles` | 장애물 등록 + AI 분석 병렬 실행 |
| GET | `/api/obstacles/mine/{user_id}` | 내 기여 목록 |
| POST | `/api/obstacles/{id}/vote` | 좋아요/싫어요 투표 (토글) |
| GET | `/api/obstacles/{id}/vote/{user_id}` | 내 투표 여부 |
| GET | `/api/obstacles/contributors/top` | 좋아요 TOP 3 기여자 |
| GET | `/api/analyze/status` | AI 모델 준비 상태 |
| POST | `/api/analyze` | AI 단독 분석 (저장 없음) |
| GET | `/api/community/posts` | 게시글 목록 |
| POST | `/api/community/posts` | 게시글 작성 |
| DELETE | `/api/community/posts/{id}` | 게시글 삭제 |
| POST | `/api/community/posts/{id}/like` | 좋아요 토글 |
| GET | `/api/community/posts/{id}/comments` | 댓글 목록 |
| POST | `/api/community/posts/{id}/comments` | 댓글 작성 |
| DELETE | `/api/community/comments/{id}` | 댓글 삭제 |

---

## 실행 방법

### 환경변수 설정

루트 `.env` (앱):
```ini
EXPO_PUBLIC_KAKAO_REST_KEY=카카오_REST_API_키
EXPO_PUBLIC_KAKAO_JS_KEY=카카오_JS_앱_키
EXPO_PUBLIC_API_BASE_URL=http://100.72.221.111:8000
```

`backend/.env` (서버):
```ini
DATABASE_URL=postgresql+asyncpg://postgres:비밀번호@100.106.237.52:5432/safe_route_db
FIREBASE_CREDENTIALS_PATH=./firebase-adminsdk.json
FIREBASE_STORAGE_BUCKET=버킷명.firebasestorage.app
DETECTRON2_WEIGHTS=../retinanet_r_50_fpn_3x_aihub_final.pth
DETECTRON2_SCORE_THRESH=0.5
```

### 백엔드 서버 실행

```powershell
cd backend
python -m venv venv
./venv/Scripts/pip install -r requirements.txt

# Detectron2 Windows 소스 빌드 (VS Build Tools 2022 필요)
cmd /c "vcvars64.bat && set DISTUTILS_USE_SDK=1 && pip install git+https://github.com/facebookresearch/detectron2.git --no-build-isolation"

# 서버 실행
./venv/Scripts/uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

정상 실행 시:
```
[Detectron2] 모델 로드 완료 — classes=13, device=cpu
INFO: Application startup complete.
```

모델 파일 `retinanet_r_50_fpn_3x_aihub_final.pth` 을 프로젝트 루트에 위치시켜야 함.

### 앱 실행

```powershell
npm install
npm start
```

QR코드 → Expo Go 앱으로 스캔 (PC와 동일 네트워크 또는 Tailscale VPN 연결 필요)

### API 문서 (Swagger UI)

```
http://localhost:8000/docs
```

---

## 데이터베이스 스키마

### obstacles (장애물)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | SERIAL PK | |
| photo_url | TEXT | Firebase Storage URL |
| latitude / longitude | FLOAT | GPS 좌표 |
| created_at | TIMESTAMPTZ | 등록 시각 |
| user_id / user_email / display_name | TEXT | 기여자 정보 |
| likes / dislikes | INTEGER | 투표 집계 |
| ai_label | TEXT | 최고 신뢰도 감지 클래스 |
| ai_confidence | FLOAT | 신뢰도 0~1 |
| ai_detections | TEXT | 전체 감지 결과 JSON (bbox 포함) |

---

## 담당자

| 이름 | 담당 영역 |
|------|----------|
| 이재행 | FastAPI 백엔드 서버, Detectron2 AI 모델 연동, 지도 길찾기·필터, TTS 음성안내, AI 감지 시각화, 원격 DB 연결 |

---

## 개발 이력 — 이재행

| 날짜 | 작업 |
|------|------|
| 2026-03-03 ~ 04-02 | 보행 장애물 이미지 데이터 수집·라벨링·정제 |
| 2026-04-03 ~ 04-16 | AI 모델 구조 설계 (Detectron2 RetinaNet, AIHub 13-class) |
| 2026-04-17 ~ 04-20 | FastAPI 백엔드 서버 전체 구축 (CRUD, 커뮤니티, 투표, Firebase 연동) |
| 2026-04-20 | 지도 필터 Overpass API → Kakao Local API 전환 |
| 2026-04-20 | 데모 모드 전환 (Firebase 로그인 제거, 고정 데모 유저) |
| 2026-04-23 | Detectron2 Windows 소스 빌드 성공 (VS Build Tools 2022) |
| 2026-04-23 | Leaflet → Kakao Maps JS SDK 전면 교체 |
| 2026-04-23 | 원격 PostgreSQL Tailscale VPN 연결 (100.106.237.52) |
| 2026-04-23 | Firebase 업로드 + AI 추론 asyncio.gather 병렬화 (처리 시간 단축) |
| 2026-04-23 | api.ts AbortController 타임아웃 적용 (무한 로딩 버그 수정) |
| 2026-04-23 | 길찾기 개선: Valhalla pedestrian + avoid_locations, OSRM driving |
| 2026-04-23 | ai_detections 컬럼 추가 (전체 bbox JSON), 자동 마이그레이션 |
| 2026-04-23 | ContributeScreen AI 감지 시각화 (바운딩 박스 오버레이, 신뢰도 차트) |
| 2026-04-23 | expo-speech TTS 한국어 음성 길안내 구현 |

---

## 라이선스

본 프로젝트는 학술·교육 목적의 종합 프로젝트입니다.
