const http = require('http');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8477;

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ---------------------------------------------------------------- config
const TOTAL_ROUNDS = 5;
const WRITING_MS = 30_000;
const VOTING_MS = 20_000;
const RESULTS_MS = 10_000;
const FINAL_MS = 25_000;
const POINTS_PER_VOTE = 100;
const MIN_PLAYERS_TO_START = 2;

const THEMES = [
  'Desculpa pra chegar atrasado no trabalho',
  'Nome de filme de terror brasileiro',
  'Slogan de político em ano de eleição',
  'Mensagem no grupo da família',
  'Nome de banda de garagem',
  'Título de novela das nove',
  'Coisa que o chefe fala na segunda-feira',
  'Promessa de ano novo que ninguém cumpre',
  'Nome de golpe da internet',
  'Frase de para-choque de caminhão',
  'Recado colado na geladeira',
  'Nome de perfume barato',
  'Manchete de jornal sensacionalista',
  'Coisa que se fala no elevador',
  'Nome de curso de coach',
  'Legenda de foto de academia',
  'Desculpa pra sair da festa cedo',
  'Nome de restaurante de beira de estrada',
  'Frase de biscoito da sorte',
  'Título de reality show',
  'Coisa que a inteligência artificial pensa da gente',
  'Nome de time de futebol de várzea',
  'Assunto de reunião que podia ser um email',
  'Frase de camiseta de turista',
  'Nome de programa de TV de domingo',
];

// letras comuns como iniciais em PT-BR (sem K W X Y Z)
const LETTERS = 'AABBCCDDEEFFGGIJLLMMNNOOPPQRRSSTTUV';

// ---------------------------------------------------------------- estado
let players = new Map(); // ws -> {id, name, score, ws}
let nextId = 1;
let scoresByName = new Map(); // nome -> pontos (pra reconectar sem perder pontos)

let game = freshGame();

function freshGame() {
  return {
    phase: 'lobby', // lobby | writing | voting | results | final
    round: 0,
    theme: null,
    letters: [],
    endsAt: 0,
    submissions: new Map(), // playerId -> texto
    votes: new Map(),       // voterId -> entryIdx
    entries: [],            // [{idx, playerId, text}] (ordem embaralhada)
    lastResults: null,
    usedThemes: new Set(),
  };
}

let phaseTimer = null;

// ---------------------------------------------------------------- helpers
function normalize(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}

function drawLetters() {
  const count = 3 + Math.floor(Math.random() * 3); // 3, 4 ou 5
  const letters = [];
  while (letters.length < count) {
    const l = LETTERS[Math.floor(Math.random() * LETTERS.length)];
    if (letters.filter((x) => x === l).length < 2) letters.push(l);
  }
  return letters;
}

function drawTheme() {
  const available = THEMES.filter((t) => !game.usedThemes.has(t));
  const pool = available.length ? available : THEMES;
  const theme = pool[Math.floor(Math.random() * pool.length)];
  game.usedThemes.add(theme);
  return theme;
}

function validatePhrase(text, letters) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length !== letters.length) {
    return { ok: false, error: `A frase precisa ter exatamente ${letters.length} palavras (uma pra cada letra).` };
  }
  for (let i = 0; i < letters.length; i++) {
    const first = normalize(words[i]).replace(/[^A-Z]/g, '')[0];
    if (first !== letters[i]) {
      return { ok: false, error: `A palavra ${i + 1} ("${words[i]}") precisa começar com ${letters[i]}.` };
    }
  }
  return { ok: true };
}

function activePlayers() {
  return [...players.values()];
}

function broadcast() {
  for (const p of activePlayers()) send(p);
}

function send(p) {
  const state = publicState(p);
  try {
    p.ws.send(JSON.stringify(state));
  } catch (_) {}
}

function publicState(forPlayer) {
  const base = {
    type: 'state',
    phase: game.phase,
    round: game.round,
    totalRounds: TOTAL_ROUNDS,
    theme: game.theme,
    letters: game.letters,
    endsAt: game.endsAt,
    now: Date.now(),
    you: { id: forPlayer.id, name: forPlayer.name, score: forPlayer.score },
    players: activePlayers()
      .map((p) => ({
        id: p.id,
        name: p.name,
        score: p.score,
        submitted: game.submissions.has(p.id),
        voted: game.votes.has(p.id),
      }))
      .sort((a, b) => b.score - a.score),
  };

  if (game.phase === 'writing') {
    base.youSubmitted = game.submissions.has(forPlayer.id);
    base.yourText = game.submissions.get(forPlayer.id) || '';
  }

  if (game.phase === 'voting') {
    base.entries = game.entries.map((e) => ({ idx: e.idx, text: e.text }));
    base.yourEntryIdx = game.entries.find((e) => e.playerId === forPlayer.id)?.idx ?? null;
    base.yourVote = game.votes.get(forPlayer.id) ?? null;
  }

  if (game.phase === 'results' || game.phase === 'final') {
    base.results = game.lastResults;
  }

  if (game.phase === 'final') {
    base.podium = activePlayers()
      .map((p) => ({ name: p.name, score: p.score }))
      .sort((a, b) => b.score - a.score);
  }

  return base;
}

// ---------------------------------------------------------------- fases
function setPhase(phase, durationMs, onEnd) {
  game.phase = phase;
  game.endsAt = durationMs ? Date.now() + durationMs : 0;
  clearTimeout(phaseTimer);
  if (durationMs) phaseTimer = setTimeout(onEnd, durationMs);
  broadcast();
}

function startGame() {
  const kept = game.usedThemes;
  game = freshGame();
  game.usedThemes = kept;
  for (const p of activePlayers()) {
    p.score = 0;
    scoresByName.set(p.name.toLowerCase(), 0);
  }
  startRound();
}

function startRound() {
  game.round += 1;
  game.theme = drawTheme();
  game.letters = drawLetters();
  game.submissions = new Map();
  game.votes = new Map();
  game.entries = [];
  setPhase('writing', WRITING_MS, endWriting);
}

function endWriting() {
  const entries = [...game.submissions.entries()].map(([playerId, text]) => ({ playerId, text }));
  if (entries.length === 0) {
    game.lastResults = { theme: game.theme, letters: game.letters, entries: [], nobody: true };
    return setPhase('results', RESULTS_MS, nextRoundOrFinal);
  }
  // embaralha e indexa (votação anônima)
  for (let i = entries.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [entries[i], entries[j]] = [entries[j], entries[i]];
  }
  game.entries = entries.map((e, idx) => ({ idx, ...e }));
  setPhase('voting', VOTING_MS, endVoting);
}

function endVoting() {
  const voteCount = new Map(); // idx -> votos
  for (const idx of game.votes.values()) {
    voteCount.set(idx, (voteCount.get(idx) || 0) + 1);
  }
  const results = game.entries
    .map((e) => {
      const votes = voteCount.get(e.idx) || 0;
      const points = votes * POINTS_PER_VOTE;
      const player = activePlayers().find((p) => p.id === e.playerId);
      if (player) {
        player.score += points;
        scoresByName.set(player.name.toLowerCase(), player.score);
      }
      return { text: e.text, author: player ? player.name : '(saiu do jogo)', votes, points };
    })
    .sort((a, b) => b.votes - a.votes);

  game.lastResults = { theme: game.theme, letters: game.letters, entries: results, nobody: false };
  setPhase('results', RESULTS_MS, nextRoundOrFinal);
}

function nextRoundOrFinal() {
  if (players.size === 0) {
    game = freshGame();
    return;
  }
  if (game.round >= TOTAL_ROUNDS) {
    setPhase('final', FINAL_MS, backToLobby);
  } else {
    startRound();
  }
}

function backToLobby() {
  game = freshGame();
  scoresByName = new Map();
  broadcast();
}

function maybeEndWritingEarly() {
  if (game.phase === 'writing' && players.size > 0 && game.submissions.size >= players.size) {
    clearTimeout(phaseTimer);
    endWriting();
  }
}

function maybeEndVotingEarly() {
  if (game.phase !== 'voting') return;
  // quem pode votar: todo mundo, menos quem só tem a própria frase pra votar
  const eligible = activePlayers().filter((p) => {
    const own = game.entries.find((e) => e.playerId === p.id);
    return game.entries.length > (own ? 1 : 0);
  });
  if (eligible.length > 0 && eligible.every((p) => game.votes.has(p.id))) {
    clearTimeout(phaseTimer);
    endVoting();
  }
}

// ---------------------------------------------------------------- websocket
wss.on('connection', (ws) => {
  let me = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (_) {
      return;
    }

    if (msg.type === 'join') {
      const name = String(msg.name || '').trim().slice(0, 20);
      if (!name) return ws.send(JSON.stringify({ type: 'error', error: 'Escolhe um nome aí!' }));
      const taken = activePlayers().some((p) => p.name.toLowerCase() === name.toLowerCase());
      if (taken) return ws.send(JSON.stringify({ type: 'error', error: 'Já tem alguém com esse nome na sala.' }));
      me = {
        id: nextId++,
        name,
        score: scoresByName.get(name.toLowerCase()) || 0, // reconexão mantém pontos
        ws,
      };
      players.set(ws, me);
      broadcast();
      return;
    }

    if (!me) return;

    if (msg.type === 'start') {
      if (game.phase !== 'lobby') return;
      if (players.size < MIN_PLAYERS_TO_START) {
        return ws.send(JSON.stringify({ type: 'error', error: `Precisa de pelo menos ${MIN_PLAYERS_TO_START} jogadores.` }));
      }
      startGame();
      return;
    }

    if (msg.type === 'submit' && game.phase === 'writing') {
      const text = String(msg.text || '').trim().slice(0, 120);
      const check = validatePhrase(text, game.letters);
      if (!check.ok) return ws.send(JSON.stringify({ type: 'error', error: check.error }));
      game.submissions.set(me.id, text);
      broadcast();
      maybeEndWritingEarly();
      return;
    }

    if (msg.type === 'vote' && game.phase === 'voting') {
      const idx = Number(msg.idx);
      const entry = game.entries.find((e) => e.idx === idx);
      if (!entry) return;
      if (entry.playerId === me.id) {
        return ws.send(JSON.stringify({ type: 'error', error: 'Votar em si mesmo não vale, belesma!' }));
      }
      game.votes.set(me.id, idx);
      broadcast();
      maybeEndVotingEarly();
      return;
    }
  });

  ws.on('close', () => {
    if (!me) return;
    players.delete(ws);
    if (players.size === 0) {
      clearTimeout(phaseTimer);
      game = freshGame();
      scoresByName = new Map();
    } else {
      broadcast();
      maybeEndWritingEarly();
      maybeEndVotingEarly();
    }
  });
});

server.listen(PORT, () => {
  console.log(`Acromania rodando em http://localhost:${PORT}`);
});
