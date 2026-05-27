FROM node:20-alpine

WORKDIR /app

# Build frontend
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm ci

COPY frontend/ ./frontend/
RUN cd frontend && npm run build

# Install backend
COPY backend/package*.json ./backend/
RUN cd backend && npm ci

COPY backend/ ./backend/

# Copy built frontend into backend/public so the path is unambiguous
RUN cp -r /app/frontend/dist /app/backend/public

EXPOSE 3001

CMD ["node", "backend/server.js"]
