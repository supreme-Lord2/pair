const { makeid } = require('./id');
const express = require('express');
const fs = require('fs');
const pino = require('pino');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    Browsers,
    delay,
    makeCacheableSignalKeyStore,
    fetchLatestBaileysVersion,
    DisconnectReason,
    jidNormalizedUser,
} = require("@whiskeysockets/baileys");

const router = express.Router();

function removeFile(filePath) {
    if (!fs.existsSync(filePath)) return false;
    fs.rmSync(filePath, { recursive: true, force: true });
}

/** Resolves once client.ws is open, or rejects after `timeoutMs` */
function waitForWsOpen(client, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
        const deadline = Date.now() + timeoutMs;
        const tick = () => {
            if (client.ws && client.ws.isOpen) return resolve();
            if (Date.now() > deadline) return reject(new Error('WS open timeout'));
            setTimeout(tick, 150);
        };
        tick();
    });
}

router.get('/', async (req, res) => {
    const id = makeid();
    let num = req.query.number;

    async function JUNEX() {
        const { state, saveCreds } = await useMultiFileAuthState('./temp/' + id);
        try {
            let version;
            try {
                ({ version } = await fetchLatestBaileysVersion());
            } catch {
                version = [2, 3000, 1015901307]; // fallback if GitHub is unreachable
            }
            const logger = pino({ level: 'silent' });

            const client = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, logger),
                },
                printQRInTerminal: false,
                logger,
                browser: Browsers.ubuntu('Chrome'),
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 10000,
            });

            client.ev.on('creds.update', saveCreds);

            // Request pairing code as soon as the WS noise handshake finishes
            // (before WhatsApp enters QR mode with pair-device IQ).
            // We poll ws.isOpen then add ~800ms for the noise handshake to settle.
            waitForWsOpen(client)
                .then(() => delay(800))
                .then(async () => {
                    if (res.headersSent || client.authState.creds.registered) return;
                    try {
                        const cleanNum = num.replace(/[^0-9]/g, '');
                        const code = await client.requestPairingCode(cleanNum);
                        if (!res.headersSent) res.send({ code });
                    } catch (e) {
                        console.log('Pairing code request error:', e.message);
                        if (!res.headersSent) res.send({ code: 'Service Currently Unavailable' });
                        removeFile('./temp/' + id);
                    }
                })
                .catch(e => {
                    console.log('WS open error:', e.message);
                    if (!res.headersSent) res.send({ code: 'Service Currently Unavailable' });
                    removeFile('./temp/' + id);
                });

            client.ev.on('connection.update', async (s) => {
                const { connection, lastDisconnect } = s;

                if (connection === 'open') {
                    try {
                        // Normalize JID: strips device suffix (:X) so messages reach the user's chat
                        const userJid = jidNormalizedUser(client.user.id);
                        await client.sendMessage(userJid, {
                            text: '⚡ *JuneX Ultra* ⚡\nGenerating your session, please wait a moment...'
                        });
                        await delay(5000);
                        const data = fs.readFileSync(__dirname + `/temp/${id}/creds.json`);
                        await delay(2000);
                        const b64data = Buffer.from(data).toString('base64');
                        const session = await client.sendMessage(userJid, { text: 'Ultra-X:~' + b64data });
                        await client.sendMessage(userJid, {
                            text: " Session paired successful ✅"
                        }, { quoted: session });
                        await delay(500);
                        await client.ws.close();
                        removeFile('./temp/' + id);
                    } catch (e) {
                        console.log('Error sending session messages:', e.message);
                    }
                } else if (connection === 'close') {
                    const code = lastDisconnect?.error?.output?.statusCode;
                    if (code !== DisconnectReason.loggedOut) {
                        await delay(5000);
                        JUNEX();
                    }
                }
            });

        } catch (err) {
            console.log('Pair service error:', err.message);
            removeFile('./temp/' + id);
            if (!res.headersSent) res.send({ code: 'Service Currently Unavailable' });
        }
    }

    await JUNEX();
});

module.exports = router;
