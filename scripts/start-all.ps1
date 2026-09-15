# One-command dev startup: database + API + frontend.
$db = Get-Process mysqld -ErrorAction SilentlyContinue
if (-not $db) { Start-Process -FilePath "H:\xampp\mysql\bin\mysqld.exe" -ArgumentList "--defaults-file=H:\xampp\mysql\bin\my.ini" -WindowStyle Hidden; Write-Host "DB started" }
$api = Get-Process node -ErrorAction SilentlyContinue
if (-not $api) { Start-Process -FilePath "node" -ArgumentList "src/server.js" -WorkingDirectory "H:\TriveniGST\backend" -WindowStyle Hidden; Write-Host "API started (http://localhost:5000)" }
$fe = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue
if (-not $fe) { Start-Process -FilePath "node" -ArgumentList "node_modules/vite/bin/vite.js" -WorkingDirectory "H:\TriveniGST\frontend" -WindowStyle Hidden; Write-Host "Frontend started (http://localhost:5173)" }