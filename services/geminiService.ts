import { GoogleGenAI, Type } from "@google/genai";
import { GameState, Player, Tile, AIDecision, TileType } from "../types";

const genAI = new GoogleGenAI({ apiKey: process.env.API_KEY });

// We minify the state to reduce token usage and focus on relevant info
const getContext = (gameState: GameState, player: Player) => {
  const currentTile = gameState.tiles[player.position];
  
  const relevantTiles = gameState.tiles.map(t => ({
    id: t.id,
    name: t.name,
    type: t.type,
    price: t.price,
    owner: t.ownerId ? (t.ownerId === player.id ? 'SELF' : 'OPPONENT') : null,
    group: t.group,
    rent: t.rent ? t.rent[t.houseCount || 0] : 0,
    isMortgaged: t.isMortgaged
  }));

  return {
    player: {
      money: player.money,
      position: player.position,
      isInJail: player.isInJail,
      properties: player.properties
    },
    currentTile: {
      id: currentTile.id,
      name: currentTile.name,
      type: currentTile.type,
      price: currentTile.price,
      owner: currentTile.ownerId,
      rentCost: (currentTile.type === TileType.PROPERTY || currentTile.type === TileType.STATION || currentTile.type === TileType.UTILITY || currentTile.type === TileType.TAX) ? (currentTile.price || 0) / 10 : 0 // heuristic
    },
    boardState: relevantTiles
  };
};

export const getAIDecision = async (gameState: GameState, player: Player): Promise<AIDecision> => {
  const context = getContext(gameState, player);
  
  const systemPrompt = `
    你正在玩大富翁 (Monopoly) 游戏。你是一个有竞争力的 AI 玩家。
    你的目标是让对手破产并拥有更多地产。请用中文思考和回复。
    
    当前情况:
    - 你的位置: ${context.currentTile.name} (ID: ${context.currentTile.id})
    - 你的资金: $${context.player.money}
    - 地块类型: ${context.currentTile.type}
    - 地块价格: $${context.currentTile.price || 0}
    - 地块拥有者: ${context.currentTile.owner || '无'}
    
    规则:
    - 如果你停留在无人的地产上且资金充足（通常保留 $200 作为缓冲），购买它。
    - 如果资金不足，放弃购买。
    - 如果你在监狱中，且资金充裕 (> 500)，选择支付保释金离开，否则等待。
    
    请返回一个 JSON 对象，包含你的决定。
  `;

  try {
    const response = await genAI.models.generateContent({
      model: "gemini-2.5-flash",
      contents: JSON.stringify(context),
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            action: {
              type: Type.STRING,
              enum: ['BUY', 'PASS', 'PAY_JAIL'],
              description: "采取的行动"
            },
            reasoning: {
              type: Type.STRING,
              description: "简短的中文解释，说明为什么做出这个选择。"
            }
          },
          required: ["action", "reasoning"]
        }
      }
    });

    const text = response.text;
    if (!text) throw new Error("No response from AI");
    
    const decision = JSON.parse(text) as AIDecision;
    return decision;
  } catch (error) {
    console.error("AI Decision Error", error);
    // Fallback simple logic
    const currentTile = gameState.tiles[player.position];
    const isBuyable = currentTile.type === TileType.PROPERTY || currentTile.type === TileType.STATION || currentTile.type === TileType.UTILITY;
    if (isBuyable && !currentTile.ownerId && (player.money > (currentTile.price || 0) + 100)) {
       return { action: 'BUY', reasoning: "备用逻辑：我有足够的钱，买买买！" };
    }
    return { action: 'PASS', reasoning: "备用逻辑：没钱或者不想买。" };
  }
};