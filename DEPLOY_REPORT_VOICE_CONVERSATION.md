# Deploy — Voice conversation mode (unlimited until stop)

**When:** 2026-09-23 (Europe/Madrid)
**Deploy id:** `6ab3841aaf99f938b93fd565`
**Prod URL:** https://bajacaliforniasur2050.com
**Unique URL:** https://6ab3841aaf99f938b93fd565--bcs-intel-portal.netlify.app
**Alias:** https://bcs-intel-portal.netlify.app

## Fix
- `recognition.continuous = true` + `interimResults = true`
- `conversationMode` flag: only cleared on explicit tap **Parar / Stop** (or mic permission denied)
- Auto re-listen after TTS ends / TTS skip / typed reply while session on
- Soft restart on `onend` / `no-speech` / recoverable errors (~250–300ms)
- Recognition paused while TTS speaks; hold-to-talk release no longer stops session
- Status: "Conversación activa — toca para parar" / EN equivalent

## How user stops
Tap **Hablar** to start; button becomes **Parar** — tap again to end the session.
