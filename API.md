# Huidu Payment Platform API Verification

## Payin API

### Create Payin Order
Creates a new payin order.

**Endpoint:** `POST /api/payin/create`
**Headers:**
- `Content-Type: application/json`
- `x-merchant-id`: Your Merchant ID
- `x-signature`: MD5 Signature

**Request Body:**
```json
{
    "orderId": "YOUR_ORDER_ID_001",
    "orderAmount": "100.00",
    "callbackUrl": "https://your-site.com/callback",
    "skipUrl": "https://your-site.com/success",
    "param": "Any extra data (optional)"
}
```

**Response (Success):**
```json
{
    "code": 1,
    "msg": "Order created",
    "data": {
        "orderId": "YOUR_ORDER_ID_001",
        "id": "uuid-here",
        "orderAmount": 100,
        "fee": 2.0,
        "paymentUrl": "http://huidu-server.com/pay/ORDER_ID"
    }
}
```

### Query Order
Check the status of an order using your Order ID.

**Endpoint:** `POST /api/payin/query`
**Headers:** (Auth required)

**Request Body:**
```json
{
    "orderId": "YOUR_ORDER_ID_001"
}
```

**Response:**
```json
{
    "code": 1,
    "data": {
        "orderId": "YOUR_ORDER_ID_001",
        "status": "pending|success|failed",
        "amount": 100,
        "utr": "123456789012",
        "createdAt": "2025-..."
    }
}
```

### Check Order (Public)
Check order status using platform UUID (returned in create response).

**Endpoint:** `POST /api/payin/check`

**Request Body:**
```json
{
    "orderId": "YOUR_ORDER_ID",
    "userId": "MERCHANT_USER_UUID"
}
```

### Check UTR
Verify if a UTR exists.

**Endpoint:** `POST /api/payin/check-utr`

**Request Body:**
```json
{
    "utr": "123456789012",
    "userId": "MERCHANT_USER_UUID" 
}
```
