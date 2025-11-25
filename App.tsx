
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  GameState, Player, GamePhase, Tile, TileType, GameLog, 
  ColorGroup,
  ChanceCard,
  Room,
  ActionType,
  NetworkAction
} from './types';
import { INITIAL_TILES, INITIAL_MONEY, CHANCE_CARDS } from './constants';
import TileComponent from './components/Tile';
import ControlPanel from './components/ControlPanel';
import GameLogComponent from './components/GameLog';
import { getAIDecision } from './services/geminiService';
import { v4 as uuidv4 } from 'uuid';
import { io, Socket } from "socket.io-client";

// --- CONFIGURATION ---
// IMPORTANT: Change this URL to your server's IP if deploying!
const SOCKET_URL = "http://localhost:3001";

const App: React.FC = () => {
  // --- STATE ---
  const [socket, setSocket] = useState<Socket | null>(null);
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
    roomId: null,
    isHost: false
  });

  // Room Logic State
  const [nickname, setNickname] = useState("");
  const [rooms, setRooms] = useState<Room[]>([]);
  const [newRoomName, setNewRoomName] = useState("");

  // Refs for access in closures/socket listeners
  const gameStateRef = useRef(gameState);
  useEffect(() => { gameStateRef.current = gameState; }, [gameState]);

  // --- SOCKET SETUP ---
  useEffect(() => {
    const newSocket = io(SOCKET_URL, {
        reconnectionAttempts: 5,
        timeout: 10000
    });
    setSocket(newSocket);

    newSocket.on("connect", () => {
        console.log("Connected to server:", newSocket.id);
        // Request rooms list on connect
        newSocket.emit("get_rooms");
    });

    newSocket.on("rooms_list_update", (updatedRooms: Room[]) => {
        setRooms(updatedRooms);
    });

    newSocket.on("room_joined", ({ roomId, room }: { roomId: string, room: Room }) => {
        setGameState(prev => ({ 
            ...prev, 
            roomId: roomId, 
            phase: GamePhase.ROOM_SETUP,
            isHost: room.hostId === prev.currentUser?.id 
        }));
    });

    newSocket.on("room_player_update", (room: Room) => {
        // Update room display in lobby (handled by rooms_list_update mostly, but this is specific for the setup screen)
        setRooms(prev => prev.map(r => r.id === room.id ? room : r));
    });

    newSocket.on("game_started", (initialState: GameState) => {
        setGameState(prev => ({
            ...initialState,
            currentUser: prev.currentUser, // Keep local user session
            roomId: prev.roomId,
            isHost: prev.isHost
        }));
    });

    newSocket.on("game_state_sync", (syncedState: GameState) => {
        // Only Clients apply this. Hosts ignore (they are the source of truth).
        if (!gameStateRef.current.isHost) {
            setGameState(prev => ({
                ...syncedState,
                currentUser: prev.currentUser,
                roomId: prev.roomId,
                isHost: false
            }));
        }
    });

    // HOST ONLY: Receive Actions from Clients
    newSocket.on("receive_action", (action: NetworkAction) => {
        if (gameStateRef.current.isHost) {
            handleReceivedAction(action);
        }
    });

    return () => {
        newSocket.disconnect();
    };
  }, []);

  // --- HELPERS ---
  const addLog = useCallback((message: string, type: GameLog['type'] = 'info') => {
    // Helper mostly for local logs, but in Host mode, logs are part of state.
    // We update state directly in logic functions.
  }, []);

  const createLog = (message: string, type: GameLog['type'] = 'info'): GameLog => ({
      id: uuidv4(),
      message,
      type,
      timestamp: Date.now()
  });

  const getCurrentPlayer = () => gameState.players[gameState.currentPlayerIndex];
  const getPlayerById = (id: string) => gameState.players.find(p => p.id === id);

  // Sync state to server (Host Only)
  const broadcastState = (newState: GameState) => {
      if (socket && newState.roomId) {
          // Remove local-only fields if any (currently mostly synced)
          socket.emit("update_game_state", { roomId: newState.roomId, state: newState });
      }
  };

  // --- ACTION HANDLING (HOST & CLIENT) ---
  
  // This function decides whether to execute locally (Host) or send to network (Client)
  const dispatchAction = (type: ActionType, payload?: any) => {
      if (!gameState.currentUser) return;
      const action: NetworkAction = {
          type,
          playerId: gameState.currentUser.id,
          payload
      };

      if (gameState.isHost) {
          // Host executes immediately
          executeGameLogic(action);
      } else {
          // Client sends to Host
          socket?.emit("client_action", { roomId: gameState.roomId, action });
      }
  };

  // Host Only: Receive Action and Execute
  const handleReceivedAction = (action: NetworkAction) => {
      executeGameLogic(action);
  };

  // --- CORE GAME LOGIC (HOST EXECUTION) ---
  const executeGameLogic = (action: NetworkAction) => {
      setGameState(prevState => {
          // 1. Validate turn (unless surrender)
          const player = prevState.players.find(p => p.id === action.playerId);
          if (!player) return prevState;
          
          const isTurn = prevState.players[prevState.currentPlayerIndex].id === player.id;
          if (!isTurn && action.type !== 'SURRENDER') return prevState;

          // 2. Process Action
          let newState = { ...prevState };
          const logs = [...newState.logs]; // Work with mutable logs array for this update

          switch (action.type) {
              case 'ROLL':
                  newState = processRoll(newState, player, logs);
                  break;
              case 'BUY':
                  newState = processBuy(newState, player, logs);
                  break;
              case 'PASS':
                  newState = processPass(newState, player, logs);
                  break;
              case 'PAY_BAIL':
                  newState = processPayBail(newState, player, logs);
                  break;
              case 'UPGRADE':
                  newState = processUpgrade(newState, player, logs);
                  break;
              case 'END_TURN':
                  newState = processEndTurn(newState, logs);
                  break;
              case 'SURRENDER':
                  newState = processSurrender(newState, player, logs);
                  break;
          }

          newState.logs = logs;
          
          // 3. Broadcast Update
          broadcastState(newState);
          return newState;
      });
  };

  // --- LOGIC PROCESSORS (PURE FUNCTIONS IDEALLY) ---

  const processSurrender = (state: GameState, player: Player, logs: GameLog[]): GameState => {
      logs.push(createLog(`${player.name} 选择了认输，宣告破产！`, 'danger'));
      
      const newPlayers = [...state.players];
      const pIdx = newPlayers.findIndex(p => p.id === player.id);
      
      newPlayers[pIdx].bankrupt = true;
      newPlayers[pIdx].money = 0;

      // Release tiles
      const newTiles = state.tiles.map(t => t.ownerId === player.id ? { ...t, ownerId: null, houseCount: 0 } : t);
      
      // If it was their turn, end it. If not, just mark them dead.
      // If it WAS their turn, we need to move to next player.
      const isTurn = state.players[state.currentPlayerIndex].id === player.id;
      
      let nextState = { ...state, players: newPlayers, tiles: newTiles };
      
      if (isTurn) {
         return processEndTurn(nextState, logs);
      } else {
         // Check win condition immediately if someone quit out of turn
         const activePlayers = nextState.players.filter(p => !p.bankrupt);
         if (activePlayers.length <= 1) {
            return { ...nextState, winner: activePlayers[0] || null, phase: GamePhase.GAME_OVER };
         }
         return nextState;
      }
  };

  const processPayBail = (state: GameState, player: Player, logs: GameLog[]): GameState => {
      if (player.money < 50) {
          logs.push(createLog(`${player.name} 资金不足，无法支付保释金。`, 'warning'));
          return state;
      }
      const newPlayers = [...state.players];
      const idx = newPlayers.findIndex(p => p.id === player.id);
      newPlayers[idx].money -= 50;
      newPlayers[idx].isInJail = false;
      newPlayers[idx].jailTurns = 0;
      newPlayers[idx].consecutiveDoubles = 0;
      
      logs.push(createLog(`${player.name} 支付了 $50 保释金，重获自由！`, 'success'));
      return { ...state, players: newPlayers };
  };

  const processUpgrade = (state: GameState, player: Player, logs: GameLog[]): GameState => {
      if (state.selectedTileId === null) return state;
      const tile = state.tiles.find(t => t.id === state.selectedTileId);
      if (!tile || !tile.houseCost) return state;
      
      if (player.money < tile.houseCost) {
          logs.push(createLog("资金不足，无法升级！", 'warning'));
          return state;
      }
      if (tile.houseCount && tile.houseCount >= 5) {
          logs.push(createLog("已经达到最高等级！", 'warning'));
          return state;
      }

      const newPlayers = [...state.players];
      const pIdx = newPlayers.findIndex(p => p.id === player.id);
      newPlayers[pIdx].money -= tile.houseCost;

      const newTiles = [...state.tiles];
      const tIdx = newTiles.findIndex(t => t.id === tile.id);
      newTiles[tIdx] = { ...tile, houseCount: (tile.houseCount || 0) + 1 };

      const levelName = newTiles[tIdx].houseCount === 5 ? "酒店" : `${newTiles[tIdx].houseCount} 栋房屋`;
      logs.push(createLog(`${player.name} 升级了 ${tile.name} 为 ${levelName} (-$${tile.houseCost})`, 'success'));

      return { ...state, players: newPlayers, tiles: newTiles };
  };

  const processPass = (state: GameState, player: Player, logs: GameLog[]): GameState => {
      logs.push(createLog(`${player.name} 决定不购买。`));
      return { 
          ...state, 
          phase: state.waitingForDoublesTurn ? GamePhase.ROLLING : GamePhase.END_TURN 
      };
  };

  const processBuy = (state: GameState, player: Player, logs: GameLog[]): GameState => {
      const tile = state.tiles[player.position];
      if (!tile.price || player.money < tile.price) return state;

      const newPlayers = [...state.players];
      const pIdx = newPlayers.findIndex(p => p.id === player.id);
      newPlayers[pIdx].money -= tile.price;
      newPlayers[pIdx].properties.push(tile.id);

      const newTiles = [...state.tiles];
      newTiles[player.position] = { ...tile, ownerId: player.id };

      logs.push(createLog(`${player.name} 花费 $${tile.price} 购买了 ${tile.name}。`, 'success'));

      return { 
          ...state, 
          players: newPlayers, 
          tiles: newTiles, 
          phase: state.waitingForDoublesTurn ? GamePhase.ROLLING : GamePhase.END_TURN 
      };
  };

  const processEndTurn = (state: GameState, logs: GameLog[]): GameState => {
      let nextIndex = (state.currentPlayerIndex + 1) % state.players.length;
      let loopCount = 0;
      // Skip bankrupt players
      while(state.players[nextIndex].bankrupt && loopCount < state.players.length) {
          nextIndex = (nextIndex + 1) % state.players.length;
          loopCount++;
      }

      const activePlayers = state.players.filter(p => !p.bankrupt);
      if (activePlayers.length <= 1) {
          return { ...state, winner: activePlayers[0] || null, phase: GamePhase.GAME_OVER };
      }

      return {
          ...state,
          currentPlayerIndex: nextIndex,
          phase: GamePhase.ROLLING,
          waitingForDoublesTurn: false 
      };
  };

  const processRoll = (state: GameState, player: Player, logs: GameLog[]): GameState => {
    const d1 = Math.floor(Math.random() * 6) + 1;
    const d2 = Math.floor(Math.random() * 6) + 1;
    const total = d1 + d2;
    const isDouble = d1 === d2;
    
    let newState = { ...state, dice: [d1, d2] as [number, number], waitingForDoublesTurn: false };

    // Jail Logic
    if (player.isInJail) {
        if (isDouble) {
            logs.push(createLog(`${player.name} 掷出了双倍 (${d1}, ${d2})，成功越狱！`, 'success'));
            const newPlayers = [...newState.players];
            const idx = newPlayers.findIndex(p => p.id === player.id);
            newPlayers[idx].isInJail = false;
            newPlayers[idx].jailTurns = 0;
            newPlayers[idx].consecutiveDoubles = 0;
            newState.players = newPlayers;
            return movePlayer(newState, total, player.id, false, logs);
        } else {
            if (player.jailTurns >= 2) {
                logs.push(createLog(`${player.name} 狱期已满，强制支付 $50 保释金出狱。`, 'warning'));
                const newPlayers = [...newState.players];
                const idx = newPlayers.findIndex(p => p.id === player.id);
                newPlayers[idx].money -= 50;
                newPlayers[idx].isInJail = false;
                newPlayers[idx].jailTurns = 0;
                newPlayers[idx].consecutiveDoubles = 0;
                newState.players = newPlayers;
                return movePlayer(newState, total, player.id, false, logs);
            } else {
                logs.push(createLog(`${player.name} 掷出 ${total}，越狱失败。`, 'warning'));
                const newPlayers = [...newState.players];
                const idx = newPlayers.findIndex(p => p.id === player.id);
                newPlayers[idx].jailTurns += 1;
                newPlayers[idx].consecutiveDoubles = 0;
                newState.players = newPlayers;
                newState.phase = GamePhase.END_TURN;
                return newState;
            }
        }
    }

    // Normal Logic
    let nextDoublesCount = player.consecutiveDoubles;
    if (isDouble) nextDoublesCount += 1;
    else nextDoublesCount = 0;

    if (nextDoublesCount === 3) {
        logs.push(createLog(`${player.name} 连续三次掷出双倍，因超速被送进监狱！`, 'danger'));
        const newPlayers = [...newState.players];
        const idx = newPlayers.findIndex(p => p.id === player.id);
        newPlayers[idx].position = 10;
        newPlayers[idx].isInJail = true;
        newPlayers[idx].jailTurns = 0;
        newPlayers[idx].consecutiveDoubles = 0;
        newState.players = newPlayers;
        newState.phase = GamePhase.END_TURN;
        return newState;
    }

    const newPlayers = [...newState.players];
    const idx = newPlayers.findIndex(p => p.id === player.id);
    newPlayers[idx].consecutiveDoubles = nextDoublesCount;
    newState.players = newPlayers;

    logs.push(createLog(`${player.name} 掷出了 ${total} (${d1} + ${d2})${isDouble ? ' - 双倍!' : ''}`));
    
    return movePlayer(newState, total, player.id, isDouble, logs);
  };

  const movePlayer = (state: GameState, steps: number, playerId: string, isDouble: boolean, logs: GameLog[]): GameState => {
      const newPlayers = [...state.players];
      const idx = newPlayers.findIndex(p => p.id === playerId);
      let newPos = newPlayers[idx].position + steps;

      if (newPos >= 40) {
          newPos -= 40;
          newPlayers[idx].money += 200;
          logs.push(createLog(`${newPlayers[idx].name} 经过起点，获得 $200 奖励。`, 'success'));
      } else if (newPos < 0) {
          newPos += 40;
      }
      newPlayers[idx].position = newPos;

      let newState = { ...state, players: newPlayers };
      
      // Handle Landing (Sync)
      return handleLanding(newState, playerId, isDouble, logs);
  };

  const handleLanding = (state: GameState, playerId: string, isDouble: boolean, logs: GameLog[]): GameState => {
      const player = state.players.find(p => p.id === playerId);
      if(!player) return state;
      
      const tile = state.tiles[player.position];
      logs.push(createLog(`${player.name} 到达了 ${tile.name}。`));

      // 1. Go to Jail
      if (tile.type === TileType.GO_TO_JAIL) {
          const newPlayers = [...state.players];
          const idx = newPlayers.findIndex(p => p.id === playerId);
          newPlayers[idx].position = 10;
          newPlayers[idx].isInJail = true;
          newPlayers[idx].jailTurns = 0;
          newPlayers[idx].consecutiveDoubles = 0;
          logs.push(createLog(`${player.name} 触犯法律，被直接送进监狱！`, 'danger'));
          return { ...state, players: newPlayers, phase: GamePhase.END_TURN, waitingForDoublesTurn: false };
      }

      // 2. Chance / Community Chest
      if (tile.type === TileType.CHANCE || tile.type === TileType.COMMUNITY_CHEST) {
          // Instant draw logic for simplicity in Host mode
          const cardIndex = Math.floor(Math.random() * CHANCE_CARDS.length);
          const card = CHANCE_CARDS[cardIndex];
          
          let nextState = { ...state, currentCard: card, phase: GamePhase.SHOWING_CARD };
          // NOTE: We cannot easily do "setTimeout" in this state reducer without side effects.
          // For the Host logic, we will apply the effect immediately but perhaps the client will see the card.
          // To improve UX, we could use a separate "ACK" action, but let's apply effect now.
          return applyChanceEffect(nextState, playerId, card, isDouble, logs);
      }

      // 3. Properties
      if (tile.type === TileType.PROPERTY || tile.type === TileType.STATION || tile.type === TileType.UTILITY) {
        if (tile.ownerId && tile.ownerId !== playerId) {
            // Pay Rent
            const owner = state.players.find(p => p.id === tile.ownerId);
            if (owner && !owner.bankrupt) {
                let rent = 0;
                // ... (Rent calc logic same as before) ...
                if (tile.type === TileType.PROPERTY) {
                     const baseRent = tile.rent ? tile.rent[tile.houseCount || 0] : 0;
                     if ((tile.houseCount === 0 || tile.houseCount === undefined) && checkOwnsGroup(owner.id, tile.group, state.tiles)) {
                        rent = baseRent * 2;
                        logs.push(createLog(`租金翻倍！${owner.name} 拥有完整的 ${tile.group} 街区。`, 'warning'));
                     } else {
                        rent = baseRent;
                     }
                } else if (tile.type === TileType.STATION) {
                    const stationsOwned = state.tiles.filter(t => t.group === ColorGroup.STATION && t.ownerId === owner.id).length;
                    rent = 25 * Math.pow(2, stationsOwned - 1);
                } else if (tile.type === TileType.UTILITY) {
                    const utilitiesOwned = state.tiles.filter(t => t.group === ColorGroup.UTILITY && t.ownerId === owner.id).length;
                    const diceSum = state.dice[0] + state.dice[1];
                    rent = utilitiesOwned === 2 ? diceSum * 10 : diceSum * 4;
                    logs.push(createLog(`公用事业费用计算: 点数 ${diceSum} x ${utilitiesOwned === 2 ? 10 : 4}`, 'info'));
                }

                logs.push(createLog(`${player.name} 向 ${owner.name} 支付租金 $${rent}。`, 'danger'));

                const newPlayers = [...state.players];
                const pIdx = newPlayers.findIndex(p => p.id === playerId);
                const oIdx = newPlayers.findIndex(p => p.id === owner.id);
                
                newPlayers[pIdx].money -= rent;
                newPlayers[oIdx].money += rent;

                if (newPlayers[pIdx].money < 0) {
                    newPlayers[pIdx].bankrupt = true;
                    logs.push(createLog(`${player.name} 破产了！`, 'danger'));
                    // Check End Game
                    const active = newPlayers.filter(p => !p.bankrupt);
                    if (active.length <= 1) {
                         return { ...state, players: newPlayers, winner: active[0] || null, phase: GamePhase.GAME_OVER };
                    }
                    const newTiles = state.tiles.map(t => t.ownerId === playerId ? { ...t, ownerId: null, houseCount: 0 } : t);
                    return { ...state, players: newPlayers, tiles: newTiles, phase: GamePhase.END_TURN, waitingForDoublesTurn: false };
                }
                return { ...state, players: newPlayers, phase: isDouble ? GamePhase.ROLLING : GamePhase.END_TURN, waitingForDoublesTurn: isDouble };
            }
        } else if (!tile.ownerId) {
             return { ...state, phase: GamePhase.ACTION, waitingForDoublesTurn: isDouble };
        }
      }

      // 4. Tax
      if (tile.type === TileType.TAX) {
          const tax = tile.price || 100;
          logs.push(createLog(`${player.name} 缴纳了 $${tax} 税款。`, 'danger'));
          const newPlayers = [...state.players];
          const idx = newPlayers.findIndex(p => p.id === playerId);
          newPlayers[idx].money -= tax;
          return { ...state, players: newPlayers, phase: isDouble ? GamePhase.ROLLING : GamePhase.END_TURN, waitingForDoublesTurn: isDouble };
      }

      return { ...state, phase: isDouble ? GamePhase.ROLLING : GamePhase.END_TURN, waitingForDoublesTurn: isDouble };
  };

  const applyChanceEffect = (state: GameState, playerId: string, card: ChanceCard, isDouble: boolean, logs: GameLog[]): GameState => {
        const newPlayers = [...state.players];
        const pIndex = newPlayers.findIndex(p => p.id === playerId);
        const player = newPlayers[pIndex];
        
        let nextPhase = isDouble ? GamePhase.ROLLING : GamePhase.END_TURN;
        let waitingForDoubles = isDouble;

        logs.push(createLog(`${player.name} 执行: ${card.title}`, 'info'));

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
                    logs.push(createLog(`${player.name} 被送进监狱！`, 'danger'));
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
                logs.push(createLog(`${player.name} 被送进监狱！`, 'danger'));
                nextPhase = GamePhase.END_TURN;
                waitingForDoubles = false;
                break;
        }

        return { 
            ...state, 
            players: newPlayers, 
            phase: nextPhase, 
            waitingForDoublesTurn: waitingForDoubles 
        };
  };

  const checkOwnsGroup = (playerId: string | undefined | null, group: ColorGroup, allTiles: Tile[]) => {
    if (!playerId || group === ColorGroup.NONE) return false;
    const groupTiles = allTiles.filter(t => t.group === group);
    return groupTiles.length > 0 && groupTiles.every(t => t.ownerId === playerId);
  };


  // --- ROOM MANAGEMENT ---
  const handleLogin = () => {
    if (!nickname.trim()) return;
    const user = { id: uuidv4(), name: nickname.trim() };
    setGameState(prev => ({ ...prev, currentUser: user, phase: GamePhase.LOBBY_ROOMS }));
  };

  const createRoom = () => {
    if (!gameState.currentUser || !newRoomName.trim()) return;
    socket?.emit("create_room", { 
        roomName: newRoomName.trim(), 
        hostName: gameState.currentUser.name, 
        hostId: gameState.currentUser.id 
    });
  };

  const joinRoom = (roomId: string) => {
    if (!gameState.currentUser) return;
    socket?.emit("join_room", { roomId, user: gameState.currentUser });
  };

  const addAI = () => {
    if (!gameState.roomId || !gameState.isHost) return;
    const aiIcons = ['🤖', '🐶', '👽', '🦖'];
    const currentRoom = rooms.find(r => r.id === gameState.roomId);
    if (!currentRoom) return;

    const currentCount = currentRoom.players.length;
    if (currentCount >= 4) return;

    const aiPlayer = { 
        id: uuidv4(), 
        name: `电脑 ${currentCount}`, 
        isAI: true, 
        isHost: false 
    };
    socket?.emit("add_ai", { roomId: gameState.roomId, aiPlayer });
  };

  const handleStartGameRequest = () => {
    if (!gameState.roomId || !gameState.isHost) return;
    const room = rooms.find(r => r.id === gameState.roomId);
    if (!room) return;

    const colors = ['#3b82f6', '#ef4444', '#eab308', '#22c55e'];
    const icons = ['🚗', '✈️', '🚢', '🚀']; 

    const gamePlayers: Player[] = room.players.map((p, i) => ({
      id: p.id,
      name: p.name,
      color: colors[i % colors.length],
      icon: p.isAI ? '🤖' : icons[i % icons.length], 
      isAI: p.isAI,
      money: INITIAL_MONEY,
      position: 0,
      isInJail: false,
      jailTurns: 0,
      consecutiveDoubles: 0,
      properties: [],
      bankrupt: false
    }));

    const initialState: GameState = {
        players: gamePlayers,
        currentPlayerIndex: 0,
        tiles: INITIAL_TILES.map(t => ({...t, ownerId: null, houseCount: 0})),
        dice: [1, 1],
        phase: GamePhase.ROLLING,
        logs: [{ id: 'init', message: "游戏开始！祝你好运。", type: 'info', timestamp: Date.now() }],
        winner: null,
        currentCard: null,
        selectedTileId: null,
        waitingForDoublesTurn: false,
        currentUser: null, // Placeholder, replaced locally
        roomId: room.id,
        isHost: true // Sent as template
    };

    socket?.emit("start_game", { roomId: gameState.roomId, initialGameState: initialState });
  };


  // --- AI HOOK (HOST ONLY) ---
  useEffect(() => {
    // Only Host runs AI
    if (!gameState.isHost) return;

    const activeStates = [GamePhase.ROLLING, GamePhase.ACTION, GamePhase.END_TURN];
    if (!activeStates.includes(gameState.phase)) return;

    const currentPlayer = getCurrentPlayer();
    if (!currentPlayer || !currentPlayer.isAI || currentPlayer.bankrupt) return;

    const runAITurn = async () => {
      await new Promise(r => setTimeout(r, 1000));

      if (gameState.phase === GamePhase.ROLLING) {
        if (currentPlayer.isInJail && currentPlayer.money >= 500) {
            executeGameLogic({ type: 'PAY_BAIL', playerId: currentPlayer.id });
            await new Promise(r => setTimeout(r, 500));
            executeGameLogic({ type: 'ROLL', playerId: currentPlayer.id });
        } else {
            executeGameLogic({ type: 'ROLL', playerId: currentPlayer.id });
        }
      } else if (gameState.phase === GamePhase.ACTION) {
         const decision = await getAIDecision(gameState, currentPlayer);
         // Log the thinking? We need to add log action or just direct state mod if host.
         // Host direct state mod for logs is easier in `executeGameLogic` but here we want to log reasoning.
         // Let's just execute the action.
         
         if (decision.action === 'BUY') {
            executeGameLogic({ type: 'BUY', playerId: currentPlayer.id });
         } else if (decision.action === 'PAY_JAIL') {
             // Handled above
         } else {
            executeGameLogic({ type: 'PASS', playerId: currentPlayer.id });
         }
      } else if (gameState.phase === GamePhase.END_TURN) {
         executeGameLogic({ type: 'END_TURN', playerId: currentPlayer.id });
      }
    };

    runAITurn();
  }, [gameState.phase, gameState.currentPlayerIndex, gameState.waitingForDoublesTurn, gameState.isHost]); 

  // --- RENDERING SCREENS ---

  if (gameState.phase === GamePhase.LOGIN) {
      return (
        <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full text-center">
                <h1 className="text-4xl font-extrabold text-indigo-600 mb-6">GeminiPoly Online</h1>
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
      const isHost = gameState.isHost;

      if (!room) return <div>房间不存在</div>;

      return (
          <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl shadow-xl p-8 max-w-2xl w-full">
                  <div className="flex justify-between items-center mb-6 border-b pb-4">
                      <h2 className="text-2xl font-bold text-slate-800">{room.name}</h2>
                      {/* Leave room logic omitted for brevity in network version - would need socket event */}
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
  if (!currentPlayer) return <div>Loading...</div>;

  const currentTile = gameState.tiles[currentPlayer.position];
  const canBuy = (currentTile.type === TileType.PROPERTY || currentTile.type === TileType.STATION || currentTile.type === TileType.UTILITY) && !currentTile.ownerId;
  const selectedTile = gameState.selectedTileId !== null ? gameState.tiles.find(t => t.id === gameState.selectedTileId) : null;
  const isSelectedTileOwner = selectedTile?.ownerId === gameState.currentUser?.id;
  
  // Upgrade check: Must be MY property, I must be active turn player (optional rule, but easier UI), and I own group.
  const checkOwnsGroupLocal = (group: ColorGroup) => {
      if (!gameState.currentUser) return false;
      return checkOwnsGroup(gameState.currentUser.id, group, gameState.tiles);
  };
  
  const canUpgrade = isSelectedTileOwner && 
                     selectedTile?.type === TileType.PROPERTY && 
                     checkOwnsGroupLocal(selectedTile.group);

  // Dispatch wrappers
  const onRoll = () => dispatchAction('ROLL');
  const onBuy = () => dispatchAction('BUY');
  const onPass = () => dispatchAction('PASS');
  const onEndTurn = () => dispatchAction('END_TURN');
  const onPayBail = () => dispatchAction('PAY_BAIL');
  const onSurrender = () => dispatchAction('SURRENDER');
  const onUpgrade = () => dispatchAction('UPGRADE');

  // Ensure user can only act if it's their turn
  const isMyTurn = gameState.currentUser?.id === currentPlayer.id;

  return (
    <div className="h-screen bg-slate-100 flex flex-col md:flex-row overflow-hidden">
      
      {/* CONTROL PANEL (Side/Top) */}
      <div className="w-full md:w-80 lg:w-96 p-4 flex flex-col gap-4 shadow-xl bg-white/95 backdrop-blur-sm md:h-full z-20 overflow-y-auto">
        <div className="flex items-center justify-between md:justify-start gap-2 mb-2">
            <h1 className="text-xl font-bold text-indigo-900">GeminiPoly</h1>
            <span className="bg-indigo-100 text-indigo-800 text-[10px] font-semibold px-2 py-0.5 rounded">
                {gameState.isHost ? 'Host' : 'Guest'} | Room: {rooms.find(r => r.id === gameState.roomId)?.name}
            </span>
        </div>
        
        {/* We pass the 'local' player to control panel, but actions are dispatched */}
        <ControlPanel 
            player={gameState.currentUser?.id === currentPlayer.id ? currentPlayer : currentPlayer} // Always show current turn player state logic
            phase={gameState.phase}
            currentTile={currentTile}
            dice={gameState.dice}
            canBuy={!!canBuy && currentPlayer.money >= (currentTile.price || 0)}
            onRoll={onRoll}
            onBuy={onBuy}
            onPass={onPass}
            onEndTurn={onEndTurn}
            onPayBail={onPayBail}
            onSurrender={onSurrender}
            waitingForDoubles={gameState.waitingForDoublesTurn}
        />
        
        {/* Mask controls if not my turn (Double check visual aid) */}
        {!isMyTurn && gameState.phase !== GamePhase.GAME_OVER && (
            <div className="text-center text-xs text-slate-400">
                (观察模式: 等待 {currentPlayer.name} 行动)
            </div>
        )}

        {/* Selected Tile Context */}
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

                {/* RENT TABLE (Omitted for brevity, assumed same as before) */}
                {(selectedTile.type === TileType.PROPERTY && selectedTile.rent) && (
                    <div className="bg-slate-50 rounded border border-slate-200 p-2 text-xs">
                         <div className="grid grid-cols-2 gap-y-1">
                            <div className="text-slate-500">基础租金</div>
                            <div className="text-right font-medium">${selectedTile.rent[0]}</div>
                            <div className="text-slate-500">1 栋房屋</div>
                            <div className="text-right font-medium">${selectedTile.rent[1]}</div>
                            <div className="text-slate-500">酒店</div>
                            <div className="text-right font-bold text-purple-600">${selectedTile.rent[5]}</div>
                        </div>
                    </div>
                )}

                {canUpgrade && (
                    <button 
                        onClick={onUpgrade}
                        className="mt-4 w-full py-2 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded shadow transition-colors"
                        disabled={!gameState.currentUser || getPlayerById(gameState.currentUser.id)!.money < (selectedTile.houseCost || 0)}
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
        <div className="w-full max-w-[90vh] aspect-square relative bg-[#CDE6D0] border-4 border-slate-800 shadow-2xl rounded-lg grid grid-cols-11 grid-rows-11 gap-0.5 p-0.5 text-[8px] md:text-xs">
            
            {/* Center Area */}
            <div className="col-start-2 col-end-11 row-start-2 row-end-11 bg-[#CDE6D0] flex flex-col items-center justify-center relative overflow-hidden pointer-events-none">
                {gameState.currentCard ? (
                    <div className="bg-white rounded-xl shadow-2xl p-4 md:p-8 max-w-sm w-4/5 border-4 border-orange-400 flex flex-col items-center text-center z-50 pointer-events-auto animate-bounce-in">
                        <div className="text-4xl md:text-6xl mb-2 md:mb-4">❓</div>
                        <h3 className="text-lg md:text-2xl font-bold text-slate-800 mb-2">{gameState.currentCard.title}</h3>
                        <p className="text-slate-600 mb-2 md:mb-4 text-sm md:text-lg">{gameState.currentCard.description}</p>
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
