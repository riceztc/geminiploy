
export enum ColorGroup {
  BROWN = 'brown',
  LIGHT_BLUE = 'light_blue',
  PINK = 'pink',
  ORANGE = 'orange',
  RED = 'red',
  YELLOW = 'yellow',
  GREEN = 'green',
  DARK_BLUE = 'dark_blue',
  STATION = 'station',
  UTILITY = 'utility',
  NONE = 'none'
}

export enum TileType {
  PROPERTY = 'PROPERTY',
  START = 'START',
  JAIL = 'JAIL',
  PARKING = 'PARKING',
  GO_TO_JAIL = 'GO_TO_JAIL',
  CHANCE = 'CHANCE',
  COMMUNITY_CHEST = 'COMMUNITY_CHEST',
  TAX = 'TAX',
  STATION = 'STATION',
  UTILITY = 'UTILITY'
}

export interface Tile {
  id: number;
  name: string;
  type: TileType;
  price?: number;
  rent?: number[]; // [base, 1 house, 2, 3, 4, hotel]
  group: ColorGroup;
  ownerId?: string | null;
  houseCost?: number;
  houseCount?: number; // 5 = hotel
  isMortgaged?: boolean;
}

export interface Player {
  id: string;
  name: string;
  color: string;
  icon: string;
  isAI: boolean;
  money: number;
  position: number;
  isInJail: boolean;
  jailTurns: number;
  consecutiveDoubles: number; // Track doubles for the 3-strikes rule
  properties: number[];
  bankrupt: boolean;
}

export enum GamePhase {
  LOGIN = 'LOGIN',
  LOBBY_ROOMS = 'LOBBY_ROOMS',
  ROOM_SETUP = 'ROOM_SETUP',
  ROLLING = 'ROLLING',
  MOVING = 'MOVING',
  ACTION = 'ACTION',
  SHOWING_CARD = 'SHOWING_CARD',
  END_TURN = 'END_TURN',
  GAME_OVER = 'GAME_OVER'
}

export interface GameLog {
  id: string;
  message: string;
  type: 'info' | 'success' | 'danger' | 'warning';
  timestamp: number;
}

export interface ChanceCard {
  id: number;
  title: string;
  description: string;
  effectType: 'MONEY' | 'MOVE_TO' | 'MOVE_STEPS' | 'GO_TO_JAIL';
  value: number;
}

export interface Room {
  id: string;
  name: string;
  hostId: string;
  players: { id: string; name: string; isAI: boolean; isHost: boolean }[];
  status: 'WAITING' | 'PLAYING';
  maxPlayers: number;
  createdAt: number;
}

export interface GameState {
  players: Player[];
  currentPlayerIndex: number;
  tiles: Tile[];
  dice: [number, number];
  phase: GamePhase;
  logs: GameLog[];
  winner: Player | null;
  currentCard: ChanceCard | null;
  selectedTileId: number | null; // For viewing/upgrading tiles
  waitingForDoublesTurn: boolean; // Flag to indicate player rolled doubles and goes again
  currentUser: { id: string; name: string } | null; // Current logged in user
  roomId: string | null;
}

export interface AIDecision {
  action: 'BUY' | 'PASS' | 'BUILD' | 'MORTGAGE' | 'PAY_JAIL';
  targetTileId?: number;
  reasoning: string;
}
