FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/app/data
COPY package*.json ./
RUN npm install --omit=dev
COPY server.js regions.js ./
COPY public ./public
COPY private ./private
EXPOSE 3000
CMD ["node", "server.js"]
