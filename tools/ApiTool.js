// ═══════════════════════════════════════════════════════════════════════════
// ApiTool.js — HTTP API caller
// MAX can hit REST endpoints, parse responses, handle auth
// ═══════════════════════════════════════════════════════════════════════════

import fetch from 'node-fetch';

export const ApiTool = {
    name: 'api',
    description: 'Make HTTP requests to REST APIs',

    actions: {
        async request({ url, method = 'GET', headers = {}, body = null, timeoutMs = 15000 }) {
            const options = {
                method,
                headers: { 'Content-Type': 'application/json', ...headers },
                signal: AbortSignal.timeout(timeoutMs)
            };

            if (body && method !== 'GET') {
                options.body = typeof body === 'string' ? body : JSON.stringify(body);
            }

            try {
                const res = await fetch(url, options);
                const contentType = res.headers.get('content-type') || '';
                let data;

                if (contentType.includes('application/json')) {
                    data = await res.json();
                } else {
                    data = await res.text();
                }

                return {
                    success: res.ok,
                    status:  res.status,
                    headers: Object.fromEntries(res.headers.entries()),
                    data
                };
            } catch (err) {
                return { success: false, error: err.message };
            }
        },

        async get({ url, headers = {} }) {
            return ApiTool.actions.request({ url, method: 'GET', headers });
        },

        async post({ url, body, headers = {} }) {
            return ApiTool.actions.request({ url, method: 'POST', body, headers });
        }
    }
};
