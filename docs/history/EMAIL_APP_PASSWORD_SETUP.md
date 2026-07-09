# Email OTP Go-Live Setup

The backend now supports both:

- `GET /api/email/health`
- `GET /api/email/status`

Use this backend `.env` format for Gmail App Password:

```env
EMAIL_PROVIDER=gmail
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=upadhyay.shubham2112@gmail.com
SMTP_PASS=YOUR_16_CHARACTER_GOOGLE_APP_PASSWORD
OTP_FROM_EMAIL=upadhyay.shubham2112@gmail.com
ALLOW_LOCAL_EMAIL_OTP=false
```

Important:
- `SMTP_PASS` must be Google App Password, not normal Gmail password.
- Remove spaces from the App Password before saving it.
- Restart backend after changing `.env`.

Test in browser:

```txt
http://localhost:8080/api/email/status
```

Expected:

```json
{
  "configured": true,
  "mode": "real-email"
}
```
