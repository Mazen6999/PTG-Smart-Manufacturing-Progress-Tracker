# Native Windows PowerShell HTTP listener serving static content and saving updates

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$pidPath = Join-Path $scriptDir "server.pid"

# Stop old server instance if PID file exists
if (Test-Path $pidPath) {
    try {
        $oldPid = Get-Content $pidPath
        Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 400
    } catch {}
}

$port = 8000

# Release port 8000 if in use (skip kernel System PID 4)
try {
    $portConn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($portConn -and $portConn.OwningProcess -ne 4) {
        Stop-Process -Id $portConn.OwningProcess -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 450
    }
} catch {}

# Save current PID
$PID | Out-File -FilePath $pidPath -Encoding utf8

$listener = New-Object System.Net.HttpListener
$isWildcard = $false

try {
    # Attempt to bind to wildcard (all network interfaces, e.g. for access from other devices)
    $listener.Prefixes.Add("http://*:$port/")
    $listener.Start()
    $isWildcard = $true
} catch {
    # Wildcard bind failed (likely due to insufficient privileges or port conflict).
    # Re-create the listener and fall back to localhost only
    $listener = New-Object System.Net.HttpListener
    $listener.Prefixes.Add("http://localhost:$port/")
    try {
        $listener.Start()
    } catch {
        Write-Host "=========================================================="
        Write-Host "  ERROR: Could not start the server on port $port."
        Write-Host "  Details: $_"
        Write-Host "=========================================================="
        $pidPath = Join-Path $scriptDir "server.pid"
        if (Test-Path $pidPath) { Remove-Item $pidPath -Force -ErrorAction SilentlyContinue }
        exit 1
    }
}

if ($isWildcard) {
    # Get local active IP addresses to display to the user for easy access
    $ipAddresses = [System.Net.Dns]::GetHostEntry([System.Net.Dns]::GetHostName()).AddressList | 
        Where-Object { $_.AddressFamily -eq 'InterNetwork' -and $_.IPAddressToString -notlike '169.254.*' } | 
        ForEach-Object { $_.IPAddressToString }
    
    Write-Host "=========================================================="
    Write-Host "  Prometeon Progress Tracker Server is running!"
    Write-Host "  Local Address:   http://localhost:$port"
    foreach ($ip in $ipAddresses) {
        Write-Host "  Network Address: http://$($ip):$port"
    }
    Write-Host "=========================================================="
    Write-Host "  * Close this window or press Ctrl+C to stop the server."
    Write-Host ""
} else {
    Write-Host "=========================================================="
    Write-Host "  Prometeon Progress Tracker Server is running!"
    Write-Host "  Local Address:  http://localhost:$port"
    Write-Host "=========================================================="
    Write-Host "  NOTICE: Running in local-only mode (Non-Admin)."
    Write-Host "  To allow other devices to access this tracker via your IP:"
    Write-Host "  1. Close this window."
    Write-Host "  2. Right-click 'run_static_web.bat' and select 'Run as administrator'."
    Write-Host "  "
    Write-Host "  Or, run this command ONCE in an Administrator PowerShell/CMD window:"
    Write-Host "  netsh http add urlacl url=http://*:$port/ user=Everyone"
    Write-Host "  (If your Windows is non-English, use: netsh http add urlacl url=http://*:$port/ sddl=D:(A;;GX;;;WD))"
    Write-Host "=========================================================="
    Write-Host "  * Close this window or press Ctrl+C to stop the server."
    Write-Host ""
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Main server run loop
while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        $path = $request.Url.LocalPath
        if ($path -eq "/") { $path = "/index.html" }

        # CORS Headers for Localhost
        $response.Headers.Add("Access-Control-Allow-Origin", "*")
        $response.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        $response.Headers.Add("Access-Control-Allow-Headers", "Content-Type")

        # Handle Preflight OPTIONS request
        if ($request.HttpMethod -eq "OPTIONS") {
            $response.StatusCode = 200
            $response.Close()
            continue
        }

        # Intercept database.json request to dynamically merge multi-file data
        if ($path -eq "/database.json") {
            $projectsPath = Join-Path $scriptDir "projects.json"
            $oldDbPath = Join-Path $scriptDir "database.json"

            # 1. Read Projects and Steps
            $projects = @()
            $steps = @()
            if (Test-Path $projectsPath) {
                $projData = Get-Content $projectsPath -Raw | ConvertFrom-Json
                $projects = $projData.projects
                $steps = $projData.steps
            } elseif (Test-Path $oldDbPath) {
                # Fallback to old unified database.json
                $dbData = Get-Content $oldDbPath -Raw | ConvertFrom-Json
                $projects = $dbData.projects
                $steps = $dbData.steps
            }

            # 2. Scan and merge all user-specific log files
            $logs = @()
            $logFiles = Get-ChildItem $scriptDir -Filter "logs_*.json"
            foreach ($file in $logFiles) {
                try {
                    $userLogs = Get-Content $file.FullName -Raw | ConvertFrom-Json
                    if ($userLogs) {
                        $logs += @($userLogs)
                    }
                } catch {}
            }

            # 3. Respond with merged dataset
            $unifiedObj = @{
                projects = $projects
                steps = $steps
                logs = $logs
            }
            $jsonResponse = $unifiedObj | ConvertTo-Json -Depth 100 -Compress
            $buffer = [System.Text.Encoding]::UTF8.GetBytes($jsonResponse)

            $response.ContentType = "application/json; charset=utf-8"
            $response.ContentLength64 = $buffer.Length
            $response.StatusCode = 200
            $response.OutputStream.Write($buffer, 0, $buffer.Length)
            $response.Close()
            continue
        }

        # API Save Endpoint (Splits state to projects.json + logs_USERNAME.json)
        if ($request.HttpMethod -eq "POST" -and $path -eq "/api/save") {
            $reader = New-Object System.IO.StreamReader($request.InputStream, [System.Text.Encoding]::UTF8)
            $json = $reader.ReadToEnd()
            $reader.Close()

            $data = $json | ConvertFrom-Json
            
            # A. Save Projects & Steps
            $projectsObj = @{
                projects = $data.projects
                steps = $data.steps
            }
            $projectsJson = $projectsObj | ConvertTo-Json -Depth 100 -Compress
            $projectsPath = Join-Path $scriptDir "projects.json"
            [System.IO.File]::WriteAllText($projectsPath, $projectsJson, [System.Text.Encoding]::UTF8)

            # B. Save Logs (grouped by sanitized engineer name)
            $logsList = @($data.logs)
            $writtenLogFiles = @()

            if ($logsList.Count -gt 0) {
                $groupedLogs = $logsList | Group-Object -Property engineer
                foreach ($group in $groupedLogs) {
                    $safeName = $group.Name -replace '[^a-zA-Z0-9]', ''
                    if (-not $safeName) { $safeName = "Unknown" }
                    $logFileName = "logs_$safeName.json"
                    $logFilePath = Join-Path $scriptDir $logFileName
                    $writtenLogFiles += $logFileName

                    $engineerLogsJson = $group.Group | ConvertTo-Json -Depth 100 -Compress
                    [System.IO.File]::WriteAllText($logFilePath, $engineerLogsJson, [System.Text.Encoding]::UTF8)
                }
            }

            # C. Clean up any logs_*.json files that are no longer referenced
            $allLogFiles = Get-ChildItem $scriptDir -Filter "logs_*.json"
            foreach ($file in $allLogFiles) {
                if ($writtenLogFiles -notcontains $file.Name) {
                    Remove-Item $file.FullName -Force -ErrorAction SilentlyContinue
                }
            }

            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Database successfully saved (split projects + engineer log files)."

            $response.StatusCode = 200
            $buffer = [System.Text.Encoding]::UTF8.GetBytes('{"status":"success"}')
            $response.ContentType = "application/json; charset=utf-8"
            $response.ContentLength64 = $buffer.Length
            $response.OutputStream.Write($buffer, 0, $buffer.Length)
            $response.Close()
            continue
        }

        # Resolve Static File from current directory
        $relativePath = $path.TrimStart('/')
        $filePath = Join-Path $scriptDir $relativePath

        if (Test-Path $filePath -PathType Leaf) {
            $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
            $mime = switch ($ext) {
                ".html" { "text/html; charset=utf-8" }
                ".css" { "text/css; charset=utf-8" }
                ".js" { "application/javascript; charset=utf-8" }
                ".json" { "application/json; charset=utf-8" }
                ".png" { "image/png" }
                ".wasm" { "application/wasm" }
                default { "application/octet-stream" }
            }

            $buffer = [System.IO.File]::ReadAllBytes($filePath)
            $response.ContentType = $mime
            $response.ContentLength64 = $buffer.Length
            $response.StatusCode = 200
            $response.OutputStream.Write($buffer, 0, $buffer.Length)
        } else {
            $response.StatusCode = 404
            $buffer = [System.Text.Encoding]::UTF8.GetBytes("File Not Found: $path")
            $response.ContentLength64 = $buffer.Length
            $response.OutputStream.Write($buffer, 0, $buffer.Length)
        }
        $response.Close()
    } catch {
        $errMsg = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] ERROR handling request: $_`n$($_.ScriptStackTrace)`n"
        Write-Host $errMsg -ForegroundColor Red
        try {
            $errMsg | Out-File -FilePath (Join-Path $scriptDir "server_error.log") -Append -Encoding utf8
        } catch {}

        try {
            if ($null -ne $context -and $null -ne $context.Response) {
                $response = $context.Response
                $response.StatusCode = 500
                $buffer = [System.Text.Encoding]::UTF8.GetBytes("500 Internal Server Error: $_")
                $response.ContentType = "text/plain; charset=utf-8"
                $response.ContentLength64 = $buffer.Length
                $response.OutputStream.Write($buffer, 0, $buffer.Length)
                $response.Close()
            }
        } catch {}
    }
}
