<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/c03bac8f-2f64-4955-a317-769c56c9cbfe

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the required environment variables in `.env` or `.env.local`:
   `DATABASE_URL`, `JWT_SECRET`, `SESSION_TIMEOUT_MINUTES`, and optionally `GEMINI_API_KEY`
3. Prepare the database:
   `npm run db:prepare`
4. Run the app:
   `npm run dev`

## Database migrations

- `npm run db:prepare`: creates the target PostgreSQL database if it does not exist and applies all pending migrations.
- `npm run migrate`: alias for `npm run db:prepare`.
- On server startup, the app automatically prepares the database before serving requests.
