# JARVIS Desktop

Cross-platform Electron assistant for macOS and Windows, with an Android browser companion on the same trusted Wi-Fi.

## Included
- Hindi/English chat and allowlisted desktop commands.
- Gemini Cloud AI (default), OpenAI Cloud AI, or local Ollama.
- Push-to-talk recording that auto-stops after a pause; Gemini/OpenAI cloud transcription.
- Gemini-generated natural, expressive voice replies, with system-voice fallback.
- On-device memory notes, reminders/notifications, filename search, and selected app/site opening.
- Python file execution only after local selection and native confirmation.
- Android browser companion protected by a random per-launch token and QR code.
- Cloud API key encrypted with Electron safeStorage.

## Setup
1. Install JARVIS from the macOS DMG or Windows installer.
2. In AI Configuration, select **Gemini AI**, use model `gemini-3.8-flash`, paste a Gemini API key from https://aistudio.google.com/app/apikey, and click Save settings.
3. Tap **Speak a command**, speak, and pause; recording auto-stops. Audio is sent to Google for transcription. Natural speech replies use Gemini TTS (the `gemini-3.8-flash-lite-tts` model). Internet access and possible API charges apply.
4. OpenAI alternative: select OpenAI Cloud and use your own OpenAI key. Local alternative: select Local AI, install Ollama from https://ollama.com, and download a model such as `llama3.2`.
5. For Android, scan the QR while phone and desktop share Wi-Fi. Keep the link private and never expose its port to the internet.

## Limitations and safety
Always-on “Jarvis” wake-word detection is not available in this Electron build; use push-to-talk. Voice input requires cloud AI mode and a matching provider API key. AI text does not execute arbitrary shell commands. Python scripts require local selection and explicit confirmation. Android is a browser companion, not a native APK, and works only while desktop JARVIS is running. The macOS app is unsigned until code signing/notarization is configured. Never commit API keys or other secrets.
