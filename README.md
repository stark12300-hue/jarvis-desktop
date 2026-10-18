# JARVIS Desktop

Cross-platform Electron assistant for macOS and Windows, with an Android browser companion on the same trusted Wi-Fi.

## Included
- Hindi/English chat and command UI.
- Local Ollama or OpenAI Cloud AI; Cloud AI requires your key and can incur API charges.
- Voice command and “Jarvis” wake-word listener when speech recognition is available in the embedded browser/OS.
- Low-power and smart listening profiles; wake listening is off by default unless enabled.
- Allowlisted app/site commands, Google search, filename search in Downloads/Desktop/Documents.
- On-device memory notes, reminders/notifications, Python file execution after native confirmation.
- Android browser companion protected by a random per-launch token and QR code.
- API key encrypted with Electron safeStorage.
- GitHub Actions builds macOS DMG and Windows EXE installers.

## Setup
1. Download and install the generated desktop artifact.
2. Local AI: install Ollama from https://ollama.com and download a model such as llama3.2.
3. Cloud AI: choose Cloud AI, add your OpenAI API key in Settings, and save.
4. Enable wake-word listening. Speech recognition depends on the Electron/OS build and may use an online service; it is not guaranteed offline.
5. For Android, scan the QR while phone and desktop share Wi-Fi. Keep the link private and do not expose its port to the internet.

## Limitations and safety
AI text does not execute arbitrary shell commands. Python scripts require local selection and explicit confirmation. Android companion works only while desktop JARVIS is running and reachable. This repository does not include a native Android APK. The macOS app is unsigned until code signing/notarization is configured. Never commit secrets or private files.
