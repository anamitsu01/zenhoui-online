FROM node:22-slim AS base
WORKDIR /app

# Install dependencies (full, since the custom server isn't traced by
# Next.js standalone output — see node_modules/next/dist/docs/01-app/02-guides/custom-server.md)
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["npx", "tsx", "server.ts"]
