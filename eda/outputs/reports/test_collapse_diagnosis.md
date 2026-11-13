# Diagnóstico do colapso no split de teste

> Gerado por `notebooks/04_diagnostico_treino_validacao_teste.ipynb`.
> O split de teste foi usado apenas para diagnóstico, nunca para tuning.

## Resultado

- Validação (configuração ajustada): 6/6 positivos, 0 falsos positivos, AUC 1,000.
- Teste (configuração ajustada): 0/6 positivos, 0 falsos positivos, AUC 0,370.
- Melhor limiar possível no teste: 0.49, com 6 TP e 12 FP (BA 0.667).

## Evidências

1. **Não é calibração.** A AUC de teste é menor que 0,5; baixar o limiar gera falsos positivos antes de recuperar positivos.
2. **Não é cobertura.** O teste tem a maior cobertura de mãos (~0,98; SIM = 1,0) e a menor taxa de sucesso.
3. **É mudança de distribuição.** A distância média de forma entre teste SIM e treino (~5,4) é mais que o dobro da distância entre validação SIM e treino (~2,4). O informante 5 é internamente consistente (~1,2), mas distante dos demais.
4. **O componente afetado é a forma da mão.** AUC da forma no teste = 0,167; trajetória = 0,435; combinado = 0,370.
5. **O portão de movimento não atua.** A menor energia observada (~0,12) é muito superior a minMotion = 0,04.

## Implicação

O protocolo treina com os informantes 1–3, ajusta no informante 4 e testa no informante 5. O informante 4 é geometricamente próximo do treino, então a validação é otimista. O teste mede generalização para um informante fora da distribuição — e o modelo de template único não generaliza.

## Limitações

- Seis positivos por split produzem intervalos de confiança largos.
- Os rótulos de informante são locais por item, não uma identidade física auditada.
- A distância DTW de forma não é uma métrica de postura clinicamente validada.
- Não há vídeos originais para verificar se a diferença é de execução, enquadramento ou extração.
