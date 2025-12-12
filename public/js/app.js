// ========================================
// VSPAY - Main Application
// ========================================

// API Helper
const API = {
    baseUrl: '/api',
    token: localStorage.getItem('vspay_token'),

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
    initLanguage();
});

function checkAuth() {
    const token = localStorage.getItem('vspay_token');
    const user = localStorage.getItem('vspay_user');

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
        'dashboard': t('dashboard_tab'),
        'transactions': t('transactions_tab'),
        'payouts': t('payouts_tab'),
        'payment-links': t('create_payment_link'),
        'api-docs': t('api_docs_tab'),
        'credentials': t('credentials_tab'),
        'users': t('users_tab'),
        'approvals': t('approvals_tab'),
        'all-transactions': t('all_transactions_tab')
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
                    <div class="stat-label">${t('stat_balance')}</div>
                    <div class="stat-value" id="statBalance">₹0.00</div>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon green"><i class="fas fa-arrow-down"></i></div>
                <div class="stat-info">
                    <div class="stat-label">${t('stat_payin')}</div>
                    <div class="stat-value" id="statPayin">₹0.00</div>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon red"><i class="fas fa-arrow-up"></i></div>
                <div class="stat-info">
                    <div class="stat-label">${t('stat_payout')}</div>
                    <div class="stat-value" id="statPayout">₹0.00</div>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon blue"><i class="fas fa-clock"></i></div>
                <div class="stat-info">
                    <div class="stat-label">${t('stat_pending')}</div>
                    <div class="stat-value" id="statPending">0</div>
                </div>
            </div>
        </div>
        
        <div class="card">
            <div class="card-header">
                <h3 class="card-title">${t('recent_transactions')}</h3>
                <button class="btn btn-secondary btn-sm" onclick="loadSection('transactions')">
                    ${t('view_all')} <i class="fas fa-arrow-right"></i>
                </button>
            </div>
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>${t('order_id')}</th>
                            <th>${t('type')}</th>
                            <th>${t('amount')}</th>
                            <th>${t('fee')}</th>
                            <th>${t('status')}</th>
                            <th>${t('date')}</th>
                        </tr>
                    </thead>
                    <tbody id="recentTransactions">
                        <tr><td colspan="6" class="text-muted" style="text-align:center;">${t('loading')}</td></tr>
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
                    <td><span class="badge ${tx.type === 'payin' ? 'badge-success' : 'badge-pending'}">${t('type_' + tx.type) || tx.type}</span></td>
                    <td>₹${parseFloat(tx.amount).toFixed(2)}</td>
                    <td>₹${parseFloat(tx.fee).toFixed(2)}</td>
                    <td><span class="badge badge-${getStatusClass(tx.status)}">${t('status_' + tx.status)}</span></td>
                    <td>${formatDate(tx.createdAt)}</td>
                </tr>
            `).join('');
        } else {
            document.getElementById('recentTransactions').innerHTML = `
                <tr><td colspan="6" class="text-muted" style="text-align:center;">${t('no_recent')}</td></tr>
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
                <h3 class="card-title">${t('transactions_tab')}</h3>
            </div>
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>${t('order_id')}</th>
                            <th>${t('type')}</th>
                            <th>${t('amount')}</th>
                            <th>${t('fee')}</th>
                            <th>${t('net_amount')}</th>
                            <th>${t('status')}</th>
                            <th>${t('utr')}</th>
                            <th>${t('date')}</th>
                        </tr>
                    </thead>
                    <tbody id="transactionsList">
                        <tr><td colspan="8" class="text-muted" style="text-align:center;">${t('loading')}</td></tr>
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
                    <td><span class="badge ${tx.type === 'payin' ? 'badge-success' : 'badge-pending'}">${t('type_' + tx.type) || tx.type}</span></td>
                    <td>₹${parseFloat(tx.amount).toFixed(2)}</td>
                    <td>₹${parseFloat(tx.fee).toFixed(2)}</td>
                    <td>₹${parseFloat(tx.netAmount).toFixed(2)}</td>
                    <td><span class="badge badge-${getStatusClass(tx.status)}">${t('status_' + tx.status)}</span></td>
                    <td>${tx.utr || '-'}</td>
                    <td>${formatDate(tx.createdAt)}</td>
                </tr>
            `).join('');
        } else {
            document.getElementById('transactionsList').innerHTML = `
                <tr><td colspan="8" class="text-muted" style="text-align:center;">${t('no_transactions')}</td></tr>
            `;
        }
    } catch (error) {
        console.error('Failed to load transactions:', error);
        showToast(t('error_load_tx'), 'error');
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
                        <h3>${t('bank_payout_title')}</h3>
                        <p class="text-muted" style="font-size: 0.875rem;">${t('bank_payout_desc')}</p>
                    </div>
                </div>
            </div>
            <div class="card" style="cursor: pointer;" onclick="showUsdtPayoutModal()">
                <div class="d-flex align-center gap-2">
                    <div class="stat-icon blue"><i class="fab fa-bitcoin"></i></div>
                    <div>
                        <h3>${t('usdt_payout_title')}</h3>
                        <p class="text-muted" style="font-size: 0.875rem;">${t('usdt_payout_desc')}</p>
                    </div>
                </div>
            </div>
        </div>
        
        <div class="card">
            <div class="card-header">
                <h3 class="card-title">${t('payout_history')}</h3>
            </div>
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>${t('order_id')}</th>
                            <th>${t('type')}</th>
                            <th>${t('amount')}</th>
                            <th>${t('fee')}</th>
                            <th>${t('details')}</th>
                            <th>${t('status')}</th>
                            <th>${t('date')}</th>
                        </tr>
                    </thead>
                    <tbody id="payoutsList">
                        <tr><td colspan="7" class="text-muted" style="text-align:center;">${t('loading')}</td></tr>
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
                    <td><span class="badge ${p.type === 'bank' ? 'badge-success' : 'badge-processing'}">${t('type_' + p.type) || p.type}</span></td>
                    <td>₹${parseFloat(p.amount).toFixed(2)}</td>
                    <td>₹${parseFloat(p.fee).toFixed(2)}</td>
                    <td>${p.type === 'bank' ? (p.accountNumber ? `****${p.accountNumber.slice(-4)}` : '-') : (p.walletAddress ? `${p.walletAddress.substring(0, 8)}...` : '-')}</td>
                    <td><span class="badge badge-${getStatusClass(p.status)}">${t('status_' + p.status)}</span></td>
                    <td>${formatDate(p.createdAt)}</td>
                </tr>
            `).join('');
        } else {
            document.getElementById('payoutsList').innerHTML = `
                <tr><td colspan="7" class="text-muted" style="text-align:center;">${t('no_payouts')}</td></tr>
            `;
        }
    } catch (error) {
        console.error('Failed to load payouts:', error);
        showToast(t('error_load_payouts'), 'error');
    }
}

async function showBankPayoutModal() {
    // Fetch current balance
    let balanceText = t('loading');
    try {
        const data = await API.get('/merchant/balance');
        if (data.code === 1) {
            balanceText = `₹${parseFloat(data.data.balance).toFixed(2)}`;
        }
    } catch (e) { balanceText = 'Error loading'; }

    document.getElementById('modalTitle').textContent = t('bank_payout_title');
    document.getElementById('modalBody').innerHTML = `
        <div class="balance-info-box">
            <div class="balance-label">${t('available_balance')}</div>
            <div class="balance-amount">${balanceText}</div>
        </div>
        <div class="alert alert-info mb-3">
            <i class="fas fa-info-circle"></i>
            <span>${t('payout_fee_info')}</span>
        </div>
        <form id="bankPayoutForm">
            <div class="form-group">
                <label>${t('label_amount')}</label>
                <input type="number" id="bankAmount" placeholder="1000" required min="100">
            </div>
            <div class="form-group">
                <label>${t('label_account')}</label>
                <input type="text" id="bankAccount" placeholder="1234567890" required>
            </div>
            <div class="form-group">
                <label>${t('label_ifsc')}</label>
                <input type="text" id="bankIfsc" placeholder="ABCD0123456" required>
            </div>
            <div class="form-group">
                <label>${t('label_name')}</label>
                <input type="text" id="bankName" placeholder="John Doe" required>
            </div>
        </form>
    `;
    document.getElementById('modalFooter').innerHTML = `
        <button class="btn btn-secondary" onclick="closeModal()">${t('btn_cancel')}</button>
        <button class="btn btn-primary" onclick="submitBankPayout()">${t('btn_submit')}</button>
    `;
    document.getElementById('modalOverlay').classList.add('active');
}

async function submitBankPayout() {
    const amount = document.getElementById('bankAmount').value;
    const account = document.getElementById('bankAccount').value;
    const ifsc = document.getElementById('bankIfsc').value;
    const name = document.getElementById('bankName').value;

    if (!amount || !account || !ifsc || !name) {
        showToast(t('toast_fill_fields'), 'error');
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
            showToast(t('toast_success_bank'), 'success');
            closeModal();
            loadPayouts();
            loadBalance();
        } else {
            showToast(data.msg || 'Failed to create payout', 'error');
        }
    } catch (error) {
        showToast(t('toast_error'), 'error');
    }
}

async function showUsdtPayoutModal() {
    // Fetch current balance
    let balanceText = t('loading');
    try {
        const data = await API.get('/merchant/balance');
        if (data.code === 1) {
            balanceText = `₹${parseFloat(data.data.balance).toFixed(2)}`;
        }
    } catch (e) { balanceText = 'Error loading'; }

    document.getElementById('modalTitle').textContent = t('usdt_payout_title');
    document.getElementById('modalBody').innerHTML = `
        <div class="balance-info-box">
            <div class="balance-label">${t('available_balance')}</div>
            <div class="balance-amount">${balanceText}</div>
        </div>
        <div class="alert alert-info mb-3">
            <i class="fas fa-info-circle"></i>
            <span>${t('payout_usdt_info')}</span>
        </div>
        <form id="usdtPayoutForm">
            <div class="form-group">
                <label>${t('label_usdt_amount')}</label>
                <input type="number" id="usdtAmount" placeholder="51500" required min="51500">
            </div>
            <div class="form-group">
                <label>${t('label_wallet')}</label>
                <input type="text" id="usdtWallet" placeholder="T..." required>
            </div>
            <div class="form-group">
                <label>${t('label_network')}</label>
                <select id="usdtNetwork" required>
                    <option value="">${t('label_network')}</option>
                    <option value="TRC20">TRC20 (Tron)</option>
                    <option value="ERC20">ERC20 (Ethereum)</option>
                    <option value="BEP20">BEP20 (BSC)</option>
                </select>
            </div>
        </form>
    `;
    document.getElementById('modalFooter').innerHTML = `
        <button class="btn btn-secondary" onclick="closeModal()">${t('btn_cancel')}</button>
        <button class="btn btn-primary" onclick="submitUsdtPayout()">${t('btn_submit')}</button>
    `;
    document.getElementById('modalOverlay').classList.add('active');
}

async function submitUsdtPayout() {
    const amount = document.getElementById('usdtAmount').value;
    const wallet = document.getElementById('usdtWallet').value;
    const network = document.getElementById('usdtNetwork').value;

    if (!amount || !wallet || !network) {
        showToast(t('toast_fill_fields'), 'error');
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
            showToast(t('toast_success_usdt'), 'success');
            closeModal();
            loadPayouts();
            loadBalance();
        } else {
            showToast(data.msg || 'Failed to create payout', 'error');
        }
    } catch (error) {
        showToast(t('toast_error'), 'error');
    }
}

// ========================================
// API DOCS
// ========================================



// ========================================
// PAYMENT LINKS
// ========================================

function loadPaymentLinks() {
    const content = document.getElementById('contentArea');
    content.innerHTML = `
        <div class="card mb-3">
            <h3 class="card-title mb-2">${t('generate_link')}</h3>
            <p class="text-muted mb-3" style="font-size: 0.75rem;">${t('link_create_desc')}</p>
            
            <form id="paymentLinkForm">
                <div class="d-flex gap-2" style="flex-wrap: wrap;">
                    <div class="form-group" style="flex: 1; min-width: 200px;">
                        <label>${t('label_amount')}</label>
                        <input type="number" id="linkAmount" placeholder="1000" required min="100">
                    </div>
                    <div class="form-group" style="flex: 1; min-width: 200px;">
                        <label>${t('order_id')} (optional)</label>
                        <input type="text" id="linkOrderId" placeholder="Auto-generate">
                    </div>
                    <div class="form-group" style="flex: 2; min-width: 300px;">
                        <label>Callback URL (optional)</label>
                        <input type="url" id="linkCallback" placeholder="https://your-domain.com/callback">
                    </div>
                </div>
                <button type="button" class="btn btn-primary" onclick="generatePaymentLink()">
                    <i class="fas fa-link"></i> ${t('generate_link')}
                </button>
            </form>
            
            <div id="generatedLinkResult" class="hidden"></div>
        </div>
        
        <div class="card">
            <div class="card-header">
                <h3 class="card-title">${t('link_instruct_title')}</h3>
            </div>
            <div style="font-size: 0.75rem; color: var(--text-secondary);">
                <ol style="padding-left: 1.25rem; margin: 0;">
                    <li class="mb-1">${t('link_instruct_1')}</li>
                    <li class="mb-1">${t('link_instruct_2')}</li>
                    <li class="mb-1">${t('link_instruct_3')}</li>
                    <li class="mb-1">${t('link_instruct_4')}</li>
                    <li>${t('link_instruct_5')}</li>
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
        showToast(t('error_min_amount'), 'error');
        return;
    }

    if (!orderId) {
        orderId = 'LINK_' + Date.now();
    }

    try {
        // Use session-authenticated merchant endpoint instead of API-key-authenticated endpoint
        const response = await API.post('/merchant/payin/create', {
            orderAmount: amount,
            orderId: orderId,
            callbackUrl: callbackUrl || '',
            skipUrl: window.location.origin + '/payment-success.html'
        });

        console.log('Payment link API response:', JSON.stringify(response, null, 2));

        if (response.code === 1) {
            const paymentUrl = response.data.rechargeUrl || response.data.paymentUrl || response.data.url || `Payment Link Generated - Order: ${orderId}`;

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
            showToast(t('link_generated'), 'success');
        } else {
            showToast(response.msg || 'Failed to generate link', 'error');
            // Log error to console for server-side logging
            console.error('Payment link generation error:', response);
        }
    } catch (error) {
        showToast(t('error_gen_link'), 'error');
        console.error('Payment link error:', error);
    }
}

function copyGeneratedLink() {
    const input = document.getElementById('generatedLink');
    input.select();
    document.execCommand('copy');
    showToast(t('toast_copied'), 'success');
}

// ========================================
// CREDENTIALS
// ========================================

async function loadCredentials() {
    const content = document.getElementById('contentArea');
    content.innerHTML = `
        <div class="card">
            <h3 class="mb-3">${t('api_credentials')}</h3>
            <p class="text-muted mb-3">${t('credentials_desc')}</p>
            
            <div class="form-group">
                <label>${t('label_user_id')}</label>
                <div class="d-flex gap-1">
                    <input type="text" id="credUserId" readonly style="flex: 1;">
                    <button class="btn btn-secondary btn-sm" onclick="copyToClipboard('credUserId')">
                        <i class="fas fa-copy"></i>
                    </button>
                </div>
            </div>
            
            <div class="form-group">
                <label>${t('merchant_key')}</label>
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
                <label>${t('label_callback_url')}</label>
                <div class="d-flex gap-1">
                    <input type="url" id="credCallback" placeholder="https://your-domain.com/callback" style="flex: 1;">
                    <button class="btn btn-primary btn-sm" onclick="updateCallbackUrl()">${t('btn_save')}</button>
                </div>
            </div>
            
            <hr style="border-color: rgba(147, 51, 234, 0.2); margin: 1.5rem 0;">
            
            <button class="btn btn-danger" onclick="regenerateKey()">
                <i class="fas fa-sync"></i> ${t('btn_regen_key')}
            </button>
            <p class="text-muted mt-2" style="font-size: 0.75rem;">${t('warn_regen_key')}</p>
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
            showToast(t('toast_callback_updated'), 'success');
        } else {
            showToast(data.msg || 'Failed to update', 'error');
        }
    } catch (error) {
        showToast(t('error_callback_update'), 'error');
    }
}

async function regenerateKey() {
    if (!confirm('Are you sure? This will invalidate your current key.')) return;

    try {
        const data = await API.post('/auth/regenerate-key');
        if (data.code === 1) {
            document.getElementById('credMerchantKey').value = data.data.merchantKey;
            showToast(t('toast_key_regen'), 'success');
        } else {
            showToast(data.msg || 'Failed to regenerate', 'error');
        }
    } catch (error) {
        showToast(t('error_key_regen'), 'error');
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
                    <td>${u.username}</td>
                    <td>₹${parseFloat(u.balance).toFixed(2)}</td>
                    <td><span class="badge badge-${u.status === 'active' ? 'success' : 'failed'}">${u.status}</span></td>
                    <td>${formatDate(u.createdAt)}</td>
                    <td>
                        <button class="btn btn-primary btn-sm" onclick="showAdjustBalanceModal('${u.id}', '${u.name}', ${u.balance})" title="Adjust Balance">
                            <i class="fas fa-wallet"></i>
                        </button>
                        <button class="btn btn-secondary btn-sm" onclick="showUserDetails('${u.id}')" title="View Details">
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
        showToast(t('error_load_users'), 'error');
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
        showToast(t('toast_fill_fields'), 'error');
        return;
    }

    try {
        const data = await API.post('/admin/users', { name, username, password, callbackUrl });
        if (data.code === 1) {
            showToast(t('toast_merchant_created'), 'success');
            closeModal();
            loadUsers();
        } else {
            showToast(data.msg || 'Failed to create merchant', 'error');
        }
    } catch (error) {
        showToast(t('error_create_merchant'), 'error');
    }
}

function showAdjustBalanceModal(userId, userName, currentBalance) {
    document.getElementById('modalTitle').textContent = `Adjust Balance - ${userName}`;
    document.getElementById('modalBody').innerHTML = `
        <p class="text-muted mb-2" style="font-size: 0.75rem;">Current Balance: <strong>₹${parseFloat(currentBalance).toFixed(2)}</strong></p>
        <form id="adjustBalanceForm">
            <div class="form-group">
                <label>Adjustment Amount *</label>
                <input type="number" id="adjustAmount" step="0.01" placeholder="Enter amount (positive to add, negative to deduct)" required>
                <small class="text-muted">Use positive value to add funds, negative to deduct</small>
            </div>
            <div class="form-group">
                <label>Reason (optional)</label>
                <input type="text" id="adjustReason" placeholder="Reason for adjustment">
            </div>
        </form>
    `;
    document.getElementById('modalFooter').innerHTML = `
        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn btn-success" onclick="adjustBalance('${userId}')">
            <i class="fas fa-plus"></i> Add Balance
        </button>
    `;
    document.getElementById('modalOverlay').classList.add('active');
}

async function adjustBalance(userId) {
    const amount = document.getElementById('adjustAmount').value;
    const reason = document.getElementById('adjustReason').value;

    if (!amount || parseFloat(amount) === 0) {
        showToast(t('error_valid_amount'), 'error');
        return;
    }

    try {
        console.log('Adjusting balance:', { userId, amount, reason });
        const data = await API.post(`/admin/users/${userId}/balance`, { amount: parseFloat(amount), reason });
        console.log('Balance adjustment response:', data);

        if (data.code === 1) {
            showToast(`Balance adjusted! New balance: ₹${data.data.newBalance.toFixed(2)}`, 'success');
            closeModal();
            loadUsers();
        } else {
            showToast(data.msg || 'Failed to adjust balance', 'error');
        }
    } catch (error) {
        console.error('Adjust balance error:', error);
        showToast(t('error_adjust_balance'), 'error');
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
                <h3 class="card-title">${t('admin_pending_title')}</h3>
            </div>
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>${t('order_id')}</th>
                            <th>${t('merchant')}</th>
                            <th>${t('amount')}</th>
                            <th>${t('wallet_address')}</th>
                            <th>${t('network')}</th>
                            <th>${t('date')}</th>
                            <th>${t('actions')}</th>
                        </tr>
                    </thead>
                    <tbody id="approvalsList">
                        <tr><td colspan="7" class="text-muted" style="text-align:center;">${t('loading')}</td></tr>
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
                    <td>₹${parseFloat(p.amount).toFixed(2)}<br><small class="text-muted">${t('fee')}: ₹${parseFloat(p.fee).toFixed(2)}</small></td>
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
                <tr><td colspan="7" class="text-muted" style="text-align:center;">${t('no_pending')}</td></tr>
            `;
        }
    } catch (error) {
        showToast('Failed to load approvals', 'error');
    }
}

async function approvePayout(id) {
    const utr = prompt(t('prompt_utr'));

    try {
        const data = await API.post(`/admin/payouts/${id}/approve`, { utr });
        if (data.code === 1) {
            showToast(t('toast_approved'), 'success');
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
    const reason = prompt(t('prompt_reason'));
    if (!reason) return;

    try {
        const data = await API.post(`/admin/payouts/${id}/reject`, { reason });
        if (data.code === 1) {
            showToast(t('toast_rejected'), 'success');
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
                <h3 class="card-title">${t('admin_all_tx')}</h3>
            </div>
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>${t('order_id')}</th>
                            <th>${t('merchant')}</th>
                            <th>${t('type')}</th>
                            <th>${t('amount')}</th>
                            <th>${t('fee')}</th>
                            <th>${t('status')}</th>
                            <th>${t('date')}</th>
                        </tr>
                    </thead>
                    <tbody id="allTransactionsList">
                        <tr><td colspan="7" class="text-muted" style="text-align:center;">${t('loading')}</td></tr>
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
                    <td><span class="badge ${tx.type === 'payin' ? 'badge-success' : 'badge-pending'}">${t('type_' + tx.type) || tx.type}</span></td>
                    <td>₹${parseFloat(tx.amount).toFixed(2)}</td>
                    <td>₹${parseFloat(tx.fee).toFixed(2)}</td>
                    <td><span class="badge badge-${getStatusClass(tx.status)}">${t('status_' + tx.status)}</span></td>
                    <td>${formatDate(tx.createdAt)}</td>
                </tr>
            `).join('');
        } else {
            document.getElementById('allTransactionsList').innerHTML = `
                <tr><td colspan="7" class="text-muted" style="text-align:center;">${t('no_transactions')}</td></tr>
            `;
        }
    } catch (error) {
        showToast(t('error_load_tx'), 'error');
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
    showToast(t('toast_copied'), 'success');
}

function togglePassword(elementId) {
    const input = document.getElementById(elementId);
    input.type = input.type === 'password' ? 'text' : 'password';
}

function closeModal() {
    document.getElementById('modalOverlay').classList.remove('active');
}

function logout() {
    localStorage.removeItem('vspay_token');
    localStorage.removeItem('vspay_user');
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

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Auth check
    const token = localStorage.getItem('vspay_token');
    if (!token) {
        window.location.href = '/login.html';
        return;
    }

    // Set user info
    const userStr = localStorage.getItem('vspay_user');
    let currentUser = null;
    if (userStr) {
        currentUser = JSON.parse(userStr);
        document.getElementById('userName').textContent = currentUser.name || currentUser.username;
        document.getElementById('userRole').textContent = currentUser.role === 'admin' ? 'Administrator' : 'Merchant';
        document.getElementById('userAvatar').textContent = (currentUser.name || currentUser.username).charAt(0).toUpperCase();

        // Show admin nav if admin
        if (currentUser.role === 'admin') {
            document.getElementById('adminNav').classList.remove('hidden');
            if (typeof loadPendingCount === 'function') loadPendingCount();
        }
    }

    // Initialize Localization
    if (window.initLanguage) {
        window.initLanguage();
    }

    // Load initial section
    loadSection('dashboard');
});
