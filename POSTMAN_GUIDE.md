# 🦅 VSPAY Postman Testing Guide

This guide explains how to test the VSPAY API using the provided Postman Collection.

## 1. Import Collection
1. Open Postman.
2. Click **Import** (top left).
3. Drag and drop the `postman_collection.json` file from this repository.
4. You will see a new collection named **VSPAY API**.

## 2. Configure Environment
1. Click on the **VSPAY API** collection in the sidebar.
2. Go to the **Variables** tab (in the main view).
3. Update the following "Current Value" fields with your actual data (get these from your Admin Dashboard):
   - `merchant_uuid`: Your Merchant UUID (e.g., `550e8400-e29b...`)
   - `merchant_key`: Your Merchant Secret Key (e.g., `ABC123XYZ`)
   - `base_url`: Your app URL (e.g., `https://vspay.vip` or `http://localhost:3000`)

   **Note**: Leave `signature` empty. It is calculated automatically!

## 3. Testing Payin (Deposit)
1. Open **Payin > Create Payin**.
2. Go to **Body**.
3. You can change `orderAmount` or `orderId` if you want.
   *Tip: `{{$timestamp}}` automatically generates a unique ID each time.*
4. Click **Send**.
5. You should receive a JSON response with `rechargeUrl`.

## 4. Testing Payout (Withdrawal)
1. Open **Payout > Create Bank Payout**.
2. Go to **Body**.
3. Update `amount`, `account`, etc.
4. Click **Send**.
5. You should receive a "Payout submitted" response.

## 5. Automatic Signature
I have added a **Pre-request Script** to the collection.
- It automatically takes your JSON body.
- Sorts the keys alphabetically.
- Appends your `merchant_key`.
- Calculates MD5 hash.
- Sets the `{{signature}}` variable.

You do **NOT** need to manually calculate signatures. Just edit the JSON body and click Send! 🚀
