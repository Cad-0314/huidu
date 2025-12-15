  
Payin

Silkpay API Integration Guide

This guide details the integration process for the Silkpay API, covering everything from key acquisition to payment completion.

**Sandbox Environment Details:**

* **Base URL:** `[https://api.dev.silkpay.ai](https://api.dev.silkpay.ai)`  
* **Base Merchant ID (`mId`):** `TEST`  
* **Base Secret Key:** `SIb3DQEBAQ`

\-----API Endpoints1. Create Payin Order (v2)

**Endpoint:** `POST [https://api.dev.silkpay.ai/transaction/payin/v2](https://api.dev.silkpay.ai/transaction/payin/v2)`

Creates a payin order and returns the cashier payment link. Request and response bodies are in JSON format.

**Request Body Example (application/json):**  
{  
  "amount": "100.00",  
  "mId": "TEST",  
  "mOrderId": "i001",  
  "timestamp": "1738917430509",  
  "notifyUrl": "http://localhost/silkpay",  
  "returnUrl": "http://localhost/paymentSuccess",  
  "sign": "94c1f115cd3a1128ab54d13b78fc7684"  
}

| Field | Type | Required | Description | Example |
| ----- | :---: | :---: | :---: | :---: |
| `amount` | string | Yes | Order amount. | `100.00` |
| `mId` | string | Yes | Merchant number (provided after account opening). | `TEST` |
| `mOrderId` | string | Yes | Merchant's unique order number (max 64 chars). | `i001` |
| `timestamp` | string | Yes | Timestamp, accurate to milliseconds. | `1738917430509` |
| `notifyUrl` | string | Yes | Callback notification address. | `http://localhost/silkpay` |
| `returnUrl` | string | No | URL to load after successful payment. | `http://localhost/paymentSuccess` |
| `sign` | string | Yes | Signature: `md5(mId+mOrderId+amount+timestamp+secret)`. 32-bit lowercase encryption. | `94c1f115cd3a1128ab54d13b78fc7684` |

**Success Response (200 application/json):**  
{  
  "status": "200",  
  "message": "success",  
  "data": {  
    "payOrderId": "i001",  
    "deepLink": {  
      "upi\_phonepe": "...",  
      "upi\_paytm": "...",  
      "upi\_scan": "..."  
    },  
    "paymentUrl": "https://dev.silkpay.club/\#/?orderNo=DS-1213123734865055884817413"  
  }  
}

| Field | Type | Description |
| ----- | :---: | :---: |
| `status` | string | Request result code. (200 for success) |
| `message` | string | Result code description. |
| `data` | object | Response data. |
| `data.payOrderId` | string | Gateway order number. |
| `data.deepLink` | object | Contains deep links for direct wallet wake-up and redirection. |
| `data.paymentUrl` | string | The payment link for the cashier page. |

\-----2. Payin Order Status Query

**Endpoint:** `POST [https://api.dev.silkpay.ai/transaction/payin/query](https://api.dev.silkpay.ai/transaction/payin/query)`

Queries the status of a payin order.

**Request Body Example (application/json):**  
{  
  "mId": "TEST",  
  "mOrderId": "i001",  
  "timestamp": "1738917430509",  
  "sign": "839c8c598f95f90772eb70256ff71d1a"  
}

| Field | Type | Required | Description | Example |
| ----- | :---: | :---: | :---: | :---: |
| `mId` | string | Yes | Merchant number. | `TEST` |
| `mOrderId` | string | Yes | Merchant order number. | `i001` |
| `timestamp` | string | Yes | Timestamp, accurate to milliseconds. | `1738917430509` |
| `sign` | string | Yes | Signature: `md5(mId+mOrderId+timestamp+key)`. 32-bit lowercase. | `839c8c598f95f90772eb70256ff71d1a` |

**Success Response (200 application/json):**  
{  
  "status": "200",  
  "message": "success",  
  "data": {  
    "amount": "102.33",  
    "payOrderId": "DS-1213123734865055884817413",  
    "utr": "411111234512",  
    "sign": "d6425056451597e17a67aa9bf0963ae0",  
    "mId": "TEST100",  
    "mOrderId": "i123",  
    "status": 1,  
    "timestamp": 1734070502860  
  }  
}

| Field | Type | Description |
| ----- | :---: | :---: |
| `data.amount` | string | Actual amount paid by the customer. |
| `data.payOrderId` | string | Gateway order number. |
| `data.utr` | string | UTR (Unique Transaction Reference). |
| `data.sign` | string | Response Signature: `md5(amount+merchantId+orderId+timestamp+secret)`. |
| `data.mId` | string | Merchant ID. |
| `data.mOrderId` | string | Merchant's submitted order number. |
| `data.status` | integer | Order status: **0: initialization**, **1: payment successful**, **2: payment failed**. |
| `data.timestamp` | string | Timestamp. |

\-----3. Payin Callback Notification

**Endpoint:** `POST {merchant_notifyUrl}` (The URL provided in the `notifyUrl` field of the Payin Order request).

This asynchronous interface notifies the merchant of the payment result. The merchant *must* verify parameter consistency and the signature. Upon successful receipt and verification, the merchant *must* return the string `OK`. Failure to return `OK` will result in retries (every 5 minutes, up to 5 times). Only `SUCCESS` orders were originally notified, but the documentation states it will now call back for both successful (1) and failed (2) status.

**Request Body Example (application/json):**  
{  
  "amount": "102.33",  
  "payOrderId": "DS-0207143510305405971089417",  
  "mId": "TEST",  
  "mOrderId": "12345678",  
  "sign": "80f7eb17fec33a6b7963fc113484642a",  
  "utr": "112233",  
  "status": 2,  
  "timestamp": "1687244719629"  
}

| Field | Type | Required | Description |
| ----- | :---: | :---: | :---: |
| `amount` | string | Yes | Actual amount paid by the customer. |
| `payOrderId` | string | Yes | Gateway order number. |
| `mId` | string | Yes | Merchant number. |
| `mOrderId` | string | Yes | Merchant order number. |
| `sign` | string | Yes | Signature: `md5(amount+mId+mOrderId+timestamp+secret)`. |
| `utr` | string | Yes | UTR. |
| `status` | integer | Yes | Order status: **1: payment successful**, **2: payment failed**. |
| `timestamp` | string | Yes | Timestamp, accurate to milliseconds. |

**Expected Response (200):**

`OK`\-----4. Submit UTR & Order ID for Compensation

**Endpoint:** `POST [https://api.dev.silkpay.ai/transaction/payin/submit/utr](https://api.dev.silkpay.ai/transaction/payin/submit/utr)`

Used to re-associate a UTR with an order (compensation). The re-order will fail if the amount does not match.

**Request Body Example (application/json):**  
{  
  "mId": "TEST",  
  "utr": "12345678",  
  "mOrderId": "i001",  
  "sign": "6fce1b7405dd7d11c0e45d3931c7ecb1",  
  "timestamp": "1738917430509"  
}

| Field | Type | Required | Description |
| ----- | :---: | :---: | :---: |
| `mId` | string | Yes | Merchant number. |
| `utr` | string | Yes | UTR. |
| `mOrderId` | string | Yes | Merchant order number. |
| `sign` | string | Yes | Signature: `md5(mId+timestamp+secret)`. |
| `timestamp` | string | Yes | Timestamp. |

**Success Response (200 application/json):**  
{  
  "status": "200",  
  "message": "success",  
  "data": {  
    "code": 1,  
    "msg": "SUCCESS",  
    "mOrderId": "i001",  
    "amount": null  
  }  
}

| Field | Type | Description |
| ----- | :---: | :---: |
| `data.code` | string | Return code: **1** for successful order processing, others for failure. |
| `data.msg` | string | Result code description. |
| `data.amount` | string | Actual amount paid by the customer. |
| `data.mOrderId` | string | Merchant's submitted order number. |

\-----5. UTR Query Order

**Endpoint:** `POST [https://api.dev.silkpay.ai/transaction/payin/query/utr](https://api.dev.silkpay.ai/transaction/payin/query/utr)`

Queries order details using the UTR.

**Request Body Example (application/json):**  
{  
  "mId": "TEST",  
  "utr": "411111234512",  
  "sign": "6fce1b7405dd7d11c0e45d3931c7ecb1",  
  "timestamp": "1738917430509"  
}

| Field | Type | Required | Description |
| ----- | :---: | :---: | :---: |
| `mId` | string | Yes | Merchant number. |
| `utr` | string | Yes | UTR. |
| `sign` | string | Yes | Signature: `md5(mId+timestamp+secret)`. |
| `timestamp` | string | Yes | Timestamp. |

**Success Response (200 application/json):**  
{  
  "status": "200",  
  "message": "success",  
  "data": {  
    "msg": "UTR received: 10.00",  
    "amount": 10,  
    "code": 1,  
    "mOrderId": null  
  }  
}

| Field | Type | Description |
| ----- | ----- | ----- |
| `data.code` | string | Check order return code: **1** means a new order can be created (for compensation), otherwise not. |
| `data.msg` | string | Result code description. |
| `data.amount` | string | Actual amount paid by the customer. |
| `data.mOrderId` | string | The order number submitted by the merchant. |

