# Kalpvriksha Ops - Permission, Recovery, Profile and Calculator Update

This update keeps the existing look and workflow while adding the requested refinements:

- Payment Health in Command Centre is visible only to Admins.
- Daily Closing is visible only to Admins.
- Forgot Password now resets the password inside the team list instead of only displaying it.
- Role changes are respected immediately: Manager permissions appear when a user is promoted and are removed when changed back to Designer.
- Team availability continues to show Available, Busy, On Break and Unavailable status.
- User profile photo appears beside the logged-in user's name in the top bar.
- Khushbu Pandey username is normalized from `khusbu` to `khushbu`.
- My Profile remains available for every user with photo, contact, Aadhaar, PAN, emergency contact and bank/UPI fields.
- Added Calculator for everyone:
  - Hectare, acre, bigha, biswa, sq ft, sq m, sq yd conversions.
  - Hindi digit/number helper, e.g. `१२३४५` or `पच्चीस हजार`.

Run:

```bash
npm install
npm run dev
```

Build checked with:

```bash
npm run build
```
