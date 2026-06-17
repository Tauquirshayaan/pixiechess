# ════════════════════════════════════════════════════════════════════════════
#  Pixie Chess — Windows Deploy Script (PowerShell)
#  Packages and uploads the project to your GCP VM.
#
#  USAGE (from PowerShell in G:\Pixiechessbot\):
#    .\pixiechess-server\deploy-vm.ps1 -VmName YOUR_VM_NAME -Zone us-central1-a
#
#  FIRST TIME: run with -FirstTime flag to trigger full vm-setup.sh
#    .\pixiechess-server\deploy-vm.ps1 -VmName YOUR_VM_NAME -Zone us-central1-a -FirstTime
# ════════════════════════════════════════════════════════════════════════════
param(
    [Parameter(Mandatory=$true)]
    [string]$VmName,

    [string]$Zone = "us-central1-a",

    # Run a full clean of the old deployment before setting up
    [switch]$CleanFirst = $false,

    # Trigger full vm-setup.sh instead of fast vm-update.sh
    [switch]$FirstTime = $false
)

$ErrorActionPreference = "Stop"
$DEPLOY_DIR = "/opt/pixiechess"

Write-Host ""
Write-Host "--------------------------------------------------------" -ForegroundColor Cyan
Write-Host "  Pixie Chess -> GCP VM Deploy                          " -ForegroundColor Cyan
Write-Host "  VM: $VmName  Zone: $Zone" -ForegroundColor Cyan
Write-Host "--------------------------------------------------------" -ForegroundColor Cyan

# ── Step 1: Build frontend locally (faster on Windows than on VM) ─────────
Write-Host "`n▶  [1/4] Building frontend..." -ForegroundColor Yellow
Set-Location "G:\Pixiechessbot\pixiechess-bot"
npm run build
Write-Host "   ✅ Frontend built" -ForegroundColor Green

Set-Location "G:\Pixiechessbot"

# ── Step 2: Upload clean script and run it if requested ──────────────────
if ($CleanFirst -or $FirstTime) {
    Write-Host "`n▶  [2/5] Uploading clean script..." -ForegroundColor Yellow
    gcloud compute scp --zone=$Zone `
        "G:\Pixiechessbot\pixiechess-server\scripts\vm-clean.sh" `
        "${VmName}:~/vm-clean.sh"
    
    Write-Host "   Running vm-clean.sh to remove old deployment..." -ForegroundColor Yellow
    gcloud compute ssh $VmName --zone=$Zone -- "sudo bash ~/vm-clean.sh"
    Write-Host "   ✅ Old deployment removed" -ForegroundColor Green
} else {
    Write-Host "`n▶  [2/5] Skipping clean (use -CleanFirst to wipe old deployment)" -ForegroundColor Gray
}

# ── Step 3: Package the project locally (excluding node_modules) ────────
Write-Host "`n▶  [3/6] Packaging project into ZIP..." -ForegroundColor Yellow

# Create a clean zip using PowerShell
$zipFile = "G:\Pixiechessbot\DeployPackage.zip"
if (Test-Path $zipFile) { Remove-Item -Force $zipFile }

# Only zip the necessary source folders
$foldersToZip = @("pixiechess-bot", "pixiechess-server", "pixie-engine-cpp", "nnue")
$tempDir = "G:\Pixiechessbot\_temp_deploy"
if (Test-Path $tempDir) { Remove-Item -Recurse -Force $tempDir }
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null

foreach ($folder in $foldersToZip) {
    Copy-Item -Recurse -Path "G:\Pixiechessbot\$folder" -Destination $tempDir
    # Remove node_modules, build artifacts, etc from the staging area
    Get-ChildItem -Path "$tempDir\$folder" -Recurse -Include "node_modules", ".git", ".turbo", "build", "dist" -Directory | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
}

Compress-Archive -Path "$tempDir\*" -DestinationPath $zipFile -Force
Remove-Item -Recurse -Force $tempDir
Write-Host "   ✅ Packaged source code to DeployPackage.zip" -ForegroundColor Green

# ── Step 4: Upload and Extract ────────────────────────────────────────────
Write-Host "`n▶  [4/6] Uploading to VM..." -ForegroundColor Yellow

# Create remote directory
gcloud compute ssh $VmName --zone=$Zone -- "sudo mkdir -p $DEPLOY_DIR && sudo chown `$USER:`$USER $DEPLOY_DIR"

# Upload ZIP
gcloud compute scp --zone=$Zone $zipFile "${VmName}:${DEPLOY_DIR}/DeployPackage.zip"

# Unzip on VM
gcloud compute ssh $VmName --zone=$Zone -- "cd $DEPLOY_DIR && sudo apt-get install -y unzip && unzip -q -o DeployPackage.zip && rm DeployPackage.zip"

Write-Host "   ✅ Files uploaded and extracted" -ForegroundColor Green

# ── Step 5: Upload NNUE weights ───────────────────────────────────────────
Write-Host "`n▶  [5/6] Uploading NNUE weights..." -ForegroundColor Yellow
gcloud compute scp --zone=$Zone `
    "G:\Pixiechessbot\pixiechess-server\src\engine\bin\pixiechess.nnue" `
    "${VmName}:${DEPLOY_DIR}/pixiechess-server/src/engine/bin/pixiechess.nnue"
Write-Host "   ✅ NNUE weights uploaded" -ForegroundColor Green

# ── Step 6: Run setup or update on VM ─────────────────────────────────────
Write-Host "`n▶  [6/6] Running remote setup..." -ForegroundColor Yellow

if ($FirstTime -or $CleanFirst) {
    Write-Host "   Running FULL setup (vm-setup.sh)..." -ForegroundColor Gray
    gcloud compute ssh $VmName --zone=$Zone -- `
        "chmod +x $DEPLOY_DIR/pixiechess-server/scripts/vm-setup.sh && sudo bash $DEPLOY_DIR/pixiechess-server/scripts/vm-setup.sh"
} else {
    Write-Host "   Running fast update (vm-update.sh)..." -ForegroundColor Gray
    gcloud compute ssh $VmName --zone=$Zone -- `
        "sudo bash $DEPLOY_DIR/pixiechess-server/scripts/vm-update.sh"
}

Write-Host ""
Write-Host "--------------------------------------------------------" -ForegroundColor Green
Write-Host "  Deploy complete!" -ForegroundColor Green

$ip = gcloud compute instances describe $VmName --zone=$Zone --format="value(networkInterfaces[0].accessConfigs[0].natIP)"
Write-Host "  URL: http://$ip" -ForegroundColor Green
Write-Host "--------------------------------------------------------" -ForegroundColor Green
