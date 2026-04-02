import React, { useMemo } from 'react'
import { Chessboard } from 'react-chessboard'

type Props = {
  position: { fen: string; moveLabel: string; from: string; to: string }
  boardSize: number
  flipped: boolean
  onFirst: () => void
  onPrev: () => void
  onNext: () => void
  onLast: () => void
  onFlip: () => void
}

const HIGHLIGHT = { backgroundColor: 'rgba(255, 255, 0, 0.4)' }

export function ChessBoardPanel({
  position, boardSize, flipped,
  onFirst, onPrev, onNext, onLast, onFlip,
}: Props) {
  const fullFen = useMemo(
    () => position.fen.includes(' ') ? position.fen : `${position.fen} w - - 0 1`,
    [position.fen],
  )

  const squareStyles = useMemo(() => {
    if (!position.from || !position.to) return {}
    return { [position.from]: HIGHLIGHT, [position.to]: HIGHLIGHT }
  }, [position.from, position.to])

  return (
    <div style={{ width: boardSize }}>
      <div onPointerDown={e => e.stopPropagation()}>
        <Chessboard
          options={{
            position: fullFen,
            boardOrientation: flipped ? 'black' : 'white',
            allowDragging: false,
            animationDurationInMs: 200,
            showNotation: true,
            squareStyles,
            boardStyle: {
              borderRadius: '4px',
              boxShadow: '0 2px 12px rgba(0,0,0,0.18)',
            },
            darkSquareStyle: { backgroundColor: '#b58863' },
            lightSquareStyle: { backgroundColor: '#f0d9b5' },
          }}
        />
      </div>
      <div className="board-controls">
        <button className="board-btn" onClick={onFirst}>{'\u23EE'}</button>
        <button className="board-btn" onClick={onPrev}>{'\u23F4'}</button>
        <span className="board-move-label">{position.moveLabel}</span>
        <button className="board-btn" onClick={onNext}>{'\u23F5'}</button>
        <button className="board-btn" onClick={onLast}>{'\u23ED'}</button>
        <button className="board-btn" onClick={onFlip}>{'\u21C5'}</button>
      </div>
    </div>
  )
}
