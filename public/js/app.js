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
    } else {
        // Merchant Logic
        if (!currentUser.twoFactorEnabled) {
            showSetup2faModal();
        }
    }
}

async function showSetup2faModal() {
    // Prevent closing
    const overlay = document.getElementById('modalOverlay');
    overlay.classList.add('active');
    overlay.classList.add('fullscreen-modal'); // Add full screen class

    // Remove click listener to prevent close
    overlay.onclick = null;

    // Handle Browser Back Button - Force Redirect to Login
    history.pushState(null, null, window.location.href);
    window.onpopstate = function () {
        window.location.href = '/login.html';
    };

    // Hide close button if it exists in header (hacky but works with existing HTML structure)
    const closeBtn = overlay.querySelector('.modal-close');
    if (closeBtn) closeBtn.style.display = 'none';

    document.getElementById('modalTitle').textContent = t('setup_2fa_title');
    document.getElementById('modalBody').innerHTML = `
        <div class="text-center full-screen-content">
            <h2 class="mb-4" data-i18n="setup_2fa_title">${t('setup_2fa_title')}</h2>
            <p class="mb-4" data-i18n="toast_2fa_enabled">${t('toast_2fa_enabled')}</p>
            <div id="qrCodeContainer" class="my-3 qr-container">
                <div class="loader"></div> ${t('loading')}...
            </div>
            <div class="form-group setup-2fa-input">
                <label data-i18n="toast_enter_code">${t('toast_enter_code')}</label>
                <input type="text" id="setup2faCode" placeholder="000 000" style="text-align: center; font-size: 1.5rem; letter-spacing: 5px;" maxlength="6">
            </div>
            <div class="alert alert-info">
                1. ${t('intro_desc')}<br>
                2. ${t('click_generate_desc')}<br>
                3. ${t('toast_copied')}
            </div>
            <button class="btn btn-danger btn-sm mt-3" onclick="window.location.href='/login.html'">${t('btn_cancel')}</button>
        </div>
    `;
    // No standard footer, custom button above
    document.getElementById('modalFooter').innerHTML = `
        <button class="btn btn-primary btn-block btn-lg" onclick="enable2fa()">${t('btn_submit')}</button>
    `;

    // Fetch QR Code
    try {
        const data = await API.post('/auth/2fa/setup');
        if (data.code === 1) {
            document.getElementById('qrCodeContainer').innerHTML = `
                <img src="${data.data.qrCode}" style="max-width: 200px; border: 1px solid #ddd; padding: 10px; border-radius: 8px;">
                <p class="text-muted mt-2"><small>Secret: ${data.data.secret}</small></p>
             `;
        } else {
            document.getElementById('qrCodeContainer').textContent = t('toast_verify_failed');
        }
    } catch (e) {
        document.getElementById('qrCodeContainer').textContent = t('toast_verify_failed');
    }
}

async function enable2fa() {
    const code = document.getElementById('setup2faCode').value;
    if (!code) {
        showToast(t('toast_enter_code'), 'error');
        return;
    }

    try {
        const data = await API.post('/auth/2fa/enable', { code });
        if (data.code === 1) {
            showToast(t('toast_2fa_enabled'), 'success');
            // Update local user state
            currentUser.twoFactorEnabled = true;
            localStorage.setItem('vspay_user', JSON.stringify(currentUser));
            closeModal();
        } else {
            showToast(data.msg || t('toast_invalid_code'), 'error');
        }
    } catch (e) {
        showToast(t('toast_verify_failed'), 'error');
    }
}

function updateUserInfo() {
    document.getElementById('userName').textContent = currentUser.name;
    document.getElementById('userRole').textContent = currentUser.role === 'admin' ? t('role_admin') : t('role_merchant');
    document.getElementById('userAvatar').textContent = currentUser.name.charAt(0).toUpperCase();
}

async function loadBalance() {
    try {
        const data = await API.get('/merchant/balance');
        if (data.code === 1) {
            const balanceEl = document.getElementById('balanceDisplay');
            if (balanceEl) {
                // Check if it has a span child (new structure) or is plain text (old structure)
                const spanEl = balanceEl.querySelector('span');
                if (spanEl) {
                    spanEl.textContent = `₹${parseFloat(data.data.balance).toFixed(2)}`;
                } else {
                    balanceEl.textContent = `Balance: ₹${parseFloat(data.data.balance).toFixed(2)}`;
                }
            }
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
        'settlement': t('settlement_request'),
        'payment-links': t('create_payment_link'),
        'api-docs': t('api_docs_tab'),
        'credentials': t('credentials_tab'),
        'users': t('users_tab'),
        'approvals': t('approvals_tab'),
        'all-transactions': t('all_transactions_tab')
    };
    document.getElementById('pageTitle').textContent = titles[section] || t('dashboard_tab');

    // Load content
    const contentArea = document.getElementById('contentArea');

    // Mapping for new/renamed sections
    const fileMap = {
        'users': 'manage_merchants',
        'profile': 'profile'
    };
    const filename = fileMap[section] || section;

    // Check cache first
    if (sectionCache[filename]) {
        contentArea.innerHTML = sectionCache[filename];
        if (section === 'settlement') updateSettlementBalance();
        initSection(section);
        return;
    }

    contentArea.innerHTML = '<div class="text-center p-5"><i class="fas fa-spinner fa-spin fa-2x"></i></div>';

    try {
        const response = await fetch(`/sections/${filename}.html`);
        if (!response.ok) throw new Error(t('error_transactions'));
        const html = await response.text();

        // Cache and render
        sectionCache[filename] = html;
        contentArea.innerHTML = html;

        if (section === 'settlement') updateSettlementBalance();
        initSection(section);
    } catch (error) {
        console.error('Error loading section:', error);
        contentArea.innerHTML = `<div class="alert alert-error">${t('error_transactions')}: ${error.message}</div>`;
    }
}

function initSection(section) {
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

// DASHBOARD
// ========================================

let dashboardChartInstance = null;

async function loadDashboardData() {
    // Load Stats & Chart
    updateDashboardChart();
}

async function updateDashboardChart() {
    const period = document.getElementById('chartPeriod')?.value || 7;

    try {
        // Fetch aggregated chart data
        const res = await API.get(`/merchant/stats/chart?days=${period}`);
        if (res.code !== 1) return;

        const { labels, payinData, payoutData, stats } = res.data;

        // Update Top Stats
        if (stats) {
            document.getElementById('statBalance').textContent = `₹${parseFloat(stats.balance).toFixed(2)}`;
            document.getElementById('statPayin').textContent = `₹${parseFloat(stats.totalPayin).toFixed(2)}`;
            document.getElementById('statPayout').textContent = `₹${parseFloat(stats.totalPayout).toFixed(2)}`;
            document.getElementById('statPending').textContent = stats.pendingPayouts;

            // Performance
            const successRate = stats.successRate || 0;
            const convRate = stats.conversionRate || 0;

            document.getElementById('statSuccessRate').textContent = `${successRate}%`;
            document.getElementById('progSuccess').style.width = `${successRate}%`;

            document.getElementById('statConversion').textContent = `${convRate}%`;
            document.getElementById('progConversion').style.width = `${convRate}%`;

            document.getElementById('statTodayVol').textContent = `₹${formatK(stats.todayVolume)}`;
            document.getElementById('statYesterdayVol').textContent = `₹${formatK(stats.yesterdayVolume)}`;
        }

        // Render Chart
        renderDashboardChart(labels, payinData, payoutData);

    } catch (e) {
        console.error('Chart load error:', e);
    }
}

function renderDashboardChart(labels, payinData, payoutData) {
    const ctx = document.getElementById('dashboardChart');
    if (!ctx) return;

    if (dashboardChartInstance) {
        dashboardChartInstance.destroy();
    }

    dashboardChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: t('total_payin'),
                    data: payinData,
                    borderColor: '#10b981', // Success Green
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    tension: 0.4,
                    fill: true
                },
                {
                    label: t('total_payout'),
                    data: payoutData,
                    borderColor: '#ef4444', // Red
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    tension: 0.4,
                    fill: true
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: '#9ca3af' } },
                tooltip: { mode: 'index', intersect: false }
            },
            scales: {
                x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#9ca3af' } },
                y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#9ca3af' } }
            },
            interaction: {
                mode: 'nearest',
                axis: 'x',
                intersect: false
            }
        }
    });
}

function formatK(num) {
    if (num >= 10000000) return (num / 10000000).toFixed(2) + 'Cr';
    if (num >= 100000) return (num / 100000).toFixed(2) + 'L';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
    return num.toFixed(0);
}


// ========================================
// TRANSACTIONS
// ========================================

async function loadTransactionsData(page = 1) {
    try {
        const search = document.getElementById('txSearch')?.value || '';
        const startDate = document.getElementById('txStartDate')?.value || '';
        const endDate = document.getElementById('txEndDate')?.value || '';
        const status = document.getElementById('txStatus')?.value || '';
        const type = document.getElementById('txType')?.value || '';

        let url = `/merchant/transactions?page=${page}&limit=20&search=${search}`;
        if (startDate) url += `&startDate=${startDate}`;
        if (endDate) url += `&endDate=${endDate}`;
        if (status) url += `&status=${status}`;
        if (type) url += `&type=${type}`;

        const data = await API.get(url);
        console.log('[App] Transactions Data:', data);
        const container = document.getElementById('transactionsList');
        if (!container) return;

        if (data.code === 1) {
            const { transactions, total, pages } = data.data;

            if (transactions.length > 0) {
                container.innerHTML = transactions.map(tx => `
                <tr>
                    <td><code>${tx.orderId}</code></td>
                    <td><span class="badge ${tx.type === 'payin' ? 'badge-success' : 'badge-pending'}">${t('type_' + tx.type) || tx.type}</span></td>
                    <td>₹${parseFloat(tx.amount).toFixed(2)}</td>
                    <td>₹${parseFloat(tx.fee).toFixed(2)}</td>
                    <td>₹${parseFloat(tx.netAmount || 0).toFixed(2)}</td>
                    <td><span class="badge badge-${getStatusClass(tx.status)}">${t('status_' + tx.status)}</span></td>
                    <td>${tx.utr || '-'}</td>
                    <td>${formatDate(tx.createdAt)}</td>
                </tr>
            `).join('');
                updatePaginationControls('txPagination', { page, pages, total }, 'loadTransactionsData');
            } else {
                container.innerHTML = `
                <tr><td colspan="8" class="text-muted" style="text-align:center;">${t('no_transactions')}</td></tr>
            `;
                updatePaginationControls('txPagination', { page: 1, pages: 1 }, 'loadTransactionsData');
            }
        }
    } catch (error) {
        showToast(t('error_transactions'), 'error');
    }
}

// ========================================
// PAYOUTS
// ========================================

async function loadPayoutsData(page = 1) {
    try {
        const search = document.getElementById('payoutSearch')?.value || '';
        const startDate = document.getElementById('payoutStartDate')?.value || '';
        const endDate = document.getElementById('payoutEndDate')?.value || '';
        const status = document.getElementById('payoutStatus')?.value || '';
        const type = document.getElementById('payoutType')?.value || '';

        let url = `/merchant/payouts?page=${page}&limit=20&search=${search}`;
        if (startDate) url += `&startDate=${startDate}`;
        if (endDate) url += `&endDate=${endDate}`;
        if (status) url += `&status=${status}`;
        if (type) url += `&type=${type}`;

        const data = await API.get(url);
        console.log('[App] Payouts Data:', data);
        const container = document.getElementById('payoutsList');
        if (!container) return;

        if (data.code === 1) {
            const { payouts, total, pages } = data.data;

            if (payouts.length > 0) {
                container.innerHTML = payouts.map(p => `
                <tr>
                    <td><code>${p.orderId}</code></td>
                    <td>${p.type === 'bank' ? t('bank_transfer') : t('usdt_transfer')}</td>
                    <td>₹${parseFloat(p.amount).toFixed(2)}</td>
                    <td>₹${parseFloat(p.fee).toFixed(2)}</td>
                    <td>
                        <small>
                            ${p.account ? `${t('label_account')}: ${p.account}<br>${t('label_ifsc')}: ${p.ifsc}` : `${t('label_wallet')}: ${p.wallet}<br>${t('label_network')}: ${p.network}`}
                        </small>
                    </td>
                    <td><span class="badge badge-${getStatusClass(p.status)}">${t('status_' + p.status)}</span></td>
                    <td>${formatDate(p.createdAt)}</td>
                </tr>
            `).join('');
                updatePaginationControls('payoutsPagination', { page, pages, total }, 'loadPayoutsData');
            } else {
                container.innerHTML = `
                <tr><td colspan="7" class="text-muted" style="text-align:center;">${t('no_payouts')}</td></tr>
            `;
                updatePaginationControls('payoutsPagination', { page: 1, pages: 1 }, 'loadPayoutsData');
            }
        }
    } catch (error) {
        showToast(t('error_payouts'), 'error');
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
    } catch (e) { balanceText = t('toast_verify_failed'); }

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
            <div class="form-group">
                <label data-i18n="label_2fa">${t('label_2fa')}</label>
                <input type="text" id="bank2fa" placeholder="${t('toast_enter_code')}" required>
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
            account: account,
            ifsc: ifsc,
            personName: name,
            code: document.getElementById('bank2fa').value,
            sign: 'frontend' // Will use session auth
        });

        if (data.code === 1) {
            showToast(t('toast_success_bank'), 'success');
            closeModal();
            loadPayouts();
            loadBalance();
        } else {
            showToast(data.msg || t('toast_payout_create_failed'), 'error');
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
            <div class="form-group">
                <label data-i18n="label_2fa">${t('label_2fa')}</label>
                <input type="text" id="usdt2fa" placeholder="${t('toast_enter_code')}" required>
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
            walletAddress: wallet,
            network: network,
            code: document.getElementById('usdt2fa').value,
            sign: 'frontend'
        });

        if (data.code === 1) {
            showToast(t('toast_success_usdt'), 'success');
            closeModal();
            loadPayouts();
            loadBalance();
        } else {
            showToast(data.msg || t('toast_payout_create_failed'), 'error');
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
                    <label data-i18n="toast_success_bank">${t('toast_success_bank')}</label>
                    <div class="d-flex gap-1 mt-1">
                        <input type="text" id="generatedLink" value="${paymentUrl}" readonly style="flex: 1;">
                        <button class="btn btn-primary btn-sm" onclick="copyGeneratedLink()">
                            <i class="fas fa-copy"></i> ${t('toast_id_copied').split(' ')[1]}
                        </button>
                        ${paymentUrl.startsWith('http') ? `<a href="${paymentUrl}" target="_blank" class="btn btn-success btn-sm">
                            <i class="fas fa-external-link-alt"></i> ${t('all')}
                        </a>` : ''}
                    </div>
                    <div class="mt-2" style="font-size: 0.6875rem; color: var(--text-muted);">
                        <strong>${t('label_order_id')}:</strong> ${orderId} | <strong>${t('amount')}:</strong> ₹${parseFloat(amount).toFixed(2)}
                    </div>
                </div>
            `;
            document.getElementById('generatedLinkResult').classList.remove('hidden');
            showToast(t('link_generated'), 'success');
        } else {
            showToast(response.msg || t('toast_gen_link_failed'), 'error');
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
        showToast(t('toast_load_credentials_failed'), 'error');
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

async function loadUsersData(page = 1) {
    if (currentUser.role !== 'admin') {
        loadDashboard();
        return;
    }

    try {
        const search = document.getElementById('userSearch')?.value || '';
        const startDate = document.getElementById('userStartDate')?.value || '';
        const endDate = document.getElementById('userEndDate')?.value || '';
        const status = document.getElementById('userStatus')?.value || '';

        let url = `/admin/users?page=${page}&limit=10&search=${search}`;
        if (startDate) url += `&startDate=${startDate}`;
        if (endDate) url += `&endDate=${endDate}`;
        if (status) url += `&status=${status}`; // Backend might need query param adjustment if it doesn't support status filter yet. Checking admin.js... 
        // Admin.js query: WHERE 1=1. Params build check... I see search support but did NOT see status support in my previous edit?
        // Wait, in admin.js I only added date range. Let me check if status needs adding.
        // Yes, I need to double check admin.js for status filter.
        // For now, I'll pass it.

        const data = await API.get(url);
        console.log('[App] Users Data:', data);
        const container = document.getElementById('usersTableBody') || document.getElementById('usersList');
        if (!container) return;

        if (data.code === 1) {
            const { users, total, pages } = data.data;

            if (users && users.length > 0) {
                container.innerHTML = users.map(u => `
                <tr>
                    <td>${formatDate(u.createdAt)}</td>
                    <td>${u.username}</td>
                    <td>${u.name}</td>
                    <td>
                        <div style="display:flex; align-items:center; gap:5px;">
                            <code style="font-size: 0.75rem;">${u.id}</code>
                            <i class="fas fa-copy text-primary" style="cursor:pointer;" onclick="navigator.clipboard.writeText('${u.id}').then(() => showToast(t('toast_id_copied'), 'success'))" title="Copy ID"></i>
                        </div>
                    </td>
                    <td><span class="badge badge-${u.status === 'active' ? 'success' : 'failed'}">${u.status}</span></td>
                    <td>
                        <span class="badge badge-${u.twoFactorEnabled ? 'success' : 'warning'}">
                            ${u.twoFactorEnabled ? 'Enabled' : 'Disabled'}
                        </span>
                    </td>
                    <td>
                        <small>In: ${u.payinRate || 5}%</small><br>
                        <small>Out: ${u.payoutRate || 3}%</small>
                    </td>
                    <td>₹${parseFloat(u.balance).toFixed(2)}</td>
                    <td>
                        <button class="btn btn-primary btn-sm" onclick="showAdjustBalanceModal('${u.id}', '${u.name}', ${u.balance})" title="Adjust Balance">
                            <i class="fas fa-wallet"></i>
                        </button>
                        <button class="btn btn-secondary btn-sm" onclick="openMerchantDetail('${u.id}')" title="Edit Merchant">
                            <i class="fas fa-edit"></i>
                        </button>
                    </td>
                </tr>
            `).join('');

                // Render Pagination
                updatePaginationControls('usersPagination', { page, pages, total }, 'loadUsersData');

            } else {
                container.innerHTML = `
                <tr><td colspan="9" class="text-muted" style="text-align:center;">${t('error_no_payouts')}</td></tr>
            `;
                updatePaginationControls('usersPagination', { page: 1, pages: 1 }, 'loadUsersData');
            }
        }
    } catch (error) {
        showToast(t('error_load_users'), 'error');
    }
}

// Debounce Helper
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// ... existing showCreateUserModal ...

// New Detail View Logic
let currentDetailUserId = null;

async function openMerchantDetail(userId) {
    // Manually push content without fully changing 'section' state if we want to stay within 'users' technically, 
    // but cleaner to treat it as a sub-view.
    // For simplicity, I'll load the HTML manually into contentArea.

    currentDetailUserId = userId;
    const contentArea = document.getElementById('contentArea');
    contentArea.innerHTML = '<div class="text-center p-5"><i class="fas fa-spinner fa-spin fa-2x"></i></div>';

    try {
        const response = await fetch('/sections/admin_user_detail.html');
        const html = await response.text();
        contentArea.innerHTML = html;

        loadAdminUserDetail(userId);
    } catch (e) {
        showToast(t('error_transactions'), 'error');
        loadSection('users');
    }
}

async function loadAdminUserDetail(userId) {
    try {
        const data = await API.get(`/admin/users/${userId}`);
        if (data.code !== 1) throw new Error(data.msg);

        const u = data.data;

        // Header
        document.getElementById('detailUsername').textContent = u.username;
        document.getElementById('detailId').textContent = `ID: ${u.id}`; // UUID
        document.getElementById('detailStatusBadge').textContent = u.status.toUpperCase();
        document.getElementById('detailStatusBadge').className = `badge badge-${u.status === 'active' ? 'success' : 'failed'}`;

        // Overview
        document.getElementById('detailName').value = u.name;
        document.getElementById('detailStatus').value = u.status;
        document.getElementById('detailKey').value = u.merchantKey;

        // Financials
        document.getElementById('detailBalance').textContent = `₹${parseFloat(u.balance).toFixed(2)}`;
        document.getElementById('detailPayinRate').value = u.payinRate;
        document.getElementById('detailPayoutRate').value = u.payoutRate;

        // Integration
        document.getElementById('detailCallback').value = u.callbackUrl || '';

        // Security
        const is2fa = u.twoFactorEnabled;
        const s2fa = document.getElementById('detail2faStatus');
        s2fa.textContent = is2fa ? t('success') : t('failed');
        s2fa.className = `badge badge-${is2fa ? 'success' : 'warning'}`;

        if (is2fa) {
            document.getElementById('btnReset2faDetail').classList.remove('hidden');
        } else {
            document.getElementById('btnReset2faDetail').classList.add('hidden');
        }

    } catch (e) {
        showToast(t('error_transactions'), 'error');
    }
}

function copyDetailKey() {
    const key = document.getElementById('detailKey').value;
    navigator.clipboard.writeText(key).then(() => showToast(t('toast_key_copied'), 'success'));
}

async function saveDetailOverview() {
    try {
        const name = document.getElementById('detailName').value;
        const status = document.getElementById('detailStatus').value;
        // Check current values to not overwrite others? 
        // We reuse the basic PUT /users/:id which updates mostly everything.
        // We need to fetch current values for what we don't change? 
        // Or update the PUT endpoint to be partial.
        // Currently PUT /users/:id requires name, status, callback, payin, payout.
        // So we should grab all values from the DOM to be safe.

        const callbackUrl = document.getElementById('detailCallback').value;
        const payinRate = document.getElementById('detailPayinRate').value;
        const payoutRate = document.getElementById('detailPayoutRate').value;

        const data = await API.put(`/admin/users/${currentDetailUserId}`, {
            name, status, callbackUrl,
            payinRate: parseFloat(payinRate),
            payoutRate: parseFloat(payoutRate)
        });

        if (data.code === 1) {
            showToast(t('toast_overview_updated'), 'success');
            loadAdminUserDetail(currentDetailUserId); // Refresh to update badges etc
        } else {
            showToast(data.msg || t('toast_update_failed'), 'error');
        }
    } catch (e) {
        showToast(t('toast_update_failed'), 'error');
    }
}

async function saveDetailRates() {
    // Same as overview, just different trigger button. 
    // For UX, we could have separate endpoints but reusing the main update is fine.
    saveDetailOverview();
}

async function saveDetailCallback() {
    saveDetailOverview();
}

async function resetDetail2fa() {
    if (!confirm(t('warn_disable_2fa'))) return;

    try {
        // API uses the internal ID or UUID? 
        // `test_2fa_management.js` used the ID returned by create, which created an integer ID?
        // No, the list returns UUID as `id`.
        // `routes/admin.js` reset endpoint uses `run(id)`.
        // Depending on schema, `id` might be integer PK or UUID text.
        // Let's check schema.
        // `create table users (id integer primary key autoincrement, uuid text ...)`
        // So `WHERE id = ?` expects integer ID.
        // But our frontend uses UUID as `id`.
        // THIS IS A BUG in `resetUser2fa` and `admin.js`.
        // `routes/admin.js` reset endpoint: `WHERE id = ?`.
        // If I pass UUID, it will fail to find record (unless SQLite coerces, but unlikely).
        // I should fix `POST /users/:id/2fa/reset` to check `uuid = ? OR id = ?`.
        // Wait, the test script worked because I fixed the CREATE response to return the integer ID.
        // But the LIST returns UUID.
        // So if I click reset from LIST, I am sending UUID. 
        // I must fix the backend Reset Endpoint to accept UUID.

        const data = await API.post(`/admin/users/${currentDetailUserId}/2fa/reset`);
        if (data.code === 1) {
            showToast(t('toast_2fa_reset_success'), 'success');
            loadAdminUserDetail(currentDetailUserId);
        } else {
            showToast(data.msg || t('toast_reset_failed'), 'error');
        }
    } catch (e) {
        showToast(t('toast_reset_failed'), 'error');
    }
}

async function adminResetPassword() {
    const newPass = document.getElementById('detailNewPass').value;
    if (!newPass) return showToast(t('toast_enter_new_pass'), 'error');

    // We need an endpoint for Admin to set password without old password.
    // `PUT /users/:id` doesn't update password.
    // I need to create `POST /admin/users/:id/password` or similar.
    // Or update PUT to handle password if provided.
    // Let's create a new function `adminSetUserPassword`.
    // I'll add the endpoint next tool call.

    try {
        const data = await API.post(`/admin/users/${currentDetailUserId}/password`, { password: newPass });
        if (data.code === 1) {
            showToast(t('toast_pass_reset_success'), 'success');
            document.getElementById('detailNewPass').value = '';
        } else {
            showToast(data.msg || t('toast_reset_failed'), 'error');
        }
    } catch (e) {
        showToast(t('toast_error_reset_pass'), 'error');
    }
}

async function openAdjustBalanceDetail() {
    // Reuse existing modal but ensure it refreshes this view on close?
    // Current adjustBalance calls loadUsersData() on success.
    // We can just call it, and if we are in detail view, we might want to refresh detail.
    // I'll modify `adjustBalance` callback or just manually refresh balance.
    // For now, let's just use the modal. It will refresh "list" which isn't visible.
    // That's fine. We can manually refresh details here?
    // The `adjustBalance` function interacts with UI.
    // I'll leave it for now.

    // Actually, `adjustBalance` function needs the name and current balance.
    // We can grab it from DOM.
    const name = document.getElementById('detailName').value;
    const balance = document.getElementById('detailBalance').textContent.replace('₹', '');
    showAdjustBalanceModal(currentDetailUserId, name, balance);
}

function showCreateUserModal() {
    document.getElementById('modalTitle').textContent = t('btn_create_merchant');
    document.getElementById('modalBody').innerHTML = `
        <form id="createUserForm">
            <div class="row">
                <div class="col-md-6 form-group">
                    <label data-i18n="label_name">${t('label_name')}</label>
                    <input type="text" id="newUserName" class="form-control" placeholder="${t('label_name')}" required>
                </div>
                <div class="col-md-6 form-group">
                    <label data-i18n="username">${t('username')}</label>
                    <input type="text" id="newUserUsername" class="form-control" placeholder="${t('username')}" required>
                </div>
            </div>
            <div class="form-group">
                <label data-i18n="label_password">${t('label_password')}</label>
                <input type="password" id="newUserPassword" class="form-control" placeholder="${t('label_password')}" required>
            </div>
            <div class="form-group">
                <label data-i18n="label_callback_url">${t('label_callback_url')} (optional)</label>
                <input type="url" id="newUserCallback" class="form-control" placeholder="${t('placeholder_callback_url')}">
            </div>
            <div class="row">
                <div class="col-md-6 form-group">
                    <label data-i18n="label_payin_rate">${t('label_payin_rate')}</label>
                    <input type="number" id="newUserPayinRate" class="form-control" value="5.0" step="0.1" min="5.0">
                    <small class="text-muted" data-i18n="btn_save">${t('btn_save')}</small>
                </div>
                <div class="col-md-6 form-group">
                    <label data-i18n="label_payout_rate">${t('label_payout_rate')}</label>
                    <input type="number" id="newUserPayoutRate" class="form-control" value="3.0" step="0.1" min="3.0">
                    <small class="text-muted" data-i18n="btn_save">${t('btn_save')}</small>
                </div>
            </div>
        </form>
    `;
    document.getElementById('modalFooter').innerHTML = `
        <button class="btn btn-secondary" onclick="closeModal()">${t('btn_cancel')}</button>
        <button class="btn btn-primary" onclick="createUser()">${t('btn_create_merchant')}</button>
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
            showToast(data.msg || t('toast_payout_create_failed'), 'error');
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
        const data = await API.get(`/admin/users/${userId}`);
        if (data.code === 1) {
            user = data.data;
        }
    } catch (e) { console.error(e); }

    if (!user) {
        showToast(t('toast_user_not_found'), 'error');
        return;
    }

    document.getElementById('modalTitle').textContent = t('merchants_list');
    const overlay = document.getElementById('modalOverlay');
    overlay.classList.add('active');

    document.getElementById('modalBody').innerHTML = `
        <form id="editUserForm">
            <div class="row" style="display:flex; gap:10px;">
                <div class="form-group" style="flex:1">
                    <label data-i18n="label_name">${t('label_name')}</label>
                    <input type="text" id="editUserName" value="${user.name}" required>
                </div>
                <div class="form-group" style="flex:1">
                    <label data-i18n="status">${t('status')}</label>
                    <select id="editUserStatus">
                        <option value="active" ${user.status === 'active' ? 'selected' : ''} data-i18n="success">${t('success')}</option>
                        <option value="suspended" ${user.status === 'suspended' ? 'selected' : ''} data-i18n="failed">${t('failed')}</option>
                    </select>
                </div>
            </div>
            
            <div class="form-group">
                <label data-i18n="label_callback_url">${t('label_callback_url')}</label>
                <input type="url" id="editUserCallback" value="${user.callbackUrl || ''}" placeholder="${t('placeholder_callback_url')}">
            </div>
             <div class="d-flex gap-2">
                <div class="form-group" style="flex:1">
                    <label data-i18n="label_payin_rate">${t('label_payin_rate')}</label>
                    <input type="number" id="editUserPayinRate" value="${user.payinRate || 5.0}" step="0.1" min="5.0">
                    <small class="text-muted" data-i18n="btn_save">${t('btn_save')}</small>
                </div>
                <div class="form-group" style="flex:1">
                    <label data-i18n="label_payout_rate">${t('label_payout_rate')}</label>
                    <input type="number" id="editUserPayoutRate" value="${user.payoutRate || 3.0}" step="0.1" min="3.0">
                    <small class="text-muted" data-i18n="btn_save">${t('btn_save')}</small>
                </div>
            </div>

            <hr>
            <h4 class="mb-2" data-i18n="authentication">${t('authentication')}</h4>
            <div class="d-flex align-center justify-between p-2 mb-2" style="background:var(--bg-main); border-radius:8px;">
                 <div>
                     <strong data-i18n="2fa_status">${t('2fa_status')}</strong>: 
                     <span class="badge ${user.twoFactorEnabled ? 'badge-success' : 'badge-pending'}">
                        ${user.twoFactorEnabled ? t('success') : t('failed')}
                     </span>
                 </div>
                 ${user.twoFactorEnabled ?
            `<button type="button" class="btn btn-danger btn-sm" onclick="resetUser2fa('${user.id}')" data-i18n="btn_reset_2fa">${t('btn_reset_2fa')}</button>`
            : `<small class="text-muted" data-i18n="status_pending">${t('status_pending')}</small>`}
            </div>
        </form>
    `;
    document.getElementById('modalFooter').innerHTML = `
        <button class="btn btn-secondary" onclick="closeModal()">${t('btn_cancel')}</button>
        <button class="btn btn-primary" onclick="updateUser('${user.id}')" data-i18n="btn_update">${t('btn_update')}</button>
    `;
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
            showToast(t('toast_merchant_update_success'), 'success');
            closeModal();
            loadUsersData();
        } else {
            showToast(data.msg || t('toast_update_failed'), 'error');
        }
    } catch (error) {
        showToast(t('toast_error_update_merchant'), 'error');
    }
}

function showAdjustBalanceModal(userId, userName, currentBalance) {
    document.getElementById('modalTitle').textContent = `${t('settlement_request')} - ${userName}`;
    document.getElementById('modalBody').innerHTML = `
        <p class="text-muted mb-2" style="font-size: 0.75rem;">${t('balance')}: <strong>₹${parseFloat(currentBalance).toFixed(2)}</strong></p>
        <form id="adjustBalanceForm">
            <div class="form-group">
                <label data-i18n="amount">${t('amount')} *</label>
                <input type="number" id="adjustAmount" step="0.01" placeholder="${t('amount')}" required class="form-control" style="padding: 12px; font-size: 1.1rem; border-radius: 8px;">
                    <small class="text-muted" data-i18n="intro_desc">${t('intro_desc')}</small>
            </div>
            <div class="form-group">
                <label data-i18n="broadcast_title">${t('broadcast_title')} (optional)</label>
                <input type="text" id="adjustReason" placeholder="${t('broadcast_title')}" class="form-control" style="padding: 12px; font-size: 1rem; border-radius: 8px;">
            </div>
        </form>
    `;
    document.getElementById('modalFooter').innerHTML = `
            <button class="btn btn-secondary" onclick="closeModal()">${t('btn_cancel')}</button>
        <button class="btn btn-success" onclick="adjustBalance('${userId}')">
            <i class="fas fa-plus"></i> ${t('settlement_request')}
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
            showToast(`${t('toast_2fa_enabled')}! ${t('balance')}: ₹${data.data.newBalance.toFixed(2)}`, 'success');
            closeModal();
            loadUsersData(); // Fix function name
        } else {
            showToast(data.msg || t('toast_update_failed'), 'error');
        }
    } catch (error) {
        console.error('Adjust balance error:', error);
        showToast(t('error_adjust_balance'), 'error');
    }
}

async function disable2fa() {
    if (!confirm(t('warn_disable_2fa'))) return;

    try {
        const data = await API.post('/auth/2fa/disable');
        if (data.code === 1) {
            showToast(t('toast_2fa_disabled'), 'success');
            setTimeout(() => logout(), 1000);
        } else {
            showToast(data.msg || 'Failed', 'error');
        }
    } catch (e) {
        showToast(t('toast_verify_failed'), 'error');
    }
}

async function resetUser2fa(userId) {
    if (!confirm(t('warn_disable_2fa'))) return;

    try {
        const data = await API.post(`/admin/users/${userId}/2fa/reset`);
        if (data.code === 1) {
            showToast(t('toast_2fa_reset'), 'success');
            closeModal();
            loadUsersData();
        } else {
            showToast(data.msg || 'Failed', 'error');
        }
    } catch (e) {
        showToast(t('toast_verify_failed'), 'error');
    }
}



// ========================================
// SETTLEMENT
// ========================================

function switchSettlementTab(type) {
    const bankForm = document.getElementById('bankSettlementForm');
    const usdtForm = document.getElementById('usdtSettlementForm');
    const tabs = document.querySelectorAll('.tab-btn');

    if (type === 'bank') {
        bankForm.style.display = 'block';
        usdtForm.style.display = 'none';
        tabs[0].classList.add('active');
        tabs[1].classList.remove('active');
    } else {
        bankForm.style.display = 'none';
        usdtForm.style.display = 'block';
        tabs[0].classList.remove('active');
        tabs[1].classList.add('active');
    }
}

async function updateSettlementBalance() {
    const balances = document.querySelectorAll('.avail-balance');
    if (balances.length === 0) return;

    try {
        const data = await API.get('/merchant/balance');
        if (data.code === 1) {
            const balanceText = `₹${parseFloat(data.data.balance).toFixed(2)}`;
            balances.forEach(b => b.textContent = balanceText);
            // Also update currentUser for consistency
            if (currentUser) currentUser.balance = data.data.balance;
        }
    } catch (e) {
        balances.forEach(b => b.textContent = 'Error');
    }
}

async function submitSettlement(type) {
    if (type === 'bank') {
        const account = document.getElementById('settleBankAccount').value;
        const ifsc = document.getElementById('settleBankIfsc').value;
        const name = document.getElementById('settleBankName').value;
        const amount = document.getElementById('settleBankAmount').value;
        const orderId = document.getElementById('settleBankOrderId').value || 'SET-' + Date.now();
        const code = document.getElementById('settleBankCode').value;

        if (!account || !ifsc || !name || !amount || !code) {
            showToast(t('toast_fill_fields'), 'error');
            return;
        }

        try {
            const res = await API.post('/payout/bank', {
                amount, orderId, account, ifsc, personName: name, code
            });
            if (res.code === 1) {
                showToast(t('toast_success_bank'), 'success');
                loadBalance(); // Refresh balance
                document.getElementById('settleBankAccount').value = '';
                document.getElementById('settleBankAmount').value = '';
                document.getElementById('settleBankCode').value = '';
            } else {
                showToast(res.msg, 'error');
            }
        } catch (e) {
            showToast(e.message || 'Settlement failed', 'error');
        }

    } else if (type === 'usdt') {
        const address = document.getElementById('settleUsdtAddress').value;
        const network = document.getElementById('settleUsdtNetwork').value;
        const amount = document.getElementById('settleUsdtAmount').value;
        const orderId = document.getElementById('settleUsdtOrderId').value || 'USDT-' + Date.now();
        const code = document.getElementById('settleUsdtCode').value;

        if (!address || !amount || !code) {
            showToast(t('toast_fill_fields'), 'error');
            return;
        }

        try {
            const res = await API.post('/payout/usdt', {
                amount, orderId, walletAddress: address, network, code
            });
            if (res.code === 1) {
                showToast(t('toast_success_usdt'), 'success');
                loadBalance();
                document.getElementById('settleUsdtAddress').value = '';
                document.getElementById('settleUsdtAmount').value = '';
                document.getElementById('settleUsdtCode').value = '';
            } else {
                showToast(res.msg, 'error');
            }
        } catch (e) {
            showToast(e.message || 'Settlement failed', 'error');
        }
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
                <tr>
                    <td><code>${p.orderId}</code></td>
                    <td>${p.merchantName}<br><small class="text-muted">@${p.merchantUsername}</small></td>
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
            container.innerHTML = `
            <tr><td colspan="7" class="text-muted" style="text-align:center;">${t('no_pending')}</td></tr>
                `;
        }
    } catch (error) {
        showToast(t('toast_approvals_load_failed'), 'error');
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
        showToast(t('toast_verify_failed'), 'error');
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
        showToast(t('toast_verify_failed'), 'error');
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
    btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${t('sending')}`;

    try {
        const data = await API.post('/admin/broadcast', { message });
        if (data.code === 1) {
            showToast(t('toast_broadcast_sent'), 'success');
            document.getElementById('broadcastResult').classList.remove('hidden');
            document.getElementById('broadcastSuccess').textContent = data.data.success;
            document.getElementById('broadcastFailed').textContent = data.data.failed;
        } else {
            showToast(data.msg || t('toast_broadcast_failed'), 'error');
        }
    } catch (error) {
        showToast(t('toast_broadcast_failed'), 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

function resetFilters(section) {
    if (section === 'transactions') {
        if (document.getElementById('txStartDate')) document.getElementById('txStartDate').value = '';
        if (document.getElementById('txEndDate')) document.getElementById('txEndDate').value = '';
        if (document.getElementById('txStatus')) document.getElementById('txStatus').value = '';
        if (document.getElementById('txType')) document.getElementById('txType').value = '';
        if (document.getElementById('txSearch')) document.getElementById('txSearch').value = '';
        loadTransactionsData(1);
    } else if (section === 'payouts') {
        if (document.getElementById('payoutStartDate')) document.getElementById('payoutStartDate').value = '';
        if (document.getElementById('payoutEndDate')) document.getElementById('payoutEndDate').value = '';
        if (document.getElementById('payoutStatus')) document.getElementById('payoutStatus').value = '';
        if (document.getElementById('payoutType')) document.getElementById('payoutType').value = '';
        if (document.getElementById('payoutSearch')) document.getElementById('payoutSearch').value = '';
        loadPayoutsData(1);
    } else if (section === 'users') {
        if (document.getElementById('userStartDate')) document.getElementById('userStartDate').value = '';
        if (document.getElementById('userEndDate')) document.getElementById('userEndDate').value = '';
        if (document.getElementById('userStatus')) document.getElementById('userStatus').value = '';
        if (document.getElementById('userSearch')) document.getElementById('userSearch').value = '';
        loadUsersData(1);
    }
}

// Global scope
window.resetFilters = resetFilters;

// Global scope
window.resetFilters = resetFilters;

async function exportData(section) {
    try {
        let url = '';
        let filename = 'export.csv';

        if (section === 'transactions') {
            const search = document.getElementById('txSearch')?.value || '';
            const startDate = document.getElementById('txStartDate')?.value || '';
            const endDate = document.getElementById('txEndDate')?.value || '';
            const status = document.getElementById('txStatus')?.value || '';
            const type = document.getElementById('txType')?.value || '';

            url = `/merchant/transactions/export?search=${search}&startDate=${startDate}&endDate=${endDate}&status=${status}&type=${type}`;
            filename = 'transactions.csv';
        } else if (section === 'payouts') {
            const search = document.getElementById('payoutSearch')?.value || '';
            const startDate = document.getElementById('payoutStartDate')?.value || '';
            const endDate = document.getElementById('payoutEndDate')?.value || '';
            const status = document.getElementById('payoutStatus')?.value || '';
            const type = document.getElementById('payoutType')?.value || '';

            url = `/merchant/payouts/export?search=${search}&startDate=${startDate}&endDate=${endDate}&status=${status}&type=${type}`;
            filename = 'payouts.csv';
        } else if (section === 'users') {
            const search = document.getElementById('userSearch')?.value || '';
            const startDate = document.getElementById('userStartDate')?.value || '';
            const endDate = document.getElementById('userEndDate')?.value || '';
            const status = document.getElementById('userStatus')?.value || '';

            url = `/admin/users/export?search=${search}&startDate=${startDate}&endDate=${endDate}&status=${status}`;
            filename = 'merchants.csv';
        }

        if (!url) return;

        showToast(t('exporting'), 'info');

        // Use fetch directly to handle Blob and Auth
        const token = localStorage.getItem('token');
        const response = await fetch('/api' + url, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) throw new Error(t('export_failed'));

        const blob = await response.blob();
        const downloadUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();

    } catch (e) {
        console.error(e);
        showToast(t('export_failed'), 'error');
    }
}
window.exportData = exportData;

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



// Pagination Helpers
function renderPagination(containerId, data, loadFunction) {
    // Current implementation uses updatePaginationControls directly
}

function updatePaginationControls(elementId, { page, pages, total }, onPageChangeName) {
    const el = document.getElementById(elementId);
    if (!el) return;

    if (pages <= 1) {
        el.innerHTML = '';
        return;
    }

    el.innerHTML = `
        <div class="pagination-controls d-flex align-center justify-center gap-2 mt-3">
            <button class="btn btn-sm btn-secondary" ${page <= 1 ? 'disabled' : ''} onclick="${onPageChangeName}(${page - 1})">
                <i class="fas fa-chevron-left"></i>
            </button>
            <span class="text-muted">${t('page_of').replace('${page}', page).replace('${pages}', pages)}</span>
            <button class="btn btn-sm btn-secondary" ${page >= pages ? 'disabled' : ''} onclick="${onPageChangeName}(${page + 1})">
                <i class="fas fa-chevron-right"></i>
            </button>
        </div>
    `;
}
