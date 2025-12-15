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
const sectionCache = {};

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

async function loadSection(section) {
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

    // Check cache first
    if (sectionCache[section]) {
        contentArea.innerHTML = sectionCache[section];
        initSection(section);
        return;
    }

    contentArea.innerHTML = '<div class="text-center p-5"><i class="fas fa-spinner fa-spin fa-2x"></i></div>';

    try {
        const response = await fetch(`/sections/${section}.html`);
        if (!response.ok) throw new Error('Section not found');
        const html = await response.text();

        // Cache and render
        sectionCache[section] = html;
        contentArea.innerHTML = html;

        initSection(section);
    } catch (error) {
        console.error('Error loading section:', error);
        contentArea.innerHTML = `<div class="alert alert-error">Failed to load content: ${error.message}</div>`;
    }
}

function initSection(section) {
    // Translate static content
    if (window.updateTranslations) {
        window.updateTranslations();
    }

    // Initialize section logic
    switch (section) {
        case 'dashboard':
            loadDashboardData();
            break;
        case 'transactions':
            loadTransactionsData();
            break;
        case 'payouts':
            loadPayoutsData();
            break;
        case 'payment-links':
            // No data load needed initially
            break;
        case 'api-docs':
            // loadApiDocs(); // If exists
            break;
        case 'credentials':
            loadCredentialsData();
            break;
        case 'users':
            loadUsersData();
            break;
        case 'approvals':
            loadApprovalsData();
            break;
        case 'approvals':
            loadApprovalsData();
            break;
        case 'all-transactions':
            loadAllTransactionsData();
            break;
        case 'broadcast':
            // No init needed
            break;
        default:
            break;
    }
}

// ========================================
// DASHBOARD
// ========================================

// ========================================
// DASHBOARD
// ========================================

async function loadDashboardData() {
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
        const container = document.getElementById('recentTransactions');
        if (!container) return;

        if (txData.code === 1 && txData.data.transactions.length > 0) {
            container.innerHTML = txData.data.transactions.map(tx => `
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
            container.innerHTML = `
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

async function loadTransactionsData() {
    try {
        const data = await API.get('/merchant/transactions?limit=50');
        const container = document.getElementById('transactionsList');
        if (!container) return;

        if (data.code === 1 && data.data.transactions.length > 0) {
            container.innerHTML = data.data.transactions.map(tx => `
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
            container.innerHTML = `
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

async function loadPayoutsData() {
    try {
        const data = await API.get('/merchant/payouts?limit=50');
        const container = document.getElementById('payoutsList');
        if (!container) return;

        if (data.code === 1 && data.data.length > 0) {
            container.innerHTML = data.data.map(p => `
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
            container.innerHTML = `
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

// ========================================
// PAYMENT LINKS
// ========================================

async function loadPaymentLinksData() {
    // This section is interactive and primarily driven by user input.
    // The HTML is loaded statically.
    // Use generatePaymentLink() for actions.
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
            const paymentUrl = response.data.paymentUrl || response.data.rechargeUrl || response.data.url || `Payment Link Generated - Order: ${orderId}`;

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

// ========================================
// CREDENTIALS
// ========================================

async function loadCredentialsData() {
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

// ========================================
// ADMIN: USERS
// ========================================

async function loadUsersData() {
    if (currentUser.role !== 'admin') {
        loadDashboard();
        return;
    }

    try {
        const data = await API.get('/admin/users');
        const container = document.getElementById('usersList');
        if (!container) return;

        if (data.code === 1) {
            const merchants = data.data.filter(u => u.role !== 'admin');

            if (merchants.length > 0) {
                container.innerHTML = merchants.map(u => `
                <tr>
                    <td><code>${u.id}</code></td>
                    <td>
                        <div style="display:flex; align-items:center; gap:5px;">
                            <code style="font-size: 0.75rem;">${u.merchantKey.substring(0, 8)}...</code>
                            <i class="fas fa-copy text-primary" style="cursor:pointer;" onclick="navigator.clipboard.writeText('${u.merchantKey}').then(() => showToast('Key copied', 'success'))" title="Copy Key"></i>
                        </div>
                    </td>
                    <td>${u.name}</td>
                    <td>${u.username}</td>
                    <td>
                        <small>In: ${u.payinRate || 5}%</small><br>
                        <small>Out: ${u.payoutRate || 3}%</small>
                    </td>
                    <td>₹${parseFloat(u.balance).toFixed(2)}</td>
                    <td><span class="badge badge-${u.status === 'active' ? 'success' : 'failed'}">${u.status}</span></td>
                    <td>${formatDate(u.createdAt)}</td>
                    <td>
                        <button class="btn btn-primary btn-sm" onclick="showAdjustBalanceModal('${u.id}', '${u.name}', ${u.balance})" title="Adjust Balance">
                            <i class="fas fa-wallet"></i>
                        </button>
                        <button class="btn btn-secondary btn-sm" onclick="showEditUserModal('${u.id}')" title="Edit Merchant">
                            <i class="fas fa-edit"></i>
                        </button>
                    </td>
                </tr>
            `).join('');
            } else {
                container.innerHTML = `
                <tr><td colspan="9" class="text-muted" style="text-align:center;">No merchants found</td></tr>
            `;
            }
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
            <div class="d-flex gap-2">
                <div class="form-group" style="flex:1">
                    <label>Pay-in Rate (%)</label>
                    <input type="number" id="newUserPayinRate" value="5.0" step="0.1" min="5.0">
                    <small class="text-muted">Must be 5.0 or more</small>
                </div>
                <div class="form-group" style="flex:1">
                    <label>Payout Rate (%)</label>
                    <input type="number" id="newUserPayoutRate" value="3.0" step="0.1" min="3.0">
                    <small class="text-muted">Must be 3.0 or more</small>
                </div>
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
    const payinRate = document.getElementById('newUserPayinRate').value;
    const payoutRate = document.getElementById('newUserPayoutRate').value;

    if (!name || !username || !password) {
        showToast(t('toast_fill_fields'), 'error');
        return;
    }

    closeModal(); // Close the form modal first
    showLoader(); // Show global loader

    try {
        const data = await API.post('/admin/users', {
            name, username, password, callbackUrl,
            payinRate: parseFloat(payinRate),
            payoutRate: parseFloat(payoutRate)
        });

        hideLoader(); // Hide loader

        if (data.code === 1) {
            // showToast(t('toast_merchant_created'), 'success');
            loadUsersData();
            showWelcomeModal(data.data); // Show the fancy welcome popup
        } else {
            showToast(data.msg || 'Failed to create merchant', 'error');
            // If failed, maybe reopen the create modal? For now just show toast.
        }
    } catch (error) {
        hideLoader();
        showToast(t('error_create_merchant'), 'error');
    }
}

async function showEditUserModal(userId) {
    let user = null;
    try {
        // We reuse the list to find user since we don't have a single user get endpoint exposed easily to frontend yet, 
        // or we can just fetch all and filter. For efficiency, let's use what we have or fetch fresh.
        // Actually, we can assume the user info is in the row, but cleaner to fetch.
        // Let's use the list endpoint again or assume we can find it in the DOM?
        // Better: Fetch fresh list to find the user or just iterate current data if we stored it globally?
        // Simplest: Fetch list again or add a specific GET /admin/users/:id endpoint.
        // I'll stick to fetching the full list for now as it's already there, or we can just pass the data? 
        // Passing data as params is messy with quotes.
        // Let's just fetch the list again internally or filter from a global variable if I had one.
        // I will do a quick fetch of all users and find logic.
        const data = await API.get('/admin/users');
        if (data.code === 1) {
            user = data.data.find(u => u.id === userId);
        }
    } catch (e) { console.error(e); }

    if (!user) {
        showToast('User not found', 'error');
        return;
    }

    document.getElementById('modalTitle').textContent = 'Edit Merchant';
    document.getElementById('modalBody').innerHTML = `
        <form id="editUserForm">
            <div class="form-group">
                <label>Name</label>
                <input type="text" id="editUserName" value="${user.name}" required>
            </div>
            <div class="form-group">
                <label>Status</label>
                <select id="editUserStatus">
                    <option value="active" ${user.status === 'active' ? 'selected' : ''}>Active</option>
                    <option value="suspended" ${user.status === 'suspended' ? 'selected' : ''}>Suspended</option>
                </select>
            </div>
            <div class="form-group">
                <label>Callback URL</label>
                <input type="url" id="editUserCallback" value="${user.callbackUrl || ''}" placeholder="https://merchant-domain.com/callback">
            </div>
             <div class="d-flex gap-2">
                <div class="form-group" style="flex:1">
                    <label>Pay-in Rate (%)</label>
                    <input type="number" id="editUserPayinRate" value="${user.payinRate || 5.0}" step="0.1" min="5.0">
                    <small class="text-muted">Must be 5.0 or more</small>
                </div>
                <div class="form-group" style="flex:1">
                    <label>Payout Rate (%)</label>
                    <input type="number" id="editUserPayoutRate" value="${user.payoutRate || 3.0}" step="0.1" min="3.0">
                    <small class="text-muted">Must be 3.0 or more</small>
                </div>
            </div>
        </form>
    `;
    document.getElementById('modalFooter').innerHTML = `
        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="updateUser('${user.id}')">Update</button>
    `;
    document.getElementById('modalOverlay').classList.add('active');
}

async function updateUser(userId) {
    const name = document.getElementById('editUserName').value;
    const status = document.getElementById('editUserStatus').value;
    const callbackUrl = document.getElementById('editUserCallback').value;
    const payinRate = document.getElementById('editUserPayinRate').value;
    const payoutRate = document.getElementById('editUserPayoutRate').value;

    try {
        const data = await API.put(`/admin/users/${userId}`, {
            name, status, callbackUrl,
            payinRate: parseFloat(payinRate),
            payoutRate: parseFloat(payoutRate)
        });

        if (data.code === 1) {
            showToast('Merchant updated successfully', 'success');
            closeModal();
            loadUsersData();
        } else {
            showToast(data.msg || 'Failed to update', 'error');
        }
    } catch (error) {
        showToast('Error updating merchant', 'error');
    }
}

function showAdjustBalanceModal(userId, userName, currentBalance) {
    document.getElementById('modalTitle').textContent = `Adjust Balance - ${userName}`;
    document.getElementById('modalBody').innerHTML = `
        < p class= "text-muted mb-2" style = "font-size: 0.75rem;" > Current Balance: <strong>₹${parseFloat(currentBalance).toFixed(2)}</strong></p >
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
            < button class= "btn btn-secondary" onclick = "closeModal()" > Cancel</button >
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
        const data = await API.post(`/ admin / users / ${userId} / balance`, { amount: parseFloat(amount), reason });
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

async function loadApprovalsData() {
    if (currentUser.role !== 'admin') {
        loadDashboard();
        return;
    }

    try {
        const data = await API.get('/admin/payouts/pending');
        const container = document.getElementById('approvalsList');
        if (!container) return;

        if (data.code === 1 && data.data.length > 0) {
            container.innerHTML = data.data.map(p => `
        < tr >
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
                </tr >
            `).join('');
        } else {
            container.innerHTML = `
            < tr > <td colspan="7" class="text-muted" style="text-align:center;">${t('no_pending')}</td></tr >
                `;
        }
    } catch (error) {
        showToast('Failed to load approvals', 'error');
    }
}

async function approvePayout(id) {
    const utr = prompt(t('prompt_utr'));

    try {
        const data = await API.post(`/ admin / payouts / ${id}/approve`, { utr });
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

// ========================================
// ADMIN: ALL TRANSACTIONS
// ========================================

async function loadAllTransactionsData() {
    if (currentUser.role !== 'admin') {
        loadDashboard();
        return;
    }

    try {
        const data = await API.get('/admin/transactions?limit=100');
        const container = document.getElementById('allTransactionsList');
        if (!container) return;

        if (data.code === 1 && data.data.length > 0) {
            container.innerHTML = data.data.map(tx => `
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
            container.innerHTML = `
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

// ========================================
// UI UTILITIES
// ========================================

// ========================================
// BROADCAST
// ========================================

async function sendBroadcast() {
    const message = document.getElementById('broadcastMessage').value;
    if (!message) {
        showToast(t('toast_fill_fields'), 'error');
        return;
    }

    const btn = document.getElementById('btnSendBroadcast');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';

    try {
        const data = await API.post('/admin/broadcast', { message });
        if (data.code === 1) {
            showToast(t('toast_broadcast_sent'), 'success');
            document.getElementById('broadcastResult').classList.remove('hidden');
            document.getElementById('broadcastSuccess').textContent = data.data.success;
            document.getElementById('broadcastFailed').textContent = data.data.failed;
        } else {
            showToast(data.msg || 'Broadcast failed', 'error');
        }
    } catch (error) {
        showToast('Error sending broadcast', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

function showLoader() {
    const loader = document.getElementById('globalLoader');
    if (loader) loader.classList.add('active');
}

function hideLoader() {
    const loader = document.getElementById('globalLoader');
    if (loader) loader.classList.remove('active');
}

function showWelcomeModal(data) {
    const modal = document.getElementById('welcomeModal');
    if (!modal) return;

    document.getElementById('welcomeMerchantId').textContent = data.id || 'N/A';
    document.getElementById('welcomeMerchantKey').textContent = data.merchantKey || 'N/A';
    document.getElementById('welcomePayinRate').textContent = (data.payinRate || 5.0) + '%';
    document.getElementById('welcomePayoutRate').textContent = (data.payoutRate || 3.0) + '%';
    document.getElementById('welcomeBaseUrl').textContent = window.location.origin;

    // Store data for sharing
    modal.dataset.shareData = JSON.stringify(data);

    modal.classList.add('active');
}

function copyShareableMessage() {
    const modal = document.getElementById('welcomeModal');
    if (!modal || !modal.dataset.shareData) return;

    try {
        const data = JSON.parse(modal.dataset.shareData);
        const baseUrl = window.location.origin;

        const message = `${t('msg_welcome')}

${t('msg_account_details')}
${t('label_merchant_id')}: ${data.id}
${t('label_merchant_key')}: ${data.merchantKey}

${t('msg_system_rules')}
- ${t('label_payin_rate')}: ${data.payinRate}%
- ${t('label_payout_rate')}: ${data.payoutRate}%
- ${t('label_settlement')}: ${t('val_settlement')}

${t('msg_api_details')}
- ${t('label_base_url')}: ${baseUrl}
- ${t('msg_docs')}: ${baseUrl}/apidocs`;

        navigator.clipboard.writeText(message).then(() => {
            const btn = modal.querySelector('.btn-share');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-check"></i> ' + t('toast_copied');
            setTimeout(() => {
                btn.innerHTML = originalText;
            }, 2000);
        });
    } catch (e) {
        console.error('Share error', e);
    }
}

function closeWelcomeModal() {
    const modal = document.getElementById('welcomeModal');
    if (modal) modal.classList.remove('active');
}

// Close welcome modal on overlay click
document.getElementById('welcomeModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'welcomeModal') {
        closeWelcomeModal();
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
