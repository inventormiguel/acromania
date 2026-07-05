# Acromania 🎉

Jogo multiplayer de acrônimos: a cada rodada o servidor sorteia um **tema** e **3 a 5 letras**. Cada jogador tem **30 segundos** pra escrever uma frase onde cada palavra começa com as letras sorteadas, na ordem. Depois todo mundo vota na melhor frase (anônima — e na sua não vale!). Cada voto = 100 pontos. Quem somar mais pontos em **5 rodadas** leva o torneio. 🏆

Dá pra entrar no meio da partida: o jogador novo já participa da rodada seguinte e pode votar na hora.

## Como rodar

```bash
npm install
npm start
```

Abre em [http://localhost:8477](http://localhost:8477) — e compartilha `http://SEU-IP:8477` com a galera na mesma rede.

Pra jogar com gente de fora, um túnel resolve:

```bash
cloudflared tunnel --url http://localhost:8477
```

## Publicar online (Railway)

Servidor WebSocket persistente — roda em Railway/Render/Fly sem alterar código (não roda em
Vercel serverless). Passo a passo em [DEPLOY.md](DEPLOY.md).

## Stack

- **Servidor**: Node.js + Express + ws (WebSocket) — toda a lógica do jogo em [server.js](server.js)
- **Cliente**: arquivo único [public/index.html](public/index.html), sem build, mobile-friendly
