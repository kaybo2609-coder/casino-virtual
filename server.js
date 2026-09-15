const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ========== DATA ==========
const rooms = {}; // roomCode -> { players: {}, adminId, createdAt }

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function getRoomPublicData(room) {
  const players = Object.values(room.players).map(p => ({
    id: p.id,
    name: p.name,
    balance: p.balance,
    isAdmin: p.isAdmin
  }));
  return { players };
}

// ========== SOCKET ==========
io.on('connection', (socket) => {
  console.log('Usuario conectado:', socket.id);

  // Crear sala
  socket.on('createRoom', ({ name }, callback) => {
    if (!name || name.trim().length < 2) {
      return callback({ error: 'Nombre muy corto' });
    }

    let code;
    do {
      code = generateRoomCode();
    } while (rooms[code]);

    const playerId = socket.id;
    rooms[code] = {
      players: {
        [playerId]: {
          id: playerId,
          name: name.trim().substring(0, 20),
          balance: 1000,
          isAdmin: true
        }
      },
      adminId: playerId,
      createdAt: Date.now()
    };

    socket.join(code);
    socket.roomCode = code;
    socket.playerId = playerId;

    console.log(`Sala creada: ${code} por ${name}`);
    callback({ success: true, roomCode: code, player: rooms[code].players[playerId] });
    io.to(code).emit('roomUpdate', getRoomPublicData(rooms[code]));
  });

  // Unirse a sala
  socket.on('joinRoom', ({ code, name }, callback) => {
    code = (code || '').toUpperCase().trim();
    if (!rooms[code]) {
      return callback({ error: 'Sala no encontrada' });
    }
    if (!name || name.trim().length < 2) {
      return callback({ error: 'Nombre muy corto' });
    }

    // Evitar nombres duplicados
    const existingNames = Object.values(rooms[code].players).map(p => p.name.toLowerCase());
    if (existingNames.includes(name.trim().toLowerCase())) {
      return callback({ error: 'Ese nombre ya está en uso' });
    }

    const playerId = socket.id;
    rooms[code].players[playerId] = {
      id: playerId,
      name: name.trim().substring(0, 20),
      balance: 1000,
      isAdmin: false
    };

    socket.join(code);
    socket.roomCode = code;
    socket.playerId = playerId;

    console.log(`${name} se unió a la sala ${code}`);
    callback({ success: true, roomCode: code, player: rooms[code].players[playerId] });
    io.to(code).emit('roomUpdate', getRoomPublicData(rooms[code]));
  });

  // Actualizar saldo (solo admin)
  socket.on('adminSetBalance', ({ targetId, amount }, callback) => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return callback({ error: 'No estás en una sala' });

    const room = rooms[code];
    if (room.adminId !== socket.id) {
      return callback({ error: 'No eres el administrador' });
    }
    if (!room.players[targetId]) {
      return callback({ error: 'Jugador no encontrado' });
    }

    amount = parseInt(amount);
    if (isNaN(amount) || amount < 0) {
      return callback({ error: 'Cantidad inválida' });
    }

    room.players[targetId].balance = amount;
    io.to(code).emit('roomUpdate', getRoomPublicData(room));
    io.to(targetId).emit('balanceUpdate', { balance: amount });
    callback({ success: true });
  });

  // Sumar saldo (solo admin)
  socket.on('adminAddBalance', ({ targetId, amount }, callback) => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return callback({ error: 'No estás en una sala' });

    const room = rooms[code];
    if (room.adminId !== socket.id) {
      return callback({ error: 'No eres el administrador' });
    }
    if (!room.players[targetId]) {
      return callback({ error: 'Jugador no encontrado' });
    }

    amount = parseInt(amount);
    if (isNaN(amount) || amount === 0) {
      return callback({ error: 'Cantidad inválida' });
    }

    room.players[targetId].balance += amount;
    if (room.players[targetId].balance < 0) room.players[targetId].balance = 0;

    io.to(code).emit('roomUpdate', getRoomPublicData(room));
    io.to(targetId).emit('balanceUpdate', { balance: room.players[targetId].balance });
    callback({ success: true });
  });

  // Jugador actualiza su propio saldo después de jugar
  socket.on('updateMyBalance', ({ balance }) => {
    const code = socket.roomCode;
    if (!code || !rooms[code] || !rooms[code].players[socket.id]) return;

    balance = parseInt(balance);
    if (isNaN(balance) || balance < 0) return;

    rooms[code].players[socket.id].balance = balance;
    io.to(code).emit('roomUpdate', getRoomPublicData(rooms[code]));
  });

  // Desconexión
  socket.on('disconnect', () => {
    const code = socket.roomCode;
    if (code && rooms[code]) {
      const wasAdmin = rooms[code].adminId === socket.id;
      delete rooms[code].players[socket.id];

      if (Object.keys(rooms[code].players).length === 0) {
        delete rooms[code];
        console.log(`Sala ${code} eliminada (vacía)`);
      } else {
        if (wasAdmin) {
          const nextAdmin = Object.keys(rooms[code].players)[0];
          rooms[code].adminId = nextAdmin;
          rooms[code].players[nextAdmin].isAdmin = true;
          console.log(`Nuevo admin en sala ${code}: ${rooms[code].players[nextAdmin].name}`);
        }
        io.to(code).emit('roomUpdate', getRoomPublicData(rooms[code]));
      }
    }
    console.log('Usuario desconectado:', socket.id);
  });
});

// Limpiar salas viejas cada 30 min
setInterval(() => {
  const now = Date.now();
  for (const code in rooms) {
    if (now - rooms[code].createdAt > 1000 * 60 * 60 * 4) {
      delete rooms[code];
      console.log(`Sala ${code} eliminada por inactividad`);
    }
  }
}, 1000 * 60 * 30);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Casino multijugador corriendo en http://localhost:${PORT}`);
});
