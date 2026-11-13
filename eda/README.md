# Peter EDA — ambiente isolado de análise do reconhecedor Libras

Este diretório contém uma análise exploratória **reproduzível e isolada** do
reconhecedor de Libras do projeto Peter. Todo o código novo vive em `eda/`; os
arquivos originais do projeto são apenas lidos, nunca alterados.

O objetivo central é responder a duas perguntas:

1. O DTW do runtime TypeScript pode ser reproduzido fielmente em Python/NumPy?
2. Por que a configuração ajustada acerta **6/6** positivos na validação e
   **0/6** no teste, mantendo especificidade perfeita?

A resposta curta: a implementação é numericamente idêntica ao TypeScript
(delta máximo `2,22e-16`), e o colapso do teste é uma **mudança de distribuição
entre informantes**, concentrada no componente de **forma da mão** — não é
calibração de limiar, oclusão das mãos, pesos, normalização, máscara de
visibilidade nem janela DTW.

---

## 1. Estrutura

```text
eda/
├── README.md
├── requirements.txt
├── .gitignore
├── notebooks/
│   ├── 01_inventario_e_qualidade.ipynb
│   ├── 02_sinal_esqueleto_maos_trajetorias.ipynb
│   ├── 03_reproducao_dtw.ipynb
│   ├── 04_diagnostico_treino_validacao_teste.ipynb
│   └── 05_ablacoes_incerteza_limitacoes.ipynb
├── src/peter_eda/
│   ├── __init__.py
│   ├── config.py          # caminhos, constantes e configurações do runtime
│   ├── loaders.py         # leitura read-only de templates, fixtures e fontes TS
│   ├── manifest.py        # manifesto canônico, hashes e inventário
│   ├── quality.py         # integridade, duplicatas, cobertura e relatório
│   ├── metrics.py         # TP/FP/TN/FN, AUC, bootstrap, intervalos de Wilson
│   ├── dtw.py             # features, DTW, paridade, tuning e ablações
│   └── visualization.py   # figuras, esqueletos, trajetórias e GIF
└── outputs/
    ├── figures/           # 28 figuras (inclui 1 GIF)
    ├── tables/            # 33 tabelas CSV
    └── reports/           # 3 relatórios Markdown
```

Os notebooks são executáveis individualmente e compartilham um preâmbulo que
insere `eda/src` no `sys.path` e carrega o dataset.

---

## 2. Instalação

Requisitos: Python 3.11+ (testado com **3.14.7**) e PowerShell no Windows.

```powershell
cd eda
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

O `eda/` deve ficar ao lado da raiz do projeto Peter, que precisa conter
`src/vision/templates/` e `src/vision/pipeline/fixtures/`. Se a pasta for
analisada em outro local, defina:

```powershell
$env:PETER_PROJECT_ROOT = "C:\caminho\para\o\projeto"
```

## 3. Execução

A ordem recomendada é `01 → 02 → 03 → 04 → 05`. Todos os notebooks podem ser
reexecutados do zero; as saídas são sobrescritas em `eda/outputs/`.

```powershell
cd eda
Get-ChildItem notebooks\*.ipynb | ForEach-Object {
    .\.venv\Scripts\python.exe -m jupyter nbconvert `
        --to notebook --execute --inplace `
        --ExecutePreprocessor.timeout=2400 $_.FullName
}
```

Para abrir interativamente:

```powershell
.\.venv\Scripts\python.exe -m jupyter lab
```

> No PowerShell, avisos do Jupyter podem produzir código de saída 1 mesmo com
> execução bem-sucedida. Verifique se o notebook tem `execution_count`
> preenchido e nenhuma célula com `output_type == "error"`.

---

## 4. Dados analisados

O runtime atual consome:

| Grupo | n | Composição |
|---|---:|---|
| Treino | 18 | templates `SIM` dos informantes 1, 2 e 3 |
| Validação | 24 | 6 `SIM` (informante 4) + 18 negativos (`CAIR`, `LUZ`, `JA`) |
| Teste | 24 | 6 `SIM` (informante 5) + 18 negativos (`CAIR`, `LUZ`, `JA`) |

Cada sequência tem **16 frames canônicos** e **55 articulações**. O manifesto
principal usa somente os 18 templates ativos `libras-eqt-dual-*.template.json`.
Os 24 templates legados `libras-eqt-v4-*` aparecem em
`outputs/tables/template_inventory.csv`, mas **não entram no treino**: o runtime
atual não os carrega, e misturá-los inflaria artificialmente o conjunto.

### Esquema do manifesto

`outputs/tables/manifest.csv` tem uma linha por sequência (66) e 26 colunas.
As colunas obrigatórias estão todas presentes:

`sample_id`, `class_name`, `informant_id`, `dataset_split`, `file_path`,
`frame_count`, `fps`, `landmark_count`, `hand_visibility`, `pose_visibility`,
`duration_seconds`, `sha256`.

Colunas adicionais documentam a origem de cada valor:
`class_label_pt`, `informant`, `dataset_role`, `source_entry`,
`visible_landmark_ratio`, `hand_visibility_source`, `pose_visibility_source`,
`duration_source`, `sequence_span_seconds`, `timestamp_step_ms`,
`source_file_sha256`, `representation`, `is_template`, `notes`.

As verificações de integridade frame a frame (`NaN`, slots ausentes,
monotonicidade, frames sem mão) ficam em `outputs/tables/frame_quality.csv` e
`outputs/tables/quality_by_group.csv`.

- `sha256` é o hash **canônico do conteúdo** (ordem fixa de articulações), usado
  para detectar duplicatas reais.
- `source_file_sha256` é o hash do arquivo JSON original.
- A cobertura oficial vem dos metadados; quando recalculada nos 16 frames
  armazenados, é rotulada como aproximada.

---

## 5. O que cada notebook faz

### 01 — Inventário e qualidade

- Lê templates, fixture de avaliação e relatório de resultados em modo somente
  leitura.
- Constrói o manifesto canônico, o inventário de 42 templates e o resumo por
  split/classe/informante.
- Mede integridade: 16 frames, 55 articulações, `NaN`, infinitos, slots
  ausentes, timestamps, frames adjacentes idênticos e duplicatas de conteúdo.
- Mede cobertura das mãos e frames sem mão visível (295 de 1.056).
- Gera `quality_report.md` e as figuras `01_*`.

### 02 — Sinal, esqueleto, mãos e trajetórias

- Explica as features reais do runtime: 168 dimensões de forma da mão
  (2 mãos × 21 pontos × `x,y,z,1`) e 8 de trajetória dos punhos.
- Desenha o esqueleto canônico de uma sequência `SIM` por split.
- Compara a geometria normalizada das mãos e as trajetórias por informante.
- Gera um GIF de uma sequência de teste e mede escala da palma, amplitude do
  punho e energia de movimento.
- Quantifica: escala média da palma `SIM` ≈ 0,42 / 0,33 / 0,42 (inf. 1/2/3),
  0,46 (validação) e 0,32 (teste); energia de movimento `SIM` ≈ 0,43 na
  validação e ≈ 0,19 no teste.

### 03 — Reprodução fiel do DTW

- Reproduz custo local euclidiano, banda de Sakoe-Chiba
  `w = max(1, |n-m|, ceil(0,28·max(n,m)))`, normalização por `n+m`,
  similaridade `1/(1+d)`, combinação ponderada e decisão por gloss.
- Compara 72 pares (3 configurações × 24 amostras de teste) contra o relatório
  TypeScript. Delta máximo do score combinado: **2,220e-16**.
- Reproduz a grade de validação com **1.242 combinações** e recupera
  `threshold=0,76`, `minMotion=0,04`, pesos `0,25/0,75`.
- Compara as três configurações históricas e gera `dtw_reproduction_report.md`.
- Mostra por que `minScoreMargin` é inerte: todos os 18 templates têm gloss
  `SIM`, logo não existe segundo candidato.

### 04 — Diagnóstico treino/validação/teste

Testa três hipóteses concorrentes:

| Hipótese | Evidência | Veredito |
|---|---|---|
| Calibração | melhor limiar de teste (0,49) ainda gera 12 FP; AUC 0,370 | descartada |
| Cobertura | teste tem cobertura ≈ 0,98 e `SIM` = 1,0, mas pior ranking | descartada |
| Mudança de distribuição | teste `SIM` × treino ≈ 5,4 vs validação `SIM` × treino ≈ 2,4 | sustentada |

- AUC: validação 1,0; teste 0,370 (IC bootstrap 95% ≈ 0,17–0,59).
- Componentes no teste: forma da mão **0,167**, trajetória 0,435, combinado
  0,370. Na validação, todos são 1,0.
- Todos os seis `SIM` de teste escolhem templates do informante 2; na
  validação, todos escolhem o informante 1.
- A distância de forma do informante 5 ao treino é ≈ 5,4, contra ≈ 2,4 do
  informante 4; dentro do teste, ≈ 1,2 — ou seja, ele é internamente
  consistente, mas está fora da distribuição de treino.
- Gera `test_collapse_diagnosis.md` e as figuras `04_*`.

### 05 — Ablações, incerteza e limitações

- **Pesos:** AUC de teste entre 0,17 e 0,44 em todas as combinações; nenhuma
  recupera o ranking.
- **Normalização:** `ombro` e `nenhuma` são numericamente idênticas (AUC 0,380),
  confirmando que o esqueleto canônico já é normalizado pelos ombros; `palma`
  tem AUC 0,370.
- **Máscara de visibilidade:** AUC de teste sobe para 0,574, mas o melhor ponto
  tem 5 TP e 10 FP; não é solução.
- **Janela DTW:** 0,10 / 0,28 / 0,50 produzem 0/6 no teste; AUC 0,398 / 0,370 /
  0,370.
- **Incerteza:** recall de teste 0/6 tem IC 95% ≈ 0,00–0,39; recall de
  validação 6/6 tem IC ≈ 0,61–1,00; especificidade 18/18 tem IC ≈ 0,82–1,00.
- Consolida achados em `findings_summary.csv` e propõe recomendações.

---

## 6. Resultados principais

### Comparação das configurações

| Configuração | Split | TP | FN | FP | TN | Recall | Especificidade | BA | AUC |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| default | validação | 6 | 0 | 0 | 18 | 1,000 | 1,000 | 1,000 | 1,000 |
| default | teste | 0 | 6 | 0 | 18 | 0,000 | 1,000 | 0,500 | 0,324 |
| histórica | validação | 6 | 0 | 13 | 5 | 1,000 | 0,278 | 0,639 | 1,000 |
| histórica | teste | 0 | 6 | 4 | 14 | 0,000 | 0,778 | 0,389 | 0,324 |
| ajustada | validação | 6 | 0 | 0 | 18 | 1,000 | 1,000 | 1,000 | 1,000 |
| ajustada | teste | 0 | 6 | 0 | 18 | 0,000 | 1,000 | 0,500 | 0,370 |

A configuração histórica reproduz exatamente o resultado do relatório
TypeScript (BA de teste `0,3889`).

### Achado central

Os positivos de teste recebem scores entre **0,500 e 0,555**, enquanto os
negativos vão de **0,428 a 0,687**. Não existe limiar que separe os dois grupos:
o melhor ponto possível (0,49) obtém 6 TP, mas também 12 FP. Na validação, os
positivos ficam em 0,768–0,857 e os negativos em 0,611–0,749, com um intervalo
vazio entre 0,749 e 0,768.

Isso caracteriza **inversão de ranking**, não descalibração. O componente de
forma da mão é o mais afetado (AUC 0,167 no teste); a trajetória permanece
próxima do acaso (0,435).

---

## 7. Reprodutibilidade e integridade

- **Nenhum arquivo original foi modificado, renomeado, movido ou apagado.**
  Toda escrita ocorre em `eda/outputs/`.
- A leitura dos templates e fixtures é read-only; os caminhos são centralizados
  em `src/peter_eda/config.py`.
- O manifesto registra `sha256` canônico e `source_file_sha256` de cada
  sequência, permitindo auditar que os dados analisados são os mesmos.
- A paridade DTW é verificada contra os scores oficiais já gravados no relatório
  TypeScript; não foi necessário executar o runtime Node neste ambiente.
- A validação é usada para escolher parâmetros; o teste é usado **apenas** para
  diagnóstico e nunca para tuning.
- Os notebooks são determinísticos (sem amostragem aleatória, exceto bootstrap
  com semente fixa) e podem ser reexecutados na ordem indicada.

---

## 8. Índice de saídas

### Relatórios (`outputs/reports/`)

| Arquivo | Conteúdo |
|---|---|
| `quality_report.md` | inventário, integridade, duplicatas e cobertura |
| `dtw_reproduction_report.md` | paridade, tuning e comparação das configurações |
| `test_collapse_diagnosis.md` | diagnóstico do colapso no teste |

### Tabelas principais (`outputs/tables/`)

| Arquivo | Conteúdo |
|---|---|
| `manifest.csv` | 66 sequências × 26 colunas |
| `template_inventory.csv` | 42 templates (18 ativos + 24 legados) |
| `quality_by_group.csv` | integridade por split/classe |
| `frame_quality.csv` | qualidade frame a frame |
| `signal_summary.csv` | escala da palma, amplitude e energia |
| `dtw_parity.csv` | 72 comparações Python × TypeScript |
| `validation_grid.csv` | 1.242 combinações de tuning |
| `configuration_comparison.csv` | TP/FP/TN/FN, BA e AUC por configuração |
| `predictions_all_configurations.csv` | predições por amostra |
| `roc_auc.csv` | AUC por split e configuração |
| `component_auc.csv` | AUC de forma, trajetória e combinado |
| `threshold_sweep.csv` | varredura de limiar |
| `scores_tuned.csv` | scores da configuração ajustada |
| `focused_informant_distances.csv` | distâncias entre informantes |
| `pairwise_distances_hand_shape.csv` | 2.145 pares de distância de forma |
| `coverage_score_correlation.csv` | correlação cobertura × score |
| `weight_ablation.csv` | ablação de pesos |
| `normalization_ablation.csv` | ablação de normalização |
| `masked_dtw_ablation.csv` | DTW com máscara de visibilidade |
| `window_ablation.csv` | sensibilidade à janela DTW |
| `uncertainty.csv` | IC de Wilson e bootstrap da AUC |
| `findings_summary.csv` | achados consolidados |

### Figuras (`outputs/figures/`)

28 arquivos, prefixados por notebook: `01_*` (composição), `02_*` (esqueleto,
mãos, trajetórias, visibilidade e GIF), `03_*` (matrizes de confusão),
`04_*` (ROC, scores, componentes, cobertura, distâncias) e `05_*` (ablações e
incerteza).

---

## 9. Limitações

1. **Amostra pequena:** 6 positivos por split. O recall de teste 0/6 tem IC 95%
   de até ~39%; os resultados são hipóteses, não estimativas precisas.
2. **Um único informante por split:** validação = informante 4, teste =
   informante 5. O protocolo mede generalização cross-informant, mas com apenas
   um informante em cada papel.
3. **Rótulos de informante locais:** a identidade é inferida do rótulo de cada
   item e pode não corresponder a pessoas físicas distintas em todos os sinais.
4. **Sem vídeos originais:** não é possível separar erro de extração de
   variação real de execução, nem recalcular landmarks.
5. **Paridade contra relatório gravado:** não executamos o runtime TypeScript;
   a comparação usa os scores oficiais já produzidos.
6. **Diagnóstico observacional:** a conclusão de “informante 5 OOD” é
   compatível com os dados, mas não prova causalidade.
7. **Ablações descritivas:** não constituem busca exaustiva de arquiteturas nem
   exploração de novas features.
8. **Cobertura aproximada:** a cobertura recalculada nos 16 frames é aproximada;
   a oficial foi medida antes do downsampling.

## 10. Recomendações

1. Não ajustar o limiar no teste: o melhor ponto ainda tem 12 FP.
2. Avaliar com **leave-one-informant-out** usando todos os informantes
   disponíveis, em vez de um único informante na validação.
3. Coletar mais informantes de treino; com três, o modelo de template não cobre
   a variabilidade de forma da mão.
4. Investir em invariância à forma (normalização por pose da mão, aumento de
   dados com rotações/espelhamentos, features geométricas invariantes).
5. Separar explicitamente “SIM” de “não-SIM”: hoje todos os templates têm o
   mesmo gloss e a margem é inerte. Um classificador binário com negativos de
   treino permitiria calibrar de verdade.
6. Reportar incerteza em todo número: 6/6 e 0/6 não são estimativas estáveis.
