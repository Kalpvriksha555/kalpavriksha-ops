# Real OTP + Chat Stability + Logo Fix

## Implemented
- Removed demo/local OTP display from login recovery and profile mobile registration.
- Added backend `/api/otp/send` and `/api/otp/verify` endpoints.
- OTP now requires a real SMS provider configuration; if not configured, users see a clear setup error instead of a demo OTP.
- Supported SMS providers in backend `.env.example`: Twilio, Fast2SMS, MSG91.
- Strengthened chat unread logic so the active channel clears immediately and does not require switching chats.
- Reloads chat read state when another user logs in on the same device.
- Added Kalpvriksha tree SVG favicon and updated tab title to `Kalpvriksha Designs Ops`.
- Ran frontend build, backend syntax check, and smoke checks.

## To enable real OTP
Copy backend `.env.example` to `.env`, then configure one provider:

### Twilio
SMS_PROVIDER=twilio
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM_NUMBER=+1...

### Fast2SMS
SMS_PROVIDER=fast2sms
FAST2SMS_API_KEY=...

### MSG91
SMS_PROVIDER=msg91
MSG91_AUTH_KEY=...
MSG91_TEMPLATE_ID=...

Start backend before using OTP:

```powershell
cd backend
npm install
copy .env.example .env
npm run dev
```

## OTP Failed to Fetch Fix
The frontend calls `http://localhost:8080/api/otp/send`. If the backend is not running, the browser shows `ERR_CONNECTION_REFUSED`.

Use one command from the project root:

```powershell
npm install
cd backend
npm install
cd ..
npm run dev:all
```

Backend must show: `Kalpvriksha API running on http://localhost:8080`.

For real SMS, configure `backend/.env` with one provider:
- `SMS_PROVIDER=twilio`
- `SMS_PROVIDER=fast2sms`
- `SMS_PROVIDER=msg91`

No demo OTP is displayed in the UI.
