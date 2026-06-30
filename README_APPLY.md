# Kalpvriksha Meeting Screen Share Patch

This patch changes only:

- frontend/src/App.jsx
- src/App.jsx

Purpose:

- Keep the existing Jitsi-based meeting system.
- Stop relying on embedded iframes for meeting/screen share.
- Open team meeting, direct call, and screen share in a full browser tab.
- Preserve admin, attendance, chat, workload, and employee sync logic.

Important:

- Public meet.jit.si may still ask the first person to sign in to start/moderate a room. This patch cannot bypass Jitsi's public-server login policy.
- Screen sharing requires browser permission and works best in Chrome/Edge in a full tab.
