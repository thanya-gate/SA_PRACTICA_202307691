# Academix · Observabilidad (Prometheus + Grafana sobre K3s)

Monitoreo y dashboards para la Práctica 10. Cubre la sección de
**Observabilidad** del documento: Prometheus scrapea métricas de RabbitMQ
(plugin `rabbitmq_prometheus`) y de Kubernetes, y Grafana muestra dos
dashboards:

| Dashboard | Qué mide |
|---|---|
| Academix · Infraestructura | CPU/memoria de pods, nodos listos, pods por fase, tráfico de red |
| Academix · Negocio y Colas | Longitud de cola de solicitudes, tasas de publicación/consumo, tickets emitidos (acumulado) |

> **Reparto de la práctica (3 personas):**
> - **Prometheus (hecho y verificado):** stack `kube-prometheus-stack` instalado
>   en `monitoring` (Grafana y Alertmanager deshabilitados), `ServiceMonitor
>   academix-rabbitmq` aplicado, targets `rabbitmq`, `node-exporter` y
>   `kube-state-metrics` en `up`, consultas de colas/CPU/nodos respondiendo.
> - **Grafana (pendiente, compañero):** habilitar Grafana en el stack y aplicar
>   `kubectl apply -k` (dashboards + Ingress) con este paquete.

## 1. Instalar el stack (una sola vez)

Se usa `kube-prometheus-stack` vía Helm, desde la máquina administrativa con el
`kubeconfig` apuntando al clúster K3s.

```powershell
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update
helm install kube-prometheus-stack prometheus-community/kube-prometheus-stack `
  --namespace monitoring --create-namespace `
  --set grafana.enabled=false `
  --set alertmanager.enabled=false
```

Incluye Prometheus, `node-exporter`, `kube-state-metrics` y el operador.
*(El stack ya está instalado así en el clúster.)*

> **Para la parte de Grafana:** actualizar con
> `helm upgrade kube-prometheus-stack prometheus-community/kube-prometheus-stack -n monitoring --set grafana.enabled=true --set grafana.adminPassword="admin"`
> y aplicar `kubectl apply -k .\Practica10\deploy\observability` para importar
> los 2 dashboards (etiqueta `grafana_dashboard: "1"`) y el Ingress público
> `grafana.academix.<IP>.sslip.io`.

## 2. Aplicar el ServiceMonitor (ya hecho)

```powershell
kubectl apply -k .\Practica10\deploy\observability
```

Solo aplica `rabbitmq-servicemonitor.yaml` ahora; los `grafana-dashboard-*.yaml`,
`grafana-ingress.yaml` y `grafana-middleware.yaml` se aplican en la parte de
Grafana (son seguros, pero sin Grafana no producen efecto). El Service
`rabbitmq` debe tener la label `app.kubernetes.io/name: rabbitmq` (ya añadida
en `deploy/kubernetes/data.yaml`) para que el ServiceMonitor lo seleccione.

## 3. Verificar

```powershell
kubectl get servicemonitors -n monitoring
# Targets esperados en Prometheus (Status → Targets):
#   rabbitmq           up   (métricas del broker, :15692/metrics)
#   node-exporter      up   (recursos del nodo K3s)
#   kube-state-metrics up   (estado de pods/nodos)
kubectl port-forward svc/kube-prometheus-stack-prometheus -n monitoring 9090:9090
# → http://localhost:9090
```

Métricas relevantes del broker (RabbitMQ 3.13, plugin `rabbitmq_prometheus`):

| Métrica | Qué mide |
|---|---|
| `rabbitmq_queue_messages{queue="academix.reservas.solicitudes"}` | Longitud de la cola de solicitudes |
| `rate(rabbitmq_channel_messages_published_total[1m])` | Tasa de publicación (tickets emitidos/s) |
| `rate(rabbitmq_channel_messages_acked_total[1m])` | Tasa de consumo de los workers |
| `rabbitmq_queue_messages_unacked` | Mensajes sin acuse (backlog en consumidores) |

## 4. Cuándo se actualiza el host

Si se recrea la VM y cambia la IP pública, actualizar `grafana.academix.<IP>.sslip.io`
en `grafana-ingress.yaml` (host, `dnsNames` y regla) y en los accesos del README.