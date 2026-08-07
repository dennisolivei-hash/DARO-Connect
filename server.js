// server.js — Backend do DARO Connect (salas de reunião com vídeo, áudio e chat)
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

// participantes conectados: { [socket.id]: { name, mode, avatarDataUrl, micOn, camOn, telaCompartilhada, ausente, salaId } }
const players = {};

const MODOS_VALIDOS = ['camera', 'avatar', 'nenhum'];
const SALA_PADRAO = 'geral';

function normalizarSala(sala) {
  const limpo = String(sala || SALA_PADRAO).trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  return (limpo || SALA_PADRAO).slice(0, 40);
}

// devolve só os participantes daquela sala, no formato { socketId: {...} }
function jogadoresDaSala(salaId) {
  const resultado = {};
  for (const [id, p] of Object.entries(players)) {
    if (p.salaId === salaId) resultado[id] = p;
  }
  return resultado;
}

function broadcastEstado(salaId) {
  io.to(salaId).emit('estado', jogadoresDaSala(salaId));
}

io.on('connection', (socket) => {
  socket.on('entrar', ({ nome, modo, avatarDataUrl, sala } = {}) => {
    const modoFinal = MODOS_VALIDOS.includes(modo) ? modo : 'camera';
    const salaId = normalizarSala(sala);

    socket.join(salaId);
    players[socket.id] = {
      name: String(nome || 'Convidado').slice(0, 30),
      mode: modoFinal,
      avatarDataUrl: modoFinal === 'avatar' ? (avatarDataUrl || null) : null,
      micOn: true,
      camOn: modoFinal === 'camera',
      telaCompartilhada: false,
      ausente: false,
      salaId,
    };
    broadcastEstado(salaId);
  });

  socket.on('ausente-estado', ({ ausente } = {}) => {
    const p = players[socket.id];
    if (!p) return;
    p.ausente = !!ausente;
    broadcastEstado(p.salaId);
  });

  socket.on('mic-estado', ({ ligado } = {}) => {
    const p = players[socket.id];
    if (!p) return;
    p.micOn = !!ligado;
    broadcastEstado(p.salaId);
  });

  socket.on('tela-estado', ({ compartilhando } = {}) => {
    const p = players[socket.id];
    if (!p) return;
    p.telaCompartilhada = !!compartilhando;
    broadcastEstado(p.salaId);
  });

  socket.on('cam-estado', ({ ligada } = {}) => {
    const p = players[socket.id];
    if (!p) return;
    p.camOn = !!ligada;
    broadcastEstado(p.salaId);
  });

  // Chat — vale só pra quem está na mesma sala
  socket.on('mensagem', ({ texto, arquivo } = {}) => {
    const p = players[socket.id];
    if (!p) return;
    if (!texto && !arquivo) return;
    io.to(p.salaId).emit('mensagem', {
      id: socket.id,
      autor: p.name,
      texto: texto ? String(texto).slice(0, 500) : null,
      arquivo: arquivo || null,
      ts: Date.now(),
    });
  });

  // Reação rápida (emoji flutuante) — só pra sala do remetente
  socket.on('reacao', ({ emoji } = {}) => {
    const p = players[socket.id];
    if (!p || !emoji) return;
    io.to(p.salaId).emit('reacao', { id: socket.id, autor: p.name, emoji: String(emoji).slice(0, 8) });
  });

  // Sinalização WebRTC (áudio/vídeo) — o servidor só repassa entre os dois lados,
  // já é isolado por socket.id, não precisa de sala aqui
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
    const p = players[socket.id];
    if (!p) return;
    const salaId = p.salaId;
    delete players[socket.id];
    broadcastEstado(salaId);
  });
});

const PORT = process.env.PORT || 3002;
server.listen(PORT, () => console.log('Servidor do DARO Connect rodando na porta ' + PORT));
