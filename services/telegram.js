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
    // Generic reply helper to quote message with fallback
    const reply = async (ctx, text) => {
        try {
            await ctx.reply(text, { reply_to_message_id: ctx.message.message_id, parse_mode: 'Markdown' });
        } catch (e) {
            console.warn('Reply Markdown Error, retrying plain:', e.message);
            try {
                // Determine if we need to strip markdown chars or just send raw
                // Simplest fallback: just send the text. 
                // Note: If text contains strict markdown symbols they might look odd, but at least message sends.
                await ctx.reply(text, { reply_to_message_id: ctx.message.message_id });
            } catch (e2) {
                console.error('Reply Fatal Error:', e2.message);
            }
        }
    };

    // Command: /bind <MERCHANT_KEY>
    bot.command('bind', async (ctx) => {
        try {
            const message = ctx.message.text.split(' ');
            if (message.length !== 2) {
                return reply(ctx, '❌ **格式错误**\n用法: `/bind <商户密钥>`\nUsage: `/bind <MERCHANT_KEY>`');
            }

            const merchantKey = message[1].trim();
            const user = await db.prepare('SELECT id, name, username, telegram_group_id FROM users WHERE merchant_key = ?').get(merchantKey);

            if (!user) {
                return reply(ctx, '❌ **绑定失败**\n无效的商户密钥 (Invalid Merchant Key)。');
            }

            const chatId = ctx.chat.id.toString();

            const existingGroup = await db.prepare('SELECT username FROM users WHERE telegram_group_id = ? AND id != ?').get(chatId, user.id);
            if (existingGroup) {
                return reply(ctx, `⚠️ **无法绑定**\n此群组已绑定到商户: \`${existingGroup.username}\`。\n请先在原商户处解绑。`);
            }

            if (user.telegram_group_id && user.telegram_group_id !== chatId) {
                return reply(ctx, `⚠️ **商户已占用**\n此商户已绑定到其他群组。如需更换，请联系管理员。`);
            }

            await db.prepare('UPDATE users SET telegram_group_id = ? WHERE id = ?').run(chatId, user.id);

            reply(ctx, `✅ **绑定成功**\n商户名称: \`${user.name}\`\n该群组现在可以正常执行指令。`);
        } catch (error) {
            console.error('Bot Bind Error:', error);
            reply(ctx, '❌ **绑定过程中发生系统错误**');
        }
    });

    // Command: /link <AMOUNT>
    bot.command('link', async (ctx) => {
        try {
            const message = ctx.message.text.split(' ');
            if (message.length !== 2) {
                return reply(ctx, '❌ **格式错误**\n用法: `/link <金额>`\nUsage: `/link <AMOUNT>`');
            }

            const amount = parseFloat(message[1]);
            if (isNaN(amount) || amount <= 0) {
                return reply(ctx, '❌ **金额无效**\n请输入正确的数字。');
            }

            const chatId = ctx.chat.id.toString();
            const user = await db.prepare('SELECT * FROM users WHERE telegram_group_id = ?').get(chatId);

            if (!user) {
                return reply(ctx, '⚠️ **权限拒绝**\n此群组未绑定商户。请先使用 `/bind`。');
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

            const msg = `✨ **支付链接已创建**\n` +
                `⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯\n` +
                `📦 订单编号: \`${result.orderId}\`\n` +
                `💰 支付金额: **₹${result.amount.toFixed(2)}**\n\n` +
                `🔗 **点击下方链接支付:**\n${result.paymentUrl}`;

            ctx.replyWithMarkdown(msg, { reply_to_message_id: ctx.message.message_id });

        } catch (error) {
            console.error('Bot Link Error:', error);
            reply(ctx, `❌ **创建失败**: ${error.message}`);
        }
    });

    // Command: /balance
    bot.command('balance', async (ctx) => {
        try {
            const chatId = ctx.chat.id.toString();
            const user = await db.prepare('SELECT id, balance, name, username FROM users WHERE telegram_group_id = ?').get(chatId);

            if (!user) {
                return reply(ctx, '⚠️ **未绑定商户**\n请先使用 `/bind <密钥>` 进行绑定。');
            }

            const [todayPayin, yesterdayPayin, todayPayout, yesterdayPayout] = await Promise.all([
                db.prepare(`
                    SELECT COALESCE(SUM(amount), 0) as total FROM transactions 
                    WHERE user_id = ? AND type = 'payin' AND status = 'success' 
                    AND created_at >= datetime('now', 'start of day', 'localtime')
                `).get(user.id),
                db.prepare(`
                    SELECT COALESCE(SUM(amount), 0) as total FROM transactions 
                    WHERE user_id = ? AND type = 'payin' AND status = 'success' 
                    AND created_at >= datetime('now', 'start of day', '-1 day', 'localtime')
                    AND created_at < datetime('now', 'start of day', 'localtime')
                `).get(user.id),
                db.prepare(`
                    SELECT COALESCE(SUM(amount), 0) as total FROM payouts 
                    WHERE user_id = ? AND status = 'success'
                    AND created_at >= datetime('now', 'start of day', 'localtime')
                `).get(user.id),
                db.prepare(`
                    SELECT COALESCE(SUM(amount), 0) as total FROM payouts 
                    WHERE user_id = ? AND status = 'success'
                    AND created_at >= datetime('now', 'start of day', '-1 day', 'localtime')
                    AND created_at < datetime('now', 'start of day', 'localtime')
                `).get(user.id)
            ]);

            let msg = `💳 **商户资产概览**\n` +
                `⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯\n` +
                `👤 商户: \`${user.name}\` (@${user.username})\n` +
                `💰 余额: **₹${user.balance.toFixed(2)}**\n\n` +
                `📥 **收款统计 (Collections)**\n` +
                `今日: ₹${todayPayin.total.toFixed(2)}\n` +
                `昨日: ₹${yesterdayPayin.total.toFixed(2)}\n\n` +
                `📤 **下发统计 (Payouts)**\n` +
                `今日: ₹${todayPayout.total.toFixed(2)}\n` +
                `昨日: ₹${yesterdayPayout.total.toFixed(2)}`;

            reply(ctx, msg);
        } catch (error) {
            console.error('Bot Balance Error:', error);
            reply(ctx, '❌ **获取数据失败**');
        }
    });

    // Command: /check <UTR_OR_ORDER_ID>
    bot.command('check', async (ctx) => {
        try {
            const message = ctx.message.text.split(' ');
            if (message.length < 2) {
                return reply(ctx, '❌ **格式错误**\n用法: `/check <UTR或订单号>`');
            }

            const queryId = message[1].trim();
            const chatId = ctx.chat.id.toString();
            const user = await db.prepare('SELECT id FROM users WHERE telegram_group_id = ?').get(chatId);

            if (!user) return reply(ctx, '⚠️ **未绑定商户**');

            let responseMsg = `🔍 **查询结果: ${queryId}**\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯\n`;
            let found = false;

            const tx = await db.prepare('SELECT * FROM transactions WHERE (order_id = ? OR platform_order_id = ? OR utr = ?) AND user_id = ?').get(queryId, queryId, queryId, user.id);
            const payout = await db.prepare('SELECT * FROM payouts WHERE (order_id = ? OR platform_order_id = ? OR utr = ?) AND user_id = ?').get(queryId, queryId, queryId, user.id);

            if (tx) {
                found = true;
                responseMsg += `📥 **本地收款记录**\n单号: \`${tx.order_id}\`\n金额: ₹${tx.amount}\n状态: ${tx.status.toUpperCase()}\nUTR: \`${tx.utr || 'N/A'}\`\n\n`;
            }
            if (payout) {
                found = true;
                responseMsg += `📤 **本地下发记录**\n单号: \`${payout.order_id}\`\n金额: ₹${payout.amount}\n状态: ${payout.status.toUpperCase()}\nUTR: \`${payout.utr || 'N/A'}\`\n\n`;
            }

            let providerFound = false;
            try {
                let upstreamOrder = await silkpayService.queryPayin(queryId);
                if ((!upstreamOrder || upstreamOrder.status !== '200') && tx) {
                    upstreamOrder = await silkpayService.queryPayin(tx.platform_order_id || tx.order_id);
                }
                if (upstreamOrder && upstreamOrder.status === '200' && upstreamOrder.data) {
                    providerFound = true;
                    const data = upstreamOrder.data;
                    const upStatus = data.status === 1 ? '✅ SUCCESS' : (data.status === 2 ? '❌ FAILED' : '⏳ PENDING');
                    responseMsg += `🌐 **上游订单状态**\n单号: \`${data.mOrderId}\`\n金额: ₹${data.amount}\n状态: ${upStatus}\nUTR: \`${data.utr || 'N/A'}\`\n\n`;
                }
            } catch (e) { }

            try {
                let upstreamUtr = await silkpayService.queryUtr(queryId);
                if ((!upstreamUtr || upstreamUtr.status !== '200') && tx && tx.utr) {
                    upstreamUtr = await silkpayService.queryUtr(tx.utr);
                }
                if (upstreamUtr && upstreamUtr.status === '200' && upstreamUtr.data) {
                    providerFound = true;
                    responseMsg += `🌐 **上游 UTR 核查**\n状态: ${upstreamUtr.data.msg}\n金额: ₹${upstreamUtr.data.amount}\n代码: ${upstreamUtr.data.code}\n\n`;
                }
            } catch (e) { }

            if (!found && !providerFound) {
                return reply(ctx, '❌ **未找到记录**\n本地及上游数据库中均无此交易信息。');
            }

            return reply(ctx, responseMsg);
        } catch (error) {
            console.error('Bot Check Error:', error);
            reply(ctx, '❌ **查询失败**');
        }
    });

    // Command: /submit <ORDER_ID> <UTR>
    bot.command('submit', async (ctx) => {
        try {
            const message = ctx.message.text.split(' ');
            if (message.length !== 3) {
                return reply(ctx, '❌ **格式错误**\n用法: `/submit <订单号> <UTR>`');
            }

            const orderId = message[1].trim();
            const utr = message[2].trim();
            const chatId = ctx.chat.id.toString();

            const user = await db.prepare('SELECT id FROM users WHERE telegram_group_id = ?').get(chatId);
            if (!user) return reply(ctx, '⚠️ **未绑定商户**');

            const tx = await db.prepare('SELECT * FROM transactions WHERE order_id = ? AND user_id = ?').get(orderId, user.id);
            if (!tx) return reply(ctx, '❌ **订单不存在**\n请检查订单号是否属于该商户。');

            if (tx.status === 'success') return reply(ctx, '⚠️ **订单已成功**\n无需重复提交。');

            reply(ctx, '⏳ **正在提交上游补单...**');

            const result = await silkpayService.submitUtr(orderId, utr);

            if (result.status === '200' && result.data && result.data.code === 1) {
                await db.prepare('UPDATE transactions SET utr = ?, status = ? WHERE id = ?').run(utr, 'success', tx.id);
                return reply(ctx, `✅ **补单成功**\n订单号: \`${orderId}\`\nUTR: \`${utr}\`\n系统状态已更新为: **SUCCESS**`);
            } else {
                const errMsg = result.message || (result.data ? result.data.msg : '未知错误');
                return reply(ctx, `❌ **补单失败**\n上游返回: ${errMsg}`);
            }
        } catch (error) {
            console.error('Bot Submit Error:', error);
            reply(ctx, '❌ **提交 UTR 失败**');
        }
    });

    // Command: /last
    bot.command('last', async (ctx) => {
        try {
            const chatId = ctx.chat.id.toString();
            const user = await db.prepare('SELECT id FROM users WHERE telegram_group_id = ?').get(chatId);
            if (!user) return reply(ctx, '⚠️ **未绑定商户**');

            const tx = await db.prepare('SELECT * FROM transactions WHERE user_id = ? AND status = "pending" ORDER BY created_at DESC LIMIT 1').get(user.id);
            if (!tx) return reply(ctx, '✅ **暂无待处理订单**');

            reply(ctx, `⏳ **最后一条待处理收款**\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯\n📦 订单号: \`${tx.order_id}\`\n💰 金额: **₹${tx.amount}**\n📅 时间: \`${tx.created_at}\``);
        } catch (error) {
            console.error('Bot Last Error:', error);
            reply(ctx, '❌ **查询失败**');
        }
    });

    // Command: /stats
    bot.command('stats', async (ctx) => {
        try {
            const chatId = ctx.chat.id.toString();
            const user = await db.prepare('SELECT id FROM users WHERE telegram_group_id = ?').get(chatId);
            if (!user) return reply(ctx, '⚠️ **未绑定商户**');

            const getStats = async (minutes) => {
                return await db.prepare(`
                    SELECT 
                        COUNT(*) as total,
                        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success
                    FROM transactions 
                    WHERE user_id = ? AND type = 'payin'
                    AND created_at >= datetime('now', '-' || ? || ' minutes', 'localtime')
                `).get(user.id, minutes);
            };

            const getPayoutStats = async (minutes) => {
                return await db.prepare(`
                    SELECT 
                        COUNT(*) as total,
                        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success
                    FROM payouts 
                    WHERE user_id = ? AND source = 'api'
                    AND created_at >= datetime('now', '-' || ? || ' minutes', 'localtime')
                `).get(user.id, minutes);
            };

            const getAllTimeStats = async () => {
                return await db.prepare(`
                    SELECT 
                        COUNT(*) as total,
                        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success
                    FROM transactions 
                    WHERE user_id = ? AND type = 'payin'
                `).get(user.id);
            };

            const getAllTimePayoutStats = async () => {
                return await db.prepare(`
                    SELECT 
                        COUNT(*) as total,
                        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success
                    FROM payouts 
                    WHERE user_id = ? AND source = 'api'
                `).get(user.id);
            };

            const [stats5, stats10, stats30, statsTotal, pStats5, pStats10, pStats30, pStatsTotal] = await Promise.all([
                getStats(5),
                getStats(10),
                getStats(30),
                getAllTimeStats(),
                getPayoutStats(5),
                getPayoutStats(10),
                getPayoutStats(30),
                getAllTimePayoutStats()
            ]);

            const formatRate = (s) => {
                if (!s || s.total === 0) return '`0.00%`';
                return `**${((s.success / s.total) * 100).toFixed(2)}%**`;
            };

            let msg = `📊 **支付成功率监控**\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯\n`;
            msg += `📥 **收款 (Payin)**\n`;
            msg += `🕒 05分钟: ${formatRate(stats5)} (${stats5.success || 0}/${stats5.total || 0})\n`;
            msg += `🕒 10分钟: ${formatRate(stats10)} (${stats10.success || 0}/${stats10.total || 0})\n`;
            msg += `🕒 30分钟: ${formatRate(stats30)} (${stats30.success || 0}/${stats30.total || 0})\n`;
            msg += `🕒 总共: ${formatRate(statsTotal)} (${statsTotal.success || 0}/${statsTotal.total || 0})\n\n`;

            msg += `📤 **下发 (Payout)**\n`;
            msg += `🕒 05分钟: ${formatRate(pStats5)} (${pStats5.success || 0}/${pStats5.total || 0})\n`;
            msg += `🕒 10分钟: ${formatRate(pStats10)} (${pStats10.success || 0}/${pStats10.total || 0})\n`;
            msg += `🕒 30分钟: ${formatRate(pStats30)} (${pStats30.success || 0}/${pStats30.total || 0})\n`;
            msg += `🕒 总共: ${formatRate(pStatsTotal)} (${pStatsTotal.success || 0}/${pStatsTotal.total || 0})`;

            reply(ctx, msg);
        } catch (error) {
            console.error('Bot Stats Error:', error);
            reply(ctx, '❌ **统计数据获取失败**');
        }
    });

    // Command: /apidetails
    bot.command('apidetails', async (ctx) => {
        try {
            const chatId = ctx.chat.id.toString();
            const user = await db.prepare('SELECT * FROM users WHERE telegram_group_id = ?').get(chatId);

            if (!user) return reply(ctx, '⚠️ **未绑定商户**');

            const appUrl = process.env.APP_URL || 'http://localhost:3000';
            const rates = await getUserRates(db, user.id);

            const msg = `🔐 **商户接入详情**\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯\n` +
                `👤 商户名称: \`${user.name}\`\n` +
                `🆔 商户 ID: \`${user.merchant_key}\`\n` +
                `🔑 商户密钥: \`${user.merchant_key}\`\n` +
                `*(安全起见，Secret Key 请在后台查看)*\n\n` +
                `📊 **当前费率**\n` +
                `📥 收款 (Payin): ${(rates.payinRate * 100).toFixed(2)}%\n` +
                `📤 下发 (Payout): ${(rates.payoutRate * 100).toFixed(2)}% + ₹${rates.payoutFixed}\n\n` +
                `🖥️ **商户后台**\n` +
                `地址: ${appUrl}/login\n` +
                `📚 **API 文档**: ${appUrl}/docs\n\n` +
                `⚠️ **接入规则**:\n` +
                `1. 请妥善保管您的 Secret Key\n` +
                `2. 必须校验回调签名 (Sign)\n` +
                `3. 生产环境请使用 HTTPS 回调`;

            reply(ctx, msg);
        } catch (error) {
            console.error('Bot API Details Error:', error);
            reply(ctx, '❌ **获取详情失败**');
        }
    });

    // Command: /upi [UPI_ID]
    bot.command('upi', async (ctx) => {
        try {
            const message = ctx.message.text.split(' ');
            let upiIdToCheck = null;

            // Case 1: Argument provided (/upi someone@upi)
            if (message.length > 1) {
                upiIdToCheck = message[1].trim();
            }
            // Case 2: Reply to a message containing a UPI ID
            else if (ctx.message.reply_to_message && ctx.message.reply_to_message.text) {
                const replyText = ctx.message.reply_to_message.text;
                // Simple regex to find something that looks like a UPI ID
                const match = replyText.match(/[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z0-9]{2,64}/);
                if (match) {
                    upiIdToCheck = match[0];
                }
            }

            if (upiIdToCheck) {
                // Check database
                const record = await db.prepare('SELECT * FROM upi_records WHERE upi_id = ?').get(upiIdToCheck);

                if (record && record.is_ours) {
                    return reply(ctx, `✅ **验证通过**\nUPI ID: \`${upiIdToCheck}\`\n状态: **属于我们要** (Belongs to us)\n来源: ${record.source}`);
                } else {
                    return reply(ctx, `❌ **验证失败**\nUPI ID: \`${upiIdToCheck}\`\n状态: **不属于我们要** (Not in our records)`);
                }
            } else {
                // Default info message if no ID provided
                const msg = `📱 **UPI 验证工具**\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯\n` +
                    `用法:\n` +
                    `1. 发送 \`/upi <upi_id>\`\n` +
                    `2. 回复包含 UPI ID 的消息并发送 \`/upi\`\n\n` +
                    `🔹 **支持的支付方式**\n` +
                    `PhonePe | Paytm | GPay | BHIM | Any UPI App`;
                reply(ctx, msg);
            }
        } catch (error) {
            console.error('Bot UPI Command Error:', error);
            reply(ctx, '❌ **验证时发生错误**');
        }
    });

    // Command: /receipt <ORDER_ID>
    bot.command('receipt', async (ctx) => {
        try {
            const message = ctx.message.text.split(' ');
            if (message.length < 2) {
                return reply(ctx, '❌ **格式错误**\n用法: `/receipt <Payout Order ID>`');
            }

            const queryId = message[1].trim();
            const chatId = ctx.chat.id.toString();
            const user = await db.prepare('SELECT id, name FROM users WHERE telegram_group_id = ?').get(chatId);

            if (!user) return reply(ctx, '⚠️ **未绑定商户**');

            const payout = await db.prepare('SELECT * FROM payouts WHERE (order_id = ? OR platform_order_id = ? OR utr = ?) AND user_id = ?').get(queryId, queryId, queryId, user.id);

            if (!payout) {
                return reply(ctx, '❌ **未找到下发记录**\n请检查单号是否正确。');
            }

            // Format data for receipt
            const statusText = payout.status === 'success' ? 'SUCCESS' : (payout.status === 'failed' ? 'FAILED' : 'PENDING');
            const statusEmoji = payout.status === 'success' ? '✅' : (payout.status === 'failed' ? '❌' : '⏳');
            const dateStr = new Date(payout.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
            const amount = parseFloat(payout.amount).toFixed(2);
            const fee = parseFloat(payout.fee || 0).toFixed(2);
            const utr = payout.utr || 'PENDING';
            const accountNo = payout.account_number ? `****${payout.account_number.slice(-4)}` : 'N/A';
            const accountName = payout.account_name || 'N/A';

            // Build receipt content lines for QuickChart title
            const receiptLines = [
                '╔════════════════════════════════╗',
                '║     VSPAY TRANSFER RECEIPT     ║',
                '╠════════════════════════════════╣',
                `║ Order: ${payout.order_id.substring(0, 22).padEnd(23)}║`,
                '║────────────────────────────────║',
                `║ Amount:  ₹${amount.padEnd(20)}║`,
                `║ Fee:     ₹${fee.padEnd(20)}║`,
                `║ Status:  ${statusText.padEnd(21)}║`,
                '║────────────────────────────────║',
                `║ UTR:     ${utr.substring(0, 21).padEnd(21)}║`,
                `║ Account: ${accountNo.padEnd(21)}║`,
                `║ Name:    ${accountName.substring(0, 19).padEnd(21)}║`,
                '║────────────────────────────────║',
                `║ ${dateStr.padEnd(30)}║`,
                `║ Merchant: ${user.name.substring(0, 20).padEnd(20)}║`,
                '╚════════════════════════════════╝'
            ];

            // Generate receipt image using QuickChart.io with a dummy chart and custom labels
            const chartConfig = {
                type: 'bar',
                data: {
                    labels: [''],
                    datasets: [{ data: [0], backgroundColor: 'transparent' }]
                },
                options: {
                    plugins: {
                        title: {
                            display: true,
                            text: receiptLines,
                            color: '#00ff88',
                            font: { size: 13, family: 'monospace', weight: 'normal' },
                            padding: { top: 20, bottom: 20 }
                        },
                        legend: { display: false }
                    },
                    scales: { x: { display: false }, y: { display: false } }
                }
            };

            const encodedConfig = encodeURIComponent(JSON.stringify(chartConfig));
            const imageUrl = `https://quickchart.io/chart?c=${encodedConfig}&w=400&h=380&bkg=%231a1a2e&f=png`;

            await ctx.replyWithPhoto(imageUrl, {
                caption: `🧾 *Receipt Generated* ${statusEmoji}\nOrder: \`${payout.order_id}\`\nAmount: ₹${amount} | Status: *${statusText}*`,
                parse_mode: 'Markdown',
                reply_to_message_id: ctx.message.message_id
            });

        } catch (error) {
            console.error('Bot Receipt Error:', error);
            reply(ctx, '❌ **生成凭证失败**');
        }
    });

    // Help / Start Command
    bot.start((ctx) => {
        const msg = `🤖 **收银助手机器人已就绪**\n` +
            `您可以发送以下命令进行操作:\n\n` +
            `🔹 /link <金额> - 创建支付链接\n` +
            `🔹 /balance - 查询余额与统计\n` +
            `🔹 /check <单号/UTR> - 查询交易状态\n` +
            `🔹 /submit <单号> <UTR> - 提交补单\n` +
            `🔹 /stats - 查询实时成功率\n` +
            `🔹 /last - 查看最后一条待处理\n` +
            `🔹 /apidetails - 查看 API 接入信息\n` +
            `🔹 /upi - 查看支持的支付方式\n` +
            `🔹 /bind <密钥> - 绑定群组到商户\n` +
            `🔹 /receipt <单号> - 生成下发回单图片`;
        reply(ctx, msg);
    });

    if (!process.env.VERCEL && process.env.USE_WEBHOOK !== 'true') {
        bot.launch().then(() => {
            console.log('Telegram Bot started (Polling)');
        }).catch(err => {
            console.error('Failed to start Telegram Bot:', err);
        });
        process.once('SIGINT', () => bot.stop('SIGINT'));
        process.once('SIGTERM', () => bot.stop('SIGTERM'));
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
            await bot.telegram.sendMessage(u.telegram_group_id, text, { parse_mode: 'Markdown' });
            success++;
        } catch (e) {
            console.error(`Failed to send to ${u.telegram_group_id}:`, e.message);
            failed++;
        }
    }
    return { success, failed };
}

module.exports = { initBot, broadcastMessage, handleUpdate, getBot: () => bot };