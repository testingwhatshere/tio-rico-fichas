FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server.js ./
COPY src ./src
COPY public ./public
EXPOSE 3010
# El healthcheck de Render pega a /salud, que además verifica la conexión a la DB.
CMD ["node", "server.js"]
