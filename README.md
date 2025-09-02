# TalkaTone Task Bot

A high-performance, Telegram-based bot designed to distribute tasks from Google Sheets, manage users, and track work statistics. This bot is built with Node.js and hosted on Render for fast response times, while utilizing Google Apps Script for background data synchronization.

## 📜 Description (English)

This project is a hybrid solution that leverages the power of a Node.js backend for real-time user interaction and Google Apps Script (GAS) for reliable, scheduled data management. The bot serves tasks (like Email and Password pairs) to authorized users, collects results (phone numbers), and maintains detailed statistics, all managed through a set of interconnected Google Sheets.

The system is highly optimized with a dual-caching mechanism (for tasks and users) and an asynchronous "fire-and-forget" model for task assignment, ensuring an instant user experience.


## 📜 বিবরণ (বাংলা)

এটি একটি উচ্চ-পারফরম্যান্স টেলিগ্রাম বট যা গুগল শীট থেকে কাজ বিতরণ, ব্যবহারকারী পরিচালনা এবং কাজের পরিসংখ্যান ট্র্যাক করার জন্য ডিজাইন করা হয়েছে। বটটি Node.js দিয়ে তৈরি এবং দ্রুত প্রতিক্রিয়ার জন্য Render-এ হোস্ট করা হয়েছে, যখন নির্ভরযোগ্য ডেটা ম্যানেজমেন্টের জন্য ব্যাকগ্রাউন্ডে Google Apps Script ব্যবহার করা হয়।

এই প্রকল্পটি একটি হাইব্রিড সলিউশন যা ব্যবহারকারীর সাথে রিয়েল-টাইম যোগাযোগের জন্য Node.js ব্যাকএন্ড এবং নির্ধারিত ডেটা ম্যানেজমেন্টের জন্য Google Apps Script (GAS)-এর শক্তিকে কাজে লাগায়। বটটি অনুমোদিত ব্যবহারকারীদের কাজ (যেমন ইমেল এবং পাসওয়ার্ড) প্রদান করে, ফলাফল (ফোন নম্বর) সংগ্রহ করে এবং বিস্তারিত পরিসংখ্যান বজায় রাখে, যা কয়েকটি আন্তঃসংযুক্ত গুগল শীটের মাধ্যমে পরিচালিত হয়।

সিস্টেমটি একটি ডুয়াল-ক্যাশিং মেকানিজম (কাজ এবং ব্যবহারকারীদের জন্য) এবং কাজ বিতরণের জন্য একটি অ্যাসিঙ্ক্রোনাস "ফায়ার এন্ড ফরগেট" মডেলের সাথে সর্বোচ্চ অপটিমাইজ করা হয়েছে, যা ব্যবহারকারীদের জন্য একটি তাৎক্ষণিক অভিজ্ঞতা নিশ্চিত করে।



## Features: 

* Instant Response Time: Utilizes an in-memory caching system for tasks and users, minimizing API calls to Google Sheets.
* Access Control System:  Only admin-approved users can interact with the bot and receive tasks.
* Telegram-Based Admin Panel: Admins can approve or revoke user access directly from the Telegram chat interface without needing to open Google Sheets.
* Hybrid Data Sync: Google Apps Script handles robust background data synchronization from a master sheet to the work sheet, including adding new tasks and cleaning up completed/deleted ones.
* Live Task Counter: Displays a live `(x/y)` counter with each task, showing the number of completed tasks versus the total available tasks for the day.
* Asynchronous Task Assignment: Users receive tasks instantly, while the slower database (Google Sheets) updates happen in the background.
* Admin Notifications: The admin receives an instant notification on Telegram whenever a new user registers.



## Tech Stack & Architecture :

*   Bot Backend                  : Node.js, Express.js
*   Hosting                      : Render (Web Service)
*   Database                     : Google Sheets
*   Background Automation        : Google Apps Script (Time-driven Triggers)
*   Telegram API Integration     : `node-telegram-bot-api`
*   Google Sheets Integration    : `google-spreadsheet`

---

## 🚀 How to Set Up

1.  **Clone the Repository:**
    ```bash
    git clone [your-repository-url]
    cd [repository-folder]
    ```

2.  **Install Dependencies:**
    ```bash
    npm install
    ```

3.  **Google Sheets Setup:**
    *   Create three Google Sheets: a **Master Sheet** , a **Work Sheet**, and a **User Stats Sheet**.
    *   Set up the required columns in each sheet as per the code's logic.
    *   Create a **"Stats"** tab inside the **Work Sheet** for the `x/y` counter.

4.  **Google Cloud & Apps Script:**
    *   Set up a Google Cloud Platform (GCP) project and enable the **Google Sheets API** and **Google Drive API**.
    *   Create a Service Account, generate a `credentials.json` key, and share all three Google Sheets with the `client_email` as an **Editor**.
    *   Deploy the Google Apps Script code to your project and set up a time-driven trigger to run the main sync function every 5 minutes.

5.  **Environment Variables:**
    *   Create a `.env` file in the root directory.
    *   Add the following variables:
        ```env
        TELEGRAM_BOT_TOKEN=your_bot_token
        WORK_SHEET_ID=your_work_sheet_id
        STATS_SHEET_ID=your_user_stats_sheet_id
        ADMIN_USER_ID=your_telegram_user_id
        SERVER_URL=your_render_service_url
        ```

6.  **Deploy to Render:**
    *   Push the code to a private GitHub repository.
    *   Create a new **Web Service** on Render, connecting it to your GitHub repository.
    *   Set the **Start Command** to `node index.js`.
    *   Add the environment variables from your `.env` file to the Render service's environment settings.
    *   Add the contents of `credentials.json` as a **Secret File** in Render.

---

## 📄 License

This project is private and intended for personal use.
