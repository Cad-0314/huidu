# Huidu Payment Gateway API Reference

**Version 2.1**
**Base URL:** `https://your-domain.com`

Welcome to the Huidu Payment Gateway. This comprehensive guide enables you to integrate our secure payment solutions, including Payin, Payout, and Balance management.

## 🔐 Authentication

We strictly use **Header-Based Authentication** with HMAC-style signature verification. Every request must be signed to be accepted.

### Required Headers
| Header | Value | Description |
| :--- | :--- | :--- |
| `Content-Type` | `application/json` | Standard JSON body. |
| `x-merchant-id` | `UUID` | Your unique merchant UUID (e.g., `550e8400-e29b-41d4-a716-446655440000`). |
| `x-signature` | `MD5 Hash` | The MD5 signature of your request body. |

### generating the Signature
1.  **Serialize Body**: Take your final JSON request body string (exactly as sent).
2.  **Append Key**: Concatenate your `Merchant Secret Key` to the end of the JSON string.
3.  **Hash**: Generate an MD5 hash of the combined string.

**Formula:**
`Signature = MD5( JSON_String + Merchant_Secret_Key )`

**Node.js Example:**
```javascript
const crypto = require('crypto');
const body = JSON.stringify({ orderId: "ORD123", orderAmount: "100" });
const secret = "YOUR_SECRET_KEY_HERE";
const signature = crypto.createHash('md5').update(body + secret).digest('hex');

// Use this 'signature' in 'x-signature' header.
```

---

## 1. Payin API (Collections)

### 1.1 Create Payment Order
Generate a secure payment link for your customer.
**Endpoint:** `POST /api/payin/create`

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `orderId` | String | **Yes** | Unique Order ID (Max 64 chars). |
| `orderAmount` | Number | **Yes** | Amount to collect (Min ₹100). |
| `callbackUrl` | String | **Yes** | Your HTTPS URL to receive webhook notifications. |
| `skipUrl` | String | Optional | Redirect URL for user after payment completion. |
| `param` | String | Optional | Custom data to be returned in callback. |

**Request Example:**
```json
{
    "orderId": "MC001-998877",
    "orderAmount": 500,
    "callbackUrl": "https://myserverside.com/webhook",
    "skipUrl": "https://mysite.com/success",
    "param": "user_id=101"
}
```

**Response (Success):**
```json
{
    "code": 1,
    "msg": "Order created",
    "data": {
        "orderId": "MC001-998877",
        "id": "e0b5...88",
        "orderAmount": 500,
        "fee": 15.0,
        "paymentUrl": "https://gateway-domain.com/pay/MC001-998877"
    }
}
```

### 1.2 Query Payin Status
Check the status of an existing order.
**Endpoint:** `POST /api/payin/query`

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `orderId` | String | **Yes** | Your unique Order ID. |

**Response:**
```json
{
    "code": 1,
    "data": {
        "orderId": "MC001-998877",
        "status": "success", // pending, success, failed
        "amount": 500,
        "utr": "123456789012"
    }
}
```

### 1.3 Submit UTR (Manual Claim)
If an order is pending but customer has paid, submit the UTR for verification.
**Endpoint:** `POST /api/payin/submit-utr`

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `orderId` | String | **Yes** | The pending Order ID. |
| `utr` | String | **Yes** | The 12-digit UTR/Ref Number. |

**Response:**
```json
{
    "code": 1,
    "msg": "UTR Submitted successfully",
    "data": {
        "status": "processing"
    }
}
```

---

## 2. Payout API (Disbursements)

### 2.1 Bank Payout (IMPS/NEFT)
**Endpoint:** `POST /api/payout/bank`

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `orderId` | String | **Yes** | Unique Payout ID. |
| `amount` | Number | **Yes** | Amount (Min ₹100). |
| `account` | String | **Yes** | Beneficiary Account Number. |
| `ifsc` | String | **Yes** | Beneficiary IFSC Code. |
| `personName` | String | **Yes** | Beneficiary Name. |
| `code` | String | **Yes** | 2FA Google Auth Code. |

### 2.2 USDT Payout (TRC20)
**Endpoint:** `POST /api/payout/usdt`

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `orderId` | String | **Yes** | Unique Payout ID. |
| `amount` | Number | **Yes** | Amount in INR (Min equivalent of 500 USDT). |
| `walletAddress` | String | **Yes** | USDT TRC20 Address. |
| `code` | String | **Yes** | 2FA Google Auth Code. |

### 2.3 Query Payout Status
**Endpoint:** `POST /api/payout/query`

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `orderId` | String | **Yes** | Your unique Order ID. |

---

## 3. Balance API

### 3.1 Check Balance
**Endpoint:** `POST /api/balance/query`
**Body:** `{}` (Empty Object)

**Response:**
```json
{
    "code": 1,
    "msg": "Success",
    "data": {
        "availableAmount": 10050.00,
        "pendingAmount": 0,
        "totalAmount": 10050.00
    }
}
```

---

## 4. Webhooks (Callbacks)

We send POST requests to your `callbackUrl` for final status updates.
**Note:** Always verify the callback signature.

### Payin Callback Structure
```json
{
    "status": 1, // 1 = Success, 0 = Failed
    "amount": 500,
    "orderId": "MC001-998877",
    "utr": "123456789012",
    "sign": "a1b2c3...d4"
}
```
**Verification:**
`sign == MD5( JSON_String_Of_Callback + Merchant_Secret_Key )`

---

## 5. Error Codes

| Code | Message | Description |
| :--- | :--- | :--- |
| `1` | Success | Operation completed successfully. |
| `0` | Failed | Operation failed (check msg for details). |
| `400` | Bad Request | Missing parameters or validation error. |
| `401` | Unauthorized | Invalid Merchant ID or Signature. |
| `404` | Not Found | Order ID not found. |
| `500` | Server Error | Internal system error. |

---
*Generated for Huidu Payment Gateway*
