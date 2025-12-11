# 🚀 Free Tier Deployment Checklist (Render + Turso)

Your application is now configured to run **Statelessly** using Turso as the external database. This makes it perfect for Render's Free Tier.

## Phase 1: Preparation
- [x] Code pushed to GitHub.
- [x] Database migrated to Turso.
- [x] `render.yaml` configured (disk removed).

## Phase 2: Deploy on Render
1. **Login**: Go to [dashboard.render.com](https://dashboard.render.com/).
2. **New Service**: Click **New +** -> **Web Service**.
3. **Connect**: Select your repository.
4. **Configure**:
   - **Name**: `vspay-gateway`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: **Free**

5. **Environment Variables** (Crucial Step):
   Add these individually or use "Add from .env":

   | Key | Value |
   |-----|-------|
   | `NODE_ENV` | `production` |
   | `PAYABLE_BASE_URL` | `https://payable8.com/api` |
   | `PAYABLE_SECRET` | *(Your Secret)* |
   | `PAYABLE_USER_ID` | *(Your User ID)* |
   | `JWT_SECRET` | *(Generic random string)* |
   | `TURSO_DATABASE_URL` | `libsql://main-vspaytest.aws-ap-northeast-1.turso.io` |
   | `TURSO_AUTH_TOKEN` | *(Use the token from your local .env)* |
   | `APP_URL` | *(Your Render URL)* |

6. **Deploy**: Click **Create Web Service**.

## Phase 3: Final Config
1. Wait for deployment to finish (Green "Live" badge).
2. Copy the **Service URL**.
3. Go to **Environment** tab.
4. Update `APP_URL` with the real URL.
5. **Save Changes**.

## Phase 4: Usage
- Admin Login: `admin` / `admin123`
