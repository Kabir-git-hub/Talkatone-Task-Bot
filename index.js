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
const ADMIN_ID = process.env.ADMIN_USER_ID; 
const WORK_SHEET_NAME = "Sheet1"; // অথবা আপনার কাজের শীটের ট্যাবের যে নাম

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


// --- ক্যাশিং এর জন্য ভ্যারিয়েবল ---
const userStates = {};
let workSheetCache = [];
let lastCacheTime = 0;
let userStatsCache = [];
let lastStatsCacheTime = 0;
let statsCache = { x: 0, y: 0 };
let isUpdatingSheet = false;
const CACHE_DURATION = 30 * 1000;
// -----------------------------
// ------ ৩. গুগল শীট কানেকশন এবং ক্যাশিং ------

// ------ ৩. গুগল শীট কানেকশন এবং ক্যাশিং (সংশোধিত) ------

// এই ফাংশনটি Work Sheet এর ডেটা ক্যাশ করবে এবং সেখান থেকে দেবে
async function getWorkSheetRows(forceRefresh = false) {
    const now = Date.now();
    if (forceRefresh || (now - lastCacheTime > CACHE_DURATION) || workSheetCache.length === 0) {
        try {
            console.log("Refreshing cache from Google Sheets...");
            const doc = new GoogleSpreadsheet(WORK_SHEET_ID, serviceAccountAuth);
            await doc.loadInfo();
            const sheet = doc.sheetsByTitle["Sheet1"];
            const statsTab = doc.sheetsByTitle["Stats"];

            if (sheet && statsTab) {
                await sheet.loadHeaderRow();
                workSheetCache = await sheet.getRows();
                
                await statsTab.loadCells('A2:B2');
                const cellX = statsTab.getCell(1, 0);
                const cellY = statsTab.getCell(1, 1);
                statsCache = { x: cellX.value || 0, y: cellY.value || 0 };

                lastCacheTime = now;
                console.log(`Cache updated: ${workSheetCache.length} tasks, Stats (x/y): ${statsCache.x}/${statsCache.y}`);
            } else {
                console.error("'Sheet1' or 'Stats' tab not found.");
                return workSheetCache; // পুরনো ক্যাশ রিটার্ন করা
            }
        } catch (error) {
            console.error("Error refreshing cache:", error);
            return workSheetCache; // এরর হলে পুরনো ক্যাশ ব্যবহার করা
        }
    }
    return workSheetCache;
}


// User Stats শীটের জন্য নতুন ক্যাশিং ফাংশন
async function getUserStatsRows(forceRefresh = false) {
    const now = Date.now();
    if (forceRefresh || (now - lastStatsCacheTime > CACHE_DURATION) || userStatsCache.length === 0) {
        try {
            console.log("Refreshing User Stats cache...");
            const doc = new GoogleSpreadsheet(STATS_SHEET_ID, serviceAccountAuth);
            await doc.loadInfo();
            const sheet = doc.sheetsByIndex[0];
            await sheet.loadHeaderRow();
            userStatsCache = await sheet.getRows();
            lastStatsCacheTime = now;
            console.log(`User Stats cache updated with ${userStatsCache.length} rows.`);
        } catch (error) {
            console.error("Error refreshing User Stats cache:", error);
            return userStatsCache;
        }
    }
    return userStatsCache;
}

// User Stats শীটের মূল অবজেক্ট পাওয়ার জন্য Helper ফাংশন
async function getUserStatsSheet() {
    const doc = new GoogleSpreadsheet(STATS_SHEET_ID, serviceAccountAuth);
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0];
    await sheet.loadHeaderRow();
    return sheet;
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

// ------ ৫. মূল কমান্ড হ্যান্ডেলার (চূড়ান্ত পুনর্গঠিত এবং নির্ভুল ভার্সন) ------
async function handleCommand(msg, command, fromId, messageId) {
    const chatId = msg.chat.id;
    const userId = fromId || msg.from.id;

    try {
        // ধাপ ১: ব্যবহারকারীকে খোঁজা (সেশন এবং ক্যাশ থেকে)
        let user = userStates[userId]?.user;
        if (!user) {
            user = await findUser(userId);
            if (user) {
                if (!userStates[userId]) userStates[userId] = {};
                userStates[userId].user = user;
            }
        }

        // ধাপ ২: নতুন ব্যবহারকারী রেজিস্ট্রেশন এবং অ্যাডমিন নোটিফিকেশন
        if (!user) {
            if (command && command.trim().length > 2 && !command.startsWith('/')) {
                await registerUser(userId, command.trim());
                // রেজিস্ট্রেশনের পর ব্যবহারকারীকে একটি স্বাগত বার্তা দেওয়া
                bot.sendMessage(chatId, `অভিনন্দন ${command.trim()}! আপনার রেজিস্ট্রেশন সম্পন্ন হয়েছে। অ্যাডমিনের অনুমোদনের জন্য অনুগ্রহ করে অপেক্ষা করুন।`);
            } else {
                bot.sendMessage(chatId, "স্বাগতম! বটটি ব্যবহার করার জন্য, দয়া করে আপনার নাম লিখে পাঠান।");
            }
            return; // নতুন ব্যবহারকারীর জন্য ফাংশনের কাজ এখানেই শেষ
        }

        // ... handleCommand ফাংশনের ভেতরে, অ্যাডমিন কমান্ড ব্লকে ...
        if (String(userId) === String(ADMIN_ID)) {
            // ... /admin_panel, /approve_, /revoke_ কমান্ডগুলো ...

            // --- নতুন: ক্যাশ ক্লিয়ার করার জন্য অ্যাডমিন কমান্ড ---
            if (command === '/clearcache') {
                // সব ক্যাশ রিসেট করা হচ্ছে
                workSheetCache = [];
                userStatsCache = [];
                Object.keys(userStates).forEach(key => delete userStates[key]); // সব ইউজার সেশন ডিলিট করা
                lastCacheTime = 0;
                lastStatsCacheTime = 0;
                console.log("All caches cleared by admin command.");
                bot.sendMessage(chatId, "✅ সব ক্যাশ সফলভাবে পরিষ্কার করা হয়েছে।");
                return;
            }
        }


        // ধাপ ৩: অ্যাডমিন কমান্ডগুলো সবার আগে চেক করা
        if (String(userId) === String(ADMIN_ID)) {
            if (command === '/admin_panel') {
                await showAdminPanel(chatId);
                return;
            }
            if (command.startsWith('/approve_')) {
                const targetUserId = command.split('_')[1];
                await manageUserAccess(chatId, targetUserId, 'yes');
                return;
            }
            if (command.startsWith('/revoke_')) {
                const targetUserId = command.split('_')[1];
                await manageUserAccess(chatId, targetUserId, 'no');
                return;
            }
        }
        
        // ধাপ ৪: সাধারণ ব্যবহারকারীদের জন্য অ্যাক্সেস কন্ট্রোল চেক
        if (user.access !== 'yes') {
            bot.sendMessage(chatId, "দুঃখিত, আপনাকে এখনো অনুমোদন করা হয়নি। অনুগ্রহ করে অ্যাডমিনের অনুমোদনের জন্য অপেক্ষা করুন।");
            return;
        }
        
        // ধাপ ৫: রেজিস্টার্ড এবং অনুমোদিত ব্যবহারকারীদের জন্য বাকি কাজ
        if (userStates[userId] && userStates[userId].state === 'awaiting_phone') {
            await handlePhoneNumberInput(chatId, user, command, userStates[userId]);
            return;
        }
        
        if (command === '/start') {
            bot.sendMessage(chatId, `স্বাগতম, ${user.name}! কী করতে চান?`, { reply_markup: getMainMenuKeyboard(userId) });
        } else if (command === '/get_task') {
            await handleGetTask(chatId, user);
        } else if (command === '/my_stats') {
            await updateAndShowStats(chatId, user);
        } else if (command.startsWith('submit_phone_')) {
            const taskRow = command.split('_')[2];
            if (!userStates[userId]) userStates[userId] = {};
            userStates[userId].state = 'awaiting_phone';
            userStates[userId].row = taskRow;
            userStates[userId].messageId = messageId;
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

// ------ নতুন: অ্যাডমিন প্যানেলের জন্য ফাংশন (সংশোধিত) ------
async function showAdminPanel(chatId) {
    // --- মূল পরিবর্তন: সরাসরি ক্যাশ করা ব্যবহারকারীদের তালিকা (Array) নেওয়া হচ্ছে ---
    const rows = await getUserStatsRows();

    if (rows.length === 0) {
        bot.sendMessage(chatId, "কোনো রেজিস্টার্ড ব্যবহারকারী নেই।");
        return;
    }

    let message = "ব্যবহারকারীদের তালিকা:\n\n";
    const keyboard = [];

    rows.forEach(row => {
        const name = row.get('UserName');
        const id = row.get('UserID');
        const access = row.get('Access');
        const statusIcon = (access === 'yes') ? '✅' : '❌';
        
        message += `${statusIcon} ${name} - \`${id}\`\n`;
        
        keyboard.push([
            { text: `Approve ${name}`, callback_data: `/approve_${id}` },
            { text: `Revoke ${name}`, callback_data: `/revoke_${id}` }
        ]);
    });

    bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
    });
}

/// ------ নতুন: অ্যাডমিনদের জন্য ব্যবহারকারী ব্যবস্থাপনার ফাংশন (সংশোধিত) ------
async function manageUserAccess(adminChatId, targetUserId, accessStatus) {
    try {
        // --- মূল পরিবর্তন: সরাসরি ক্যাশ করা ব্যবহারকারীদের তালিকা (Array) নেওয়া হচ্ছে ---
        const rows = await getUserStatsRows();
        
        const userRow = rows.find(row => String(row.get('UserID')) === String(targetUserId));

        if (userRow) {
            userRow.set('Access', accessStatus);
            await userRow.save();
            await getUserStatsRows(true); // ক্যাশ রিফ্রেশ করা

            const userName = userRow.get('UserName');
            bot.sendMessage(adminChatId, `"${userName}"-এর অ্যাক্সেস "${accessStatus}" করা হয়েছে।`);
            
            // ব্যবহারকারীকে নোটিফিকেশন পাঠানো
            if (accessStatus === 'yes') {
                bot.sendMessage(targetUserId, "অভিনন্দন! অ্যাডমিন আপনার অ্যাকাউন্ট অনুমোদন করেছেন। আপনি এখন বট ব্যবহার করতে পারবেন।", { reply_markup: getMainMenuKeyboard(targetUserId) });
            } else {
                bot.sendMessage(targetUserId, "দুঃখিত, অ্যাডমিন আপনার অ্যাকাউন্টের অ্যাক্সেস স্থগিত করেছেন।");
            }

            // অ্যাডমিন প্যানেল রিফ্রেশ করে দেখানো
            await showAdminPanel(adminChatId);
        } else {
            bot.sendMessage(adminChatId, `দুঃখিত, ${targetUserId} ID সম্পন্ন কোনো ব্যবহারকারী নেই।`);
        }
    } catch (error) {
        console.error("Error managing user access:", error);
        bot.sendMessage(adminChatId, "অ্যাক্সেস পরিবর্তন করার সময় একটি সমস্যা হয়েছে।");
    }
}

// ------ ৬. বটের মূল ফাংশনগুলো (চূড়ান্ত ভার্সন) ------

async function handleGetTask(chatId, user) {
    if (isUpdatingSheet) {
        bot.sendMessage(chatId, "অন্য একজন ব্যবহারকারী এই মুহূর্তে কাজ নিচ্ছেন। অনুগ্রহ করে কয়েক সেকেন্ড পর আবার চেষ্টা করুন।");
        return;
    }

    const rows = await getWorkSheetRows();
    const existingTask = rows.find(row => row.get('AssignedTo') === user.name && row.get('Status') === 'Assigned');
    if (existingTask) {
        bot.sendMessage(chatId, "আপনার কাছে ইতিমধ্যে একটি কাজ অসমাপ্ত রয়েছে।");
        return;
    }

    const availableTask = rows.find(row => row.get('Status') === 'Available');
    if (availableTask) {
        isUpdatingSheet = true;

        try {
            // --- মূল পরিবর্তন: সরাসরি ক্যাশ করা statsCache ভ্যারিয়েবল থেকে মান নেওয়া হচ্ছে ---
            const title = `আপনার নতুন কাজ (${statsCache.x}/${statsCache.y})`;

            const taskRow = availableTask.rowNumber;
            const message = `<b>${title}</b>\n\n` +
                            `<b>Email: </b> <code>${availableTask.get('Email')}</code>\n` +
                            `<b>Password: </b> <code>${availableTask.get('Password')}</code>\n` +
                            `<b>Recovery Mail:</b> <code>${availableTask.get('Recovery Mail')}</code>\n\n` +
                            `কাজটি শেষ হলে ফোন নম্বরটি এখানে পাঠান।`;
            
            const keyboard = { inline_keyboard: [[{ text: "✅ ফোন নম্বর জমা দিন", callback_data: `submit_phone_${taskRow}` }], [{ text: "❌ বাতিল করুন (Reject)", callback_data: `reject_${taskRow}` }]] };

            bot.sendMessage(chatId, message, { parse_mode: 'HTML', reply_markup: keyboard });

            console.log(`Assigning task (Row ${taskRow}) to ${user.name} in the background...`);
            availableTask.set('Status', 'Assigned');
            availableTask.set('AssignedTo', user.name);
            await availableTask.save();
            await getWorkSheetRows(true);
            console.log("Background update successful.");

        } catch (error) {
            console.error("Error during handleGetTask:", error);
            bot.sendMessage(chatId, "কাজ দেওয়ার সময় একটি সমস্যা হয়েছে।");
        } finally {
            isUpdatingSheet = false;
        }

    } else {
        bot.sendMessage(chatId, "দুঃখিত, এই মুহূর্তে কোনো নতুন কাজ নেই।");
    }
}


async function handlePhoneNumberInput(chatId, user, phoneNumber, stateData) {
    const trimmedPhoneNumber = phoneNumber.trim();
    // ... ফোন নম্বর ফরম্যাট চেক অপরিবর্তিত ...

    const { row, messageId } = stateData;
    const rows = await getWorkSheetRows();
    const task = rows.find(r => r.rowNumber == row);

    if (task && task.get('AssignedTo') === user.name && task.get('Status') === "Assigned") {
        task.set('PhoneNumber', trimmedPhoneNumber);
        task.set('Status', "Completed");
        await task.save();
        await getWorkSheetRows(true); // শুধু ক্যাশ রিফ্রেশ করা হচ্ছে

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
}

async function handleRejectTask(chatId, user, rowToReject, reason, messageId) {
    const rows = await getWorkSheetRows();
    const task = rows.find(r => r.rowNumber == rowToReject);

    if (task && task.get('Status') === "Assigned" && task.get('AssignedTo') === user.name) {
        let responseText = "";
        if (reason === "problem") {
            task.set('Status', "Rejected");
            await task.save();
            await getWorkSheetRows(true); // শুধু ক্যাশ রিফ্রেশ করা হচ্ছে
            responseText = `কাজটি (সারি ${rowToReject}) সফলভাবে বাতিল করা হয়েছে।`;
        } else if (reason === "later") {
            task.set('Status', "Available");
            task.set('AssignedTo', "");
            await task.save();
            await getWorkSheetRows(true); // শুধু ক্যাশ রিফ্রেশ করা হচ্ছে
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
    const rows = await getWorkSheetRows();
    
    const task = rows.find(r => r.rowNumber == taskRow);

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
    const rows = await getUserStatsRows(); // <<<--- সরাসরি ক্যাশিং ফাংশন কল করা হচ্ছে
    const userRow = rows.find(row => String(row.get('UserID')) === String(userId));
    if (userRow) {
        return {
            row: userRow.rowNumber,
            id: userRow.get('UserID'),
            name: userRow.get('UserName'),
            total: parseInt(userRow.get('TotalCompleted')) || 0,
            daily: parseInt(userRow.get('DailyCompleted')) || 0,
            date: userRow.get('LastCompletedDate'),
            access: userRow.get('Access') ? userRow.get('Access').toLowerCase() : 'no'
        };
    }
    return null;
}

async function registerUser(userId, userName) {
    const userStatsSheet = await getUserStatsSheet(); // <<<--- মূল শীট অবজেক্ট পাওয়া
    
    await userStatsSheet.addRow({
        UserID: userId,
        UserName: userName,
        TotalCompleted: 0,
        DailyCompleted: 0,
        LastCompletedDate: "",
        Access: "no"
    });
    
    await getUserStatsRows(true); // ক্যাশ রিফ্রেশ করা
    
    if (ADMIN_ID) {
        const adminMessage = `নতুন ব্যবহারকারী: ${userName} (\`${userId}\`)\n\nঅনুমোদন দিতে অ্যাডমিন প্যানেল ব্যবহার করুন।`;
        bot.sendMessage(ADMIN_ID, adminMessage, { 
            parse_mode: 'Markdown', 
            reply_markup: { 
                inline_keyboard: [[{ text: "⚙️ অ্যাডমিন প্যানেল খুলুন", callback_data: "/admin_panel" }]] 
            } 
        });
    }
}

// ------ ৭. ইউজার এবং স্ট্যাটাস ম্যানেজমেন্ট ফাংশন (সংশোধিত) ------
async function updateUserStats(user, count) {
    // --- মূল পরিবর্তন: সরাসরি ক্যাশ করা ব্যবহারকারীদের তালিকা (Array) নেওয়া হচ্ছে ---
    const rows = await getUserStatsRows();
    
    const userRow = rows.find(r => r.rowNumber == user.row);

    if (userRow) {
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
        userRow.set('LastCompletedDate', today.toLocaleDateString('en-CA'));
        await userRow.save();
        await getUserStatsRows(true);
        console.log(`User Stats cache refreshed after updating stats for: ${user.name}`);
    }
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

function getMainMenuKeyboard(userId) {
    const defaultKeyboard = [
        [{ text: "✅ নতুন কাজ নিন (Get Task)", callback_data: "/get_task" }],
        [{ text: "📊 আমার কাজের হিসাব (My Stats)", callback_data: "/my_stats" }]
    ];

    // যদি ব্যবহারকারী অ্যাডমিন হয়, তাহলে "Admin Panel" বাটন যোগ করা
    if (String(userId) === String(ADMIN_ID)) {
        defaultKeyboard.push([{ text: "⚙️ অ্যাডমিন প্যানেল", callback_data: "/admin_panel" }]);
    }

    return { inline_keyboard: defaultKeyboard };
}


// ------ ৮. সার্ভার চালু করা ------
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});