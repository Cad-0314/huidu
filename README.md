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

Visit `http://localhost:3000` and login with `admin` / `admin123`

## Deploy to Render (Recommended)

1. Push code to GitHub
2. Go to [render.com](https://render.com) → New → Blueprint
3. Connect your repo (render.yaml will auto-configure)
4. Set environment variables:
   - `PAYABLE_SECRET`: Your Payable API secret
   - `PAYABLE_USER_ID`: Your Payable user ID
   - `APP_URL`: Your Render URL

## Deploy to Railway

1. Push code to GitHub
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Add a Volume (mount to `/app/database`)
4. Set environment variables (same as above)

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `JWT_SECRET` | Yes | Secret for JWT tokens |
| `PAYABLE_SECRET` | Yes | Payable API secret |
| `PAYABLE_USER_ID` | Yes | Payable merchant ID |
| `APP_URL` | Yes | Your app URL (for callbacks) |
| `PAYIN_RATE` | No | Pay-in fee rate (default: 0.05) |
| `PAYOUT_RATE` | No | Payout fee rate (default: 0.03) |
| `PAYOUT_FIXED_FEE` | No | Fixed payout fee (default: 6) |

## API Documentation

See `/api-docs` in the dashboard or the API Docs section after login.

## License

MIT
