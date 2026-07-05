FROM node:22-slim

WORKDIR /app

# 4. Install Node.js dependencies
# (Only re-runs if package.json changes)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev

# 5. Copy the rest of the application source code
COPY . .

EXPOSE 3001
CMD ["node", "index.js"]