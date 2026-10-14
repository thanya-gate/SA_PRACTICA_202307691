#!/usr/bin/env bash
# Despliega el entorno Dev en vm-development con Docker Compose.
# Solo copia archivos y descarga imágenes de GHCR: en la VM no hay docker build.
# Uso: ./deploy-dev.sh [tag]   (por defecto 3.0.0)
set -euo pipefail

TAG="${1:-3.0.0}"
VM="${VM:-vm-development}"
ZONA="${ZONA:-us-central1-a}"
DESTINO=/opt/academix-dev
RAIZ="$(cd "$(dirname "$0")/../../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Paquete con la misma estructura que espera Practica7/docker-compose.yml.
mkdir -p "$TMP/Backend/sql"
cp "$RAIZ/Practica7/docker-compose.yml" "$TMP/"
cp "$RAIZ/Practica7/Backend/sql/"0*.sql "$TMP/Backend/sql/"
cp "$RAIZ/Practica10/deploy/dev/Caddyfile.dev" "$TMP/Caddyfile"
cp "$RAIZ/Practica10/deploy/dev/.env.example" "$TMP/env.example"

echo "==> Copiando paquete a $VM:$DESTINO"
gcloud compute ssh "$VM" --zone "$ZONA" --command "sudo mkdir -p $DESTINO && sudo chown \$USER $DESTINO"
gcloud compute scp --recurse --zone "$ZONA" "$TMP"/* "$VM:$DESTINO/"

echo "==> Levantando stack con IMAGE_TAG=$TAG"
gcloud compute ssh "$VM" --zone "$ZONA" --command "set -e; cd $DESTINO
  # El .env se crea una sola vez: recrearlo cambiaría las claves de bases ya inicializadas.
  if [ ! -f .env ]; then
    sed -e \"s/^DB_PASSWORD=.*/DB_PASSWORD=\$(openssl rand -hex 16)/\" \
        -e \"s/^BROKER_PASSWORD=.*/BROKER_PASSWORD=\$(openssl rand -hex 16)/\" \
        -e \"s/^CLAVE_FIRMA_PASE=.*/CLAVE_FIRMA_PASE=\$(openssl rand -hex 32)/\" env.example > .env
    chmod 600 .env
  fi
  sed -i 's/^IMAGE_TAG=.*/IMAGE_TAG=$TAG/' .env
  sudo docker compose pull -q
  # shortcut: la e2-micro tarda en arrancar RabbitMQ y el healthcheck falla la 1a vez; se reintenta. Con una VM mayor sobra.
  sudo docker compose up -d --remove-orphans || { sleep 90; sudo docker compose up -d --remove-orphans; }
  sudo docker compose ps --format 'table {{.Name}}\t{{.Image}}\t{{.Status}}'"
