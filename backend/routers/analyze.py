from fastapi import APIRouter, UploadFile, File, HTTPException
from services import detector
from db.schemas import AnalyzeOut

router = APIRouter(prefix="/api/analyze", tags=["analyze"])


@router.get("/status")
async def status():
    return {
        "ready": detector.MODEL_READY,
        "classes": detector.class_names,
        "message": "모델 준비 완료" if detector.MODEL_READY else "retinanet_r_50_fpn_3x_aihub_final.pth 파일을 프로젝트 루트에 위치시키세요",
    }


@router.post("", response_model=list[AnalyzeOut])
async def analyze(photo: UploadFile = File(...)):
    if not detector.MODEL_READY:
        raise HTTPException(503, "Detectron2 모델이 아직 준비되지 않았습니다.")
    image_bytes = await photo.read()
    try:
        results = detector.detect(image_bytes)
    except Exception as e:
        raise HTTPException(500, f"분석 실패: {e}")
    return [AnalyzeOut(**r) for r in results]
