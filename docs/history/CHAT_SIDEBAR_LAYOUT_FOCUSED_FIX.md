# Chat Sidebar Layout Focused Fix

Only the chat UI layout was adjusted.

Changes:
- Expanded the chat panel width safely on desktop.
- Increased the direct-message sidebar width so team member names are visible.
- Prevented the main chat area from pushing/cropping the sidebar.
- Reduced attachment preview height and changed image preview to `object-contain` so large images do not dominate the chat window.
- Added truncation safety for long attachment filenames.

No backend, attendance, cases, admin, team, security, OTP, or unrelated modules were changed.
