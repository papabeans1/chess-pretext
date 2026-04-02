import {
  layoutNextLine,
  prepareWithSegments,
  type LayoutCursor,
  type LayoutLine,
  type PreparedTextWithSegments,
} from '../pretext-repo/src/layout.ts'
import { normalizeWhitespaceNormal } from '../pretext-repo/src/analysis.ts'
import { parsePgn } from './pgn-parser.ts'
import { carveTextLineSlots, getRectIntervalsForBand, type Rect } from './wrap-geometry.ts'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { ChessBoardPanel } from './chess-board.tsx'

const pgnResponse = await fetch(`${import.meta.env.BASE_URL}lichess-article.pgn`)
const game = parsePgn(await pgnResponse.text())

const BODY_FONT = '19px Palatino, serif'
const BODY_LINE_HEIGHT = 30
const TITLE_FONT = '700 34px system-ui, sans-serif'
const TITLE_LINE_HEIGHT = 42
const SUBTITLE_FONT = '500 13px system-ui, sans-serif'
const SUBTITLE_LINE_HEIGHT = 20
const BOARD_SIZE = 360
const BOARD_PADDING = 28
const BOARD_TOTAL_HEIGHT = BOARD_SIZE + 36
const GUTTER = 48
const MIN_TEXT_WIDTH = 100

type PositionedLine = { x: number; y: number; line: LayoutLine }

const stage = document.getElementById('stage')!
const boardContainer = document.createElement('div')
boardContainer.className = 'board-container'
stage.appendChild(boardContainer)
const reactRoot = createRoot(boardContainer)

let boardX = 0
let boardY = 0
let moveIndex = 0
let flipped = false
const scheduled = { value: false }
const dragging = { active: false, offsetX: 0, offsetY: 0 }
const titlePool: HTMLSpanElement[] = []
const bodyPool: HTMLDivElement[] = []
let subtitleEl: HTMLSpanElement | null = null
const pageEl = stage.closest('.page')! as HTMLElement

await document.fonts.ready
const preparedBody = prepareWithSegments(game.articleText, BODY_FONT)
const preparedTitle = prepareWithSegments(`${game.white} vs ${game.black}`, TITLE_FONT)
const preparedSubtitle = prepareWithSegments(`${game.event} — ${game.date}`, SUBTITLE_FONT)

const segmentMoveIndex = buildSegmentMoveIndex(preparedBody, game.articleText, game.articleTokens)

function lineSegRange(line: LayoutLine): [number, number] {
  return [line.start.segmentIndex, line.end.graphemeIndex > 0 ? line.end.segmentIndex + 1 : line.end.segmentIndex]
}

function buildSegmentMoveIndex(
  prepared: PreparedTextWithSegments,
  articleText: string,
  tokens: { text: string; moveIndex: number }[],
): Int16Array {
  const charMoveIndex = new Int16Array(articleText.length).fill(-1)
  let pos = 0
  for (const token of tokens) {
    if (token.moveIndex >= 0) {
      for (let j = 0; j < token.text.length; j++) {
        if (pos + j < charMoveIndex.length) charMoveIndex[pos + j] = token.moveIndex
      }
    }
    pos += token.text.length
  }

  const normalizedCharMoveIndex = new Int16Array(prepared.segments.reduce((s, seg) => s + seg.length, 0)).fill(-1)
  const normalized = normalizeWhitespaceNormal(articleText)

  let origIdx = 0
  let normIdx = 0
  while (origIdx < articleText.length && normIdx < normalized.length) {
    if (articleText[origIdx] !== normalized[normIdx]) {
      origIdx++
      continue
    }
    if (normIdx < normalizedCharMoveIndex.length) {
      normalizedCharMoveIndex[normIdx] = charMoveIndex[origIdx]!
    }
    origIdx++
    normIdx++
  }

  const result = new Int16Array(prepared.segments.length).fill(-1)
  let charPos = 0
  for (let i = 0; i < prepared.segments.length; i++) {
    const seg = prepared.segments[i]!
    const mid = charPos + Math.floor(seg.length / 2)
    if (mid < normalizedCharMoveIndex.length) {
      result[i] = normalizedCharMoveIndex[mid]!
    }
    charPos += seg.length
  }

  return result
}

function renderBodyLine(el: HTMLDivElement, line: LayoutLine): void {
  const [startSeg, endSeg] = lineSegRange(line)

  let hasMove = false
  for (let i = startSeg; i < endSeg; i++) {
    if (segmentMoveIndex[i]! >= 0) { hasMove = true; break }
  }

  if (!hasMove) {
    el.textContent = line.text
    return
  }

  el.textContent = ''
  let currentMoveIdx = -2
  let buf = ''

  function flush(): void {
    if (buf.length === 0) return
    if (currentMoveIdx >= 0) {
      const span = document.createElement('span')
      span.className = currentMoveIdx === moveIndex ? 'move-token move-token--active' : 'move-token'
      span.textContent = buf
      span.dataset['moveIndex'] = String(currentMoveIdx)
      el.appendChild(span)
    } else {
      el.appendChild(document.createTextNode(buf))
    }
    buf = ''
  }

  const segments = preparedBody.segments
  const kinds = (preparedBody as unknown as { kinds: string[] }).kinds

  for (let i = startSeg; i < endSeg; i++) {
    const kind = kinds[i]
    if (kind === 'soft-hyphen' || kind === 'hard-break') continue

    if (kind === 'space') {
      flush()
      currentMoveIdx = -1
      buf = ' '
      flush()
      currentMoveIdx = -2
      continue
    }

    const mid = segmentMoveIndex[i]!
    if (mid !== currentMoveIdx) {
      flush()
      currentMoveIdx = mid
    }
    buf += segments[i]!
  }
  flush()
}

function goToMove(idx: number): void {
  moveIndex = Math.max(0, Math.min(game.moves.length - 1, idx))
  renderBoard()
  scheduleRender()
}

function renderBoard(): void {
  const pos = game.moves[moveIndex]!
  reactRoot.render(
    React.createElement(ChessBoardPanel, {
      position: { fen: pos.fen, moveLabel: pos.moveLabel, from: pos.from, to: pos.to },
      boardSize: BOARD_SIZE,
      flipped,
      onFirst() { goToMove(0) },
      onPrev() { goToMove(moveIndex - 1) },
      onNext() { goToMove(moveIndex + 1) },
      onLast() { goToMove(game.moves.length - 1) },
      onFlip() { flipped = !flipped; renderBoard(); scheduleRender() },
    }),
  )
}

stage.addEventListener('click', (e) => {
  const target = (e.target as HTMLElement).closest('.move-token')
  if (!target) return
  const idx = parseInt((target as HTMLElement).dataset['moveIndex'] ?? '', 10)
  if (Number.isFinite(idx) && idx >= 0 && idx < game.moves.length) goToMove(idx)
})

document.addEventListener('keydown', (e) => {
  if (e.target !== document.body) return
  if (e.key === 'ArrowLeft') { e.preventDefault(); goToMove(moveIndex - 1) }
  else if (e.key === 'ArrowRight') { e.preventDefault(); goToMove(moveIndex + 1) }
  else if (e.key === 'Home') { e.preventDefault(); goToMove(0) }
  else if (e.key === 'End') { e.preventDefault(); goToMove(game.moves.length - 1) }
})

boardContainer.addEventListener('pointerdown', (e) => {
  if ((e.target as HTMLElement).closest('.board-controls')) return
  e.preventDefault()
  dragging.active = true
  dragging.offsetX = e.clientX - boardX
  dragging.offsetY = e.clientY + pageEl.scrollTop - boardY
  boardContainer.setPointerCapture(e.pointerId)
  boardContainer.style.cursor = 'grabbing'
  document.body.style.userSelect = 'none'
})

document.addEventListener('pointermove', (e) => {
  if (!dragging.active) return
  boardX = e.clientX - dragging.offsetX
  boardY = e.clientY + pageEl.scrollTop - dragging.offsetY
  scheduleRender()
})

document.addEventListener('pointerup', () => {
  if (!dragging.active) return
  dragging.active = false
  boardContainer.style.cursor = 'grab'
  document.body.style.userSelect = ''
})

function layoutColumn(
  prepared: PreparedTextWithSegments,
  start: LayoutCursor,
  region: Rect,
  lineHeight: number,
  obstacle: Rect,
): PositionedLine[] {
  let cursor = start
  let y = region.y
  const lines: PositionedLine[] = []

  while (true) {
    const blocked = getRectIntervalsForBand([obstacle], y, y + lineHeight, BOARD_PADDING, BOARD_PADDING)
    const slots = carveTextLineSlots({ left: region.x, right: region.x + region.width }, blocked)

    if (slots.length === 0) { y += lineHeight; continue }

    let slot = slots[0]!
    for (let i = 1; i < slots.length; i++) {
      const c = slots[i]!
      const cw = c.right - c.left, sw = slot.right - slot.left
      if (cw > sw || (cw === sw && c.left < slot.left)) slot = c
    }

    if (slot.right - slot.left < MIN_TEXT_WIDTH) { y += lineHeight; continue }

    const line = layoutNextLine(prepared, cursor, slot.right - slot.left)
    if (!line) break

    lines.push({ x: Math.round(slot.left), y: Math.round(y), line })
    cursor = line.end
    y += lineHeight
  }

  return lines
}

function layoutSimple(
  prepared: PreparedTextWithSegments,
  region: Rect,
  lineHeight: number,
): { lines: { x: number; y: number; text: string }[]; bottom: number } {
  let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 }
  let y = region.y
  const lines: { x: number; y: number; text: string }[] = []

  while (true) {
    const line = layoutNextLine(prepared, cursor, region.width)
    if (!line) break
    lines.push({ x: Math.round(region.x), y: Math.round(y), text: line.text })
    cursor = line.end
    y += lineHeight
  }

  return { lines, bottom: y }
}

function syncPool<T extends HTMLElement>(
  pool: T[],
  length: number,
  create: () => T,
): void {
  while (pool.length < length) { const el = create(); stage.appendChild(el); pool.push(el) }
  while (pool.length > length) pool.pop()!.remove()
}

function commitFrame(): void {
  const pageWidth = pageEl.clientWidth
  const col = GUTTER
  const colW = pageWidth - GUTTER * 2

  const bx = Math.max(GUTTER / 2, Math.min(boardX, pageWidth - BOARD_SIZE - GUTTER / 2))
  const title = layoutSimple(preparedTitle, { x: col, y: 28, width: colW, height: 200 }, TITLE_LINE_HEIGHT)
  const sub = layoutSimple(preparedSubtitle, { x: col, y: title.bottom + 4, width: colW, height: 40 }, SUBTITLE_LINE_HEIGHT)
  const bodyTop = sub.bottom + 24
  const by = Math.max(bodyTop, boardY)

  const bodyLines = layoutColumn(
    preparedBody,
    { segmentIndex: 0, graphemeIndex: 0 },
    { x: col, y: bodyTop, width: colW, height: 100000 },
    BODY_LINE_HEIGHT,
    { x: bx, y: by, width: BOARD_SIZE, height: BOARD_TOTAL_HEIGHT },
  )

  boardX = bx
  boardY = by

  syncPool(titlePool, title.lines.length, () => {
    const el = document.createElement('span')
    el.className = 'line line--title'
    return el
  })
  for (let i = 0; i < title.lines.length; i++) {
    const l = title.lines[i]!, el = titlePool[i]!
    el.textContent = l.text
    el.style.left = `${l.x}px`; el.style.top = `${l.y}px`
    el.style.font = TITLE_FONT; el.style.lineHeight = `${TITLE_LINE_HEIGHT}px`
  }

  if (!subtitleEl) { subtitleEl = document.createElement('span'); subtitleEl.className = 'line line--subtitle'; stage.appendChild(subtitleEl) }
  if (sub.lines.length > 0) {
    const s = sub.lines[0]!
    subtitleEl.textContent = s.text
    subtitleEl.style.left = `${s.x}px`; subtitleEl.style.top = `${s.y}px`
    subtitleEl.style.font = SUBTITLE_FONT; subtitleEl.style.lineHeight = `${SUBTITLE_LINE_HEIGHT}px`
  }

  syncPool(bodyPool, bodyLines.length, () => {
    const el = document.createElement('div')
    el.className = 'line line--body'
    return el
  })
  for (let i = 0; i < bodyLines.length; i++) {
    const bl = bodyLines[i]!, el = bodyPool[i]!
    el.style.left = `${bl.x}px`; el.style.top = `${bl.y}px`
    el.style.font = BODY_FONT; el.style.lineHeight = `${BODY_LINE_HEIGHT}px`
    renderBodyLine(el, bl.line)
  }

  boardContainer.style.left = `${bx}px`
  boardContainer.style.top = `${by}px`

  const lastBottom = bodyLines.length > 0 ? bodyLines[bodyLines.length - 1]!.y + BODY_LINE_HEIGHT : bodyTop
  stage.style.height = `${Math.max(lastBottom + GUTTER, by + BOARD_TOTAL_HEIGHT + GUTTER)}px`
}

function scheduleRender(): void {
  if (scheduled.value) return
  scheduled.value = true
  requestAnimationFrame(() => { scheduled.value = false; commitFrame() })
}

boardX = pageEl.clientWidth - BOARD_SIZE - GUTTER
boardY = 200
renderBoard()
requestAnimationFrame(commitFrame)
window.addEventListener('resize', scheduleRender)
