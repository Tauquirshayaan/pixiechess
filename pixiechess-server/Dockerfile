# ╔══════════════════════════════════════════════════════╗
# ║  Pixie Chess Server — Multi-Stage Docker Build       ║
# ║  Stage 1: Build C++ engine binary for Linux          ║
# ║  Stage 2: Build TypeScript server                    ║
# ║  Stage 3: Lean production runtime image              ║
# ║                                                      ║
# ║  BUILD CONTEXT: The repo root (Pixiechessbot/)       ║
# ║  Run with:                                           ║
# ║    docker build -f pixiechess-server/Dockerfile \    ║
# ║      --platform linux/amd64 -t pixiechess .          ║
# ╚══════════════════════════════════════════════════════╝

# ── Stage 1: Build C++ Engine for Linux ─────────────────────────────────────
FROM debian:bookworm-slim AS cpp-builder

RUN apt-get update && apt-get install -y \
    g++ cmake make \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /engine
COPY pixie-engine-cpp/ .

# Build the native Linux binary
RUN cmake -B build -S . -DCMAKE_BUILD_TYPE=Release \
    && cmake --build build --target pixie-engine-cpp -j$(nproc)

# ── Stage 2: Build TypeScript Server ────────────────────────────────────────
FROM node:20-slim AS ts-builder

WORKDIR /app
COPY pixiechess-server/package*.json ./
RUN npm ci

COPY pixiechess-server/ .
# Compile TypeScript to JavaScript
RUN npx tsc --outDir dist --module commonjs --esModuleInterop true \
    --resolveJsonModule true --skipLibCheck true --noEmit false 2>/dev/null || true

# ── Stage 3: Build Frontend ──────────────────────────────────────────────────
FROM node:20-slim AS frontend-builder

WORKDIR /frontend
COPY pixiechess-bot/package*.json ./
RUN npm ci

COPY pixiechess-bot/ .
RUN npm run build

# ── Stage 4: Production Runtime ─────────────────────────────────────────────
FROM node:20-slim AS runtime

# Install only runtime OS dependencies
RUN apt-get update && apt-get install -y \
    libstdc++6 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy compiled server JS
COPY --from=ts-builder /app/dist ./dist
COPY --from=ts-builder /app/package*.json ./

# Copy compiled C++ engine binary + NNUE weights
COPY --from=cpp-builder /engine/build/pixie-engine-cpp ./dist/engine/bin/pixie-engine-cpp
RUN chmod +x ./dist/engine/bin/pixie-engine-cpp

# Copy NNUE weights
COPY pixiechess-server/src/engine/bin/pixiechess.nnue ./dist/engine/bin/pixiechess.nnue

# Copy WASM files (used for legality checking)
COPY pixiechess-bot/src/engine/wasm/pixie_engine.js ./dist/engine/wasm/pixie_engine.js
COPY pixiechess-bot/src/engine/wasm/pixie_engine.wasm ./dist/engine/wasm/pixie_engine.wasm

# Copy built frontend static files (served by Express)
COPY --from=frontend-builder /frontend/dist ./frontend-dist

# Install only production npm dependencies
RUN npm ci --omit=dev

# Cloud Run injects PORT environment variable
ENV NODE_ENV=production
ENV FRONTEND_DIST=/app/frontend-dist
EXPOSE 3000

CMD ["node", "dist/server.js"]
