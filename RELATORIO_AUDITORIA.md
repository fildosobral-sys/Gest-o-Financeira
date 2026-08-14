# Auditoria do Meu Controle Financeiro V3

## Resumo executivo

A V3 demonstrava uma boa visão de produto, mas concentrava interface, dados e regras em um único arquivo. Isso tornava qualquer evolução arriscada. A V4 foi reconstruída como PWA modular, com armazenamento robusto, migração sem perda, testes das regras críticas e uma experiência mobile mais clara.

## Achados críticos da V3

1. **Perda de dados na migração:** qualquer banco com versão inferior a 3 era substituído pelos dados de exemplo.
2. **Persistência limitada:** todo o conteúdo ficava em uma única chave de `localStorage`, sem transação ou estratégia segura de evolução.
3. **Injeção de HTML:** nomes e descrições digitados pelo usuário eram inseridos diretamente via `innerHTML`.
4. **Backup sem validação:** qualquer JSON podia substituir o banco atual.
5. **Atualização PWA agressiva:** o service worker chamava `skipWaiting()` durante a instalação, sem avisar o usuário.
6. **Privacidade:** o pacote distribuído continha dados financeiros reais como estado inicial.
7. **Datas:** o INSS estava configurado como “dia 2”, e não como segundo dia útil.
8. **Manutenibilidade:** CSS, HTML, regras financeiras, armazenamento e interface ocupavam um único arquivo de mais de 50 KB.
9. **Sem testes:** parcelamentos, status, ponto de equilíbrio e previsto x realizado não tinham proteção contra regressões.
10. **Codificação:** vários textos estavam com caracteres portugueses corrompidos.

## O que mudou na V4

- IndexedDB nativo com migração automática das chaves `mcf_v3`, `mcf_v2` e `mcf`.
- Estado inicial vazio; nenhum dado pessoal é distribuído.
- Regras financeiras puras e testáveis em `js/domain.js`.
- Segundo dia útil real, com suporte opcional a feriados na função de domínio.
- Backup validado, limite de tamanho e confirmação antes de substituir dados.
- Escape de conteúdo digitado pelo usuário antes da renderização.
- Dark mode, modo privacidade, acessibilidade e layout responsivo.
- Comparação previsto x realizado, score 0–100, projeção de 12 meses, metas, simulador e agenda automática.
- Atualização do PWA somente após consentimento do usuário.
- Service worker com estratégia network-first e fallback offline.

## Observações de produto

O app foi mantido local-first para máxima privacidade. Sincronização entre dispositivos exigiria autenticação, criptografia, política de privacidade e uma decisão explícita de infraestrutura; por isso não foi adicionada silenciosamente nesta versão.
