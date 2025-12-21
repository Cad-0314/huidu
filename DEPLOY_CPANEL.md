# Deploying Huidu Payment Gateway on cPanel (Shared Hosting)

This guide outlines the steps to deploy the application on a cPanel shared hosting environment that supports **Node.js**.

## Prerequisites
1.  **cPanel Access**: Ensure your hosting provider offers the "Setup Node.js App" feature (usually CloudLinux).
2.  **Node.js Version**: The app requires Node.js 18 or higher (Recommended: 20.x).
3.  **Database**: You **MUST** have your **Turso Database Credentials** (`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`) ready, as this app is configured to use a remote Turso database strictly.

---

## Step 1: Prepare the Application Files
1.  **Exclude `node_modules`**: Do **NOT** upload the `node_modules` folder. It is too large and contains OS-specific binaries. You will install dependencies on the server.
2.  **Zip the Project**:
    *   Select all files in your project root **except** `node_modules`, `.git`, and test scripts.
    *   Create a ZIP archive (e.g., `huidu-app.zip`).

## Step 2: Upload to cPanel
1.  Login to **cPanel**.
2.  Open **File Manager**.
3.  Create a folder for your app (e.g., `huidu-pay`). **Do not** put it inside `public_html` yet; it's safer to keep the application code outside the public web root.
4.  **Upload** your `huidu-app.zip` to this folder.
5.  **Extract** the zip file.

## Step 3: Configure Node.js Application
1.  Go to the cPanel Dashboard and find **"Setup Node.js App"**.
2.  Click **"Create Application"**.
3.  Fill in the details:
    *   **Node.js Version**: Select **20.x** (or 18.x).
    *   **Application Mode**: `Production`.
    *   **Application Root**: Enter the path to your folder (e.g., `huidu-pay`).
    *   **Application URL**: Select your domain (e.g., `api.yourdomain.com`) and optional subpath.
    *   **Application Startup File**: Enter `server.js` (or `app.js` if that's your entry point. Check your `package.json` `start` script. It is usually `server.js`).
4.  Click **Create**.

## Step 4: Install Dependencies
1.  Once created, the UI will show a button saying **"Run NPM Install"**.
2.  Click **"Run NPM Install"**.
    *   *Note: If this fails or takes too long, you can copy the "Enter to the virtual environment" command shown at the top, paste it into the "Terminal" in cPanel, and run `npm install` manually.*

## Step 5: Configure Environment Variables
You must set your environment variables. The `Setup Node.js App` interface usually has an "Environment Variables" section.

Add the following keys (copy values from your local `.env`):

| Key | Value Description |
| :--- | :--- |
| `NODE_ENV` | `production` |
| `PORT` | `3000` (or leave empty, cPanel assigns one automatically) |
| `JWT_SECRET` | Your secure secret key |
| `APP_URL` | Your full domain URL (e.g., `https://api.yourdomain.com`) |
| `SILKPAY_BASE_URL` | `https://api.silkpay.ai` |
| `SILKPAY_MID` | Your Production Merchant ID |
| `SILKPAY_SECRET` | Your Production Secret |
| `TURSO_DATABASE_URL` | **Required**: Your Turso connection URL |
| `TURSO_AUTH_TOKEN` | **Required**: Your Turso Auth Token |
| `TELEGRAM_BOT_TOKEN` | Your Telegram Bot Token |

**Important**: Make sure to click "Add" or "Save" after entering these variables.

## Step 6: Restart and Test
1.  After installing dependencies and setting variables, click **"Restart Application"**.
2.  Visit your Application URL (e.g., `https://api.yourdomain.com`).
3.  You should see the application running.

## Troubleshooting
*   **500/503 Error**: Check the `stderr.log` in your Application Root folder (`huidu-pay`).
*   **Database Error**: Ensure `TURSO_DATABASE_URL` matches exactly what is in your local `.env`. Since the app is in "Strict Turso" mode, it will crash if it can't connect.
*   **Domain Mapping**: If you want the app on the root domain (`yourdomain.com`), you might need to modify your `.htaccess` file in `public_html` if cPanel doesn't handle it automatically. The "Setup Node.js App" usually creates the necessary `.htaccess` for you.
