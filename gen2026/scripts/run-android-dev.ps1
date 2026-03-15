param(
  [string]$ShortRoot = "C:\g26",
  [int]$Port = 8083
)

$ErrorActionPreference = "Stop"

function Get-LanIpAddress {
  $candidates = Get-NetIPAddress -AddressFamily IPv4 | Where-Object {
    $_.IPAddress -match '^(192\.168|10\.|172\.(1[6-9]|2\d|3[0-1]))\.' -and
    $_.IPAddress -notlike '169.254.*' -and
    $_.InterfaceAlias -notmatch 'vEthernet|WSL|VirtualBox|Hyper-V|Loopback'
  }

  if (-not $candidates) {
    throw "Could not determine a LAN IPv4 address for Expo."
  }

  return ($candidates | Select-Object -First 1 -ExpandProperty IPAddress)
}

function Invoke-RobocopySync {
  param(
    [string]$Source,
    [string]$Destination
  )

  robocopy $Source $Destination /MIR /XD node_modules android .git .expo /XF npm-debug.log | Out-Null
  if ($LASTEXITCODE -gt 3) {
    throw "Project sync to short path failed with robocopy exit code $LASTEXITCODE."
  }
}

$sourceRoot = Split-Path -Parent $PSScriptRoot
$adb = Join-Path $env:LOCALAPPDATA "Android\Sdk\platform-tools\adb.exe"
$sdkRoot = Join-Path $env:LOCALAPPDATA "Android\Sdk"
$javaHome = "C:\Program Files\Microsoft\jdk-17.0.18.8-hotspot"

if (-not (Test-Path $adb)) {
  throw "adb.exe was not found under $sdkRoot. Install the Android SDK first."
}

Invoke-RobocopySync -Source $sourceRoot -Destination $ShortRoot

$env:ANDROID_SDK_ROOT = $sdkRoot
$env:ANDROID_HOME = $sdkRoot
$env:JAVA_HOME = $javaHome
$env:PATH = "$sdkRoot\platform-tools;$sdkRoot\emulator;$sdkRoot\cmdline-tools\latest\bin;$javaHome\bin;$env:PATH"
$env:NODE_ENV = "development"

Push-Location $ShortRoot
try {
  npm install
  if ($LASTEXITCODE -ne 0) {
    throw "npm install failed."
  }

  npx expo prebuild --clean --platform android
  if ($LASTEXITCODE -ne 0) {
    throw "expo prebuild failed."
  }

  Push-Location android
  try {
    .\gradlew.bat installDebug
    if ($LASTEXITCODE -ne 0) {
      throw "gradlew installDebug failed."
    }
  } finally {
    Pop-Location
  }

  $logPath = Join-Path $ShortRoot "expo-dev.log"
  if (Test-Path $logPath) {
    try {
      Remove-Item $logPath -Force
    } catch {
      Write-Host "Reusing existing expo-dev.log because it is locked by a running Metro process."
    }
  }

  Start-Process cmd.exe -ArgumentList "/c", "cd /d $ShortRoot && set NODE_ENV=development&& npx expo start --dev-client --host lan --port $Port > expo-dev.log 2>&1" -WindowStyle Hidden
  Start-Sleep -Seconds 8

  $deviceLine = & $adb devices | Select-String "device$" | Select-Object -First 1
  if (-not $deviceLine) {
    throw "No Android device is connected over adb."
  }

  $deviceId = ($deviceLine.ToString() -split "\s+")[0]
  & $adb -s $deviceId reverse "tcp:$Port" "tcp:$Port" | Out-Null
  & $adb -s $deviceId shell am start -n "com.anonymous.gen2026/.MainActivity" | Out-Null

  Write-Host "Development build installed and launched."
  Write-Host "Short build workspace: $ShortRoot"
  Write-Host "Device: $deviceId"
  Write-Host "Metro: http://localhost:$Port"
} finally {
  Pop-Location
}
