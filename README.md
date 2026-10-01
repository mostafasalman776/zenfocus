# ZenFocus

منصة مذاكرة وإنتاجية: تايمر Pomodoro، مهام، أصوات خلفية، أصحاب ومنافسة، وقريباً غرف بشات وفويس.
القرارات كلها في [SPEC.md](SPEC.md). النسخة القديمة (HTML/JS) في `legacy/`.

## الهيكل
```
apps/web        React + Vite (الواجهة)
apps/api        Fastify + Socket.io + Drizzle (الـ API)
packages/shared قواعد وأنواع مشتركة (قواعد حساب وقت التركيز هنا)
```

## التشغيل محلياً
```bash
npm install
cp apps/api/.env.example apps/api/.env
npm run dev:api     # http://127.0.0.1:5090 — Postgres مدمج (PGlite) في apps/api/.pglite
npm run dev:web     # http://localhost:5173
```
من غير Google credentials فيه زرار "دخول تجريبي" (`DEV_LOGIN=1`، شغال في التطوير بس).

## أوامر
```bash
npm run typecheck
npm test                                  # قواعد حساب وقت التركيز
npm run build
npm -w @zenfocus/api run db:generate      # بعد أي تعديل في apps/api/src/db/schema.ts
```

## Google OAuth
Google Cloud Console → APIs & Services → Credentials → OAuth client ID (Web application):
- Authorized redirect URIs:
  - `http://localhost:5173/api/auth/google/callback`
  - `https://zenfocus.datagris.com/api/auth/google/callback`
- حط `GOOGLE_CLIENT_ID` و`GOOGLE_CLIENT_SECRET` في `apps/api/.env` (الملف ده عمره ما يترفع).
