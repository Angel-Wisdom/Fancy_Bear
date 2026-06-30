from flask import Flask, render_template, request, jsonify
import cv2
import base64
import io
import os
import tempfile
from PIL import Image
from pyzbar.pyzbar import decode as pyzbar_decode
from pyaadhaar.utils import Qr_img_to_text, isSecureQr
from pyaadhaar.decode import AadhaarSecureQr, AadhaarOldQr

app = Flask(__name__)

ERROR_MSG = (
    "The Aadhaar QR code image has unclear pixels. "
    "Please take a clearer image or this could be an error with the processing "
    "system due to a different version of QR code. Please fallback to manual verification."
)

def _extract_photo(obj):
    if isinstance(obj, AadhaarSecureQr) and obj.isImage():
        try:
            photo = obj.image()
            if photo:
                buf = io.BytesIO()
                photo.save(buf, format="JPEG", quality=90)
                return base64.b64encode(buf.getvalue()).decode()
        except Exception:
            pass
    return None


def _safe_decode_qr(raw):
    if isSecureQr(raw):
        obj = AadhaarSecureQr(int(raw))
        return obj.decodeddata(), _extract_photo(obj)
    return AadhaarOldQr(raw).decodeddata(), None


def _prepare_image(image_b64):
    """Strip base64 prefix, decode, save to temp PNG, return (tmp_path, grayscale_cv)."""
    if "," in image_b64:
        image_b64 = image_b64.split(",", 1)[1]
    image_bytes = base64.b64decode(image_b64)
    pil_img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    fd, tmp = tempfile.mkstemp(suffix=".png")
    os.close(fd)
    pil_img.save(tmp, "PNG")
    cv_img = cv2.imread(tmp)
    gray = cv2.cvtColor(cv_img, cv2.COLOR_BGR2GRAY)
    return tmp, gray


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/detect", methods=["POST"])
def detect():
    payload = request.get_json(silent=True)
    if not payload or "image" not in payload:
        return jsonify({"error": "No image data received."}), 400
    autodetect = payload.get("autodetect", False)
    image_b64 = payload["image"]
    tmp = None
    try:
        tmp, gray = _prepare_image(image_b64)
        if autodetect:
            # Scan the full image for a QR code and return its bounding box
            codes = pyzbar_decode(gray)
            if not codes:
                return jsonify({"found": False})
            qr = codes[0]
            qr_data = qr.data.decode("utf-8")
            r = qr.rect
            h, w = gray.shape[:2]
            bbox = {
                "x": r.left / w,
                "y": r.top / h,
                "w": r.width / w,
                "h": r.height / h,
            }
            data, photo = _safe_decode_qr(qr_data)
            return jsonify({
                "found": True,
                "bbox": bbox,
                "success": True,
                "data": data,
                "photo": photo,
            })
        else:
            # Manual mode: image is already cropped to the QR region
            texts = Qr_img_to_text(tmp)
            if not texts:
                return jsonify({
                    "found": False,
                    "error": "No QR code found in the selected region. Try cropping tighter around the QR."
                }), 404
            data, photo = _safe_decode_qr(texts[0])
            return jsonify({
                "found": True,
                "success": True,
                "data": data,
                "photo": photo,
            })

    except Exception:
        if autodetect:
            return jsonify({"found": True, "success": False, "error": ERROR_MSG})
        return jsonify({"error": ERROR_MSG}), 500
    finally:
        if tmp and os.path.exists(tmp):
            os.unlink(tmp)


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)