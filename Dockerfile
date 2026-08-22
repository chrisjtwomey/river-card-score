FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

# install first, so a code change does not rebuild the dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY game.js server.js make-cert.js ./
COPY public ./public

ENV PORT=8787
EXPOSE 8787

# BusyBox wget: the server answers /net.json without a game
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q -O /dev/null http://127.0.0.1:8787/net.json || exit 1

CMD ["node", "server.js"]
