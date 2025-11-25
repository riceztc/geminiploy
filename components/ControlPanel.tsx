
import React from 'react';
import { GamePhase, Player, Tile } from '../types';

interface ControlPanelProps {
  player: Player;
  phase: GamePhase;
  currentTile: Tile;
  dice: [number, number];
  canBuy: boolean;
  onRoll: () => void;
  onBuy: () => void;
  onPass: () => void;
  onEndTurn: () => void;
  onPayBail: () => void;
  onSurrender: () => void;
  waitingForDoubles?: boolean;
}

const DiceFace = ({ value }: { value: number }) => {
  const dots = [];
  const positions: Record<number, number[][]> = {
    1: [[1, 1]],
    2: [[0, 0], [2, 2]],
    3: [[0, 0], [1, 1], [2, 2]],
    4: [[0, 0], [0, 2], [2, 0], [2, 2]],
    5: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]],
    6: [[0, 0], [0, 2], [1, 0], [1, 2], [2, 0], [2, 2]]
  };

  const currentPos = positions[value] || [];

  return (
    <div className="w-8 h-8 md:w-12 md:h-12 bg-white border border-slate-300 rounded-lg shadow-md flex relative p-1 shrink-0">
      {currentPos.map((pos, i) => (
        <div 
            key={i} 
            className="absolute w-1.5 h-1.5 md:w-2.5 md:h-2.5 bg-slate-800 rounded-full"
            style={{ 
                top: `${pos[0] * 33 + 10}%`, 
                left: `${pos[1] * 33 + 10}%` 
            }}
        />
      ))}
    </div>
  );
};

const ControlPanel: React.FC<ControlPanelProps> = ({ 
  player, phase, currentTile, dice, canBuy, onRoll, onBuy, onPass, onEndTurn, onPayBail, onSurrender, waitingForDoubles
}) => {
  const isMyTurn = !player.isAI;

  const getPhaseName = (p: GamePhase) => {
    switch(p) {
        case GamePhase.ROLLING: return waitingForDoubles ? '双倍奖励!' : '掷骰子';
        case GamePhase.MOVING: return '移动中';
        case GamePhase.ACTION: return '决策';
        case GamePhase.END_TURN: return '结束回合';
        case GamePhase.GAME_OVER: return '游戏结束';
        case GamePhase.SHOWING_CARD: return '机会卡';
        default: return p;
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-md p-3 md:p-6 w-full border border-slate-200">
      <div className="flex items-center justify-between mb-2 md:mb-4">
        <div className="flex items-center gap-2 md:gap-3">
            <div className="text-2xl md:text-3xl filter drop-shadow-sm">{player.icon}</div>
            <div className="overflow-hidden">
                <h2 className="text-base md:text-xl font-bold text-slate-800 truncate">{player.name}</h2>
                <div className="flex items-center gap-2">
                    <p className="text-slate-500 text-xs md:text-sm font-medium">现金: ${player.money}</p>
                    {player.isInJail && (
                        <span className="bg-red-100 text-red-600 text-[10px] px-1.5 py-0.5 rounded-full font-bold">
                            监狱中 ({player.jailTurns + 1}/3)
                        </span>
                    )}
                </div>
            </div>
        </div>
        <div className="text-right shrink-0">
            <div className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">当前阶段</div>
            <div className={`text-xs md:text-sm font-bold ${waitingForDoubles ? 'text-green-600 animate-pulse' : 'text-slate-700'}`}>
                {getPhaseName(phase)}
            </div>
        </div>
      </div>

      <div className="bg-slate-50 rounded-lg p-2 md:p-4 mb-3 md:mb-6 flex justify-center items-center gap-4 md:gap-6">
        <DiceFace value={dice[0]} />
        <DiceFace value={dice[1]} />
      </div>

      <div className="space-y-2 md:space-y-3">
        {phase === GamePhase.ROLLING && isMyTurn && (
          <>
            {player.isInJail ? (
                <div className="flex gap-2">
                    <button 
                        onClick={onRoll}
                        className="flex-1 py-2 md:py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg shadow-md transition-colors text-sm md:text-base"
                    >
                        尝试越狱
                    </button>
                    {player.money >= 50 && (
                        <button 
                            onClick={onPayBail}
                            className="flex-1 py-2 md:py-3 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg shadow-md transition-colors text-sm md:text-base"
                        >
                            保释 ($50)
                        </button>
                    )}
                </div>
            ) : (
                <button 
                    onClick={onRoll}
                    className={`w-full py-2 md:py-3 text-white font-bold rounded-lg shadow-md transition-colors text-sm md:text-lg ${waitingForDoubles ? 'bg-green-600 hover:bg-green-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}
                >
                    {waitingForDoubles ? '双倍! 再次掷骰' : '掷骰子'}
                </button>
            )}
          </>
        )}

        {phase === GamePhase.ACTION && isMyTurn && (
          <div className="flex gap-2">
            {canBuy && (
                <button 
                onClick={onBuy}
                className="flex-1 py-2 md:py-3 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg shadow-md transition-colors text-sm md:text-base"
                >
                购买 (${currentTile.price})
                </button>
            )}
            <button 
              onClick={onPass}
              className="flex-1 py-2 md:py-3 bg-slate-500 hover:bg-slate-600 text-white font-bold rounded-lg shadow-md transition-colors text-sm md:text-base"
            >
              {canBuy ? '放弃' : '继续'}
            </button>
          </div>
        )}

        {phase === GamePhase.END_TURN && isMyTurn && (
             <button 
             onClick={onEndTurn}
             className="w-full py-2 md:py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg shadow-md transition-colors text-sm md:text-base"
           >
             结束回合
           </button>
        )}

        {!isMyTurn && (
             <div className="w-full py-2 md:py-3 bg-slate-100 text-slate-400 text-sm md:text-base font-bold rounded-lg text-center border border-slate-200 animate-pulse">
                等待 {player.name} 行动...
             </div>
        )}

        {/* Surrender Button - Always visible for human player */}
        {isMyTurn && (
             <button 
                onClick={onSurrender}
                className="w-full py-1.5 mt-2 text-xs text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
             >
                认输 (退出游戏)
             </button>
        )}
      </div>
    </div>
  );
};

export default ControlPanel;
