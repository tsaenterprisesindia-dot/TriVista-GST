# Stops the standalone MariaDB for TriVista GST.
Get-Process mariadbd -ErrorAction SilentlyContinue | Stop-Process -Force