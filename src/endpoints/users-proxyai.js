const fsPromises = require('fs').promises;
const storage = require('node-persist');
const express = require('express');
const lodash = require('lodash');
const { jsonParser } = require('../express-common');
const { checkForNewContent } = require('./content-manager');
const {
    KEY_PREFIX,
    toKey,
    requireAdminMiddleware,
    getUserAvatar,
    getAllUserHandles,
    getPasswordSalt,
    getPasswordHash,
    getUserDirectories,
    ensurePublicDirectoriesExist,
} = require('../users');
const { DEFAULT_USER } = require('../constants');
const { getConfigValue } = require('../util.js');

const router = express.Router();

// API key
const apiKey = getConfigValue('API_KEY');

// Middleware để kiểm tra API key
const checkApiKey = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Invalid or missing Authorization header' });
    }

    const providedApiKey = authHeader.split(' ')[1];
    if (providedApiKey !== apiKey) {
      return res.status(401).json({ error: 'Invalid API key' });
    }
  
    next();
};

router.post('/get', checkApiKey, jsonParser, async (_request, response) => {
    try {
        /** @type {import('../users').User[]} */
        const users = await storage.values(x => x.key.startsWith(KEY_PREFIX));

        /** @type {Promise<import('../users').UserViewModel>[]} */
        const viewModelPromises = users
            .map(user => new Promise(resolve => {
                getUserAvatar(user.handle).then(avatar =>
                    resolve({
                        handle: user.handle,
                        name: user.name,
                        avatar: avatar,
                        admin: user.admin,
                        enabled: user.enabled,
                        created: user.created,
                        password: !!user.password,
                    }),
                );
            }));

        const viewModels = await Promise.all(viewModelPromises);
        viewModels.sort((x, y) => (x.created ?? 0) - (y.created ?? 0));
        return response.json(viewModels);
    } catch (error) {
        console.error('User list failed:', error);
        return response.sendStatus(500);
    }
});

router.post('/disable', checkApiKey, jsonParser, async (request, response) => {
    try {
        if (!request.body.handle) {
            console.log('Disable user failed: Missing required fields');
            return response.status(400).json({ error: 'Missing required fields' });
        }

        /** @type {import('../users').User} */
        const user = await storage.getItem(toKey(request.body.handle));

        if (!user) {
            console.log('Disable user failed: User not found');
            return response.status(404).json({ error: 'User not found' });
        }

        user.enabled = false;
        await storage.setItem(toKey(request.body.handle), user);
        return response.sendStatus(204);
    } catch (error) {
        console.error('User disable failed:', error);
        return response.sendStatus(500);
    }
});

router.post('/enable', checkApiKey, jsonParser, async (request, response) => {
    try {
        if (!request.body.handle) {
            console.log('Enable user failed: Missing required fields');
            return response.status(400).json({ error: 'Missing required fields' });
        }

        /** @type {import('../users').User} */
        const user = await storage.getItem(toKey(request.body.handle));

        if (!user) {
            console.log('Enable user failed: User not found');
            return response.status(404).json({ error: 'User not found' });
        }

        user.enabled = true;
        await storage.setItem(toKey(request.body.handle), user);
        return response.sendStatus(204);
    } catch (error) {
        console.error('User enable failed:', error);
        return response.sendStatus(500);
    }
});

router.post('/create', checkApiKey, jsonParser, async (request, response) => {
    try {
        if (!request.body.handle || !request.body.name) {
            console.log('Create user failed: Missing required fields');
            return response.status(400).json({ error: 'Missing required fields' });
        }

        const handles = await getAllUserHandles();
        const handle = String(request.body.handle).toLowerCase().trim();

        if (!handle) {
            console.log('Create user failed: Invalid handle');
            return response.status(400).json({ error: 'Invalid handle' });
        }

        if (handles.some(x => x === handle)) {
            console.log('Create user failed: User with that handle already exists');
            return response.status(409).json({ error: 'User already exists' });
        }

        const salt = getPasswordSalt();
        const password = request.body.password ? getPasswordHash(request.body.password, salt) : '';

        const newUser = {
            handle: handle,
            name: request.body.name || 'Anonymous',
            created: Date.now(),
            password: password,
            salt: salt,
            admin: !!request.body.admin,
            enabled: true,
        };

        await storage.setItem(toKey(handle), newUser);

        // Create user directories
        console.log('Creating data directories for', newUser.handle);
        await ensurePublicDirectoriesExist();
        const directories = getUserDirectories(newUser.handle);
        await checkForNewContent([directories]);
        return response.json({ handle: newUser.handle });
    } catch (error) {
        console.error('User create failed:', error);
        return response.sendStatus(500);
    }
});

router.post('/delete', checkApiKey, jsonParser, async (request, response) => {
    try {
        if (!request.body.handle) {
            console.log('Delete user failed: Missing required fields');
            return response.status(400).json({ error: 'Missing required fields' });
        }

        if (request.body.handle === DEFAULT_USER.handle) {
            console.log('Delete user failed: Cannot delete default user');
            return response.status(400).json({ error: 'Sorry, but the default user cannot be deleted. It is required as a fallback.' });
        }

        await storage.removeItem(toKey(request.body.handle));

        if (request.body.purge) {
            const directories = getUserDirectories(request.body.handle);
            console.log('Deleting data directories for', request.body.handle);
            await fsPromises.rm(directories.root, { recursive: true, force: true });
        }

        return response.sendStatus(204);
    } catch (error) {
        console.error('User delete failed:', error);
        return response.sendStatus(500);
    }
});

router.post('/slugify', checkApiKey, jsonParser, async (request, response) => {
    try {
        if (!request.body.text) {
            console.log('Slugify failed: Missing required fields');
            return response.status(400).json({ error: 'Missing required fields' });
        }

        const text = lodash.kebabCase(String(request.body.text).toLowerCase().trim());

        return response.send(text);
    } catch (error) {
        console.error('Slugify failed:', error);
        return response.sendStatus(500);
    }
});

router.post('/change-password', checkApiKey, jsonParser, async (request, response) => {
    try {
        if (!request.body.handle) {
            console.log('Change password failed: Missing required fields');
            return response.status(400).json({ error: 'Missing required fields' });
        }

        /** @type {import('../users').User} */
        const user = await storage.getItem(toKey(request.body.handle));

        if (!user) {
            console.log('Change password failed: User not found');
            return response.status(404).json({ error: 'User not found' });
        }

        if (!user.enabled) {
            console.log('Change password failed: User is disabled');
            return response.status(403).json({ error: 'User is disabled' });
        }

        if (request.body.newStPassword) {
            const salt = getPasswordSalt();
            user.password = getPasswordHash(request.body.newStPassword, salt);
            user.salt = salt;
        } else {
            user.password = '';
            user.salt = '';
        }

        await storage.setItem(toKey(request.body.handle), user);
        return response.sendStatus(204);
    } catch (error) {
        console.error(error);
        return response.sendStatus(500);
    }
});

module.exports = {
    router,
};
