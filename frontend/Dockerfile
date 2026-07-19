# Build stage
FROM node:20-slim AS build-stage
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

# Vite bakes VITE_* vars into the bundle at BUILD time — they must arrive as
# build args (Dokploy forwards its Environment-tab vars to the build). The API
# URL is deliberately absent: nginx proxies /api same-origin.
ARG VITE_POSTHOG_KEY
ARG VITE_POSTHOG_HOST
ENV VITE_POSTHOG_KEY=$VITE_POSTHOG_KEY
ENV VITE_POSTHOG_HOST=$VITE_POSTHOG_HOST

RUN npm run build

# Production stage
FROM nginx:stable-alpine AS production-stage
COPY --from=build-stage /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
