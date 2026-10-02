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
  `VM_DEPLOY_ENABLED` vale `true`. Copia el Compose y los scripts SQL, descarga
  el tag de ese commit y ejecuta `docker compose up -d`; la VM no construye
  imágenes.

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
| Secret | `GHCR_USERNAME` | Usuario de GitHub dueño del token de lectura del Registry. |
| Secret | `GHCR_READ_TOKEN` | Token de solo lectura de paquetes (`read:packages`) autorizado para estas imágenes. |

La ejecución de GitHub Actions necesita permiso para publicar paquetes en el
repositorio. El workflow ya otorga `packages: write` al job que publica las
imágenes y usa `GITHUB_TOKEN`; la VM usa el token separado de lectura.

## Preparar la VM

1. Instalar Docker Engine y el plugin `docker compose`; permitir que `VM_USER`
   ejecute Docker sin interacción.
2. Crear `VM_DEPLOY_PATH` y colocar allí un `.env` propio de la VM. El archivo
   versionado [.env.vm.example](.env.vm.example) es una plantilla: sustituir
   las contraseñas, la clave de firma y el origen CORS de Vercel antes del
   primer despliegue.
3. Abrir SSH y únicamente los puertos HTTP/API que se hayan decidido publicar.
   La configuración actual de Compose publica también puertos de bases de
   datos, Redis y administración de RabbitMQ; restringirlos con firewall o
   ajustar su exposición antes de poner la VM en Internet.
4. Configurar DNS y TLS para el backend. Vercel sirve sobre HTTPS y el
   navegador no podrá consumir endpoints del backend publicados solamente por
   HTTP. Luego, colocar el origen exacto de Vercel en `CORS_ORIGENES`.
5. Verificar que el usuario de despliegue pueda acceder a GHCR con el token de
   solo lectura. El workflow detiene el despliegue si falta el `.env` o si
   `docker compose config` no puede resolver la configuración.

El despliegue requiere que Compose y `.env` existan en la VM antes de activar
`VM_DEPLOY_ENABLED`. Las credenciales de producción se mantienen únicamente
en el `.env` remoto y en los secretos de GitHub; no deben añadirse al
repositorio.
