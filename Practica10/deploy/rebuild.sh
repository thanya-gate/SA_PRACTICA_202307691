#!/usr/bin/env bash
# Reconstruye TODA la Práctica 10 sobre VMs ya aprovisionadas por la P9
# (terraform apply + ansible-playbook site.yml). Es idempotente: se puede
# volver a correr sobre un entorno que ya está arriba sin romper nada.
#
#   Prod (K3s): cert-manager, Secrets, SQL, apps, Prometheus + Grafana
#   Dev  (VM):  docker compose vía deploy-dev.sh
#
# Las IPs públicas son efímeras: se leen de gcloud y se sustituyen en una
# copia temporal de los manifiestos (el repo no se modifica).
#
# Uso (desde cualquier carpeta):  Practica10/deploy/rebuild.sh
# Requisitos: gcloud autenticado, kubectl, helm, openssl.
set -euo pipefail

ZONA="${ZONA:-us-central1-a}"
TAG="${TAG:-4.0.0}"
CERT_MANAGER="v1.21.2"
CHART_VERSION="92.3.0"
# IPs con las que están escritos los manifiestos versionados.
IP_PROD_REPO="34.29.246.70"
IP_DEV_REPO="35.238.184.140"

AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"
export KUBECONFIG="${KUBECONFIG_P10:-$RAIZ/Practica9/infra/ansible/kubeconfig/k3s.yaml}"
paso() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }

for cmd in gcloud kubectl helm openssl curl; do
  command -v "$cmd" >/dev/null || { echo "Falta '$cmd' en PATH" >&2; exit 1; }
done
[ -f "$KUBECONFIG" ] || { echo "No existe $KUBECONFIG: corre primero ansible-playbook site.yml (P9)" >&2; exit 1; }

paso "IPs públicas actuales"
ip_de() { gcloud compute instances describe "$1" --zone "$ZONA" --format='value(networkInterfaces[0].accessConfigs[0].natIP)'; }
IP_PROD="$(ip_de vm-production-k3s)"
IP_DEV="$(ip_de vm-development)"
echo "prod=$IP_PROD  dev=$IP_DEV"
kubectl get nodes

# Copia de los manifiestos con las IPs reales.
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp -R "$AQUI/kubernetes" "$AQUI/observability" "$TMP/"
find "$TMP" -type f \( -name '*.yaml' -o -name '*.yml' \) -exec sed -i.bak "s/${IP_PROD_REPO//./\\.}/$IP_PROD/g" {} +
sed -i.bak "s/newTag: \".*\"/newTag: \"$TAG\"/" "$TMP/kubernetes/kustomization.yaml"
find "$TMP" -name '*.bak' -delete

paso "cert-manager $CERT_MANAGER + ClusterIssuer"
kubectl apply -f "https://github.com/cert-manager/cert-manager/releases/download/$CERT_MANAGER/cert-manager.yaml" >/dev/null
kubectl wait --for=condition=Available deploy --all -n cert-manager --timeout=300s
# El webhook tarda unos segundos en aceptar recursos aunque el deploy esté listo.
for i in $(seq 1 12); do kubectl apply -f "$TMP/kubernetes/cluster-issuer.yaml" && break; sleep 10; done

paso "Namespace, Secrets y SQL (los Secrets solo se crean si no existen)"
kubectl apply -f "$TMP/kubernetes/namespace.yaml"
kubectl create namespace monitoring --dry-run=client -o yaml | kubectl apply -f -
if ! kubectl get secret academix-secrets -n academix-prod >/dev/null 2>&1; then
  kubectl create secret generic academix-secrets -n academix-prod \
    --from-literal=db-username=academix \
    --from-literal=db-password="$(openssl rand -hex 16)" \
    --from-literal=broker-username=academix \
    --from-literal=broker-password="$(openssl rand -hex 16)" \
    --from-literal=signing-key="$(openssl rand -hex 32)"
fi
if ! kubectl get secret grafana-admin -n monitoring >/dev/null 2>&1; then
  kubectl create secret generic grafana-admin -n monitoring \
    --from-literal=admin-user=admin --from-literal=admin-password="$(openssl rand -base64 18)"
fi
SQL="$RAIZ/Practica7/Backend/sql"
for par in catalogo:01-catalogo credenciales:03-credenciales reservas:02-reservas; do
  kubectl create configmap "academix-sql-${par%%:*}" -n academix-prod \
    --from-file="${par#*:}.sql=$SQL/${par#*:}.sql" --dry-run=client -o yaml | kubectl apply -f -
done

paso "Aplicaciones en K3s (imágenes GHCR :$TAG)"
kubectl apply -k "$TMP/kubernetes"
kubectl rollout status statefulset/rabbitmq -n academix-prod --timeout=600s
for d in catalogo-service certificados-service reservas-service reservation-worker; do
  kubectl rollout status "deployment/$d" -n academix-prod --timeout=600s
done
# reservas-service no se reconecta solo a RabbitMQ: se reinicia ya con el broker listo.
kubectl rollout restart deploy/reservas-service deploy/reservation-worker -n academix-prod
kubectl rollout status deploy/reservas-service -n academix-prod --timeout=300s

paso "Prometheus + Grafana (chart $CHART_VERSION)"
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts >/dev/null 2>&1 || true
helm repo update prometheus-community >/dev/null
# El CRD ServiceMonitor lo instala el chart: va antes del apply -k de observability.
helm upgrade --install kube-prometheus-stack prometheus-community/kube-prometheus-stack \
  -n monitoring --version "$CHART_VERSION" -f "$TMP/observability/grafana-values.yaml" --wait --timeout 10m
kubectl apply -k "$TMP/observability"

paso "Entorno Dev en vm-development"
DEV_IP="$IP_DEV" "$AQUI/dev/deploy-dev.sh" "$TAG"

paso "Verificación (espera certificados TLS, hasta ~5 min)"
kubectl wait --for=condition=Ready certificate --all -n academix-prod --timeout=300s || true
kubectl wait --for=condition=Ready certificate --all -n monitoring --timeout=300s || true
FALLOS=0
comprobar() {
  local url="$1" code=000
  for i in $(seq 1 20); do
    code="$(curl -s -m10 -o /dev/null -w '%{http_code}' "$url" || true)"
    [ "$code" = 200 ] && break; sleep 15
  done
  echo "$code $url"; [ "$code" = 200 ] || FALLOS=$((FALLOS + 1))
}
for base in "https://academix.$IP_PROD.sslip.io" "https://$IP_DEV.sslip.io"; do
  comprobar "$base/reservas/api/salud"
  comprobar "$base/catalogo/api/talleres/salud"
  comprobar "$base/certificados/api/certificados/salud"
done
comprobar "https://grafana.academix.$IP_PROD.sslip.io/api/health"

echo
if [ "$IP_PROD" != "$IP_PROD_REPO" ] || [ "$IP_DEV" != "$IP_DEV_REPO" ]; then
  echo "AVISO: las IPs cambiaron respecto al repo. Actualiza:"
  echo "  - variable de la API en Vercel (frontend) -> https://academix.$IP_PROD.sslip.io"
  echo "  - IPs escritas en Practica10/deploy/** y README (para que el repo refleje la realidad)"
fi
[ "$FALLOS" -eq 0 ] && echo "LISTO: Práctica 10 reconstruida y verificada." || { echo "Hubo $FALLOS comprobaciones fallidas." >&2; exit 1; }
