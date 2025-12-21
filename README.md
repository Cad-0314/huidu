# VSPAY - Payment Gateway

A secure payment gateway API that integrates with Payable API for pay-in and payout processing.

## Features

- 💳 Pay-in (Deposit) via UPI/Bank
- 💸 Payout to Bank Accounts & USDT
- 👥 Multi-merchant support
- 🔐 API key + Signature authentication
- 📊 Admin dashboard
- 📝 Request/Response logging

## Quick Start (Local)

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Edit .env with your Payable credentials
# Then start the server
npm start
```

Visit `https://vspay.vip` and login with `admin` / `admin123`

## Deploy to Render (Free Tier Friendly)

This project uses **Turso** (distributed SQLite) for the database, allowing you to deploy on Render's Free Tier without needing a paid persistent disk.

### 1. Setup Database (Turso)
1. Sign up at [turso.tech](https://turso.tech)
2. Create a database: `turso db create vspay`
3. Get connection URL: `turso db show vspay --url`
4. Get auth token: `turso db tokens create vspay`

### 2. Deploy
1. Push code to GitHub
2. Go to [render.com](https://render.com) → New → Blueprint
3. Connect your repo (render.yaml will auto-configure)
4. Set environment variables:
   - `PAYABLE_SECRET` & `PAYABLE_USER_ID`: Your Payable credentials
   - `APP_URL`: Your domain URL (e.g., https://vspay.vip)
   - `TURSO_DATABASE_URL`: `libsql://...`
   - `TURSO_AUTH_TOKEN`: `eyJ...`

## Deploy to Railway

1. Push code to GitHub
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Set environment variables as above (use Turso for database)

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `JWT_SECRET` | Yes | Secret for JWT tokens |
| `PAYABLE_SECRET` | Yes | Payable API secret |
| `PAYABLE_USER_ID` | Yes | Payable merchant ID |
| `APP_URL` | Yes | Your app URL (for callbacks) |
| `TURSO_DATABASE_URL` | Yes (Prod) | Turso connection URL |
| `TURSO_AUTH_TOKEN` | Yes (Prod) | Turso auth token |
| `PAYIN_RATE` | No | Pay-in fee rate (default: 0.05) |
| `PAYOUT_RATE` | No | Payout fee rate (default: 0.03) |
| `PAYOUT_FIXED_FEE` | No | Fixed payout fee (default: 6) |

## API Documentation

See `/api-docs` in the dashboard or the API Docs section after login.

## License

MIT
