const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// 存放所有房間資料
// 結構: { roomCode: { password, hostId, players: [{id, name, number, role}] } }
const rooms = {};

io.on('connection', (socket) => {
    // 房主創建房間
    socket.on('createRoom', ({ name, password }) => {
        const roomCode = Math.floor(1000 + Math.random() * 9000).toString(); // 生成4位數房號
        rooms[roomCode] = {
            password: password,
            hostId: socket.id,
            players: [{ id: socket.id, name: name, number: "00", role: "房主(上帝)" }]
        };
        socket.join(roomCode);
        socket.emit('roomCreated', { roomCode, players: rooms[roomCode].players });
    });

    // 玩家加入房間
    socket.on('joinRoom', ({ roomCode, password, name }) => {
        const room = rooms[roomCode];
        if (!room) {
            return socket.emit('errorMsg', '找不到該房間！');
        }
        if (room.password !== password) {
            return socket.emit('errorMsg', '房間密碼錯誤！');
        }
        
        // 編號從 01 開始，自動補足兩位數
        const playerNum = String(room.players.length).padStart(2, '0');
        const newPlayer = { id: socket.id, name: name, number: playerNum, role: "" };
        
        room.players.push(newPlayer);
        socket.join(roomCode);
        
        // 通知房間內所有人更新大廳
        io.to(roomCode).emit('updateRoom', { roomCode, players: room.players });
    });

    // 房主開始遊戲（發牌）
    socket.on('startGame', ({ roomCode, rolesInput }) => {
        const room = rooms[roomCode];
        if (!room || socket.id !== room.hostId) return;

        // 建立身分牌池
        let rolePool = [];
        for (const [roleName, count] of Object.entries(rolesInput)) {
            for (let i = 0; i < count; i++) {
                rolePool.push(roleName);
            }
        }

        // 檢查牌數是否等於玩家人數 (不含房主)
        const playerCount = room.players.length - 1;
        if (rolePool.length !== playerCount) {
            return socket.emit('errorMsg', `設定的牌數 (${rolePool.length}) 與玩家人數 (${playerCount}) 不符！`);
        }

        // 洗牌 (Fisher-Yates Shuffle)
        for (let i = rolePool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [rolePool[i], rolePool[j]] = [rolePool[j], rolePool[i]];
        }

        // 發牌給玩家 (房主索引 0 固定不發)
        let poolIndex = 0;
        for (let i = 1; i < room.players.length; i++) {
            room.players[i].role = rolePool[poolIndex++];
        }

        // 發送遊戲開始與結果給所有人
        io.to(roomCode).emit('gameStarted', { players: room.players });
    });

    // 斷線處理
    socket.on('disconnect', () => {
        for (const roomCode in rooms) {
            const room = rooms[roomCode];
            const index = room.players.findIndex(p => p.id === socket.id);
            if (index !== -1) {
                room.players.splice(index, 1);
                if (room.players.length === 0 || socket.id === room.hostId) {
                    delete rooms[roomCode]; // 房主離開或沒人就刪除房間
                    io.to(roomCode).emit('roomClosed');
                } else {
                    // 重新排列玩家編號
                    for (let i = 1; i < room.players.length; i++) {
                        room.players[i].number = String(i).padStart(2, '0');
                    }
                    io.to(roomCode).emit('updateRoom', { roomCode, players: room.players });
                }
                break;
            }
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});