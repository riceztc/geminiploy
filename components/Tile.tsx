
import React from 'react';
import { Tile as TileType, ColorGroup, Player } from '../types';
import { COLOR_MAP } from '../constants';

interface TileProps {
  tile: TileType;
  playersOnTile: Player[];
  onClick: (tile: TileType) => void;
  ownerColor?: string;
}

const Tile: React.FC<TileProps> = ({ tile, playersOnTile, onClick, ownerColor }) => {
  const isCorner = tile.id % 10 === 0;
  
  const getGridStyle = (id: number) => {
    if (id >= 0 && id <= 10) return { gridColumn: 11 - id, gridRow: 11 };
    if (id >= 11 && id <= 19) return { gridColumn: 1, gridRow: 11 - (id - 10) };
    if (id >= 20 && id <= 30) return { gridColumn: id - 19, gridRow: 1 };
    if (id >= 31 && id <= 39) return { gridColumn: 11, gridRow: id - 29 };
    return {};
  };

  const style = getGridStyle(tile.id);
  const colorClass = COLOR_MAP[tile.group] || 'bg-slate-100';

  // House visual indicators
  const renderHouses = () => {
      if (!tile.houseCount || tile.houseCount === 0) return null;
      if (tile.houseCount === 5) {
          return <span className="text-[10px] leading-none absolute top-1 right-5 text-red-600">🏨</span>;
      }
      return (
          <div className="flex gap-0.5 absolute top-1 right-5">
              {Array.from({length: tile.houseCount}).map((_, i) => (
                  <span key={i} className="text-[8px] leading-none text-green-700">🏠</span>
              ))}
          </div>
      );
  };

  return (
    <div
      onClick={() => onClick(tile)}
      className={`relative border border-slate-300 flex flex-col items-center justify-between select-none cursor-pointer hover:z-10 hover:shadow-lg hover:scale-105 transition-all bg-white ${isCorner ? 'p-1' : 'p-0.5'}`}
      style={{
        ...style,
        gridColumnStart: style.gridColumn,
        gridRowStart: style.gridRow,
        minWidth: isCorner ? '100%' : undefined,
        minHeight: isCorner ? '100%' : undefined,
      }}
    >
      {/* Color Bar for Properties */}
      {tile.group !== ColorGroup.NONE && tile.group !== ColorGroup.STATION && tile.group !== ColorGroup.UTILITY && (
        <div className={`w-full h-[20%] ${colorClass} absolute top-0 left-0 border-b border-slate-300`} />
      )}
      
      {/* Content */}
      <div className={`flex flex-col items-center justify-center w-full h-full ${tile.group !== ColorGroup.NONE && !isCorner ? 'pt-[22%]' : ''} z-0 overflow-hidden`}>
        <span className="text-center font-bold leading-tight px-0.5 break-words w-full text-slate-800 text-[10px] md:text-xs">
          {tile.name}
        </span>
        {tile.price && (
          <span className="mt-0.5 font-medium text-slate-500 text-[9px]">${tile.price}</span>
        )}
        
        {/* Ownership UI */}
        {tile.ownerId && ownerColor && (
            <div 
              className="absolute top-1 right-1 px-1 rounded shadow-sm border border-white flex items-center justify-center"
              style={{ backgroundColor: ownerColor }}
              title={`Owner: ${tile.ownerId}`}
            >
              <span className="text-white text-[10px]">🏠</span>
            </div>
        )}
        
        {renderHouses()}
      </div>

      {/* Players */}
      <div className="absolute bottom-0 left-0 right-0 flex justify-center items-end pb-1 px-1 pointer-events-none flex-wrap">
        {playersOnTile.map(p => (
          <div 
            key={p.id} 
            className="text-2xl md:text-3xl transform -translate-y-1 drop-shadow-md transition-transform hover:scale-125 z-20 filter drop-shadow-lg"
            title={p.name}
          >
            {p.icon}
          </div>
        ))}
      </div>
    </div>
  );
};

export default Tile;
