# ── Node.js API Server ───────────────────────────────────────────
# Uses pure JSON store — no native SQLite build needed
# ─────────────────────────────────────────────────────────────────
FROM node:22-slim

WORKDIR /app

# Install deps first (layer caching — only re-runs if package.json changes)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev

# Copy all server source
COPY . .

EXPOSE 3001

CMD ["node", "index.js"]
