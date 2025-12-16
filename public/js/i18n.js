const translations = {
    en: {
        // App Shell
        app_title: "Merchant Dashboard",
        welcome_user: "Welcome, ",
        balance: "Balance",
        logout: "Logout",
        language: "Language",

        // Sidebar
        dashboard_tab: "Dashboard",
        transactions_tab: "Transactions",
        payouts_tab: "Payouts",
        create_payment_link: "Payment Links",
        api_docs_tab: "API Docs",
        credentials_tab: "Credentials",
        users_tab: "Merchants",
        approvals_tab: "Pending Approvals",
        all_transactions_tab: "All Transactions",

        // Dashboard Stats
        stat_balance: "Current Balance",
        stat_payin: "Total Pay-In",
        stat_payout: "Total Payout",
        stat_pending: "Pending Payouts",
        recent_transactions: "Recent Transactions",
        view_all: "View All",

        // Tables
        order_id: "Order ID",
        type: "Type",
        amount: "Amount",
        fee: "Fee",
        net_amount: "Net Amount",
        status: "Status",
        date: "Date",
        utr: "UTR",
        details: "Details",
        actions: "Actions",
        loading: "Loading...",
        no_transactions: "No transactions found",
        no_payouts: "No payouts found",
        no_recent: "No transactions yet",
        merchant: "Merchant",
        wallet_address: "Wallet Address",
        network: "Network",

        // Status & Types (Dynamic)
        status_success: "Success",
        status_pending: "Pending",
        status_failed: "Failed",
        status_processing: "Processing",
        status_rejected: "Rejected",
        status_approved: "Approved",
        type_payin: "Pay-In",
        type_payout: "Payout",
        type_bank: "Bank",
        type_usdt: "USDT",

        // Payouts Page
        bank_payout_title: "Bank Payout",
        bank_payout_desc: "Automatic processing via IMPS/NEFT",
        usdt_payout_title: "USDT Payout",
        usdt_payout_desc: "Manual approval required",
        payout_history: "Payout History",

        // Modals
        available_balance: "Available Balance",
        payout_fee_info: "Fee: 3% + ₹6 | Minimum: ₹100",
        payout_usdt_info: "Fee: 3% + ₹6 | Minimum: 500 USDT (₹50,000) | Rate: 1 USDT = ₹100 | Requires admin approval",
        label_amount: "Amount (₹)",
        label_account: "Account Number",
        label_ifsc: "IFSC Code",
        label_name: "Account Holder Name",
        label_wallet: "Wallet Address",
        label_network: "Network",
        label_usdt_amount: "Amount (₹) - Will be converted to USDT at ₹100/USDT",
        btn_cancel: "Cancel",
        btn_submit: "Submit Payout",

        // Validation / Toasts
        toast_fill_fields: "Please fill all fields",
        toast_success_bank: "Bank payout submitted successfully!",
        toast_success_usdt: "USDT payout submitted for approval!",
        toast_error: "Error creating payout",
        toast_copied: "Copied to clipboard!",
        toast_approved: "Payout approved!",
        toast_rejected: "Payout rejected and balance refunded",

        // Payment Links
        generate_link: "Generate Link",
        copy_btn: "Copy",
        open_btn: "Open",
        link_generated: "Payment Link Generated Successfully!",
        link_instruct_title: "How Payment Links Work",
        link_instruct_1: "Generate a payment link with the desired amount",
        link_instruct_2: "Share the link with your customer or open it to test",
        link_instruct_3: "Customer completes payment on the gateway",
        link_instruct_4: "Your callback URL receives the payment confirmation",
        link_instruct_5: "Balance is credited to your account (minus 5% fee)",

        // Credentials
        api_credentials: "API Credentials",
        merchant_key: "Merchant Key",

        // Login Page
        login_title: "Payment Gateway Portal",
        login_header: "Sign In",
        label_username: "Username",
        label_password: "Password",
        placeholder_username: "Enter your username",
        placeholder_password: "Enter your password",
        btn_signin: "Sign In",
        btn_signing_in: "Signing in...",
        contact_admin: "Contact administrator for account access",
        error_invalid: "Invalid credentials",
        error_connection: "Connection error. Please try again.",

        // Admin
        admin_pending_title: "Pending USDT Payouts",
        admin_all_tx: "All Transactions",
        prompt_utr: "Enter transaction ID/UTR (optional):",
        prompt_reason: "Enter rejection reason:",
        no_pending: "No pending approvals",

        // Toasts & Errors (New)
        error_load_tx: "Failed to load transactions",
        error_load_payouts: "Failed to load payouts",
        error_min_amount: "Amount must be at least ₹100",
        error_gen_link: "Error generating payment link",
        toast_callback_updated: "Callback URL updated!",
        error_callback_update: "Error updating callback URL",
        toast_key_regen: "Merchant key regenerated!",
        error_key_regen: "Error regenerating key",
        error_load_users: "Failed to load users",
        toast_merchant_created: "Merchant created successfully!",
        error_create_merchant: "Error creating merchant",
        error_valid_amount: "Please enter a valid amount",
        error_adjust_balance: "Error adjusting balance",

        // Missing Descriptions
        credentials_desc: "Use these credentials to authenticate your API requests.",
        link_create_desc: "Create a payment link to test the pay-in flow. The link will redirect to the payment gateway for processing.",
        label_user_id: "User ID",
        label_callback_url: "Callback URL",
        btn_save: "Save",
        btn_regen_key: "Regenerate Merchant Key",
        warn_regen_key: "Warning: This will invalidate your current key",

        // Welcome Popup
        welcome_title: "Congratulations!",
        welcome_subtitle: "Merchant account has been successfully created.",
        label_merchant_id: "Merchant ID",
        label_merchant_key: "Merchant Key (Secret)",
        section_rules: "System Rules",
        label_payin_rate: "Pay-in Rate",
        label_payout_rate: "Payout Rate",
        label_settlement: "Settlement",
        val_settlement: "Instant (T+0)",
        section_api: "API Integration",
        label_base_url: "Base URL",
        btn_copy_message: "Copy Shareable Message",
        btn_awesome: "Awesome, Let's Go!",

        // Share Message Template
        msg_welcome: "🎉 Welcome to VSPAY!",
        msg_account_details: "Here are your account details:",
        msg_system_rules: "⚡ System Rules:",
        msg_api_details: "🔗 API Integration:",
        msg_account_details: "Here are your account details:",
        msg_system_rules: "⚡ System Rules:",
        msg_api_details: "🔗 API Integration:",
        msg_docs: "Docs",

        // Broadcast
        broadcast_title: "Bot Broadcast",
        broadcast_desc: "Send a message to all merchants who have linked their Telegram account.",
        label_message: "Message",
        btn_send_broadcast: "Send Broadcast",
        profile_tab: "Profile",
        profile_details: "Profile Details",
        section_security: "Security",
        change_password: "Change Password",
        current_password: "Current Password",
        new_password: "New Password",
        btn_update_pass: "Update Password",
        toast_pass_updated: "Password updated successfully",
        error_pass_update: "Error updating password",

        toast_broadcast_sent: "Broadcast sent successfully!",
        recent_broadcast: "Broadcast Result",
        sent_success: "Sent Successfully",
        sent_failed: "Failed",
        btn_disable_2fa: "Disable 2FA & Logout",
        warn_disable_2fa: "Disabling 2FA will lower your account security. You will be logged out.",
        reset_2fa: "Reset 2FA",
        toast_2fa_disabled: "2FA Disabled",
        toast_2fa_reset: "2FA Reset Successfully",

        // 2FA Setup
        setup_2fa_title: "Enable 2FA Security",
        setup_2fa_subtitle: "Secure Your Account",
        setup_2fa_desc: "Two-Factor Authentication is required for security.",
        setup_2fa_label: "Enter 6-digit Code from Authenticator App",
        setup_2fa_step1: "1. Install Google Authenticator.",
        setup_2fa_step2: "2. Scan the QR Code.",
        setup_2fa_step3: "3. Enter the generated code.",
        btn_enable_2fa: "Box Secure & Enable 2FA",
        btn_cancel_logout: "Cancel & Logout"
    },
    zh: {
        // App Shell
        app_title: "商户后台",
        welcome_user: "欢迎, ",
        balance: "余额",
        logout: "退出登录",
        language: "语言",

        // Sidebar
        dashboard_tab: "仪表盘",
        transactions_tab: "交易记录",
        payouts_tab: "代付管理",
        create_payment_link: "支付链接",
        api_docs_tab: "API 文档",
        credentials_tab: "API 凭证",
        users_tab: "商户管理",
        approvals_tab: "待审批",
        all_transactions_tab: "所有交易",

        // Dashboard Stats
        stat_balance: "当前余额",
        stat_payin: "总充值",
        stat_payout: "总代付",
        stat_pending: "待处理代付",
        recent_transactions: "最近交易",
        view_all: "查看全部",

        // Tables
        order_id: "订单号",
        type: "类型",
        amount: "金额",
        fee: "手续费",
        net_amount: "到账金额",
        status: "状态",
        date: "日期",
        utr: "UTR / 流水号",
        details: "详情",
        actions: "操作",
        loading: "加载中...",
        no_transactions: "暂无交易记录",
        no_payouts: "暂无代付记录",
        no_recent: "暂无最近交易",
        merchant: "商户",
        wallet_address: "钱包地址",
        network: "网络",

        // Status & Types
        status_success: "成功",
        status_pending: "处理中",
        status_failed: "失败",
        status_processing: "进行中",
        status_rejected: "已拒绝",
        status_approved: "已批准",
        type_payin: "充值",
        type_payout: "代付",
        type_bank: "银行转账",
        type_usdt: "USDT",

        // Payouts Page
        bank_payout_title: "银行卡代付",
        bank_payout_desc: "通过 IMPS/NEFT 自动处理",
        usdt_payout_title: "USDT 代付",
        usdt_payout_desc: "需人工审核",
        payout_history: "代付历史",

        // Modals
        available_balance: "可用余额",
        payout_fee_info: "手续费: 3% + ₹6 | 最低: ₹100",
        payout_usdt_info: "手续费: 3% + ₹6 | 最低 500 USDT (₹50,000) | 汇率: 1 USDT = ₹100 | 需管理员审核",
        label_amount: "金额 (₹)",
        label_account: "银行账号",
        label_ifsc: "IFSC 代码",
        label_name: "开户名",
        label_wallet: "钱包地址",
        label_network: "网络",
        label_usdt_amount: "金额 (₹) - 按 ₹100/USDT 转换为 USDT",
        btn_cancel: "取消",
        btn_submit: "提交代付",

        // Validation / Toasts
        toast_fill_fields: "请填写所有字段",
        toast_success_bank: "银行卡代付提交成功！",
        toast_success_usdt: "USDT 代付已提交审核！",
        toast_error: "创建代付时出错",
        toast_copied: "已复制到剪贴板！",
        toast_approved: "代付已批准！",
        toast_rejected: "代付已拒绝，余额已退回",

        // Payment Links
        generate_link: "生成链接",
        copy_btn: "复制",
        open_btn: "打开",
        link_generated: "支付链接生成成功！",
        link_instruct_title: "支付链接如何工作",
        link_instruct_1: "生成所需金额的支付链接",
        link_instruct_2: "将链接分享给客户或打开测试",
        link_instruct_3: "客户在网关完成支付",
        link_instruct_4: "您的回调 URL 收到支付确认",
        link_instruct_5: "余额计入您的账户 (扣除 5% 手续费)",

        // Credentials
        api_credentials: "API 凭证",
        merchant_key: "商户密钥",

        // Login Page
        login_title: "支付网关管理系统",
        login_header: "登录",
        label_username: "用户名",
        label_password: "密码",
        placeholder_username: "请输入用户名",
        placeholder_password: "请输入密码",
        btn_signin: "登录",
        btn_signing_in: "登录中...",
        contact_admin: "联系管理员获取账户",
        error_invalid: "凭证无效",
        error_connection: "连接错误，请重试。",

        // Admin
        admin_pending_title: "待审核 USDT 代付",
        admin_all_tx: "所有交易记录",
        prompt_utr: "请输入交易 ID/UTR (可选):",
        prompt_reason: "请输入拒绝原因:",
        no_pending: "暂无待审核项",

        // Toasts & Errors (New)
        error_load_tx: "加载交易记录失败",
        error_load_payouts: "加载代付记录失败",
        error_min_amount: "金额必须至少 ₹100",
        error_gen_link: "生成支付链接失败",
        toast_callback_updated: "回调 URL 更新成功！",
        error_callback_update: "更新回调 URL 失败",
        toast_key_regen: "商户密钥已重新生成！",
        error_key_regen: "重新生成密钥失败",
        error_load_users: "加载商户列表失败",
        toast_merchant_created: "商户创建成功！",
        error_create_merchant: "创建商户失败",
        error_valid_amount: "请输入有效金额",
        error_adjust_balance: "调整余额失败",

        // Missing Descriptions
        credentials_desc: "使用这些凭证来验证您的 API 请求。",
        link_create_desc: "创建支付链接以测试充值流程。链接将重定向到支付网关进行处理。",
        label_user_id: "用户 ID",
        label_callback_url: "回调地址",
        btn_save: "保存",
        btn_regen_key: "重新生成商户密钥",
        warn_regen_key: "警告: 这将使您当前的密钥失效",

        // Welcome Popup
        welcome_title: "恭喜！",
        welcome_subtitle: "商户账户已成功创建。",
        label_merchant_id: "商户 ID",
        label_merchant_key: "商户密钥 (保密)",
        section_rules: "系统规则",
        label_payin_rate: "充值费率",
        label_payout_rate: "代付费率",
        label_settlement: "结算周期",
        val_settlement: "即时 (T+0)",
        section_api: "API 集成",
        label_base_url: "基础 URL",
        btn_copy_message: "复制分享信息",
        btn_awesome: "太棒了，开始吧！",

        // Share Message Template
        msg_welcome: "🎉 欢迎使用 VSPAY!",
        msg_account_details: "这是您的账户详情:",
        msg_system_rules: "⚡ 系统规则:",
        msg_api_details: "🔗 API 集成:",
        msg_account_details: "这是您的账户详情:",
        msg_system_rules: "⚡ 系统规则:",
        msg_api_details: "🔗 API 集成:",
        msg_docs: "文档",

        // Broadcast
        broadcast_title: "机器人广播",
        broadcast_desc: "向所有绑定 Telegram 的商户发送消息。",
        label_message: "消息内容",
        profile_tab: "个人资料",
        profile_details: "个人资料详情",
        section_security: "账户安全",
        change_password: "修改密码",
        current_password: "当前密码",
        new_password: "新密码",
        btn_update_pass: "更新密码",
        toast_pass_updated: "密码更新成功",
        error_pass_update: "更新密码失败",

        btn_send_broadcast: "发送广播",
        toast_broadcast_sent: "广播发送成功！",
        recent_broadcast: "广播结果",
        sent_success: "发送成功",
        sent_failed: "发送失败",
        btn_disable_2fa: "禁用 2FA 并退出",
        warn_disable_2fa: "禁用 2FA 会降低账户安全性。您将被退出登录。",
        reset_2fa: "重置 2FA",
        toast_2fa_disabled: "2FA 已禁用",
        toast_2fa_reset: "2FA 重置成功",

        // 2FA Setup
        setup_2fa_title: "开启 2FA 安全验证",
        setup_2fa_subtitle: "保护您的账户",
        setup_2fa_desc: "为了您的账户安全，必须开启双重验证。",
        setup_2fa_label: "输入验证器 App 中的 6 位验证码",
        setup_2fa_step1: "1. 安装 Google Authenticator (谷歌验证器)。",
        setup_2fa_step2: "2. 扫描下方二维码。",
        setup_2fa_step3: "3. 输入生成的验证码。",
        btn_enable_2fa: "安全绑定并开启 2FA",
        btn_cancel_logout: "取消并退出"
    }
};

window.translations = translations;

// ========================================
// I18N HELPERS
// ========================================

/**
 * Get translation for key
 * @param {string} key 
 * @param {string} defaultVal 
 */
window.t = function (key, defaultVal) {
    if (!window.translations) return defaultVal || key;

    const lang = localStorage.getItem('vspay_lang') || 'en';
    const dict = window.translations[lang] || window.translations['en'];
    return dict[key] || defaultVal || key;
};

/**
 * Change application language
 * @param {string} lang - 'en' or 'zh'
 */
window.changeLanguage = function (lang) {
    if (!window.translations || !window.translations[lang]) return;

    localStorage.setItem('vspay_lang', lang);
    const dict = window.translations[lang];

    // Update all elements with data-i18n attribute
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.dataset.i18n;
        if (dict[key]) {
            if (el.tagName === 'INPUT' && el.getAttribute('placeholder')) {
                el.placeholder = dict[key];
            } else {
                el.textContent = dict[key];
            }
        }
    });

    // Update switcher dropdown
    const switcher = document.getElementById('langSwitcher');
    if (switcher) switcher.value = lang;

    // Reload current section in app.js if exists
    if (typeof loadSection === 'function' && typeof currentSection !== 'undefined') {
        loadSection(currentSection);
    }
};

/**
 * Initialize language from localStorage
 */
window.initLanguage = function () {
    const savedLang = localStorage.getItem('vspay_lang') || 'en';

    // Set switcher
    const switcher = document.getElementById('langSwitcher');
    if (switcher) switcher.value = savedLang;

    // Apply data-i18n
    const dict = window.translations[savedLang] || window.translations['en'];
    if (dict) {
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.dataset.i18n;
            if (dict[key]) {
                if (el.tagName === 'INPUT' && el.getAttribute('placeholder')) {
                    el.placeholder = dict[key];
                } else {
                    el.textContent = dict[key];
                }
            }
        });
    }
}
