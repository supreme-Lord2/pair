'use strict';

/**
 * JuneSession — bridge between this pairing site and the June Ultra
 * Session Server (the June API database).
 *
 * After WhatsApp links, the site harvests the Baileys auth folder into a
 * snapshot (the exact shape June Ultra's restore path expects) and uploads
 * it to the Session Server intake endpoint, which stores it encrypted and
 * mints the official june-ultra:~ session token. The site then delivers
 * that token to the user — the same credential the main pairing site
 * (https://burning-lorena-eminentbo-ede53cc1.koyeb.app/pair) produces,
 * backed by the same database.
 *
 * Environment variables (set them on the hosting panel):
 *   JUNE_INTAKE_KEY          REQUIRED — site key issued by the server owner.
 *   JUNE_SESSION_SERVER_URL  Optional — defaults to the primary June
 *                            session server.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_SERVER_URL = 'https://burning-lorena-eminentbo-ede53cc1.koyeb.app';

// Same order as the June Ultra client: longest/most-specific prefixes first.
const KEY_TYPES = [
    'app-state-sync-version',
    'app-state-sync-key',
    'sender-key-memory',
    'sender-key',
    'identity-key',
    'device-list',
    'lid-mapping',
    'pre-key',
    'session',
    'tctoken',
];

function parseKeyFilename(filename) {
    if (!filename.endsWith('.json') || filename === 'creds.json') return null;
    const base = filename.slice(0, -'.json'.length);
    const type = KEY_TYPES.find((candidate) => base.startsWith(`${candidate}-`));
    if (!type) return null;
    const encodedId = base.slice(type.length + 1);
    if (!encodedId) return null;
    return { type, id: encodedId.replace(/__/g, '/').replace(/-/g, ':') };
}

function countKeyFiles(sessionDir) {
    try {
        return fs.readdirSync(sessionDir)
            .filter((name) => name !== 'creds.json' && name.endsWith('.json'))
            .length;
    } catch (_) {
        return 0;
    }
}

/**
 * Wait until the Signal key files stop changing (pre-key bundles etc. are
 * written right after linking). Bounded at maxWaitMs.
 */
async function waitForKeysToSettle(sessionDir, { stablePolls = 3, intervalMs = 2000, maxWaitMs = 40000 } = {}) {
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const start = Date.now();
    let lastCount = -1;
    let stable = 0;
    while (Date.now() - start < maxWaitMs) {
        await delay(intervalMs);
        const count = countKeyFiles(sessionDir);
        if (count === lastCount && count > 0) {
            stable += 1;
            if (stable >= stablePolls) return { count, settled: true, waitedMs: Date.now() - start };
        } else {
            stable = 0;
        }
        lastCount = count;
    }
    return { count: lastCount, settled: false, waitedMs: Date.now() - start };
}

/**
 * Build the snapshot in the exact shape June Ultra's restore path expects
 * (mirrors the official session server's harvest, including the verified
 * auth meta rows).
 */
function harvestSnapshot(sessionDir) {
    const credsPath = path.join(sessionDir, 'creds.json');
    if (!fs.existsSync(credsPath)) throw new Error('creds.json missing after pairing');
    const credsValue = fs.readFileSync(credsPath, 'utf8');
    JSON.parse(credsValue); // validate

    const now = Date.now();
    const sessionKeys = [];
    for (const name of fs.readdirSync(sessionDir)) {
        const parsed = parseKeyFilename(name);
        if (!parsed) continue;
        const value = fs.readFileSync(path.join(sessionDir, name), 'utf8');
        JSON.parse(value); // validate
        sessionKeys.push({ type: parsed.type, id: parsed.id, value, updated_at: now });
    }
    if (sessionKeys.length === 0) throw new Error('no signal key files were generated');

    return {
        version: 1,
        createdAt: now,
        sessionCreds: [{ key: 'creds', value: credsValue, updated_at: now }],
        sessionKeys,
        sessionAuthMeta: [
            { key: 'status', value: 'verified' },
            { key: 'source', value: 'june-session-server' },
            { key: 'paired_at', value: String(now) },
        ],
    };
}

/**
 * Upload the snapshot and mint the official june-ultra:~ token.
 * Returns the canonical token string.
 */
async function mintJuneToken({ phone, label, snapshot }) {
    const serverUrl = String(process.env.JUNE_SESSION_SERVER_URL || DEFAULT_SERVER_URL).trim().replace(/\/+$/, '');
    const key = String(process.env.JUNE_INTAKE_KEY || '').trim();
    if (!key) throw new Error('JUNE_INTAKE_KEY is not configured on this site — ask the server owner for the site key');

    const response = await fetch(`${serverUrl}/v1/intake/session`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ phone, label: label || undefined, snapshot }),
        signal: AbortSignal.timeout(30000),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || !data.ok || !data.token) {
        throw new Error(`session server intake failed: ${data && data.message ? data.message : `HTTP ${response.status}`}`);
    }
    return data.token;
}

module.exports = { waitForKeysToSettle, harvestSnapshot, mintJuneToken, parseKeyFilename };
