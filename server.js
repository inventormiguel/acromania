const http = require('http');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8477;

const app = express();
app.set('trust proxy', true); // atrás do proxy da Railway: pega o IP real do cliente

// ---- detecção de idioma por IP: Brasil → pt, resto do mundo → en
const geoCache = new Map(); // ip -> 'pt' | 'en'

function isLocalIp(ip) {
  ip = (ip || '').replace(/^::ffff:/, '');
  return !ip || ip === '::1' || ip.startsWith('127.') || ip.startsWith('10.') ||
    ip.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    ip.startsWith('169.254.') || ip.startsWith('fc') || ip.startsWith('fd');
}

async function langForRequest(req) {
  // Cloudflare (se um dia entrar na frente) já entrega o país de graça
  const cf = req.headers['cf-ipcountry'];
  if (cf && cf !== 'XX' && cf !== 'T1') return cf === 'BR' ? 'pt' : 'en';

  const ip = ((req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '';
  const acceptPt = (req.headers['accept-language'] || '').toLowerCase().startsWith('pt');

  // localhost/rede interna: não dá pra geolocalizar → usa o idioma do navegador como palpite
  if (isLocalIp(ip)) return acceptPt ? 'pt' : 'en';
  if (geoCache.has(ip)) return geoCache.get(ip);

  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 2500);
    const resp = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, { signal: ctrl.signal });
    clearTimeout(to);
    const data = await resp.json();
    const lang = data && data.country_code === 'BR' ? 'pt' : 'en';
    geoCache.set(ip, lang);
    return lang;
  } catch (_) {
    return acceptPt ? 'pt' : 'en'; // geo falhou: cai no idioma do navegador
  }
}

app.get('/api/lang', async (req, res) => {
  res.json({ lang: await langForRequest(req) });
});

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
const RANKING_TOP = 10;
const CHAT_LOG_MAX = 50;
const CHAT_MAX_LEN = 200;
const CHAT_MIN_INTERVAL_MS = 500; // anti-flood

// temas nos dois idiomas — cada sala usa só o idioma dela
const THEMES = [
  { pt: 'Desculpa pra chegar atrasado no trabalho', en: 'Excuse for being late to work' },
  { pt: 'Nome de filme de terror brasileiro', en: 'Name of a low-budget horror movie' },
  { pt: 'Slogan de político em ano de eleição', en: "Politician's slogan in an election year" },
  { pt: 'Mensagem no grupo da família', en: 'Message in the family group chat' },
  { pt: 'Nome de banda de garagem', en: 'Name of a garage band' },
  { pt: 'Título de novela das nove', en: 'Title of a prime-time soap opera' },
  { pt: 'Coisa que o chefe fala na segunda-feira', en: 'Something the boss says on a Monday' },
  { pt: 'Promessa de ano novo que ninguém cumpre', en: "New Year's resolution nobody keeps" },
  { pt: 'Nome de golpe da internet', en: 'Name of an internet scam' },
  { pt: 'Frase de para-choque de caminhão', en: 'Truck bumper sticker phrase' },
  { pt: 'Recado colado na geladeira', en: 'Note stuck on the fridge' },
  { pt: 'Nome de perfume barato', en: 'Name of a cheap perfume' },
  { pt: 'Manchete de jornal sensacionalista', en: 'Tabloid headline' },
  { pt: 'Coisa que se fala no elevador', en: 'Something you say in the elevator' },
  { pt: 'Nome de curso de coach', en: 'Name of a life-coach course' },
  { pt: 'Legenda de foto de academia', en: 'Gym selfie caption' },
  { pt: 'Desculpa pra sair da festa cedo', en: 'Excuse to leave the party early' },
  { pt: 'Nome de restaurante de beira de estrada', en: 'Name of a roadside diner' },
  { pt: 'Frase de biscoito da sorte', en: 'Fortune cookie message' },
  { pt: 'Título de reality show', en: 'Reality show title' },
  { pt: 'Coisa que a inteligência artificial pensa da gente', en: 'What AI really thinks about us' },
  { pt: 'Nome de time de futebol de várzea', en: 'Name of a Sunday-league soccer team' },
  { pt: 'Assunto de reunião que podia ser um email', en: "Meeting topic that could've been an email" },
  { pt: 'Frase de camiseta de turista', en: 'Tourist t-shirt phrase' },
  { pt: 'Nome de programa de TV de domingo', en: 'Name of a Sunday TV show' },
  { pt: 'Nome de aplicativo que ninguém baixa', en: 'Name of an app nobody downloads' },
  { pt: 'Frase que o professor fala na prova', en: 'Something the teacher says during an exam' },
  { pt: 'Título de filme de sessão da tarde', en: 'Title of an afternoon TV movie' },
  { pt: 'Coisa que se ouve no salão de beleza', en: 'Something you overhear at the hair salon' },
  { pt: 'Nome de sorvete exótico', en: 'Name of an exotic ice cream flavor' },
  { pt: 'Desculpa pra não ir na academia', en: 'Excuse to skip the gym' },
  { pt: 'Frase de vendedor de loja de shopping', en: 'Mall store salesperson line' },
  { pt: 'Nome de vilão de novela', en: 'Name of a soap opera villain' },
  { pt: 'Legenda de foto de casamento', en: 'Wedding photo caption' },
  { pt: 'Nome de food truck', en: 'Name of a food truck' },
  { pt: 'Coisa que o GPS fala quando você erra o caminho', en: 'What the GPS says when you miss the turn' },
  { pt: 'Título de livro de autoajuda', en: 'Self-help book title' },
  { pt: 'Nome de loja de 1,99', en: 'Name of a dollar store' },
  { pt: 'Frase de horóscopo', en: 'Horoscope line' },
  { pt: 'Coisa que se fala no primeiro encontro', en: 'Something you say on a first date' },
  { pt: 'Nome de música sertaneja', en: 'Name of a country song' },
  { pt: 'Promessa de vereador', en: 'City councilman campaign promise' },
  { pt: 'Coisa que o dentista fala com a mão na sua boca', en: 'What the dentist says with their hand in your mouth' },
  { pt: 'Nome de campeonato de videogame', en: 'Name of a video game tournament' },
  { pt: 'Frase motivacional de segunda-feira', en: 'Monday motivational quote' },
];

// letras comuns como iniciais em PT/EN (sem K W X Y Z)
const LETTERS = 'AABBCCDDEEFFGGIJLLMMNNOOPPQRRSSTTUV';

// ---------------------------------------------------------------- ranking (banquinho de dados em JSON)
// DATA_DIR configurável: aponta pra um volume persistente em produção (ex: Railway → /data)
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'ranking.json');

let ranking = { pt: {}, en: {} }; // lang -> { chaveMinúscula: {name, points, wins, games} }
try {
  ranking = { pt: {}, en: {}, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) };
} catch (_) { /* primeiro boot: arquivo ainda não existe */ }

function saveRanking() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(ranking, null, 2));
  } catch (err) {
    console.error('erro salvando ranking:', err.message);
  }
}

function topRanking(lang) {
  return Object.values(ranking[lang] || {})
    .sort((a, b) => b.points - a.points || b.wins - a.wins)
    .slice(0, RANKING_TOP)
    .map((r) => ({ name: r.name, points: r.points, wins: r.wins }));
}

function recordGame(room) {
  const podium = room.activePlayers().sort((a, b) => b.score - a.score);
  podium.forEach((p, i) => {
    const key = p.name.toLowerCase();
    const entry = ranking[room.lang][key] || { name: p.name, points: 0, wins: 0, games: 0 };
    entry.name = p.name;
    entry.points += p.score;
    entry.games += 1;
    if (i === 0 && p.score > 0) entry.wins += 1;
    ranking[room.lang][key] = entry;
  });
  saveRanking();
}

// ---------------------------------------------------------------- estado vivo (sobrevive a restart/deploy)
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const RESUME_GRACE_MS = 8000; // fôlego mínimo ao voltar de um deploy

let savedState = {};
try { savedState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (_) { /* sem estado salvo ainda */ }

let stateSaveTimer = null;
function persistState() {
  clearTimeout(stateSaveTimer);
  stateSaveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const snap = {};
      for (const lang of Object.keys(rooms)) snap[lang] = rooms[lang].snapshot();
      fs.writeFileSync(STATE_FILE, JSON.stringify(snap));
    } catch (err) {
      console.error('erro salvando estado vivo:', err.message);
    }
  }, 400);
}

// ---------------------------------------------------------------- helpers
function normalize(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function validatePhrase(text, letters) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length !== letters.length) {
    return { ok: false, code: 'wordCount', params: { n: letters.length } };
  }
  for (let i = 0; i < letters.length; i++) {
    const first = normalize(words[i]).replace(/[^A-Z]/g, '')[0];
    if (first !== letters[i]) {
      return { ok: false, code: 'wordLetter', params: { i: i + 1, word: words[i], letter: letters[i] } };
    }
  }
  return { ok: true };
}

function sendError(ws, code, params) {
  ws.send(JSON.stringify({ type: 'error', code, params: params || {} }));
}

// ---------------------------------------------------------------- sala (uma por idioma)
function createRoom(lang, saved) {
  const room = {
    lang,
    players: new Map(),      // ws -> player (conexões vivas)
    roster: new Map(),       // key -> {name, activeFromRound} (sobrevive a quedas e a deploy)
    nextId: 1,
    scoresByName: new Map(), // key -> pontos
    game: null,
    phaseTimer: null,
    chatLog: [],
  };

  function freshGame() {
    return {
      phase: 'lobby',
      round: 0,
      theme: null,
      letters: [],
      letterCounts: [], // quantidades pré-sorteadas pra variar bem (ex: [4,3,2,3,4])
      usedLetterSets: new Set(),
      usedThemes: new Set(), // guarda o theme.pt (string) pra sobreviver a serialização
      endsAt: 0,
      submissions: new Map(), // key -> texto
      votes: new Map(),       // key -> idx votado
      entries: [],            // [{idx, key, name, text}]
      lastResults: null,
      paused: false,
      remainingMs: 0,
    };
  }
  room.game = freshGame();

  room.activePlayers = () => [...room.players.values()];

  // jogador "da rodada": entrou antes dela começar
  const inRound = (p) => room.game.round >= p.activeFromRound;

  function drawLetters() {
    const g = room.game;
    if (!g.letterCounts.length) {
      // garante variação: 2, 3 e 4 sempre aparecem no torneio (máx. 4 letras)
      g.letterCounts = shuffle([2, 3, 4, 2 + Math.floor(Math.random() * 3), 2 + Math.floor(Math.random() * 3)]);
    }
    const count = g.letterCounts[(g.round - 1) % g.letterCounts.length];
    for (let attempt = 0; attempt < 20; attempt++) {
      const letters = [];
      while (letters.length < count) {
        const l = LETTERS[Math.floor(Math.random() * LETTERS.length)];
        if (letters.filter((x) => x === l).length < 2) letters.push(l);
      }
      const key = [...letters].sort().join('');
      if (!g.usedLetterSets.has(key) || attempt === 19) {
        g.usedLetterSets.add(key);
        return letters;
      }
    }
  }

  function drawTheme() {
    const g = room.game;
    const available = THEMES.filter((t) => !g.usedThemes.has(t.pt));
    const pool = available.length ? available : THEMES;
    const theme = pool[Math.floor(Math.random() * pool.length)];
    g.usedThemes.add(theme.pt);
    return theme;
  }

  function publicState(forPlayer) {
    const g = room.game;
    const spectator = !inRound(forPlayer) && g.phase !== 'lobby' && g.phase !== 'final';
    const base = {
      type: 'state',
      roomLang: lang,
      phase: g.phase,
      round: g.round,
      totalRounds: TOTAL_ROUNDS,
      theme: g.theme,
      letters: g.letters,
      endsAt: g.paused ? 0 : g.endsAt,
      paused: g.paused,
      now: Date.now(),
      youSpectator: spectator,
      you: { id: forPlayer.id, name: forPlayer.name, score: forPlayer.score },
      players: room.activePlayers()
        .map((p) => ({
          id: p.id,
          name: p.name,
          score: p.score,
          waiting: !inRound(p) && g.phase !== 'lobby',
          submitted: g.submissions.has(p.key),
          voted: g.votes.has(p.key),
        }))
        .sort((a, b) => b.score - a.score),
    };

    if (g.phase === 'writing') {
      base.youSubmitted = g.submissions.has(forPlayer.key);
    }
    if (g.phase === 'voting') {
      base.entries = g.entries.map((e) => ({ idx: e.idx, text: e.text }));
      base.yourEntryIdx = g.entries.find((e) => e.key === forPlayer.key)?.idx ?? null;
      base.yourVote = g.votes.get(forPlayer.key) ?? null;
    }
    if (g.phase === 'results' || g.phase === 'final') {
      base.results = g.lastResults;
    }
    if (g.phase === 'lobby' || g.phase === 'final') {
      base.ranking = topRanking(lang);
    }
    if (g.phase === 'final') {
      base.podium = room.activePlayers()
        .map((p) => ({ name: p.name, score: p.score }))
        .sort((a, b) => b.score - a.score);
    }
    return base;
  }

  room.send = (p) => {
    try { p.ws.send(JSON.stringify(publicState(p))); } catch (_) {}
  };
  room.broadcast = () => { for (const p of room.activePlayers()) room.send(p); };

  // chat da sala: mensagens de jogador ({name, text}) e de sistema ({system: 'joined'|'left', name})
  room.chat = (msg) => {
    msg.ts = Date.now();
    room.chatLog.push(msg);
    if (room.chatLog.length > CHAT_LOG_MAX) room.chatLog.shift();
    const payload = JSON.stringify({ type: 'chat', ...msg });
    for (const p of room.activePlayers()) {
      try { p.ws.send(payload); } catch (_) {}
    }
    persistState();
  };

  // qual função encerra a fase atual (usada pra re-armar o timer ao despausar)
  function phaseEndFn() {
    return { writing: endWriting, voting: endVoting, results: nextRoundOrFinal, final: backToLobby }[room.game.phase];
  }

  function setPhase(phase, durationMs, onEnd) {
    const g = room.game;
    g.phase = phase;
    g.paused = false;
    g.endsAt = durationMs ? Date.now() + durationMs : 0;
    g.remainingMs = durationMs || 0;
    clearTimeout(room.phaseTimer);
    if (durationMs) room.phaseTimer = setTimeout(onEnd, durationMs);
    room.broadcast();
    persistState();
  }

  // congela a partida (ninguém online / deploy) sem perder nada
  function pauseGame() {
    const g = room.game;
    if (g.paused || !g.endsAt) return;
    g.remainingMs = Math.max(1000, g.endsAt - Date.now());
    g.paused = true;
    clearTimeout(room.phaseTimer);
    persistState();
  }

  // descongela quando alguém volta, re-armando o timer com o tempo que faltava
  function resumeGame() {
    const g = room.game;
    if (!g.paused) return;
    const fn = phaseEndFn();
    if (!fn) { g.paused = false; return; }
    const ms = Math.max(1000, g.remainingMs || 1000);
    g.paused = false;
    g.endsAt = Date.now() + ms;
    clearTimeout(room.phaseTimer);
    room.phaseTimer = setTimeout(fn, ms);
    room.broadcast();
    persistState();
  }

  room.startGame = () => {
    const kept = room.game.usedThemes;
    room.game = freshGame();
    room.game.usedThemes = kept;
    for (const p of room.activePlayers()) {
      p.score = 0;
      p.activeFromRound = 1;
      room.scoresByName.set(p.key, 0);
      room.roster.set(p.key, { name: p.name, activeFromRound: 1 });
    }
    startRound();
  };

  function startRound() {
    const g = room.game;
    g.round += 1;
    g.theme = drawTheme();
    g.letters = drawLetters();
    g.submissions = new Map();
    g.votes = new Map();
    g.entries = [];
    setPhase('writing', WRITING_MS, endWriting);
  }

  function endWriting() {
    const g = room.game;
    const entries = [...g.submissions.entries()].map(([key, text]) => ({
      key, name: (room.roster.get(key) && room.roster.get(key).name) || key, text,
    }));
    if (entries.length === 0) {
      g.lastResults = { theme: g.theme, letters: g.letters, entries: [], nobody: true };
      return setPhase('results', RESULTS_MS, nextRoundOrFinal);
    }
    shuffle(entries);
    g.entries = entries.map((e, idx) => ({ idx, ...e }));
    setPhase('voting', VOTING_MS, endVoting);
  }

  function endVoting() {
    const g = room.game;
    const voteCount = new Map();
    for (const idx of g.votes.values()) {
      voteCount.set(idx, (voteCount.get(idx) || 0) + 1);
    }
    const results = g.entries
      .map((e) => {
        const votes = voteCount.get(e.idx) || 0;
        const points = votes * POINTS_PER_VOTE;
        const total = (room.scoresByName.get(e.key) || 0) + points;
        room.scoresByName.set(e.key, total);
        const player = room.activePlayers().find((p) => p.key === e.key);
        if (player) player.score = total;
        return { text: e.text, author: e.name, votes, points };
      })
      .sort((a, b) => b.votes - a.votes);

    g.lastResults = { theme: g.theme, letters: g.letters, entries: results, nobody: false };
    setPhase('results', RESULTS_MS, nextRoundOrFinal);
  }

  function nextRoundOrFinal() {
    if (room.players.size === 0) { pauseGame(); return; } // ninguém online: congela, não zera
    if (room.game.round >= TOTAL_ROUNDS) {
      recordGame(room);
      setPhase('final', FINAL_MS, backToLobby);
    } else {
      startRound();
    }
  }

  function backToLobby() {
    room.game = freshGame();
    room.scoresByName = new Map();
    for (const p of room.activePlayers()) {
      p.activeFromRound = 1;
      room.roster.set(p.key, { name: p.name, activeFromRound: 1 });
    }
    room.broadcast();
    persistState();
  }

  room.maybeEndWritingEarly = () => {
    const g = room.game;
    if (g.phase !== 'writing' || g.paused) return;
    const active = room.activePlayers().filter(inRound);
    if (active.length > 0 && active.every((p) => g.submissions.has(p.key))) {
      clearTimeout(room.phaseTimer);
      endWriting();
    }
  };

  room.maybeEndVotingEarly = () => {
    const g = room.game;
    if (g.phase !== 'voting' || g.paused) return;
    const eligible = room.activePlayers().filter(inRound).filter((p) => {
      const own = g.entries.find((e) => e.key === p.key);
      return g.entries.length > (own ? 1 : 0);
    });
    if (eligible.length > 0 && eligible.every((p) => g.votes.has(p.key))) {
      clearTimeout(room.phaseTimer);
      endVoting();
    }
  };

  room.join = (ws, name) => {
    const g = room.game;
    const key = name.toLowerCase();
    const existing = room.roster.get(key);
    const reconnect = !!existing && g.phase !== 'lobby'; // voltando pra uma partida em andamento
    const activeFromRound = existing
      ? existing.activeFromRound
      : (g.phase === 'lobby' || g.phase === 'final') ? 1 : g.round + 1;
    room.roster.set(key, { name, activeFromRound });
    const player = {
      id: room.nextId++,
      name,
      key,
      score: room.scoresByName.get(key) || 0, // reconexão mantém pontos
      activeFromRound,
      ws,
    };
    room.players.set(ws, player);
    if (g.paused) resumeGame(); // alguém voltou → descongela a partida
    room.broadcast();
    try { ws.send(JSON.stringify({ type: 'chatHistory', messages: room.chatLog })); } catch (_) {}
    if (!reconnect) room.chat({ system: 'joined', name: player.name });
    persistState();
    return player;
  };

  // forget=true: saída explícita (esquece o jogador). forget=false: queda/deploy (guarda pra reconectar)
  room.leave = (ws, forget) => {
    const player = room.players.get(ws);
    if (!player) return;
    room.players.delete(ws);
    if (forget) {
      room.roster.delete(player.key);
      room.chat({ system: 'left', name: player.name });
    }
    if (room.players.size === 0) {
      if (forget) {
        // último jogador saiu de propósito → encerra a sessão de vez
        clearTimeout(room.phaseTimer);
        room.game = freshGame();
        room.scoresByName = new Map();
        room.roster = new Map();
        room.chatLog = [];
      } else {
        pauseGame(); // caiu geral (ou deploy) → congela e mantém tudo
      }
    } else {
      room.broadcast();
      room.maybeEndWritingEarly();
      room.maybeEndVotingEarly();
    }
    persistState();
  };

  // ---- snapshot pra sobreviver a restart/deploy
  room.snapshot = () => {
    const g = room.game;
    return {
      chatLog: room.chatLog,
      scoresByName: Object.fromEntries(room.scoresByName),
      roster: Object.fromEntries(room.roster),
      game: {
        phase: g.phase, round: g.round, theme: g.theme, letters: g.letters,
        letterCounts: g.letterCounts, usedLetterSets: [...g.usedLetterSets],
        usedThemes: [...g.usedThemes], endsAt: g.endsAt,
        submissions: Object.fromEntries(g.submissions),
        votes: Object.fromEntries(g.votes),
        entries: g.entries, lastResults: g.lastResults,
        paused: g.paused, remainingMs: g.remainingMs,
      },
    };
  };

  // ---- restauração no boot (partida em andamento volta PAUSADA, aguardando reconexão)
  if (saved && saved.game) {
    room.chatLog = Array.isArray(saved.chatLog) ? saved.chatLog : [];
    room.scoresByName = new Map(Object.entries(saved.scoresByName || {}));
    room.roster = new Map(Object.entries(saved.roster || {}));
    const s = saved.game;
    const g = room.game;
    g.phase = s.phase || 'lobby';
    g.round = s.round || 0;
    g.theme = s.theme || null;
    g.letters = s.letters || [];
    g.letterCounts = s.letterCounts || [];
    g.usedLetterSets = new Set(s.usedLetterSets || []);
    g.usedThemes = new Set(s.usedThemes || []);
    g.submissions = new Map(Object.entries(s.submissions || {}));
    g.votes = new Map(Object.entries(s.votes || {}).map(([k, v]) => [k, Number(v)]));
    g.entries = s.entries || [];
    g.lastResults = s.lastResults || null;
    if (g.phase !== 'lobby') {
      const leftover = s.paused ? (s.remainingMs || RESUME_GRACE_MS) : Math.max(0, (s.endsAt || 0) - Date.now());
      const phaseDur = { writing: WRITING_MS, voting: VOTING_MS, results: RESULTS_MS, final: FINAL_MS }[g.phase] || RESUME_GRACE_MS;
      g.remainingMs = Math.min(Math.max(leftover, RESUME_GRACE_MS), phaseDur);
      g.paused = true;
      g.endsAt = 0;
    }
  }

  room.inRound = inRound;
  return room;
}

const rooms = { pt: createRoom('pt', savedState.pt), en: createRoom('en', savedState.en) };

// ---------------------------------------------------------------- websocket
wss.on('connection', (ws) => {
  let me = null;
  let room = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (_) {
      return;
    }

    if (msg.type === 'join') {
      if (me) return; // já está numa sala; precisa sair antes
      const lang = msg.lang === 'en' ? 'en' : 'pt';
      const name = String(msg.name || '').trim().slice(0, 20);
      if (!name) return sendError(ws, 'needName');
      const target = rooms[lang];
      const taken = target.activePlayers().some((p) => p.name.toLowerCase() === name.toLowerCase());
      if (taken) return sendError(ws, 'nameTaken');
      room = target;
      me = room.join(ws, name);
      return;
    }

    if (!me || !room) return;

    if (msg.type === 'leave') {
      room.leave(ws, true); // saída explícita: esquece o jogador
      me = null;
      room = null;
      ws.send(JSON.stringify({ type: 'left' }));
      return;
    }

    if (msg.type === 'chat') {
      const text = String(msg.text || '').trim().slice(0, CHAT_MAX_LEN);
      if (!text) return;
      const nowTs = Date.now();
      if (me.lastChatAt && nowTs - me.lastChatAt < CHAT_MIN_INTERVAL_MS) return; // anti-flood
      me.lastChatAt = nowTs;
      room.chat({ name: me.name, text });
      return;
    }

    const g = room.game;

    if (msg.type === 'start') {
      if (g.phase !== 'lobby') return;
      if (room.players.size < MIN_PLAYERS_TO_START) {
        return sendError(ws, 'minPlayers', { n: MIN_PLAYERS_TO_START });
      }
      room.startGame();
      return;
    }

    if (msg.type === 'submit' && g.phase === 'writing') {
      if (!room.inRound(me)) return sendError(ws, 'waitRound');
      const text = String(msg.text || '').trim().slice(0, 120);
      const check = validatePhrase(text, g.letters);
      if (!check.ok) return sendError(ws, check.code, check.params);
      g.submissions.set(me.key, text);
      persistState();
      room.broadcast();
      room.maybeEndWritingEarly();
      return;
    }

    if (msg.type === 'vote' && g.phase === 'voting') {
      if (!room.inRound(me)) return sendError(ws, 'waitRound');
      const idx = Number(msg.idx);
      const entry = g.entries.find((e) => e.idx === idx);
      if (!entry) return;
      if (entry.key === me.key) return sendError(ws, 'selfVote');
      g.votes.set(me.key, idx);
      persistState();
      room.broadcast();
      room.maybeEndVotingEarly();
      return;
    }
  });

  ws.on('close', () => {
    if (room) room.leave(ws, false); // queda de conexão / deploy: guarda pra reconectar
    me = null;
    room = null;
  });
});

// no deploy/restart, a Railway manda SIGTERM antes de matar: grava o estado na hora, sem esperar o debounce
function flushStateSync() {
  try {
    clearTimeout(stateSaveTimer);
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const snap = {};
    for (const lang of Object.keys(rooms)) snap[lang] = rooms[lang].snapshot();
    fs.writeFileSync(STATE_FILE, JSON.stringify(snap));
  } catch (_) {}
}
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => { flushStateSync(); process.exit(0); });
}

server.listen(PORT, () => {
  console.log(`Acromania rodando em http://localhost:${PORT} (salas: pt, en | ranking: ${DB_FILE})`);
});
