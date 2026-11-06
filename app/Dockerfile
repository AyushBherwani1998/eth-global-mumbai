# Thamba app. Build from the repository root: the app type-imports
# services/api/src/types.ts, which is outside app/.
#   docker build -f app/Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://api.example -t thamba-app .
# NEXT_PUBLIC_* values are inlined at build time, so they are build args, not runtime env.
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo/app
COPY app/package.json app/pnpm-lock.yaml app/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY app/ ./
COPY services/api/src/types.ts /repo/services/api/src/types.ts

ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_PRIVY_APP_ID
ARG NEXT_PUBLIC_RPC_URL
ARG NEXT_PUBLIC_MAINNET_RPC_URL
ARG NEXT_PUBLIC_ISSUER_ADDRESS
ENV NEXT_TELEMETRY_DISABLED=1 \
    NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_PRIVY_APP_ID=$NEXT_PUBLIC_PRIVY_APP_ID \
    NEXT_PUBLIC_RPC_URL=$NEXT_PUBLIC_RPC_URL \
    NEXT_PUBLIC_MAINNET_RPC_URL=$NEXT_PUBLIC_MAINNET_RPC_URL \
    NEXT_PUBLIC_ISSUER_ADDRESS=$NEXT_PUBLIC_ISSUER_ADDRESS
RUN pnpm build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "start"]
