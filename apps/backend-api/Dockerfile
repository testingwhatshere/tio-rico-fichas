FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
COPY prisma ./prisma/

RUN npm install

RUN npx prisma generate

COPY . .

RUN npm run build

# --- Production ---
FROM node:20-alpine

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/public ./public
# Zips de la extensión del bot (ver extension-download.controller.ts). Fuera de
# public/ a propósito: llevan la clave del bot.
COPY --from=builder /app/extension-builds ./extension-builds

RUN mkdir -p /app/uploads

EXPOSE 3000

# `db push` sincroniza el schema en cada arranque. Se mantiene para que un
# deploy con campos nuevos no rompa, pero SIN `--accept-data-loss`: ese flag
# hacia que Prisma borrara columnas o tablas sin preguntar, contra la base de
# produccion, cada vez que alguien deployaba. Si un cambio implica perder datos
# el arranque ahora falla y hay que resolverlo a mano, que es lo correcto
# cuando hay plata de usuarios en el medio.
CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/src/main"]
