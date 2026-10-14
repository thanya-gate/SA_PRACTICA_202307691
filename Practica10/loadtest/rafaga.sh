#!/usr/bin/env bash
# Ráfaga de reservas concurrentes contra el endpoint público (Ingress).
# Sirve para ver en Grafana ("Academix · Negocio y Colas") cómo sube la cola
# de RabbitMQ y cómo los workers la vacían, sin que el Ingress se degrade.
#
# Uso: ./rafaga.sh [URL_BASE] [TOTAL] [CONCURRENCIA]
#   ./rafaga.sh                                         # Prod, 500 peticiones, 50 a la vez
#   ./rafaga.sh https://35.238.184.140.sslip.io 200 20  # Dev
set -euo pipefail

BASE="${1:-https://academix.34.29.246.70.sslip.io}"
TOTAL="${2:-500}"
CONC="${3:-50}"

# Se toma un evento real del catálogo para que el worker procese reservas válidas.
EVENTO="$(curl -sf "$BASE/catalogo/api/talleres/eventos" | grep -o '"eventoId":"[^"]*"' | head -1 | cut -d'"' -f4)"
[ -n "$EVENTO" ] || { echo "No se pudo leer un evento del catálogo en $BASE" >&2; exit 1; }

LOTE="$(date +%s)"
echo "==> $TOTAL reservas a $BASE (evento $EVENTO, concurrencia $CONC)"
INICIO=$(date +%s)

# Cada petición imprime solo su código HTTP; correos únicos en demo.test (dominio de demostración que acepta el backend).
CODIGOS="$(seq 1 "$TOTAL" | xargs -P "$CONC" -I{} curl -s -o /dev/null -w '%{http_code}\n' -m 30 \
  -X POST "$BASE/reservas/api/reservas" -H 'Content-Type: application/json' \
  -d "{\"eventoId\":\"$EVENTO\",\"estudianteNombre\":\"Carga {}\",\"estudianteCorreo\":\"carga-$LOTE-{}@carga.demo.test\",\"canal\":\"carga\"}")"

echo "==> Terminado en $(( $(date +%s) - INICIO ))s. Códigos HTTP:"
echo "$CODIGOS" | sort | uniq -c
ERRORES=$(echo "$CODIGOS" | grep -vc '^202$' || true)
[ "$ERRORES" -eq 0 ] && echo "OK: todas aceptadas (202)" || { echo "AVISO: $ERRORES respuestas distintas de 202"; exit 1; }
