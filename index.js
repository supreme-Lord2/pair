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
app.use('/qr', server);
app.use('/code', code);
app.use('/pair', (req, res) => res.redirect('/'))
app.use('/ping', (req, res) => {
    res.send('alive');
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
