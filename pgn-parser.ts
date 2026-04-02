import { Chess } from 'chess.js'

export type ParsedMove = {
  san: string
  moveLabel: string
  fen: string
  annotation: string
  from: string
  to: string
}

export type ArticleToken = { text: string; moveIndex: number }

export type ParsedGame = {
  white: string
  black: string
  event: string
  date: string
  result: string
  moves: ParsedMove[]
  articleText: string
  articleTokens: ArticleToken[]
}

function stripMarkup(text: string): string {
  return text.replace(/\[%(?:clk|cal|csl)\s+[^\]]*\]/g, '').trim()
}

function cleanAnnotation(text: string): string {
  let cleaned = stripMarkup(text)
  cleaned = cleaned.replace(/\$\d+/g, '')
  cleaned = cleaned.replace(/https?:\/\/lichess\.org\/\S+/g, '')
  cleaned = cleaned.replace(/\s+/g, ' ').trim()
  cleaned = cleaned.replace(/[,]\s*$/, '').trim()
  return cleaned
}

function parseHeaders(pgn: string): Record<string, string> {
  const headers: Record<string, string> = {}
  const headerRe = /\[(\w+)\s+"([^"]*)"\]/g
  let m: RegExpExecArray | null
  while ((m = headerRe.exec(pgn)) !== null) {
    headers[m[1]!] = m[2]!
  }
  return headers
}

function extractMovetext(pgn: string): string {
  const lines = pgn.split('\n')
  let lastHeaderIndex = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.startsWith('[')) lastHeaderIndex = i
  }
  return lines.slice(lastHeaderIndex + 1).join(' ').trim()
}

type Token =
  | { type: 'move-number'; text: string }
  | { type: 'move'; text: string }
  | { type: 'annotation'; text: string }
  | { type: 'variation-start' }
  | { type: 'variation-end' }
  | { type: 'result'; text: string }
  | { type: 'nag'; text: string }

function tokenize(movetext: string): Token[] {
  const tokens: Token[] = []
  let i = 0

  while (i < movetext.length) {
    if (/\s/.test(movetext[i]!)) { i++; continue }

    if (movetext[i] === '{') {
      let depth = 1
      let j = i + 1
      while (j < movetext.length && depth > 0) {
        if (movetext[j] === '{') depth++
        else if (movetext[j] === '}') depth--
        j++
      }
      tokens.push({ type: 'annotation', text: movetext.slice(i + 1, j - 1) })
      i = j
      continue
    }

    if (movetext[i] === '(') { tokens.push({ type: 'variation-start' }); i++; continue }
    if (movetext[i] === ')') { tokens.push({ type: 'variation-end' }); i++; continue }

    if (movetext[i] === '$') {
      let j = i + 1
      while (j < movetext.length && /\d/.test(movetext[j]!)) j++
      tokens.push({ type: 'nag', text: movetext.slice(i, j) })
      i = j
      continue
    }

    const resultMatch = movetext.slice(i).match(/^(1-0|0-1|1\/2-1\/2|\*)/)
    if (resultMatch) {
      tokens.push({ type: 'result', text: resultMatch[0] })
      i += resultMatch[0].length
      continue
    }

    const moveNumMatch = movetext.slice(i).match(/^(\d+)(\.{1,3})\s*/)
    if (moveNumMatch) {
      tokens.push({ type: 'move-number', text: moveNumMatch[0].trim() })
      i += moveNumMatch[0].length
      continue
    }

    const sanMatch = movetext.slice(i).match(/^([KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?|O-O-O|O-O)[+#]?[!?]*/i)
    if (sanMatch) {
      tokens.push({ type: 'move', text: sanMatch[0] })
      i += sanMatch[0].length
      continue
    }

    i++
  }

  return tokens
}

export function parsePgn(pgn: string): ParsedGame {
  const headers = parseHeaders(pgn)
  const movetext = extractMovetext(pgn)
  const tokens = tokenize(movetext)

  const chess = new Chess()
  const moves: ParsedMove[] = []
  let intro = ''
  let variationDepth = 0
  let isFirstAnnotation = true

  moves.push({ san: '', moveLabel: 'Start', fen: chess.fen(), annotation: '', from: '', to: '' })

  for (const token of tokens) {
    if (token.type === 'variation-start') { variationDepth++; continue }
    if (token.type === 'variation-end') { variationDepth--; continue }
    if (variationDepth > 0) continue

    if (token.type === 'annotation') {
      const cleaned = cleanAnnotation(token.text)
      if (cleaned.length === 0) continue
      if (isFirstAnnotation && moves.length === 1) {
        intro = cleaned
        isFirstAnnotation = false
        continue
      }
      isFirstAnnotation = false
      moves[moves.length - 1]!.annotation = cleaned
      continue
    }

    if (token.type === 'move-number') continue
    if (token.type === 'nag') continue
    if (token.type === 'result') continue

    if (token.type === 'move') {
      const cleanSan = token.text.replace(/[!?]+$/, '')
      let result
      try {
        result = chess.move(cleanSan)
      } catch {
        continue
      }
      const isBlack = chess.turn() === 'w'
      const moveNum = isBlack ? chess.moveNumber() - 1 : chess.moveNumber()
      const label = isBlack
        ? `${moveNum}... ${token.text}`
        : `${moveNum}. ${token.text}`

      moves.push({
        san: token.text,
        moveLabel: label,
        fen: chess.fen(),
        annotation: '',
        from: result.from,
        to: result.to,
      })
    }
  }

  const articleTokens: ArticleToken[] = []
  if (intro.length > 0) {
    articleTokens.push({ text: intro + ' ', moveIndex: -1 })
  }
  for (let i = 1; i < moves.length; i++) {
    const move = moves[i]!
    articleTokens.push({ text: move.moveLabel, moveIndex: i })
    if (move.annotation.length > 0) {
      articleTokens.push({ text: ' ' + move.annotation, moveIndex: -1 })
    }
    articleTokens.push({ text: ' ', moveIndex: -1 })
  }

  const articleText = articleTokens.map(t => t.text).join('')

  return {
    white: headers['White'] ?? 'White',
    black: headers['Black'] ?? 'Black',
    event: headers['Event'] ?? '',
    date: headers['Date'] ?? '',
    result: headers['Result'] ?? '*',
    moves,
    articleText,
    articleTokens,
  }
}
