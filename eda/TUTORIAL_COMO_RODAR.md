# Tutorial completo — como rodar o EDA do Peter

Este tutorial cobre **como abrir e executar** o notebook `eda/eda_peter.ipynb` no Jupyter Notebook, o que esperar de cada etapa, onde as figuras são salvas e como resolver os problemas mais comuns.

> **Resumo:** você **não precisa de Node.js/npm** para rodar o notebook. Ele só precisa de Python com `numpy`, `pandas`, `matplotlib`, `seaborn` e `scikit-learn`, além do Jupyter. O notebook lê os templates/fixtures do próprio projeto, reproduz o matcher DTW em Python e grava 6 figuras em `eda/figs/`.

---

## 0. O que você vai rodar

| Item | Valor |
|---|---|
| Notebook | `eda/eda_peter.ipynb` |
| Entrada | templates em `src/vision/templates/` e fixtures em `src/vision/pipeline/fixtures/` |
| Saída | 6 PNGs em `eda/figs/` + saídas embutidas no notebook |
| Tempo típico | 30–60 segundos |
| Internet | não é necessária |
| Node/npm | não é necessário para o notebook |

O notebook **já vem executado** (com saídas e figuras salvas). Você pode apenas abri-lo para ler, ou usar **Run All** para reproduzir tudo do zero.

---

## 1. Pré-requisitos

### 1.1 Python e pacotes

O ambiente validado nesta máquina é:

| Pacote | Versão validada |
|---|---|
| Python | 3.14.6 |
| numpy | 2.4.6 |
| pandas | 3.0.3 |
| matplotlib | 3.11.0 |
| seaborn | 0.13.2 |
| scikit-learn | 1.9.0 |
| notebook | 7.5.7 |
| nbconvert | 7.17.1 |

Teste rápido no **Anaconda Prompt**:

```bat
"C:\Users\henri\anaconda3\python.exe" -c "import numpy,pandas,matplotlib,seaborn,sklearn,notebook; print('ambiente OK')"
```

Se aparecer `ambiente OK`, está tudo pronto.

### 1.2 Se faltar algum pacote

```bat
"C:\Users\henri\anaconda3\python.exe" -m pip install --upgrade numpy pandas matplotlib seaborn scikit-learn notebook
```

> Se você usa outro ambiente Conda, troque o caminho do Python pelo do seu ambiente.

---

## 2. Abrir o Jupyter Notebook

Há dois caminhos. Use o que preferir.

### Opção A — Anaconda Navigator (interface gráfica)

1. Abra o **Anaconda Navigator**.
2. Clique em **Launch** no card **Jupyter Notebook**.
3. O navegador abre em algo como `http://localhost:8888/tree`.
4. Navegue até a pasta do projeto:
   `C:\Users\henri\Documents\Projeto Padrão\Peter-main`
5. Entre em `eda/` e abra `eda_peter.ipynb`.

### Opção B — Linha de comando (recomendada)

1. Abra o **Anaconda Prompt** (não use o `cmd` comum se o Python não estiver no PATH).
2. Entre na pasta do projeto:

```bat
cd /d "C:\Users\henri\Documents\Projeto Padrão\Peter-main"
```

3. Inicie o Jupyter:

```bat
"C:\Users\henri\anaconda3\python.exe" -m jupyter notebook
```

4. O navegador abre automaticamente. Se não abrir, copie a URL com token que aparece no terminal (ex.: `http://localhost:8888/?token=...`).
5. No navegador, abra `eda/eda_peter.ipynb`.

> **Importante:** o comando `jupyter` pode não estar no PATH desta máquina. Por isso usamos `python -m jupyter`. Se `jupyter notebook` funcionar no seu terminal, pode usar direto.

### Opção C — JupyterLab (opcional)

```bat
"C:\Users\henri\anaconda3\python.exe" -m jupyter lab
```

O notebook funciona igual.

---

## 3. Selecionar o kernel correto

No notebook, confira o kernel no canto superior direito (ou em **Kernel → Change kernel**). Ele deve ser o **Python (ipykernel)** do ambiente Anaconda que tem os pacotes.

Para confirmar, rode em uma célula nova:

```python
import sys
print(sys.executable)
```

O esperado é algo como:

```text
C:\Users\henri\anaconda3\python.exe
```

Se aparecer outro Python, troque o kernel antes de continuar.

---

## 4. Executar o notebook

1. Menu **Cell → Run All** (ou **Kernel → Restart & Run All** para começar limpo).
2. Acompanhe o indicador `[*]` ao lado de cada célula; ele vira um número quando termina.
3. Espere 30–60 segundos.
4. Ao final, **nenhuma célula deve mostrar erro em vermelho**.
5. As figuras aparecem inline e são gravadas em `eda/figs/`.

### O notebook valida os dados sozinho

Algumas células têm `assert` intencionais. Se elas falharem, aparecerá um `AssertionError` dizendo o que não bateu. Isso **não é bug do Jupyter**: significa que a pasta aberta não é a entrega esperada (dados diferentes ou cópia incompleta).

---

## 5. O que você deve ver (checklist)

| Célula | Saída esperada |
|---|---|
| 2.1 | `Templates dual carregados pelo matcher: 18`; tabela v4 com I1–I4, 21 juntas (18) e 42 juntas (6) |
| 2.2 | 66 amostras; todas com 16 frames |
| 2.3 | `motionEnergy` mínimo ≈ 0,1159; 0/66 abaixo de 0,018 |
| 3.2 | diferença máxima vs. `results.json` ≈ `1e-16` |
| 3.3 | matrizes de confusão: default TP=0/FN=6; historical TP=0/FP=4; selected TP=0/FN=6 |
| 3.4 | `threshold=0.76`, `minMotion=0.04`, pesos `0.25/0.75` |
| 4.2 | AUC default ≈ **0,324** no teste |
| 5 | 5 informantes × 3 frames (Figura 5) |

Ao final, a pasta `eda/figs/` deve conter:

```text
fig_01_inventario.png
fig_02_confusao.png
fig_03_escores.png
fig_04_roc.png
fig_05_skeleton.png
fig_06_mao_unica.png
```

---

## 6. Onde as coisas são gravadas

- **Figuras:** `eda/figs/*.png` (sobrescritas a cada execução).
- **Notebook:** só é alterado se você salvar (**Ctrl+S**). O arquivo entregue já contém as saídas.
- **Nada fora de `eda/` é modificado** durante a execução.

---

## 7. Reprogramar sem abrir o navegador (opcional)

Útil para gerar um relatório executado ou automatizar:

```bat
cd /d "C:\Users\henri\Documents\Projeto Padrão\Peter-main"

"C:\Users\henri\anaconda3\python.exe" -m nbconvert ^
  --to notebook --execute --ExecutePreprocessor.timeout=900 ^
  --output-dir "%TEMP%" --output eda_executado.ipynb ^
  "eda\eda_peter.ipynb"
```

O arquivo executado será salvo em `%TEMP%\eda_executado.ipynb`.

Para gerar um **HTML** legível (bom para enviar a alguém):

```bat
"C:\Users\henri\anaconda3\python.exe" -m nbconvert ^
  --to html --execute --ExecutePreprocessor.timeout=900 ^
  "eda\eda_peter.ipynb"
```

> O aviso `Proactor event loop ... zmq` que aparece no nbconvert no Windows é **inofensivo**.

---

## 8. Problemas comuns e solução

| Problema | Causa provável | Solução |
|---|---|---|
| `'jupyter' não é reconhecido...` | `jupyter` fora do PATH | Use `"C:\Users\henri\anaconda3\python.exe" -m jupyter notebook` |
| `ModuleNotFoundError: No module named 'pandas'` | kernel errado ou pacote ausente | Troque o kernel (seção 3) ou instale os pacotes (seção 1.2) |
| `FileNotFoundError: Repo do Peter não encontrado` | notebook aberto fora da pasta do projeto | Abra a partir de `Peter-main` (a pasta precisa ter `package.json` e `src\vision\pipeline`). Alternativa: defina `PETER_REPO_ROOT` antes de iniciar |
| `AssertionError` em uma célula de inventário | dados diferentes/cópia incompleta | Use a pasta entregue `Projeto Padrão\Peter-main`; não misture com outra versão |
| Kernel morre ou execução trava | memória/processo antigo | **Kernel → Restart**, feche outros notebooks e rode de novo |
| Porta 8888 ocupada | outro Jupyter aberto | `... -m jupyter notebook --port 8889` |
| Navegador não abre | bloqueio do navegador | Copie a URL com token exibida no terminal |
| Figuras não atualizam | execução parcial | **Kernel → Restart & Run All** |
| Caminho com acento (`Padrão`) | ferramentas antigas | Funciona neste ambiente; se necessário, mova o projeto para `C:\Peter-main` |
| Demora na primeira célula | cache de fontes do matplotlib | Aguarde a primeira execução; depois fica rápido |
| Avisos `RuntimeWarning` | seaborn/matplotlib | Inofensivos; não interrompem o notebook |

### Definir `PETER_REPO_ROOT` (se necessário)

No **Anaconda Prompt**, antes de iniciar o Jupyter:

```bat
set PETER_REPO_ROOT=C:\Users\henri\Documents\Projeto Padrão\Peter-main
"C:\Users\henri\anaconda3\python.exe" -m jupyter notebook
```

Ou, dentro do notebook, antes da célula de setup:

```python
import os
os.environ["PETER_REPO_ROOT"] = r"C:\Users\henri\Documents\Projeto Padrão\Peter-main"
```

---

## 9. Rodar o aplicativo (opcional, não é o EDA)

O notebook **não** precisa disso. Se quiser rodar o app React/Vite:

1. Instale **Node.js 18+**.
2. No **Prompt de Comando** (ou PowerShell), dentro do projeto:

```bat
cd /d "C:\Users\henri\Documents\Projeto Padrão\Peter-main"
npm install
npm run dev
```

3. Abra a URL local indicada pelo Vite (normalmente `http://localhost:5173`).
4. Testes do matcher: `npm test`.

---

## 10. Ambiente limpo (opcional)

Se quiser isolar as dependências em um ambiente Conda novo:

```bat
conda create -n peter-eda python=3.12 numpy pandas matplotlib seaborn scikit-learn notebook -y
conda activate peter-eda
python -m jupyter notebook
```

> O notebook foi validado nas versões da seção 1.1. Versões próximas devem funcionar; se houver diferença de comportamento em `pandas` ou `display`, prefira o ambiente validado.

---

## 11. Referência rápida

```bat
:: 1) entrar no projeto
cd /d "C:\Users\henri\Documents\Projeto Padrão\Peter-main"

:: 2) testar ambiente
"C:\Users\henri\anaconda3\python.exe" -c "import numpy,pandas,matplotlib,seaborn,sklearn,notebook; print('OK')"

:: 3) abrir o Jupyter
"C:\Users\henri\anaconda3\python.exe" -m jupyter notebook

:: 4) no navegador: eda/eda_peter.ipynb -> Cell > Run All

:: 5) conferir figuras
dir eda\figs
```

Pronto. Se o notebook rodar até o fim sem erro e as 6 figuras estiverem em `eda/figs/`, a reprodução está completa.
