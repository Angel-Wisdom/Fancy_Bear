FROM node:22-slim

# sharp's prebuilt binaries (@img/sharp-linux-*) bundle their own libvips.
# We only need the minimal base system shared libraries they link against.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        libglib2.0-0 \
        libexpat1 \
        liblcms2-2 \
        libopenjp2-7 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev

COPY . .

EXPOSE 3001
CMD ["node", "index.js"]