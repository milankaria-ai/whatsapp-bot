async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ['Ubuntu', 'Edge', '22.04.4'] // Updated stable browser fingerprint
    });

    globalSock = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            isConnected = false;
            connectedNumber = '';
            latestPairingCode = '';
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) { startBot(); }
        } else if (connection === 'open') {
            isConnected = true;
            connectedNumber = sock.user?.id ? sock.user.id.split(':')[0] : 'Connected';
            latestPairingCode = '';
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
            console.error('Error handling message:', err);
        }
    });
}
