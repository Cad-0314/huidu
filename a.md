

# Payable API Documentation

 `https://payable8.com/api/`
secret:4163917be57238c4bd1a77b6c65d2c59a0caea3a
userId:100083
---

## ⚠️ Important Notices


2.  **Pay-in (Recharge) Callbacks:**
    * **CRITICAL:** Please use the `amount` field (Actual Received Amount) for processing the user's balance.
    * The `orderAmount` field is for order verification only.

---

## 🔐 Signature Verification (Sign)

To generate the `sign` parameter, follow these steps:

1.  **Sort & Concatenate:**
    * Sort all parameters by ASCII code in ascending order.
    * Remove fields with empty values (null or "").
    * Join them with `&` in the format `key=value`.
    * *Example:* `key1=1&key2=usuua&key3=https://www.fasfrt.com/`

2.  **Append Secret:**
    * Append `&secret=YOUR_SECRET_KEY` to the end of the string.
    * *Example:* `...&key6=12122112&secret=123123`

3.  **MD5 Encryption:**
    * Encrypt the final string using MD5.
    * *Example Result:* `ggsdf1d8gdesdfssdqw5e7sdwr1c8ad423`

4.  **Convert to Uppercase:**
    * Convert the MD5 hash to uppercase.
    * *Final Sign:* `GGSDF1678DWERRERESS3B5E70B1C8AD423`

---

## 1. Balance Query

* **Endpoint:** `/payable/balance/query`
* **Method:** POST
* **Content-Type:** `application/json`

### Request Parameters
| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `userId` | Long | Yes | Merchant ID |
| `sign` | String | Yes | Signature |

### Response Parameters
| Parameter | Type | Description |
| :--- | :--- | :--- |
| `code` | Integer | Status Code (1 = Success, 0 = Failure) |
| `msg` | String | Response Message |
| `data.balance` | String | Merchant Balance |
| `data.userId` | Long | Merchant ID |
| `data.platDate` | String | Platform Time |

### Example Response
```json
{
  "code": 1,
  "data": {
    "balance": "100",
    "userId": "10001",
    "platDate": "2023-01-01 12:00:00"
  },
  "msg": "success"
}
````

-----

## 2\. Payout Order (代付下单)

  * **Endpoint:** `/payable/payment`
  * **Method:** POST
  * **Content-Type:** `application/json`

### Request Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `amount` | String | Yes | Payout Amount (String to avoid precision loss) |
| `userId` | Long | Yes | Merchant ID |
| `callbackUrl` | String | Yes | Asynchronous Callback URL |
| `account` | String | Yes | Bank Account Number |
| `ifsc` | String | Yes | IFSC Code |
| `orderId` | String | Yes | Merchant Order ID (Unique) |
| `personName` | String | Yes | Payee Name |
| `param` | String | No | Extra parameters (passed back in callback) |
| `sign` | String | Yes | Signature |

### Response Parameters

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `code` | Integer | Request Status (1 = Success, 0 = Failure) |
| `data.amount` | String | Payout Amount |
| `data.commission` | String | Fee/Commission |
| `data.orderId` | String | Merchant Order ID |
| `data.id` | String | Platform Order ID |

### Example Response

```json
{
  "code": 1,
  "data": {
    "amount": "100.00",
    "commission": "2.00",
    "id": "PLAT123456",
    "orderId": "MERCH123456"
  },
  "msg": "success"
}
```

-----

## 3\. Payout Order Query

  * **Endpoint:** `/payable/payment/query`
  * **Method:** POST
  * **Content-Type:** `application/json`

### Request Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `userId` | Long | Yes | Merchant ID |
| `orderId` | String | Yes | Merchant Order ID |
| `sign` | String | Yes | Signature |

### Response Parameters

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `data.status` | String | Status: `0`: Processing, `1`: Success, `2`: Failed, `3`: Bank Transferring |
| `data.message` | String | Failure reason or "success" |
| `data.utr` | String | UTR Number (if successful) |
| `data.amount` | String | Amount |
| `data.id` | String | Platform Order ID |

-----

## 4\. Pay-in Order (代收下单)

  * **Endpoint:** `/payable/recharge`
  * **Method:** POST
  * **Content-Type:** `application/json`

### Request Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `userId` | Long | Yes | Merchant ID |
| `callbackUrl` | String | Yes | Callback URL |
| `orderAmount` | String | Yes | Order Amount (String) |
| `orderId` | String | Yes | Merchant Order ID |
| `skipUrl` | String | Yes | Jump URL (Redirect after payment) |
| `param` | String | No | Extra parameters |
| `sign` | String | Yes | Signature |

### Response Parameters

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `data.rechargeUrl` | String | Payment Page URL (Redirect user here) |
| `data.orderAmount` | String | Order Amount |
| `data.id` | String | Platform Order ID |

-----

## 5\. Pay-in Order Query

  * **Endpoint:** `/payable/recharge/query`
  * **Method:** POST
  * **Content-Type:** `application/json`

### Request Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `userId` | Long | Yes | Merchant ID |
| `orderId` | String | Yes | Merchant Order ID |
| `sign` | String | Yes | Signature |

### Response Parameters

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `data.status` | String | Status: `0`: Failed, `1`: Success |
| `data.amount` | String | **Actual Received Amount** |
| `data.orderAmount` | String | Original Order Amount |

-----

## 6\. UTR Supplement Order (UTR 补单)

Used to manually trigger a success if a UTR exists but the system hasn't matched it.

  * **Endpoint:** `/payable/utr/order`
  * **Method:** POST
  * **Content-Type:** `application/json`

### Request Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `userId` | Long | Yes | Merchant ID |
| `orderId` | String | Yes | Merchant Order ID |
| `utr` | String | Yes | The UTR number to match |
| `sign` | String | Yes | Signature |

### Response Parameters

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `data.status` | String | `nrcy`: Not Received, `used`: Already Used, `rcy`: Success, `stp`: Stopped, `aumt`: Amount Mismatch |
| `data.remark` | String | Description |

-----

## 7\. UPI Account Query

  * **Endpoint:** `/payable/upi`
  * **Method:** POST

### Request Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `appKey` | String | Yes | App Key |
| `nonce` | String | Yes | Random string (max 16 chars, unique) |
| `upi` | String | Yes | UPI ID to query |
| `sign` | String | Yes | Signature |

### Response Data

  * `upiStatus`: `0` (Active/In Use), `1` (Risk Control/Frozen).
  * `belongStatus`: `1` (Is our UPI), `0` (Not our UPI).

-----

## 8\. UTR Query

  * **Endpoint:** `/payable/utr/query`
  * **Method:** POST

### Request Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `userId` | Long | Yes | Merchant ID |
| `utr` | String | Yes | UTR Number |
| `sign` | String | Yes | Signature |

### Response Data

  * `status`: `nrcy` (Not received), `used` (Already credited), `rcy` (Available for supplement), `stp` (Account stopped).

-----

## 🔔 Callbacks (Webhooks)

### General Rules

1.  **Response Requirement:** You must return the plain string `success` immediately upon receiving the callback.
2.  **Retry Logic:** If `success` is not returned, the system considers the request failed and will retry **3 times** at **3-second intervals**.

### A. Payout Callback (代付回调)

**Method:** POST `application/json`

| Parameter | Description |
| :--- | :--- |
| `status` | `1`: Success, `2`: Failure |
| `amount` | Payout Amount |
| `commission` | Fee |
| `message` | Reason for failure (or "success") |
| `orderId` | Merchant Order ID |
| `id` | Platform Order ID |
| `utr` | Bank UTR (if success) |
| `sign` | Signature |

### B. Pay-in Callback (代收回调)

**Method:** POST `application/json`

| Parameter | Description |
| :--- | :--- |
| `status` | `1`: Success, `0`: Failure |
| `amount` | **Actual Received Amount** (Use this for crediting user) |
| `orderAmount` | Order Amount (Use for reference only) |
| `orderId` | Merchant Order ID |
| `id` | Platform Order ID |
| `sign` | Signature |

```

