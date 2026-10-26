const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const http = require('http');
const path = require('path');
const pino = require('pino');

const app = express();
const server = http.createServer(app);

// Serve static files (like logo.png and banner.jpeg)
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: true
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed due to ', lastDisconnect?.error, ', reconnecting ', shouldReconnect);
            if (shouldReconnect) {
                startBot();
            }
        } else if (connection === 'open') {
            console.log('Connected to WhatsApp successfully!');
        }
    });

    // Client message ke sath banner.jpeg bhejne ka logic
    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg.key.fromMe && msg.message) {
                const remoteJid = msg.key.remoteJid;
                const messageContent = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
                
                console.log(`Received message from ${remoteJid}: ${messageContent}`);

                const imagePath = path.join(__dirname, 'banner.jpeg');
                
                await sock.sendMessage(remoteJid, {
                    image: { url: imagePath },
                    caption: 'Welcome to Apex Media Grid! For new ID and more details, check out our banner above.'
                });
            }
        } catch (error) {
            console.error('Error handling message:', error);
        }
    });
}

startBot();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
