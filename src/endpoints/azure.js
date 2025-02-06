import fetch from 'node-fetch';
import { Router } from 'express';

import { readSecret, SECRET_KEYS } from './secrets.js';
import { jsonParser } from '../express-common.js';

export const router = Router();

router.post('/list', jsonParser, async (req, res) => {
    try {
        const key = readSecret(req.user.directories, SECRET_KEYS.AZURE_TTS);

        if (!key) {
            console.error('Azure TTS API Key not set');
            return res.sendStatus(403);
        }

        const region = req.body.region;

        if (!region) {
            console.error('Azure TTS region not set');
            return res.sendStatus(400);
        }

        const url = `https://${region}.tts.speech.microsoft.com/cognitiveservices/voices/list`;

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Ocp-Apim-Subscription-Key': key,
            },
        });

        if (!response.ok) {
            console.error('Azure Request failed', response.status, response.statusText);
            return res.sendStatus(500);
        }

        const voices = await response.json();
        return res.json(voices);
    } catch (error) {
        console.error('Azure Request failed', error);
        return res.sendStatus(500);
    }
});

router.post('/generate', jsonParser, async (req, res) => {
    try {
        const key = readSecret(req.user.directories, SECRET_KEYS.AZURE_TTS);

        if (!key) {
            console.error('Azure TTS API Key not set');
            return res.sendStatus(403);
        }

        const { text, voice, region } = req.body;
        if (!text || !voice || !region) {
            console.error('Missing required parameters');
            return res.sendStatus(400);
        }

        const url = `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
        const lang = String(voice).split('-').slice(0, 2).join('-');
        const escapedText = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang}'><voice xml:lang='${lang}' name='${voice}'>${escapedText}</voice></speak>`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Ocp-Apim-Subscription-Key': key,
                'Content-Type': 'application/ssml+xml',
                'X-Microsoft-OutputFormat': 'webm-24khz-16bit-mono-opus',
            },
            body: ssml,
        });

        if (!response.ok) {
            console.error('Azure Request failed', response.status, response.statusText);
            return res.sendStatus(500);
        }

        const audio = Buffer.from(await response.arrayBuffer());
        res.set('Content-Type', 'audio/ogg');
        return res.send(audio);
    } catch (error) {
        console.error('Azure Request failed', error);
        return res.sendStatus(500);
    }
});
