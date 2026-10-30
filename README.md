# Peter

Assistente web em português com interface de chamada de vídeo, resposta por voz do navegador, transcrição local e LLM local opcional. O avatar VRM permanece integrado; seus ajustes não fazem parte do fluxo de conversa descrito aqui.

## Estado atual da conversa

### Funciona

- Texto digitado é encaminhado ao Brain e a resposta aparece na conversa.
- O Ollama responde com o modelo local `qwen2.5:0.5b`; a integração usa `/api/chat` e verifica se o modelo está instalado.
- Quando o Ollama ou o formato da resposta falha, o fallback local por regras responde a saudações e intenções conhecidas; para os demais textos, informa que é um fallback offline.
- O microfone grava no navegador e transcreve localmente com Vosk em português. A transcrição não usa o serviço de voz do navegador nem envia o áudio para a internet.
- A conversa e o histórico permanecem somente na sessão aberta. A interface segue no formato de chamada de vídeo.

### Não funciona / limitações

- A primeira instalação baixa o pacote Vosk e o modelo pequeno de português. Depois disso, `npm.cmd run dev` inicia junto o serviço local de transcrição.
- O modelo Vosk pequeno é leve e pode errar palavras com ruído, fala distante ou sotaques; a precisão precisa de validação com os microfones reais usados no projeto.
- O modelo Ollama 0.5B pode demorar alguns segundos na primeira resposta e pode gerar conteúdo incorreto.
- A resposta falada usa síntese nativa do navegador. A transcrição e a inferência da LLM são locais quando seus serviços estão instalados e ativos.
- GitHub pode exigir autenticação do usuário para o push.

### Falta fazer

- Avaliar precisão da transcrição em diferentes sotaques e ambientes; considerar um modelo local maior se necessário.
- Avaliar a qualidade das respostas do modelo pequeno em conversas reais.
- Implementar persistência entre sessões ou outros provedores, se necessário.
- Reconhecimento de Libras continua experimental e tem limitações documentadas na seção própria do projeto; não é validado por este fluxo de conversa.

## Executar

Requisitos: Node.js 20.19+ ou 22.12+, npm e Python 3.10+.

Instale e baixe o modelo offline de português uma vez:

```powershell
& .\tools\local-stt\setup.ps1
```

Inicie o Peter (o comando inicia também o serviço Vosk já instalado):

```powershell
npm.cmd install
npm.cmd run dev
```

Abra o endereço informado pelo Vite. Clique no microfone para iniciar a gravação, fale e clique novamente para enviar. O Peter mostra a transcrição e então responde usando Ollama; se Ollama falhar, o fallback por regras é usado. Permita o acesso ao microfone no navegador.

Se quiser executar o serviço Vosk separado do Vite, use `& .\tools\local-stt\start.ps1` e inicie o app com `npm.cmd run dev:vite`.

O modelo de linguagem padrão é `qwen2.5:0.5b`. Ollama precisa estar em execução em `127.0.0.1:11434`; confira a instalação com `ollama list`. Em desenvolvimento, o Vite encaminha chamadas para Ollama e para o serviço local de transcrição.

## Verificações

```powershell
npm.cmd test
npm.cmd run build
```

## Fluxo

```text
Microfone → captura local no navegador → WAV mono/16 kHz → Vosk local → texto no Brain
Texto → Ollama local (qwen2.5:0.5b) → resposta na interface e síntese de voz
                                      ↘ fallback por regras se o Ollama falhar
```

O serviço Vosk escuta somente em `127.0.0.1:8765`. O modelo baixado e o ambiente virtual ficam em `tools/local-stt/` e são ignorados pelo Git. Não versione áudio de conversas.
