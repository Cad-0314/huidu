const { Telegraf } = require('telegraf');
const { getDb } = require('../config/database');

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
                return ctx.reply('Usage: /bind <MERCHANT_KEY>');
            }

            const merchantKey = message[1].trim();
            const user = await db.prepare('SELECT id, name FROM users WHERE merchant_key = ?').get(merchantKey);

            if (!user) {
                return ctx.reply('Invalid Merchant Key.');
            }

            const chatId = ctx.chat.id.toString();
            await db.prepare('UPDATE users SET telegram_group_id = ? WHERE id = ?').run(chatId, user.id);

            ctx.reply(`✅ Successfully bound to merchant: ${user.name}`);
        } catch (error) {
            console.error('Bot Bind Error:', error);
            ctx.reply('An error occurred during binding.');
        }
    });

    // Command: /balance
    bot.command('balance', async (ctx) => {
        try {
            const chatId = ctx.chat.id.toString();
            const user = await db.prepare('SELECT balance, name FROM users WHERE telegram_group_id = ?').get(chatId);

            if (!user) {
                return ctx.reply('⚠️ This chat is not bound to any merchant. Use /bind <KEY> first.');
            }

            ctx.reply(`💰 Merchant: ${user.name}\nBalance: ₹${user.balance.toFixed(2)}`);
        } catch (error) {
            console.error('Bot Balance Error:', error);
            ctx.reply('Error fetching balance.');
        }
    });

    // Command: /check <UTR_OR_ORDER_ID>
    bot.command('check', async (ctx) => {
        try {
            const message = ctx.message.text.split(' ');
            if (message.length !== 2) {
                return ctx.reply('Usage: /check <UTR_OR_ORDER_ID>');
            }

            const queryId = message[1].trim();
            const chatId = ctx.chat.id.toString();
            const user = await db.prepare('SELECT id FROM users WHERE telegram_group_id = ?').get(chatId);

            if (!user) {
                return ctx.reply('⚠️ This chat is not bound to any merchant.');
            }

            const tx = await db.prepare('SELECT * FROM transactions WHERE (order_id = ? OR platform_order_id = ? OR utr = ?) AND user_id = ?').get(queryId, queryId, queryId, user.id);

            if (!tx) {
                // Also check payouts?
                const payout = await db.prepare('SELECT * FROM payouts WHERE (order_id = ? OR platform_order_id = ? OR utr = ?) AND user_id = ?').get(queryId, queryId, queryId, user.id);

                if (payout) {
                    return ctx.reply(`📤 **Payout Details**\nOrder ID: ${payout.order_id}\nAmount: ${payout.amount}\nStatus: ${payout.status.toUpperCase()}\nUTR: ${payout.utr || 'N/A'}`);
                }

                return ctx.reply('❌ Transaction not found.');
            }

            ctx.reply(`📥 **Payin Details**\nOrder ID: ${tx.order_id}\nAmount: ${tx.amount}\nStatus: ${tx.status.toUpperCase()}\nUTR: ${tx.utr || 'N/A'}`);
        } catch (error) {
            console.error('Bot Check Error:', error);
            ctx.reply('Error checking transaction.');
        }
    });

    // Command: /last (Last Pending Transaction)
    bot.command('last', async (ctx) => {
        try {
            const chatId = ctx.chat.id.toString();
            const user = await db.prepare('SELECT id FROM users WHERE telegram_group_id = ?').get(chatId);

            if (!user) {
                return ctx.reply('⚠️ This chat is not bound to any merchant.');
            }

            const tx = await db.prepare('SELECT * FROM transactions WHERE user_id = ? AND status = "pending" ORDER BY created_at DESC LIMIT 1').get(user.id);

            if (!tx) {
                return ctx.reply('✅ No pending transactions found.');
            }

            ctx.reply(`⏳ **Last Pending Payin**\nOrder ID: ${tx.order_id}\nAmount: ${tx.amount}\nCreated: ${tx.created_at}`);
        } catch (error) {
            console.error('Bot Last Error:', error);
            ctx.reply('Error fetching last transaction.');
        }
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

module.exports = { initBot };
