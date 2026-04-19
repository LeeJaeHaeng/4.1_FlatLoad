"""
YOLOv5 볼라드(Bollard) 감지 서비스
모델: Tibet-Fox/Hack_Festa — best.pt (YOLOv5, 1 class: Bollard)
"""
import io
import os
from PIL import Image
from dotenv import load_dotenv

load_dotenv()

MODEL_PATH = os.getenv("YOLO_MODEL", "./best.pt")

YOLO_READY  = False
model       = None
class_names: list[str] = []


def load_model():
    global YOLO_READY, model, class_names

    if not os.path.exists(MODEL_PATH):
        print(f"[YOLO] 모델 파일 없음: {MODEL_PATH}")
        return

    try:
        import torch
        # PyTorch 2.6+ weights_only=True 기본값 변경 대응 — 신뢰된 로컬 파일
        _orig_load = torch.load
        def _load_compat(*args, **kwargs):
            kwargs.setdefault('weights_only', False)
            return _orig_load(*args, **kwargs)
        torch.load = _load_compat

        import yolov5
        model = yolov5.load(MODEL_PATH)
        model.conf = 0.4
        model.iou  = 0.45
        class_names = list(model.names.values()) if isinstance(model.names, dict) else list(model.names)
        YOLO_READY = True
        print(f"[YOLO] 모델 로드 완료 — 클래스: {class_names}")
    except Exception as e:
        print(f"[YOLO] 모델 로드 실패: {e}")


def detect(image_bytes: bytes, conf_thresh: float = 0.4) -> list[dict]:
    """
    이미지 바이트 → 감지 결과 리스트
    반환: [{"label": str, "confidence": float, "bbox": [x,y,w,h]}]  (bbox 0~1 정규화)
    """
    if not YOLO_READY or model is None:
        raise RuntimeError("YOLOv5 모델이 로드되지 않았습니다")

    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    w, h = img.size

    results = model(img, size=640)
    df = results.pandas().xyxy[0]
    detections = []
    for _, row in df.iterrows():
        if float(row["confidence"]) < conf_thresh:
            continue
        xmin, ymin, xmax, ymax = row["xmin"], row["ymin"], row["xmax"], row["ymax"]
        bx = (xmin + xmax) / 2 / w
        by = (ymin + ymax) / 2 / h
        bw = (xmax - xmin) / w
        bh = (ymax - ymin) / h
        detections.append({
            "label":      row["name"],
            "confidence": float(row["confidence"]),
            "bbox":       [float(bx), float(by), float(bw), float(bh)],
        })

    detections.sort(key=lambda x: x["confidence"], reverse=True)
    return detections
