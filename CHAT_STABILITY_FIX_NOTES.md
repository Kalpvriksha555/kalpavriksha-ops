# Chat Stability Fix Notes

This build focuses only on making chat read/unread behavior reliable and less cluttered.

## Fixed

- Opening the chat panel now immediately clears unread counts for the current user.
- Active chat read state is written both locally and to chat message read receipts.
- Direct messages and global messages are marked read without needing to switch to another chat.
- Chat/mention notifications are marked read when the chat is opened/read.
- Read receipts continue to show WhatsApp-style ticks.
- Attachment previews remain enabled for images, videos, PDFs, Office files, DWG/DXF and other supported files.

## Important

If old unread counters were stuck from older builds, log out and log in once after replacing the files. The new read-state logic will then overwrite the old stale unread state.
