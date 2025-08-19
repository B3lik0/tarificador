FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY . .

RUN mkdir -p /app/files \
    && touch /app/log.txt \
    && chown -R node:node /app

USER node

CMD ["node", "watcher-sftp.js"]

