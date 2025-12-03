import { GameState, Player, Tile, AIDecision, TileType, ColorGroup } from "../types";

// 本地规则型 AI (Heuristic AI)
// 不需要调用外部 API，完全在本地计算，速度快且免费。

export const getAIDecision = async (gameState: GameState, player: Player): Promise<AIDecision> => {
  const currentTile = gameState.tiles[player.position];
  const money = player.money;

  // 模拟一点“思考”延迟，让游戏节奏更自然
  // 注意：App.tsx 中已经有 1秒 的延迟，这里不需要额外太久的延迟
  
  // -------------------------
  // 购买决策逻辑 (BUY vs PASS)
  // -------------------------
  if (gameState.phase === 'ACTION') {
    // 确保是可购买的地块
    if (currentTile.type === TileType.PROPERTY || currentTile.type === TileType.STATION || currentTile.type === TileType.UTILITY) {
        const price = currentTile.price || 0;

        // 1. 没钱肯定不买
        if (money < price) {
            return { action: 'PASS', reasoning: "资金不足，无法购买。" };
        }

        // 2. 计算策略价值
        
        // 检查是否能凑齐同色系 (Monopoly!)
        const groupTiles = gameState.tiles.filter(t => t.group === currentTile.group && t.group !== ColorGroup.NONE);
        const ownedByMeInGroup = groupTiles.filter(t => t.ownerId === player.id);
        // 如果买了这块，我就拥有整个街区了吗？(当前已拥有的 + 这块 === 总数)
        const completesSet = (ownedByMeInGroup.length + 1) === groupTiles.length;
        
        // 检查是否是热门地段 (例如橙色/红色街区，离监狱出来的位置近)
        const isHotArea = currentTile.group === ColorGroup.ORANGE || currentTile.group === ColorGroup.RED;

        // 3. 设定保留金 (Reserve Cash)
        // AI 应该保留一些现金以防止踩雷破产
        let reserveCash = 300; 
        
        // 如果能凑齐一套，或者是非常好的地段，愿意冒风险，降低保留金
        if (completesSet) reserveCash = 50; 
        else if (isHotArea) reserveCash = 150;
        else if (currentTile.type === TileType.STATION) reserveCash = 200; // 车站收益稳定

        // 4. 做出决定
        if (money >= price + reserveCash) {
            let reason = "资金充裕，投资地产以获取收益。";
            if (completesSet) reason = "战略购买！拿下此地块即可垄断该街区，收取双倍租金。";
            else if (currentTile.type === TileType.STATION) reason = "投资交通枢纽通常是稳健的选择。";
            else if (isHotArea) reason = "此地段处于高频访问区，值得投资。";

            return { action: 'BUY', reasoning: reason };
        } else {
            // 如果钱不够保留金，但确实是很关键的地块(凑齐一套)，且买完不会立刻破产(剩 > 0)
            if (completesSet && money > price) {
                 return { action: 'BUY', reasoning: "虽然资金紧张，但这块地对达成垄断至关重要，值得冒险。" };
            }

            return { 
                action: 'PASS', 
                reasoning: `保留现金以备不时之需 (当前 $${money}, 售价 $${price}, 目标保留 $${reserveCash})。` 
            };
        }
    }
  }

  // -------------------------
  // 默认回调 (例如处理一些未预料的状态)
  // -------------------------
  return { action: 'PASS', reasoning: "无操作" };
};