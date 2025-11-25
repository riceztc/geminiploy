import React, { useRef, useEffect } from 'react';
import { GameLog as GameLogType } from '../types';

interface GameLogProps {
  logs: GameLogType[];
}

const GameLog: React.FC<GameLogProps> = ({ logs }) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <div className="h-48 bg-white rounded-xl shadow-md border border-slate-200 flex flex-col overflow-hidden">
      <div className="bg-slate-100 px-4 py-2 border-b border-slate-200 text-xs font-bold text-slate-500 uppercase tracking-wider">
        游戏动态
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {logs.map(log => (
          <div key={log.id} className="text-sm">
            <span className={`font-semibold mr-2 ${
              log.type === 'success' ? 'text-green-600' :
              log.type === 'danger' ? 'text-red-600' :
              log.type === 'warning' ? 'text-amber-600' :
              'text-blue-600'
            }`}>
              [{new Date(log.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute:'2-digit', second: '2-digit' })}]
            </span>
            <span className="text-slate-700">{log.message}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
};

export default GameLog;