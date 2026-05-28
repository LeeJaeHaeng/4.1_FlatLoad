import asyncio
from fastapi import APIRouter, UploadFile, File, HTTPException
from services import detector
from db.schemas import AnalyzeOut

router = APIRouter(prefix="/api/analyze", tags=["analyze"])


@router.get("/status")
async def status():
    return {
        "ready": detector.MODEL_READY,
        "provider": "roboflow",
        "modelId": detector.MODEL_ID,
        "classes": detector.class_names,
        "message": "Roboflow API 준비 완료" if detector.MODEL_READY else "ROBOFLOW_API_KEY/ROBOFLOW_MODEL_ID 설정을 확인하세요",
    }


@router.post("", response_model=list[AnalyzeOut])
async def analyze(photo: UploadFile = File(...)):
    if not detector.MODEL_READY:
        raise HTTPException(503, "Roboflow API 설정이 아직 준비되지 않았습니다.")
    image_bytes = await photo.read()
    try:
        results = detector.detect(image_bytes)
    except Exception as e:
        raise HTTPException(500, f"분석 실패: {e}")
    return [AnalyzeOut(**r) for r in results]


@router.post("/detect")
async def detect_only(photo: UploadFile = File(...)):
    """저장 없이 AI 분석만 수행 — 미리보기 화면에서 레이블 자동 채우기용"""
    if not detector.MODEL_READY:
        return {"ai_label": None, "ai_confidence": None, "ai_detections": []}
    image_bytes = await photo.read()
    try:
        detections = await asyncio.to_thread(detector.detect, image_bytes)
    except Exception:
        return {"ai_label": None, "ai_confidence": None, "ai_detections": []}

    if not detections:
        return {"ai_label": None, "ai_confidence": None, "ai_detections": []}

    top = detections[0]
    return {
        "ai_label": top["label"],
        "ai_confidence": top["confidence"],
        "ai_detections": detections,
    }
