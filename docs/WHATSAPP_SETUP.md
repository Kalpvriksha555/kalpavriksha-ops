# WhatsApp Setup for Kalpvriksha Designs

The backend includes:

```http
GET /whatsapp/webhook
POST /whatsapp/webhook
POST /whatsapp/mock/incoming
```

## Local Testing

Use the frontend **WhatsApp** page and click **Simulate WhatsApp Case**. This creates a case and attaches WhatsApp file placeholders.

## Live WhatsApp Cloud API Steps

1. Create Meta Developer app.
2. Add WhatsApp product.
3. Get Phone Number ID and permanent access token.
4. Add backend HTTPS webhook URL:

```text
https://your-domain.com/whatsapp/webhook
```

5. Set verify token equal to:

```text
kalpvriksha_verify
```

or change it in `.env`.

6. Subscribe to message events.

## Required Production Enhancement

For actual media files sent on WhatsApp, the webhook receives a media ID. The backend must call Meta's media endpoint to download the file and then attach it to the matching case.

Current version stores WhatsApp attachments as placeholders in mock mode.
