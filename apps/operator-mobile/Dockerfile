# Panel de operadores servido como web estatica (Expo Router -> react-native-web).
#
# Se buildea con el contexto en apps/operator-mobile, NO desde la raiz del
# monorepo: el root hoistea ws@6 y @expo/cli necesita ws@8, asi que un build
# dentro del workspace revienta con "WebSocketServer is not a constructor".
# La app no importa nada de packages/shared-*, por eso el build aislado es valido.
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json ./
RUN npm install --legacy-peer-deps

COPY . .
RUN npx expo export --platform web

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
# Puerto 10000 + fallback a index.html: expo-router es una SPA, cualquier ruta
# profunda (/failures, /failure/<id>) tiene que resolver al mismo bundle.
#
# Cache: el index.html se sirve SIN cachear. Es el unico archivo que apunta al
# bundle (que va con hash en el nombre), asi que si el navegador se lo queda,
# el operador sigue corriendo la version vieja de la app despues de cada deploy
# y no hay forma de avisarle salvo pedirle un Ctrl+Shift+R. Los assets de
# /_expo/static/ si se cachean para siempre: cambian de nombre en cada build.
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 10000
