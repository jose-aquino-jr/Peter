# Peter — protótipo de validação 1:1 de sinais

O objetivo desta etapa é medir se uma sequência de landmarks da webcam se aproxima de uma referência de sinal VLibras. Não há treinamento de rede neural, tradução de frases, voz, avatar ou chatbot.

## Representação de referência: limite encontrado

Este checkout não contém animações, vídeos ou arquivos de esqueleto do VLibras. Portanto, não existe aqui um conjunto de sinais que permita uma execução completa ou uma avaliação de reconhecimento.

As animações do WikiLibras são produzidas no Blender a partir de keyframes de ossos. Esses dados não são landmarks MediaPipe: converter coordenadas dos ossos diretamente em 21 pontos de mão exigiria um mapeamento rig-específico e poderia inventar uma equivalência. Este protótipo usa o caminho comparável: renderizar cada animação oficial em um vídeo simples e processar o vídeo com o mesmo MediaPipe usado na webcam. Assim, ambos os lados passam pela mesma detecção. A detecção no avatar ainda pode falhar por oclusão, tamanho ou estilo de renderização; os frames com mãos ausentes são mantidos explicitamente.

## Preparar referências

1. Obtenha animações de sinais VLibras autorizadas e renderize cada sinal como vídeo, com avatar inteiro visível, fundo simples, câmera fixa e sem cortes. Use a mesma orientação para todos.
2. Processe cada vídeo para gerar um `.npz`:

```powershell
python scripts\build_references.py caminho\obrigado.mp4 --label OBRIGADO --translation "Obrigado"
python scripts\build_references.py caminho\bom_dia.mp4 --label BOM_DIA --translation "Bom dia"
```

Os arquivos vão para `data/references/`. A opção `camera.mirror` do `config.yaml` é aplicada também aos vídeos de referência, para manter a convenção de esquerda/direita consistente. Use inicialmente poucos sinais com movimentos distinguíveis.

## Executar pela webcam

```powershell
python scripts\recognize_webcam.py
```

Digite o sinal que pretende executar para registrar a avaliação objetiva (ou deixe vazio se não souber). Na janela, pressione **Espaço** para começar e novamente para encerrar e comparar; pressione **q** para sair. O melhor resultado aparece como:

```text
Sinal: OBRIGADO | Similaridade: ...% | Obrigado
```

Cada tentativa é anexada em `data/results.jsonl`, com sinal esperado (quando informado), predição, similaridade, distância DTW, duração e ranking. `correct` registra se a predição bateu com o sinal informado; vazio/sem rótulo fica `null`. Assim é possível resumir acurácia por sinal sem tratar uma pontuação alta como acerto garantido.

## Como a comparação funciona

- As mãos ocupam slots estáveis **Left** e **Right**. Mãos não detectadas viram slots zerados com indicadores de presença; `Unknown` não é adivinhado.
- Cada mão é centrada no pulso e escalada pela distância pulso–MCP do dedo médio. A posição do pulso na imagem é preservada como pista de localização. A ausência é comparada com uma penalidade explícita.
- As sequências são comparadas por DTW com uma banda temporal. O ranking escolhe a menor distância média.
- A porcentagem exibida é uma transformação linear provisória da distância (`1 - distância / 1.5`). **Não é probabilidade nem confiança calibrada**; o valor só se torna interpretável após coletar resultados rotulados e calibrar/validar o limiar. Não use o exemplo “87%” como resultado real antes dessa validação.

Landmarks Hands descrevem mãos, não corpo, face ou expressões. A normalização também remove tamanho/posição da mão, preservando apenas a posição do pulso no quadro; isso pode não capturar o local do sinal em relação ao tronco. A avaliação inicial deve registrar falhas de detecção e acertos por sinal e pessoa. Este experimento não pretende constituir tradutor de Libras.

## Etapa anterior

`python scripts\visualize_landmarks.py` continua disponível para inspecionar a câmera e os landmarks.
