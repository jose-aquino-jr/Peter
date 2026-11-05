# Peter

Assistente web em português com interface de chamada de vídeo. O fluxo principal é: microfone → transcrição local com Vosk → Brain → Ollama local → resposta no chat e voz do navegador.

O avatar VRM permanece integrado. Os ajustes de avatar e o reconhecimento de Libras por câmera não fazem parte do fluxo de conversa validado aqui.

## O que funciona

- Texto digitado é enviado ao Brain e a resposta aparece na conversa.
- O Ollama responde com o modelo local `qwen2.5:0.5b` usando `/api/chat`. A disponibilidade do serviço e o nome exato do modelo são verificados em `/api/tags` e exibidos no topo da interface.
- Se o Ollama estiver parado, expirar o tempo limite de 45 s ou devolver uma resposta fora do contrato esperado, o fallback local por regras assume. Ele responde a saudações e intenções conhecidas; para os demais textos, devolve uma mensagem genérica.
- O microfone grava no navegador e transcreve localmente com Vosk em português. A transcrição não usa o serviço de voz do navegador nem envia o áudio para a internet.
- A resposta falada usa a síntese de voz nativa do navegador (`speechSynthesis`, `pt-BR`).
- A conversa e o histórico ficam somente em memória, na sessão aberta. Não há persistência entre sessões.
- A interface segue no formato de chamada de vídeo. Câmera e chat em sobreposição são opcionais para a conversa por texto ou voz.

## Limitações conhecidas

- O modelo Vosk pequeno é leve e pode errar palavras com ruído, fala distante ou sotaques. A precisão precisa ser validada com os microfones reais usados no projeto.
- A gravação do microfone é limitada a 60 s e é encerrada automaticamente nesse limite.
- O modelo Ollama 0.5B pode demorar alguns segundos na primeira resposta, pode gerar conteúdo incorreto e tem limite de contexto curto.
- A síntese de voz depende das vozes instaladas no navegador e no sistema operacional. Algumas vozes podem não estar disponíveis offline ou podem não ter `pt-BR`.
- O reconhecimento de Libras por câmera é experimental, não é validado por este fluxo de conversa e depende de recursos externos carregados em tempo de execução (veja [Funcionamento offline](#funcionamento-offline)).
- O build do frontend emite aviso de chunks maiores que 500 kB. É um aviso de tamanho, não uma falha de build.

## Pré-requisitos

Os scripts atuais são de Windows (PowerShell) e usam o caminho `.venv\Scripts\python.exe`. O ambiente suportado é **Windows x64**.

| Item | Requisito |
| --- | --- |
| Sistema | Windows 10/11 x64, com PowerShell |
| Node.js | 20.19+ (série 20), 22.12+ (série 22) ou 24+. As versões atuais de Vite 8 e Vitest 4 não suportam oficialmente Node 21 ou 23 |
| npm | Incluído com o Node.js |
| Python | 3.10+ **64 bits**, disponível como `python` no `PATH`, com `venv` e `pip` |
| Ollama | Aplicativo Ollama para Windows, com o serviço em execução em `127.0.0.1:11434` |
| Navegador | Navegador com `getUserMedia`, `MediaRecorder`, `AudioContext`, `OfflineAudioContext` e `speechSynthesis` (Chromium ou Firefox atual) |
| Microfone | Permissão de microfone no navegador |

Para conferir as versões instaladas:

```powershell
node --version
npm.cmd --version
python --version
ollama --version
```

> No PowerShell, use `npm.cmd` para evitar o bloqueio do `npm.ps1` pela política de execução. Em `cmd.exe`, o comando equivalente é `npm`.

O microfone só é liberado em contexto seguro. `http://localhost` e `http://127.0.0.1` contam como seguros; abrir o app por um IP da rede local exige HTTPS.

## Instalação

A primeira instalação precisa de internet para baixar as dependências do npm, o pacote Python do Vosk, o modelo de português do Vosk e o modelo do Ollama. Depois disso, o fluxo de conversa pode funcionar offline.

### 1. Dependências do frontend

Na raiz do projeto:

```powershell
npm.cmd install
```

### 2. Vosk e modelo de português

Execute uma vez:

```powershell
& .\tools\local-stt\setup.ps1
```

O script:

- cria `tools/local-stt/.venv` usando `python -m venv`, se ainda não existir;
- instala `vosk==0.3.45` a partir de `tools/local-stt/requirements.txt`;
- baixa [`vosk-model-small-pt-0.3.zip`](https://alphacephei.com/vosk/models/vosk-model-small-pt-0.3.zip) e extrai o conteúdo para `tools/local-stt/model`;
- remove o `.zip` depois da extração;
- não baixa novamente se o modelo já estiver presente (`model\final.mdl` ou `model\am\final.mdl`).

O ambiente virtual, o modelo e os arquivos `.zip` ficam em `tools/local-stt/` e são ignorados pelo Git.

### 3. Ollama e o modelo Qwen 2.5 0.5B

Instale o Ollama para Windows pelo [site oficial](https://ollama.com/download/windows) e deixe o aplicativo em execução. O Peter usa o endereço padrão `http://127.0.0.1:11434`.

Baixe o modelo uma vez:

```powershell
ollama pull qwen2.5:0.5b
```

Confira se o nome exato aparece na lista:

```powershell
ollama list
```

O modelo esperado é o **Qwen 2.5 0.5B**, com a tag `qwen2.5:0.5b`. A verificação do Peter compara o nome exato retornado por `/api/tags`; uma tag diferente não conta como o modelo correto.

O aplicativo do Ollama normalmente já inicia o serviço. Se precisar iniciar manualmente e o serviço ainda não estiver ativo:

```powershell
ollama serve
```

Não execute `ollama serve` se o aplicativo do Ollama já estiver usando a porta `11434`.

### 4. Variáveis de ambiente (opcional)

O arquivo `.env.example` documenta as variáveis do frontend:

| Variável | Padrão | Uso |
| --- | --- | --- |
| `VITE_OLLAMA_MODEL` | `qwen2.5:0.5b` | Tag exata do modelo instalado no Ollama |
| `VITE_OLLAMA_URL` | Em desenvolvimento: `/ollama/api/chat`; no build: `http://127.0.0.1:11434/api/chat` | URL completa do endpoint `/api/chat` do Ollama |

Para sobrescrever sem risco de versionar o arquivo, crie `.env.local` (coberto por `*.local` no `.gitignore`):

```powershell
Copy-Item .env.example .env.local
```

Depois edite o `.env.local`. Em desenvolvimento, o valor padrão passa pelo proxy do Vite. Em um build de produção, use uma URL completa, porque o caminho `/ollama` só existe no servidor de desenvolvimento do Vite. Variáveis `VITE_*` são lidas na inicialização do Vite; reinicie o servidor após alterá-las e refaça o build se elas forem usadas em produção.

Se o Ollama estiver em outro host ou porta, defina `VITE_OLLAMA_URL` com a URL completa do `/api/chat`; o proxy padrão `/ollama` do Vite continua apontando para `127.0.0.1:11434`.

## Configuração do Vosk

O serviço Python fica em `tools/local-stt/server.py` e usa o Vosk para transcrever português localmente.

| Item | Valor |
| --- | --- |
| Pacote Python | `vosk==0.3.45` (`tools/local-stt/requirements.txt`) |
| Modelo padrão | `vosk-model-small-pt-0.3` |
| Diretório padrão do modelo | `tools/local-stt/model` |
| Endereço do serviço | `127.0.0.1:8765` (fixo no código) |
| Endpoints | `GET /health` e `POST /transcribe` |
| Formato aceito | WAV mono, PCM 16 bits, 16 kHz |
| Limite de áudio | 20 MB por requisição; 60 s de gravação no navegador |

As variáveis abaixo afetam o serviço:

- `PETER_VOSK_MODEL_PATH`: diretório alternativo do modelo, lido por `server.py`. O `setup.ps1` sempre baixa para o caminho padrão; se usar um caminho alternativo, forneça o modelo nele.
- A porta e o host do serviço não são configuráveis por variáveis de ambiente nesta versão.

O `server.py` exige que o modelo tenha `final.mdl` na raiz ou em `am/final.mdl`. Se o modelo não for encontrado, o processo encerra com a mensagem:

```text
Modelo Vosk não encontrado em ... Execute tools/local-stt/setup.ps1 primeiro.
```

## Iniciar o Peter

### Opção 1: um único comando

```powershell
npm.cmd run dev
```

Esse comando executa `node tools/local-stt/dev.mjs`, que:

1. verifica se `tools/local-stt/.venv/Scripts/python.exe` e o modelo existem;
2. consulta `http://127.0.0.1:8765/health`;
3. inicia `tools/local-stt/server.py` se o serviço ainda não estiver ativo;
4. inicia o Vite em seguida.

Se o Vosk não estiver instalado, o comando avisa, inicia somente o Vite e o microfone exibirá erro até o serviço ser configurado e iniciado.

Abra o endereço informado pelo Vite. O padrão é `http://localhost:5173`; se a porta estiver ocupada, o Vite escolhe outra e mostra a URL no terminal.

### Opção 2: serviços separados

Terminal 1, para o serviço Python:

```powershell
& .\tools\local-stt\start.ps1
```

Terminal 2, apenas para o frontend:

```powershell
npm.cmd run dev:vite
```

O `start.ps1` falha com `Execute tools/local-stt/setup.ps1 primeiro.` se o ambiente virtual não existir. Quando o modelo termina de carregar, o serviço mostra:

```text
Transcrição local pronta em http://127.0.0.1:8765
```

### Como usar

1. Abra `http://localhost:5173` (ou a URL mostrada pelo Vite).
2. Clique no microfone, permita o acesso quando o navegador pedir e fale.
3. Clique novamente para enviar. A gravação para automaticamente em 60 s.
4. O Peter mostra a transcrição e envia o texto ao Brain. A resposta aparece no chat e é falada pelo navegador.
5. Também é possível digitar no campo de mensagem e enviar pelo botão ao lado.
6. A câmera é opcional e não é necessária para a conversa por texto ou voz.

## Portas e endereços

| Serviço | Endereço padrão | Observações |
| --- | --- | --- |
| Vite (desenvolvimento) | `http://localhost:5173` | Porta padrão; se ocupada, o Vite escolhe outra e informa no terminal |
| Ollama | `http://127.0.0.1:11434` | `/api/chat` e `/api/tags`; em desenvolvimento, o proxy `/ollama` do Vite aponta para cá |
| Vosk (serviço Python) | `http://127.0.0.1:8765` | `/health` e `/transcribe`; em desenvolvimento, o proxy `/stt` do Vite aponta para cá; host e porta fixos |
| Preview do build (opcional) | `http://localhost:4173` | `npm.cmd run preview`; o build não usa os proxies de desenvolvimento e chama os serviços diretamente |

Em desenvolvimento, o navegador chama `/ollama/api/chat` e `/stt/transcribe`; o Vite remove esses prefixos e encaminha para os serviços locais. No build de produção, o código chama `http://127.0.0.1:11434/api/chat` e `http://127.0.0.1:8765/transcribe` diretamente.

Use `localhost` ou `127.0.0.1` no navegador. O serviço Vosk só devolve CORS para origens `http://localhost:*` e `http://127.0.0.1:*`, e o microfone exige contexto seguro.

## Funcionamento offline

Depois de concluir `npm.cmd install`, `setup.ps1` e `ollama pull qwen2.5:0.5b`, o fluxo de conversa não depende de internet:

- a transcrição é feita pelo Vosk em `127.0.0.1:8765`;
- a inferência é feita pelo Ollama em `127.0.0.1:11434`;
- se o Ollama falhar, o fallback por regras roda no próprio frontend;
- a resposta falada usa a síntese do navegador/sistema operacional;
- o avatar VRM é servido localmente a partir de `avatar.vrm`;
- a conversa fica somente em memória, sem envio de áudio ou texto para APIs externas de STT ou LLM.

A internet ainda é necessária para:

- a primeira instalação das dependências npm e Python;
- a instalação do Ollama;
- o download do modelo Vosk;
- o download do modelo `qwen2.5:0.5b` no Ollama;
- o reconhecimento de Libras por câmera, que carrega o WASM e os modelos do MediaPipe de CDNs configurados em `src/core/config.ts`. Esse fluxo é separado da conversa por texto/voz e não funciona offline sem alterar essas URLs para cópias locais.

A voz do navegador pode depender das vozes instaladas no sistema. Se não houver uma voz `pt-BR` disponível offline, o texto da resposta continua aparecendo, mas a fala pode falhar. Dependendo da voz selecionada, o próprio navegador pode usar um serviço online de síntese; o app não controla essa escolha.

## Solução de problemas

| Sintoma | Causa provável | O que fazer |
| --- | --- | --- |
| `[Peter] Transcrição local não instalada. Execute tools/local-stt/setup.ps1 uma vez.` | `.venv` ou modelo ausente | Execute `& .\tools\local-stt\setup.ps1` e depois `npm.cmd run dev` |
| `O serviço de transcrição local está parado. Execute tools/local-stt/start.ps1.` | Serviço Python não está em execução em `8765` | Inicie com `& .\tools\local-stt\start.ps1` ou use `npm.cmd run dev` |
| `O serviço local de transcrição não está pronto.` | Serviço reiniciando ou modelo ainda carregando | Aguarde o carregamento e tente novamente; confira o terminal do serviço |
| `Modelo Vosk não encontrado em ...` | Modelo não baixado ou caminho inválido | Rode `setup.ps1`; confira `tools/local-stt/model` ou `PETER_VOSK_MODEL_PATH` |
| `Permita o acesso ao microfone nas configurações do navegador.` | Permissão negada | Libere o microfone para o site e recarregue a página |
| `Não reconheci fala nesse áudio. Tente falar mais perto do microfone.` | Áudio baixo, ruído ou silêncio | Fale mais perto, reduza ruído e tente novamente; o modelo pequeno tem limitações |
| `o áudio deve ser WAV mono PCM16 a 16 kHz` | Conversão de áudio falhou no navegador | Use um navegador compatível e tente novamente |
| `LLM indisponível · qwen2.5:0.5b` ou `LLM_STATUS = UNAVAILABLE` | Ollama parado, porta `11434` fechada ou modelo ausente | Inicie o Ollama, rode `ollama list` e, se necessário, `ollama pull qwen2.5:0.5b` |
| O status do LLM demora a mudar | A verificação é refeita a cada 30 s | Aguarde a próxima verificação ou recarregue a página |
| Resposta vem como “regras locais”/“resposta offline” | Ollama falhou, expirou em 45 s ou devolveu JSON inválido | Confira o status do LLM e o terminal; a primeira inferência pode ser lenta |
| O microfone funciona, mas o Ollama não responde | Serviço em execução em outro endereço ou com bloqueio de CORS | Use `127.0.0.1:11434`; em desenvolvimento, mantenha o proxy padrão `/ollama/api/chat` |
| A porta `8765` já está em uso | Outra instância do serviço Vosk está rodando | Use a instância existente ou encerre o processo que ocupa a porta; a porta é fixa |
| A porta `5173` já está em uso | Outro servidor Vite está rodando | Use a URL alternativa mostrada no terminal ou encerre o outro processo |
| `python` não é reconhecido | Python ausente do `PATH` ou instalado apenas pelo launcher `py` | Instale Python 3.10+ 64 bits e marque a opção de adicionar ao `PATH`; confirme com `python --version` |
| O PowerShell bloqueia `setup.ps1` | Política de execução de scripts | Permita scripts apenas para a sessão atual com `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` e execute o script novamente |
| `Este navegador não oferece síntese de voz.` | Navegador sem `speechSynthesis` | Use um navegador compatível; alternativamente, leia a resposta no chat |
| A câmera/MediaPipe falha sem internet | WASM e modelos do MediaPipe vêm de CDN | Para o fluxo de conversa, mantenha a câmera desligada; para Libras offline, hospede esses arquivos localmente |
| Erro de CORS ao abrir por IP da rede | Origem diferente de `localhost`/`127.0.0.1` | Abra por `http://localhost:5173` ou `http://127.0.0.1:5173` |

Com o serviço Vosk em execução, é possível conferir a saúde do serviço:

```powershell
Invoke-RestMethod http://127.0.0.1:8765/health | ConvertTo-Json -Compress
```

Resposta esperada:

```json
{"status":"ready","engine":"vosk","language":"pt-BR"}
```

## Testes e build

```powershell
npm.cmd test
npm.cmd run build
```

- `npm.cmd test` executa `vitest run` e considera os arquivos `src/**/*.test.ts`.
- `npm.cmd run build` executa `tsc -b && vite build` e gera o frontend em `dist/`.
- O build cobre apenas o frontend. O serviço Python/Vosk e o Ollama continuam sendo processos locais separados.
- O aviso de chunks maiores que 500 kB é informativo e não interrompe o build.

O servidor Python/Vosk não possui testes automatizados neste repositório. Para validá-lo manualmente, inicie-o, consulte `/health` e faça uma gravação pelo microfone.

Para inspecionar o build localmente:

```powershell
npm.cmd run preview
```

O preview usa `http://localhost:4173` por padrão. Ele serve o build de produção, que chama o Ollama e o Vosk diretamente, sem os proxies `/ollama` e `/stt` do servidor de desenvolvimento.

## Fluxo

```text
Microfone → captura no navegador → WAV mono/16 kHz → Vosk local → texto no Brain
Texto → Ollama local (qwen2.5:0.5b) → resposta na interface + síntese de voz do navegador
                                      ↘ fallback por regras se o Ollama falhar
```

O Brain mantém no máximo as 40 mensagens mais recentes no contexto da sessão. Não há persistência em disco.

## Estrutura relevante

| Caminho | Função |
| --- | --- |
| `tools/local-stt/setup.ps1` | Cria o venv, instala o Vosk e baixa o modelo de português |
| `tools/local-stt/start.ps1` | Inicia o servidor Python do Vosk |
| `tools/local-stt/server.py` | Servidor HTTP local com `/health` e `/transcribe` |
| `tools/local-stt/dev.mjs` | Inicia o serviço Vosk (se necessário) e o Vite |
| `tools/local-stt/requirements.txt` | Dependência Python fixada (`vosk==0.3.45`) |
| `vite.config.ts` | Proxies de desenvolvimento `/ollama` e `/stt` |
| `src/core/config.ts` | Endpoint e modelo padrão do Ollama; URLs do MediaPipe |
| `.env.example` | Variáveis opcionais do Ollama |
