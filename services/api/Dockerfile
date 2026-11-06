# Listing Day API. Build from the repository root (the image needs contracts/deployments):
#   docker build -f services/api/Dockerfile -t listing-day-api .
#   docker run -p 8788:8788 -e SEPOLIA_RPC_URL=<archive rpc> -e CORS_ORIGINS=https://app.example listing-day-api
# Any container host that terminates TLS and injects PORT (Render, Railway, Fly.io, Cloud Run) serves it over HTTPS.
FROM node:22-alpine

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8788 \
    DEPLOYMENTS_FILES=../../contracts/deployments/sepolia.json

WORKDIR /app/services/api
COPY services/api/package.json services/api/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY services/api/src ./src
COPY contracts/deployments/sepolia.json /app/contracts/deployments/sepolia.json

USER node
EXPOSE 8788
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s CMD wget -qO /dev/null "http://127.0.0.1:${PORT}/health" || exit 1
CMD ["node", "src/index.ts"]
