const express = require('express');
const fs = require('fs');
const app = express();
__path = process.cwd();

// Ensure temp dir exists (Heroku ephemeral FS starts empty)
if (!fs.existsSync('./temp')) fs.mkdirSync('./temp', { recursive: true });
const bodyParser = require("body-parser");
const port = process.env.PORT || 8000;
let server = require('./qr'),
code = require('./pair');
require('events').EventEmitter.defaultMaxListeners = 500;
app.use(express.static(__path));
// Simple version marker so anyone can check which code a deployment runs:
//   curl https://<site>/version
// Bump this on every meaningful change.
const VERSION = 'pair-2026.09.12-3';

app.use('/qr', server);
app.use('/code', code);
app.use('/pair', (req, res) => res.redirect('/'))
app.use('/ping', (req, res) => {
    res.send('alive');
})
app.use('/version', (req, res) => {
    res.json({ version: VERSION, uptimeSeconds: Math.floor(process.uptime()) });
})
app.use('/',async (req, res, next) => {
res.sendFile(__path + '/main.html')
})
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.listen(port, () => {
    console.log(`📡 Connected on http://localhost:` + port)
})

module.exports = app
