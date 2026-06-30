# ── React Client (Vite Dev Server) ───────────────────────────────
# Runs the Vite development server so hot-module-reload works
# ─────────────────────────────────────────────────────────────────
FROM node:22-slim

WORKDIR /app

# Install deps first (layer caching)
COPY package.json package-lock.json* ./
RUN npm ci 2>/dev/null || npm install

# Copy source
COPY . .

EXPOSE 5173

# CHOKIDAR_USEPOLLING is needed for file-watch to work inside Docker on Windows/macOS
ENV CHOKIDAR_USEPOLLING=true

CMD ["npm", "run", "dev"]
