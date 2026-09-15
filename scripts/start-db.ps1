# Starts MariaDB (XAMPP) for TriVista GST.
# Runs detached (hidden window) so the DB keeps running after this script exits.
$db = Get-Process mysqld -ErrorAction SilentlyContinue
if ($db) {
  Write-Host "MariaDB already running (PID $($db.Id))"
} else {
  Start-Process -FilePath "H:\xampp\mysql\bin\mysqld.exe" -ArgumentList "--defaults-file=H:\xampp\mysql\bin\my.ini" -WindowStyle Hidden
  Start-Sleep -Seconds 5
  if (& "H:\xampp\mysql\bin\mysqladmin.exe" -u root ping 2>$null) { Write-Host "MariaDB started and alive" }
  else { Write-Host "MariaDB did not respond to ping - check H:\xampp\mysql\data for errors" }
}