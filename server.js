// server.js — Backend do DARO Connect (sala de reunião com vídeo, áudio e chat)
// Requer Node.js 18+

const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const app = express();
app.use(cors());
app.get('/', (req, res) => res.send('DARO Connect backend rodando.'));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingInterval: 25000,
  pingTimeout: 40000, // mais tolerante a picos de latência do túnel gratuito da Cloudflare
  maxHttpBufferSize: 8 * 1024 * 1024, // 8MB — permite anexar imagens/arquivos no chat
});

// participantes conectados: { [socket.id]: { name, mode, avatarDataUrl, micOn, camOn, telaCompartilhada } }
const players = {};

function broadcastEstado() {
  io.emit('estado', players);
}

const MODOS_VALIDOS = ['camera', 'avatar', 'nenhum'];

io.on('connection', (socket) => {
  socket.on('entrar', ({ nome, modo, avatarDataUrl } = {}) => {
    const modoFinal = MODOS_VALIDOS.includes(modo) ? modo : 'camera';
    players[socket.id] = {
      name: String(nome || 'Convidado').slice(0, 30),
      mode: modoFinal,
      avatarDataUrl: modoFinal === 'avatar' ? (avatarDataUrl || null) : null,
      micOn: true,
      camOn: modoFinal === 'camera',
      telaCompartilhada: false,
    };
    broadcastEstado();
  });

  socket.on('mic-estado', ({ ligado } = {}) => {
    const p = players[socket.id];
    if (!p) return;
    p.micOn = !!ligado;
    broadcastEstado();
  });

  socket.on('tela-estado', ({ compartilhando } = {}) => {
    const p = players[socket.id];
    if (!p) return;
    p.telaCompartilhada = !!compartilhando;
    broadcastEstado();
  });

  socket.on('cam-estado', ({ ligada } = {}) => {
    const p = players[socket.id];
    if (!p) return;
    p.camOn = !!ligada;
    broadcastEstado();
  });

  // Chat — sala única, mensagem vale pra todo mundo
  socket.on('mensagem', ({ texto, arquivo } = {}) => {
    const p = players[socket.id];
    if (!p) return;
    if (!texto && !arquivo) return;
    io.emit('mensagem', {
      id: socket.id,
      autor: p.name,
      texto: texto ? String(texto).slice(0, 500) : null,
      arquivo: arquivo || null,
      ts: Date.now(),
    });
  });

  // Reação rápida (emoji flutuante)
  socket.on('reacao', ({ emoji } = {}) => {
    const p = players[socket.id];
    if (!p || !emoji) return;
    io.emit('reacao', { id: socket.id, autor: p.name, emoji: String(emoji).slice(0, 8) });
  });

  // Sinalização WebRTC (áudio/vídeo) — o servidor só repassa entre os dois lados
  socket.on('webrtc-offer', ({ to, offer } = {}) => {
    if (!to) return;
    io.to(to).emit('webrtc-offer', { from: socket.id, offer });
  });
  socket.on('webrtc-answer', ({ to, answer } = {}) => {
    if (!to) return;
    io.to(to).emit('webrtc-answer', { from: socket.id, answer });
  });
  socket.on('webrtc-ice', ({ to, candidate } = {}) => {
    if (!to) return;
    io.to(to).emit('webrtc-ice', { from: socket.id, candidate });
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
    broadcastEstado();
  });
});

const PORT = process.env.PORT || 3002;
server.listen(PORT, () => console.log('Servidor do DARO Connect rodando na porta ' + PORT));
