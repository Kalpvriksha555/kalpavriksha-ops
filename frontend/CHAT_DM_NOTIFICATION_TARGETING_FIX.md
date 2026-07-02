# Chat DM Notification Targeting Fix

Focused fix for personal-message notification leakage.

## Fixed
- Direct-message notifications now require an explicit target user.
- Old role-wide chat notifications no longer appear to every user in the same role.
- Floating chat preview counts only:
  - Global/team messages visible to everyone, or
  - Direct messages where the logged-in user is the recipient.
- Personal messages between two other users no longer appear in another user's preview/badge.
- Opening a DM now marks only that exact conversation as read, instead of clearing unrelated personal messages.

## Scope
- Chat notification filtering
- Chat unread preview filtering
- Chat read-target filtering

No task, attendance, archive, profile, or theme logic changed.
