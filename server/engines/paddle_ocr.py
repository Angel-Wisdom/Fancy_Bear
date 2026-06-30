import argparse
import json
import os
import sys
import tempfile

os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, "..", ".paddle-cache"))
os.makedirs(CACHE_DIR, exist_ok=True)
os.environ.setdefault("PADDLE_HOME", CACHE_DIR)
os.environ.setdefault("PADDLEOCR_HOME", CACHE_DIR)
os.environ.setdefault("PADDLE_PDX_CACHE_HOME", CACHE_DIR)
os.environ.setdefault("XDG_CACHE_HOME", CACHE_DIR)


def preprocess_image(path):
    import cv2

    image = cv2.imread(path)
    if image is None:
        raise ValueError("OpenCV could not read image")

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    denoised = cv2.fastNlMeansDenoising(gray, None, 12, 7, 21)
    binary = cv2.adaptiveThreshold(
        denoised,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        31,
        11,
    )

    fd, output_path = tempfile.mkstemp(suffix=".png")
    os.close(fd)
    cv2.imwrite(output_path, binary)
    return output_path


def flatten_ocr_result(result):
    lines = []
    confidences = []

    def walk(value):
        if isinstance(value, dict):
            if "rec_texts" in value:
                for text in value.get("rec_texts") or []:
                    if text:
                        lines.append(str(text))
                for score in value.get("rec_scores") or []:
                    try:
                        confidences.append(float(score))
                    except (TypeError, ValueError):
                        pass
            else:
                for item in value.values():
                    walk(item)
        elif isinstance(value, (list, tuple)):
            if len(value) >= 2 and isinstance(value[1], (list, tuple)) and len(value[1]) >= 2:
                text, score = value[1][0], value[1][1]
                if text:
                    lines.append(str(text))
                try:
                    confidences.append(float(score))
                except (TypeError, ValueError):
                    pass
            else:
                for item in value:
                    walk(item)

    walk(result)
    return lines, confidences


def run_ocr(path, lang):
    from paddleocr import PaddleOCR

    kwargs = {
        "lang": lang,
        "use_doc_orientation_classify": False,
        "use_doc_unwarping": False,
        "use_textline_orientation": True,
    }
    try:
        ocr = PaddleOCR(**kwargs)
    except TypeError:
        ocr = PaddleOCR(lang=lang, use_angle_cls=True, show_log=False)

    processed_path = preprocess_image(path)
    try:
        if hasattr(ocr, "predict"):
            result = ocr.predict(processed_path)
        else:
            result = ocr.ocr(processed_path, cls=True)
    finally:
        try:
            os.remove(processed_path)
        except OSError:
            pass

    lines, confidences = flatten_ocr_result(result)
    confidence = (sum(confidences) / len(confidences) * 100) if confidences and max(confidences) <= 1 else (sum(confidences) / len(confidences) if confidences else 0)

    return {
        "text": "\n".join(lines).strip(),
        "confidence": max(0, min(100, confidence)),
        "lines": [{"text": text, "confidence": confidences[index] if index < len(confidences) else None} for index, text in enumerate(lines)],
        "engine": "paddleocr+opencv",
        "pages": 1,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("image")
    parser.add_argument("--lang", default="en")
    args = parser.parse_args()

    try:
        print(json.dumps(run_ocr(args.image, args.lang), ensure_ascii=True))
    except Exception as exc:
        print(json.dumps({"error": str(exc), "engine": "paddleocr+opencv"}), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
