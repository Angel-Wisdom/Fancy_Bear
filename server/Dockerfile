# ── Node.js API Server (with Offline PaddleOCR) ─────────────────
# Uses Node 22 + Python 3 virtual environment for OCR integration
# ─────────────────────────────────────────────────────────────────
FROM node:22-slim

WORKDIR /app

# 1. Install Python, pip, and system libraries required by OpenCV
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# 2. Create and activate a Python virtual environment (fixes PEP 668 system-package errors)
ENV VIRTUAL_ENV=/opt/venv
RUN python3 -m venv $VIRTUAL_ENV
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

# 3. Install PaddleOCR dependencies & Pre-fetch AI models
# We copy ONLY these files first so Docker caches the heavy ML downloads!
# Make sure these two files exist in your server/engines/ folder before building.
COPY engines/requirements.txt engines/prefetch_models.py ./engines/
RUN pip install --no-cache-dir -r ./engines/requirements.txt
RUN python ./engines/prefetch_models.py

# 4. Install Node.js dependencies
# (Only re-runs if package.json changes)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev

# 5. Copy the rest of the application source code
COPY . .

EXPOSE 3001

CMD ["node", "index.js"]