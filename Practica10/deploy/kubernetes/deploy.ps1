<#
.SYNOPSIS
  Despliega Academix en el clúster K3s desde el Container Registry (GHCR).

.DESCRIPTION
  Actualiza el newTag de las imágenes en kustomization.yaml, aplica el
  despliegue con kubectl apply -k y espera a que los Deployments terminen
  su rolling update. Los pods descargan las imágenes desde GHCR.

.PARAMETER Tag
  Etiqueta de las imágenes en GHCR. Valor por defecto: 4.0.0.
  Al cierre de la práctica se usa 4.0.0 (tras publicar el tag V4.0.0 en GitHub).

.PARAMETER Kustomization
  Ruta al kustomization.yaml. Por defecto la del paquete.

.EXAMPLE
  .\deploy.ps1
  .\deploy.ps1 -Tag 4.0.0
#>
param(
    [string]$Tag = "4.0.0",
    [string]$Kustomization = (Join-Path $PSScriptRoot "kustomization.yaml"),
    [string]$Namespace = "academix-prod"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command kubectl -ErrorAction SilentlyContinue)) {
    throw "kubectl no esta disponible en PATH."
}
if (-not (Test-Path -LiteralPath $Kustomization)) {
    throw "No se encontro kustomization.yaml en: $Kustomization"
}

Write-Host "==> Tag de imagen: $Tag"

$content = Get-Content -LiteralPath $Kustomization -Raw
$updated = [regex]::Replace($content, 'newTag: ".*?"', 'newTag: "' + $Tag + '"')
if ($updated -eq $content) {
    Write-Host "==> El tag ya era $Tag; se omite la reescritura."
} else {
    Set-Content -LiteralPath $Kustomization -Value $updated -NoNewline
    Write-Host "==> newTag actualizado a $Tag en kustomization.yaml"
}

Write-Host "==> Aplicando despliegue (kubectl apply -k) ..."
kubectl apply -k $PSScriptRoot
if ($LASTEXITCODE -ne 0) { throw "kubectl apply fallo." }

$deployments = @("catalogo-service", "certificados-service", "reservas-service", "reservation-worker")
foreach ($name in $deployments) {
    Write-Host "==> Esperando rollout de $name ..."
    kubectl rollout status "deployment/$name" -n $Namespace --timeout=600s
    if ($LASTEXITCODE -ne 0) { throw "El rollout de $name no termino." }
}

Write-Host "==> Pods desplegados (imagen + estado):"
kubectl get pods -n $Namespace -o custom-columns="POD:.metadata.name,IMAGE:.spec.containers[*].image,STATUS:.status.phase"

Write-Host "==> Despliegue completado con tag $Tag"