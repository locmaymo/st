import fs from 'node:fs';
import process from 'node:process';
import yaml from 'yaml';
import storage from 'node-persist';
import {
    initUserStorage,
    getPasswordSalt,
    getPasswordHash,
    toKey,
} from './src/users.js';

const userAccount = process.argv[2];
const userPassword = process.argv[3];

if (!userAccount) {
    console.error('A tool for recovering lost SillyTavern accounts. Uses a "dataRoot" setting from config.yaml file.');
    console.error('Usage: node recover.js [account] (password)');
    console.error('Example: node recover.js admin password');
    process.exit(1);
}

async function initStorage() {
    const config = yaml.parse(fs.readFileSync('config.yaml', 'utf8'));
    const dataRoot = config.dataRoot;

    if (!dataRoot) {
        console.error('No "dataRoot" setting found in config.yaml file.');
        process.exit(1);
    }

    await initUserStorage(dataRoot);
}

async function main() {
    await initStorage();

    /**
     * @type {import('./src/users').User}
     */
    const user = await storage.get(toKey(userAccount));

    if (!user) {
        console.error(`User "${userAccount}" not found.`);
        process.exit(1);
    }

    if (!user.enabled) {
        console.log('User is disabled. Enabling...');
        user.enabled = true;
    }

    if (userPassword) {
        console.log('Setting new password...');
        const salt = getPasswordSalt();
        const passwordHash = getPasswordHash(userPassword, salt);
        user.password = passwordHash;
        user.salt = salt;
    } else {
        console.log('Setting an empty password...');
        user.password = '';
        user.salt = '';
    }

    await storage.setItem(toKey(userAccount), user);
    console.log('User recovered. A program will exit now.');
}

main();
