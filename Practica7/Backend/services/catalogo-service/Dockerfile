# =====================================================================
# catalogo-service (TypeScript) - dueno de catalog-db
# =====================================================================
# Etapa 1: instalar dependencias y compilar TypeScript.
FROM node:22-alpine AS compilador

WORKDIR /src
COPY services/catalogo-service/package.json services/catalogo-service/package-lock.json ./
RUN npm ci

COPY services/catalogo-service/tsconfig.json ./
COPY services/catalogo-service/src ./src
RUN npm run build

# Etapa 2: solo las dependencias de produccion. Se genera un package-lock
# limpio para que npm ci no reinstale jest ni typescript en la imagen final.
RUN npm ci --omit=dev

# Etapa 3: imagen de ejecucion.
FROM node:22-alpine

# dumb-init reenvia senales correctamente: sin el, node ignora SIGTERM y
# docker stop acaba matandolo a los 10 segundos en vez de dejar que el
# servicio cierre sus conexiones de forma ordenada.
RUN apk add --no-cache dumb-init tzdata wget \
    && addgroup -S academix \
    && adduser -S -G academix academix

WORKDIR /app
COPY --from=compilador --chown=academix:academix /src/node_modules ./node_modules
COPY --from=compilador --chown=academix:academix /src/dist ./dist
COPY --from=compilador --chown=academix:academix /src/package.json ./package.json
COPY proto /app/proto

USER academix
EXPOSE 8080 50061

HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8080/api/talleres/salud || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
