/**
 * Scripts to be done before starting the server for the first time.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execSync } from 'node:child_process';
import https from 'node:https';
import yaml from 'yaml';
import chalk from 'chalk';
import { createRequire } from 'node:module';
import { addMissingConfigValues } from './src/config-init.js';

/**
 * Colorizes console output.
 */
const color = chalk;

/**
 * Hàm tải file hỗ trợ tự động Follow Redirect (301, 302)
 */
function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const request = https.get(url, (response) => {
            // 1. Xử lý chuyển hướng (301, 302) - GitHub Releases luôn dùng cái này
            if (response.statusCode === 301 || response.statusCode === 302) {
                if (response.headers.location) {
                    console.log(color.gray(`  -> Redirecting to: ${response.headers.location.substring(0, 50)}...`));
                    // Đệ quy: Gọi lại hàm với URL mới
                    return downloadFile(response.headers.location, dest)
                        .then(resolve)
                        .catch(reject);
                } else {
                    reject(new Error('Redirect detected but no location header found.'));
                    return;
                }
            }

            // 2. Nếu thành công (200)
            if (response.statusCode === 200) {
                const file = fs.createWriteStream(dest);
                response.pipe(file);

                file.on('finish', () => {
                    file.close(() => resolve());
                });

                file.on('error', (err) => {
                    fs.unlink(dest, () => {});
                    reject(err);
                });
            } else {
                // 3. Lỗi khác
                reject(new Error(`Download failed with status code: ${response.statusCode}`));
            }
        });

        request.on('error', (err) => {
            fs.unlink(dest, () => {});
            reject(err);
        });
    });
}

/**
 * Tải Cloudflared tự động nhận diện Windows/Linux/Termux/Mac
 */
async function setupCloudflared() {
    const binDir = path.join(process.cwd(), 'bin');

    // 1. Xác định tên file dựa trên hệ điều hành
    const isWindows = process.platform === 'win32';
    const fileName = isWindows ? 'cloudflared.exe' : 'cloudflared';
    const binPath = path.join(binDir, fileName);

    // Nếu đã có file rồi thì bỏ qua
    if (fs.existsSync(binPath)) {
        console.log(color.green(`Cloudflared binary already exists at ./bin/${fileName}. Skipping download.`));
        return;
    }

    // 2. Xác định link tải phù hợp với Chip và OS
    const platform = process.platform;
    const arch = process.arch;

    let downloadUrl = '';
    const baseUrl = 'https://github.com/cloudflare/cloudflared/releases/latest/download/';

    console.log(color.blue(`Detected System: ${platform} (${arch})`));

    if (isWindows) {
        // Windows (x64 hoặc x86)
        downloadUrl = baseUrl + (arch === 'x64' ? 'cloudflared-windows-amd64.exe' : 'cloudflared-windows-386.exe');
    } else if (platform === 'darwin') {
        // MacOS
        downloadUrl = baseUrl + 'cloudflared-darwin-amd64.tgz';
        // Lưu ý: Mac có thể cần giải nén tgz, nhưng code này tạm tải file gốc
        // Nếu muốn binary trực tiếp (nếu GitHub có):
        // downloadUrl = baseUrl + 'cloudflared-darwin-amd64';
    } else {
        // Linux & Android (Termux)
        if (arch === 'arm64') {
            downloadUrl = baseUrl + 'cloudflared-linux-arm64';
        } else if (arch === 'arm') {
            downloadUrl = baseUrl + 'cloudflared-linux-arm';
        } else if (arch === 'x64') {
            downloadUrl = baseUrl + 'cloudflared-linux-amd64';
        } else {
            downloadUrl = baseUrl + 'cloudflared-linux-386';
        }
    }

    if (!downloadUrl) {
        console.error(color.red('FATAL: Unsupported architecture/platform.'));
        return;
    }

    console.log(color.blue(`Downloading Cloudflared from GitHub...`));

    // 3. Tạo thư mục bin
    if (!fs.existsSync(binDir)) {
        fs.mkdirSync(binDir, { recursive: true });
    }

    // 4. Thực hiện tải file (Có hỗ trợ Redirect)
    try {
        await downloadFile(downloadUrl, binPath);
        console.log(color.green('Download completed successfully.'));

        // 5. Cấp quyền thực thi (Chỉ chạy trên Linux/Mac/Android)
        if (!isWindows) {
            try {
                execSync(`chmod +x "${binPath}"`);
                console.log(color.green('Permissions set (+x).'));
            } catch (e) {
                console.warn(color.yellow('Could not set permissions. You may need to run "chmod +x" manually.'));
            }
        }
    } catch (error) {
        console.error(color.red(`FATAL: Download error: ${error.message}`));
    }
}

/**
 * Converts the old config.conf file to the new config.yaml format.
 */
function convertConfig() {
    if (fs.existsSync('./config.conf')) {
        if (fs.existsSync('./config.yaml')) {
            console.log(color.yellow('Both config.conf and config.yaml exist. Please delete config.conf manually.'));
            return;
        }

        try {
            console.log(color.blue('Converting config.conf to config.yaml. Your old config.conf will be renamed to config.conf.bak'));
            fs.renameSync('./config.conf', './config.conf.cjs'); // Force loading as CommonJS
            const require = createRequire(import.meta.url);
            const config = require(path.join(process.cwd(), './config.conf.cjs'));
            fs.copyFileSync('./config.conf.cjs', './config.conf.bak');
            fs.rmSync('./config.conf.cjs');
            fs.writeFileSync('./config.yaml', yaml.stringify(config));
            console.log(color.green('Conversion successful. Please check your config.yaml and fix it if necessary.'));
        } catch (error) {
            console.error(color.red('FATAL: Config conversion failed. Please check your config.conf file and try again.'), error);
            return;
        }
    }
}

/**
 * Creates the default config files if they don't exist yet.
 */
function createDefaultFiles() {
    /**
     * @typedef DefaultItem
     * @type {object}
     * @property {'file' | 'directory'} type - Whether the item should be copied as a single file or merged into a directory structure.
     * @property {string} defaultPath - The path to the default item (typically in `default/`).
     * @property {string} productionPath - The path to the copied item for production use.
     */

    /** @type {DefaultItem[]} */
    const defaultItems = [
        {
            type: 'file',
            defaultPath: './default/config.yaml',
            productionPath: './config.yaml',
        },
        {
            type: 'directory',
            defaultPath: './default/public/',
            productionPath: './public/',
        },
    ];

    for (const defaultItem of defaultItems) {
        try {
            if (defaultItem.type === 'file') {
                if (!fs.existsSync(defaultItem.productionPath)) {
                    fs.copyFileSync(
                        defaultItem.defaultPath,
                        defaultItem.productionPath,
                    );
                    console.log(
                        color.green(`Created default file: ${defaultItem.productionPath}`),
                    );
                }
            } else if (defaultItem.type === 'directory') {
                fs.cpSync(defaultItem.defaultPath, defaultItem.productionPath, {
                    force: false, // Don't overwrite existing files!
                    recursive: true,
                });
                console.log(
                    color.green(`Synchronized missing files: ${defaultItem.productionPath}`),
                );
            } else {
                throw new Error(
                    'FATAL: Unexpected default file format in `post-install.js#createDefaultFiles()`.',
                );
            }
        } catch (error) {
            console.error(
                color.red(
                    `FATAL: Could not write default ${defaultItem.type}: ${defaultItem.productionPath}`,
                ),
                error,
            );
        }
    }
}

// Hàm Main bọc trong async để dùng await
(async () => {
    try {
        // 0. Setup Cloudflared (MỚI - Đã fix logic)
        await setupCloudflared();

        // 1. Convert config.conf to config.yaml
        convertConfig();

        // 2. Create default config files
        createDefaultFiles();

        // 3. Add missing config values
        addMissingConfigValues(path.join(process.cwd(), './config.yaml'));

    } catch (error) {
        console.error(error);
    }
})();
