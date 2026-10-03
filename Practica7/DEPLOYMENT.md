# CI/CD y despliegue de la práctica 8

El workflow [practica8-ci-cd.yml](../.github/workflows/practica8-ci-cd.yml)
valida los cambios y automatiza la publicación de las imágenes de backend.
El frontend no se convierte en imagen: Vercel conserva su propio despliegue.

## Flujo

- En un pull request hacia `develop`, ejecuta pruebas de Go, TypeScript,
  Python y frontend, además de compilar esos proyectos.
- En un push a `develop`, tras aprobarse todas las validaciones, construye y
  publica las cuatro imágenes en GHCR con el tag `2.0.0-<commit>` y el SHA
  completo.
- En un tag Git como `V2.0.0`, publica también la versión formal `2.0.0`.
- El job de despliegue a la VM se habilita cuando la variable de repositorio
  `VM_DEPLOY_ENABLED` vale `true`. Copia Compose, Caddyfile y scripts SQL,
  descarga el tag de ese commit y ejecuta `docker compose up -d`; la VM no
  construye imágenes.
- El job usa el `GITHUB_TOKEN` efímero con permiso `packages: read` para que la
  VM descargue imágenes; no necesita un PAT permanente de GHCR.
- La VM comparte recursos con otra aplicación. Los puertos de Academix se
  ligan a `127.0.0.1`; un gateway Caddy propio publica HTTPS en el puerto 443.

## Configuración de GitHub

Crear estas variables y secretos en **Settings → Secrets and variables →
Actions**:

| Tipo | Nombre | Valor |
|---|---|---|
| Variable | `VM_DEPLOY_ENABLED` | `true` cuando la VM esté lista; mientras tanto, dejarla sin definir o en `false`. |
| Variable opcional | `VM_SSH_PORT` | Puerto SSH de la VM; si se omite, el workflow usa `22`. |
| Secret | `VM_HOST` | IP pública o nombre DNS de la VM. |
| Secret | `VM_USER` | Usuario SSH que puede ejecutar Docker Compose. |
| Secret | `VM_DEPLOY_PATH` | Ruta absoluta en la VM, sin espacios; por ejemplo `/opt/academix-pass`. |
| Secret | `VM_SSH_PRIVATE_KEY` | Llave privada SSH de despliegue. |
| Secret | `VM_SSH_KNOWN_HOSTS` | Clave de host de la VM, verificada y en formato `known_hosts`. |

La ejecución de GitHub Actions necesita permiso para publicar paquetes en el
repositorio. El workflow otorga `packages: write` al job que publica las
imágenes y `packages: read` al job de despliegue; ambos usan `GITHUB_TOKEN`.

## Preparar la VM

1. Crear `VM_DEPLOY_PATH` y permitir que `VM_USER` ejecute Docker sin
   interacción.
2. Colocar allí un `.env` propio de la VM. El archivo versionado
   [.env.vm.example](.env.vm.example) es una plantilla con puertos aislados y
   ligados a localhost; sustituir contraseñas y clave de firma.
3. La VM ya usa el puerto 80 para YouSAC. El gateway de Academix usa `host`
   networking y escucha únicamente en 443, con TLS-ALPN para validar el
   certificado sin modificar ni reiniciar el Caddy de YouSAC.
4. El gateway sirve las APIs por HTTPS bajo
   `https://136.119.139.125.sslip.io/{catalogo,reservas,certificados}`. El
   subdominio `sslip.io` resuelve a la IP actual de la VM; si cambia, actualizar
   `Caddyfile.vm`, las variables de Vercel y volver a desplegar.
5. En Vercel configurar para Production:
   `NEXT_PUBLIC_API_CATALOGO_BASE=https://136.119.139.125.sslip.io/catalogo`,
   `NEXT_PUBLIC_API_RESERVAS_BASE=https://136.119.139.125.sslip.io/reservas` y
   `NEXT_PUBLIC_API_CERTIFICADOS_BASE=https://136.119.139.125.sslip.io/certificados`.
   Esas variables se incorporan al frontend durante el build.
6. Publicar por firewall HTTP/HTTPS únicamente en 80/443 para el tráfico de la
   aplicación. PostgreSQL, Redis, RabbitMQ y las APIs quedan ligados a
   localhost. SSH se necesita para el despliegue y la administración; limitar
   su origen según el acceso que use el equipo.

El despliegue requiere que Compose y `.env` existan en la VM antes de activar
`VM_DEPLOY_ENABLED`. Las credenciales se mantienen únicamente en el `.env`
remoto y la llave privada en los secretos de GitHub; no deben añadirse al
repositorio.
