# This script runs ONCE during the Docker build.
# It forces PaddleOCR to download its English/multilingual models into the explicit cache folder.
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, "..", ".paddle-cache"))
os.makedirs(CACHE_DIR, exist_ok=True)

# Force Paddle to use our custom app-level cache directory BEFORE importing it
os.environ["PADDLE_HOME"] = CACHE_DIR
os.environ["PADDLEOCR_HOME"] = CACHE_DIR
os.environ["PADDLE_PDX_CACHE_HOME"] = CACHE_DIR
os.environ["XDG_CACHE_HOME"] = CACHE_DIR

from paddleocr import PaddleOCR

print(f"Pre-fetching PaddleOCR models into: {CACHE_DIR}")
# Instantiating it triggers the download.
ocr = PaddleOCR(use_angle_cls=True, lang='en', show_log=True)
print("Models downloaded and cached successfully for offline use.")