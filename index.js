// ======================================================================
//          বটের চূড়ান্ত এবং অপটিমাইজড কোড (Node.js for Render)
// ======================================================================

// ------ ১. লাইব্রেরি ইম্পোর্ট ------
require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { GoogleSpreadsheet } = require('google-spreadsheet');

// ------ ২. আপনার তথ্য এবং কনফিগারেশন ------
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WORK_SHEET_ID = process.env.WORK_SHEET_ID;
const STATS_SHEET_ID = process.env.STATS_SHEET_ID;
const FINAL_SHEET_ID = process.env.FINAL_SHEET_ID;
const PORT = process.env.PORT || 3000;
const SERVER_URL = process.env.SERVER_URL; // Render থেকে পাওয়া URL

// সার্ভিস অ্যাকাউন্টের JSON ফাইল লোড করা
const creds = require('./credentials.json');

// টেলিগ্রাম বট এবং ওয়েব সার্ভার চালু করা
const bot = new TelegramBot(TOKEN);
const app = express();
app.use(express.json()); // টেলিগ্রাম থেকে আসা JSON ডেটা পার্স করার জন্য

// Webhook সেট করা
const webhookUrl = `${SERVER_URL}/bot${TOKEN}`;
bot.setWebHook(webhookUrl);

// ------ ৩. গুগল শীট কানেকশন ------
// গুগল শীট ডকুমেন্টগুলো লোড করার ফাংশন
async function getSheets() {
    const workDoc = new GoogleSpreadsheet(WORK_SHEET_ID);
    await workDoc.useServiceAccountAuth(creds);
    await workDoc.loadInfo();
    const workSheet = workDoc.sheetsByIndex[0];

    const statsDoc = new GoogleSpreadsheet(STATS_SHEET_ID);
    await statsDoc.useServiceAccountAuth(creds);
    await statsDoc.loadInfo();
    const statsSheet = statsDoc.sheetsByIndex[0];

    const finalDoc = new GoogleSpreadsheet(FINAL_SHEET_ID);
    await finalDoc.useServiceAccountAuth(creds);
    await finalDoc.loadInfo();
    const finalSheet = finalDoc.sheetsByIndex[0];
    
    return { workSheet, statsSheet, finalSheet };
}

// ইউজার স্টেট (state) সংরক্ষণ করার জন্য (PropertiesService-এর বিকল্প)
const userStates = {}; 

// ------ ৪. Webhook রিসিভ করার মূল ফাংশন (doPost-এর বিকল্প) ------
app.post(`/bot${TOKEN}`, async (req, res) => {
    try {
        bot.processUpdate(req.body);
    } catch (error) {
        console.error('Error processing update:', error);
    }
    res.sendStatus(200); // টেলিগ্রামকে জানানো যে আমরা রিকোয়েস্ট পেয়েছি
});

// ------ ৫. টেলিগ্রামের সব রকম ইনপুট হ্যান্ডেল করা ------

// "/start" এবং মেনু বাটনগুলোর জন্য
bot.on('callback_query', (callbackQuery) => {
    const msg = callbackQuery.message;
    const data = callbackQuery.data;

    // Command-এর মতো কাজ করানোর জন্য
    if (data.startsWith('/')) {
        handleTextMessage(msg, { text: data });
    } else {
        handleCallbackQuery(callbackQuery);
    }
});

bot.on('message', (msg) => {
    handleTextMessage(msg, msg);
});

// মূল লজিক হ্যান্ডেল করার ফাংশন
async function handleTextMessage(msg, command) {
    const chatId = msg.chat.id;
    const userId = msg.chat.id; // In a 1-on-1 chat, chatId and userId are the same
    const text = command.text;

    try {
        const user = await findUser(userId);

        // --- রেজিস্ট্রেশন প্রক্রিয়া ---
        if (!user) {
            if (text && text.trim().length > 2 && text.trim().length < 30 && !text.startsWith('/')) {
                await registerUser(userId, text.trim());
                bot.sendMessage(chatId, `অভিনন্দন ${text.trim()}! আপনার রেজিস্ট্রেশন সম্পন্ন হয়েছে।`, { reply_markup: getMainMenuKeyboard() });
            } else {
                bot.sendMessage(chatId, "স্বাগতম! বটটি ব্যবহার করার জন্য, দয়া করে আপনার নাম লিখে পাঠান।");
            }
            return;
        }

        // --- রেজিস্টার্ড ব্যবহারকারীদের জন্য বাকি কাজ ---
        if (userStates[userId] && userStates[userId].state === 'awaiting_phone') {
            await handlePhoneNumberInput(chatId, user, text, userStates[userId]);
            return;
        }

        if (text === '/start') {
            bot.sendMessage(chatId, `স্বাগতম, ${user.name}! কী করতে চান?`, { reply_markup: getMainMenuKeyboard() });
        } else if (text === '/get_task') {
            await handleGetTask(chatId, user);
        } else if (text === '/my_stats') {
            await updateAndShowStats(chatId, user);
        } else if (!text.startsWith('/')) {
             bot.sendMessage(chatId, "অনুগ্রহ করে নিচের বাটনগুলো ব্যবহার করুন।");
        }

    } catch (error) {
        console.error(`Error in handleTextMessage: ${error}`);
        bot.sendMessage(chatId, "একটি সমস্যা হয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন।");
    }
}

// বাটন ক্লিক হ্যান্ডেল করার ফাংশন
async function handleCallbackQuery(callbackQuery) {
    const message = callbackQuery.message;
    const chatId = message.chat.id;
    const userId = callbackQuery.from.id;
    const data = callbackQuery.data;
    const messageId = message.message_id;

    try {
        const user = await findUser(userId);
        if (!user) {
            bot.answerCallbackQuery(callbackQuery.id, { text: 'অনুগ্রহ করে প্রথমে রেজিস্টার করুন।' });
            return;
        }

        if (data.startsWith('submit_phone_')) {
            const taskRow = data.split('_')[2];
            userStates[userId] = { state: 'awaiting_phone', row: taskRow, messageId: messageId };
            bot.sendMessage(chatId, "অনুগ্রহ করে ফোন নম্বরটি পাঠান।");
            bot.answerCallbackQuery(callbackQuery.id);
        } 
        else if (data.startsWith("reject_")) {
            const taskRow = data.split('_')[1];
            const rejectOptionsKeyboard = { inline_keyboard: [ [{ text: "🚫 Account Create Problem", callback_data: `confirm_reject_problem_${taskRow}` }], [{ text: "⏰ পরে করব (Do Later)", callback_data: `confirm_reject_later_${taskRow}` }], [{ text: "↩️  (Back) ", callback_data: `back_to_task_${taskRow}`}] ] };
            bot.editMessageText("আপনি কেন কাজটি বাতিল করতে চান?", { chat_id: chatId, message_id: messageId, reply_markup: rejectOptionsKeyboard });
        }
        else if (data.startsWith("confirm_reject_")) {
            const parts = data.split("_");
            const reason = parts[2];
            const taskRow = parts[3];
            const confirmationKeyboard = { inline_keyboard: [ [{ text: "✅ হ্যাঁ (Yes)", callback_data: `final_reject_${reason}_${taskRow}` }], [{ text: "❌ না (No)", callback_data: `back_to_task_${taskRow}` }] ] };
            bot.editMessageText("আপনি কি নিশ্চিত?", { chat_id: chatId, message_id: messageId, reply_markup: confirmationKeyboard });
        }
        else if (data.startsWith("final_reject_")) {
            const parts = data.split("_");
            const reason = parts[2];
            const taskRow = parts[3];
            await handleRejectTask(chatId, user, taskRow, reason, messageId);
        }
        else if (data.startsWith("back_to_task_")) {
            const taskRow = data.split("_")[3];
            const { workSheet } = await getSheets();
            const rows = await workSheet.getRows();
            const task = rows[parseInt(taskRow) - 2]; // 0-indexed and header row

            const message = `<b>আপনার নতুন কাজ (Row ${taskRow}):</b>\n\n<b>Email:</b> <code>${task.Email}</code>\n<b>Password:</b> <code>${task.Password}</code>\n<b>Recovery Mail:</b> <code>${task.Recovery}</code>\n\nকাজটি শেষ করে Talkatone থেকে পাওয়া ফোন নম্বরটি এখানে পাঠান।\nকাজটি করতে না পারলে 'বাতিল করুন' বাটনে ক্লিক করুন।`;
            const originalKeyboard = { inline_keyboard: [ [{ text: "✅ ফোন নম্বর জমা দিন", callback_data: `submit_phone_${taskRow}` }], [{ text: "❌ বাতিল করুন (Reject)", callback_data: `reject_${taskRow}` }] ] };
            bot.editMessageText(message, { chat_id: chatId, message_id: messageId, reply_markup: originalKeyboard, parse_mode: 'HTML' });
        }
        
        bot.answerCallbackQuery(callbackQuery.id); // ইউজারকে জানানো যে ক্লিক কাজ করেছে

    } catch (error) {
        console.error(`Error in handleCallbackQuery: ${error}`);
        bot.answerCallbackQuery(callbackQuery.id, { text: 'একটি সমস্যা হয়েছে।' });
    }
}


// ------ ৬. মূল ফাংশনগুলো (Node.js ফরম্যাটে) ------

async function handleGetTask(chatId, user) {
    const { workSheet } = await getSheets();
    const rows = await workSheet.getRows();

    // ব্যবহারকারীর কাছে কোনো অসমাপ্ত কাজ আছে কিনা চেক করা
    const existingTask = rows.find(row => row.AssignedTo === user.name && row.Status === 'Assigned');
    if (existingTask) {
        bot.sendMessage(chatId, "আপনার কাছে ইতিমধ্যে একটি কাজ অসমাপ্ত রয়েছে।");
        return;
    }

    // নতুন কাজ খুঁজে বের করা
    const availableTask = rows.find(row => row.Status === 'Available');
    if (availableTask) {
        availableTask.Status = 'Assigned';
        availableTask.AssignedTo = user.name;
        await availableTask.save(); // শীটে পরিবর্তন সেভ করা

        const taskRow = availableTask.rowIndex;
        const message = `<b>আপনার নতুন কাজ</b>\n\n` +
                        `<b>Email: </b> <code>${availableTask.Email}</code>\n` +
                        `<b>Password: </b> <code>${availableTask.Password}</code>\n` +
                        `<b>Recovery Mail:</b> <code>${availableTask.Recovery}</code>\n\n` +
                        `কাজটি শেষ করে Talkatone থেকে পাওয়া ফোন নম্বরটি এখানে পাঠান।\n` +
                        `কাজটি করতে না পারলে 'বাতিল করুন' বাটনে ক্লিক করুন।`;
        
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
    const taskRow = parseInt(row);

    const { workSheet, finalSheet } = await getSheets();
    const rows = await workSheet.getRows();
    const task = rows[taskRow - 2]; // 0-indexed and header row

    if (task && task.AssignedTo === user.name && task.Status === "Assigned") {
        task.Phone = trimmedPhoneNumber;
        task.Status = "Completed";
        await task.save();

        // Final Sheet আপডেট করা
        await updateFinalSheetOnSuccess(task.Email, task.Password, trimmedPhoneNumber);
        
        // Stats আপডেট করা
        await updateUserStats(user, 1);
        
        delete userStates[user.id];
        
        const taskDetails = `<b>কাজটি সম্পন্ন হয়েছে (Row ${taskRow}):</b>\n\n<b>Email:</b> <code>${task.Email}</code>\n<b>Password:</b> <code>${task.Password}</code>\n<b>Recovery Mail:</b> <code>${task.Recovery}</code>\n\n<b>জমাকৃত ফোন নম্বর:</b> <code>${trimmedPhoneNumber}</code>`;
        
        bot.editMessageText(taskDetails, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: {} });
        bot.sendMessage(chatId, `✅ ধন্যবাদ! কাজটি সফলভাবে জমা হয়েছে।`, { reply_markup: getMainMenuKeyboard() });
    } else {
        delete userStates[user.id];
        bot.sendMessage(chatId, "দুঃখিত, এই কাজটি জমা দেওয়ার সময় একটি সমস্যা হয়েছে।", { reply_markup: getMainMenuKeyboard() });
    }
}

async function handleRejectTask(chatId, user, rowToReject, reason, messageId) {
    const taskRow = parseInt(rowToReject);
    const { workSheet } = await getSheets();
    const rows = await workSheet.getRows();
    const task = rows[taskRow - 2]; // 0-indexed and header row

    if (task && task.Status === "Assigned" && task.AssignedTo === user.name) {
        let responseText = "";
        if (reason === "problem") {
            task.Status = "Rejected";
            await task.save();
            // রঙ করার পার্টটি google-spreadsheet দিয়ে সরাসরি করা জটিল, এটি আপাতত বাদ দেওয়া হলো
            responseText = `কাজটি (Row ${taskRow}) সফলভাবে বাতিল করা হয়েছে।`;
        } else if (reason === "later") {
            task.Status = "Available"; // স্ট্যাটাস পরিবর্তন করে Available করা
            task.AssignedTo = ""; // নাম মুছে ফেলা
            await task.save();
            responseText = `কাজটি আবার তালিকার শুরুতে যুক্ত করা হয়েছে।`;
        }
        bot.editMessageText(responseText, { chat_id: chatId, message_id: messageId });
        bot.sendMessage(chatId, "আপনার পরবর্তী কাজের জন্য প্রস্তুত।", { reply_markup: getMainMenuKeyboard() });
    } else {
        bot.editMessageText("এই কাজটি বাতিল করা সম্ভব নয়।", { chat_id: chatId, message_id: messageId });
    }
}


// ------ ৭. গুগল শীট নিয়ে কাজ করার হেল্পার ফাংশন ------

async function findUser(userId) {
    const { statsSheet } = await getSheets();
    const rows = await statsSheet.getRows();
    const userRow = rows.find(row => String(row.UserID) === String(userId));
    if (userRow) {
        return {
            row: userRow.rowIndex,
            id: userRow.UserID,
            name: userRow.UserName,
            total: parseInt(userRow.TotalCompleted) || 0,
            daily: parseInt(userRow.DailyCompleted) || 0,
            date: userRow.LastCompletedDate
        };
    }
    return null;
}

async function registerUser(userId, userName) {
    const { statsSheet } = await getSheets();
    await statsSheet.addRow({
        UserID: userId,
        UserName: userName,
        TotalCompleted: 0,
        DailyCompleted: 0,
        LastCompletedDate: ""
    });
}

async function updateUserStats(user, count) {
    const { statsSheet } = await getSheets();
    const rows = await statsSheet.getRows();
    const userRow = rows[user.row - 2]; // 0-indexed and header row

    const today = new Date();
    const todayStr = today.toISOString().split('T')[0]; // "YYYY-MM-DD"
    const lastDateStr = user.date ? new Date(user.date).toISOString().split('T')[0] : null;

    let dailyCount = parseInt(userRow.DailyCompleted) || 0;
    if (todayStr === lastDateStr) {
        dailyCount += count;
    } else {
        dailyCount = count;
    }

    userRow.TotalCompleted = (parseInt(userRow.TotalCompleted) || 0) + count;
    userRow.DailyCompleted = dailyCount;
    userRow.LastCompletedDate = today.toLocaleDateString('en-CA'); // YYYY-MM-DD format
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

async function updateFinalSheetOnSuccess(email, password, phoneNumber) {
    const { finalSheet } = await getSheets();
    const rows = await finalSheet.getRows();
    const taskRow = rows.find(row => row.Email === email && row.Password === password);
    if (taskRow) {
        taskRow.PhoneNumber = phoneNumber;
        await taskRow.save();
    }
}


// ------ ৮. অন্যান্য হেল্পার ফাংশন ------

function getMainMenuKeyboard() {
    return {
        inline_keyboard: [
            [{ text: "✅ নতুন কাজ নিন (Get Task)", callback_data: "/get_task" }],
            [{ text: "📊 আমার কাজের হিসাব (My Stats)", callback_data: "/my_stats" }]
        ]
    };
}


// ------ ৯. সার্ভার চালু করা ------
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Webhook is set to: ${webhookUrl}`);
});

// Sync function - (স্বয়ংক্রিয়ভাবে সিঙ্ক করার ফাংশন)
// Render-এ এটি Cron Job হিসেবে সেট করতে হবে
async function syncHabibaToWorkSheet() {
    try {
        const { finalSheet, workSheet } = await getSheets();
        
        const sourceRows = await finalSheet.getRows();
        const destRows = await workSheet.getRows();

        const sourceEmails = {};
        sourceRows.forEach(row => {
            if (row.Email && !row.PhoneNumber) {
                sourceEmails[row.Email] = { Email: row.Email, Password: row.Password, Recovery: row.Recovery };
            }
        });

        const destEmails = new Set(destRows.map(row => row.Email));
        
        const newTasksToAdd = [];
        for (const email in sourceEmails) {
            if (!destEmails.has(email)) {
                const task = sourceEmails[email];
                newTasksToAdd.push({
                    Email: task.Email,
                    Password: task.Password,
                    Recovery: task.Recovery,
                    Phone: "",
                    Status: "Available",
                    AssignedTo: ""
                });
            }
        }

        if (newTasksToAdd.length > 0) {
            await workSheet.addRows(newTasksToAdd);
            console.log(`${newTasksToAdd.length} new tasks added.`);
        }

        // ডিলিট করার প্রক্রিয়াটি জটিল এবং ঝুঁকিপূর্ণ হতে পারে, তাই সাবধানে করতে হবে
        // আপাতত এটি নিষ্ক্রিয় রাখা হলো যাতে কোনো ডেটা ভুলবশত মুছে না যায়
        console.log('Sync completed.');

    } catch (err) {
        console.error(`Error in syncHabibaToWorkSheet: ${err}`);
    }
}