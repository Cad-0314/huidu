// ========================================
// HUIDU-PAYABLE - Main Application
// ========================================

// API Helper
const API = {
    baseUrl: '/api',
    token: localStorage.getItem('huidu_token'),

    async request(endpoint, options = {}) {
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers
        };

        if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }

        const response = await fetch(`${this.baseUrl}${endpoint}`, {
            ...options,
            headers
        });

        if (response.status === 401) {
            logout();
            throw new Error('Session expired');
        }

        return response.json();
    },

    get(endpoint) {
        return this.request(endpoint);
    },

    post(endpoint, data) {
        return this.request(endpoint, {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },

    put(endpoint, data) {
        return this.request(endpoint, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    }
};

// State
let currentUser = null;
let currentSection = 'dashboard';

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    setupNavigation();
});

function checkAuth() {
    const token = localStorage.getItem('huidu_token');
    const user = localStorage.getItem('huidu_user');

    if (!token || !user) {
        window.location.href = '/login.html';
        return;
    }

    currentUser = JSON.parse(user);
    updateUserInfo();
    loadSection('dashboard');
    loadBalance();

    if (currentUser.role === 'admin') {
        document.getElementById('adminNav').classList.remove('hidden');
        loadPendingCount();
    }
}

function updateUserInfo() {
    document.getElementById('userName').textContent = currentUser.name;
    document.getElementById('userRole').textContent = currentUser.role === 'admin' ? 'Administrator' : 'Merchant';
    document.getElementById('userAvatar').textContent = currentUser.name.charAt(0).toUpperCase();
}

async function loadBalance() {
    try {
        const data = await API.get('/merchant/balance');
        if (data.code === 1) {
            document.getElementById('balanceDisplay').textContent = `Balance: ₹${parseFloat(data.data.balance).toFixed(2)}`;
        }
    } catch (error) {
        console.error('Failed to load balance:', error);
    }
}

async function loadPendingCount() {
    try {
        const data = await API.get('/admin/payouts/pending');
        if (data.code === 1) {
            const count = data.data.length;
            document.getElementById('pendingBadge').textContent = count;
            document.getElementById('pendingBadge').style.display = count > 0 ? 'block' : 'none';
        }
    } catch (error) {
        console.error('Failed to load pending count:', error);
    }
}

function setupNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            const section = item.dataset.section;
            if (section) {
                loadSection(section);
            }
        });
    });
}

function loadSection(section) {
    currentSection = section;

    // Update active nav
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.section === section) {
            item.classList.add('active');
        }
    });

    // Update title
    const titles = {
        'dashboard': 'Dashboard',
        'transactions': 'Transactions',
        'payouts': 'Payouts',
        'payment-links': 'Payment Links',
        'api-docs': 'API Documentation',
        'credentials': 'API Credentials',
        'users': 'Merchant Management',
        'approvals': 'Pending Approvals',
        'all-transactions': 'All Transactions'
    };
    document.getElementById('pageTitle').textContent = titles[section] || 'Dashboard';

    // Load content
    const contentArea = document.getElementById('contentArea');

    switch (section) {
        case 'dashboard':
            loadDashboard();
            break;
        case 'transactions':
            loadTransactions();
            break;
        case 'payouts':
            loadPayouts();
            break;
        case 'payment-links':
            loadPaymentLinks();
            break;
        case 'api-docs':
            loadApiDocs();
            break;
        case 'credentials':
            loadCredentials();
            break;
        case 'users':
            loadUsers();
            break;
        case 'approvals':
            loadApprovals();
            break;
        case 'all-transactions':
            loadAllTransactions();
            break;
        default:
            loadDashboard();
    }
}

// ========================================
// DASHBOARD
// ========================================

async function loadDashboard() {
    const content = document.getElementById('contentArea');
    content.innerHTML = `
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-icon purple"><i class="fas fa-wallet"></i></div>
                <div class="stat-info">
                    <div class="stat-label">Current Balance</div>
                    <div class="stat-value" id="statBalance">₹0.00</div>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon green"><i class="fas fa-arrow-down"></i></div>
                <div class="stat-info">
                    <div class="stat-label">Total Pay-In</div>
                    <div class="stat-value" id="statPayin">₹0.00</div>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon red"><i class="fas fa-arrow-up"></i></div>
                <div class="stat-info">
                    <div class="stat-label">Total Payout</div>
                    <div class="stat-value" id="statPayout">₹0.00</div>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon blue"><i class="fas fa-clock"></i></div>
                <div class="stat-info">
                    <div class="stat-label">Pending Payouts</div>
                    <div class="stat-value" id="statPending">0</div>
                </div>
            </div>
        </div>
        
        <div class="card">
            <div class="card-header">
                <h3 class="card-title">Recent Transactions</h3>
                <button class="btn btn-secondary btn-sm" onclick="loadSection('transactions')">
                    View All <i class="fas fa-arrow-right"></i>
                </button>
            </div>
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Order ID</th>
                            <th>Type</th>
                            <th>Amount</th>
                            <th>Fee</th>
                            <th>Status</th>
                            <th>Date</th>
                        </tr>
                    </thead>
                    <tbody id="recentTransactions">
                        <tr><td colspan="6" class="text-muted" style="text-align:center;">Loading...</td></tr>
                    </tbody>
                </table>
            </div>
        </div>
    `;

    // Load stats
    try {
        const statsData = await API.get('/merchant/stats');
        if (statsData.code === 1) {
            const stats = statsData.data;
            document.getElementById('statBalance').textContent = `₹${parseFloat(stats.balance).toFixed(2)}`;
            document.getElementById('statPayin').textContent = `₹${parseFloat(stats.payin.total).toFixed(2)}`;
            document.getElementById('statPayout').textContent = `₹${parseFloat(stats.payout.total).toFixed(2)}`;
            document.getElementById('statPending').textContent = stats.pendingPayouts;
        }
    } catch (error) {
        console.error('Failed to load stats:', error);
    }

    // Load recent transactions
    try {
        const txData = await API.get('/merchant/transactions?limit=5');
        if (txData.code === 1 && txData.data.transactions.length > 0) {
            document.getElementById('recentTransactions').innerHTML = txData.data.transactions.map(tx => `
                <tr>
                    <td><code>${tx.orderId}</code></td>
                    <td><span class="badge ${tx.type === 'payin' ? 'badge-success' : 'badge-pending'}">${tx.type}</span></td>
                    <td>₹${parseFloat(tx.amount).toFixed(2)}</td>
                    <td>₹${parseFloat(tx.fee).toFixed(2)}</td>
                    <td><span class="badge badge-${getStatusClass(tx.status)}">${tx.status}</span></td>
                    <td>${formatDate(tx.createdAt)}</td>
                </tr>
            `).join('');
        } else {
            document.getElementById('recentTransactions').innerHTML = `
                <tr><td colspan="6" class="text-muted" style="text-align:center;">No transactions yet</td></tr>
            `;
        }
    } catch (error) {
        console.error('Failed to load transactions:', error);
    }
}

// ========================================
// TRANSACTIONS
// ========================================

async function loadTransactions() {
    const content = document.getElementById('contentArea');
    content.innerHTML = `
        <div class="card">
            <div class="card-header">
                <h3 class="card-title">Transaction History</h3>
            </div>
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Order ID</th>
                            <th>Type</th>
                            <th>Amount</th>
                            <th>Fee</th>
                            <th>Net Amount</th>
                            <th>Status</th>
                            <th>UTR</th>
                            <th>Date</th>
                        </tr>
                    </thead>
                    <tbody id="transactionsList">
                        <tr><td colspan="8" class="text-muted" style="text-align:center;">Loading...</td></tr>
                    </tbody>
                </table>
            </div>
        </div>
    `;

    try {
        const data = await API.get('/merchant/transactions?limit=50');
        if (data.code === 1 && data.data.transactions.length > 0) {
            document.getElementById('transactionsList').innerHTML = data.data.transactions.map(tx => `
                <tr>
                    <td><code>${tx.orderId}</code></td>
                    <td><span class="badge ${tx.type === 'payin' ? 'badge-success' : 'badge-pending'}">${tx.type}</span></td>
                    <td>₹${parseFloat(tx.amount).toFixed(2)}</td>
                    <td>₹${parseFloat(tx.fee).toFixed(2)}</td>
                    <td>₹${parseFloat(tx.netAmount).toFixed(2)}</td>
                    <td><span class="badge badge-${getStatusClass(tx.status)}">${tx.status}</span></td>
                    <td>${tx.utr || '-'}</td>
                    <td>${formatDate(tx.createdAt)}</td>
                </tr>
            `).join('');
        } else {
            document.getElementById('transactionsList').innerHTML = `
                <tr><td colspan="8" class="text-muted" style="text-align:center;">No transactions found</td></tr>
            `;
        }
    } catch (error) {
        console.error('Failed to load transactions:', error);
        showToast('Failed to load transactions', 'error');
    }
}

// ========================================
// PAYOUTS
// ========================================

async function loadPayouts() {
    const content = document.getElementById('contentArea');
    content.innerHTML = `
        <div class="stats-grid" style="grid-template-columns: repeat(2, 1fr);">
            <div class="card" style="cursor: pointer;" onclick="showBankPayoutModal()">
                <div class="d-flex align-center gap-2">
                    <div class="stat-icon green"><i class="fas fa-university"></i></div>
                    <div>
                        <h3>Bank Payout</h3>
                        <p class="text-muted" style="font-size: 0.875rem;">Automatic processing via IMPS/NEFT</p>
                    </div>
                </div>
            </div>
            <div class="card" style="cursor: pointer;" onclick="showUsdtPayoutModal()">
                <div class="d-flex align-center gap-2">
                    <div class="stat-icon blue"><i class="fab fa-bitcoin"></i></div>
                    <div>
                        <h3>USDT Payout</h3>
                        <p class="text-muted" style="font-size: 0.875rem;">Manual approval required</p>
                    </div>
                </div>
            </div>
        </div>
        
        <div class="card">
            <div class="card-header">
                <h3 class="card-title">Payout History</h3>
            </div>
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Order ID</th>
                            <th>Type</th>
                            <th>Amount</th>
                            <th>Fee</th>
                            <th>Details</th>
                            <th>Status</th>
                            <th>Date</th>
                        </tr>
                    </thead>
                    <tbody id="payoutsList">
                        <tr><td colspan="7" class="text-muted" style="text-align:center;">Loading...</td></tr>
                    </tbody>
                </table>
            </div>
        </div>
    `;

    try {
        const data = await API.get('/merchant/payouts?limit=50');
        if (data.code === 1 && data.data.length > 0) {
            document.getElementById('payoutsList').innerHTML = data.data.map(p => `
                <tr>
                    <td><code>${p.orderId}</code></td>
                    <td><span class="badge ${p.type === 'bank' ? 'badge-success' : 'badge-processing'}">${p.type}</span></td>
                    <td>₹${parseFloat(p.amount).toFixed(2)}</td>
                    <td>₹${parseFloat(p.fee).toFixed(2)}</td>
                    <td>${p.type === 'bank' ? (p.accountNumber ? `****${p.accountNumber.slice(-4)}` : '-') : (p.walletAddress ? `${p.walletAddress.substring(0, 8)}...` : '-')}</td>
                    <td><span class="badge badge-${getStatusClass(p.status)}">${p.status}</span></td>
                    <td>${formatDate(p.createdAt)}</td>
                </tr>
            `).join('');
        } else {
            document.getElementById('payoutsList').innerHTML = `
                <tr><td colspan="7" class="text-muted" style="text-align:center;">No payouts found</td></tr>
            `;
        }
    } catch (error) {
        console.error('Failed to load payouts:', error);
        showToast('Failed to load payouts', 'error');
    }
}

async function showBankPayoutModal() {
    // Fetch current balance
    let balanceText = 'Loading...';
    try {
        const data = await API.get('/merchant/balance');
        if (data.code === 1) {
            balanceText = `₹${parseFloat(data.data.balance).toFixed(2)}`;
        }
    } catch (e) { balanceText = 'Error loading'; }

    document.getElementById('modalTitle').textContent = 'Bank Payout';
    document.getElementById('modalBody').innerHTML = `
        <div class="balance-info-box">
            <div class="balance-label">Available Balance</div>
            <div class="balance-amount">${balanceText}</div>
        </div>
        <div class="alert alert-info mb-3">
            <i class="fas fa-info-circle"></i>
            <span>Fee: 3% + ₹6 | Minimum: ₹100</span>
        </div>
        <form id="bankPayoutForm">
            <div class="form-group">
                <label>Amount (₹)</label>
                <input type="number" id="bankAmount" placeholder="Enter amount" required min="100">
            </div>
            <div class="form-group">
                <label>Account Number</label>
                <input type="text" id="bankAccount" placeholder="Bank account number" required>
            </div>
            <div class="form-group">
                <label>IFSC Code</label>
                <input type="text" id="bankIfsc" placeholder="e.g. SBIN0001234" required>
            </div>
            <div class="form-group">
                <label>Account Holder Name</label>
                <input type="text" id="bankName" placeholder="Account holder name" required>
            </div>
        </form>
    `;
    document.getElementById('modalFooter').innerHTML = `
        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="submitBankPayout()">Submit Payout</button>
    `;
    document.getElementById('modalOverlay').classList.add('active');
}

async function submitBankPayout() {
    const amount = document.getElementById('bankAmount').value;
    const account = document.getElementById('bankAccount').value;
    const ifsc = document.getElementById('bankIfsc').value;
    const name = document.getElementById('bankName').value;

    if (!amount || !account || !ifsc || !name) {
        showToast('Please fill all fields', 'error');
        return;
    }

    try {
        const orderId = 'ORD_' + Date.now();
        const data = await API.post('/payout/bank', {
            userId: currentUser.id,
            amount: amount,
            orderId: orderId,
            account: account,
            ifsc: ifsc,
            personName: name,
            sign: 'frontend' // Will use session auth
        });

        if (data.code === 1) {
            showToast('Bank payout submitted successfully!', 'success');
            closeModal();
            loadPayouts();
            loadBalance();
        } else {
            showToast(data.msg || 'Failed to create payout', 'error');
        }
    } catch (error) {
        showToast('Error creating payout', 'error');
    }
}

async function showUsdtPayoutModal() {
    // Fetch current balance
    let balanceText = 'Loading...';
    try {
        const data = await API.get('/merchant/balance');
        if (data.code === 1) {
            balanceText = `₹${parseFloat(data.data.balance).toFixed(2)}`;
        }
    } catch (e) { balanceText = 'Error loading'; }

    document.getElementById('modalTitle').textContent = 'USDT Payout';
    document.getElementById('modalBody').innerHTML = `
        <div class="balance-info-box">
            <div class="balance-label">Available Balance</div>
            <div class="balance-amount">${balanceText}</div>
        </div>
        <div class="alert alert-info mb-3">
            <i class="fas fa-info-circle"></i>
            <span>Fee: 3% + ₹6 | Minimum: 500 USDT (₹51,500) | Rate: 1 USDT = ₹103 | Requires admin approval</span>
        </div>
        <form id="usdtPayoutForm">
            <div class="form-group">
                <label>Amount (₹) - Will be converted to USDT at ₹103/USDT</label>
                <input type="number" id="usdtAmount" placeholder="Enter amount in INR (min ₹51,500)" required min="51500">
            </div>
            <div class="form-group">
                <label>Wallet Address</label>
                <input type="text" id="usdtWallet" placeholder="USDT wallet address" required>
            </div>
            <div class="form-group">
                <label>Network</label>
                <select id="usdtNetwork" required>
                    <option value="">Select network</option>
                    <option value="TRC20">TRC20 (Tron)</option>
                    <option value="ERC20">ERC20 (Ethereum)</option>
                    <option value="BEP20">BEP20 (BSC)</option>
                </select>
            </div>
        </form>
    `;
    document.getElementById('modalFooter').innerHTML = `
        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="submitUsdtPayout()">Submit Payout</button>
    `;
    document.getElementById('modalOverlay').classList.add('active');
}

async function submitUsdtPayout() {
    const amount = document.getElementById('usdtAmount').value;
    const wallet = document.getElementById('usdtWallet').value;
    const network = document.getElementById('usdtNetwork').value;

    if (!amount || !wallet || !network) {
        showToast('Please fill all fields', 'error');
        return;
    }

    try {
        const orderId = 'ORD_' + Date.now();
        const data = await API.post('/payout/usdt', {
            userId: currentUser.id,
            amount: amount,
            orderId: orderId,
            walletAddress: wallet,
            network: network,
            sign: 'frontend'
        });

        if (data.code === 1) {
            showToast('USDT payout submitted for approval!', 'success');
            closeModal();
            loadPayouts();
            loadBalance();
        } else {
            showToast(data.msg || 'Failed to create payout', 'error');
        }
    } catch (error) {
        showToast('Error creating payout', 'error');
    }
}

// ========================================
// API DOCS
// ========================================

function loadApiDocs() {
    const content = document.getElementById('contentArea');
    content.innerHTML = `
        <div class="card mb-3">
            <h3 class="mb-2">Getting Started</h3>
            <p class="text-muted mb-3">All API requests require signature verification. Use your <strong>userId</strong> and <strong>merchantKey</strong> to sign requests.</p>
            
            <h4 class="mb-2">Signature Generation</h4>
            <ol style="color: var(--text-secondary); font-size: 0.875rem; padding-left: 1.5rem;">
                <li>Sort all parameters by ASCII code (ascending)</li>
                <li>Remove empty values, join with <code>&</code> as <code>key=value</code></li>
                <li>Append <code>&secret=YOUR_MERCHANT_KEY</code></li>
                <li>MD5 hash and convert to UPPERCASE</li>
            </ol>
        </div>
        
        <div class="endpoint-card">
            <h4><span class="endpoint-method post">POST</span> /api/payin/create</h4>
            <p class="text-muted mb-2">Create a pay-in order</p>
            <div class="code-block">
<pre>{
  "userId": "your-uuid",
  "orderAmount": "1000",
  "orderId": "ORDER123",
  "callbackUrl": "https://your-domain.com/callback",
  "skipUrl": "https://your-domain.com/success",
  "sign": "GENERATED_SIGN"
}</pre>
            </div>
        </div>
        
        <div class="endpoint-card">
            <h4><span class="endpoint-method post">POST</span> /api/payout/bank</h4>
            <p class="text-muted mb-2">Create a bank payout (automatic)</p>
            <div class="code-block">
<pre>{
  "userId": "your-uuid",
  "amount": "1000",
  "orderId": "PAYOUT123",
  "account": "1234567890",
  "ifsc": "SBIN0001234",
  "personName": "John Doe",
  "callbackUrl": "https://your-domain.com/callback",
  "sign": "GENERATED_SIGN"
}</pre>
            </div>
        </div>
        
        <div class="endpoint-card">
            <h4><span class="endpoint-method post">POST</span> /api/payout/usdt</h4>
            <p class="text-muted mb-2">Create a USDT payout (requires manual approval)</p>
            <div class="code-block">
<pre>{
  "userId": "your-uuid",
  "amount": "1000",
  "orderId": "PAYOUT123",
  "walletAddress": "TXyz...abc",
  "network": "TRC20",
  "sign": "GENERATED_SIGN"
}</pre>
            </div>
        </div>
        
        <div class="endpoint-card">
            <h4>Callback Response</h4>
            <p class="text-muted mb-2">Your callback endpoint will receive:</p>
            <div class="code-block">
<pre>{
  "status": 1,
  "amount": 950,
  "orderAmount": 1000,
  "orderId": "ORDER123",
  "id": "platform-uuid",
  "sign": "CALLBACK_SIGN"
}</pre>
            </div>
            <p class="text-muted mt-2">Respond with plain text: <code>success</code></p>
        </div>
    `;
}

// ========================================
// PAYMENT LINKS
// ========================================

function loadPaymentLinks() {
    const content = document.getElementById('contentArea');
    content.innerHTML = `
        <div class="card mb-3">
            <h3 class="card-title mb-2">Generate Payment Link</h3>
            <p class="text-muted mb-3" style="font-size: 0.75rem;">Create a payment link to test the pay-in flow. The link will redirect to the payment gateway for processing.</p>
            
            <form id="paymentLinkForm">
                <div class="d-flex gap-2" style="flex-wrap: wrap;">
                    <div class="form-group" style="flex: 1; min-width: 200px;">
                        <label>Amount (₹)</label>
                        <input type="number" id="linkAmount" placeholder="e.g. 1000" required min="100">
                    </div>
                    <div class="form-group" style="flex: 1; min-width: 200px;">
                        <label>Order ID (optional)</label>
                        <input type="text" id="linkOrderId" placeholder="Leave blank to auto-generate">
                    </div>
                    <div class="form-group" style="flex: 2; min-width: 300px;">
                        <label>Callback URL (optional)</label>
                        <input type="url" id="linkCallback" placeholder="https://your-domain.com/callback">
                    </div>
                </div>
                <button type="button" class="btn btn-primary" onclick="generatePaymentLink()">
                    <i class="fas fa-link"></i> Generate Link
                </button>
            </form>
            
            <div id="generatedLinkResult" class="hidden"></div>
        </div>
        
        <div class="card">
            <div class="card-header">
                <h3 class="card-title">How Payment Links Work</h3>
            </div>
            <div style="font-size: 0.75rem; color: var(--text-secondary);">
                <ol style="padding-left: 1.25rem; margin: 0;">
                    <li class="mb-1">Generate a payment link with the desired amount</li>
                    <li class="mb-1">Share the link with your customer or open it to test</li>
                    <li class="mb-1">Customer completes payment on the gateway</li>
                    <li class="mb-1">Your callback URL receives the payment confirmation</li>
                    <li>Balance is credited to your account (minus 5% fee)</li>
                </ol>
            </div>
        </div>
    `;
}

async function generatePaymentLink() {
    const amount = document.getElementById('linkAmount').value;
    let orderId = document.getElementById('linkOrderId').value;
    const callbackUrl = document.getElementById('linkCallback').value;

    if (!amount || parseFloat(amount) < 100) {
        showToast('Amount must be at least ₹100', 'error');
        return;
    }

    if (!orderId) {
        orderId = 'LINK_' + Date.now();
    }

    try {
        const response = await API.post('/payin/create', {
            userId: currentUser.id,
            orderAmount: amount,
            orderId: orderId,
            callbackUrl: callbackUrl || '',
            skipUrl: window.location.origin + '/payment-success.html',
            sign: 'frontend'
        });

        if (response.code === 1) {
            const paymentUrl = response.data.paymentUrl || response.data.url || `Payment Link Generated - Order: ${orderId}`;

            document.getElementById('generatedLinkResult').innerHTML = `
                <div class="payment-link-result">
                    <label>Payment Link Generated Successfully!</label>
                    <div class="d-flex gap-1 mt-1">
                        <input type="text" id="generatedLink" value="${paymentUrl}" readonly style="flex: 1;">
                        <button class="btn btn-primary btn-sm" onclick="copyGeneratedLink()">
                            <i class="fas fa-copy"></i> Copy
                        </button>
                        ${paymentUrl.startsWith('http') ? `<a href="${paymentUrl}" target="_blank" class="btn btn-success btn-sm">
                            <i class="fas fa-external-link-alt"></i> Open
                        </a>` : ''}
                    </div>
                    <div class="mt-2" style="font-size: 0.6875rem; color: var(--text-muted);">
                        <strong>Order ID:</strong> ${orderId} | <strong>Amount:</strong> ₹${parseFloat(amount).toFixed(2)}
                    </div>
                </div>
            `;
            document.getElementById('generatedLinkResult').classList.remove('hidden');
            showToast('Payment link generated!', 'success');
        } else {
            showToast(response.msg || 'Failed to generate link', 'error');
            // Log error to console for server-side logging
            console.error('Payment link generation error:', response);
        }
    } catch (error) {
        showToast('Error generating payment link', 'error');
        console.error('Payment link error:', error);
    }
}

function copyGeneratedLink() {
    const input = document.getElementById('generatedLink');
    input.select();
    document.execCommand('copy');
    showToast('Link copied to clipboard!', 'success');
}

// ========================================
// CREDENTIALS
// ========================================

async function loadCredentials() {
    const content = document.getElementById('contentArea');
    content.innerHTML = `
        <div class="card">
            <h3 class="mb-3">API Credentials</h3>
            <p class="text-muted mb-3">Use these credentials to authenticate your API requests.</p>
            
            <div class="form-group">
                <label>User ID</label>
                <div class="d-flex gap-1">
                    <input type="text" id="credUserId" readonly style="flex: 1;">
                    <button class="btn btn-secondary btn-sm" onclick="copyToClipboard('credUserId')">
                        <i class="fas fa-copy"></i>
                    </button>
                </div>
            </div>
            
            <div class="form-group">
                <label>Merchant Key (Secret)</label>
                <div class="d-flex gap-1">
                    <input type="password" id="credMerchantKey" readonly style="flex: 1;">
                    <button class="btn btn-secondary btn-sm" onclick="togglePassword('credMerchantKey')">
                        <i class="fas fa-eye"></i>
                    </button>
                    <button class="btn btn-secondary btn-sm" onclick="copyToClipboard('credMerchantKey')">
                        <i class="fas fa-copy"></i>
                    </button>
                </div>
            </div>
            
            <div class="form-group">
                <label>Callback URL</label>
                <div class="d-flex gap-1">
                    <input type="url" id="credCallback" placeholder="https://your-domain.com/callback" style="flex: 1;">
                    <button class="btn btn-primary btn-sm" onclick="updateCallbackUrl()">Save</button>
                </div>
            </div>
            
            <hr style="border-color: rgba(147, 51, 234, 0.2); margin: 1.5rem 0;">
            
            <button class="btn btn-danger" onclick="regenerateKey()">
                <i class="fas fa-sync"></i> Regenerate Merchant Key
            </button>
            <p class="text-muted mt-2" style="font-size: 0.75rem;">Warning: This will invalidate your current key</p>
        </div>
    `;

    try {
        const data = await API.get('/merchant/credentials');
        if (data.code === 1) {
            document.getElementById('credUserId').value = data.data.userId;
            document.getElementById('credMerchantKey').value = data.data.merchantKey;
            document.getElementById('credCallback').value = data.data.callbackUrl || '';
        }
    } catch (error) {
        showToast('Failed to load credentials', 'error');
    }
}

async function updateCallbackUrl() {
    const callbackUrl = document.getElementById('credCallback').value;
    try {
        const data = await API.put('/auth/profile', { callbackUrl });
        if (data.code === 1) {
            showToast('Callback URL updated!', 'success');
        } else {
            showToast(data.msg || 'Failed to update', 'error');
        }
    } catch (error) {
        showToast('Error updating callback URL', 'error');
    }
}

async function regenerateKey() {
    if (!confirm('Are you sure? This will invalidate your current key.')) return;

    try {
        const data = await API.post('/auth/regenerate-key');
        if (data.code === 1) {
            document.getElementById('credMerchantKey').value = data.data.merchantKey;
            showToast('Merchant key regenerated!', 'success');
        } else {
            showToast(data.msg || 'Failed to regenerate', 'error');
        }
    } catch (error) {
        showToast('Error regenerating key', 'error');
    }
}

// ========================================
// ADMIN: USERS
// ========================================

async function loadUsers() {
    if (currentUser.role !== 'admin') {
        loadDashboard();
        return;
    }

    const content = document.getElementById('contentArea');
    content.innerHTML = `
        <div class="card">
            <div class="card-header">
                <h3 class="card-title">Merchants</h3>
                <button class="btn btn-primary btn-sm" onclick="showCreateUserModal()">
                    <i class="fas fa-plus"></i> Add Merchant
                </button>
            </div>
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Email</th>
                            <th>Balance</th>
                            <th>Status</th>
                            <th>Created</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody id="usersList">
                        <tr><td colspan="6" class="text-muted" style="text-align:center;">Loading...</td></tr>
                    </tbody>
                </table>
            </div>
        </div>
    `;

    try {
        const data = await API.get('/admin/users');
        if (data.code === 1 && data.data.length > 0) {
            document.getElementById('usersList').innerHTML = data.data.map(u => `
                <tr>
                    <td>${u.name}</td>
                    <td>${u.email}</td>
                    <td>₹${parseFloat(u.balance).toFixed(2)}</td>
                    <td><span class="badge badge-${u.status === 'active' ? 'success' : 'failed'}">${u.status}</span></td>
                    <td>${formatDate(u.createdAt)}</td>
                    <td>
                        <button class="btn btn-secondary btn-sm" onclick="showUserDetails('${u.id}')">
                            <i class="fas fa-eye"></i>
                        </button>
                    </td>
                </tr>
            `).join('');
        } else {
            document.getElementById('usersList').innerHTML = `
                <tr><td colspan="6" class="text-muted" style="text-align:center;">No merchants found</td></tr>
            `;
        }
    } catch (error) {
        showToast('Failed to load users', 'error');
    }
}

function showCreateUserModal() {
    document.getElementById('modalTitle').textContent = 'Create Merchant';
    document.getElementById('modalBody').innerHTML = `
        <form id="createUserForm">
            <div class="form-group">
                <label>Name</label>
                <input type="text" id="newUserName" placeholder="Merchant name" required>
            </div>
            <div class="form-group">
                <label>Username</label>
                <input type="text" id="newUserUsername" placeholder="Login username" required>
            </div>
            <div class="form-group">
                <label>Password</label>
                <input type="password" id="newUserPassword" placeholder="Password" required>
            </div>
            <div class="form-group">
                <label>Callback URL (optional)</label>
                <input type="url" id="newUserCallback" placeholder="https://merchant-domain.com/callback">
            </div>
        </form>
    `;
    document.getElementById('modalFooter').innerHTML = `
        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="createUser()">Create Merchant</button>
    `;
    document.getElementById('modalOverlay').classList.add('active');
}

async function createUser() {
    const name = document.getElementById('newUserName').value;
    const username = document.getElementById('newUserUsername').value;
    const password = document.getElementById('newUserPassword').value;
    const callbackUrl = document.getElementById('newUserCallback').value;

    if (!name || !username || !password) {
        showToast('Please fill required fields', 'error');
        return;
    }

    try {
        const data = await API.post('/admin/users', { name, username, password, callbackUrl });
        if (data.code === 1) {
            showToast('Merchant created successfully!', 'success');
            closeModal();
            loadUsers();
        } else {
            showToast(data.msg || 'Failed to create merchant', 'error');
        }
    } catch (error) {
        showToast('Error creating merchant', 'error');
    }
}

// ========================================
// ADMIN: APPROVALS
// ========================================

async function loadApprovals() {
    if (currentUser.role !== 'admin') {
        loadDashboard();
        return;
    }

    const content = document.getElementById('contentArea');
    content.innerHTML = `
        <div class="card">
            <div class="card-header">
                <h3 class="card-title">Pending USDT Payouts</h3>
            </div>
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Order ID</th>
                            <th>Merchant</th>
                            <th>Amount</th>
                            <th>Wallet Address</th>
                            <th>Network</th>
                            <th>Date</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody id="approvalsList">
                        <tr><td colspan="7" class="text-muted" style="text-align:center;">Loading...</td></tr>
                    </tbody>
                </table>
            </div>
        </div>
    `;

    try {
        const data = await API.get('/admin/payouts/pending');
        if (data.code === 1 && data.data.length > 0) {
            document.getElementById('approvalsList').innerHTML = data.data.map(p => `
                <tr>
                    <td><code>${p.orderId}</code></td>
                    <td>${p.merchantName}<br><small class="text-muted">${p.merchantEmail}</small></td>
                    <td>₹${parseFloat(p.amount).toFixed(2)}<br><small class="text-muted">Fee: ₹${parseFloat(p.fee).toFixed(2)}</small></td>
                    <td><code style="font-size: 0.75rem;">${p.walletAddress}</code></td>
                    <td><span class="badge badge-processing">${p.network}</span></td>
                    <td>${formatDate(p.createdAt)}</td>
                    <td>
                        <button class="btn btn-success btn-sm" onclick="approvePayout('${p.id}')">
                            <i class="fas fa-check"></i>
                        </button>
                        <button class="btn btn-danger btn-sm" onclick="rejectPayout('${p.id}')">
                            <i class="fas fa-times"></i>
                        </button>
                    </td>
                </tr>
            `).join('');
        } else {
            document.getElementById('approvalsList').innerHTML = `
                <tr><td colspan="7" class="text-muted" style="text-align:center;">No pending approvals</td></tr>
            `;
        }
    } catch (error) {
        showToast('Failed to load approvals', 'error');
    }
}

async function approvePayout(id) {
    const utr = prompt('Enter transaction ID/UTR (optional):');

    try {
        const data = await API.post(`/admin/payouts/${id}/approve`, { utr });
        if (data.code === 1) {
            showToast('Payout approved!', 'success');
            loadApprovals();
            loadPendingCount();
        } else {
            showToast(data.msg || 'Failed to approve', 'error');
        }
    } catch (error) {
        showToast('Error approving payout', 'error');
    }
}

async function rejectPayout(id) {
    const reason = prompt('Enter rejection reason:');
    if (!reason) return;

    try {
        const data = await API.post(`/admin/payouts/${id}/reject`, { reason });
        if (data.code === 1) {
            showToast('Payout rejected and balance refunded', 'success');
            loadApprovals();
            loadPendingCount();
        } else {
            showToast(data.msg || 'Failed to reject', 'error');
        }
    } catch (error) {
        showToast('Error rejecting payout', 'error');
    }
}

// ========================================
// ADMIN: ALL TRANSACTIONS
// ========================================

async function loadAllTransactions() {
    if (currentUser.role !== 'admin') {
        loadDashboard();
        return;
    }

    const content = document.getElementById('contentArea');
    content.innerHTML = `
        <div class="card">
            <div class="card-header">
                <h3 class="card-title">All Transactions</h3>
            </div>
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Order ID</th>
                            <th>Merchant</th>
                            <th>Type</th>
                            <th>Amount</th>
                            <th>Fee</th>
                            <th>Status</th>
                            <th>Date</th>
                        </tr>
                    </thead>
                    <tbody id="allTransactionsList">
                        <tr><td colspan="7" class="text-muted" style="text-align:center;">Loading...</td></tr>
                    </tbody>
                </table>
            </div>
        </div>
    `;

    try {
        const data = await API.get('/admin/transactions?limit=100');
        if (data.code === 1 && data.data.length > 0) {
            document.getElementById('allTransactionsList').innerHTML = data.data.map(tx => `
                <tr>
                    <td><code>${tx.orderId}</code></td>
                    <td>${tx.merchantName}<br><small class="text-muted">${tx.merchantEmail}</small></td>
                    <td><span class="badge ${tx.type === 'payin' ? 'badge-success' : 'badge-pending'}">${tx.type}</span></td>
                    <td>₹${parseFloat(tx.amount).toFixed(2)}</td>
                    <td>₹${parseFloat(tx.fee).toFixed(2)}</td>
                    <td><span class="badge badge-${getStatusClass(tx.status)}">${tx.status}</span></td>
                    <td>${formatDate(tx.createdAt)}</td>
                </tr>
            `).join('');
        } else {
            document.getElementById('allTransactionsList').innerHTML = `
                <tr><td colspan="7" class="text-muted" style="text-align:center;">No transactions found</td></tr>
            `;
        }
    } catch (error) {
        showToast('Failed to load transactions', 'error');
    }
}

// ========================================
// UTILITIES
// ========================================

function getStatusClass(status) {
    const classes = {
        'success': 'success',
        'pending': 'pending',
        'processing': 'processing',
        'failed': 'failed',
        'rejected': 'failed',
        'approved': 'success'
    };
    return classes[status] || 'pending';
}

function formatDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function copyToClipboard(elementId) {
    const input = document.getElementById(elementId);
    input.type = 'text';
    input.select();
    document.execCommand('copy');
    input.type = 'password';
    showToast('Copied to clipboard!', 'success');
}

function togglePassword(elementId) {
    const input = document.getElementById(elementId);
    input.type = input.type === 'password' ? 'text' : 'password';
}

function closeModal() {
    document.getElementById('modalOverlay').classList.remove('active');
}

function logout() {
    localStorage.removeItem('huidu_token');
    localStorage.removeItem('huidu_user');
    window.location.href = '/login.html';
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = 'toast';

    const icons = {
        success: 'fas fa-check-circle',
        error: 'fas fa-exclamation-circle',
        warning: 'fas fa-exclamation-triangle',
        info: 'fas fa-info-circle'
    };

    const colors = {
        success: 'var(--success)',
        error: 'var(--error)',
        warning: 'var(--warning)',
        info: 'var(--info)'
    };

    toast.innerHTML = `
        <i class="${icons[type]}" style="color: ${colors[type]}"></i>
        <span>${message}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Close modal on overlay click
document.getElementById('modalOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'modalOverlay') {
        closeModal();
    }
});
