# Práctica 10 — Despliegue Completo en K3s

**Academix Pass & CertiHub · Software Avanzado · Segundo Semestre 2026**

Este directorio contiene la definición declarativa del **entorno de Producción** sobre el clúster K3s (`vm-production-k3s`) en el namespace `academix-prod`.

El cambio central respecto a la Práctica 9 es el mecanismo de obtención de imágenes: antes se construían en la máquina de desarrollo y se importaban a mano en `containerd` (`imagePullPolicy: Never`). **Aquí los pods descargan las imágenes directamente del Container Registry (GHCR)** con `imagePullPolicy: Always`; no se ejecuta `docker build` dentro de K3s.

## Componentes

| Componente | Tipo de recurso | Imagen |
|---|---|---|
| `catalogo-service` | Deployment + ClusterIP | `ghcr.io/thanya-gate/academix/catalogo-service:3.0.0` |
| `reservas-service` (ticketing) | Deployment + ClusterIP | `ghcr.io/thanya-gate/academix/reservas-service:3.0.0` |
| `certificados-service` | Deployment + ClusterIP | `ghcr.io/thanya-gate/academix/certificados-service:3.0.0` |
| `reservation-worker` | Deployment | `ghcr.io/thanya-gate/academix/reservation-worker:3.0.0` |
| `rabbitmq` (broker) | StatefulSet + Service headless | `rabbitmq:3.13-management-alpine` |
| `redis` (caché) | StatefulSet + ClusterIP | `redis:7-alpine` |
| `postgres-{catalogo,reservas,credenciales}` | StatefulSet + ClusterIP | `postgres:16-alpine` |
| Ingress (`/catalogo`, `/reservas`, `/certificados`) | Ingress (Traefik + TLS) | — |

Todos los contenedores declaran `requests` y `limits` de CPU y memoria.

## Archivos

```
Practica10/deploy/kubernetes/
├── namespace.yaml                  # namespace academix-prod
├── configmap.yaml                  # variables comunes (TZ, NODE_ENV, CORS)
├── data.yaml                       # RabbitMQ, Redis y PostgreSQL (StatefulSets)
├── workloads.yaml                  # Deployments y Services de la aplicación
├── ingress.yaml                    # Certificate (cert-manager) + 3 Ingress
├── traefik-middlewares.yaml        # redirect-https y strip-prefix
├── cluster-issuer.yaml             # ClusterIssuer letsencrypt-prod (se aplica aparte)
└── kustomization.yaml              # orquesta todo y fija el tag de las imágenes
```

## Requisitos previos

- Clúster K3s con nodo `Ready` (creado por Terraform + Ansible de la Práctica 9).
- `kubectl` configurado (`$env:KUBECONFIG = "Practica9/infra/ansible/kubeconfig/k3s.yaml"`).
- `cert-manager` instalado y el `ClusterIssuer` aplicado.
- Imágenes publicadas en GHCR con la etiqueta indicada en `kustomization.yaml`
  (`ghcr.io/thanya-gate/academix/<servicio>:<tag>`). Los paquetes son **públicos**,
  así que K3s las descarga sin credenciales adicionales.

> **Nota sobre el tag:** se despliega la imagen **`3.0.0`** (publicada en GHCR). El tag Git de entrega (`V3.0.0` ya existe de una práctica anterior) lo define el equipo; si se publica otra versión, basta con cambiar `newTag` en `kustomization.yaml` (un solo lugar).

## Procedimiento

Todo se ejecuta desde la raíz del repositorio en PowerShell.

1. **Crear el namespace.** Los paquetes de GHCR son públicos, así que **no se necesita `imagePullSecret`**: K3s descarga las imágenes sin credenciales.

   ```powershell
   kubectl create namespace academix-prod --dry-run=client -o yaml | kubectl apply -f -
   ```

2. **Instalar cert-manager y el issuer** (si no están):

   ```powershell
   kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.21.2/cert-manager.yaml
   kubectl wait --for=condition=Ready pod --all -n cert-manager --timeout=180s
   kubectl apply -f Practica10/deploy/kubernetes/cluster-issuer.yaml
   ```

3. **Crear el secreto de la aplicación y los ConfigMaps SQL.** Las credenciales no se versionan:

   ```powershell
   kubectl create secret generic academix-secrets -n academix-prod `
     --from-literal=db-username='<usuario-db>' `
     --from-literal=db-password='<contraseña-db>' `
     --from-literal=broker-username='<usuario-rabbitmq>' `
     --from-literal=broker-password='<contraseña-rabbitmq>' `
     --from-literal=signing-key='<clave-de-firma>'

   kubectl create configmap academix-sql-catalogo -n academix-prod `
     --from-file=01-catalogo.sql=Practica7/Backend/sql/01-catalogo.sql
   kubectl create configmap academix-sql-reservas -n academix-prod `
     --from-file=02-reservas.sql=Practica7/Backend/sql/02-reservas.sql
   kubectl create configmap academix-sql-credenciales -n academix-prod `
     --from-file=03-credenciales.sql=Practica7/Backend/sql/03-credenciales.sql
   ```

4. **Aplicar el despliegue** (Kustomize inyecta el tag de `kustomization.yaml` (hoy `3.0.0`)):

   ```powershell
   kubectl apply -k Practica10/deploy/kubernetes
   kubectl rollout status deployment/reservas-service -n academix-prod --timeout=600s
   kubectl get pods,services,ingress -n academix-prod
   ```

5. **Verificar que las imágenes vinieron del registry.** Ningún pod debe quedar en `ErrImagePull`/`ImagePullBackOff` y la columna `IMAGE` debe mostrar el tag configurado:

   ```powershell
   kubectl get pods -n academix-prod -o custom-columns="POD:.metadata.name,IMAGE:.spec.containers[*].image,STATUS:.status.phase"
   ```

6. **Probar los endpoints públicos** (el host depende de la IP pública de la VM):

   ```powershell
   curl.exe -i https://academix.<IP>.sslip.io/catalogo/api/talleres/salud
   curl.exe -i https://academix.<IP>.sslip.io/reservas/api/salud
   curl.exe -i https://academix.<IP>.sslip.io/certificados/api/certificados/salud
   ```

## Qué demuestra cada requisito

- **Deployments con límites:** `workloads.yaml` y `data.yaml` declaran `resources.requests/limits`.
- **Services ClusterIP:** todos los `Service` de aplicación usan `type: ClusterIP`; la comunicación es por DNS interno (`catalogo-service:50061`, `rabbitmq:5672`, etc.).
- **Ingress Controller:** `ingress.yaml` expone `/reservas` y `/certificados` (verificación) además de `/catalogo`, con redirección a HTTPS y certificado Let's Encrypt.
- **ConfigMaps y Secrets:** configuración común en `academix-config-comun`, credenciales en `academix-secrets`; el SQL se monta desde ConfigMaps. Nada de credenciales en los manifiestos versionados.
- **Container Registry:** `imagePullPolicy: Always`; las imágenes provienen de GHCR (paquetes públicos) y nunca se compilan dentro del clúster.
