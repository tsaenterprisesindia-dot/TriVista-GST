# Starts the standalone MariaDB for TriVista GST (no XAMPP required).
# Runs detached (hidden window) so the DB keeps running after this script exits.
$db = Get-Process mariadbd -ErrorAction SilentlyContinue
if ($db) {
  Write-Host "MariaDB already running (PID $($db.Id))"
} else {
  Start-Process -FilePath "I:\mysql\bin\mariadbd.exe" -ArgumentList "--defaults-file=I:\mysql\my.ini" -WindowStyle Hidden
  Start-Sleep -Seconds 5
  if (& "I:\mysql\bin\mysqladmin.exe" -u root ping 2>$null) { Write-Host "MariaDB started and alive" }
  else { Write-Host "MariaDB did not respond to ping - check I:\mysql\data for errors" }
}