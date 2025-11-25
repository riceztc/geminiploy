const { Server } = require("socket.io");
const http = require("http");

const server = http.createServer();
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const rooms = {}; // { roomId: { id, name, hostId, socketHostId, players: [], status } }

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // Get Room List
  socket.on("get_rooms", () => {
    socket.emit("rooms_list_update", Object.values(rooms));
  });

  // Create Room
  socket.on("create_room", ({ roomName, hostName, hostId }) => {
    const roomId = Math.random().toString(36).substring(2, 9);
    const newRoom = {
      id: roomId,
      name: roomName,
      hostId: hostId, 
      socketHostId: socket.id,
      players: [{ id: hostId, name: hostName, isAI: false, isHost: true, socketId: socket.id }],
      status: 'WAITING',
      maxPlayers: 4,
      createdAt: Date.now()
    };
    rooms[roomId] = newRoom;
    socket.join(roomId);
    
    io.emit("rooms_list_update", Object.values(rooms));
    socket.emit("room_joined", { roomId, room: newRoom });
  });

  // Join Room
  socket.on("join_room", ({ roomId, user }) => {
    const room = rooms[roomId];
    if (room && room.status === 'WAITING' && room.players.length < room.maxPlayers) {
      const newPlayer = { ...user, isAI: false, isHost: false, socketId: socket.id };
      room.players.push(newPlayer);
      socket.join(roomId);
      
      io.emit("rooms_list_update", Object.values(rooms));
      io.to(roomId).emit("room_player_update", room);
      socket.emit("room_joined", { roomId, room });
    }
  });

  // Host Adds AI
  socket.on("add_ai", ({ roomId, aiPlayer }) => {
    const room = rooms[roomId];
    if (room && room.socketHostId === socket.id && room.players.length < room.maxPlayers) {
        room.players.push(aiPlayer);
        io.to(roomId).emit("room_player_update", room);
        io.emit("rooms_list_update", Object.values(rooms));
    }
  });

  // Start Game
  socket.on("start_game", ({ roomId, initialGameState }) => {
    if (rooms[roomId] && rooms[roomId].socketHostId === socket.id) {
      rooms[roomId].status = 'PLAYING';
      io.emit("rooms_list_update", Object.values(rooms));
      io.to(roomId).emit("game_started", initialGameState);
    }
  });

  // Host Syncs Game State
  socket.on("update_game_state", ({ roomId, state }) => {
    // Broadcast to everyone else in the room
    socket.to(roomId).emit("game_state_sync", state);
  });

  // Client Sends Action to Host
  socket.on("client_action", ({ roomId, action }) => {
    const room = rooms[roomId];
    if (room) {
      // Forward the action to the Host's socket ID
      io.to(room.socketHostId).emit("receive_action", action);
    }
  });

  // Handle Disconnect (Simplified)
  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    // In a full production app, you would handle room cleanup or host migration here.
    // For this version, if host disconnects, the room might become unresponsive.
  });
});

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`Socket.IO Server running on port ${PORT}`);
});