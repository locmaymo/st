import fetch from 'node-fetch';
import express from 'express';
import { AIHorde, ModelGenerationInputStableSamplers, ModelInterrogationFormTypes, HordeAsyncRequestStates } from '@zeldafan0225/ai_horde';
import { getVersion, delay, Cache } from '../util.js';
import { readSecret, SECRET_KEYS } from './secrets.js';
import { jsonParser } from '../express-common.js';

const ANONYMOUS_KEY = '0000000000';
const HORDE_TEXT_MODEL_METADATA_URL = 'https://raw.githubusercontent.com/db0/AI-Horde-text-model-reference/main/db.json';
const cache = new Cache(60 * 1000);
export const router = express.Router();

/**
 * Returns the AIHorde client agent.
 * @returns {Promise<string>} AIHorde client agent
 */
async function getClientAgent() {
    const version = await getVersion();
    return version?.agent || 'SillyTavern:UNKNOWN:Cohee#1207';
}

/**
 * Returns the AIHorde client.
 * @returns {Promise<AIHorde>} AIHorde client
 */
async function getHordeClient() {
    return new AIHorde({
        client_agent: await getClientAgent(),
    });
}

/**
 * Removes dirty no-no words from the prompt.
 * Taken verbatim from KAI Lite's implementation (AGPLv3).
 * https://github.com/LostRuins/lite.koboldai.net/blob/main/index.html#L7786C2-L7811C1
 * @param {string} prompt Prompt to sanitize
 * @returns {string} Sanitized prompt
 */
function sanitizeHordeImagePrompt(prompt) {
    if (!prompt) {
        return '';
    }

    //to avoid flagging from some image models, always swap these words
    prompt = prompt.replace(/\b(girl)\b/gmi, 'woman');
    prompt = prompt.replace(/\b(boy)\b/gmi, 'man');
    prompt = prompt.replace(/\b(girls)\b/gmi, 'women');
    prompt = prompt.replace(/\b(boys)\b/gmi, 'men');
    //always remove these high risk words from prompt, as they add little value to image gen while increasing the risk the prompt gets flagged
    prompt = prompt.replace(/\b(under.age|under.aged|underage|underaged|loli|pedo|pedophile|(\w+).year.old|(\w+).years.old|minor|prepubescent|minors|shota)\b/gmi, '');
    //replace risky subject nouns with person
    prompt = prompt.replace(/\b(youngster|infant|baby|toddler|child|teen|kid|kiddie|kiddo|teenager|student|preteen|pre.teen)\b/gmi, 'person');
    //remove risky adjectives and related words
    prompt = prompt.replace(/\b(young|younger|youthful|youth|small|smaller|smallest|girly|boyish|lil|tiny|teenaged|lit[tl]le|school.aged|school|highschool|kindergarten|teens|children|kids)\b/gmi, '');

    return prompt;
}

router.post('/text-workers', jsonParser, async (request, response) => {
    try {
        const cachedWorkers = cache.get('workers');

        if (cachedWorkers && !request.body.force) {
            return response.send(cachedWorkers);
        }

        const agent = await getClientAgent();
        const fetchResult = await fetch('https://aihorde.net/api/v2/workers?type=text', {
            headers: {
                'Client-Agent': agent,
            },
        });
        const data = await fetchResult.json();
        cache.set('workers', data);
        return response.send(data);
    } catch (error) {
        console.error(error);
        response.sendStatus(500);
    }
});

async function getHordeTextModelMetadata() {
    const response = await fetch(HORDE_TEXT_MODEL_METADATA_URL);
    return await response.json();
}

async function mergeModelsAndMetadata(models, metadata) {
    return models.map(model => {
        const metadataModel = metadata[model.name];
        if (!metadataModel) {
            return  { ...model, is_whitelisted: false };
        }
        return { ...model, ...metadataModel, is_whitelisted: true };
    });
}

router.post('/text-models', jsonParser, async (request, response) => {
    try {
        const cachedModels = cache.get('models');
        if (cachedModels && !request.body.force) {
            return response.send(cachedModels);
        }

        const agent = await getClientAgent();
        const fetchResult = await fetch('https://aihorde.net/api/v2/status/models?type=text', {
            headers: {
                'Client-Agent': agent,
            },
        });

        let data = await fetchResult.json();

        // attempt to fetch and merge models metadata
        try {
            const metadata = await getHordeTextModelMetadata();
            data = await mergeModelsAndMetadata(data, metadata);
        }
        catch (error) {
            console.error('Failed to fetch metadata:', error);
        }

        cache.set('models', data);
        return response.send(data);
    } catch (error) {
        console.error(error);
        response.sendStatus(500);
    }
});

router.post('/status', jsonParser, async (_, response) => {
    try {
        const agent = await getClientAgent();
        const fetchResult = await fetch('https://aihorde.net/api/v2/status/heartbeat', {
            headers: {
                'Client-Agent': agent,
            },
        });

        return response.send({ ok: fetchResult.ok });
    } catch (error) {
        console.error(error);
        response.sendStatus(500);
    }
});

router.post('/cancel-task', jsonParser, async (request, response) => {
    try {
        const taskId = request.body.taskId;
        const agent = await getClientAgent();
        const fetchResult = await fetch(`https://aihorde.net/api/v2/generate/text/status/${taskId}`, {
            method: 'DELETE',
            headers: {
                'Client-Agent': agent,
            },
        });

        const data = await fetchResult.json();
        console.log(`Cancelled Horde task ${taskId}`);
        return response.send(data);
    } catch (error) {
        console.error(error);
        response.sendStatus(500);
    }
});

router.post('/task-status', jsonParser, async (request, response) => {
    try {
        const taskId = request.body.taskId;
        const agent = await getClientAgent();
        const fetchResult = await fetch(`https://aihorde.net/api/v2/generate/text/status/${taskId}`, {
            headers: {
                'Client-Agent': agent,
            },
        });

        const data = await fetchResult.json();
        console.log(`Horde task ${taskId} status:`, data);
        return response.send(data);
    } catch (error) {
        console.error(error);
        response.sendStatus(500);
    }
});

router.post('/generate-text', jsonParser, async (request, response) => {
    const apiKey = readSecret(request.user.directories, SECRET_KEYS.HORDE) || ANONYMOUS_KEY;
    const url = 'https://aihorde.net/api/v2/generate/text/async';
    const agent = await getClientAgent();

    console.log(request.body);
    try {
        const result = await fetch(url, {
            method: 'POST',
            body: JSON.stringify(request.body),
            headers: {
                'Content-Type': 'application/json',
                'apikey': apiKey,
                'Client-Agent': agent,
            },
        });

        if (!result.ok) {
            const message = await result.text();
            console.log('Horde returned an error:', message);
            return response.send({ error: { message } });
        }

        const data = await result.json();
        return response.send(data);
    } catch (error) {
        console.log(error);
        return response.send({ error: true });
    }
});

router.post('/sd-samplers', jsonParser, async (_, response) => {
    try {
        const samplers = Object.values(ModelGenerationInputStableSamplers);
        response.send(samplers);
    } catch (error) {
        console.error(error);
        response.sendStatus(500);
    }
});

router.post('/sd-models', jsonParser, async (_, response) => {
    try {
        const ai_horde = await getHordeClient();
        const models = await ai_horde.getModels();
        response.send(models);
    } catch (error) {
        console.error(error);
        response.sendStatus(500);
    }
});

router.post('/caption-image', jsonParser, async (request, response) => {
    try {
        const api_key_horde = readSecret(request.user.directories, SECRET_KEYS.HORDE) || ANONYMOUS_KEY;
        const ai_horde = await getHordeClient();
        const result = await ai_horde.postAsyncInterrogate({
            source_image: request.body.image,
            forms: [{ name: ModelInterrogationFormTypes.caption }],
        }, { token: api_key_horde });

        if (!result.id) {
            console.error('Image interrogation request is not satisfyable:', result.message || 'unknown error');
            return response.sendStatus(400);
        }

        const MAX_ATTEMPTS = 200;
        const CHECK_INTERVAL = 3000;

        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            await delay(CHECK_INTERVAL);
            const status = await ai_horde.getInterrogationStatus(result.id);
            console.log(status);

            if (status.state === HordeAsyncRequestStates.done) {

                if (status.forms === undefined) {
                    console.error('Image interrogation request failed: no forms found.');
                    return response.sendStatus(500);
                }

                console.log('Image interrogation result:', status);
                const caption = status?.forms[0]?.result?.caption || '';

                if (!caption) {
                    console.error('Image interrogation request failed: no caption found.');
                    return response.sendStatus(500);
                }

                return response.send({ caption });
            }

            if (status.state === HordeAsyncRequestStates.faulted || status.state === HordeAsyncRequestStates.cancelled) {
                console.log('Image interrogation request is not successful.');
                return response.sendStatus(503);
            }
        }

    } catch (error) {
        console.error(error);
        response.sendStatus(500);
    }
});

router.post('/user-info', jsonParser, async (request, response) => {
    const api_key_horde = readSecret(request.user.directories, SECRET_KEYS.HORDE);

    if (!api_key_horde) {
        return response.send({ anonymous: true });
    }

    try {
        const ai_horde = await getHordeClient();
        const user = await ai_horde.findUser({ token: api_key_horde });
        return response.send(user);
    } catch (error) {
        console.error(error);
        return response.sendStatus(500);
    }
});

router.post('/generate-image', jsonParser, async (request, response) => {
    if (!request.body.prompt) {
        return response.sendStatus(400);
    }

    const MAX_ATTEMPTS = 200;
    const CHECK_INTERVAL = 3000;
    const PROMPT_THRESHOLD = 5000;

    try {
        const maxLength = PROMPT_THRESHOLD - String(request.body.negative_prompt).length - 5;
        if (String(request.body.prompt).length > maxLength) {
            console.log('Stable Horde prompt is too long, truncating...');
            request.body.prompt = String(request.body.prompt).substring(0, maxLength);
        }

        // Sanitize prompt if requested
        if (request.body.sanitize) {
            const sanitized = sanitizeHordeImagePrompt(request.body.prompt);

            if (request.body.prompt !== sanitized) {
                console.log('Stable Horde prompt was sanitized.');
            }

            request.body.prompt = sanitized;
        }

        const api_key_horde = readSecret(request.user.directories, SECRET_KEYS.HORDE) || ANONYMOUS_KEY;
        console.log('Stable Horde request:', request.body);

        const ai_horde = await getHordeClient();
        // noinspection JSCheckFunctionSignatures -- see @ts-ignore - use_gfpgan
        const generation = await ai_horde.postAsyncImageGenerate(
            {
                prompt: `${request.body.prompt} ### ${request.body.negative_prompt}`,
                params:
                {
                    sampler_name: request.body.sampler,
                    hires_fix: request.body.enable_hr,
                    // @ts-ignore - use_gfpgan param is not in the type definition, need to update to new ai_horde @ https://github.com/ZeldaFan0225/ai_horde/blob/main/index.ts
                    use_gfpgan: request.body.restore_faces,
                    cfg_scale: request.body.scale,
                    steps: request.body.steps,
                    width: request.body.width,
                    height: request.body.height,
                    karras: Boolean(request.body.karras),
                    clip_skip: request.body.clip_skip,
                    seed: request.body.seed >= 0 ? String(request.body.seed) : undefined,
                    n: 1,
                },
                r2: false,
                nsfw: request.body.nfsw,
                models: [request.body.model],
            },
            { token: api_key_horde });

        if (!generation.id) {
            console.error('Image generation request is not satisfyable:', generation.message || 'unknown error');
            return response.sendStatus(400);
        }

        console.log('Horde image generation request:', generation);

        const controller = new AbortController();
        request.socket.removeAllListeners('close');
        request.socket.on('close', function () {
            console.log('Horde image generation request aborted.');
            controller.abort();
            if (generation.id) ai_horde.deleteImageGenerationRequest(generation.id);
        });

        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            controller.signal.throwIfAborted();
            await delay(CHECK_INTERVAL);
            const check = await ai_horde.getImageGenerationCheck(generation.id);
            console.log(check);

            if (check.done) {
                const result = await ai_horde.getImageGenerationStatus(generation.id);
                if (result.generations === undefined) return response.sendStatus(500);
                return response.send(result.generations[0].img);
            }

            /*
            if (!check.is_possible) {
                return response.sendStatus(503);
            }
            */

            if (check.faulted) {
                return response.sendStatus(500);
            }
        }

        return response.sendStatus(504);
    } catch (error) {
        console.error(error);
        return response.sendStatus(500);
    }
});
