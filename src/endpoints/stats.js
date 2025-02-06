import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import express from 'express';
import writeFileAtomic from 'write-file-atomic';

const readFile = fs.promises.readFile;
const readdir = fs.promises.readdir;

import { jsonParser } from '../express-common.js';
import { getAllUserHandles, getUserDirectories } from '../users.js';

const STATS_FILE = 'stats.json';

/**
 * @type {Map<string, Object>} The stats object for each user.
 */
const STATS = new Map();
/**
 * @type {Map<string, number>} The timestamps for each user.
 */
const TIMESTAMPS = new Map();

/**
 * Convert a timestamp to an integer timestamp.
 * (sorry, it's momentless for now, didn't want to add a package just for this)
 * This function can handle several different timestamp formats:
 * 1. Unix timestamps (the number of seconds since the Unix Epoch)
 * 2. ST "humanized" timestamps, formatted like "YYYY-MM-DD @HHh MMm SSs ms"
 * 3. Date strings in the format "Month DD, YYYY H:MMam/pm"
 *
 * The function returns the timestamp as the number of milliseconds since
 * the Unix Epoch, which can be converted to a JavaScript Date object with new Date().
 *
 * @param {string|number} timestamp - The timestamp to convert.
 * @returns {number} The timestamp in milliseconds since the Unix Epoch, or 0 if the input cannot be parsed.
 *
 * @example
 * // Unix timestamp
 * timestampToMoment(1609459200);
 * // ST humanized timestamp
 * timestampToMoment("2021-01-01 \@00h 00m 00s 000ms");
 * // Date string
 * timestampToMoment("January 1, 2021 12:00am");
 */
function timestampToMoment(timestamp) {
    if (!timestamp) {
        return 0;
    }

    if (typeof timestamp === 'number') {
        return timestamp;
    }

    const pattern1 =
        /(\d{4})-(\d{1,2})-(\d{1,2}) @(\d{1,2})h (\d{1,2})m (\d{1,2})s (\d{1,3})ms/;
    const replacement1 = (
        match,
        year,
        month,
        day,
        hour,
        minute,
        second,
        millisecond,
    ) => {
        return `${year}-${month.padStart(2, '0')}-${day.padStart(
            2,
            '0',
        )}T${hour.padStart(2, '0')}:${minute.padStart(
            2,
            '0',
        )}:${second.padStart(2, '0')}.${millisecond.padStart(3, '0')}Z`;
    };
    const isoTimestamp1 = timestamp.replace(pattern1, replacement1);
    if (!isNaN(Number(new Date(isoTimestamp1)))) {
        return new Date(isoTimestamp1).getTime();
    }

    const pattern2 = /(\w+)\s(\d{1,2}),\s(\d{4})\s(\d{1,2}):(\d{1,2})(am|pm)/i;
    const replacement2 = (match, month, day, year, hour, minute, meridiem) => {
        const monthNames = [
            'January',
            'February',
            'March',
            'April',
            'May',
            'June',
            'July',
            'August',
            'September',
            'October',
            'November',
            'December',
        ];
        const monthNum = monthNames.indexOf(month) + 1;
        const hour24 =
            meridiem.toLowerCase() === 'pm'
                ? (parseInt(hour, 10) % 12) + 12
                : parseInt(hour, 10) % 12;
        return `${year}-${monthNum.toString().padStart(2, '0')}-${day.padStart(
            2,
            '0',
        )}T${hour24.toString().padStart(2, '0')}:${minute.padStart(
            2,
            '0',
        )}:00Z`;
    };
    const isoTimestamp2 = timestamp.replace(pattern2, replacement2);
    if (!isNaN(Number(new Date(isoTimestamp2)))) {
        return new Date(isoTimestamp2).getTime();
    }

    return 0;
}

/**
 * Collects and aggregates stats for all characters.
 *
 * @param {string} chatsPath - The path to the directory containing the chat files.
 * @param {string} charactersPath - The path to the directory containing the character files.
 * @returns {Promise<Object>} The aggregated stats object.
 */
async function collectAndCreateStats(chatsPath, charactersPath) {
    const files = await readdir(charactersPath);

    const pngFiles = files.filter((file) => file.endsWith('.png'));

    let processingPromises = pngFiles.map((file) =>
        calculateStats(chatsPath, file),
    );
    const statsArr = await Promise.all(processingPromises);

    let finalStats = {};
    for (let stat of statsArr) {
        finalStats = { ...finalStats, ...stat };
    }
    // tag with timestamp on when stats were generated
    finalStats.timestamp = Date.now();
    return finalStats;
}

/**
 * Recreates the stats object for a user.
 * @param {string} handle User handle
 * @param {string} chatsPath Path to the directory containing the chat files.
 * @param {string} charactersPath Path to the directory containing the character files.
 */
export async function recreateStats(handle, chatsPath, charactersPath) {
    console.log('Collecting and creating stats for user:', handle);
    const stats = await collectAndCreateStats(chatsPath, charactersPath);
    STATS.set(handle, stats);
    await saveStatsToFile();
}

/**
 * Loads the stats file into memory. If the file doesn't exist or is invalid,
 * initializes stats by collecting and creating them for each character.
 */
export async function init() {
    try {
        const userHandles = await getAllUserHandles();
        for (const handle of userHandles) {
            const directories = getUserDirectories(handle);
            try {
                const statsFilePath = path.join(directories.root, STATS_FILE);
                const statsFileContent = await readFile(statsFilePath, 'utf-8');
                STATS.set(handle, JSON.parse(statsFileContent));
            } catch (err) {
                // If the file doesn't exist or is invalid, initialize stats
                if (err.code === 'ENOENT' || err instanceof SyntaxError) {
                    await recreateStats(handle, directories.chats, directories.characters);
                } else {
                    throw err; // Rethrow the error if it's something we didn't expect
                }
            }
        }
    } catch (err) {
        console.error('Failed to initialize stats:', err);
    }
    // Save stats every 5 minutes
    setInterval(saveStatsToFile, 5 * 60 * 1000);
}
/**
 * Saves the current state of charStats to a file, only if the data has changed since the last save.
 */
async function saveStatsToFile() {
    const userHandles = await getAllUserHandles();
    for (const handle of userHandles) {
        if (!STATS.has(handle)) {
            continue;
        }
        const charStats = STATS.get(handle);
        const lastSaveTimestamp = TIMESTAMPS.get(handle) || 0;
        if (charStats.timestamp > lastSaveTimestamp) {
            try {
                const directories = getUserDirectories(handle);
                const statsFilePath = path.join(directories.root, STATS_FILE);
                await writeFileAtomic(statsFilePath, JSON.stringify(charStats));
                TIMESTAMPS.set(handle, Date.now());
            } catch (error) {
                console.log('Failed to save stats to file.', error);
            }
        }
    }
}

/**
 * Attempts to save charStats to a file and then terminates the process.
 * If an error occurs during the file write, it logs the error before exiting.
 */
export async function onExit() {
    try {
        await saveStatsToFile();
    } catch (err) {
        console.error('Failed to write stats to file:', err);
    }
}

/**
 * Reads the contents of a file and returns the lines in the file as an array.
 *
 * @param {string} filepath - The path of the file to be read.
 * @returns {Array<string>} - The lines in the file.
 * @throws Will throw an error if the file cannot be read.
 */
function readAndParseFile(filepath) {
    try {
        let file = fs.readFileSync(filepath, 'utf8');
        let lines = file.split('\n');
        return lines;
    } catch (error) {
        console.error(`Error reading file at ${filepath}: ${error}`);
        return [];
    }
}

/**
 * Calculates the time difference between two dates.
 *
 * @param {string} gen_started - The start time in ISO 8601 format.
 * @param {string} gen_finished - The finish time in ISO 8601 format.
 * @returns {number} - The difference in time in milliseconds.
 */
function calculateGenTime(gen_started, gen_finished) {
    let startDate = new Date(gen_started);
    let endDate = new Date(gen_finished);
    return Number(endDate) - Number(startDate);
}

/**
 * Counts the number of words in a string.
 *
 * @param {string} str - The string to count words in.
 * @returns {number} - The number of words in the string.
 */
function countWordsInString(str) {
    const match = str.match(/\b\w+\b/g);
    return match ? match.length : 0;
}

/**
 * calculateStats - Calculate statistics for a given character chat directory.
 *
 * @param  {string} chatsPath The directory containing the chat files.
 * @param  {string} item     The name of the character.
 * @return {object}          An object containing the calculated statistics.
 */
const calculateStats = (chatsPath, item) => {
    const chatDir = path.join(chatsPath, item.replace('.png', ''));
    const stats = {
        total_gen_time: 0,
        user_word_count: 0,
        non_user_word_count: 0,
        user_msg_count: 0,
        non_user_msg_count: 0,
        total_swipe_count: 0,
        chat_size: 0,
        date_last_chat: 0,
        date_first_chat: new Date('9999-12-31T23:59:59.999Z').getTime(),
    };
    let uniqueGenStartTimes = new Set();

    if (fs.existsSync(chatDir)) {
        const chats = fs.readdirSync(chatDir);
        if (Array.isArray(chats) && chats.length) {
            for (const chat of chats) {
                const result = calculateTotalGenTimeAndWordCount(
                    chatDir,
                    chat,
                    uniqueGenStartTimes,
                );
                stats.total_gen_time += result.totalGenTime || 0;
                stats.user_word_count += result.userWordCount || 0;
                stats.non_user_word_count += result.nonUserWordCount || 0;
                stats.user_msg_count += result.userMsgCount || 0;
                stats.non_user_msg_count += result.nonUserMsgCount || 0;
                stats.total_swipe_count += result.totalSwipeCount || 0;

                const chatStat = fs.statSync(path.join(chatDir, chat));
                stats.chat_size += chatStat.size;
                stats.date_last_chat = Math.max(
                    stats.date_last_chat,
                    Math.floor(chatStat.mtimeMs),
                );
                stats.date_first_chat = Math.min(
                    stats.date_first_chat,
                    result.firstChatTime,
                );
            }
        }
    }

    return { [item]: stats };
};

/**
 * Sets the current charStats object.
 * @param {string} handle - The user handle.
 * @param {Object} stats - The new charStats object.
 **/
function setCharStats(handle, stats) {
    stats.timestamp = Date.now();
    STATS.set(handle, stats);
}

/**
 * Calculates the total generation time and word count for a chat with a character.
 *
 * @param {string} chatDir - The directory path where character chat files are stored.
 * @param {string} chat - The name of the chat file.
 * @returns {Object} - An object containing the total generation time, user word count, and non-user word count.
 * @throws Will throw an error if the file cannot be read or parsed.
 */
function calculateTotalGenTimeAndWordCount(
    chatDir,
    chat,
    uniqueGenStartTimes,
) {
    let filepath = path.join(chatDir, chat);
    let lines = readAndParseFile(filepath);

    let totalGenTime = 0;
    let userWordCount = 0;
    let nonUserWordCount = 0;
    let nonUserMsgCount = 0;
    let userMsgCount = 0;
    let totalSwipeCount = 0;
    let firstChatTime = new Date('9999-12-31T23:59:59.999Z').getTime();

    for (let line of lines) {
        if (line.length) {
            try {
                let json = JSON.parse(line);
                if (json.mes) {
                    let hash = crypto
                        .createHash('sha256')
                        .update(json.mes)
                        .digest('hex');
                    if (uniqueGenStartTimes.has(hash)) {
                        continue;
                    }
                    if (hash) {
                        uniqueGenStartTimes.add(hash);
                    }
                }

                if (json.gen_started && json.gen_finished) {
                    let genTime = calculateGenTime(
                        json.gen_started,
                        json.gen_finished,
                    );
                    totalGenTime += genTime;

                    if (json.swipes && !json.swipe_info) {
                        // If there are swipes but no swipe_info, estimate the genTime
                        totalGenTime += genTime * json.swipes.length;
                    }
                }

                if (json.mes) {
                    let wordCount = countWordsInString(json.mes);
                    json.is_user
                        ? (userWordCount += wordCount)
                        : (nonUserWordCount += wordCount);
                    json.is_user ? userMsgCount++ : nonUserMsgCount++;
                }

                if (json.swipes && json.swipes.length > 1) {
                    totalSwipeCount += json.swipes.length - 1; // Subtract 1 to not count the first swipe
                    for (let i = 1; i < json.swipes.length; i++) {
                        // Start from the second swipe
                        let swipeText = json.swipes[i];

                        let wordCount = countWordsInString(swipeText);
                        json.is_user
                            ? (userWordCount += wordCount)
                            : (nonUserWordCount += wordCount);
                        json.is_user ? userMsgCount++ : nonUserMsgCount++;
                    }
                }

                if (json.swipe_info && json.swipe_info.length > 1) {
                    for (let i = 1; i < json.swipe_info.length; i++) {
                        // Start from the second swipe
                        let swipe = json.swipe_info[i];
                        if (swipe.gen_started && swipe.gen_finished) {
                            totalGenTime += calculateGenTime(
                                swipe.gen_started,
                                swipe.gen_finished,
                            );
                        }
                    }
                }

                // If this is the first user message, set the first chat time
                if (json.is_user) {
                    //get min between firstChatTime and timestampToMoment(json.send_date)
                    firstChatTime = Math.min(timestampToMoment(json.send_date), firstChatTime);
                }
            } catch (error) {
                console.error(`Error parsing line ${line}: ${error}`);
            }
        }
    }
    return {
        totalGenTime,
        userWordCount,
        nonUserWordCount,
        userMsgCount,
        nonUserMsgCount,
        totalSwipeCount,
        firstChatTime,
    };
}

export const router = express.Router();

/**
 * Handle a POST request to get the stats object
 */
router.post('/get', jsonParser, function (request, response) {
    const stats = STATS.get(request.user.profile.handle) || {};
    response.send(stats);
});

/**
 * Triggers the recreation of statistics from chat files.
 */
router.post('/recreate', jsonParser, async function (request, response) {
    try {
        await recreateStats(request.user.profile.handle, request.user.directories.chats, request.user.directories.characters);
        return response.sendStatus(200);
    } catch (error) {
        console.error(error);
        return response.sendStatus(500);
    }
});

/**
 * Handle a POST request to update the stats object
*/
router.post('/update', jsonParser, function (request, response) {
    if (!request.body) return response.sendStatus(400);
    setCharStats(request.user.profile.handle, request.body);
    return response.sendStatus(200);
});
