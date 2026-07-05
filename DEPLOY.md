# Publicar o Acromania na Railway

O Acromania é um servidor Node + WebSocket persistente, então precisa de um host que rode
processos de longa duração (Railway, Render, Fly). **Não roda em Vercel** (serverless não
segura WebSocket nem os timers das rodadas). A Railway roda o projeto sem nenhuma alteração
de código.

O login é feito por você (OAuth no navegador). O repo já está pronto: `railway.json` define o
start, o `PORT` é lido de variável de ambiente e o ranking vai pra um volume persistente.

## Opção A — Pelo site (mais simples, sem instalar nada)

1. Entra em https://railway.app e faz login com o GitHub.
2. **New Project → Deploy from GitHub repo → `inventormiguel/acromania`**.
3. A Railway detecta o Node sozinho e roda `npm start`. Aguarda o primeiro deploy.
4. **Settings → Networking → Generate Domain**: gera a URL pública (tipo
   `acromania-production.up.railway.app`). O WebSocket usa a mesma URL (o cliente troca
   `ws`→`wss` sozinho em https).
5. **Ranking persistente** (recomendado): em **Variables**, adiciona `DATA_DIR=/data`.
   Depois **Settings → Volumes → New Volume**, mount path `/data`. Assim o ranking sobrevive
   a cada redeploy. (Sem isso o jogo funciona igual, só zera o ranking a cada deploy.)

## Opção B — Pela CLI

```bash
npm i -g @railway/cli
railway login          # abre o navegador
cd ~/Documents/dashboard/acromania
railway init           # cria o projeto
railway up             # sobe o código
railway domain         # gera a URL pública
railway variables set DATA_DIR=/data   # opcional: ranking persistente (+ criar volume em /data no painel)
```

## Deploy automático

Depois de conectado ao repo, **todo `git push` na branch `main` dispara um novo deploy** —
como a gente já commita cada alteração, o site atualiza sozinho.

## Variáveis de ambiente

| Variável   | Padrão        | Pra quê                                             |
|------------|---------------|-----------------------------------------------------|
| `PORT`     | `8477`        | Porta HTTP/WebSocket (a Railway injeta a dela).     |
| `DATA_DIR` | `./data`      | Onde o `ranking.json` é gravado. Aponta pro volume. |
