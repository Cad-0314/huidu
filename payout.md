payout  
[**Overview**](https://silkpay.stoplight.io/docs/silkpay/branches/main/up7ld1c9b7lsw-integration-guide#overview)

This guide will help you quickly integrate the Silkpay API, from obtaining an API key to completing the payment process.

* Sandbox Base URL: [https://api.dev.silkpay.ai](https://api.dev.silkpay.ai/)  
* Sandbox Base merchant: TEST  
* Sandbox Base secret key: SIb3DQEBAQ

# **Create payout order**

post  
https://api.dev.silkpay.ai/transaction/payout  
create a payout order

## [**Request**](https://silkpay.stoplight.io/docs/silkpay/branches/main/e9dyjmj7emllc-create-payout-order#Request)

### [**Body**](https://silkpay.stoplight.io/docs/silkpay/branches/main/e9dyjmj7emllc-create-payout-order#request-body)

application/json  
application/json  
{ "amount": "100.00", "mId": "TEST", "mOrderId": "o001", "timestamp": "1738917430509", "notifyUrl": "[http://localhost/silkpay](http://localhost/silkpay)", "upi": "", "bankNo": "2983900989", "ifsc": "ICIC0000001", "name": "MAND", "sign": "d7ab0026e9c3059edabfb9b0a0a51df2" }  
amount  
string  
required  
Order amount, example:100.00 inr  
Example:  
100.00  
mId  
string  
required  
Merchant number, provided after account opening, example: TEST  
mOrderId  
string  
required  
Merchant order number, within 64 characters, example: 12345678  
timestamp  
string  
required  
Timestamp, accurate to milliseconds, example: 1647760272251  
notifyUrl  
string  
required  
Callback notification address, for example: [http://localhost/silkpay](http://localhost/silkpay)  
upi  
string  
bankNo  
string  
Account of Beneficiary.  
ifsc  
string  
IFSC of Beneficiary.  
name  
string  
required  
Name of Beneficiary.  
sign  
string  
required  
Signature, md5(mId+mOrderId+amount+timestamp+secret) is used for MD5 encryption, 32 characters in lowercase.

## [**Responses**](https://silkpay.stoplight.io/docs/silkpay/branches/main/e9dyjmj7emllc-create-payout-order#Responses)

200  
5XX  
{ "status": "200", "message": "success", "data": { "payOrderId": "DF-0207163775560828775345156" } }

### [**Body**](https://silkpay.stoplight.io/docs/silkpay/branches/main/e9dyjmj7emllc-create-payout-order#response-body)

application/json  
application/json  
status  
string  
Request result code, success is 200, other values ​​please refer to the error code comparison table in Appendix 1, request success does not mean payment success, payment status can be processed in the notification result, or query the payment order status  
message  
string  
Result code description  
data  
object  
none  
payOrderId  
string  
Payment gateway order number

# **Payout order status inquiry**

post  
https://api.dev.silkpay.ai/transaction/payout/query  
Payout order status inquiry

## [**Request**](https://silkpay.stoplight.io/docs/silkpay/branches/main/stupbersvt4zv-payout-order-status-inquiry#Request)

### [**Body**](https://silkpay.stoplight.io/docs/silkpay/branches/main/stupbersvt4zv-payout-order-status-inquiry#request-body)

application/json  
application/json  
{ "mId": "TEST", "mOrderId": "o001", "timestamp": "1738917430509", "sign": "c4725c96cb90acbf49bdfbf72ce41ed2" }  
mId  
string  
required  
Merchant number, provided after account opening, example: TEST  
mOrderId  
string  
required  
Merchant order number, within 64 characters, example: 12345678  
timestamp  
string  
required  
Timestamp, accurate to milliseconds, example: 1647760272251  
sign  
string  
required  
Signature, md5(mId+mOrderId+timestamp+secret) is used for MD5 encryption, 32 characters in lowercase.

## [**Responses**](https://silkpay.stoplight.io/docs/silkpay/branches/main/stupbersvt4zv-payout-order-status-inquiry#Responses)

200  
{ "status": "200", "message": "success", "data": { "amount": "100.00", "payOrderId": "DF-0207163775560828775345156", "utr": null, "sign": "cd0b7a5cca06f7b9456692add9cae6ed", "mId": "TEST", "mOrderId": "o001", "status": 2, "timestamp": 1738917709881 } }

### [**Body**](https://silkpay.stoplight.io/docs/silkpay/branches/main/stupbersvt4zv-payout-order-status-inquiry#response-body)

application/json  
application/json  
responses  
/  
200  
status  
string  
Request result code, success is 200, other values ​​are shown in the error code comparison table in Appendix 1  
message  
string  
Result code description  
data  
object  
amount  
string  
The actual amount paid by the customer, in INR  
payOrderId  
string  
When a merchant requests payment and places an order, the gateway order number is returned in the response result.  
utr  
string  
sign  
string  
Signature, md5(amount+merchantId+orderId+timestamp+secret) for MD5 encryption, 32 lowercase characters  
mId  
string  
Merchant ID  
mOrderId  
string  
The order number submitted by the merchant when requesting collection  
status  
integer  
Order status, 0: Initial, 1: Processing, 2: Payment successful, 3: Payment failed  
timestamp  
string  
Timestamp, accurate to milliseconds, example: 1687510573621

# **Payout callback**

post  
https://api.dev.silkpay.ai/callback  
Payment result asynchronous notification interface for payment order The payment callback address is provided by the merchant, and is the notifyUrl field submitted by the merchant when making a payment request. After receiving the callback, the merchant must verify the consistency of the parameters and determine whether the sign is consistent. After receiving the callback, the merchant needs to return the string OK to confirm that the callback is successful, otherwise we will retry every 5 minutes, up to 5 times.

## [**Request**](https://silkpay.stoplight.io/docs/silkpay/branches/main/ishhfp3aao7b7-payout-callback#Request)

### [**Body**](https://silkpay.stoplight.io/docs/silkpay/branches/main/ishhfp3aao7b7-payout-callback#request-body)

application/json  
application/json  
{ "amount": "102.33", "payOrderId": "DF-0207173510390431811270665", "mId": "TEST", "mOrderId": "12345679", "utr": "112233", "sign": "80f7eb17fec33a6b7963fc113484642a", "status": 2, "timestamp": "1687244719629" }  
amount  
string  
required  
The actual amount paid by the customer  
payOrderId  
string  
required  
When a merchant requests payment and places an order, the gateway order number is returned in the response result.  
mId  
string  
required  
Merchant ID  
mOrderId  
string  
required  
The order number submitted by the merchant when requesting collection  
utr  
string  
required  
UTR  
sign  
string  
required  
Signature, md5(mId+mOrderId+amount+timestamp+secret) for MD5 encryption, 32 lowercase characters  
status  
integer  
required  
Order status, 2: payment successful, 3: payment failed.  
timestamp  
string  
required  
Timestamp, accurate to milliseconds, example: 1687510573621

## [**Responses**](https://silkpay.stoplight.io/docs/silkpay/branches/main/ishhfp3aao7b7-payout-callback#Responses)

200  
OK

### [**Body**](https://silkpay.stoplight.io/docs/silkpay/branches/main/ishhfp3aao7b7-payout-callback#response-body)

### 

# **Merchant balance inquiry**

post  
https://api.dev.silkpay.ai/transaction/balance  
merchant balance inquiry

## [**Request**](https://silkpay.stoplight.io/docs/silkpay/branches/main/n10oj6onf8yc5-merchant-balance-inquiry#Request)

### [**Body**](https://silkpay.stoplight.io/docs/silkpay/branches/main/n10oj6onf8yc5-merchant-balance-inquiry#request-body)

application/json  
application/json  
{ "mId":"TEST", "timestamp":"1738917430509", "sign":"6fce1b7405dd7d11c0e45d3931c7ecb1" }  
mId  
string  
required  
Merchant number, provided after account opening, example: TEST  
timestamp  
string  
required  
Timestamp, accurate to milliseconds, example: 1647760272251  
sign  
string  
required  
Signature, md5(mId+timestamp+secret) is used for MD5 encryption, 32 characters in lowercase.

## [**Responses**](https://silkpay.stoplight.io/docs/silkpay/branches/main/n10oj6onf8yc5-merchant-balance-inquiry#Responses)

200  
{ "status": "200", "message": "success", "data": { "availableAmount": 259.5, "pendingAmount": 0, "totalAmount": 259.5, "sign": null } }

### [**Body**](https://silkpay.stoplight.io/docs/silkpay/branches/main/n10oj6onf8yc5-merchant-balance-inquiry#response-body)

application/json  
application/json  
status  
string  
Request result code, success is 200, other values ​​please refer to the error code comparison table in Appendix 1, request success does not mean payment success, payment status can be processed in the notification result, or query the payment order status  
message  
string  
Result code description  
data  
object  
none  
availableAmount  
string  
available balance  
pendingAmount  
string  
Freeze balance  
totalAmount  
string  
Total, Available \+ Blocked  
sign  
string  
null

Silkpay Payout API Integration Guide

This guide details the integration steps for the Silkpay Payout API, from setup to order processing.

**Sandbox Environment Details:**

* **Base URL:** `[https://api.dev.silkpay.ai](https://api.dev.silkpay.ai)`  
* **Merchant ID:** `TEST`  
* **Secret Key:** `SIb3DQEBAQ`

\-----1. Create Payout Order

**Endpoint:** `POST [https://api.dev.silkpay.ai/transaction/payout](https://api.dev.silkpay.ai/transaction/payout)`

This request is used to initiate a new payout transaction.

| Parameter | Type | Required | Description | Example |
| ----- | :---: | :---: | :---: | :---: |
| `amount` | string | Yes | Order amount (e.g., in INR) | `100.00` |
| `mId` | string | Yes | Merchant ID (provided post-account opening) | `TEST` |
| `mOrderId` | string | Yes | Unique Merchant Order Number (max 64 chars) | `o001` |
| `timestamp` | string | Yes | Timestamp, accurate to milliseconds | `1738917430509` |
| `notifyUrl` | string | Yes | Callback notification address | `http://localhost/silkpay` |
| `upi` | string | No | UPI of Beneficiary |  |
| `bankNo` | string | No | Account Number of Beneficiary | `2983900989` |
| `ifsc` | string | No | IFSC of Beneficiary | `ICIC0000001` |
| `name` | string | Yes | Name of Beneficiary | `MAND` |
| `sign` | string | Yes | Signature: `md5(mId+mOrderId+amount+timestamp+secret)` (32 lowercase characters) | `d7ab0026e9c3059edabfb9b0a0a51df2` |

**Request Body Example (application/json):**  
{  
  "amount": "100.00",  
  "mId": "TEST",  
  "mOrderId": "o001",  
  "timestamp": "1738917430509",  
  "notifyUrl": "http://localhost/silkpay",  
  "upi": "",  
  "bankNo": "2983900989",  
  "ifsc": "ICIC0000001",  
  "name": "MAND",  
  "sign": "d7ab0026e9c3059edabfb9b0a0a51df2"  
}  
**Successful Response (HTTP 200\) Body Example (application/json):**  
| Parameter | Type | Description |  
| :--- | :--- | :--- |  
| `status` | string | Request result code (`200` for success). Note: Request success does not imply payment success. Check notification/query for payment status. |  
| `message` | string | Result code description |  
| `data` | object | Container for response data |  
| `data.payOrderId` | string | Payment gateway order number |  
{  
  "status": "200",  
  "message": "success",  
  "data": {  
    "payOrderId": "DF-0207163775560828775345156"  
  }  
}  
\-----2. Payout Order Status Inquiry

**Endpoint:** `POST [https://api.dev.silkpay.ai/transaction/payout/query](https://api.dev.silkpay.ai/transaction/payout/query)`

Used to check the status of a specific payout order.

| Parameter | Type | Required | Description | Example |
| ----- | :---: | :---: | :---: | :---: |
| `mId` | string | Yes | Merchant ID | `TEST` |
| `mOrderId` | string | Yes | Merchant Order Number | `o001` |
| `timestamp` | string | Yes | Timestamp, accurate to milliseconds | `1738917430509` |
| `sign` | string | Yes | Signature: `md5(mId+mOrderId+timestamp+secret)` (32 lowercase characters) | `c4725c96cb90acbf49bdfbf72ce41ed2` |

**Request Body Example (application/json):**  
{  
  "mId": "TEST",  
  "mOrderId": "o001",  
  "timestamp": "1738917430509",  
  "sign": "c4725c96cb90acbf49bdfbf72ce41ed2"  
}  
**Successful Response (HTTP 200\) Body Example (application/json):**

| Parameter | Type | Description |
| ----- | :---: | :---: |
| `status` | string | Request result code (`200` for success) |
| `message` | string | Result code description |
| `data.amount` | string | The actual paid amount (in INR) |
| `data.payOrderId` | string | Gateway order number |
| `data.utr` | string | UTR (Unique Transaction Reference) |
| `data.sign` | string | Signature: `md5(amount+merchantId+orderId+timestamp+secret)` |
| `data.mId` | string | Merchant ID |
| `data.mOrderId` | string | Merchant submitted order number |
| `data.status` | integer | Order status: 0: Initial, 1: Processing, 2: Payment successful, 3: Payment failed |
| `data.timestamp` | string | Timestamp, accurate to milliseconds |

{  
  "status": "200",  
  "message": "success",  
  "data": {  
    "amount": "100.00",  
    "payOrderId": "DF-0207163775560828775345156",  
    "utr": null,  
    "sign": "cd0b7a5cca06f7b9456692add9cae6ed",  
    "mId": "TEST",  
    "mOrderId": "o001",  
    "status": 2,  
    "timestamp": 1738917709881  
  }  
}  
\-----3. Payout Callback

**Endpoint:** `POST [https://api.dev.silkpay.ai/callback](https://api.dev.silkpay.ai/callback)`

This is the asynchronous notification sent to the merchant's `notifyUrl` upon payment completion (success or failure). Merchants *must* verify parameter consistency and signature (`sign`). The merchant *must* return the string **`OK`** to acknowledge successful receipt, otherwise, retries will occur every 5 minutes (up to 5 times).

| Parameter | Type | Required | Description | Example |
| ----- | :---: | :---: | :---: | :---: |
| `amount` | string | Yes | The actual amount paid | `102.33` |
| `payOrderId` | string | Yes | Gateway order number | `DF-0207173510390431811270665` |
| `mId` | string | Yes | Merchant ID | `TEST` |
| `mOrderId` | string | Yes | Merchant order number | `12345679` |
| `utr` | string | Yes | UTR (Unique Transaction Reference) | `112233` |
| `sign` | string | Yes | Signature: `md5(mId+mOrderId+amount+timestamp+secret)` | `80f7eb17fec33a6b7963fc113484642a` |
| `status` | integer | Yes | Order status: 2: Payment successful, 3: Payment failed | `2` |
| `timestamp` | string | Yes | Timestamp, accurate to milliseconds | `1687244719629` |

**Response (HTTP 200):**  
`OK`\-----4. Merchant Balance Inquiry

**Endpoint:** `POST [https://api.dev.silkpay.ai/transaction/balance](https://api.dev.silkpay.ai/transaction/balance)`

Used to query the merchant's current balance.

| Parameter | Type | Required | Description | Example |
| ----- | :---: | :---: | :---: | :---: |
| `mId` | string | Yes | Merchant ID | `TEST` |
| `timestamp` | string | Yes | Timestamp, accurate to milliseconds | `1738917430509` |
| `sign` | string | Yes | Signature: `md5(mId+timestamp+secret)` (32 lowercase characters) | `6fce1b7405dd7d11c0e45d3931c7ecb1` |

**Request Body Example (application/json):**  
{  
  "mId": "TEST",  
  "timestamp": "1738917430509",  
  "sign": "6fce1b7405dd7d11c0e45d3931c7ecb1"  
}  
**Successful Response (HTTP 200\) Body Example (application/json):**

| Parameter | Type | Description |
| ----- | ----- | ----- |
| `status` | string | Request result code (`200` for success) |
| `message` | string | Result code description |
| `data.availableAmount` | string | Available balance |
| `data.pendingAmount` | string | Freeze (Pending) balance |
| `data.totalAmount` | string | Total balance (`Available + Pending`) |
| `data.sign` | string | null |

{  
  "status": "200",  
  "message": "success",  
  "data": {  
    "availableAmount": 259.5,  
    "pendingAmount": 0,  
    "totalAmount": 259.5,  
    "sign": null  
  }  
}