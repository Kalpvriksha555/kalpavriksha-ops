# Email OTP Configuration

Email OTP is now the preferred recovery method. Mobile/SMS OTP remains optional because SMS usually requires a paid provider.

## Recommended Gmail setup

1. Enable 2-Step Verification on the Gmail account.
2. Create a Google App Password.
3. In `backend/.env`, set:

```env
EMAIL_PROVIDER=gmail
OTP_FROM_EMAIL=your-email@gmail.com
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-google-app-password
```

Restart backend after saving `.env`.

## Test email configuration

Start backend and open:

```text
http://localhost:8080/api/email/health
```

Then test by PowerShell:

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:8080/api/email/test -ContentType 'application/json' -Body '{"email":"your-email@gmail.com"}'
```

Expected response:

```json
{ "ok": true, "message": "Test email sent." }
```

## Other providers

Supported values for `EMAIL_PROVIDER`:

- `gmail`
- `smtp`
- `resend`
- `sendgrid`
- `brevo`

## Mobile OTP

Mobile OTP is optional. Configure one of these only if you purchase/set up SMS service:

- Twilio
- Fast2SMS
- MSG91

If SMS is not configured, users can still recover with email OTP.
