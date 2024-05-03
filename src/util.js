const path = require('path');
const fs = require('fs');
const commandExistsSync = require('command-exists').sync;
const writeFileAtomicSync = require('write-file-atomic').sync;
const _ = require('lodash');
const yauzl = require('yauzl');
const mime = require('mime-types');
const yaml = require('yaml');
const { default: simpleGit } = require('simple-git');
const { Readable } = require('stream');

const { PUBLIC_DIRECTORIES } = require('./constants');

/**
 * Parsed config object.
 */
let CACHED_CONFIG = null;

/**
 * Returns the config object from the config.yaml file.
 * @returns {object} Config object
 */
function getConfig() {
    if (CACHED_CONFIG) {
        return CACHED_CONFIG;
    }

    if (!fs.existsSync('./config.yaml')) {
        console.error(color.red('No config file found. Please create a config.yaml file. The default config file can be found in the /default folder.'));
        console.error(color.red('The program will now exit.'));
        process.exit(1);
    }

    try {
        const config = yaml.parse(fs.readFileSync(path.join(process.cwd(), './config.yaml'), 'utf8'));
        CACHED_CONFIG = config;
        return config;
    } catch (error) {
        console.warn('Failed to read config.yaml');
        return {};
    }
}

/**
 * Returns the value for the given key from the config object.
 * @param {string} key - Key to get from the config object
 * @param {any} defaultValue - Default value to return if the key is not found
 * @returns {any} Value for the given key
 */
function getConfigValue(key, defaultValue = null) {
    const config = getConfig();
    return _.get(config, key, defaultValue);
}

/**
 * Sets a value for the given key in the config object and writes it to the config.yaml file.
 * @param {string} key Key to set
 * @param {any} value Value to set
 */
function setConfigValue(key, value) {
    // Reset cache so that the next getConfig call will read the updated config file
    CACHED_CONFIG = null;
    const config = getConfig();
    _.set(config, key, value);
    writeFileAtomicSync('./config.yaml', yaml.stringify(config));
}

/**
 * Encodes the Basic Auth header value for the given user and password.
 * @param {string} auth username:password
 * @returns {string} Basic Auth header value
 */
function getBasicAuthHeader(auth) {
    const encoded = Buffer.from(`${auth}`).toString('base64');
    return `Basic ${encoded}`;
}

/**
 * Returns the version of the running instance. Get the version from the package.json file and the git revision.
 * Also returns the agent string for the Horde API.
 * @returns {Promise<{agent: string, pkgVersion: string, gitRevision: string | null, gitBranch: string | null, commitDate: string | null, isLatest: boolean}>} Version info object
 */
async function getVersion() {
    let pkgVersion = 'UNKNOWN';
    let gitRevision = null;
    let gitBranch = null;
    let commitDate = null;
    let isLatest = true;

    try {
        const pkgJson = require(path.join(process.cwd(), './package.json'));
        pkgVersion = pkgJson.version;
        if (!process['pkg'] && commandExistsSync('git')) {
            const git = simpleGit();
            const cwd = process.cwd();
            gitRevision = await git.cwd(cwd).revparse(['--short', 'HEAD']);
            gitBranch = await git.cwd(cwd).revparse(['--abbrev-ref', 'HEAD']);
            commitDate = await git.cwd(cwd).show(['-s', '--format=%ci', gitRevision]);

            const trackingBranch = await git.cwd(cwd).revparse(['--abbrev-ref', '@{u}']);

            // Might fail, but exception is caught. Just don't run anything relevant after in this block...
            const localLatest = await git.cwd(cwd).revparse(['HEAD']);
            const remoteLatest = await git.cwd(cwd).revparse([trackingBranch]);
            isLatest = localLatest === remoteLatest;
        }
    }
    catch {
        // suppress exception
    }

    const agent = `SillyTavern:${pkgVersion}:Cohee#1207`;
    return { agent, pkgVersion, gitRevision, gitBranch, commitDate: commitDate?.trim() ?? null, isLatest };
}

/**
 * Delays the current async function by the given amount of milliseconds.
 * @param {number} ms Milliseconds to wait
 * @returns {Promise<void>} Promise that resolves after the given amount of milliseconds
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Generates a random hex string of the given length.
 * @param {number} length String length
 * @returns {string} Random hex string
 * @example getHexString(8) // 'a1b2c3d4'
 */
function getHexString(length) {
    const chars = '0123456789abcdef';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
}

/**
 * Extracts a file with given extension from an ArrayBuffer containing a ZIP archive.
 * @param {ArrayBuffer} archiveBuffer Buffer containing a ZIP archive
 * @param {string} fileExtension File extension to look for
 * @returns {Promise<Buffer>} Buffer containing the extracted file
 */
async function extractFileFromZipBuffer(archiveBuffer, fileExtension) {
    return await new Promise((resolve, reject) => yauzl.fromBuffer(Buffer.from(archiveBuffer), { lazyEntries: true }, (err, zipfile) => {
        if (err) {
            reject(err);
        }

        zipfile.readEntry();
        zipfile.on('entry', (entry) => {
            if (entry.fileName.endsWith(fileExtension)) {
                console.log(`Extracting ${entry.fileName}`);
                zipfile.openReadStream(entry, (err, readStream) => {
                    if (err) {
                        reject(err);
                    } else {
                        const chunks = [];
                        readStream.on('data', (chunk) => {
                            chunks.push(chunk);
                        });

                        readStream.on('end', () => {
                            const buffer = Buffer.concat(chunks);
                            resolve(buffer);
                            zipfile.readEntry(); // Continue to the next entry
                        });
                    }
                });
            } else {
                zipfile.readEntry();
            }
        });
    }));
}

/**
 * Extracts all images from a ZIP archive.
 * @param {string} zipFilePath Path to the ZIP archive
 * @returns {Promise<[string, Buffer][]>} Array of image buffers
 */
async function getImageBuffers(zipFilePath) {
    return new Promise((resolve, reject) => {
        // Check if the zip file exists
        if (!fs.existsSync(zipFilePath)) {
            reject(new Error('File not found'));
            return;
        }

        const imageBuffers = [];

        yauzl.open(zipFilePath, { lazyEntries: true }, (err, zipfile) => {
            if (err) {
                reject(err);
            } else {
                zipfile.readEntry();
                zipfile.on('entry', (entry) => {
                    const mimeType = mime.lookup(entry.fileName);
                    if (mimeType && mimeType.startsWith('image/') && !entry.fileName.startsWith('__MACOSX')) {
                        console.log(`Extracting ${entry.fileName}`);
                        zipfile.openReadStream(entry, (err, readStream) => {
                            if (err) {
                                reject(err);
                            } else {
                                const chunks = [];
                                readStream.on('data', (chunk) => {
                                    chunks.push(chunk);
                                });

                                readStream.on('end', () => {
                                    imageBuffers.push([path.parse(entry.fileName).base, Buffer.concat(chunks)]);
                                    zipfile.readEntry(); // Continue to the next entry
                                });
                            }
                        });
                    } else {
                        zipfile.readEntry(); // Continue to the next entry
                    }
                });

                zipfile.on('end', () => {
                    resolve(imageBuffers);
                });

                zipfile.on('error', (err) => {
                    reject(err);
                });
            }
        });
    });
}

/**
 * Reads the contents of a .jsonl file and returns the lines parsed as json as an array
 *
 * @param {string} filepath - The path of the file to be read
 * @returns {object[]} - The lines in the file
 * @throws Will throw an error if the file cannot be read
 */
function readAndParseJsonlFile(filepath) {
    try {
        // Copied from /chat/get endpoint
        const data = fs.readFileSync(filepath, 'utf8');
        const lines = data.split('\n');

        // Iterate through the array of strings and parse each line as JSON
        const jsonData = lines.map((l) => { try { return JSON.parse(l); } catch (_) { return; } }).filter(x => x);
        return jsonData;
    } catch (error) {
        console.error(`Error reading file at ${filepath}: ${error}`);
        return [];
    }
}

/**
 * Parse JSON data with optional reviver function.
 * Converts date strings back to Date objects if found.
 *
 * @param {string} json - The JSON data to parse
 * @param {object} [options] - Optional parameters
 * @param {Reviver?} [options.reviver=null] - Custom reviver function to customize parsing
 * @param {boolean} [options.disableDefaultReviver=false] - Flag to disable the default date parsing reviver
 * @returns {object} - The parsed JSON object
 */
function parseJson(json, { reviver = null, disableDefaultReviver = false } = {}) {
    /**
     * @typedef {((this: any, key: string, value: any) => any)} Reviver
     * @param {object} this -
     * @param {string} key - The key of the current property being processed
     * @param {*} value - The value of the current property being processed
     * @returns {*} - The processed value
     */

    /** @type {Reviver} The default reviver, that converts Date strings to Date objects */
    function defaultReviver(key, value) {
        // Check if the value is a string and can be converted to a Date
        if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(value)) {
            return new Date(value);
        }
        // Return the original value if it's not a date string
        return value;
    }

    // The actual reviver based on the ones given
    /** @type {Reviver} */
    function actualReviver(key, value) {
        if (reviver) value = reviver(key, value);
        if (!disableDefaultReviver) value = defaultReviver(key, value);
        return value;
    };

    // Parse the JSON data using the specified or custom reviver function
    return JSON.parse(json, actualReviver);
}

/**
 * Gets all chunks of data from the given readable stream.
 * @param {any} readableStream Readable stream to read from
 * @returns {Promise<Buffer[]>} Array of chunks
 */
async function readAllChunks(readableStream) {
    return new Promise((resolve, reject) => {
        // Consume the readable stream
        const chunks = [];
        readableStream.on('data', (chunk) => {
            chunks.push(chunk);
        });

        readableStream.on('end', () => {
            //console.log('Finished reading the stream.');
            resolve(chunks);
        });

        readableStream.on('error', (error) => {
            console.error('Error while reading the stream:', error);
            reject();
        });
    });
}

function isObject(item) {
    return (item && typeof item === 'object' && !Array.isArray(item));
}

function deepMerge(target, source) {
    let output = Object.assign({}, target);
    if (isObject(target) && isObject(source)) {
        Object.keys(source).forEach(key => {
            if (isObject(source[key])) {
                if (!(key in target))
                    Object.assign(output, { [key]: source[key] });
                else
                    output[key] = deepMerge(target[key], source[key]);
            } else {
                Object.assign(output, { [key]: source[key] });
            }
        });
    }
    return output;
}

const color = {
    byNum: (mess, fgNum) => {
        mess = mess || '';
        fgNum = fgNum === undefined ? 31 : fgNum;
        return '\u001b[' + fgNum + 'm' + mess + '\u001b[39m';
    },
    black: (mess) => color.byNum(mess, 30),
    red: (mess) => color.byNum(mess, 31),
    green: (mess) => color.byNum(mess, 32),
    yellow: (mess) => color.byNum(mess, 33),
    blue: (mess) => color.byNum(mess, 34),
    magenta: (mess) => color.byNum(mess, 35),
    cyan: (mess) => color.byNum(mess, 36),
    white: (mess) => color.byNum(mess, 37),
};

function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function humanizedISO8601DateTime(date) {
    let baseDate = typeof date === 'number' ? new Date(date) : new Date();
    let humanYear = baseDate.getFullYear();
    let humanMonth = (baseDate.getMonth() + 1);
    let humanDate = baseDate.getDate();
    let humanHour = (baseDate.getHours() < 10 ? '0' : '') + baseDate.getHours();
    let humanMinute = (baseDate.getMinutes() < 10 ? '0' : '') + baseDate.getMinutes();
    let humanSecond = (baseDate.getSeconds() < 10 ? '0' : '') + baseDate.getSeconds();
    let humanMillisecond = (baseDate.getMilliseconds() < 10 ? '0' : '') + baseDate.getMilliseconds();
    let HumanizedDateTime = (humanYear + '-' + humanMonth + '-' + humanDate + ' @' + humanHour + 'h ' + humanMinute + 'm ' + humanSecond + 's ' + humanMillisecond + 'ms');
    return HumanizedDateTime;
}

function tryParse(str) {
    try {
        return JSON.parse(str);
    } catch {
        return undefined;
    }
}

/**
 * Takes a path to a client-accessible file in the data folder and converts it to a relative URL segment that the
 * client can fetch it from. This involves stripping the data root path prefix and always using `/` as the separator.
 * @param {string} root The root directory of the user data folder.
 * @param {string} inputPath The path to be converted.
 * @returns The relative URL path from which the client can access the file.
 */
function clientRelativePath(root, inputPath) {
    if (!inputPath.startsWith(root)) {
        throw new Error('Input path does not start with the root directory');
    }

    return inputPath.slice(root.length).split(path.sep).join('/');
}

/**
 * Strip the last file extension from a given file name. If there are multiple extensions, only the last is removed.
 * @param {string} filename The file name to remove the extension from.
 * @returns The file name, sans extension
 */
function removeFileExtension(filename) {
    return filename.replace(/\.[^.]+$/, '');
}

function generateTimestamp() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');

    return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

/**
 * @param {string} prefix
 */
function removeOldBackups(prefix) {
    const MAX_BACKUPS = 50;

    let files = fs.readdirSync(PUBLIC_DIRECTORIES.backups).filter(f => f.startsWith(prefix));
    if (files.length > MAX_BACKUPS) {
        files = files.map(f => path.join(PUBLIC_DIRECTORIES.backups, f));
        files.sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs);

        fs.rmSync(files[0]);
    }
}

function getImages(path) {
    return fs
        .readdirSync(path)
        .filter(file => {
            const type = mime.lookup(file);
            return type && type.startsWith('image/');
        })
        .sort(Intl.Collator().compare);
}

/**
 * Pipe a fetch() response to an Express.js Response, including status code.
 * @param {import('node-fetch').Response} from The Fetch API response to pipe from.
 * @param {import('express').Response} to The Express response to pipe to.
 */
function forwardFetchResponse(from, to) {
    let statusCode = from.status;
    let statusText = from.statusText;

    if (!from.ok) {
        console.log(`Streaming request failed with status ${statusCode} ${statusText}`);
    }

    // Avoid sending 401 responses as they reset the client Basic auth.
    // This can produce an interesting artifact as "400 Unauthorized", but it's not out of spec.
    // https://www.rfc-editor.org/rfc/rfc9110.html#name-overview-of-status-codes
    // "The reason phrases listed here are only recommendations -- they can be replaced by local
    //  equivalents or left out altogether without affecting the protocol."
    if (statusCode === 401) {
        statusCode = 400;
    }

    to.statusCode = statusCode;
    to.statusMessage = statusText;
    from.body.pipe(to);

    to.socket.on('close', function () {
        if (from.body instanceof Readable) from.body.destroy(); // Close the remote stream
        to.end(); // End the Express response
    });

    from.body.on('end', function () {
        console.log('Streaming request finished');
        to.end();
    });
}

/**
 * Makes an HTTP/2 request to the specified endpoint.
 *
 * @deprecated Use `node-fetch` if possible.
 * @param {string} endpoint URL to make the request to
 * @param {string} method HTTP method to use
 * @param {string} body Request body
 * @param {object} headers Request headers
 * @returns {Promise<string>} Response body
 */
function makeHttp2Request(endpoint, method, body, headers) {
    return new Promise((resolve, reject) => {
        try {
            const http2 = require('http2');
            const url = new URL(endpoint);
            const client = http2.connect(url.origin);

            const req = client.request({
                ':method': method,
                ':path': url.pathname,
                ...headers,
            });
            req.setEncoding('utf8');

            req.on('response', (headers) => {
                const status = Number(headers[':status']);

                if (status < 200 || status >= 300) {
                    reject(new Error(`Request failed with status ${status}`));
                }

                let data = '';

                req.on('data', (chunk) => {
                    data += chunk;
                });

                req.on('end', () => {
                    console.log(data);
                    resolve(data);
                });
            });

            req.on('error', (err) => {
                reject(err);
            });

            if (body) {
                req.write(body);
            }

            req.end();
        } catch (e) {
            reject(e);
        }
    });
}

/**
 * Adds YAML-serialized object to the object.
 * @param {object} obj Object
 * @param {string} yamlString YAML-serialized object
 * @returns
 */
function mergeObjectWithYaml(obj, yamlString) {
    if (!yamlString) {
        return;
    }

    try {
        const parsedObject = yaml.parse(yamlString);

        if (Array.isArray(parsedObject)) {
            for (const item of parsedObject) {
                if (typeof item === 'object' && item && !Array.isArray(item)) {
                    Object.assign(obj, item);
                }
            }
        }
        else if (parsedObject && typeof parsedObject === 'object') {
            Object.assign(obj, parsedObject);
        }
    } catch {
        // Do nothing
    }
}

/**
 * Removes keys from the object by YAML-serialized array.
 * @param {object} obj Object
 * @param {string} yamlString YAML-serialized array
 * @returns {void} Nothing
 */
function excludeKeysByYaml(obj, yamlString) {
    if (!yamlString) {
        return;
    }

    try {
        const parsedObject = yaml.parse(yamlString);

        if (Array.isArray(parsedObject)) {
            parsedObject.forEach(key => {
                delete obj[key];
            });
        } else if (typeof parsedObject === 'object') {
            Object.keys(parsedObject).forEach(key => {
                delete obj[key];
            });
        } else if (typeof parsedObject === 'string') {
            delete obj[parsedObject];
        }
    } catch {
        // Do nothing
    }
}

/**
 * Removes trailing slash and /v1 from a string.
 * @param {string} str Input string
 * @returns {string} Trimmed string
 */
function trimV1(str) {
    return String(str ?? '').replace(/\/$/, '').replace(/\/v1$/, '');
}

/**
 * Convert a timestamp to an integer timestamp.
 * (sorry, it's momentless for now, didn't want to add a package just for this)
 * This function can handle several different timestamp formats:
 * 1. Unix timestamps (the number of seconds since the Unix Epoch)
 * 2. ST "humanized" timestamps, formatted like "YYYY-MM-DD &#64;HHh MMm SSs ms"
 * 3. Date strings in the format "Month DD, YYYY H:MMam/pm"
 *
 * The function returns the timestamp as the number of milliseconds since
 * the Unix Epoch, which can be converted to a JavaScript Date object with new Date().
 *
 * @param {string|number} timestamp - The timestamp to convert.
 * @returns {number|null} The timestamp in milliseconds since the Unix Epoch, or null if the input cannot be parsed.
 *
 * @example
 * // Unix timestamp
 * timestampToMoment(1609459200);
 * // ST humanized timestamp
 * timestampToMoment("2021-01-01 &#64;00h 00m 00s 000ms");
 * // Date string
 * timestampToMoment("January 1, 2021 12:00am");
 */
function timestampToMoment(timestamp) {
    if (!timestamp) {
        return null;
    }

    if (typeof timestamp === 'number') {
        return timestamp;
    }

    const pattern1 =
        /(\d{4})-(\d{1,2})-(\d{1,2}) ?@(\d{1,2})h ?(\d{1,2})m ?(\d{1,2})s ?(?:(\d{1,3})ms)?/;
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
        )}:${second.padStart(2, '0')}.${(millisecond ?? '0').padStart(3, '0')}Z`;
    };
    const isoTimestamp1 = timestamp.replace(pattern1, replacement1);
    if (!isNaN(Date.parse(isoTimestamp1))) {
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
    if (!isNaN(Date.parse(isoTimestamp2))) {
        return new Date(isoTimestamp2).getTime();
    }

    return null;
}

/**
 * Calculates the time difference between two dates.
 *
 * @param {Date|string} startTime - The start time in ISO 8601 format, or as a Date object
 * @param {Date|string} endTime - The finish time in ISO 8601 format, or as a Date object
 * @returns {number} - The difference in time in milliseconds, or 0 if invalid dates are provided or if start date is after end date.
 */
function calculateDuration(startTime, endTime) {
    const startDate = startTime instanceof Date ? startTime : new Date(startTime);
    const endDate = endTime instanceof Date ? endTime : new Date(endTime);

    return startDate > endDate ? 0 : Math.max(endDate.getTime() - startDate.getTime(), 0);
}

/** @param {string} timestamp @returns {Date|null} */
function humanizedToDate(timestamp) {
    const moment = timestampToMoment(timestamp);
    return moment ? new Date(moment) : null;
}

/**
 * Returns the maximum from all supplied dates
 * @param  {...Date} dates
 * @returns {Date?}
 */
function maxDate(...dates) {
    dates = dates.flat(Infinity);
    if (dates.length == 0) return null;
    /** @type {Date?} */
    let max = null;
    for (const date of dates) {
        if (max === null || date > max) {
            max = date;
        }
    }
    return max;
}

/**
 * Returns the minimum from all supplied dates
 * @param  {...Date} dates
 * @returns {Date?}
 */
function minDate(...dates) {
    dates = dates.flat(Infinity);
    if (dates.length == 0) return null;
    /** @type {Date?} */
    let min = null;
    for (const date of dates) {
        if (min === null || date < min) {
            min = date;
        }
    }
    return min;
}

/**
 * Returns the current date and time
 * (Why the fuck is `Date.now()` returning a timestamp and no date... I don't get it)
 * @returns {Date}
 */
function now() { return new Date(Date.now()); }

/**
 * Simple TTL memory cache.
 */
class Cache {
    /**
     * @param {number} ttl Time to live in milliseconds
     */
    constructor(ttl) {
        this.cache = new Map();
        this.ttl = ttl;
    }

    /**
     * Gets a value from the cache.
     * @param {string} key Cache key
     */
    get(key) {
        const value = this.cache.get(key);
        if (value?.expiry > Date.now()) {
            return value.value;
        }

        // Cache miss or expired, remove the key
        this.cache.delete(key);
        return null;
    }

    /**
     * Sets a value in the cache.
     * @param {string} key Key
     * @param {object} value Value
     */
    set(key, value) {
        this.cache.set(key, {
            value: value,
            expiry: Date.now() + this.ttl,
        });
    }

    /**
     * Removes a value from the cache.
     * @param {string} key Key
     */
    remove(key) {
        this.cache.delete(key);
    }

    /**
     * Clears the cache.
     */
    clear() {
        this.cache.clear();
    }
}

module.exports = {
    getConfig,
    getConfigValue,
    setConfigValue,
    getVersion,
    getBasicAuthHeader,
    extractFileFromZipBuffer,
    getImageBuffers,
    readAndParseJsonlFile,
    parseJson,
    readAllChunks,
    delay,
    deepMerge,
    color,
    uuidv4,
    humanizedISO8601DateTime,
    tryParse,
    clientRelativePath,
    removeFileExtension,
    generateTimestamp,
    removeOldBackups,
    getImages,
    forwardFetchResponse,
    getHexString,
    mergeObjectWithYaml,
    excludeKeysByYaml,
    trimV1,
    timestampToMoment,
    calculateDuration,
    humanizedToDate,
    maxDate,
    minDate,
    now,
    Cache,
    makeHttp2Request,
};
