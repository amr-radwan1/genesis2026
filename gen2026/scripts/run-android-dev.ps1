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

function Invoke-RobocopySyncWithAndroid {
  param(
    [string]$Source,
    [string]$Destination
  )

  robocopy $Source $Destination /MIR /XD node_modules .git .expo /XF npm-debug.log | Out-Null
  if ($LASTEXITCODE -gt 3) {
    throw "Project sync to short path failed with robocopy exit code $LASTEXITCODE."
  }
}

# ── Inject BitNet native module into the Android project ──
function Inject-BitnetNativeModule {
  param(
    [string]$ProjectRoot  # The short-path build dir (e.g. C:\g26)
  )

  $androidApp   = Join-Path $ProjectRoot "android\app"
  $javaDir      = Join-Path $androidApp  "src\main\java\com\anonymous\gen2026"
  $jniDir       = Join-Path $androidApp  "src\main\jni"
  $nativeDir    = Join-Path $ProjectRoot "native\bitnet"

  # Source trees from the repo root (parent of gen2026)
  $repoRoot     = Split-Path -Parent $ProjectRoot   # only if vendor backup is there
  # The vendor backup lives at the same level as gen2026 in the monorepo
  $vendorBitnet = Join-Path $ProjectRoot "..\gen2026_vendor_backup\bitnet.cpp"
  if (-not (Test-Path $vendorBitnet)) {
    # Try the absolute path from the original source
    $vendorBitnet = "C:\Users\yousi\OneDrive\Desktop\projects\llm_app\genesis2026\gen2026_vendor_backup\bitnet.cpp"
  }

  Write-Host "Injecting BitNet native module..."

  # 1) Copy C++/CMake JNI sources
  if (-not (Test-Path $jniDir)) {
    New-Item -ItemType Directory -Path $jniDir -Force | Out-Null
  }
  Copy-Item (Join-Path $nativeDir "bitnet_jni.cpp")   $jniDir -Force
  Copy-Item (Join-Path $nativeDir "CMakeLists.txt")   $jniDir -Force

  # 2) Copy BitNet C++ tree from vendor backup into jni/bitnet_cpp/
  $bitnetCppDest = Join-Path $jniDir "bitnet_cpp"
  if (Test-Path $bitnetCppDest) {
    Remove-Item $bitnetCppDest -Recurse -Force
  }

  New-Item -ItemType Directory -Path $bitnetCppDest -Force | Out-Null

  # Copy src/ (ggml-bitnet-lut.cpp, ggml-bitnet-mad.cpp)
  $srcDest = Join-Path $bitnetCppDest "src"
  New-Item -ItemType Directory -Path $srcDest -Force | Out-Null
  Copy-Item (Join-Path $vendorBitnet "src\*") $srcDest -Recurse -Force

  # Copy include/ (headers + kernel config)
  $incDest = Join-Path $bitnetCppDest "include"
  New-Item -ItemType Directory -Path $incDest -Force | Out-Null
  Copy-Item (Join-Path $vendorBitnet "include\*") $incDest -Recurse -Force

  # Copy 3rdparty/llama.cpp/
  $llamaDest = Join-Path $bitnetCppDest "3rdparty\llama.cpp"
  New-Item -ItemType Directory -Path $llamaDest -Force | Out-Null
  # Only copy what we need to avoid copying gigabytes of GPU shaders etc.
  # include/
  New-Item -ItemType Directory -Path (Join-Path $llamaDest "include") -Force | Out-Null
  Copy-Item (Join-Path $vendorBitnet "3rdparty\llama.cpp\include\*") (Join-Path $llamaDest "include") -Force
  # src/
  New-Item -ItemType Directory -Path (Join-Path $llamaDest "src") -Force | Out-Null
  Copy-Item (Join-Path $vendorBitnet "3rdparty\llama.cpp\src\*.cpp") (Join-Path $llamaDest "src") -Force
  Copy-Item (Join-Path $vendorBitnet "3rdparty\llama.cpp\src\*.h")   (Join-Path $llamaDest "src") -Force
  # ggml/ include + src (CPU-only C files)
  New-Item -ItemType Directory -Path (Join-Path $llamaDest "ggml\include") -Force | Out-Null
  Copy-Item (Join-Path $vendorBitnet "3rdparty\llama.cpp\ggml\include\ggml.h")         (Join-Path $llamaDest "ggml\include") -Force
  Copy-Item (Join-Path $vendorBitnet "3rdparty\llama.cpp\ggml\include\ggml-alloc.h")   (Join-Path $llamaDest "ggml\include") -Force
  Copy-Item (Join-Path $vendorBitnet "3rdparty\llama.cpp\ggml\include\ggml-backend.h") (Join-Path $llamaDest "ggml\include") -Force

  New-Item -ItemType Directory -Path (Join-Path $llamaDest "ggml\src") -Force | Out-Null
  $ggmlSrcFiles = @(
    "ggml.c", "ggml-alloc.c", "ggml-backend.cpp", "ggml-quants.c", "ggml-quants.h",
    "ggml-aarch64.c", "ggml-aarch64.h", "ggml-common.h", "ggml-impl.h",
    "ggml-cpu-impl.h", "ggml-backend-impl.h"
  )
  foreach ($f in $ggmlSrcFiles) {
    $srcPath = Join-Path $vendorBitnet "3rdparty\llama.cpp\ggml\src\$f"
    if (Test-Path $srcPath) {
      Copy-Item $srcPath (Join-Path $llamaDest "ggml\src") -Force
    }
  }

  # 3) Copy Java bridge files
  Copy-Item (Join-Path $nativeDir "BitnetBridge.java")  $javaDir -Force
  Copy-Item (Join-Path $nativeDir "BitnetPackage.java") $javaDir -Force

  # 4) Patch build.gradle to add externalNativeBuild
  $buildGradle = Join-Path $androidApp "build.gradle"
  $gradleContent = Get-Content $buildGradle -Raw

  if ($gradleContent -notmatch "bitnet_jni") {
    # Add externalNativeBuild block inside android { defaultConfig { } } section
    $cmakeBlock = @"

    externalNativeBuild {
        cmake {
            path "src/main/jni/CMakeLists.txt"
        }
    }
"@
    # Insert before the last closing brace of the android {} block
    # Find "buildTypes {" and insert before it
    $gradleContent = $gradleContent -replace '(buildTypes\s*\{)', "$cmakeBlock`n    `$1"

    # Add NDK ABI filter for arm64 only
    $ndkBlock = @"

        ndk {
            abiFilters "arm64-v8a"
        }
        externalNativeBuild {
            cmake {
                cppFlags "-std=c++20 -frtti -fexceptions"
                arguments "-DANDROID_STL=c++_shared"
            }
        }
"@
    $gradleContent = $gradleContent -replace '(targetSdkVersion\s+\d+)', "`$1$ndkBlock"

    Set-Content $buildGradle $gradleContent -NoNewline
    Write-Host "  Patched build.gradle with CMake config"
  }

  # 5) Register BitnetPackage in MainApplication
  $mainAppPath = Get-ChildItem -Path $javaDir -Filter "MainApplication.*" -Recurse | Select-Object -First 1 -ExpandProperty FullName
  if ($mainAppPath -and (Test-Path $mainAppPath)) {
    $mainAppContent = Get-Content $mainAppPath -Raw
    if ($mainAppContent -notmatch "BitnetPackage") {
      if ($mainAppPath -match "\.kt$") {
        # Kotlin - add to getPackages() override
        $mainAppContent = $mainAppContent -replace '(override fun getPackages\(\).*?add\()', "`$1`n          add(BitnetPackage())`n          "
        # If that pattern doesn't work, try the packages list pattern
        if ($mainAppContent -notmatch "BitnetPackage") {
          $mainAppContent = $mainAppContent -replace '(PackageList\(this\)\.packages)', "`$1.apply { add(BitnetPackage()) }"
        }
      } else {
        # Java
        $mainAppContent = $mainAppContent -replace '(PackageList\(this\)\.getPackages\(\))', "`$1;`n              packages.add(new BitnetPackage())"
      }
      Set-Content $mainAppPath $mainAppContent -NoNewline
      Write-Host "  Registered BitnetPackage in MainApplication"
    }
  } else {
    Write-Host "  WARNING: Could not find MainApplication to register BitnetPackage"
  }

  Write-Host "BitNet native module injection complete."
}

$sourceRoot = Split-Path -Parent $PSScriptRoot
$adb = Join-Path $env:LOCALAPPDATA "Android\Sdk\platform-tools\adb.exe"
$sdkRoot = Join-Path $env:LOCALAPPDATA "Android\Sdk"
$javaHome = "C:\Program Files\Microsoft\jdk-17.0.18.8-hotspot"

if (-not (Test-Path $adb)) {
  throw "adb.exe was not found under $sdkRoot. Install the Android SDK first."
}

Invoke-RobocopySyncWithAndroid -Source $sourceRoot -Destination $ShortRoot

$env:ANDROID_SDK_ROOT = $sdkRoot
$env:ANDROID_HOME = $sdkRoot
$env:JAVA_HOME = $javaHome
$env:PATH = "$sdkRoot\platform-tools;$sdkRoot\emulator;$sdkRoot\cmdline-tools\latest\bin;$javaHome\bin;$env:PATH"
$env:NODE_ENV = "development"

$portOwners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique
foreach ($portOwnerPid in $portOwners) {
  if ($portOwnerPid -and $portOwnerPid -ne 0) {
    try {
      Stop-Process -Id $portOwnerPid -Force -ErrorAction Stop
    } catch {
      Write-Host "Could not stop process $portOwnerPid on port ${Port}: $($_.Exception.Message)"
    }
  }
}

Push-Location $ShortRoot
try {
  npm install
  if ($LASTEXITCODE -ne 0) {
    throw "npm install failed."
  }

  if (Test-Path ".\node_modules\llama.rn\android\.cxx") {
    Remove-Item ".\node_modules\llama.rn\android\.cxx" -Recurse -Force
  }
  if (Test-Path ".\node_modules\llama.rn\android\build") {
    Remove-Item ".\node_modules\llama.rn\android\build" -Recurse -Force
  }

  if (-not (Test-Path (Join-Path $ShortRoot "android"))) {
    npx expo prebuild --clean --platform android
    if ($LASTEXITCODE -ne 0) {
      throw "expo prebuild failed."
    }
  }

  # Inject BitNet native module after prebuild generates the android/ directory
  Inject-BitnetNativeModule -ProjectRoot $ShortRoot

  Push-Location android
  try {
    if (Test-Path ".\app\.cxx") {
      Remove-Item ".\app\.cxx" -Recurse -Force
    }
    if (Test-Path ".\app\build") {
      Remove-Item ".\app\build" -Recurse -Force
    }

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

  Start-Process cmd.exe -ArgumentList "/c", "cd /d $ShortRoot && set NODE_ENV=development&& npx expo start --dev-client --host lan --port $Port --non-interactive > expo-dev.log 2>&1" -WindowStyle Hidden
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
