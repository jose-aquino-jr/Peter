# Relatório de qualidade e cobertura — Peter EDA

> Gerado automaticamente por `peter_eda.quality`. Nenhuma amostra foi descartada ou imputada.

## Inventário analisado

- Amostras ativas no manifesto: **66**
- Templates de treino: **18**
- Amostras de validação: **24**
- Amostras de teste: **24**

## Integridade estrutural

- Sequências com comprimento diferente de 16 frames: **0**
- Sequências com valores NaN: **0**
- Sequências com valores infinitos: **0**
- Sequências com slots de articulação ausentes: **0**
- Sequências com timestamps não monotônicos: **0**

## Duplicatas

- Grupos de conteúdo duplicado: **0**
- Nenhuma sequência com conteúdo idêntico foi encontrada.

## Cobertura das mãos

| Recorte | n | handCoverage médio | frames sem mão (média) |
|---|---:|---:|---:|
| test / CAIR | 6 | 0.942 | 0.67 |
| test / JA | 6 | 1.000 | 0.00 |
| test / LUZ | 6 | 0.996 | 0.00 |
| test / SIM | 6 | 1.000 | 0.00 |
| train / SIM | 18 | 0.739 | 4.39 |
| validation / CAIR | 6 | 0.226 | 12.00 |
| validation / JA | 6 | 0.372 | 10.50 |
| validation / LUZ | 6 | 0.590 | 7.17 |
| validation / SIM | 6 | 0.677 | 5.67 |

## Frames com baixa visibilidade

- Frames sem nenhuma mão visível: **295**

## Limitações

- A cobertura oficial é calculada antes do downsampling para 16 frames; o valor recalculado nos frames armazenados é apenas uma aproximação.
- A ausência de vídeos no ZIP impede recalcular landmarks brutos, reavaliar a extração ou medir oclusão real fora dos 16 frames.
- Valores ausentes não foram imputados; qualquer comparação entre grupos carrega a incerteza de amostras muito pequenas (6 positivos por split).
