// native node modules
import path from 'node:path';
import util from 'node:util';
import net from 'node:net';
import dns from 'node:dns';
import process from 'node:process';

import cors from 'cors';
import { csrfSync } from 'csrf-sync';
import express from 'express';
import compression from 'compression';
import cookieSession from 'cookie-session';
import multer from 'multer';
import responseTime from 'response-time';
import helmet from 'helmet';
import bodyParser from 'body-parser';

// local library imports
import './fetch-patch.js';
import { serverDirectory } from './server-directory.js';

import { serverEvents, EVENT_NAMES } from './server-events.js';
import { loadPlugins } from './plugin-loader.js';
import {
    initUserStorage,
    getCookieSecret,
    getCookieSessionName,
    ensurePublicDirectoriesExist,
    getUserDirectoriesList,
    migrateSystemPrompts,
    migrateUserData,
    requireLoginMiddleware,
    setUserDataMiddleware,
    shouldRedirectToLogin,
    cleanUploads,
    getSessionCookieAge,
    verifySecuritySettings,
    loginPageMiddleware,
} from './users.js';

import getWebpackServeMiddleware from './middleware/webpack-serve.js';
import basicAuthMiddleware from './middleware/basicAuth.js';
import getWhitelistMiddleware from './middleware/whitelist.js';
import accessLoggerMiddleware, { getAccessLogPath, migrateAccessLog } from './middleware/accessLogWriter.js';
import multerMonkeyPatch from './middleware/multerMonkeyPatch.js';
import initRequestProxy from './request-proxy.js';
import cacheBuster from './middleware/cacheBuster.js';
import corsProxyMiddleware from './middleware/corsProxy.js';
import hostWhitelistMiddleware from './middleware/hostWhitelist.js';
import {
    getVersion,
    color,
    removeColorFormatting,
    getSeparator,
    safeReadFileSync,
    setupLogLevel,
    setWindowTitle,
    getConfigValue,
} from './util.js';
import { UPLOADS_DIRECTORY } from './constants.js';
import { ensureThumbnailCache } from './endpoints/thumbnails.js';

// Routers
import { router as usersPublicRouter } from './endpoints/users-public.js';
import { init as statsInit, onExit as statsOnExit } from './endpoints/stats.js';
import { checkForNewContent } from './endpoints/content-manager.js';
import { init as settingsInit } from './endpoints/settings.js';
import { redirectDeprecatedEndpoints, ServerStartup, setupPrivateEndpoints } from './server-startup.js';
import { diskCache } from './endpoints/characters.js';
import { migrateFlatSecrets } from './endpoints/secrets.js';

// Work around a node v20.0.0, v20.1.0, and v20.2.0 bug. The issue was fixed in v20.3.0.
// https://github.com/nodejs/node/issues/47822#issuecomment-1564708870
// Safe to remove once support for Node v20 is dropped.
if (process.versions && process.versions.node && process.versions.node.match(/20\.[0-2]\.0/)) {
    // @ts-ignore
    if (net.setDefaultAutoSelectFamily) net.setDefaultAutoSelectFamily(false);
}

// Unrestrict console logs display limit
util.inspect.defaultOptions.maxArrayLength = null;
util.inspect.defaultOptions.maxStringLength = null;
util.inspect.defaultOptions.depth = 4;

/** @type {import('./command-line.js').CommandLineArguments} */
const cliArgs = globalThis.COMMAND_LINE_ARGS;

if (!cliArgs.enableIPv6 && !cliArgs.enableIPv4) {
    console.error('error: You can\'t disable all internet protocols: at least IPv6 or IPv4 must be enabled.');
    process.exit(1);
}

const app = express();
app.use(helmet({
    contentSecurityPolicy: false,
}));
app.use(compression());
app.use(responseTime());

app.use(bodyParser.json({ limit: '500mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '500mb' }));


// ================= [MOD START] TÍNH NĂNG REMOTE TUNNEL ProxyVN.top =================

import cookieParser from 'cookie-parser';
import { spawn as cfSpawn } from 'node:child_process';
import fs from 'node:fs';

// Tự động nhận diện tên file (Windows cần đuôi .exe)
const binaryName = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
// Trỏ vào thư mục 'bin' nằm ngay trong project của bạn
const cfBin = path.join(process.cwd(), 'bin', binaryName);

// --- Cấu hình ---
// Lưu file auth ngay tại thư mục chạy tool (thường là root) thay vì __dirname
const AUTH_FILE = path.join(process.cwd(), 'remote-auth.json');
let tunnelProcess = null;
let publicUrl = "";

app.use(cookieParser());
app.use(express.json());

// Hàm đọc/ghi file auth
function getAuth() {
    try {
        if (fs.existsSync(AUTH_FILE)) return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
    } catch (e) {}
    return null;
}
function saveAuth(user, pass) {
    fs.writeFileSync(AUTH_FILE, JSON.stringify({ user, pass }));
}

// --- MIDDLEWARE BẢO VỆ ---
app.use((req, res, next) => {
    // 1. Nếu là Localhost -> Cho qua
    const isRemote = req.headers['cf-ray'] || req.headers['cf-visitor'];
    if (!isRemote) return next();

    // 2. Cho phép file login và API login
    // Lưu ý: SillyTavern serve static file sau middleware này, nên ta cần check path kỹ
    if (req.path === '/remote-login.html' || req.path.startsWith('/api/remote/login') || req.path.startsWith('/img/') ) return next();

    // 3. Kiểm tra Cookie
    const creds = getAuth();
    if (!creds) return res.redirect('/remote-login.html');

    const clientCookie = req.cookies['st_remote_token'];
    // Mã hóa token đơn giản
    const serverToken = Buffer.from(`${creds.user}:${creds.pass}`).toString('base64');

    if (clientCookie === serverToken) {
        return next(); // Hợp lệ
    }

    // 4. Không hợp lệ -> Đá về login
    res.redirect('/remote-login.html');
});

// --- API ĐIỀU KHIỂN ---
app.post('/api/remote/login', (req, res) => {
    const { user, pass } = req.body;
    const saved = getAuth();
    if (saved && user === saved.user && pass === saved.pass) {
        const token = Buffer.from(`${user}:${pass}`).toString('base64');
        res.cookie('st_remote_token', token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
        res.json({ ok: true });
    } else {
        res.json({ ok: false });
    }
});

app.post('/api/remote/status', (req, res) => {
    const creds = getAuth();
    res.json({
        running: !!tunnelProcess,
        url: publicUrl,
        savedUser: creds ? creds.user : "",
        savedPass: creds ? creds.pass : ""
    });
});

app.post('/api/remote/toggle', async (req, res) => {
    const { action, user, pass } = req.body;

    // --- BẬT (START) ---
    if (action === 'start') {
        // 1. Nếu đang chạy và đã có URL -> Trả về ngay lập tức
        if (tunnelProcess && publicUrl) {
            return res.json({ status: 'running', url: publicUrl });
        }

        // 2. Nếu đang chạy mà chưa có URL (đang khởi động dở) -> Kill để chạy lại cho chắc
        if (tunnelProcess) {
            try { tunnelProcess.kill(); } catch(e) {}
            tunnelProcess = null;
        }

        const termuxCert = '/data/data/com.termux/files/usr/etc/tls/cert.pem';

        const port =  String(getConfigValue('port'));
        console.log(`[Remote] Đang khởi động Tunnel trên port ${port}...`);

        // 3. Khởi tạo Process mới
        // Lưu ý: Đường dẫn 'cfBin' sẽ được xử lý ở phần Postinstall bên dưới
        try {
            tunnelProcess = cfSpawn(cfBin, [
                'tunnel',
                '--edge-ip-version', '4',
                '--url', `http://127.0.0.1:${port}`,
                '--no-autoupdate',
                '--protocol', 'http2',
                '--logfile', '/dev/null',
                '--loglevel', 'info'
            ] );
        } catch (err) {
            console.error('[Remote] Lỗi khi khởi động cloudflared:', err);
            return res.json({ status: 'error', message: 'Lỗi khi khởi động cloudflared' });
        }

        publicUrl = ""; // Reset URL

        // 4. Lắng nghe log để bắt URL
        tunnelProcess.stderr.on('data', (data) => {
            const str = data.toString();
            console.log('[Cloudflared Log]:', str);

            // Regex bắt link trycloudflare
            const match = str.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
            if (match) {
                publicUrl = match[0];
                console.log('[Remote] Link mới:', publicUrl);
            }
        });

        tunnelProcess.on('close', (code) => {
            console.log(`[Remote] Tunnel đã đóng (Code: ${code})`);
            tunnelProcess = null;
            publicUrl = "";
        });

        // 5. [TỐI ƯU] Chờ URL tối đa 15s, nhưng có là trả về NGAY
        const maxRetries = 30; // 30 lần thử
        const intervalTime = 500; // Mỗi lần 0.5s => Tổng 15s
        let attempt = 0;

        const checkUrlInterval = setInterval(() => {
            attempt++;

            // A. Thành công: Đã có URL
            if (publicUrl) {
                clearInterval(checkUrlInterval);
                return res.json({ status: 'started', url: publicUrl });
            }

            // B. Thất bại: Quá thời gian chờ (Timeout)
            if (attempt >= maxRetries) {
                clearInterval(checkUrlInterval);
                // Kill process treo
                if(tunnelProcess) {
                    tunnelProcess.kill();
                    tunnelProcess = null;
                }
                return res.json({ status: 'error', message: "Hết thời gian chờ (Timeout). Mạng quá chậm hoặc Cloudflare bị chặn." });
            }

            // C. Thất bại: Process bị chết đột ngột khi đang chờ
            if (!tunnelProcess) {
                clearInterval(checkUrlInterval);
                return res.json({ status: 'error', message: "Tunnel process bị đóng đột ngột." });
            }

            // Nếu chưa có, lặp lại sau 500ms...
        }, intervalTime);

    } else {
        // --- TẮT (STOP) ---
        if (tunnelProcess) {
            tunnelProcess.kill(); // Kill process chính
            tunnelProcess = null;
            publicUrl = "";

            // [FIX LỖI CỦA BẠN TẠI ĐÂY]
            // Kiểm tra hệ điều hành để dùng lệnh Kill phù hợp
            try {
                if (process.platform === 'win32') {
                    // Nếu là Windows -> Dùng taskkill
                    const cleanup = cfSpawn('taskkill', ['/F', '/IM', 'cloudflared.exe']);
                    cleanup.on('error', () => {}); // Bỏ qua lỗi nếu không tìm thấy
                } else {
                    // Nếu là Linux/Termux -> Dùng pkill
                    const cleanup = cfSpawn('pkill', ['-f', 'cloudflared']);
                    cleanup.on('error', () => {});
                }
            } catch(e) {
                // Không làm gì cả, chỉ là dọn dẹp thôi
            }
        }
        res.json({ status: 'stopped' });
    }
});
// ================= [MOD END] =================

// CORS Settings //
const CORS = cors({
    origin: 'null',
    methods: ['OPTIONS'],
});

app.use(CORS);

if (cliArgs.listen && cliArgs.basicAuthMode) {
    app.use(basicAuthMiddleware);
}

if (cliArgs.whitelistMode) {
    const whitelistMiddleware = await getWhitelistMiddleware();
    app.use(whitelistMiddleware);
}

app.use(hostWhitelistMiddleware);

if (cliArgs.listen) {
    app.use(accessLoggerMiddleware());
}

if (cliArgs.enableCorsProxy) {
    app.use('/proxy/:url(*)', corsProxyMiddleware);
} else {
    app.use('/proxy/:url(*)', async (_, res) => {
        const message = 'CORS proxy is disabled. Enable it in config.yaml or use the --corsProxy flag.';
        console.log(message);
        res.status(404).send(message);
    });
}

app.use(cookieSession({
    name: getCookieSessionName(),
    sameSite: 'lax',
    httpOnly: true,
    maxAge: getSessionCookieAge(),
    secret: getCookieSecret(globalThis.DATA_ROOT),
}));

app.use(setUserDataMiddleware);

// CSRF Protection //
if (!cliArgs.disableCsrf) {
    const csrfSyncProtection = csrfSync({
        getTokenFromState: (req) => {
            if (!req.session) {
                console.error('(CSRF error) getTokenFromState: Session object not initialized');
                return;
            }
            return req.session.csrfToken;
        },
        getTokenFromRequest: (req) => {
            return req.headers['x-csrf-token']?.toString();
        },
        storeTokenInState: (req, token) => {
            if (!req.session) {
                console.error('(CSRF error) storeTokenInState: Session object not initialized');
                return;
            }
            req.session.csrfToken = token;
        },
        size: 32,
    });

    app.get('/csrf-token', (req, res) => {
        res.json({
            'token': csrfSyncProtection.generateToken(req),
        });
    });

    // Customize the error message
    csrfSyncProtection.invalidCsrfTokenError.message = color.red('Invalid CSRF token. Please refresh the page and try again.');
    csrfSyncProtection.invalidCsrfTokenError.stack = undefined;

    app.use(csrfSyncProtection.csrfSynchronisedProtection);
} else {
    console.warn('\nCSRF protection is disabled. This will make your server vulnerable to CSRF attacks.\n');
    app.get('/csrf-token', (req, res) => {
        res.json({
            'token': 'disabled',
        });
    });
}

// Static files
// Host index page
app.get('/', cacheBuster.middleware, (request, response) => {
    if (shouldRedirectToLogin(request)) {
        const query = request.url.split('?')[1];
        const redirectUrl = query ? `/login?${query}` : '/login';
        return response.redirect(redirectUrl);
    }

    return response.sendFile('index.html', { root: path.join(serverDirectory, 'public') });
});

// Callback endpoint for OAuth PKCE flows (e.g. OpenRouter)
app.get('/callback/:source?', (request, response) => {
    const source = request.params.source;
    const query = request.url.split('?')[1];
    const searchParams = new URLSearchParams();
    source && searchParams.set('source', source);
    query && searchParams.set('query', query);
    const path = `/?${searchParams.toString()}`;
    return response.redirect(307, path);
});

// Host login page
app.get('/login', loginPageMiddleware);

// Host frontend assets
const webpackMiddleware = getWebpackServeMiddleware();
app.use(webpackMiddleware);
app.use(express.static(path.join(serverDirectory, 'public'), {}));

// Public API
app.use('/api/users', usersPublicRouter);

// Everything below this line requires authentication
app.use(requireLoginMiddleware);
app.post('/api/ping', (request, response) => {
    if (request.query.extend && request.session) {
        request.session.touch = Date.now();
    }

    response.sendStatus(204);
});

// File uploads
const uploadsPath = path.join(cliArgs.dataRoot, UPLOADS_DIRECTORY);
app.use(multer({ dest: uploadsPath, limits: { fieldSize: 5120 * 1024 * 1024 } }).single('avatar')); // 5GB limit
app.use(multerMonkeyPatch);

app.get('/version', async function (_, response) {
    const data = await getVersion();
    response.send(data);
});

redirectDeprecatedEndpoints(app);
setupPrivateEndpoints(app);

/**
 * Tasks that need to be run before the server starts listening.
 * @returns {Promise<void>}
 */
async function preSetupTasks() {
    const version = await getVersion();

    // Print formatted header
    console.log();
    console.log(`SillyTavern ${version.pkgVersion}`);
    if (version.gitBranch && version.commitDate) {
        const date = new Date(version.commitDate);
        const localDate = date.toLocaleString('en-US', { timeZoneName: 'short' });
        console.log(`Running '${version.gitBranch}' (${version.gitRevision}) - ${localDate}`);
        if (!version.isLatest && ['staging', 'release'].includes(version.gitBranch)) {
            console.log('INFO: Currently not on the latest commit.');
            console.log('      Run \'git pull\' to update. If you have any merge conflicts, run \'git reset --hard\' and \'git pull\' to reset your branch.');
        }
    }
    console.log();

    const directories = await getUserDirectoriesList();
    await checkForNewContent(directories);
    await ensureThumbnailCache(directories);
    await diskCache.verify(directories);
    migrateFlatSecrets(directories);
    cleanUploads();
    migrateAccessLog();

    await settingsInit();
    await statsInit();

    const pluginsDirectory = path.join(serverDirectory, 'plugins');
    const cleanupPlugins = await loadPlugins(app, pluginsDirectory);
    const consoleTitle = process.title;

    let isExiting = false;
    const exitProcess = async () => {
        if (isExiting) return;
        isExiting = true;
        await statsOnExit();
        if (typeof cleanupPlugins === 'function') {
            await cleanupPlugins();
        }
        diskCache.dispose();
        setWindowTitle(consoleTitle);
        process.exit();
    };

    // Set up event listeners for a graceful shutdown
    process.on('SIGINT', exitProcess);
    process.on('SIGTERM', exitProcess);
    process.on('uncaughtException', (err) => {
        console.error('Uncaught exception:', err);
        exitProcess();
    });

    // Add request proxy.
    initRequestProxy({ enabled: cliArgs.requestProxyEnabled, url: cliArgs.requestProxyUrl, bypass: cliArgs.requestProxyBypass });

    // Wait for frontend libs to compile
    await webpackMiddleware.runWebpackCompiler();
}

/**
 * Tasks that need to be run after the server starts listening.
 * @param {import('./server-startup.js').ServerStartupResult} result The result of the server startup
 * @returns {Promise<void>}
 */
async function postSetupTasks(result) {
    const browserLaunchHostname = await cliArgs.getBrowserLaunchHostname(result);
    const browserLaunchUrl = cliArgs.getBrowserLaunchUrl(browserLaunchHostname);
    const browserLaunchApp = String(getConfigValue('browserLaunch.browser', 'default') ?? '');

    if (cliArgs.browserLaunchEnabled) {
        try {
            // TODO: This should be converted to a regular import when support for Node 18 is dropped
            const openModule = await import('open');
            const { default: open, apps } = openModule;

            function getBrowsers() {
                const isAndroid = process.platform === 'android';
                if (isAndroid) {
                    return {};
                }
                return {
                    'firefox': apps.firefox,
                    'chrome': apps.chrome,
                    'edge': apps.edge,
                    'brave': apps.brave,
                };
            }

            const validBrowsers = getBrowsers();
            const appName = validBrowsers[browserLaunchApp.trim().toLowerCase()];
            const openOptions = appName ? { app: { name: appName } } : {};

            console.log(`Launching in a browser: ${browserLaunchApp}...`);
            await open(browserLaunchUrl.toString(), openOptions);
        } catch (error) {
            console.error('Failed to launch the browser. Open the URL manually.', error);
        }
    }

    setWindowTitle('SillyTavern WebServer');

    let logListen = 'SillyTavern is listening on';

    if (result.useIPv6 && !result.v6Failed) {
        logListen += color.green(
            ' IPv6: ' + cliArgs.getIPv6ListenUrl().host,
        );
    }

    if (result.useIPv4 && !result.v4Failed) {
        logListen += color.green(
            ' IPv4: ' + cliArgs.getIPv4ListenUrl().host,
        );
    }

    const goToLog = `Go to: ${color.blue(browserLaunchUrl)} to open SillyTavern`;
    const plainGoToLog = removeColorFormatting(goToLog);

    console.log(logListen);
    if (cliArgs.listen) {
        console.log();
        console.log('To limit connections to internal localhost only ([::1] or 127.0.0.1), change the setting in config.yaml to "listen: false".');
        console.log('Check the "access.log" file in the data directory to inspect incoming connections:', color.green(getAccessLogPath()));
    }
    console.log('\n' + getSeparator(plainGoToLog.length) + '\n');
    console.log(goToLog);
    console.log('\n' + getSeparator(plainGoToLog.length) + '\n');

    setupLogLevel();
    serverEvents.emit(EVENT_NAMES.SERVER_STARTED, { url: browserLaunchUrl });
}

/**
 * Registers a not-found error response if a not-found error page exists. Should only be called after all other middlewares have been registered.
 */
function apply404Middleware() {
    const notFoundWebpage = safeReadFileSync(path.join(serverDirectory, 'public/error/url-not-found.html')) ?? '';
    app.use((req, res) => {
        res.status(404).send(notFoundWebpage);
    });
}

/**
 * Sets the DNS resolution order based on the command line arguments.
 */
function setDnsResolutionOrder() {
    try {
        if (cliArgs.dnsPreferIPv6) {
            dns.setDefaultResultOrder('ipv6first');
            console.log('Preferring IPv6 for DNS resolution');
        } else {
            dns.setDefaultResultOrder('ipv4first');
            console.log('Preferring IPv4 for DNS resolution');
        }
    } catch (error) {
        console.warn('Failed to set DNS resolution order. Possibly unsupported in this Node version.');
    }
}

// User storage module needs to be initialized before starting the server
initUserStorage(globalThis.DATA_ROOT)
    .then(setDnsResolutionOrder)
    .then(ensurePublicDirectoriesExist)
    .then(migrateUserData)
    .then(migrateSystemPrompts)
    .then(verifySecuritySettings)
    .then(preSetupTasks)
    .then(apply404Middleware)
    .then(() => new ServerStartup(app, cliArgs).start())
    .then(postSetupTasks);
