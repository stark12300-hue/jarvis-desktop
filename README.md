# JARVIS Desktop Starter

A cross-platform Electron desktop prototype for macOS and Windows.

> **Repository visibility:** This repository is currently public. All code and committed files are visible to anyone. Never commit API keys, passwords, personal files, or other secrets.

## Included in this starter
- Futuristic desktop UI
- Safe, allowlisted buttons to open common applications
- Opens validated HTTP/HTTPS website URLs
- GitHub Actions workflow to build macOS DMG and Windows EXE installers

## Not implemented yet
Wake-word listening (“Jarvis”), microphone capture, speech-to-text, AI responses, text-to-speech, local/cloud AI integration, memory, reminders, Android companion app, and secure remote Mac-to-Android control.

This starter does not listen to the microphone and does not run arbitrary shell commands.

## Build installers
Push to the main branch or manually run **Actions → Build JARVIS installers**. Download the macOS DMG or Windows EXE from the completed workflow artifacts. The Mac app is unsigned until code signing and notarization are configured.

## Run locally
Install Node.js 22+, run `npm install`, then `npm start`. This requires Terminal; GitHub Actions is the intended no-terminal build path.
