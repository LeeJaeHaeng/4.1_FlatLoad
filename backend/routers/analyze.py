from fastapi import APIRouter, UploadFile, File, HTTPException
from services import yolo
from db.schemas import AnalyzeOut

router = APIRouter(prefix="/api/analyze", tags=["analyze"])


@router.get("/status")
async def status():
    return {
        "ready": yolo.YOLO_READY,
        "classes": yolo.class_names,
        "message": "모델 준비 완료" if yolo.YOLO_READY else "cfg/names 파일을 backend/ 폴더에 추가하세요",
    }


@router.post("", response_model=list[AnalyzeOut])
async def analyze(photo: UploadFile = File(...)):
    if not yolo.YOLO_READY:
        raise HTTPException(503, "YOLOv4 모델이 아직 준비되지 않았습니다. yolov4.cfg와 obj.names 파일을 추가하세요.")
    image_bytes = await photo.read()
    try:
        results = yolo.detect(image_bytes)
    except Exception as e:
        raise HTTPException(500, f"분석 실패: {e}")
    return [AnalyzeOut(**r) for r in results]
