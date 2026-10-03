# =====================================================================
# certificados-service (TypeScript) - dueno de credenciales-db
# =====================================================================
FROM node:22-alpine AS compilador

WORKDIR /src
COPY services/certificados-service/package.json services/certificados-service/package-lock.json ./
RUN npm ci

COPY services/certificados-service/tsconfig.json ./
COPY services/certificados-service/src ./src
RUN npm run build
RUN npm ci --omit=dev

FROM node:22-alpine

RUN apk add --no-cache dumb-init tzdata wget \
    && addgroup -S academix \
    && adduser -S -G academix academix

WORKDIR /app
COPY --from=compilador --chown=academix:academix /src/node_modules ./node_modules
COPY --from=compilador --chown=academix:academix /src/dist ./dist
COPY --from=compilador --chown=academix:academix /src/package.json ./package.json
COPY proto /app/proto

USER academix
EXPOSE 8080 50063

HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8080/api/certificados/salud || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
