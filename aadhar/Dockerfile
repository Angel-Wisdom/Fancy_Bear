# ── Aadhaar QR Microservice ──────────────────────────────────────
# Python 3.11 slim — installs zbar (for pyzbar) and headless OpenCV
# ─────────────────────────────────────────────────────────────────
FROM python:3.11-slim

# System deps:
#   libzbar0       → pyzbar (QR decode)
#   libglib2.0-0   → OpenCV dependency
#   libgl1         → OpenCV dependency (headless still needs libGL)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libzbar0 \
    libglib2.0-0 \
    libgl1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first (layer caching)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy app source
COPY . .

EXPOSE 5000

CMD ["python", "app.py"]
