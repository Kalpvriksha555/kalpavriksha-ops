# Go-Live Instructions

## 1. Install Dependencies

```powershell
npm install
cd backend
npm install
cd ..
```

## 2. Configure Backend Environment

```powershell
cd backend
copy .env.example .env
```

Set email OTP or SMS OTP credentials in `backend/.env`.

## 3. Run Full Preflight

```powershell
npm run preflight
```

Only go live if all checks pass.

## 4. Start Backend

```powershell
cd backend
npm run start
```

## 5. Build and Serve Frontend

In another terminal:

```powershell
npm run build
npm run serve
```

## 6. Browser URL

Open the local URL shown by Vite preview, usually:

```text
http://localhost:4173
```

For office-wide use, deploy the frontend and backend on a server/VPS with a real domain and SSL.
