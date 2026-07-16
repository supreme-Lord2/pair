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

let router = express.Router();

function removeFile(FilePath) {
    if (!fs.existsSync(FilePath)) return false;
    fs.rmSync(FilePath, { recursive: true, force: true });
}

router.get('/', async (req, res) => {
    const id = makeid();

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
                        await delay(5000);
                        let data = fs.readFileSync(__dirname + `/temp/${id}/creds.json`);
                        await delay(2000);
                        let b64data = Buffer.from(data).toString('base64');
                        let session = await client.sendMessage(userJid, { text: 'Ultra-X:~' + b64data });
                        await client.sendMessage(userJid, {
                            text: "```⚡ JuneX Ultra has been linked to your WhatsApp account!\n\nDo NOT share this session_id with anyone.\n\nCopy and paste it on the SESSION string during deploy — it will be used for authentication.\n\nFor any issues, reach us via:\nhttps://wa.me/message/YNDA2RFTE35LB1\n\nDon't forget to sleep 😴, for even the relentless must recharge ⚡.\n\nGoodluck 🎉 — JuneX Ultra```"
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
