# Reprodução do DTW do Peter em Python

> Gerado por `notebooks/03_reproducao_dtw.ipynb`.

## Paridade

- Pares comparados contra o relatório TypeScript: **72**.
- Delta absoluto máximo do score combinado: **2.220e-16**.
- Configuração escolhida na validação: `threshold=0.76`, `minMotion=0.040`, pesos `0.25/0.75`.

## Resultados por configuração

| Configuração | Split | TP | FN | FP | TN | Recall | Especificidade | BA | AUC |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| default | validation | 6 | 0 | 0 | 18 | 1.000 | 1.000 | 1.000 | 1.000 |
| default | test | 0 | 6 | 0 | 18 | 0.000 | 1.000 | 0.500 | 0.324 |
| historical-experimental | validation | 6 | 0 | 13 | 5 | 1.000 | 0.278 | 0.639 | 1.000 |
| historical-experimental | test | 0 | 6 | 4 | 14 | 0.000 | 0.778 | 0.389 | 0.324 |
| validation-selected | validation | 6 | 0 | 0 | 18 | 1.000 | 1.000 | 1.000 | 1.000 |
| validation-selected | test | 0 | 6 | 0 | 18 | 0.000 | 1.000 | 0.500 | 0.370 |

## Leitura

- O Python reproduz o TypeScript no limite de ponto flutuante.
- A validação é perfeitamente separável; o teste não é.
- A AUC de teste fica abaixo de 0,5, indicando inversão de ranking, não calibração.
- A margem de score é inerte porque todos os templates compartilham o gloss SIM.

## Limitações

- A paridade cobre o split de teste do fixture dual; os templates legados v4 não foram avaliados.
- O relatório TypeScript contém apenas métricas de teste; a validação foi reproduzida pela grade, não por um relatório independente.
- Não foi possível executar o runtime TypeScript dentro deste ambiente; a comparação usa os scores já gravados no fixture.
