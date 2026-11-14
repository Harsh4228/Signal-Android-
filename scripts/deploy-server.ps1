# Puts the latest pushed code (main branch on GitHub) live on the Oracle server.
#
#   powershell -ExecutionPolicy Bypass -File scripts\deploy-server.ps1
#
# Push to BOTH GitHub repos first: the server pulls from Harsh4228/Signal-Android-.
param([string]$Server = 'root@189.72.153.171')
$ErrorActionPreference = 'Stop'

ssh $Server 'cd ~/meetme && git pull -q --ff-only && cd infra && sudo docker compose up -d --build server && sleep 5 && sudo docker compose ps server && sudo docker compose logs --tail 15 server'
if ($LASTEXITCODE -ne 0) { throw 'Deploy failed: read the error above' }

$health = Invoke-WebRequest -UseBasicParsing 'https://chat.cellbe.in/v1/config'
Write-Host ''
Write-Host "Server is live (https://chat.cellbe.in answered $($health.StatusCode))"
