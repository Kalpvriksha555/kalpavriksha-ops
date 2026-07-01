LiveKit backend token fix

1. Replace backend/src/server.js with server.livekit-fixed.js (rename it to server.js).
2. In backend folder run:
   npm install livekit-server-sdk
3. Commit and push:
   git add .
   git commit -m "fix livekit token generation"
   git push origin main
4. In Render Environment Variables, confirm:
   LIVEKIT_URL=wss://<your-project>.livekit.cloud
   LIVEKIT_API_KEY=<api key from same LiveKit project>
   LIVEKIT_API_SECRET=<api secret from same LiveKit project>
5. Redeploy Render first, then Vercel.
