# Email OTP Setup

Mobile SMS OTP requires a paid SMS provider in most cases. This build adds Email OTP as the recommended recovery method.

## Supported Email Providers

Set these in `backend/.env`:

### Option 1: Resend
```env
EMAIL_PROVIDER=resend
OTP_FROM_EMAIL=otp@yourdomain.com
RESEND_API_KEY=your_resend_api_key
```

### Option 2: SendGrid
```env
EMAIL_PROVIDER=sendgrid
OTP_FROM_EMAIL=otp@yourdomain.com
SENDGRID_API_KEY=your_sendgrid_api_key
```

### Option 3: Brevo
```env
EMAIL_PROVIDER=brevo
OTP_FROM_EMAIL=otp@yourdomain.com
BREVO_API_KEY=your_brevo_api_key
```

## User Flow

1. User opens Profile.
2. User enters email.
3. User clicks **Send Email OTP**.
4. User verifies OTP.
5. Profile shows **Email Registered**.
6. Forgot Password can then use Email OTP.

Mobile OTP is still available if SMS provider credentials are configured.
