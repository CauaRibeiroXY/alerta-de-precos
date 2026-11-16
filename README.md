<div align="center">
  <img src="assets/icon.svg" width="72" height="72" alt="Alerta de Preços">
  <h1>Alerta de Preços via WhatsApp</h1>
  <p>
    Monitor de preços leve em Node.js e TypeScript que consulta ofertas na internet periodicamente e envia alertas direto para o seu <strong>próprio chat do WhatsApp</strong>.
  </p>

  <p>
    <img src="https://img.shields.io/badge/Node.js-20%2B-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js">
    <img src="https://img.shields.io/badge/TypeScript-5.8-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript">
    <img src="https://img.shields.io/badge/WhatsApp-Baileys-25D366?style=flat-square&logo=whatsapp&logoColor=white" alt="WhatsApp Baileys">
    <img src="https://img.shields.io/badge/Tests-Vitest-6E9F18?style=flat-square&logo=vitest&logoColor=white" alt="Vitest">
  </p>
</div>

---

## ✨ Por que este projeto?

A maioria dos bots de monitoramento usa navegadores automatizados (Puppeteer/Playwright/Chromium), que consomem centenas de megabytes de RAM. Este projeto foi feito para rodar de forma **leve em segundo plano no seu PC** (~50–80 MB de RAM):

- **Sem navegador pesado:** usa apenas WebSockets (`@whiskeysockets/baileys`) + requisições HTTP diretas com `fetch` e `cheerio`.
- **Chat consigo mesmo ("Você"):** você envia comandos no seu próprio chat do WhatsApp e recebe as notificações ali mesmo — sem precisar criar grupos ou usar números extras.
- **Seguro para suas anotações:** mensagens comuns que não começam com `!` ou `/` são ignoradas silenciosamente.
- **Busca inteligente:**
  - Consulta em paralelo na **Amazon Brasil** e no **Buscapé** (trazendo ofertas de lojas como Amazon, Magazine Luiza, KaBuM!, Americanas, entre outras).
  - Filtra automaticamente **acessórios** (capinhas, películas, carregadores, suportes, cabos) e itens **usados/seminovos/recondicionados** (a menos que você peça por eles).
  - Suporta **exclusão de termos com `-`** (ex: `galaxy s25 -fe -plus -ultra`) para evitar variações indesejadas.
  - Encurta links longos de rastreamento da Amazon para URLs limpas (`/dp/ASIN`).
- **Anti-spam e persistência:** salva seus alertas em JSON local com escrita atômica e respeita um tempo mínimo (*cooldown*) antes de repetir avisos.

---

## 🛠️ Pré-requisitos

- **Node.js 20+** (recomendado 22+ ou 24+)
- **WhatsApp** instalado no celular (para escanear o QR Code na primeira vez)

---

## 🚀 Como instalar e rodar

### 1. Clone o repositório e instale as dependências

```bash
git clone https://github.com/CauaRibeiroXY/alerta-de-precos.git
cd alerta-de-precos
npm install
```

### 2. Inicie o bot

- **Windows (1 clique):** dê dois cliques no arquivo `iniciar.bat`
- **Terminal:**
  ```bash
  npm start
  ```

### 3. Conecte seu WhatsApp (apenas na primeira vez)

1. Um **QR Code** será exibido no terminal.
2. No celular, abra o **WhatsApp → Aparelhos conectados → Conectar aparelho** e aponte a câmera.
3. A sessão fica salva localmente na pasta `auth_session/`. Nas próximas vezes em que iniciar o programa, ele reconectará automaticamente.

---

## 💬 Comandos no WhatsApp

Abra a conversa com **você mesmo** no WhatsApp e envie qualquer comando abaixo (aceita prefixo `!` ou `/`):

| Comando | O que faz | Exemplo |
| :--- | :--- | :--- |
| `!buscar <produto>` | Busca as menores ofertas na hora | `!buscar rtx 4060` |
| `!buscar <produto> ate <preço>` | Busca na hora filtrando até um valor máximo | `!buscar galaxy s25 -fe ate 3500` |
| `!alerta <produto> ate <preço>` | Cria alerta para avisar quando atingir o preço-alvo | `!alerta iphone 15 ate 3800` |
| `!alerta <produto>` | Monitora sem valor fixo e avisa a cada queda de preço | `!alerta ssd nvme 1tb` |
| `!lista` *(ou `!alertas`)* | Lista todos os alertas salvos, preços atuais e IDs | `!lista` |
| `!verificar` *(ou `!checar`)* | Executa imediatamente a checagem de todos os alertas ativos | `!verificar` |
| `!pausar <id>` | Pausa o monitoramento de um alerta específico | `!pausar 1` |
| `!retomar <id>` | Reativa um alerta pausado | `!retomar 1` |
| `!remover <id>` *(ou `!del <id>`)* | Remove um alerta definitivamente | `!remover 1` |
| `!ajuda` *(ou `!help`)* | Exibe o guia rápido de comandos no chat | `!ajuda` |

### Dicas de busca

- **Produtos com números no nome** (`iPhone 15`, `RTX 4060`, `Galaxy S25`): use `ate`, `R$`, `<`, `|` ou centavos (`,00`) antes do valor para o bot não confundir o modelo com o preço.
- **Excluir modelos parecidos:** use `-termo` na busca ou no alerta. Exemplo:
  ```text
  !alerta galaxy s25 -fe -plus -ultra -edge ate 3200
  ```

---

## ⚙️ Configuração opcional (`.env`)

Se quiser personalizar os intervalos ou limites, crie um arquivo `.env` na raiz do projeto (baseado no `.env.example`):

| Variável | Padrão | Descrição |
| :--- | :--- | :--- |
| `CHECK_INTERVAL_MINUTES` | `30` | Intervalo em minutos entre as checagens automáticas |
| `ALERT_COOLDOWN_MINUTES` | `240` | Tempo mínimo (em min) antes de repetir um alerta para o mesmo produto |
| `MAX_SEARCH_RESULTS` | `5` | Quantidade máxima de ofertas exibidas no `!buscar` |
| `LOG_LEVEL` | `warn` | Nível de logs do Baileys (`silent`, `error`, `warn`, `info`) |

---

## 🏗️ Estrutura do projeto

```text
src/
├── config.ts                 # Carregamento de variáveis de ambiente e padrões
├── index.ts                  # Inicialização do bot, monitor e encerramento gracioso
├── types/
│   └── index.ts              # Contratos e tipagens TypeScript compartilhadas
├── scrapers/
│   ├── amazon.ts             # Extrator de ofertas da Amazon Brasil
│   ├── buscape.ts            # Extrator de ofertas do Buscapé (__NEXT_DATA__ + HTML)
│   ├── googleShopping.ts     # Fonte secundária com fallback seguro
│   └── index.ts              # Agregador paralelo, filtros anti-acessório/usados e ordenação
├── storage/
│   └── alertStore.ts         # Persistência atômica em JSON (data/alerts.json)
├── monitor/
│   └── priceMonitor.ts       # Agendador periódico, detecção de quedas e cooldown
└── whatsapp/
    ├── bot.ts                # Conexão Baileys, QR Code, trava anti-loop e chat pessoal
    └── commands.ts           # Parser de comandos e formatação das mensagens
```

---

## 🧪 Testes e verificação

O projeto possui suíte de testes automatizados com **Vitest** cobrindo parsers, filtros de relevância, armazenamento concorrente, regras de monitoramento/cooldown e comandos do WhatsApp:

```bash
# Rodar todos os testes
npm test

# Verificar tipagem TypeScript
npm run build

# Modo desenvolvimento com reload automático
npm run dev
```

---

## 🔒 Privacidade e segurança

- Suas credenciais do WhatsApp (`auth_session/`) e seus alertas (`data/alerts.json`) ficam armazenados **apenas localmente** na sua máquina e já estão listados no `.gitignore` para nunca serem enviados ao GitHub.
- O bot processa **somente** mensagens enviadas por você no seu próprio chat e ignora mensagens já enviadas por ele mesmo (prevenção de loop).
