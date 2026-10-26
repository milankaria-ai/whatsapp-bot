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

let clientContacts = {}; 
let messageLogs = [];    
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
                let senderName = clientContacts[remoteJid] || remoteJid.split('@')[0];

                messageLogs.push({
                    name: senderName,
                    jid: remoteJid,
                    text: text,
                    type: 'incoming',
                    time: new Date().toLocaleTimeString()
                });

                io.emit('new_message', messageLogs[messageLogs.length - 1]);
            }
        } catch (err) {
            console.error('Error handling message:', err);
        }
    });
}

startBot();

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// API to format exact message and send with banner.jpg
app.post('/send-dispatch', async (sReq, sRes) => {
    const { jid, name, panels } = sReq.body;
    if (globalSock && jid && panels) {
        if (name) {
            clientContacts[jid] = name;
        }

        // Exact formatted message as provided by user
        let messageText = `Site : ${panels[0].url} 🔑\n`;
        messageText += `User 🆔 :${panels[0].user}\n`;
        messageText += `Pass : ${panels[0].pass}\n`;
        messageText += `1 point @ 1 Rupees\nFancy Minimum Bet 100\nMatch Minimum Bet 100\n\n`;
        messageText += `     ♛ *${panels[1].title}*  ♛\n\n`;
        messageText += `Site : ${panels[1].url} 🔑\n`;
        messageText += `User 🆔 : ${panels[1].user}\n`;
        messageText += `Pass : ${panels[1].pass}\n`;
        messageText += `1 point @ 1 Rupees\nFancy Minimum Bet 100\nMatch Minimum Bet 100\n\n`;
        messageText += `♛${panels[2].title} ♛\n\n`;
        messageText += `${panels[2].url}\n\n`;
        messageText += `Username :-${panels[2].user}\n`;
        messageText += `PASSWORD=${panels[2].pass}\n\n`;
        messageText += `MINIMUM ID = 100\nMINIMUM BET = 100\n`;
        messageText += `꧁💰𝐇𝐀𝐏𝐏𝐘 𝐆𝐀𝐌𝐈𝐍𝐆💰꧂\n\n`;
        messageText += `For New I'd and More Details, Kindly Sent 'Hi Sonu' on 8988507777\n`;
        messageText += `*"Limited Offer 10% Bonus on First Deposit and Referal Id Bonus 5%"*\n`;
        messageText += `HURRY UP !\n`;
        messageText += `"High Risk High Reward ! Play Big, Win Big"`;

        try {
            const imagePath = path.join(__dirname, 'banner.jpg');
            await globalSock.sendMessage(jid, {
                image: { url: imagePath },
                caption: messageText
            });
        } catch (e) {
            await globalSock.sendMessage(jid, { text: messageText });
        }
        
        const logEntry = {
            name: name || clientContacts[jid] || jid.split('@')[0],
            jid: jid,
            text: messageText,
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
