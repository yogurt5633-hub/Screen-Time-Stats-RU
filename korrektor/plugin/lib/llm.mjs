import http from 'node:http';
import https from 'node:https';
import { connectionBody, connectionInfo } from './st-settings.mjs';
import { httpError } from './util.mjs';

// Model calls go through SillyTavern's own endpoint
// /api/backends/chat-completions/generate on the loopback address.
// SillyTavern adds the API key on its side, so the key never reaches this plugin.

const GENERATE_PATH = '/api/backends/chat-completions/generate';
const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

/** Captures what is needed to call SillyTavern back as the same user. Kept in memory only. */
export function captureAuth(request) {
    const socket = request.socket;
    return {
        port: socket.localPort,
        tls: Boolean(socket.encrypted),
        cookie: request.headers.cookie || '',
        authorization: request.headers.authorization || '',
        csrf: request.headers['x-csrf-token'] || '',
        at: Date.now(),
    };
}

function postLoopback(auth, urlPath, body, host) {
    const payload = Buffer.from(JSON.stringify(body), 'utf8');
    const transport = auth.tls ? https : http;
    const headers = {
        'Content-Type': 'application/json',
        'Content-Length': payload.length,
        'Accept': 'application/json',
    };
    if (auth.cookie) headers.Cookie = auth.cookie;
    if (auth.authorization) headers.Authorization = auth.authorization;
    if (auth.csrf) headers['X-CSRF-Token'] = auth.csrf;

    return new Promise((resolve, reject) => {
        const req = transport.request({
            host,
            port: auth.port,
            path: urlPath,
            method: 'POST',
            headers,
            // Loopback to our own server: its certificate may be self-signed.
            rejectUnauthorized: false,
            timeout: REQUEST_TIMEOUT_MS,
        }, res => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
            res.on('error', reject);
        });
        req.on('timeout', () => req.destroy(new Error('Модель не ответила за 10 минут')));
        req.on('error', reject);
        req.end(payload);
    });
}

async function postToSillyTavern(auth, urlPath, body) {
    try {
        return await postLoopback(auth, urlPath, body, '127.0.0.1');
    } catch (error) {
        if (error.code === 'ECONNREFUSED') {
            return postLoopback(auth, urlPath, body, '::1');
        }
        throw error;
    }
}

/** Pulls plain text out of whatever shape the selected backend returned. */
export function extractText(data) {
    if (!data || typeof data !== 'object') return typeof data === 'string' ? data : '';
    // Claude through SillyTavern: original content blocks are passed along.
    if (Array.isArray(data.content)) {
        const text = data.content.filter(b => b && b.type === 'text' && typeof b.text === 'string').map(b => b.text).join('');
        if (text) return text;
    }
    const message = data.choices?.[0]?.message;
    if (message) {
        if (typeof message.content === 'string') return message.content;
        if (Array.isArray(message.content)) {
            return message.content.map(part => (typeof part === 'string' ? part : part?.text || '')).join('');
        }
    }
    if (typeof data.choices?.[0]?.text === 'string') return data.choices[0].text;
    if (typeof data.text === 'string') return data.text;
    if (typeof data.output === 'string') return data.output;
    return '';
}

/** Finds the first JSON object or array in a model reply (fenced or bare). */
export function extractJson(text) {
    const value = String(text ?? '').trim();
    const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidates = [];
    if (fenced) candidates.push(fenced[1]);
    candidates.push(value);
    for (const candidate of candidates) {
        try {
            return JSON.parse(candidate);
        } catch {
            // try the bracketed part
        }
        const starts = [candidate.indexOf('{'), candidate.indexOf('[')].filter(i => i >= 0);
        if (!starts.length) continue;
        const start = Math.min(...starts);
        const close = candidate[start] === '{' ? '}' : ']';
        const end = candidate.lastIndexOf(close);
        if (end > start) {
            try {
                return JSON.parse(candidate.slice(start, end + 1));
            } catch {
                // keep looking
            }
        }
    }
    throw httpError(502, 'Модель ответила не в формате JSON');
}

export class LlmClient {
    /**
     * @param {object} options
     * @param {object} options.auth what captureAuth() returned
     * @param {object} options.settings plugin settings
     * @param {object} options.stSettings SillyTavern settings.json
     */
    constructor({ auth, settings, stSettings }) {
        this.auth = auth;
        this.settings = settings;
        this.stSettings = stSettings;
        this.calls = 0;
    }

    get available() {
        return Boolean(this.auth && this.auth.port);
    }

    resolve(task) {
        const conn = connectionInfo(this.stSettings);
        const models = this.settings.models;
        const tier = this.settings.tasks?.[task] === 'scan' ? 'scan' : 'heavy';
        const source = models.source || conn.source;
        const model = (tier === 'scan' ? models.scan : models.heavy) || conn.model;
        const effort = tier === 'scan' ? models.scanEffort : models.heavyEffort;
        return { source, model, tier, effort };
    }

    /**
     * One request, one answer. Sampling parameters are left out on purpose:
     * current Claude models reject non-default temperature/top_p/top_k.
     */
    async complete({ task, system, user, maxTokens }) {
        if (!this.available) {
            throw httpError(409, 'Нет связи с сессией SillyTavern. Откройте приложение, чтобы проверка с моделью заработала');
        }
        const { source, model, tier, effort } = this.resolve(task);
        if (!source) throw httpError(400, 'В SillyTavern не выбран источник Chat Completion');
        if (!model) throw httpError(400, 'Не задана модель для этой задачи. Укажите её в настройках');

        const body = {
            chat_completion_source: source,
            model,
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: user },
            ],
            max_tokens: maxTokens ?? (tier === 'scan' ? 6000 : 16000),
            stream: false,
            type: 'quiet',
            ...connectionBody(this.stSettings, source),
        };
        if (source === 'claude' && effort && effort !== 'auto') {
            body.reasoning_effort = effort;
        }

        this.calls++;
        const res = await postToSillyTavern(this.auth, GENERATE_PATH, body);
        if (res.status === 403) {
            throw httpError(401, 'SillyTavern отклонил запрос: сессия устарела. Откройте приложение заново');
        }
        let data = null;
        try {
            data = JSON.parse(res.text);
        } catch {
            data = res.text;
        }
        if (res.status >= 400 || data?.error) {
            const message = typeof data?.error?.message === 'string' ? data.error.message
                : typeof data === 'string' && data ? data.slice(0, 300)
                    : 'подробности в консоли SillyTavern';
            throw httpError(502, `Модель ${model} вернула ошибку: ${message}`);
        }
        const text = extractText(data).trim();
        if (!text) throw httpError(502, `Модель ${model} вернула пустой ответ`);
        return { text, model, source, tier };
    }

    async completeJson(options) {
        const result = await this.complete(options);
        return { ...result, json: extractJson(result.text) };
    }
}
