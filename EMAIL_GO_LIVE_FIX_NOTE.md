# Email OTP Go-Live Fix

This build removes the unsafe automatic local OTP fallback from the email verification flow.

For live email OTP to work, the backend must use real email credentials:

- `EMAIL_PROVIDER=gmail` or `EMAIL_PROVIDER=smtp`
- `SMTP_HOST=smtp.gmail.com`
- `SMTP_PORT=465`
- `SMTP_SECURE=true`
- `SMTP_USER=<your Gmail address>`
- `SMTP_PASS=<Google App Password>`
- `OTP_FROM_EMAIL=<same Gmail address or verified sender>`
- `ALLOW_LOCAL_EMAIL_OTP=false`

Google will reject normal Gmail passwords with `535-5.7.8`. The password must be a Google App Password generated after enabling 2-Step Verification on the Gmail account.
