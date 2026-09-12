const { makeid } = require('./id');
const QRCode = require('qrcode');
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
const { waitForKeysToSettle, harvestSnapshot, mintJuneToken } = require('./juneSession');

let router = express.Router();

function removeFile(FilePath) {
    if (!fs.existsSync(FilePath)) return false;
    fs.rmSync(FilePath, { recursive: true, force: true });
}

router.get('/', async (req, res) => {
    const id = makeid();
    let reconnects = 0;
    const MAX_RECONNECTS = 3;

    async function JUNEX() {
        const { state, saveCreds } = await useMultiFileAuthState('./temp/' + id);
        try {
            // No hardcoded fallback version — a stale one makes WhatsApp
            // reject the link ("Couldn't link device"). If the fetch fails,
            // let Baileys use its bundled (current) version instead.
            const version = (await fetchLatestBaileysVersion().catch(() => null))?.version;
            const logger = pino({ level: 'silent' });

            let client = makeWASocket({
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

            client.ev.on('connection.update', async (s) => {
                const { connection, lastDisconnect, qr } = s;

                if (qr && !res.headersSent) {
                    await res.end(await QRCode.toBuffer(qr));
                }

                if (connection === 'open') {
                    try {
                        const userJid = jidNormalizedUser(client.user.id);
                        await client.sendMessage(userJid, {
                            text: '⚡ *JuneX Ultra* ⚡\nGenerating your session, please wait a moment...'
                        });

                        // Signal keys are written right after linking — wait
                        // for them to settle, then upload.
                        const dir = __dirname + '/temp/' + id;
                        await waitForKeysToSettle(dir);

                        const snapshot = harvestSnapshot(dir);
                        const phone = String(client.user.id).split(':')[0].split('@')[0].replace(/\D/g, '');
                        const token = await mintJuneToken({ phone, snapshot });

                        // The bare token — one-tap copy.
                        let session = await client.sendMessage(userJid, { text: token });
                        await client.sendMessage(userJid, {
                            text: "```⚡ JuneX Ultra has been linked to your WhatsApp account!\n\nDo NOT share this session token with anyone.\n\nCopy and paste it as SESSION_ID during deploy — it will be used for authentication.\n\nFor any issues, reach us via:\nhttps://wa.me/message/YNDA2RFTE35LB1\n\nDon't forget to sleep 😴, for even the relentless must recharge ⚡.\n\nGoodluck 🎉 — JuneX Ultra```"
                        }, { quoted: session });
                        await delay(500);
                        await client.ws.close();
                        removeFile('./temp/' + id);
                    } catch (e) {
                        console.log('Error sending session messages:', e.message);
                        try {
                            await client.sendMessage(jidNormalizedUser(client.user.id), {
                                text: '⚠️ Session could not be completed. Please scan again.'
                            });
                        } catch (_) {}
                        try { await client.ws.close(); } catch (_) {}
                        removeFile('./temp/' + id);
                    }
                } else if (connection === 'close') {
                    const code = lastDisconnect?.error?.output?.statusCode;
                    if (code !== DisconnectReason.loggedOut) {
                        // Reconnecting with the SAME auth folder keeps the
                        // scanned session valid; the cap stops dead networks
                        // from looping forever.
                        reconnects += 1;
                        if (reconnects <= MAX_RECONNECTS) {
                            await delay(5000);
                            JUNEX();
                        } else {
                            removeFile('./temp/' + id);
                        }
                    } else {
                        removeFile('./temp/' + id);
                    }
                }
            });

        } catch (err) {
            console.log('QR service error:', err.message);
            if (!res.headersSent) {
                await res.json({ code: 'Service is Currently Unavailable' });
            }
            removeFile('./temp/' + id);
        }
    }

    return await JUNEX();
});

module.exports = router;
