const { makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(__dirname));

let sock;
const dbPath = path.join(__dirname, 'clients.json');
const logsDbPath = path.join(__dirname, 'messages.json');
const authFolder = path.join(__dirname, 'auth_info_baileys');

let clientStore = {};
if (fs.existsSync(dbPath)) {
    try {
        clientStore = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    } catch (e) {
        clientStore = {};
    }
}

function saveClients() {
    fs.writeFileSync(dbPath, JSON.stringify(clientStore, null, 2));
}

let messageLogs = [];
if (fs.existsSync(logsDbPath)) {
    try {
        messageLogs = JSON.parse(fs.readFileSync(logsDbPath, 'utf8'));
    } catch (e) {
        messageLogs = [];
    }
}

function saveLogs() {
    fs.writeFileSync(logsDbPath, JSON.stringify(messageLogs, null, 2));
}

function getCleanNumber(jidOrPhone) {
    if (!jidOrPhone) return '';
    let str = jidOrPhone.toString();
    let num = str.replace('@s.whatsapp.net', '').replace('@g.us', '').replace('@lid', '').replace(/\D/g, '');
    if (num.length > 12 && !num.startsWith('91')) return '';
    if (num.length > 10 && num.startsWith('91')) num = num.slice(-10);
    if (num.length !== 10) return '';
    return num;
}

let connectionStatus = "Connecting...";

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);
    sock = makeWASocket({
        auth: state,
        printQRInTerminal: true
    });

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (update) => {
        const { connection } = update;
        if (connection === 'open') {
            connectionStatus = "Connected";
        } else if (connection === 'close') {
            connectionStatus = "Disconnected";
            setTimeout(connectToWhatsApp, 5000);
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type === 'notify') {
            for (const msg of messages) {
                if (!msg.message) continue;
                
                const isFromMe = msg.key.fromMe;
                let senderJid = msg.key.remoteJid;
                if (msg.key.participant) {
                    senderJid = msg.key.participant;
                }

                let cleanNum = getCleanNumber(senderJid);
                let resolvedName = clientStore[senderJid] || clientStore[cleanNum];
                if (!resolvedName) {
                    let found = messageLogs.slice().reverse().find(m => 
                        (m.rawJid === senderJid || m.displayPhone === cleanNum) && 
                        m.from && m.from !== 'Client' && !m.from.startsWith('3227')
                    );
                    if (found) resolvedName = found.from;
                }
                if (!resolvedName || resolvedName === 'Client' || resolvedName.startsWith('3227')) {
                    resolvedName = cleanNum || 'Client';
                }

                const text = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || '[Media/Image Message]';

                const msgId = msg.key.id || Date.now().toString();
                if (!messageLogs.some(m => m.id === msgId)) {
                    messageLogs.push({
                        id: msgId,
                        from: resolvedName,
                        displayPhone: cleanNum,
                        rawJid: senderJid,
                        text: text,
                        time: new Date().toLocaleTimeString(),
                        isFromMe: isFromMe
                    });
                    saveLogs();
                }
            }
        }
    });
}

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (username === 'admin' && password === 'admin123') {
        res.json({ success: true, message: 'Login successful!' });
    } else {
        res.status(401).json({ success: false, error: 'Invalid username or password!' });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/status', (req, res) => {
    res.json({ success: true, status: connectionStatus });
});

app.get('/messages', (req, res) => {
    res.json({ success: true, logs: messageLogs });
});

app.post('/send', async (req, res) => {
    try {
        let { phone, message, clientName, isInlineReply } = req.body;
        if (!phone || !message) {
            return res.status(400).json({ success: false, error: 'Phone and message required' });
        }

        let cleanPhone = getCleanNumber(phone);
        let targetJid = phone.includes('@') ? phone : (cleanPhone ? '91' + cleanPhone + '@s.whatsapp.net' : phone);
        
        // Ensure name persistence
        let finalName = (clientName && clientName !== 'Client') ? clientName : (clientStore[targetJid] || clientStore[cleanPhone] || clientStore[phone] || cleanPhone || 'Client');
        
        if (clientName && clientName !== 'Client') {
            clientStore[phone] = finalName;
            clientStore[targetJid] = finalName;
            if (cleanPhone) clientStore[cleanPhone] = finalName;
            saveClients();
        }

        // Send Banner ONLY if it's NOT an inline reply
        const possibleBannerNames = ['banner.jpg', 'banner.JPG', 'banner.jpeg', 'BANNER.JPG'];
        let bannerPath = null;
        if (!isInlineReply) {
            for (let bName of possibleBannerNames) {
                let p = path.join(__dirname, bName);
                if (fs.existsSync(p)) {
                    bannerPath = p;
                    break;
                }
            }
        }

        if (bannerPath) {
            const imageBuffer = fs.readFileSync(bannerPath);
            await sock.sendMessage(targetJid, { 
                image: imageBuffer,
                mimetype: 'image/jpeg',
                caption: message 
            });
        } else {
            await sock.sendMessage(targetJid, { text: message });
        }

        const newLog = {
            id: Date.now().toString(),
            from: finalName,
            displayPhone: cleanPhone,
            rawJid: targetJid,
            text: message + (bannerPath ? '\n[📸 Banner Attached]' : ''),
            time: new Date().toLocaleTimeString(),
            isFromMe: true
        };

        messageLogs.push(newLog);
        saveLogs();

        res.json({ success: true, message: 'Message sent successfully!' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.listen(3000, () => {
    console.log('Server http://localhost:3000 par chal raha hai');
});

connectToWhatsApp();