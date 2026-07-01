# Kalpvriksha Ops — Release Checklist

Run this before every commit/deploy.

## Local checks

```powershell
cd "D:\Kalpvriksha Designs Ops\kalpavriksha-ops"

git status
npm run build
cd frontend
npm run build
cd ../backend
npm start
```

## Functional checks

- Login screen opens
- Admin login works
- Manager login works
- Designer login works
- Admin controls visible
- User add/edit/role/status actions work
- Team Workload Overview shows all active managers/designers
- New employee appears everywhere needed
- Archived/deleted/restricted employee is hidden where needed
- Attendance hides admins
- Team Availability does not show “Free since” for admins
- Chat opens without error
- Direct messages visible
- Meeting opens in new tab
- Jitsi screen share works from inside Jitsi toolbar
- Task creation works
- Assignment dropdown works
- Manager review/completion works
- WhatsApp share works if configured
- Mobile layout usable

## Git process

```powershell
git add .
git commit -m "Meaningful commit message"
git push origin main
```

For larger features, create a branch first:

```powershell
git checkout -b feature/command-centre-polish
```
