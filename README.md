# EchoMind

EchoMind is a React Native (Expo Router) Android app for fully on-device voice intelligence.

It combines:

- **Whisper** for local speech-to-text
- **Gemma 3 1B (GGUF via `llama.rn`)** for local chat + memory extraction
- A lightweight **memory system** (Notes / Tasks / Facts) used as conversational context

---

## What this project does

1. Records live microphone audio and transcribes it locally.
2. Lets the user upload an audio file and transcribe it locally.
3. Extracts useful memory items from transcripts using Gemma.
4. Uses relevant memory items as context for chat answers.

No cloud inference is required for the main AI pipeline.

---

## Tech stack

- Expo SDK 54 + React Native 0.81
- Expo Router (tabs-based app)
- `whisper.rn` (on-device Whisper + VAD)
- `llama.rn` (GGUF model runtime)
- TypeScript

---

## Repository structure

```text
gen2026/
	app/
		(tabs)/
			index.tsx      # Record + realtime transcript + file upload transcription
			memory.tsx     # Memory management UI (Notes / Tasks / Facts)
			chat.tsx       # Chat UI powered by Gemma + relevant memory context
	services/
		whisper-service.ts     # Whisper model handling, WAV processing, live/file transcription
		llm-service.ts         # Gemma download/load/inference + memory extraction
		memory-store.ts        # In-memory store for notes/tasks/facts
		background-service.ts  # Android foreground notification for live transcription
		native-runtime.ts      # Native runtime guards
	scripts/
		run-android-dev.ps1    # Recommended Windows Android dev flow
gen2026_vendor_backup/
	bitnet.cpp/              # Backup/vendor folder
```

---

## Setup requirements

### Required

- Node.js 18+
- npm
- Android Studio + Android SDK
- A connected Android device (or emulator)

### Important note

This app depends on native modules (`whisper.rn`, `llama.rn`).

**Expo Go is not supported** for inference features.
Use an Android development build (dev client).

---

## Quick start (recommended on Windows)

From the repository root:

```powershell
cd gen2026
npm run android:devclient
```

This script will:

- mirror the project to `C:\g26` (avoids Windows path-length issues)
- install dependencies
- run Expo prebuild if needed
- build/install Android debug APK
- start Metro in dev-client mode on port `8083`
- launch the app on your connected Android device

---

## Manual setup (if needed)

```powershell
cd gen2026
npm install
npx expo start --dev-client --host lan --port 8083
```

For a full native rebuild in the short path workspace:

```powershell
cd C:\g26
npm install
npx expo prebuild --clean --platform android
cd android
.\gradlew.bat installDebug
```

---

## How to use the app

### 1) Record tab

- Tap the mic button to start/stop live transcription.
- Watch realtime transcript in the transcript panel.
- Optionally attach an audio file and press **Transcribe**.

### 2) Memory tab

- Review/edit memory entries grouped as:
	- Notes
	- Tasks
	- Facts
- Memory can be manually edited and AI-populated from transcripts.

### 3) Assistant tab

- Chat with the local Gemma model.
- The app injects **relevant** memory context into prompts.

---

## Model details

- Whisper model files are downloaded and cached on device.
- Gemma model file: `gemma-3-1b-it-IQ4_NL.gguf` (local device storage).

If Gemma load fails due to stale/corrupt cache, clear app storage or reinstall the app.

---

## Troubleshooting

### Keyboard overlaps input fields

- Fixed via keyboard-avoiding layout in Chat and Memory tabs.

### `Failed to load model` (Gemma)

- Clear app data / reinstall app to remove cached model and re-download.
- Ensure you are using a native Android dev build (not Expo Go).

### `RNSVGPath` / missing native view manager

- Usually indicates stale binary.
- Reinstall app and rebuild dev client.

---

## Scripts

Run these inside `gen2026/`:

- `npm run start` — start Expo
- `npm run android` — run Android app
- `npm run android:devclient` — recommended Android dev workflow
- `npm run web` — start web build (UI only; native inference unavailable)
- `npm run lint` — lint project

---

## Hackathon scope

EchoMind demonstrates an on-device AI assistant pipeline:

- speech input → local transcription → memory extraction → context-aware local chat

with a mobile UX focused on privacy and low-latency iteration.
