const { Telegraf } = require('telegraf');
const { getDb } = require('../config/database');
const silkpayService = require('./silkpay');
const { createPayinOrder } = require('./order');
const { generateOrderId } = require('../utils/signature');
const { getUserRates } = require('../utils/rates');

let bot = null;

async function initBot() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
        console.warn('TELEGRAM_BOT_TOKEN is missing. Bot will not start.');
        return;
    }

    bot = new Telegraf(token);
    const db = getDb();

    // Generic reply helper to quote message
    const reply = (ctx, text) => ctx.reply(text, { reply_to_message_id: ctx.message.message_id });

    // Command: /bind <MERCHANT_KEY>
    bot.command('bind', async (ctx) => {
        try {
            const message = ctx.message.text.split(' ');
            if (message.length !== 2) {
                return reply(ctx, 'Usage: /bind <MERCHANT_KEY>\n用法: /bind <商户密钥>');
            }

            const merchantKey = message[1].trim();
            const user = await db.prepare('SELECT id, name, telegram_group_id FROM users WHERE merchant_key = ?').get(merchantKey);

            if (!user) {
                return reply(ctx, 'Invalid Merchant Key.\n无效的商户密钥。');
            }

            const chatId = ctx.chat.id.toString();

            // Check if this Group is already bound to another merchant
            const existingGroup = await db.prepare('SELECT username FROM users WHERE telegram_group_id = ? AND id != ?').get(chatId, user.id);
            if (existingGroup) {
                return reply(ctx, `⚠️ This group is already bound to merchant: ${existingGroup.username}. Unbind there first.\n⚠️ 此群组已绑定到商户: ${existingGroup.username}。请先解绑。`);
            }

            // Check if this Merchant is already bound to another group
            if (user.telegram_group_id && user.telegram_group_id !== chatId) {
                return reply(ctx, `⚠️ This merchant is already bound to another group. Contact admin to reset.\n⚠️ 此商户已绑定到其他群组。请联系管理员重置。`);
            }

            await db.prepare('UPDATE users SET telegram_group_id = ? WHERE id = ?').run(chatId, user.id);

            reply(ctx, `✅ Successfully bound to merchant: ${user.name}\n✅ 成功绑定商户: ${user.name}`);
        } catch (error) {
            console.error('Bot Bind Error:', error);
            reply(ctx, 'An error occurred during binding.\n绑定过程中发生错误。');
        }
    });

    // Command: /link <AMOUNT>
    bot.command('link', async (ctx) => {
        try {
            const message = ctx.message.text.split(' ');
            if (message.length !== 2) {
                return reply(ctx, 'Usage: /link <AMOUNT>\n用法: /link <金额>');
            }

            const amount = parseFloat(message[1]);
            if (isNaN(amount) || amount <= 0) {
                return reply(ctx, 'Invalid amount.\n无效金额。');
            }

            const chatId = ctx.chat.id.toString();
            const user = await db.prepare('SELECT * FROM users WHERE telegram_group_id = ?').get(chatId);

            if (!user) {
                return reply(ctx, '⚠️ This group is not bound to a merchant. Use /bind first.\n⚠️ 此群组未绑定商户。请先使用 /bind。');
            }

            const orderId = generateOrderId('TG');
            const result = await createPayinOrder({
                amount: amount,
                orderId: orderId,
                merchant: user,
                callbackUrl: user.callback_url || null,
                skipUrl: null,
                param: 'Telegram Link'
            });

            const msg = `✅ **Payment Link Created / 支付链接已创建**\n` +
                `Order ID: \`${result.orderId}\`\n` +
                `Amount: ₹${result.amount.toFixed(2)}\n\n` +
                `🔗 **Link:**\n${result.paymentUrl}`;

            ctx.replyWithMarkdown(msg, { reply_to_message_id: ctx.message.message_id });

        } catch (error) {
            console.error('Bot Link Error:', error);
            reply(ctx, `❌ Failed to create link: ${error.message}\n❌ 创建链接失败: ${error.message}`);
        }
    });

    // Command: /balance
    bot.command('balance', async (ctx) => {
        try {
            const chatId = ctx.chat.id.toString();
            const user = await db.prepare('SELECT id, balance, name, username FROM users WHERE telegram_group_id = ?').get(chatId);

            if (!user) {
                return reply(ctx, '⚠️ This chat is not bound to any merchant. Use /bind <KEY> first.\n⚠️ 此群组未绑定任何商户。请先使用 /bind <密钥> 绑定。');
            }

            const todayPayin = await db.prepare(`
                SELECT COALESCE(SUM(amount), 0) as total FROM transactions 
                WHERE user_id = ? AND type = 'payin' AND status = 'success' 
                AND created_at >= datetime('now', 'start of day', 'localtime')
            `).get(user.id);

            const yesterdayPayin = await db.prepare(`
                SELECT COALESCE(SUM(amount), 0) as total FROM transactions 
                WHERE user_id = ? AND type = 'payin' AND status = 'success' 
                AND created_at >= datetime('now', 'start of day', '-1 day', 'localtime')
                AND created_at < datetime('now', 'start of day', 'localtime')
            `).get(user.id);

            const todayPayout = await db.prepare(`
                SELECT COALESCE(SUM(amount), 0) as total FROM payouts 
                WHERE user_id = ? AND status = 'success'
                AND created_at >= datetime('now', 'start of day', 'localtime')
            `).get(user.id);

            const yesterdayPayout = await db.prepare(`
                SELECT COALESCE(SUM(amount), 0) as total FROM payouts 
                WHERE user_id = ? AND status = 'success'
                AND created_at >= datetime('now', 'start of day', '-1 day', 'localtime')
                AND created_at < datetime('now', 'start of day', 'localtime')
            `).get(user.id);

            let msg = `💰 **Merchant Details / 商户详情**\n`;
            msg += `Name/名称: ${user.name} (@${user.username})\n`;
            msg += `Balance/余额: ₹${user.balance.toFixed(2)}\n\n`;
            msg += `📥 **Collections / 收款 (INR)**\n`;
            msg += `Today/今日: ₹${todayPayin.total.toFixed(2)}\n`;
            msg += `Yesterday/昨日: ₹${yesterdayPayin.total.toFixed(2)}\n\n`;
            msg += `📤 **Payouts / 代付 (INR)**\n`;
            msg += `Today/今日: ₹${todayPayout.total.toFixed(2)}\n`;
            msg += `Yesterday/昨日: ₹${yesterdayPayout.total.toFixed(2)}`;

            reply(ctx, msg);
        } catch (error) {
            console.error('Bot Balance Error:', error);
            reply(ctx, 'Error fetching balance.\n获取余额失败。');
        }
    });

    // Command: /check <UTR_OR_ORDER_ID>
    bot.command('check', async (ctx) => {
        try {
            const message = ctx.message.text.split(' ');
            if (message.length < 2) {
                return reply(ctx, 'Usage: /check <UTR_OR_ORDER_ID>\n用法: /check <UTR或订单号>');
            }

            const queryId = message[1].trim();
            const chatId = ctx.chat.id.toString();
            const user = await db.prepare('SELECT id FROM users WHERE telegram_group_id = ?').get(chatId);

            if (!user) {
                return reply(ctx, '⚠️ This chat is not bound to any merchant.\n⚠️ 此群组未绑定任何商户。');
            }

            let responseMsg = '';
            let found = false;

            // 1. Check Local DB
            const tx = await db.prepare('SELECT * FROM transactions WHERE (order_id = ? OR platform_order_id = ? OR utr = ?) AND user_id = ?').get(queryId, queryId, queryId, user.id);
            const payout = await db.prepare('SELECT * FROM payouts WHERE (order_id = ? OR platform_order_id = ? OR utr = ?) AND user_id = ?').get(queryId, queryId, queryId, user.id);

            if (tx) {
                found = true;
                responseMsg += `🔎 **Local Payin Record**\nOrder ID: ${tx.order_id}\nAmount: ${tx.amount}\nStatus: ${tx.status.toUpperCase()}\nUTR: ${tx.utr || 'N/A'}\n\n`;
            }
            if (payout) {
                found = true;
                responseMsg += `📤 **Local Payout Details**\nOrder ID: ${payout.order_id}\nAmount: ${payout.amount}\nStatus: ${payout.status.toUpperCase()}\nUTR: ${payout.utr || 'N/A'}\n\n`;
            }

            reply(ctx, 'Searching provider... / 正在搜寻上游...');

            // 2. Query Provider - TRY BOTH PAYIN AND UTR ENDPOINTS
            let providerFound = false;

            // Check as Payin Order
            try {
                let upstreamOrder = await silkpayService.queryPayin(queryId);
                // Also try using local order id if we found it locally
                if ((!upstreamOrder || upstreamOrder.status !== '200') && tx) {
                    upstreamOrder = await silkpayService.queryPayin(tx.platform_order_id || tx.order_id);
                }

                if (upstreamOrder && upstreamOrder.status === '200' && upstreamOrder.data) {
                    providerFound = true;
                    const data = upstreamOrder.data;
                    const upStatus = data.status === 1 ? 'SUCCESS' : (data.status === 2 ? 'FAILED' : 'PENDING/INIT');
                    responseMsg += `🌐 **Provider Order Status**\nOrder ID: ${data.mOrderId}\nAmount: ${data.amount}\nStatus: ${upStatus}\nUTR: ${data.utr || 'N/A'}\n\n`;
                }
            } catch (e) { }

            // Check as UTR
            try {
                let upstreamUtr = await silkpayService.queryUtr(queryId);
                // If local tx has a UTR, check that too
                if ((!upstreamUtr || upstreamUtr.status !== '200') && tx && tx.utr) {
                    upstreamUtr = await silkpayService.queryUtr(tx.utr);
                }

                if (upstreamUtr && upstreamUtr.status === '200' && upstreamUtr.data) {
                    providerFound = true;
                    // data.code: 1 = Active/Usable (can be used for compensation), other = Invalid/Used?
                    // Based on payin.txt: code=1 means "new order can be created (for compensation)"
                    responseMsg += `🌐 **Provider UTR Check**\nUTR: ${queryId}\nAmount: ${upstreamUtr.data.amount}\nMsg: ${upstreamUtr.data.msg}\nCode: ${upstreamUtr.data.code}\n\n`;
                }
            } catch (e) { }

            if (!found && !providerFound) {
                return reply(ctx, '❌ Transaction not found locally or upstream.\n❌ 本地或上游未找到该交易。');
            }

            return reply(ctx, responseMsg);

        } catch (error) {
            console.error('Bot Check Error:', error);
            reply(ctx, 'Error checking transaction.\n查询交易失败。');
        }
    });

    // Command: /submit <ORDER_ID> <UTR>
    bot.command('submit', async (ctx) => {
        try {
            const message = ctx.message.text.split(' ');
            if (message.length !== 3) {
                return reply(ctx, 'Usage: /submit <ORDER_ID> <UTR>\n用法: /submit <订单号> <UTR>');
            }

            const orderId = message[1].trim();
            const utr = message[2].trim();
            const chatId = ctx.chat.id.toString();

            const user = await db.prepare('SELECT id FROM users WHERE telegram_group_id = ?').get(chatId);
            if (!user) {
                return reply(ctx, '⚠️ This chat is not bound to any merchant.\n⚠️ 此群组未绑定任何商户。');
            }

            // Verify order belongs to merchant
            const tx = await db.prepare('SELECT * FROM transactions WHERE order_id = ? AND user_id = ?').get(orderId, user.id);
            if (!tx) {
                return reply(ctx, '❌ Order not found or does not belong to you.\n❌ 订单未找到或不属于您。');
            }

            if (tx.status === 'success') {
                return reply(ctx, '⚠️ Order is already successful.\n⚠️ 订单已成功。');
            }

            reply(ctx, '⏳ Submitting UTR... / 正在提交 UTR...');

            // Call Submit UTR API
            const result = await silkpayService.submitUtr(orderId, utr);

            if (result.status === '200' && result.data && result.data.code === 1) {
                // Success from provider
                await db.prepare('UPDATE transactions SET utr = ?, status = ? WHERE id = ?').run(utr, 'success', tx.id);
                // Optionally trigger callback if needed, but for now just update DB
                return reply(ctx, `✅ **Success! UTR Submitted.**\nOrder: ${orderId}\nUTR: ${utr}\nStatus: Updated to SUCCESS`);
            } else {
                // Failure
                const errMsg = result.message || (result.data ? result.data.msg : 'Unknown Error');
                return reply(ctx, `❌ **Submission Failed**\nProvider Response: ${errMsg}`);
            }

        } catch (error) {
            console.error('Bot Submit Error:', error);
            reply(ctx, 'Error submitting UTR.\n提交 UTR 失败。');
        }
    });

    // Command: /last
    bot.command('last', async (ctx) => {
        try {
            const chatId = ctx.chat.id.toString();
            const user = await db.prepare('SELECT id FROM users WHERE telegram_group_id = ?').get(chatId);
            if (!user) return reply(ctx, '⚠️ This chat is not bound to any merchant.\n⚠️ 此群组未绑定任何商户。');

            const tx = await db.prepare('SELECT * FROM transactions WHERE user_id = ? AND status = "pending" ORDER BY created_at DESC LIMIT 1').get(user.id);
            if (!tx) return reply(ctx, '✅ No pending transactions found.\n✅ 无待处理交易。');

            reply(ctx, `⏳ **Last Pending Payin / 最后待处理收款**\nOrder ID/订单号: ${tx.order_id}\nAmount/金额: ${tx.amount}\nCreated/时间: ${tx.created_at}`);
        } catch (error) {
            console.error('Bot Last Error:', error);
            reply(ctx, 'Error fetching last transaction.\n获取最后交易失败。');
        }
    });

    // Command: /stats - Query success rate (5m, 10m, 30m)
    bot.command('stats', async (ctx) => {
        try {
            const chatId = ctx.chat.id.toString();
            const user = await db.prepare('SELECT id FROM users WHERE telegram_group_id = ?').get(chatId);
            if (!user) return reply(ctx, '⚠️ This chat is not bound to any merchant.\n⚠️ 此群组未绑定任何商户。');

            const getStats = async (minutes) => {
                const res = await db.prepare(`
                    SELECT 
                        COUNT(*) as total,
                        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success
                    FROM transactions 
                    WHERE user_id = ? AND type = 'payin'
                    AND created_at >= datetime('now', '-' || ? || ' minutes', 'localtime')
                `).get(user.id, minutes);
                return res;
            };

            const stats5 = await getStats(5);
            const stats10 = await getStats(10);
            const stats30 = await getStats(30);

            const formatRate = (s) => {
                if (!s || s.total === 0) return '0.00%';
                return ((s.success / s.total) * 100).toFixed(2) + '%';
            };

            let msg = `📊 Success Rates / 成功率\n\n`;
            msg += `🕒 5 Mins: ${formatRate(stats5)} (${stats5.success || 0}/${stats5.total || 0})\n`;
            msg += `🕒 10 Mins: ${formatRate(stats10)} (${stats10.success || 0}/${stats10.total || 0})\n`;
            msg += `🕒 30 Mins:${formatRate(stats30)} (${stats30.success || 0}/${stats30.total || 0})`;

            reply(ctx, msg);

        } catch (error) {
            console.error('Bot Stats Error:', error);
            reply(ctx, 'Error fetching stats.\n获取统计失败。');
        }
    });

    // Command: /apidetails - Show merchant API details
    bot.command('apidetails', async (ctx) => {
        try {
            const chatId = ctx.chat.id.toString();
            const user = await db.prepare('SELECT * FROM users WHERE telegram_group_id = ?').get(chatId);

            if (!user) {
                return reply(ctx, '⚠️ This chat is not bound to any merchant. Use /bind <KEY> first.\n⚠️ 此群组未绑定任何商户。请先使用 /bind <密钥> 绑定。');
            }

            const appUrl = process.env.APP_URL || 'http://localhost:3000';
            const docsUrl = `${appUrl}/docs`;

            // Fetch User Rates
            const rates = await getUserRates(db, user.id);
            const payinRate = (rates.payinRate * 100).toFixed(2);
            const payoutRate = (rates.payoutRate * 100).toFixed(2);
            const payoutFixed = rates.payoutFixed;

            const msg = `🔐 **Merchant API Credentials / 商户 API 凭证**\n\n` +
                `👤 **Merchant Name:** ${user.name}\n` +
                `🆔 **Merchant ID (mId):** ${user.merchant_key}\n` +
                `🔑 **Merchant Key:** ${user.merchant_key}\n` +
                `*(Secret Key hidden for security. Check Dashboard)*\n\n` +
                `📊 **Your Rates / 您的费率**\n` +
                `📥 Payin: ${payinRate}%\n` +
                `📤 Payout: ${payoutRate}% + ₹${payoutFixed}\n\n` +
                `🖥️ **Dashboard Access / 后台登录**\n` +
                `URL: ${appUrl}/login\n` +
                `*Password: Please contact admin / 密码请咨询管理员*\n\n` +
                `📚 **API Documentation:**\n${docsUrl}\n\n` +
                `⚠️ **Rules / 规则:**\n` +
                `1. Keep your Secret Key private.\n` +
                `2. Validate all callback signatures.\n` +
                `3. Use the correct endpoints for Payin/Payout.`;

            reply(ctx, msg);
        } catch (error) {
            console.error('Bot API Details Error:', error);
            reply(ctx, 'Error fetching details.\n获取详情失败。');
        }
    });

    // Command: /upi - Query UPI listing and available
    bot.command('upi', async (ctx) => {
        // Just listing available methods as requested
        const msg = `📱 **Available UPI Methods / 可用 UPI 方式**\n\n` +
            `🔹 PhonePe\n` +
            `🔹 Paytm\n` +
            `🔹 Google Pay (GPay)\n` +
            `🔹 BHIM / UPI Apps\n\n` +
            `✅ All UPI apps supported via Intent/DeepLink.\n` +
            `✅ 支持所有 UPI 应用跳转支付。`;

        reply(ctx, msg);
    });

    // Help Command
    bot.start((ctx) => {
        reply(ctx,
            `Available Commands / 可用命令:\n\n` +
            `/link <AMOUNT> - Create payment link / 创建支付链接\n` +
            `/balance - Check merchant balance & stats / 查询余额和统计\n` +
            `/check <UTR/ID> - Check transaction status / 查询交易状态\n` +
            `/submit <ID> <UTR> - Submit UTR for Order / 提交补单\n` +
            `/apidetails - View API Credentials / 查看 API 凭证\n` +
            `/stats - Check success rate / 查询成功率\n` +
            `/upi - List UPI options / UPI 列表\n` +
            `/last - View last pending payin / 查看最后一条待处理收款\n` +
            `/bind <KEY> - Link group to merchant / 绑定商户`
        );
    });

    if (!process.env.VERCEL && process.env.USE_WEBHOOK !== 'true') {
        bot.launch().then(() => {
            console.log('Telegram Bot started (Polling)');
        }).catch(err => {
            console.error('Failed to start Telegram Bot:', err);
        });

        process.once('SIGINT', () => bot.stop('SIGINT'));
        process.once('SIGTERM', () => bot.stop('SIGTERM'));
    } else {
        console.log('Telegram Bot Polling Disabled (Webhook Mode)');
    }
}

async function handleUpdate(req, res) {
    if (!bot) await initBot();
    try {
        await bot.handleUpdate(req.body, res);
    } catch (err) {
        console.error('Bot Webhook Error:', err);
        if (!res.headersSent) res.status(200).send('ok');
    }
}

async function broadcastMessage(text) {
    if (!bot) {
        if (!process.env.VERCEL && process.env.USE_WEBHOOK !== 'true') return { success: 0, failed: 0 };
        await initBot();
    }
    const db = getDb();
    const users = await db.prepare('SELECT telegram_group_id FROM users WHERE telegram_group_id IS NOT NULL').all();

    let success = 0;
    let failed = 0;

    for (const u of users) {
        if (!u.telegram_group_id) continue;
        try {
            await bot.telegram.sendMessage(u.telegram_group_id, text);
            success++;
        } catch (e) {
            console.error(`Failed to send to ${u.telegram_group_id}:`, e.message);
            failed++;
        }
    }
    return { success, failed };
}

module.exports = { initBot, broadcastMessage, handleUpdate, getBot: () => bot };
