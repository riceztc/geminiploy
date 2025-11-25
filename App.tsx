
import React, { useState, useEffect, useCallback } from 'react';
import { 
  GameState, Player, GamePhase, Tile, TileType, GameLog, 
  ColorGroup,
  ChanceCard,
  Room
} from './types';
import { INITIAL_TILES, INITIAL_MONEY, CHANCE_CARDS } from './constants';
import TileComponent from './components/Tile';
import ControlPanel from './components/ControlPanel';
import GameLogComponent from './components/GameLog';
import { getAIDecision } from './services/geminiService';
import { v4 as uuidv4 } from 'uuid';

const STORAGE_KEY = 'geminiPoly_rooms';

const App: React.FC = () => {
  // --- STATE ---
  const [gameState, setGameState] = useState<GameState>({
    players: [],
    currentPlayerIndex: 0,
    tiles: INITIAL_TILES,
    dice: [1, 1],
    phase: GamePhase.LOGIN,
    logs: [],
    winner: null,
    currentCard: null,
    selectedTileId: null,
    waitingForDoublesTurn: false,
    currentUser: null,
    roomId: null
  });

  // Room Logic State
  const [nickname, setNickname] = useState("");
  const [rooms, setRooms] = useState<Room[]>([]);
  const [newRoomName, setNewRoomName] = useState("");

  // --- HELPERS ---
  const addLog = useCallback((message: string, type: GameLog['type'] = 'info') => {
    setGameState(prev => ({
      ...prev,
      logs: [...prev.logs, {
        id: uuidv4(),
        message,
        type,
        timestamp: Date.now()
      }]
    }));
  }, []);

  const getCurrentPlayer = () => gameState.players[gameState.currentPlayerIndex];
  const getPlayerById = (id: string) => gameState.players.find(p => p.id === id);

  // Sync Rooms from LocalStorage (Simulated Server)
  const refreshRooms = () => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      setRooms(JSON.parse(stored));
    }
  };

  useEffect(() => {
    refreshRooms();
    const handleStorage = () => refreshRooms();
    window.addEventListener('storage', handleStorage);
    // Interval poll for local "multiplayer" simulation updates
    const interval = setInterval(refreshRooms, 2000);
    return () => {
      window.removeEventListener('storage', handleStorage);
      clearInterval(interval);
    };
  }, []);

  const updateRoomsInStorage = (updatedRooms: Room[]) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedRooms));
    setRooms(updatedRooms);
  };

  // --- ROOM MANAGEMENT ---
  const handleLogin = () => {
    if (!nickname.trim()) return;
    const user = { id: uuidv4(), name: nickname.trim() };
    setGameState(prev => ({ ...prev, currentUser: user, phase: GamePhase.LOBBY_ROOMS }));
  };

  const createRoom = () => {
    if (!gameState.currentUser || !newRoomName.trim()) return;
    const newRoom: Room = {
      id: uuidv4(),
      name: newRoomName.trim(),
      hostId: gameState.currentUser.id,
      players: [{ ...gameState.currentUser, isAI: false, isHost: true }],
      status: 'WAITING',
      maxPlayers: 4,
      createdAt: Date.now()
    };
    const updated = [...rooms, newRoom];
    updateRoomsInStorage(updated);
    setGameState(prev => ({ ...prev, roomId: newRoom.id, phase: GamePhase.ROOM_SETUP }));
  };

  const joinRoom = (roomId: string) => {
    if (!gameState.currentUser) return;
    const roomIndex = rooms.findIndex(r => r.id === roomId);
    if (roomIndex === -1) return;
    
    const room = rooms[roomIndex];
    if (room.players.length >= room.maxPlayers) {
      alert("房间已满");
      return;
    }

    const updatedRooms = [...rooms];
    updatedRooms[roomIndex].players.push({ ...gameState.currentUser, isAI: false, isHost: false });
    updateRoomsInStorage(updatedRooms);
    setGameState(prev => ({ ...prev, roomId: roomId, phase: GamePhase.ROOM_SETUP }));
  };

  const addAI = () => {
    if (!gameState.roomId) return;
    const roomIndex = rooms.findIndex(r => r.id === gameState.roomId);
    if (roomIndex === -1) return;

    const aiIcons = ['🤖', '🐶', '👽', '🦖'];
    const currentCount = rooms[roomIndex].players.length;
    if (currentCount >= 4) return;

    const aiName = `电脑 ${currentCount}`; // Simple naming
    const newAI = { id: uuidv4(), name: aiName, isAI: true, isHost: false };
    
    const updatedRooms = [...rooms];
    updatedRooms[roomIndex].players.push(newAI);
    updateRoomsInStorage(updatedRooms);
  };

  const kickPlayer = (playerId: string) => {
    if (!gameState.roomId) return;
    const roomIndex = rooms.findIndex(r => r.id === gameState.roomId);
    if (roomIndex === -1) return;

    const updatedRooms = [...rooms];
    updatedRooms[roomIndex].players = updatedRooms[roomIndex].players.filter(p => p.id !== playerId);
    updateRoomsInStorage(updatedRooms);
  };

  const leaveRoom = () => {
    if (!gameState.roomId || !gameState.currentUser) return;
    const roomIndex = rooms.findIndex(r => r.id === gameState.roomId);
    if (roomIndex !== -1) {
      const updatedRooms = [...rooms];
      updatedRooms[roomIndex].players = updatedRooms[roomIndex].players.filter(p => p.id !== gameState.currentUser!.id);
      // If host leaves, delete room or assign new host (simple: delete)
      if (updatedRooms[roomIndex].players.length === 0) {
        updatedRooms.splice(roomIndex, 1);
      }
      updateRoomsInStorage(updatedRooms);
    }
    setGameState(prev => ({ ...prev, roomId: null, phase: GamePhase.LOBBY_ROOMS }));
  };

  // Poll for room start status
  useEffect(() => {
    if (gameState.phase === GamePhase.ROOM_SETUP && gameState.roomId) {
      const interval = setInterval(() => {
        const room = rooms.find(r => r.id === gameState.roomId);
        if (!room) {
          // Room deleted
          setGameState(prev => ({ ...prev, roomId: null, phase: GamePhase.LOBBY_ROOMS }));
          return;
        }
        if (room.status === 'PLAYING') {
          // Convert room players to Game Players
          startGameFromRoom(room);
        }
        // Force update local players list visualization
        // (In a real React app with proper state management, this would be reactive. 
        // Here we rely on 'rooms' state updating via storage event or poll)
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [gameState.phase, gameState.roomId, rooms]);

  const handleStartGameRequest = () => {
    if (!gameState.roomId) return;
    const updatedRooms = [...rooms];
    const idx = updatedRooms.findIndex(r => r.id === gameState.roomId);
    if (idx !== -1) {
      updatedRooms[idx].status = 'PLAYING';
      updateRoomsInStorage(updatedRooms);
      startGameFromRoom(updatedRooms[idx]);
    }
  };

  // --- GAME LOGIC ---

  const startGameFromRoom = (room: Room) => {
    const colors = ['#3b82f6', '#ef4444', '#eab308', '#22c55e'];
    const icons = ['🚗', '🤖', '🐶', '🦖']; // Simplification

    const gamePlayers: Player[] = room.players.map((p, i) => ({
      id: p.id,
      name: p.name,
      color: colors[i % colors.length],
      icon: p.isAI ? icons[(i+1)%icons.length] : icons[0], // Simple icon assignment
      isAI: p.isAI,
      money: INITIAL_MONEY,
      position: 0,
      isInJail: false,
      jailTurns: 0,
      consecutiveDoubles: 0,
      properties: [],
      bankrupt: false
    }));

    setGameState(prev => ({
      ...prev,
      players: gamePlayers,
      currentPlayerIndex: 0,
      tiles: INITIAL_TILES.map(t => ({...t, ownerId: null, houseCount: 0})), // Reset board
      phase: GamePhase.ROLLING,
      logs: [{ id: 'init', message: "游戏开始！祝你好运。", type: 'info', timestamp: Date.now() }]
    }));
  };

  const handlePayBail = () => {
    const player = getCurrentPlayer();
    if (player.money < 50) {
        addLog(`${player.name} 资金不足，无法支付保释金。`, 'warning');
        return;
    }

    setGameState(prev => {
        const newPlayers = [...prev.players];
        newPlayers[prev.currentPlayerIndex].money -= 50;
        newPlayers[prev.currentPlayerIndex].isInJail = false;
        newPlayers[prev.currentPlayerIndex].jailTurns = 0;
        newPlayers[prev.currentPlayerIndex].consecutiveDoubles = 0; 
        return { ...prev, players: newPlayers };
    });
    addLog(`${player.name} 支付了 $50 保释金，重获自由！`, 'success');
  };

  const handleRoll = useCallback(() => {
    const d1 = Math.floor(Math.random() * 6) + 1;
    const d2 = Math.floor(Math.random() * 6) + 1;
    const total = d1 + d2;
    const isDouble = d1 === d2;
    const player = getCurrentPlayer();

    setGameState(prev => ({ ...prev, dice: [d1, d2], waitingForDoublesTurn: false }));

    // --- JAIL LOGIC ---
    if (player.isInJail) {
      if (isDouble) {
         addLog(`${player.name} 掷出了双倍 (${d1}, ${d2})，成功越狱！`, 'success');
         setGameState(prev => {
             const newPlayers = [...prev.players];
             newPlayers[prev.currentPlayerIndex].isInJail = false;
             newPlayers[prev.currentPlayerIndex].jailTurns = 0;
             newPlayers[prev.currentPlayerIndex].consecutiveDoubles = 0;
             return { ...prev, players: newPlayers };
         });
         setTimeout(() => movePlayer(total, player.id, false), 500);
      } else {
         if (player.jailTurns >= 2) {
             addLog(`${player.name} 狱期已满，强制支付 $50 保释金出狱。`, 'warning');
             setGameState(prev => {
                const newPlayers = [...prev.players];
                const pIndex = newPlayers.findIndex(p => p.id === player.id);
                newPlayers[pIndex].money -= 50;
                newPlayers[pIndex].isInJail = false;
                newPlayers[pIndex].jailTurns = 0;
                newPlayers[pIndex].consecutiveDoubles = 0;
                return { ...prev, players: newPlayers };
             });
             setTimeout(() => movePlayer(total, player.id, false), 500);
         } else {
             addLog(`${player.name} 掷出 ${total}，越狱失败。`, 'warning');
             setGameState(prev => {
                const newPlayers = [...prev.players];
                const pIndex = newPlayers.findIndex(p => p.id === player.id);
                newPlayers[pIndex].jailTurns += 1;
                newPlayers[pIndex].consecutiveDoubles = 0;
                return { ...prev, players: newPlayers, phase: GamePhase.END_TURN };
             });
         }
      }
      return;
    }

    // --- NORMAL LOGIC ---
    let nextDoublesCount = player.consecutiveDoubles;
    if (isDouble) {
        nextDoublesCount += 1;
    } else {
        nextDoublesCount = 0;
    }

    if (nextDoublesCount === 3) {
        addLog(`${player.name} 连续三次掷出双倍，因超速被送进监狱！`, 'danger');
        setGameState(prev => {
            const newPlayers = [...prev.players];
            const pIdx = newPlayers.findIndex(p => p.id === player.id);
            newPlayers[pIdx].position = 10;
            newPlayers[pIdx].isInJail = true;
            newPlayers[pIdx].jailTurns = 0;
            newPlayers[pIdx].consecutiveDoubles = 0;
            return { ...prev, players: newPlayers, phase: GamePhase.END_TURN };
        });
        return;
    }

    setGameState(prev => {
        const newPlayers = [...prev.players];
        newPlayers[prev.currentPlayerIndex].consecutiveDoubles = nextDoublesCount;
        return { ...prev, players: newPlayers };
    });

    addLog(`${player.name} 掷出了 ${total} (${d1} + ${d2})${isDouble ? ' - 双倍!' : ''}`);
    
    setTimeout(() => {
      movePlayer(total, player.id, isDouble);
    }, 500);
  }, [gameState.currentPlayerIndex, gameState.players]); 

  const movePlayer = (steps: number, playerId: string, isDouble: boolean) => {
    setGameState(prev => {
      const newPlayers = [...prev.players];
      const pIndex = newPlayers.findIndex(p => p.id === playerId);
      let newPos = newPlayers[pIndex].position + steps;
      
      if (newPos >= 40) {
        newPos -= 40;
      } else if (newPos < 0) {
        newPos += 40;
      }
      
      if ((newPlayers[pIndex].position + steps) >= 40 && steps > 0) {
          newPlayers[pIndex].money += 200;
      }

      newPlayers[pIndex].position = newPos;
      return { ...prev, players: newPlayers };
    });

    const currentPlayer = gameState.players.find(p => p.id === playerId);
    if (currentPlayer && (currentPlayer.position + steps) >= 40 && steps > 0) {
        addLog(`${currentPlayer.name} 经过起点，获得 $200 奖励。`, 'success');
    }

    setTimeout(() => handleLanding(playerId, isDouble), 600);
  };

  const drawChanceCard = (playerId: string, isDouble: boolean) => {
    const cardIndex = Math.floor(Math.random() * CHANCE_CARDS.length);
    const card = CHANCE_CARDS[cardIndex];
    
    setGameState(prev => ({ ...prev, phase: GamePhase.SHOWING_CARD, currentCard: card }));

    setTimeout(() => {
        applyChanceEffect(playerId, card, isDouble);
    }, 2500);
  };

  const applyChanceEffect = (playerId: string, card: ChanceCard, isDouble: boolean) => {
    setGameState(prev => {
        const newPlayers = [...prev.players];
        const pIndex = newPlayers.findIndex(p => p.id === playerId);
        const player = newPlayers[pIndex];
        
        let nextPhase = isDouble ? GamePhase.ROLLING : GamePhase.END_TURN;
        let waitingForDoubles = isDouble;

        addLog(`${player.name} 执行: ${card.title}`, 'info');

        switch(card.effectType) {
            case 'MONEY':
                player.money += card.value;
                break;
            case 'MOVE_TO':
                if (card.value === 10 && card.description.includes("监狱")) { 
                    player.position = 10;
                    player.isInJail = true;
                    player.jailTurns = 0;
                    player.consecutiveDoubles = 0;
                    addLog(`${player.name} 被送进监狱！`, 'danger');
                    nextPhase = GamePhase.END_TURN; 
                    waitingForDoubles = false;
                } else {
                    if (player.position > card.value) player.money += 200;
                    player.position = card.value;
                }
                break;
            case 'MOVE_STEPS':
                let newPos = player.position + card.value;
                if (newPos >= 40) { newPos -= 40; player.money += 200; }
                if (newPos < 0) { newPos += 40; }
                player.position = newPos;
                break;
            case 'GO_TO_JAIL':
                player.position = 10;
                player.isInJail = true;
                player.jailTurns = 0;
                player.consecutiveDoubles = 0;
                addLog(`${player.name} 被送进监狱！`, 'danger');
                nextPhase = GamePhase.END_TURN;
                waitingForDoubles = false;
                break;
        }

        return { 
            ...prev, 
            players: newPlayers, 
            phase: nextPhase, 
            currentCard: null, 
            waitingForDoublesTurn: waitingForDoubles 
        };
    });
  };

  // Check if a player owns all properties of a specific color group
  const checkOwnsGroup = (playerId: string | undefined | null, group: ColorGroup, allTiles: Tile[]) => {
    if (!playerId || group === ColorGroup.NONE) return false;
    const groupTiles = allTiles.filter(t => t.group === group);
    return groupTiles.length > 0 && groupTiles.every(t => t.ownerId === playerId);
  };

  const handleLanding = (playerId: string, isDouble: boolean) => {
    setGameState(prev => {
      const player = prev.players.find(p => p.id === playerId);
      if(!player) return prev;
      
      const tile = prev.tiles[player.position];
      addLog(`${player.name} 到达了 ${tile.name}。`);

      let nextPhase = isDouble ? GamePhase.ROLLING : GamePhase.END_TURN;
      let waitingForDoubles = isDouble;

      if (tile.type === TileType.GO_TO_JAIL) {
        const newPlayers = [...prev.players];
        const idx = newPlayers.findIndex(p => p.id === playerId);
        newPlayers[idx].position = 10;
        newPlayers[idx].isInJail = true;
        newPlayers[idx].jailTurns = 0;
        newPlayers[idx].consecutiveDoubles = 0;
        addLog(`${player.name} 触犯法律，被直接送进监狱！`, 'danger');
        return { ...prev, players: newPlayers, phase: GamePhase.END_TURN, waitingForDoublesTurn: false };
      }

      if (tile.type === TileType.CHANCE || tile.type === TileType.COMMUNITY_CHEST) {
          setTimeout(() => drawChanceCard(playerId, isDouble), 100);
          return { ...prev, phase: GamePhase.SHOWING_CARD }; 
      }

      if (tile.type === TileType.PROPERTY || tile.type === TileType.STATION || tile.type === TileType.UTILITY) {
        if (tile.ownerId && tile.ownerId !== playerId) {
          const owner = prev.players.find(p => p.id === tile.ownerId);
          if (owner) {
             let rent = 0;
             if (tile.type === TileType.PROPERTY) {
                 const baseRent = tile.rent ? tile.rent[tile.houseCount || 0] : 0;
                 if ((tile.houseCount === 0 || tile.houseCount === undefined) && checkOwnsGroup(owner.id, tile.group, prev.tiles)) {
                    rent = baseRent * 2;
                    addLog(`租金翻倍！${owner.name} 拥有完整的 ${tile.group} 街区。`, 'warning');
                 } else {
                    rent = baseRent;
                 }
             } else if (tile.type === TileType.STATION) {
                const stationsOwned = prev.tiles.filter(t => t.group === ColorGroup.STATION && t.ownerId === owner.id).length;
                rent = 25 * Math.pow(2, stationsOwned - 1);
             } else if (tile.type === TileType.UTILITY) {
                 const utilitiesOwned = prev.tiles.filter(t => t.group === ColorGroup.UTILITY && t.ownerId === owner.id).length;
                 const diceSum = prev.dice[0] + prev.dice[1];
                 rent = utilitiesOwned === 2 ? diceSum * 10 : diceSum * 4;
                 addLog(`公用事业费用计算: 点数 ${diceSum} x ${utilitiesOwned === 2 ? 10 : 4}`, 'info');
             }
             
             addLog(`${player.name} 向 ${owner.name} 支付租金 $${rent}。`, 'danger');
             
             const newPlayers = [...prev.players];
             const pIdx = newPlayers.findIndex(p => p.id === playerId);
             const oIdx = newPlayers.findIndex(p => p.id === owner.id);
             
             newPlayers[pIdx].money -= rent;
             newPlayers[oIdx].money += rent;
             
             if (newPlayers[pIdx].money < 0) {
                newPlayers[pIdx].bankrupt = true;
                addLog(`${player.name} 破产了！`, 'danger');
                const newTiles = prev.tiles.map(t => t.ownerId === playerId ? { ...t, ownerId: null, houseCount: 0 } : t);
                return { ...prev, players: newPlayers, tiles: newTiles, phase: GamePhase.END_TURN, waitingForDoublesTurn: false };
             }

             return { ...prev, players: newPlayers, phase: nextPhase, waitingForDoublesTurn: waitingForDoubles }; 
          }
        } else if (!tile.ownerId) {
            return { ...prev, phase: GamePhase.ACTION, waitingForDoublesTurn: waitingForDoubles };
        }
      }

      if (tile.type === TileType.TAX) {
          const tax = tile.price || 100;
          addLog(`${player.name} 缴纳了 $${tax} 税款。`, 'danger');
          const newPlayers = [...prev.players];
          const idx = newPlayers.findIndex(p => p.id === playerId);
          newPlayers[idx].money -= tax;
          return { ...prev, players: newPlayers, phase: nextPhase, waitingForDoublesTurn: waitingForDoubles };
      }

      return { ...prev, phase: nextPhase, waitingForDoublesTurn: waitingForDoubles };
    });
  };

  const handleBuy = () => {
    setGameState(prev => {
      const player = prev.players[prev.currentPlayerIndex];
      const tile = prev.tiles[player.position];
      
      if (!tile.price || player.money < tile.price) {
          addLog("资金不足！", 'warning');
          return prev;
      }

      const newPlayers = [...prev.players];
      newPlayers[prev.currentPlayerIndex].money -= tile.price;
      newPlayers[prev.currentPlayerIndex].properties.push(tile.id);

      const newTiles = [...prev.tiles];
      newTiles[player.position] = { ...tile, ownerId: player.id };

      addLog(`${player.name} 花费 $${tile.price} 购买了 ${tile.name}。`, 'success');

      const nextPhase = prev.waitingForDoublesTurn ? GamePhase.ROLLING : GamePhase.END_TURN;
      return { ...prev, players: newPlayers, tiles: newTiles, phase: nextPhase };
    });
  };

  const handleUpgradeProperty = () => {
      setGameState(prev => {
          if (prev.selectedTileId === null) return prev;
          const tile = prev.tiles.find(t => t.id === prev.selectedTileId);
          if (!tile || !tile.houseCost) return prev;

          const player = getCurrentPlayer();
          
          if (player.money < tile.houseCost) {
              addLog("资金不足，无法升级！", 'warning');
              return prev;
          }
          if (tile.houseCount && tile.houseCount >= 5) {
              addLog("已经达到最高等级！", 'warning');
              return prev;
          }

          const newPlayers = [...prev.players];
          const pIdx = newPlayers.findIndex(p => p.id === player.id);
          newPlayers[pIdx].money -= tile.houseCost;

          const newTiles = [...prev.tiles];
          const tIdx = newTiles.findIndex(t => t.id === tile.id);
          newTiles[tIdx] = { ...tile, houseCount: (tile.houseCount || 0) + 1 };

          const levelName = newTiles[tIdx].houseCount === 5 ? "酒店" : `${newTiles[tIdx].houseCount} 栋房屋`;
          addLog(`${player.name} 升级了 ${tile.name} 为 ${levelName} (-$${tile.houseCost})`, 'success');

          return { ...prev, players: newPlayers, tiles: newTiles };
      });
  };

  const handlePass = () => {
    addLog(`${getCurrentPlayer().name} 决定不购买。`);
    setGameState(prev => ({ 
        ...prev, 
        phase: prev.waitingForDoublesTurn ? GamePhase.ROLLING : GamePhase.END_TURN 
    }));
  };

  const handleSurrender = () => {
    if (!window.confirm("确定要认输吗？这将导致你直接破产并退出游戏。")) return;
    
    setGameState(prev => {
        const player = prev.players[prev.currentPlayerIndex];
        addLog(`${player.name} 选择了认输，宣告破产！`, 'danger');
        
        const newPlayers = [...prev.players];
        newPlayers[prev.currentPlayerIndex].bankrupt = true;
        newPlayers[prev.currentPlayerIndex].money = 0;

        // Release tiles
        const newTiles = prev.tiles.map(t => t.ownerId === player.id ? { ...t, ownerId: null, houseCount: 0 } : t);
        
        // Trigger end turn logic immediately
        return { ...prev, players: newPlayers, tiles: newTiles, phase: GamePhase.END_TURN };
    });
  };

  const handleEndTurn = () => {
    setGameState(prev => {
        let nextIndex = (prev.currentPlayerIndex + 1) % prev.players.length;
        let loopCount = 0;
        while(prev.players[nextIndex].bankrupt && loopCount < prev.players.length) {
            nextIndex = (nextIndex + 1) % prev.players.length;
            loopCount++;
        }

        const activePlayers = prev.players.filter(p => !p.bankrupt);
        if (activePlayers.length <= 1) {
            return { ...prev, winner: activePlayers[0] || null, phase: GamePhase.GAME_OVER };
        }

        return {
            ...prev,
            currentPlayerIndex: nextIndex,
            phase: GamePhase.ROLLING,
            waitingForDoublesTurn: false 
        };
    });
  };

  // --- AI HOOK ---
  useEffect(() => {
    const activeStates = [GamePhase.ROLLING, GamePhase.ACTION, GamePhase.END_TURN];
    if (!activeStates.includes(gameState.phase)) return;

    const currentPlayer = getCurrentPlayer();
    if (!currentPlayer || !currentPlayer.isAI || currentPlayer.bankrupt) return;

    const runAITurn = async () => {
      await new Promise(r => setTimeout(r, 1000));

      if (gameState.phase === GamePhase.ROLLING) {
        if (currentPlayer.isInJail && currentPlayer.money >= 500) {
            handlePayBail();
            await new Promise(r => setTimeout(r, 500));
            handleRoll();
        } else {
            handleRoll();
        }
      } else if (gameState.phase === GamePhase.ACTION) {
         const decision = await getAIDecision(gameState, currentPlayer);
         addLog(`${currentPlayer.name} 思考: "${decision.reasoning}"`, 'info');
         if (decision.action === 'BUY') {
            handleBuy();
         } else {
            handlePass();
         }
      } else if (gameState.phase === GamePhase.END_TURN) {
         handleEndTurn();
      }
    };

    runAITurn();
  }, [gameState.phase, gameState.currentPlayerIndex, gameState.waitingForDoublesTurn]); 

  // --- RENDERING SCREENS ---

  if (gameState.phase === GamePhase.LOGIN) {
      return (
        <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full text-center">
                <h1 className="text-4xl font-extrabold text-indigo-600 mb-6">GeminiPoly</h1>
                <p className="text-slate-500 mb-6">请输入您的昵称以开始</p>
                <input 
                    type="text" 
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    placeholder="例如: 大富翁高手"
                    className="w-full border border-slate-300 rounded-lg px-4 py-3 mb-4 focus:ring-2 focus:ring-indigo-500 outline-none text-lg text-center"
                />
                <button 
                    onClick={handleLogin}
                    disabled={!nickname.trim()}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-bold py-3 px-6 rounded-xl transition-all shadow-lg"
                >
                    进入大厅
                </button>
            </div>
        </div>
      );
  }

  if (gameState.phase === GamePhase.LOBBY_ROOMS) {
      return (
        <div className="min-h-screen bg-slate-100 p-4 md:p-8">
            <div className="max-w-4xl mx-auto">
                <div className="flex justify-between items-center mb-8">
                    <h1 className="text-3xl font-bold text-slate-800">游戏大厅</h1>
                    <div className="text-slate-600">欢迎, <span className="font-bold text-indigo-600">{gameState.currentUser?.name}</span></div>
                </div>

                <div className="bg-white rounded-xl shadow-lg p-6 mb-8">
                    <h2 className="text-xl font-bold mb-4">创建房间</h2>
                    <div className="flex gap-4">
                        <input 
                            type="text" 
                            value={newRoomName}
                            onChange={(e) => setNewRoomName(e.target.value)}
                            placeholder="房间名称"
                            className="flex-1 border border-slate-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none"
                        />
                        <button 
                            onClick={createRoom}
                            disabled={!newRoomName.trim()}
                            className="bg-green-600 hover:bg-green-700 text-white font-bold px-6 py-2 rounded-lg transition-colors"
                        >
                            创建
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {rooms.map(room => (
                        <div key={room.id} className="bg-white rounded-xl shadow-md p-6 border border-slate-200 hover:shadow-lg transition-shadow">
                            <h3 className="text-xl font-bold text-slate-800 mb-2 truncate">{room.name}</h3>
                            <div className="flex justify-between text-sm text-slate-500 mb-4">
                                <span>玩家: {room.players.length}/{room.maxPlayers}</span>
                                <span className={room.status === 'PLAYING' ? 'text-green-600 font-bold' : 'text-amber-500'}>
                                    {room.status === 'PLAYING' ? '进行中' : '等待中'}
                                </span>
                            </div>
                            <button 
                                onClick={() => joinRoom(room.id)}
                                disabled={room.status === 'PLAYING' || room.players.length >= room.maxPlayers}
                                className="w-full bg-indigo-100 hover:bg-indigo-200 text-indigo-700 font-bold py-2 rounded-lg transition-colors disabled:opacity-50"
                            >
                                加入房间
                            </button>
                        </div>
                    ))}
                    {rooms.length === 0 && (
                        <div className="col-span-full text-center py-12 text-slate-400">
                            暂无房间，请创建一个！
                        </div>
                    )}
                </div>
            </div>
        </div>
      );
  }

  if (gameState.phase === GamePhase.ROOM_SETUP) {
      const room = rooms.find(r => r.id === gameState.roomId);
      const isHost = room?.hostId === gameState.currentUser?.id;

      if (!room) return <div>房间不存在</div>;

      return (
          <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl shadow-xl p-8 max-w-2xl w-full">
                  <div className="flex justify-between items-center mb-6 border-b pb-4">
                      <h2 className="text-2xl font-bold text-slate-800">{room.name}</h2>
                      <button onClick={leaveRoom} className="text-red-500 hover:bg-red-50 px-3 py-1 rounded">离开</button>
                  </div>

                  <div className="space-y-4 mb-8">
                      {room.players.map((p, idx) => (
                          <div key={p.id} className="flex items-center justify-between bg-slate-50 p-3 rounded-lg">
                              <div className="flex items-center gap-3">
                                  <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 font-bold">
                                      {idx + 1}
                                  </div>
                                  <span className="font-medium text-slate-700">{p.name} {p.isAI ? '(电脑)' : ''}</span>
                                  {p.isHost && <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">房主</span>}
                              </div>
                              {isHost && !p.isHost && (
                                  <button onClick={() => kickPlayer(p.id)} className="text-red-500 text-sm hover:underline">踢出</button>
                              )}
                          </div>
                      ))}
                      {Array.from({length: room.maxPlayers - room.players.length}).map((_, i) => (
                          <div key={`empty-${i}`} className="bg-slate-50 p-3 rounded-lg border-2 border-dashed border-slate-200 text-slate-400 text-center">
                              等待玩家...
                          </div>
                      ))}
                  </div>

                  <div className="flex gap-4">
                      {isHost && (
                          <>
                            <button 
                                onClick={addAI}
                                disabled={room.players.length >= room.maxPlayers}
                                className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold py-3 rounded-xl transition-colors disabled:opacity-50"
                            >
                                添加电脑玩家
                            </button>
                            <button 
                                onClick={handleStartGameRequest}
                                className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold py-3 rounded-xl transition-colors"
                            >
                                开始游戏
                            </button>
                          </>
                      )}
                      {!isHost && (
                          <div className="w-full text-center text-slate-500 py-3 font-medium animate-pulse">
                              等待房主开始游戏...
                          </div>
                      )}
                  </div>
              </div>
          </div>
      );
  }

  if (gameState.phase === GamePhase.GAME_OVER) {
     return (
        <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white">
            <div className="text-center">
                <h1 className="text-6xl font-bold mb-4">游戏结束!</h1>
                <p className="text-2xl text-indigo-300">获胜者: {gameState.winner?.name}</p>
                <button onClick={() => window.location.reload()} className="mt-8 bg-white text-slate-900 px-6 py-2 rounded-lg font-bold">回到大厅</button>
            </div>
        </div>
     );
  }

  const currentPlayer = getCurrentPlayer();
  const currentTile = gameState.tiles[currentPlayer.position];
  const canBuy = (currentTile.type === TileType.PROPERTY || currentTile.type === TileType.STATION || currentTile.type === TileType.UTILITY) && !currentTile.ownerId;
  const selectedTile = gameState.selectedTileId !== null ? gameState.tiles.find(t => t.id === gameState.selectedTileId) : null;
  const isSelectedTileOwner = selectedTile?.ownerId === currentPlayer.id;
  const canUpgrade = isSelectedTileOwner && 
                     selectedTile?.type === TileType.PROPERTY && 
                     checkOwnsGroup(currentPlayer.id, selectedTile.group, gameState.tiles) &&
                     !currentPlayer.isAI;

  return (
    <div className="h-screen bg-slate-100 flex flex-col md:flex-row overflow-hidden">
      
      {/* CONTROL PANEL (Side/Top) */}
      <div className="w-full md:w-80 lg:w-96 p-4 flex flex-col gap-4 shadow-xl bg-white/95 backdrop-blur-sm md:h-full z-20 overflow-y-auto">
        <div className="flex items-center justify-between md:justify-start gap-2 mb-2">
            <h1 className="text-xl font-bold text-indigo-900">GeminiPoly</h1>
            <span className="bg-indigo-100 text-indigo-800 text-[10px] font-semibold px-2 py-0.5 rounded">Room: {rooms.find(r => r.id === gameState.roomId)?.name}</span>
        </div>
        
        <ControlPanel 
            player={currentPlayer}
            phase={gameState.phase}
            currentTile={currentTile}
            dice={gameState.dice}
            canBuy={!!canBuy && currentPlayer.money >= (currentTile.price || 0)}
            onRoll={handleRoll}
            onBuy={handleBuy}
            onPass={handlePass}
            onEndTurn={handleEndTurn}
            onPayBail={handlePayBail}
            onSurrender={handleSurrender}
            waitingForDoubles={gameState.waitingForDoublesTurn}
        />

        {/* Selected Tile Context - Enhanced Details */}
        {selectedTile && (
            <div className="bg-white p-4 rounded-lg shadow border border-slate-200 animate-in slide-in-from-bottom-4 md:slide-in-from-left-4 fade-in duration-200 text-sm">
                <div className="flex justify-between items-start mb-3 border-b pb-2">
                    <h3 className="font-bold text-lg text-slate-800">{selectedTile.name}</h3>
                    <button onClick={() => setGameState(prev => ({...prev, selectedTileId: null}))} className="text-slate-400 hover:text-slate-600 px-2">✕</button>
                </div>
                
                <div className="space-y-2 mb-4">
                    {selectedTile.ownerId ? (
                         <p className="flex justify-between"><span className="text-slate-500">拥有者:</span> <span className="font-medium text-indigo-600">{getPlayerById(selectedTile.ownerId)?.name}</span></p>
                    ) : (
                         <p className="flex justify-between"><span className="text-slate-500">状态:</span> <span className="text-green-600 font-medium">可购买</span></p>
                    )}
                    {selectedTile.price && <p className="flex justify-between"><span className="text-slate-500">地价:</span> <span className="font-bold">${selectedTile.price}</span></p>}
                    {selectedTile.houseCost && <p className="flex justify-between"><span className="text-slate-500">房屋造价:</span> <span className="font-medium">${selectedTile.houseCost}/栋</span></p>}
                </div>

                {/* RENT TABLE */}
                {(selectedTile.type === TileType.PROPERTY && selectedTile.rent) && (
                    <div className="bg-slate-50 rounded border border-slate-200 p-2 text-xs">
                        <div className="grid grid-cols-2 gap-y-1">
                            <div className="text-slate-500">基础租金</div>
                            <div className="text-right font-medium">${selectedTile.rent[0]}</div>
                            <div className="text-slate-500">1 栋房屋</div>
                            <div className="text-right font-medium">${selectedTile.rent[1]}</div>
                            <div className="text-slate-500">2 栋房屋</div>
                            <div className="text-right font-medium">${selectedTile.rent[2]}</div>
                            <div className="text-slate-500">3 栋房屋</div>
                            <div className="text-right font-medium">${selectedTile.rent[3]}</div>
                            <div className="text-slate-500">4 栋房屋</div>
                            <div className="text-right font-medium">${selectedTile.rent[4]}</div>
                            <div className="text-slate-500 text-purple-600 font-bold">酒店</div>
                            <div className="text-right font-bold text-purple-600">${selectedTile.rent[5]}</div>
                        </div>
                        <div className="mt-2 text-[10px] text-slate-400 text-center">
                            *若拥有完整色组未建房，基础租金翻倍
                        </div>
                    </div>
                )}

                {selectedTile.type === TileType.STATION && (
                    <div className="bg-slate-50 rounded border border-slate-200 p-2 text-xs space-y-1">
                         <p>拥有 1 个车站: $25</p>
                         <p>拥有 2 个车站: $50</p>
                         <p>拥有 3 个车站: $100</p>
                         <p>拥有 4 个车站: $200</p>
                    </div>
                )}
                
                {selectedTile.type === TileType.UTILITY && (
                    <div className="bg-slate-50 rounded border border-slate-200 p-2 text-xs space-y-1">
                         <p>拥有 1 个: 骰子点数 x 4</p>
                         <p>拥有 2 个: 骰子点数 x 10</p>
                    </div>
                )}

                {canUpgrade && (
                    <button 
                        onClick={handleUpgradeProperty}
                        className="mt-4 w-full py-2 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded shadow transition-colors"
                        disabled={currentPlayer.money < (selectedTile.houseCost || 0)}
                    >
                        升级房产 (-${selectedTile.houseCost})
                    </button>
                )}
            </div>
        )}

        <div className="hidden md:block flex-1 min-h-[150px]">
            <GameLogComponent logs={gameState.logs} />
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-2 gap-2 mt-auto">
            {gameState.players.map(p => (
                <div key={p.id} className={`p-2 rounded border text-xs ${p.id === currentPlayer.id ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200'} ${p.bankrupt ? 'opacity-50 grayscale bg-red-50' : ''}`}>
                    <div className="flex items-center gap-1">
                        <div className="text-base">{p.icon}</div>
                        <div className="font-bold truncate max-w-[80px]">{p.name}</div>
                        {p.bankrupt && <span className="text-red-500 text-[10px]">[破产]</span>}
                    </div>
                    <div className="text-slate-500 mt-1">${p.money} {p.isInJail && '🔒'}</div>
                </div>
            ))}
        </div>
      </div>

      {/* RIGHT PANEL: Board */}
      <div className="flex-1 bg-slate-200 flex items-center justify-center p-2 md:p-8 overflow-hidden relative">
        {/* CSS based Aspect Ratio Container that fits viewport */}
        <div className="w-full max-w-[90vh] aspect-square relative bg-[#CDE6D0] border-4 border-slate-800 shadow-2xl rounded-lg grid grid-cols-11 grid-rows-11 gap-0.5 p-0.5 text-[8px] md:text-xs">
            
            {/* Center Area */}
            <div className="col-start-2 col-end-11 row-start-2 row-end-11 bg-[#CDE6D0] flex flex-col items-center justify-center relative overflow-hidden pointer-events-none">
                {gameState.currentCard ? (
                    <div className="bg-white rounded-xl shadow-2xl p-4 md:p-8 max-w-sm w-4/5 border-4 border-orange-400 flex flex-col items-center text-center z-50 pointer-events-auto animate-bounce-in">
                        <div className="text-4xl md:text-6xl mb-2 md:mb-4">❓</div>
                        <h3 className="text-lg md:text-2xl font-bold text-slate-800 mb-2">{gameState.currentCard.title}</h3>
                        <p className="text-slate-600 mb-2 md:mb-4 text-sm md:text-lg">{gameState.currentCard.description}</p>
                        <div className={`font-bold text-lg md:text-xl ${gameState.currentCard.value > 0 ? 'text-green-600' : 'text-red-600'}`}>
                           {gameState.currentCard.effectType === 'MONEY' && (gameState.currentCard.value > 0 ? `+ $${gameState.currentCard.value}` : `- $${Math.abs(gameState.currentCard.value)}`)}
                           {gameState.currentCard.effectType === 'MOVE_STEPS' && `${Math.abs(gameState.currentCard.value)} 步`}
                           {gameState.currentCard.effectType === 'GO_TO_JAIL' && `入狱`}
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center transform -rotate-45 opacity-10">
                        <span className="text-4xl md:text-9xl font-black tracking-tighter text-slate-900 uppercase">Gemini</span>
                        <span className="text-2xl md:text-7xl font-bold tracking-widest text-slate-900 uppercase">Poly</span>
                    </div>
                )}
            </div>

            {gameState.tiles.map(tile => (
                <TileComponent 
                    key={tile.id} 
                    tile={tile} 
                    playersOnTile={gameState.players.filter(p => p.position === tile.id && !p.bankrupt)}
                    ownerColor={tile.ownerId ? getPlayerById(tile.ownerId)?.color : undefined}
                    onClick={() => setGameState(prev => ({...prev, selectedTileId: tile.id}))}
                />
            ))}
        </div>
      </div>
    </div>
  );
};

export default App;
