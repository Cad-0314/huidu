const { Telegraf } = require('telegraf');
const { getDb } = require('../config/database');
const payableService = require('./payable');

let bot = null;

async function initBot() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
        console.warn('TELEGRAM_BOT_TOKEN is missing. Bot will not start.');
        return;
    }

    bot = new Telegraf(token);
    const db = getDb();

    // Command: /bind <MERCHANT_KEY>
    bot.command('bind', async (ctx) => {
        try {
            const message = ctx.message.text.split(' ');
            if (message.length !== 2) {
                return ctx.reply('Usage: /bind <MERCHANT_KEY>\n用法: /bind <商户密钥>');
            }

            const merchantKey = message[1].trim();
            const user = await db.prepare('SELECT id, name, telegram_group_id FROM users WHERE merchant_key = ?').get(merchantKey);

            if (!user) {
                return ctx.reply('Invalid Merchant Key.\n无效的商户密钥。');
            }

            const chatId = ctx.chat.id.toString();

            // Check if this Group is already bound to another merchant
            const existingGroup = await db.prepare('SELECT username FROM users WHERE telegram_group_id = ? AND id != ?').get(chatId, user.id);
            if (existingGroup) {
                return ctx.reply(`⚠️ This group is already bound to merchant: ${existingGroup.username}. Unbind there first.\n⚠️ 此群组已绑定到商户: ${existingGroup.username}。请先解绑。`);
            }

            // Check if this Merchant is already bound to another group
            if (user.telegram_group_id && user.telegram_group_id !== chatId) {
                return ctx.reply(`⚠️ This merchant is already bound to another group. Contact admin to reset.\n⚠️ 此商户已绑定到其他群组。请联系管理员重置。`);
            }

            await db.prepare('UPDATE users SET telegram_group_id = ? WHERE id = ?').run(chatId, user.id);

            ctx.reply(`✅ Successfully bound to merchant: ${user.name}\n✅ 成功绑定商户: ${user.name}`);
        } catch (error) {
            console.error('Bot Bind Error:', error);
            ctx.reply('An error occurred during binding.\n绑定过程中发生错误。');
        }
    });

    // Command: /balance
    bot.command('balance', async (ctx) => {
        try {
            const chatId = ctx.chat.id.toString();
            const user = await db.prepare('SELECT id, balance, name, username FROM users WHERE telegram_group_id = ?').get(chatId);

            if (!user) {
                return ctx.reply('⚠️ This chat is not bound to any merchant. Use /bind <KEY> first.\n⚠️ 此群组未绑定任何商户。请先使用 /bind <密钥> 绑定。');
            }

            // Stats Queries
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

            ctx.reply(msg);
        } catch (error) {
            console.error('Bot Balance Error:', error);
            ctx.reply('Error fetching balance.\n获取余额失败。');
        }
    });

    // Command: /check <UTR_OR_ORDER_ID>
    bot.command('check', async (ctx) => {
        try {
            const message = ctx.message.text.split(' ');
            if (message.length !== 2) {
                return ctx.reply('Usage: /check <UTR_OR_ORDER_ID>\n用法: /check <UTR或订单号>');
            }

            const queryId = message[1].trim();
            const chatId = ctx.chat.id.toString();
            const user = await db.prepare('SELECT id FROM users WHERE telegram_group_id = ?').get(chatId);

            if (!user) {
                return ctx.reply('⚠️ This chat is not bound to any merchant.\n⚠️ 此群组未绑定任何商户。');
            }

            let responseMsg = '';

            // 1. Check Local DB
            const tx = await db.prepare('SELECT * FROM transactions WHERE (order_id = ? OR platform_order_id = ? OR utr = ?) AND user_id = ?').get(queryId, queryId, queryId, user.id);

            if (tx) {
                responseMsg += `🔎 **Local Payin Record / 本地收款记录**\nOrder ID/订单号: ${tx.order_id}\nAmount/金额: ${tx.amount}\nStatus/状态: ${tx.status.toUpperCase()}\nUTR: ${tx.utr || 'N/A'}\n\n`;

                // If pending, check upstream
                if (tx.status === 'pending') {
                    // Try to check upstream by UTR or OrderID
                    try {
                        let upstream = null;
                        if (tx.utr) {
                            upstream = await payableService.queryUtr(tx.utr);
                        } else {
                            upstream = await payableService.queryPayin(tx.order_id);
                        }

                        if (upstream && upstream.code === 1) {
                            responseMsg += `🌐 **Upstream Status / 上游状态**\nStatus/状态: ${upstream.data.status}\nAmount/金额: ${upstream.data.amount}`;
                        }
                    } catch (e) {
                        // Ignore upstream error
                    }
                }
                return ctx.reply(responseMsg);
            }

            // Check Payouts Local
            const payout = await db.prepare('SELECT * FROM payouts WHERE (order_id = ? OR platform_order_id = ? OR utr = ?) AND user_id = ?').get(queryId, queryId, queryId, user.id);
            if (payout) {
                return ctx.reply(`📤 **Payout Details / 代付详情**\nOrder ID/订单号: ${payout.order_id}\nAmount/金额: ${payout.amount}\nStatus/状态: ${payout.status.toUpperCase()}\nUTR: ${payout.utr || 'N/A'}`);
            }

            // 2. If not found locally, Check Upstream (By UTR or Order ID)
            ctx.reply('Searching upstream... / 正在搜寻上游...');
            try {
                // Try UTR first
                let upstream = await payableService.queryUtr(queryId);
                if (upstream.code === 1) {
                    return ctx.reply(`🌐 **Upstream Found (UTR) / 上游找到 (UTR)**\nOrder ID/订单号: ${upstream.data.orderId}\nAmount/金额: ${upstream.data.amount}\nStatus/状态: ${upstream.data.status}\nUTR: ${queryId}`);
                }
            } catch (e) { }

            try {
                // Try Order ID
                let upstream = await payableService.queryPayin(queryId);
                if (upstream.code === 1) {
                    return ctx.reply(`🌐 **Upstream Found (Order) / 上游找到 (订单号)**\nOrder ID/订单号: ${upstream.data.orderId}\nAmount/金额: ${upstream.data.amount}\nStatus/状态: ${upstream.data.status}`);
                }
            } catch (e) { }

            return ctx.reply('❌ Transaction not found locally or upstream.\n❌ 本地或上游未找到该交易。');

        } catch (error) {
            console.error('Bot Check Error:', error);
            ctx.reply('Error checking transaction.\n查询交易失败。');
        }
    });

    // Command: /last (Last Pending Transaction)
    bot.command('last', async (ctx) => {
        try {
            const chatId = ctx.chat.id.toString();
            const user = await db.prepare('SELECT id FROM users WHERE telegram_group_id = ?').get(chatId);

            if (!user) {
                return ctx.reply('⚠️ This chat is not bound to any merchant.\n⚠️ 此群组未绑定任何商户。');
            }

            const tx = await db.prepare('SELECT * FROM transactions WHERE user_id = ? AND status = "pending" ORDER BY created_at DESC LIMIT 1').get(user.id);

            if (!tx) {
                return ctx.reply('✅ No pending transactions found.\n✅ 无待处理交易。');
            }

            ctx.reply(`⏳ **Last Pending Payin / 最后待处理收款**\nOrder ID/订单号: ${tx.order_id}\nAmount/金额: ${tx.amount}\nCreated/时间: ${tx.created_at}`);
        } catch (error) {
            console.error('Bot Last Error:', error);
            ctx.reply('Error fetching last transaction.\n获取最后交易失败。');
        }
    });

    // Help Command
    bot.start((ctx) => {
        ctx.reply(
            `Available Commands / 可用命令:\n\n` +
            `/balance - Check merchant balance & stats / 查询余额和统计\n` +
            `/check <UTR/ID> - Check transaction status (Local & Upstream) / 查询交易状态 (本地和上游)\n` +
            `/last - View last pending payin / 查看最后一条待处理收款\n` +
            `/bind <KEY> - Link group to merchant / 绑定商户`
        );
    });

    bot.launch().then(() => {
        console.log('Telegram Bot started');
    }).catch(err => {
        console.error('Failed to start Telegram Bot:', err);
    });

    // Graceful stop
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

async function broadcastMessage(text) {
    if (!bot) return { success: 0, failed: 0 };
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

module.exports = { initBot, broadcastMessage };
