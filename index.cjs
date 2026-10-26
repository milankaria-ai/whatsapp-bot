const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const http = require('http');
const path = require('path');
const pino = require('pino');

const app = express();
const server = http.createServer(app);
const io = require('socket.io')(server);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Simple in-memory storage for contacts mapping and messages
let clientContacts = {}; // { jid: name }
let messageLogs = [];    // [{ name, jid, text, type, time }]

let globalSock = null;

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: true
    });

    globalSock = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) { startBot(); }
        } else if (connection === 'open') {
            console.log('WhatsApp Connected Successfully!');
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg.key.fromMe && msg.message) {
                const remoteJid = msg.key.remoteJid;
                const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
                
                // Get name or fallback to JID
                let senderName = clientContacts[remoteJid] || remoteJid.split('@')[0];

                messageLogs.push({
                    name: senderName,
                    jid: remoteJid,
                    text: text,
                    type: 'incoming',
                    time: new Date().toLocaleTimeString()
                });

                io.emit('new_message', messageLogs[messageLogs.length - 1]);

                // Send banner image automatically
                const imagePath = path.join(__dirname, 'banner.jpeg');
                await sock.sendMessage(remoteJid, {
                    image: { url: imagePath },
                    caption: `Welcome to Apex Media Grid! For new ID and details, check our banner above.`
                });
            }
        } catch (err) {
            console.error('Error handling message:', err);
        }
    });
}

startBot();

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// API to send message from dashboard inbox with Name mapping
app.post('/send-message', async (sReq, sRes) => {
    const { jid, name, message } = sReq.body;
    if (globalSock && jid && message) {
        if (name) {
            clientContacts[jid] = name;
        }
        await globalSock.sendMessage(jid, { text: message });
        
        const logEntry = {
            name: name || clientContacts[jid] || jid.split('@')[0],
            jid: jid,
            text: message,
            type: 'outgoing',
            time: new Date().toLocaleTimeString()
        };
        messageLogs.push(logEntry);
        io.emit('new_message', logEntry);
        sRes.json({ success: true });
    } else {
        sRes.json({ success: false, error: 'Bot not connected or missing fields' });
    }
});

app.get('/messages', (req, res) => {
    res.json(messageLogs);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
