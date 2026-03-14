# Genesis 2026

Genesis 2026 is an Expo Router app with a unified on-device inference surface:

- Whisper for local audio transcription
- Qwen 0.5B GGUF for local chat
- A single Android UI to download models, run transcription, and test chat

## Important constraint

This project uses `whisper.rn` and `llama.rn`. Those are native modules. Expo Go cannot load them.

If you open this project in Expo Go, the app now stays safe and shows setup guidance instead of crashing, but Whisper and Qwen only work in a native Android development build.

## Recommended Android flow

From this folder:

```powershell
npm run android:devclient
```

That script:

- mirrors the app to `C:\g26` to avoid Windows path-length build failures
- installs dependencies in the short workspace
- runs `expo prebuild`
- builds and installs the Android debug APK
- starts Expo in dev-client mode on port `8083`
- opens the installed dev client on the connected Android device

## Manual commands

If you want to run pieces manually:

```powershell
npm install
npx expo start --dev-client --host lan --port 8083
```

For the Android native build, the short-path workspace is currently the reliable approach on this machine:

```powershell
cd C:\g26
npm install
npx expo prebuild --clean --platform android
cd android
.\gradlew.bat installDebug
```

## Screens

- `Lab`: unified Whisper + Qwen testing surface
- `Setup`: explains why a native dev build is required

## Services

- `services/whisper-service.ts`: Whisper model download and local transcription
- `services/llm-service.ts`: Qwen GGUF discovery, download, load, and chat
- `services/native-runtime.ts`: guards native-only code so Expo Go does not crash
