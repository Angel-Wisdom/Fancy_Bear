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
        denoised, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 11
    )
    fd, output_path = tempfile.mkstemp(suffix=".png")
    os.close(fd)
    cv2.imwrite(output_path, binary)
    return output_path

def run_ocr(path, lang):
    from paddleocr import PaddleOCR
    
    # ⚡ CPU OPTIMIZATIONS APPLIED HERE ⚡
    ocr = PaddleOCR(
        lang=lang,
        use_angle_cls=False,  # Skips a very slow rotation check phase
        enable_mkldnn=False,   # Enables hardware CPU math acceleration (HUGE speedup)
        cpu_threads=1,        # Prevents Docker thread thrashing
        show_log=False        # Mutes the noisy C++ console logs
    )

    processed_path = preprocess_image(path)
    try:
        # cls=False because we disabled angle_cls above for speed
        result = ocr.ocr(processed_path, cls=False) 
    finally:
        try:
            os.remove(processed_path)
        except OSError:
            pass

    lines = []
    confidences = []

    # Safely parse PaddleOCR v4 output: [[box_coords, (text, score)], ...]
    if result and len(result) > 0 and result[0]:
        for line in result[0]:
            if isinstance(line, (list, tuple)) and len(line) == 2:
                text_data = line[1]
                if isinstance(text_data, (list, tuple)) and len(text_data) == 2:
                    lines.append(str(text_data[0]))
                    confidences.append(float(text_data[1]))

    confidence = (sum(confidences) / len(confidences) * 100) if confidences else 0

    return {
        "text": "\n".join(lines).strip(),
        "confidence": max(0, min(100, confidence)),
        "lines": [{"text": text, "confidence": confidences[index]} for index, text in enumerate(lines)],
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