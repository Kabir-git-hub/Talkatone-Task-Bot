// ======================================================================
//          চূড়ান্ত এবং অপটিমাইজড কোড (শুধুমাত্র বটের কাজের জন্য)
// ======================================================================

// ------ ১. লাইব্রেরি এবং কনফিগারেশন ------
require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const creds = require('./credentials.json');

// .env ফাইল থেকে ভ্যারিয়েবল লোড করা
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WORK_SHEET_ID = process.env.WORK_SHEET_ID;
const STATS_SHEET_ID = process.env.STATS_SHEET_ID;
const PORT = process.env.PORT || 3000;
const SERVER_URL = process.env.SERVER_URL;
const WORK_SHEET_NAME = "Stats"; // অথবা আপনার কাজের শীটের ট্যাবের যে নাম

// ------ ২. সার্ভিস এবং বট চালু করা ------
const app = express();
app.use(express.json());
const bot = new TelegramBot(TOKEN);
const webhookUrl = `${SERVER_URL}/bot${TOKEN}`;
bot.setWebHook(webhookUrl);

// গুগল শীট অথেন্টিকেশন
const serviceAccountAuth = new JWT({
    email: creds.client_email,
    key: creds.private_key.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

// ------ ৩. গুগল শীট কানেকশন ফাংশন (চূড়ান্ত ভার্সন) ------
async function getSheets() {
    // Work Sheet এবং এর ভেতরের ট্যাবগুলো অ্যাক্সেস করা
    const workDoc = new GoogleSpreadsheet(WORK_SHEET_ID, serviceAccountAuth);
    await workDoc.loadInfo();
    const workSheet = workDoc.sheetsByTitle["Sheet1"]; // আপনার মূল কাজের ট্যাব
    const statsTab = workDoc.sheetsByTitle["Stats"];   // আপনার পরিসংখ্যান ট্যাব

    // User Stats শীট অ্যাক্সেস করা
    const statsDoc = new GoogleSpreadsheet(STATS_SHEET_ID, serviceAccountAuth);
    await statsDoc.loadInfo();
    const userStatsSheet = statsDoc.sheetsByIndex[0];
    
    // সবগুলোকে একসাথে রিটার্ন করা
    return { workSheet, statsTab, userStatsSheet };
}


// ------ ৪. Webhook এবং টেলিগ্রাম ইনপুট হ্যান্ডেল করা ------
app.post(`/bot${TOKEN}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

bot.on('message', (msg) => handleCommand(msg, msg.text));
bot.on('callback_query', (callbackQuery) => {
    bot.answerCallbackQuery(callbackQuery.id);
    handleCommand(callbackQuery.message, callbackQuery.data, callbackQuery.from.id, callbackQuery.message.message_id);
});

// ------ ৫. মূল কমান্ড হ্যান্ডেলার (সংশোধিত এবং নির্ভুল) ------
async function handleCommand(msg, command, fromId, messageId) {
    const chatId = msg.chat.id;
    const userId = fromId || msg.from.id;

    try {
        const user = await findUser(userId);

        // রেজিস্ট্রেশন প্রক্রিয়া
        if (!user) {
            if (command && command.trim().length > 2 && !command.startsWith('/')) {
                await registerUser(userId, command.trim());
                bot.sendMessage(chatId, `অভিনন্দন ${command.trim()}! আপনার রেজিস্ট্রেশন সম্পন্ন হয়েছে।`, { reply_markup: getMainMenuKeyboard() });
            } else {
                bot.sendMessage(chatId, "স্বাগতম! বটটি ব্যবহার করার জন্য, দয়া করে আপনার নাম লিখে পাঠান।");
            }
            return; // রেজিস্ট্রেশন হয়ে গেলে বা করতে বললে ফাংশন শেষ
        }

        // স্টেটফুল ফোন নম্বর ইনপুট
        if (userStates[userId] && userStates[userId].state === 'awaiting_phone') {
            await handlePhoneNumberInput(chatId, user, command, userStates[userId]);
            return; // ফোন নম্বর জমা দেওয়ার পর ফাংশন শেষ
        }
        
        // বাটন এবং কমান্ড অনুযায়ী কাজ করা
        if (command === '/start') {
            bot.sendMessage(chatId, `স্বাগতম, ${user.name}! কী করতে চান?`, { reply_markup: getMainMenuKeyboard() });
        } else if (command === '/get_task') {
            await handleGetTask(chatId, user);
        } else if (command === '/my_stats') {
            await updateAndShowStats(chatId, user);
        } else if (command.startsWith('submit_phone_')) {
            const taskRow = command.split('_')[2];
            userStates[userId] = { state: 'awaiting_phone', row: taskRow, messageId: messageId };
            bot.sendMessage(chatId, "অনুগ্রহ করে ফোন নম্বরটি পাঠান।");
        } else if (command.startsWith('reject_')) {
            const taskRow = command.split('_')[1];
            const rejectOptionsKeyboard = { inline_keyboard: [ [{ text: "🚫 Account Create Problem", callback_data: `confirm_reject_problem_${taskRow}` }], [{ text: "⏰ পরে করব (Do Later)", callback_data: `confirm_reject_later_${taskRow}` }], [{ text: "↩️  ফিরে যান (Back) ", callback_data: `back_to_task_${taskRow}`}] ] };
            bot.editMessageText("আপনি কেন কাজটি বাতিল করতে চান?", { chat_id: chatId, message_id: messageId, reply_markup: rejectOptionsKeyboard });
        } else if (command.startsWith("confirm_reject_")) {
            const parts = command.split("_");
            const reason = parts[2];
            const taskRow = parts[3];
            const confirmationKeyboard = { inline_keyboard: [ [{ text: "✅ হ্যাঁ (Yes)", callback_data: `final_reject_${reason}_${taskRow}` }], [{ text: "❌ না (No)", callback_data: `back_to_task_${taskRow}` }] ] };
            bot.editMessageText("আপনি কি নিশ্চিত?", { chat_id: chatId, message_id: messageId, reply_markup: confirmationKeyboard });
        } else if (command.startsWith("final_reject_")) {
            const parts = command.split("_");
            const reason = parts[2];
            const taskRow = parts[3];
            await handleRejectTask(chatId, user, taskRow, reason, messageId);
        } else if (command.startsWith("back_to_task_")) {
            const taskRow = command.split("_")[3];
            await handleBackToTask(chatId, taskRow, messageId);
        }

    } catch (error) {
        console.error(`Error in handleCommand: ${error.toString()} \nStack: ${error.stack}`);
        bot.sendMessage(chatId, "একটি মারাত্মক সমস্যা হয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন।");
    }
}


// ------ ৬. বটের মূল ফাংশনগুলো (আপডেটেড) ------

async function handleGetTask(chatId, user) {
    // getSheets থেকে এখন workSheet এবং statsTab দুটোই আসছে
    const { workSheet, statsTab } = await getSheets(); 
    
    // ডিবাগিং: নিশ্চিত করা যে ট্যাবগুলো লোড হয়েছে
    if (!workSheet || !statsTab) {
        console.error("Error: Could not load 'Sheet1' or 'Stats' tab.");
        bot.sendMessage(chatId, "শীটের সাথে সংযোগ করতে একটি সমস্যা হয়েছে।");
        return;
    }

    await workSheet.loadHeaderRow();
    const rows = await workSheet.getRows();

    const existingTask = rows.find(row => row.get('AssignedTo') === user.name && row.get('Status') === 'Assigned');
    if (existingTask) {
        bot.sendMessage(chatId, "আপনার কাছে ইতিমধ্যে একটি কাজ অসমাপ্ত রয়েছে।");
        return;
    }

    const availableTask = rows.find(row => row.get('Status') === 'Available');
    if (availableTask) {
        // Stats ট্যাব থেকে x এবং y এর মান পড়া
        await statsTab.loadCells('A2:B2');
        const cellX = statsTab.getCell(1, 0); // A2
        const cellY = statsTab.getCell(1, 1); // B2
        
        const stats = {
            x: cellX.value || 0,
            y: cellY.value || 0
        };
        const title = `আপনার নতুন কাজ (${stats.x}/${stats.y})`;

        availableTask.set('Status', 'Assigned');
        availableTask.set('AssignedTo', user.name);
        await availableTask.save();

        const taskRow = availableTask.rowNumber;
        const message = `<b>${title}</b>\n\n` +
                        `<b>Email: </b> <code>${availableTask.get('Email')}</code>\n` +
                        `<b>Password: </b> <code>${availableTask.get('Password')}</code>\n` +
                        `<b>Recovery Mail:</b> <code>${availableTask.get('Recovery Mail')}</code>\n\n` +
                        `কাজটি শেষ হলে ফোন নম্বরটি এখানে পাঠান।`;
        
        const keyboard = { inline_keyboard: [[{ text: "✅ ফোন নম্বর জমা দিন", callback_data: `submit_phone_${taskRow}` }], [{ text: "❌ বাতিল করুন (Reject)", callback_data: `reject_${taskRow}` }]] };
        bot.sendMessage(chatId, message, { parse_mode: 'HTML', reply_markup: keyboard });
    } else {
        bot.sendMessage(chatId, "দুঃখিত, এই মুহূর্তে কোনো নতুন কাজ নেই।");
    }
}


async function handlePhoneNumberInput(chatId, user, phoneNumber, stateData) {
    const trimmedPhoneNumber = phoneNumber.trim();
    const phoneRegex = /^\(\d{3}\)\s\d{3}-\d{4}$/;

    if (!phoneRegex.test(trimmedPhoneNumber)) {
        bot.sendMessage(chatId, "দুঃখিত, ফোন নম্বরটি সঠিক ফরম্যাটে নেই। অনুগ্রহ করে `(123) 456-7890` এই ফরম্যাটে আবার পাঠান।");
        return;
    }

    const { row, messageId } = stateData;
    const { workSheet } = await getSheets();
    await workSheet.loadHeaderRow();
    const rows = await workSheet.getRows();
    
    // সারি খুঁজে বের করার জন্য সবচেয়ে নির্ভরযোগ্য পদ্ধতি
    const task = rows.find(r => r.rowNumber == row);

    if (task && task.get('AssignedTo') === user.name && task.get('Status') === "Assigned") {
        task.set('PhoneNumber', trimmedPhoneNumber);
        task.set('Status', "Completed");
        await task.save();
        
        await updateUserStats(user, 1);
        delete userStates[user.id];
        
        const taskDetails = `<b>কাজটি সম্পন্ন হয়েছে (সারি ${row}):</b>\n\n`+
                            `<b>Email:</b> <code>${task.get('Email')}</code>\n`+
                            `<b>Password:</b> <code>${task.get('Password')}</code>\n`+
                            `<b>Recovery Mail:</b> <code>${task.get('Recovery Mail')}</code>\n\n`+
                            `<b>জমাকৃত ফোন নম্বর:</b> <code>${trimmedPhoneNumber}</code>`;

        if (messageId) {
            bot.editMessageText(taskDetails, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: {} });
        }
        bot.sendMessage(chatId, `✅ ধন্যবাদ! কাজটি সফলভাবে জমা হয়েছে।`, { reply_markup: getMainMenuKeyboard() });
    } else {
        delete userStates[user.id];
        bot.sendMessage(chatId, "দুঃখিত, এই কাজটি জমা দেওয়ার সময় একটি সমস্যা হয়েছে।", { reply_markup: getMainMenuKeyboard() });
    }
}}

async function handleRejectTask(chatId, user, rowToReject, reason, messageId) {
    const { workSheet } = await getSheets();
    await workSheet.loadHeaderRow();
    const rows = await workSheet.getRows();

    // সারি খুঁজে বের করার জন্য সবচেয়ে নির্ভরযোগ্য পদ্ধতি
    const task = rows.find(r => r.rowNumber == rowToReject);

    if (task && task.get('Status') === "Assigned" && task.get('AssignedTo') === user.name) {
        let responseText = "";
        if (reason === "problem") {
            task.set('Status', "Rejected");
            await task.save();
            responseText = `কাজটি (সারি ${rowToReject}) সফলভাবে বাতিল করা হয়েছে।`;
        } else if (reason === "later") {
            task.set('Status', "Available");
            task.set('AssignedTo', "");
            await task.save();
            responseText = `কাজটি আবার তালিকার শুরুতে যুক্ত করা হয়েছে।`;
        }
        
        if (messageId) {
            bot.editMessageText(responseText, { chat_id: chatId, message_id: messageId, reply_markup: {} });
        }
        bot.sendMessage(chatId, "আপনার পরবর্তী কাজের জন্য প্রস্তুত।", { reply_markup: getMainMenuKeyboard() });
    } else {
        if (messageId) bot.editMessageText("এই কাজটি বাতিল করা সম্ভব নয়।", { chat_id: chatId, message_id: messageId });
    }
}

async function handleBackToTask(chatId, taskRow, messageId) {
    const { workSheet } = await getSheets();
    await workSheet.loadHeaderRow();
    const rows = await workSheet.getRows();
    const task = rows[parseInt(taskRow) - 2];

    if (task) {
        const message = `<b>আপনার নতুন কাজ</b>\n\n` +
                        `<b>Email: </b> <code>${task.get('Email')}</code>\n` +
                        `<b>Password: </b> <code>${task.get('Password')}</code>\n` +
                        `<b>Recovery Mail:</b> <code>${task.get('Recovery Mail')}</code>\n\n` +
                        `কাজটি শেষ হলে ফোন নম্বরটি এখানে পাঠান।`;
        const originalKeyboard = { 
            inline_keyboard: [ 
                [{ text: "✅ ফোন নম্বর জমা দিন", callback_data: `submit_phone_${taskRow}` }], 
                [{ text: "❌ বাতিল করুন (Reject)", callback_data: `reject_${taskRow}` }] 
            ] 
        };
        bot.editMessageText(message, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: originalKeyboard });
    }
}

// ------ ৭. ইউজার এবং স্ট্যাটাস ম্যানেজমেন্ট ফাংশন ------

async function findUser(userId) {
    const { userStatsSheet } = await getSheets();
    const rows = await userStatsSheet.getRows();
    const userRow = rows.find(row => String(row.get('UserID')) === String(userId));
    if (userRow) {
        return {
            row: userRow.rowNumber,
            id: userRow.get('UserID'),
            name: userRow.get('UserName'),
            total: parseInt(userRow.get('TotalCompleted')) || 0,
            daily: parseInt(userRow.get('DailyCompleted')) || 0,
            date: userRow.get('LastCompletedDate')
        };
    }
    return null;
}

async function registerUser(userId, userName) {
    const { userStatsSheet } = await getSheets();
    await userStatsSheet.addRow({
        UserID: userId,
        UserName: userName,
        TotalCompleted: 0,
        DailyCompleted: 0,
        LastCompletedDate: ""
    });
}

async function updateUserStats(user, count) {
    const { userStatsSheet } = await getSheets();
    const rows = await userStatsSheet.getRows();
    const userRow = rows.find(r => r.rowNumber == user.row);

    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const lastDateStr = user.date ? new Date(user.date).toISOString().split('T')[0] : null;

    let dailyCount = parseInt(userRow.get('DailyCompleted')) || 0;
    if (todayStr === lastDateStr) {
        dailyCount += count;
    } else {
        dailyCount = count;
    }

    userRow.set('TotalCompleted', (parseInt(userRow.get('TotalCompleted')) || 0) + count);
    userRow.set('DailyCompleted', dailyCount);
    userRow.set('LastCompletedDate', today.toLocaleDateString('en-CA')); // YYYY-MM-DD format
    await userRow.save();
}

async function updateAndShowStats(chatId, user) {
    const latestUserInfo = await findUser(user.id);
    if (latestUserInfo) {
        const todaysCount = getTodaysCount(latestUserInfo);
        const statsMessage = `📊 *আপনার কাজের হিসাব, ${latestUserInfo.name}*\n\n- আজকের সম্পন্ন কাজ: ${todaysCount}\n- মোট সম্পন্ন কাজ: ${latestUserInfo.total}`;
        bot.sendMessage(chatId, statsMessage, { parse_mode: 'Markdown', reply_markup: getMainMenuKeyboard() });
    } else {
        bot.sendMessage(chatId, "দুঃখিত, আপনার তথ্য খুঁজে পাওয়া যায়নি।");
    }
}

function getTodaysCount(user) {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    if (!user.date) return 0;
    const lastDateStr = new Date(user.date).toISOString().split('T')[0];
    return todayStr === lastDateStr ? user.daily : 0;
}

function getMainMenuKeyboard() {
    return {
        inline_keyboard: [
            [{ text: "✅ নতুন কাজ নিন (Get Task)", callback_data: "/get_task" }],
            [{ text: "📊 আমার কাজের হিসাব (My Stats)", callback_data: "/my_stats" }]
        ]
    };
}

// ------ ৮. সার্ভার চালু করা ------
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});