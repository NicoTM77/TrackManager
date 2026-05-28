# Stage 1: Build the frontend React app
FROM node:20-alpine AS frontend-builder
WORKDIR /app
COPY package*.json ./
COPY frontend/package*.json ./frontend/
COPY backend/package*.json ./backend/
RUN npm ci --workspace=frontend
COPY frontend/ ./frontend/
RUN npm run build -w frontend

# Stage 2: Build the backend Express app and install production dependencies
FROM node:20-alpine AS backend-builder
# Install build tools to compile better-sqlite3 native bindings
RUN apk add --no-cache python3 make g++ gcc libc-dev
WORKDIR /app
COPY package*.json ./
COPY backend/package*.json ./backend/
COPY frontend/package*.json ./frontend/
RUN npm ci --workspace=backend
COPY backend/ ./backend/
RUN npm run build -w backend
# Prune devDependencies to keep node_modules light for production by doing a clean production install
RUN rm -rf node_modules && npm ci --omit=dev --workspace=backend
RUN mkdir -p backend/node_modules

# Stage 3: Secure production runner stage
FROM node:20-alpine AS runner
# Install the native mediainfo binary dependency securely
RUN apk add --no-cache mediainfo libstdc++ libgcc
WORKDIR /app

# Copy production backend dependencies and compiled JS build
COPY --from=backend-builder /app/node_modules ./node_modules
COPY --from=backend-builder /app/backend/node_modules ./backend/node_modules
COPY --from=backend-builder /app/backend/dist ./backend/dist
COPY --from=backend-builder /app/backend/package.json ./backend/package.json
COPY --from=backend-builder /app/backend/drizzle ./backend/drizzle

# Copy compiled static frontend assets to serve via Express
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Setup storage directory for persistent SQLite database and give node user privileges
RUN mkdir -p /app/data && chown -R node:node /app

# Switch to the non-root 'node' user for superior runtime security
USER node

# Expose port and configure environment
EXPOSE 3000
ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_URL=/app/data/local.db

# Start server
CMD ["node", "backend/dist/index.js"]
