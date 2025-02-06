import util from 'node:util';
import { Buffer } from 'node:buffer';

import fetch from 'node-fetch';
import express from 'express';

import { readSecret, SECRET_KEYS } from './secrets.js';
import { readAllChunks, extractFileFromZipBuffer, forwardFetchResponse } from '../util.js';
import { jsonParser } from '../express-common.js';

const API_NOVELAI = 'https://api.novelai.net';
const TEXT_NOVELAI = 'https://text.novelai.net';
const IMAGE_NOVELAI = 'https://image.novelai.net';

// Ban bracket generation, plus defaults
const badWordsList = [
    [3], [49356], [1431], [31715], [34387], [20765], [30702], [10691], [49333], [1266],
    [19438], [43145], [26523], [41471], [2936], [85, 85], [49332], [7286], [1115], [24],
];

const eratoBadWordsList = [
    [16067], [933, 11144], [25106, 11144], [58, 106901, 16073, 33710, 25, 109933],
    [933, 58, 11144], [128030], [58, 30591, 33503, 17663, 100204, 25, 11144],
];

const hypeBotBadWordsList = [
    [58], [60], [90], [92], [685], [1391], [1782], [2361], [3693], [4083], [4357], [4895],
    [5512], [5974], [7131], [8183], [8351], [8762], [8964], [8973], [9063], [11208],
    [11709], [11907], [11919], [12878], [12962], [13018], [13412], [14631], [14692],
    [14980], [15090], [15437], [16151], [16410], [16589], [17241], [17414], [17635],
    [17816], [17912], [18083], [18161], [18477], [19629], [19779], [19953], [20520],
    [20598], [20662], [20740], [21476], [21737], [22133], [22241], [22345], [22935],
    [23330], [23785], [23834], [23884], [25295], [25597], [25719], [25787], [25915],
    [26076], [26358], [26398], [26894], [26933], [27007], [27422], [28013], [29164],
    [29225], [29342], [29565], [29795], [30072], [30109], [30138], [30866], [31161],
    [31478], [32092], [32239], [32509], [33116], [33250], [33761], [34171], [34758],
    [34949], [35944], [36338], [36463], [36563], [36786], [36796], [36937], [37250],
    [37913], [37981], [38165], [38362], [38381], [38430], [38892], [39850], [39893],
    [41832], [41888], [42535], [42669], [42785], [42924], [43839], [44438], [44587],
    [44926], [45144], [45297], [46110], [46570], [46581], [46956], [47175], [47182],
    [47527], [47715], [48600], [48683], [48688], [48874], [48999], [49074], [49082],
    [49146], [49946], [10221], [4841], [1427], [2602, 834], [29343], [37405], [35780], [2602], [50256],
];

// Used for phrase repetition penalty
const repPenaltyAllowList = [
    [49256, 49264, 49231, 49230, 49287, 85, 49255, 49399, 49262, 336, 333, 432, 363, 468, 492, 745, 401, 426, 623, 794,
        1096, 2919, 2072, 7379, 1259, 2110, 620, 526, 487, 16562, 603, 805, 761, 2681, 942, 8917, 653, 3513, 506, 5301,
        562, 5010, 614, 10942, 539, 2976, 462, 5189, 567, 2032, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132, 588,
        803, 1040, 49209, 4, 5, 6, 7, 8, 9, 10, 11, 12],
];

const eratoRepPenWhitelist = [
    6, 1, 11, 13, 25, 198, 12, 9, 8, 279, 264, 459, 323, 477, 539, 912, 374, 574, 1051, 1550, 1587, 4536, 5828, 15058,
    3287, 3250, 1461, 1077, 813, 11074, 872, 1202, 1436, 7846, 1288, 13434, 1053, 8434, 617, 9167, 1047, 19117, 706,
    12775, 649, 4250, 527, 7784, 690, 2834, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 1210, 1359, 608, 220, 596, 956,
    3077, 44886, 4265, 3358, 2351, 2846, 311, 389, 315, 304, 520, 505, 430,
];

// Ban the dinkus and asterism
const logitBiasExp = [
    { 'sequence': [23], 'bias': -0.08, 'ensure_sequence_finish': false, 'generate_once': false },
    { 'sequence': [21], 'bias': -0.08, 'ensure_sequence_finish': false, 'generate_once': false },
];

const eratoLogitBiasExp = [
    { 'sequence': [12488], 'bias': -0.08, 'ensure_sequence_finish': false, 'generate_once': false },
    { 'sequence': [128041], 'bias': -0.08, 'ensure_sequence_finish': false, 'generate_once': false },
];

function getBadWordsList(model) {
    let list = [];

    if (model.includes('hypebot')) {
        list = hypeBotBadWordsList;
    }

    if (model.includes('clio') || model.includes('kayra')) {
        list = badWordsList;
    }

    if (model.includes('erato')) {
        list = eratoBadWordsList;
    }

    // Clone the list so we don't modify the original
    return list.slice();
}

function getLogitBiasList(model) {
    let list = [];

    if (model.includes('erato')) {
        list = eratoLogitBiasExp;
    }

    if (model.includes('clio') || model.includes('kayra')) {
        list = logitBiasExp;
    }

    return list.slice();
}

function getRepPenaltyWhitelist(model) {
    if (model.includes('clio') || model.includes('kayra')) {
        return repPenaltyAllowList.flat();
    }

    if (model.includes('erato')) {
        return eratoRepPenWhitelist.flat();
    }

    return null;
}

export const router = express.Router();

router.post('/status', jsonParser, async function (req, res) {
    if (!req.body) return res.sendStatus(400);
    const api_key_novel = readSecret(req.user.directories, SECRET_KEYS.NOVEL);

    if (!api_key_novel) {
        console.log('NovelAI Access Token is missing.');
        return res.sendStatus(400);
    }

    try {
        const response = await fetch(API_NOVELAI + '/user/subscription', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + api_key_novel,
            },
        });

        if (response.ok) {
            const data = await response.json();
            return res.send(data);
        } else if (response.status == 401) {
            console.log('NovelAI Access Token is incorrect.');
            return res.send({ error: true });
        }
        else {
            console.log('NovelAI returned an error:', response.statusText);
            return res.send({ error: true });
        }
    } catch (error) {
        console.log(error);
        return res.send({ error: true });
    }
});

router.post('/generate', jsonParser, async function (req, res) {
    if (!req.body) return res.sendStatus(400);

    const api_key_novel = readSecret(req.user.directories, SECRET_KEYS.NOVEL);

    if (!api_key_novel) {
        console.log('NovelAI Access Token is missing.');
        return res.sendStatus(400);
    }

    const controller = new AbortController();
    req.socket.removeAllListeners('close');
    req.socket.on('close', function () {
        controller.abort();
    });

    // Add customized bad words for Clio, Kayra, and Erato
    const badWordsList = getBadWordsList(req.body.model);

    if (Array.isArray(badWordsList) && Array.isArray(req.body.bad_words_ids)) {
        for (const badWord of req.body.bad_words_ids) {
            if (Array.isArray(badWord) && badWord.every(x => Number.isInteger(x))) {
                badWordsList.push(badWord);
            }
        }
    }

    // Remove empty arrays from bad words list
    for (const badWord of badWordsList) {
        if (badWord.length === 0) {
            badWordsList.splice(badWordsList.indexOf(badWord), 1);
        }
    }

    // Add default biases for dinkus and asterism
    const logitBiasList = getLogitBiasList(req.body.model);

    if (Array.isArray(logitBiasList) && Array.isArray(req.body.logit_bias_exp)) {
        logitBiasList.push(...req.body.logit_bias_exp);
    }

    const repPenWhitelist = getRepPenaltyWhitelist(req.body.model);

    const data = {
        'input': req.body.input,
        'model': req.body.model,
        'parameters': {
            'use_string': req.body.use_string ?? true,
            'temperature': req.body.temperature,
            'max_length': req.body.max_length,
            'min_length': req.body.min_length,
            'tail_free_sampling': req.body.tail_free_sampling,
            'repetition_penalty': req.body.repetition_penalty,
            'repetition_penalty_range': req.body.repetition_penalty_range,
            'repetition_penalty_slope': req.body.repetition_penalty_slope,
            'repetition_penalty_frequency': req.body.repetition_penalty_frequency,
            'repetition_penalty_presence': req.body.repetition_penalty_presence,
            'repetition_penalty_whitelist': repPenWhitelist,
            'top_a': req.body.top_a,
            'top_p': req.body.top_p,
            'top_k': req.body.top_k,
            'typical_p': req.body.typical_p,
            'mirostat_lr': req.body.mirostat_lr,
            'mirostat_tau': req.body.mirostat_tau,
            'phrase_rep_pen': req.body.phrase_rep_pen,
            'stop_sequences': req.body.stop_sequences,
            'bad_words_ids': badWordsList.length ? badWordsList : null,
            'logit_bias_exp': logitBiasList,
            'generate_until_sentence': req.body.generate_until_sentence,
            'use_cache': req.body.use_cache,
            'return_full_text': req.body.return_full_text,
            'prefix': req.body.prefix,
            'order': req.body.order,
            'num_logprobs': req.body.num_logprobs,
            'min_p': req.body.min_p,
            'math1_temp': req.body.math1_temp,
            'math1_quad': req.body.math1_quad,
            'math1_quad_entropy_scale': req.body.math1_quad_entropy_scale,
        },
    };

    // Tells the model to stop generation at '>'
    if ('theme_textadventure' === req.body.prefix) {
        if (req.body.model.includes('clio') || req.body.model.includes('kayra')) {
            data.parameters.eos_token_id = 49405;
        }
        if (req.body.model.includes('erato')) {
            data.parameters.eos_token_id = 29;
        }
    }

    console.log(util.inspect(data, { depth: 4 }));

    const args = {
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api_key_novel },
        signal: controller.signal,
    };

    try {
        const baseURL = (req.body.model.includes('kayra') || req.body.model.includes('erato')) ? TEXT_NOVELAI : API_NOVELAI;
        const url = req.body.streaming ? `${baseURL}/ai/generate-stream` : `${baseURL}/ai/generate`;
        const response = await fetch(url, { method: 'POST', ...args });

        if (req.body.streaming) {
            // Pipe remote SSE stream to Express response
            forwardFetchResponse(response, res);
        } else {
            if (!response.ok) {
                const text = await response.text();
                let message = text;
                console.log(`Novel API returned error: ${response.status} ${response.statusText} ${text}`);

                try {
                    const data = JSON.parse(text);
                    message = data.message;
                }
                catch {
                    // ignore
                }

                return res.status(response.status).send({ error: { message } });
            }

            /** @type {any} */
            const data = await response.json();
            console.log('NovelAI Output', data?.output);
            return res.send(data);
        }
    } catch (error) {
        return res.send({ error: true });
    }
});

router.post('/generate-image', jsonParser, async (request, response) => {
    if (!request.body) {
        return response.sendStatus(400);
    }

    const key = readSecret(request.user.directories, SECRET_KEYS.NOVEL);

    if (!key) {
        console.log('NovelAI Access Token is missing.');
        return response.sendStatus(400);
    }

    try {
        console.log('NAI Diffusion request:', request.body);
        const generateUrl = `${IMAGE_NOVELAI}/ai/generate-image`;
        const generateResult = await fetch(generateUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${key}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                action: 'generate',
                input: request.body.prompt ?? '',
                model: request.body.model ?? 'nai-diffusion',
                parameters: {
                    params_version: 3,
                    prefer_brownian: true,
                    negative_prompt: request.body.negative_prompt ?? '',
                    height: request.body.height ?? 512,
                    width: request.body.width ?? 512,
                    scale: request.body.scale ?? 9,
                    seed: request.body.seed >= 0 ? request.body.seed : Math.floor(Math.random() * 9999999999),
                    sampler: request.body.sampler ?? 'k_dpmpp_2m',
                    noise_schedule: request.body.scheduler ?? 'karras',
                    steps: request.body.steps ?? 28,
                    n_samples: 1,
                    // NAI handholding for prompts
                    ucPreset: 0,
                    qualityToggle: false,
                    add_original_image: false,
                    controlnet_strength: 1,
                    deliberate_euler_ancestral_bug: false,
                    dynamic_thresholding: request.body.decrisper ?? false,
                    legacy: false,
                    legacy_v3_extend: false,
                    sm: request.body.sm ?? false,
                    sm_dyn: request.body.sm_dyn ?? false,
                    uncond_scale: 1,
                    use_coords: false,
                    characterPrompts: [],
                    reference_image_multiple: [],
                    reference_information_extracted_multiple: [],
                    reference_strength_multiple: [],
                    v4_negative_prompt: {
                        caption: {
                            base_caption: request.body.negative_prompt ?? '',
                            char_captions: [],
                        },
                    },
                    v4_prompt: {
                        caption: {
                            base_caption: request.body.prompt ?? '',
                            char_captions: [],
                        },
                        use_coords: false,
                        use_order: true,
                    },
                },
            }),
        });

        if (!generateResult.ok) {
            const text = await generateResult.text();
            console.log('NovelAI returned an error.', generateResult.statusText, text);
            return response.sendStatus(500);
        }

        const archiveBuffer = await generateResult.arrayBuffer();
        const imageBuffer = await extractFileFromZipBuffer(archiveBuffer, '.png');

        if (!imageBuffer) {
            console.warn('NovelAI generated an image, but the PNG file was not found.');
            return response.sendStatus(500);
        }

        const originalBase64 = imageBuffer.toString('base64');

        // No upscaling
        if (isNaN(request.body.upscale_ratio) || request.body.upscale_ratio <= 1) {
            return response.send(originalBase64);
        }

        try {
            console.debug('Upscaling image...');
            const upscaleUrl = `${API_NOVELAI}/ai/upscale`;
            const upscaleResult = await fetch(upscaleUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${key}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    image: originalBase64,
                    height: request.body.height,
                    width: request.body.width,
                    scale: request.body.upscale_ratio,
                }),
            });

            if (!upscaleResult.ok) {
                throw new Error('NovelAI returned an error.');
            }

            const upscaledArchiveBuffer = await upscaleResult.arrayBuffer();
            const upscaledImageBuffer = await extractFileFromZipBuffer(upscaledArchiveBuffer, '.png');

            if (!upscaledImageBuffer) {
                throw new Error('NovelAI upscaled an image, but the PNG file was not found.');
            }

            const upscaledBase64 = upscaledImageBuffer.toString('base64');

            return response.send(upscaledBase64);
        } catch (error) {
            console.warn('NovelAI generated an image, but upscaling failed. Returning original image.');
            return response.send(originalBase64);
        }
    } catch (error) {
        console.log(error);
        return response.sendStatus(500);
    }
});

router.post('/generate-voice', jsonParser, async (request, response) => {
    const token = readSecret(request.user.directories, SECRET_KEYS.NOVEL);

    if (!token) {
        console.log('NovelAI Access Token is missing.');
        return response.sendStatus(400);
    }

    const text = request.body.text;
    const voice = request.body.voice;

    if (!text || !voice) {
        return response.sendStatus(400);
    }

    try {
        const url = `${API_NOVELAI}/ai/generate-voice?text=${encodeURIComponent(text)}&voice=-1&seed=${encodeURIComponent(voice)}&opus=false&version=v2`;
        const result = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'audio/mpeg',
            },
        });

        if (!result.ok) {
            const errorText = await result.text();
            console.log('NovelAI returned an error.', result.statusText, errorText);
            return response.sendStatus(500);
        }

        const chunks = await readAllChunks(result.body);
        const buffer = Buffer.concat(chunks.map(chunk => new Uint8Array(chunk)));
        response.setHeader('Content-Type', 'audio/mpeg');
        return response.send(buffer);
    }
    catch (error) {
        console.error(error);
        return response.sendStatus(500);
    }
});
