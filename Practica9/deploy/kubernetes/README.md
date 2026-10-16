# Despliegue de Academix en K3s

Estos manifiestos describen el despliegue de producción de la práctica 9 en el namespace `academix-prod`. El procedimiento usa la VM `vm-production-k3s` y asume que Terraform y Ansible ya crearon la infraestructura y dejaron el nodo K3s en estado `Ready`.

## Componentes

- APIs: `catalogo-service`, `reservas-service` y `certificados-service`.
- Consumidor asíncrono: `reservation-worker`.
- Dependencias: RabbitMQ, Redis y tres bases PostgreSQL independientes.
- Entrada: Traefik, HTTPS y certificado ACME/Let's Encrypt.
- Volúmenes persistentes `local-path` para el broker, Redis y PostgreSQL.

Las rutas públicas actuales son:

| Servicio | URL base | Salud |
|---|---|---|
| Catálogo | `https://academix.34.123.206.113.sslip.io/catalogo` | `/api/talleres/salud` |
| Reservas | `https://academix.34.123.206.113.sslip.io/reservas` | `/api/salud` |
| Certificados | `https://academix.34.123.206.113.sslip.io/certificados` | `/api/certificados/salud` |

## Preparación y despliegue

Los siguientes comandos se ejecutan desde la raíz del repositorio, en PowerShell. `gcloud` debe estar autenticado y tener acceso SSH a la VM.

Si Ansible ya generó el kubeconfig local, selecciona ese contexto antes de ejecutar `kubectl`:

```powershell
$env:KUBECONFIG = "Practica9/infra/ansible/kubeconfig/k3s.yaml"
kubectl get nodes
```

Si el archivo aún no existe, ejecuta primero `ansible-playbook -i inventory.ini site.yml` desde `Practica9/infra/ansible`.

1. Construir las imágenes de los servicios desde el código fuente:

   ```powershell
   docker compose -f Practica7/docker-compose.yml -f Practica7/docker-compose.dev.yml build
   docker save -o academix-images.tar `
     academix/catalogo-service:2.0.0 `
     academix/reservas-service:2.0.0 `
     academix/certificados-service:2.0.0 `
     academix/reservation-worker:2.0.0
   ```

2. Copiar e importar las imágenes en containerd de K3s. Se usan imágenes locales porque los paquetes GHCR del repositorio son privados y el nodo no tiene credenciales de descarga:

   ```powershell
   gcloud compute scp .\academix-images.tar vm-production-k3s:/tmp/academix-images.tar `
     --zone=us-central1-a --project=yousac-202300396-2026
   gcloud compute ssh vm-production-k3s --zone=us-central1-a --project=yousac-202300396-2026 `
     --command="sudo k3s ctr images import /tmp/academix-images.tar"
   ```

   Después de confirmar la importación, se puede borrar el archivo local y el temporal de la VM.

3. Instalar cert-manager y esperar a que sus pods estén listos. El manifiesto de release está fijado para que la instalación sea reproducible:

   ```powershell
   kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.21.2/cert-manager.yaml
   kubectl wait --for=condition=Ready pod --all -n cert-manager --timeout=180s
   kubectl apply -f Practica9/deploy/kubernetes/cluster-issuer.yaml
   ```

4. Crear el namespace, el secreto y los ConfigMaps SQL. Sustituye los valores entre `<...>` por credenciales fuertes generadas para el entorno; no los escribas en archivos versionados, tickets ni mensajes. El secreto requiere las claves `db-username`, `db-password`, `broker-username`, `broker-password` y `signing-key`.

   ```powershell
   kubectl apply -f Practica9/deploy/kubernetes/namespace.yaml
   kubectl create secret generic academix-secrets -n academix-prod `
     --from-literal=db-username='<usuario-db>' `
     --from-literal=db-password='<contraseña-db>' `
     --from-literal=broker-username='<usuario-rabbitmq>' `
     --from-literal=broker-password='<contraseña-rabbitmq>' `
     --from-literal=signing-key='<clave-aleatoria-de-firma>'

   kubectl create configmap academix-sql-catalogo -n academix-prod `
     --from-file=01-catalogo.sql=Practica7/Backend/sql/01-catalogo.sql
   kubectl create configmap academix-sql-reservas -n academix-prod `
     --from-file=02-reservas.sql=Practica7/Backend/sql/02-reservas.sql
   kubectl create configmap academix-sql-credenciales -n academix-prod `
     --from-file=03-credenciales.sql=Practica7/Backend/sql/03-credenciales.sql
   ```

   Para actualizar un secreto o ConfigMap ya existente, agrega `--dry-run=client -o yaml | kubectl apply -f -` al comando `create`. PostgreSQL ejecuta los scripts de inicialización solo cuando el directorio de datos está vacío.

5. Aplicar los recursos de la aplicación y esperar el estado listo:

   ```powershell
   kubectl apply -k Practica9/deploy/kubernetes
   kubectl wait --for=condition=Ready pod --all -n academix-prod --timeout=600s
   kubectl get pods,services,ingress,pvc -n academix-prod
   kubectl wait --for=condition=Ready certificate/academix-prod-tls -n academix-prod --timeout=300s
   ```

## Configurar Vercel

En el proyecto `sa-practica7`, agrega estas variables para el entorno **Production** y luego crea un nuevo deployment de producción:

```text
NEXT_PUBLIC_API_CATALOGO_BASE=https://academix.34.123.206.113.sslip.io/catalogo
NEXT_PUBLIC_API_RESERVAS_BASE=https://academix.34.123.206.113.sslip.io/reservas
NEXT_PUBLIC_API_CERTIFICADOS_BASE=https://academix.34.123.206.113.sslip.io/certificados
```

Next.js incorpora las variables `NEXT_PUBLIC_*` al compilar el frontend; guardar las variables sin redeplegar no actualiza una versión ya construida. Las APIs limitan CORS a `https://sa-practica7.vercel.app`.

## Verificación

```powershell
curl.exe -i https://academix.34.123.206.113.sslip.io/catalogo/api/talleres/salud
curl.exe -i https://academix.34.123.206.113.sslip.io/reservas/api/salud
curl.exe -i https://academix.34.123.206.113.sslip.io/certificados/api/certificados/salud
kubectl exec -n academix-prod rabbitmq-0 -- rabbitmqctl list_queues name messages consumers
```

Si Terraform recrea la VM y cambia su IP pública, actualiza el hostname en `ingress.yaml`, vuelve a emitir el certificado y cambia las tres variables de Vercel. No ejecutes `terraform apply` sobre el estado actual sin revisar primero `terraform plan`: los metadatos SSH pueden proponer cambios sobre las VMs existentes.
