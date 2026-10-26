const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const http = require('http');
const path = require('path');
const pino = require('pino');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = require('socket.io')(server);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname)));

let clientContacts = {}; 
let messageLogs = [];        
let globalSock = null;
let isConnected = false;
let connectedNumber = '';

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
            isConnected = false;
            connectedNumber = '';
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) { startBot(); }
        } else if (connection === 'open') {
            isConnected = true;
            connectedNumber = sock.user?.id ? sock.user.id.split(':')[0] : 'Connected';
            console.log('WhatsApp Connected Successfully!', connectedNumber);
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg.key.fromMe && msg.message) {
                const remoteJid = msg.key.remoteJid;
                const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
                let senderName = clientContacts[remoteJid] || remoteJid.split('@')[0];

                const logEntry = {
                    name: senderName,
                    jid: remoteJid,
                    text: text,
                    type: 'incoming',
                    time: new Date().toLocaleTimeString()
                };
                messageLogs.push(logEntry);
                io.emit('new_message', logEntry);
            }
        } catch (err) {
            console.error('Error handling message:', err
