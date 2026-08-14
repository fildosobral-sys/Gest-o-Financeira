import {
  addMonths, agendaEntries, balancePoint, cashNow, entryStatus, localDate, money,
  monthKey, nextIncomeDate, occurrenceForCommit, releasedWithin, reservedUntilNextIncome,
  scoreHealth, startOfMonth, totalsForMonth, transactionForMonth, uid
} from './domain.js';
import { clearState, exportBackup, importBackup, loadState, saveState } from './storage.js';

let state = await loadState();
let selectedMonth = startOfMonth(new Date());
let agendaFilter = 'pending';
let dialogContext = null;
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
const shortMoney = value => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(Number(value) || 0);
const monthName = date => date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
const shortMonth = date => date.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
const formatDate = value => localDate(value).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');
const categoryIcon = category => ({ Alimentação: '◒', Casa: '⌂', Transporte: '◇', Saúde: '+', Educação: '▤', Dívida: '!', Salário: '↗', Extra: '✦' })[category] || '•';
const empty = message => `<div class="empty-state">${escapeHtml(message)}</div>`;

async function persist(message) {
  state = await saveState(state);
  renderAll();
  if (message) toast(message);
}

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove('show'), 2400);
}

function applyPreferences() {
  const theme = state.preferences.theme;
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.body.classList.toggle('privacy', Boolean(state.preferences.privacy));
  $('#themeToggle').textContent = dark ? '☀' : '☾';
  $('#privacyToggle').textContent = state.preferences.privacy ? '○' : '◉';
}

function renderHome() {
  const totals = totalsForMonth(state, selectedMonth);
  const currentCash = cashNow(state);
  const reserve = reservedUntilNextIncome(state);
  const safe = currentCash - reserve;
  const score = scoreHealth(state, selectedMonth);
  const nextIncome = nextIncomeDate(state);
  $('#monthLabel').textContent = monthName(selectedMonth);
  $('#agendaMonthLabel').textContent = monthName(selectedMonth);
  $('#safeToSpend').textContent = money(safe);
  $('#cashNow').textContent = money(currentCash);
  $('#monthResult').textContent = money(totals.result);
  $('#monthResult').className = `money ${totals.result >= 0 ? 'positive' : 'negative'}`;
  $('#pendingIncome').textContent = money(totals.pendingIncome);
  $('#pendingExpense').textContent = money(totals.pendingExpense);
  $('#safeHint').textContent = nextIncome ? `Já reservando ${money(reserve)} até ${nextIncome.toLocaleDateString('pt-BR')}.` : 'Cadastre uma renda para calcular sua margem até o próximo recebimento.';
  $('#healthScore').textContent = score;
  $('#healthRing').style.setProperty('--score', `${score}%`);
  renderInsight({ safe, score, totals });

  const entries = agendaEntries(state, selectedMonth)
    .filter(item => entryStatus(state, item, selectedMonth) !== 'paid')
    .slice(0, 4);
  $('#nextItems').innerHTML = entries.length ? entries.map(timelineItem).join('') : empty('Nada pendente neste mês.');

  $('#incomeComparison').textContent = `${shortMoney(totals.realizedIncome)} / ${shortMoney(totals.plannedIncome)}`;
  $('#expenseComparison').textContent = `${shortMoney(totals.realizedExpense)} / ${shortMoney(totals.plannedExpense)}`;
  $('#incomeBar').style.width = `${Math.min(100, totals.realizedIncome / Math.max(totals.plannedIncome, 1) * 100)}%`;
  $('#expenseBar').style.width = `${Math.min(100, totals.realizedExpense / Math.max(totals.plannedExpense, 1) * 100)}%`;
}

function renderInsight({ safe, score, totals }) {
  let title = 'Sua base está pronta';
  let text = 'Continue registrando cada movimento para melhorar suas projeções.';
  if (!state.incomes.length) { title = 'Cadastre sua renda'; text = 'Assim o app calcula o que realmente cabe no mês e quando você recebe.'; }
  else if (safe < 0) { title = `Faltam ${money(Math.abs(safe))} até a próxima renda`; text = 'Priorize essenciais e adie gastos que não sejam urgentes.'; }
  else if (totals.plannedExpense > totals.plannedIncome) { title = 'O mês está acima da renda'; text = `A diferença prevista é de ${money(totals.plannedExpense - totals.plannedIncome)}.`; }
  else if (score >= 80) { title = 'Boa margem de segurança'; text = 'Seu fluxo está saudável. Direcione parte da sobra para uma meta.'; }
  $('#insightTitle').textContent = title;
  $('#insightText').textContent = text;
}

function timelineItem(item) {
  const status = entryStatus(state, item, selectedMonth);
  const paid = status === 'paid';
  return `<article class="timeline-item">
    <div class="date-tile"><strong>${localDate(item.date).getDate()}</strong><span>${shortMonth(localDate(item.date))}</span></div>
    <i class="status-dot ${status}"></i>
    <div class="item-copy"><strong>${escapeHtml(item.name)}${item.installmentNo ? ` · ${item.installmentNo}/${item.total}` : ''}</strong><span>${paid ? 'Realizado' : status === 'late' ? 'Atrasado' : status === 'soon' ? 'Vence em breve' : 'Previsto'}</span></div>
    <div class="item-amount ${item.isIncome ? 'positive' : 'negative'}">${item.isIncome ? '+' : '−'} ${money(item.value)}</div>
    ${paid ? '' : `<button class="icon-button" data-record="${escapeHtml(item.kind)}|${escapeHtml(item.id)}" title="Marcar como realizado" aria-label="Marcar ${escapeHtml(item.name)} como realizado">✓</button>`}
  </article>`;
}

function renderTransactions() {
  const query = $('#searchTransactions').value.trim().toLocaleLowerCase('pt-BR');
  const filter = $('#transactionFilter').value;
  const transactions = transactionForMonth(state, selectedMonth)
    .filter(item => filter === 'all' || item.type === filter)
    .filter(item => !query || `${item.desc} ${item.cat}`.toLocaleLowerCase('pt-BR').includes(query))
    .sort((a, b) => b.date.localeCompare(a.date));
  if (!transactions.length) { $('#transactionList').innerHTML = empty('Nenhuma movimentação encontrada.'); return; }
  let lastDate = '';
  $('#transactionList').innerHTML = transactions.map(item => {
    const heading = item.date !== lastDate ? `<div class="group-label">${localDate(item.date).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}</div>` : '';
    lastDate = item.date;
    return `${heading}<article class="transaction-item"><div class="transaction-icon">${categoryIcon(item.cat)}</div><div class="item-copy"><strong>${escapeHtml(item.desc || item.cat || 'Movimentação')}</strong><span>${escapeHtml(item.cat || 'Outros')}</span></div><div class="item-amount ${item.type === 'entrada' ? 'positive' : 'negative'}">${item.type === 'entrada' ? '+' : '−'} ${money(item.value)}</div><button data-edit-transaction="${escapeHtml(item.id)}" aria-label="Editar">•••</button></article>`;
  }).join('');
}

function renderAgenda() {
  const entries = agendaEntries(state, selectedMonth);
  const counts = { pending: 0, late: 0, paid: 0 };
  entries.forEach(item => { const status = entryStatus(state, item, selectedMonth); counts[status === 'soon' ? 'pending' : status] += 1; });
  $('#agendaStats').innerHTML = `<div class="status-pill"><span>PENDENTES</span><strong>${counts.pending}</strong></div><div class="status-pill"><span>ATRASADAS</span><strong class="negative">${counts.late}</strong></div><div class="status-pill"><span>REALIZADAS</span><strong class="positive">${counts.paid}</strong></div>`;
  const filtered = entries.filter(item => {
    const status = entryStatus(state, item, selectedMonth);
    return agendaFilter === 'all' || status === agendaFilter || (agendaFilter === 'pending' && status === 'soon');
  });
  $('#agendaList').innerHTML = filtered.length ? filtered.map(timelineItem).join('') : empty('Nenhum item com esse status.');
}

function renderPlan() {
  let accumulated = 0;
  const months = Array.from({ length: 12 }, (_, index) => {
    const date = addMonths(selectedMonth, index);
    const totals = totalsForMonth(state, date);
    const result = totals.plannedIncome - totals.plannedExpense;
    accumulated += result;
    return { date, totals, result, accumulated };
  });
  $('#twelveMonthResult').textContent = money(accumulated);
  $('#twelveMonthResult').className = `money ${accumulated >= 0 ? 'positive' : 'negative'}`;
  const point = balancePoint(state, selectedMonth);
  $('#balancePoint').textContent = point ? `Ponto de equilíbrio: ${monthName(point)}` : 'Ponto de equilíbrio não previsto em 12 meses';
  $('#forecastList').innerHTML = months.map(({ date, totals, result }) => `<article class="forecast-card"><span>${monthName(date)}</span><strong class="${result >= 0 ? 'positive' : 'negative'}">${money(result)}</strong><small>${money(totals.plannedIncome)} entra</small><small>${money(totals.plannedExpense)} sai</small></article>`).join('');
  $('#goalList').innerHTML = state.goals.length ? state.goals.map(goal => {
    const progress = Math.min(100, Number(goal.current || 0) / Math.max(Number(goal.target || 0), 1) * 100);
    return `<button class="goal-card" data-edit-goal="${escapeHtml(goal.id)}"><span>${escapeHtml(goal.name)}</span><small>${money(goal.current)} de ${money(goal.target)}</small><div class="progress"><i style="width:${progress}%"></i></div></button>`;
  }).join('') : empty('Crie uma meta para transformar sobra em progresso.');
}

function renderSettings() {
  $('#incomeManager').innerHTML = state.incomes.length ? state.incomes.map(item => `<button class="manager-item" data-edit-income="${escapeHtml(item.id)}"><span><strong>${escapeHtml(item.name)}</strong><small>${item.schedule === 'second-business-day' ? '2º dia útil' : `Dia ${item.day}`} · ${item.active === false ? 'pausada' : 'ativa'}</small></span><b class="positive">${money(item.value)}</b></button>`).join('') : empty('Nenhuma renda cadastrada.');
  $('#commitmentManager').innerHTML = state.commitments.length ? state.commitments.map(item => `<button class="manager-item" data-edit-commitment="${escapeHtml(item.id)}"><span><strong>${escapeHtml(item.name)}</strong><small>${item.recurring ? 'Recorrente' : `${item.installments} parcelas`} · dia ${item.day}</small></span><b class="negative">${money(item.value)}</b></button>`).join('') : empty('Nenhuma conta cadastrada.');
  $('#debtManager').innerHTML = state.debts.length ? state.debts.map(item => `<button class="manager-item" data-edit-debt="${escapeHtml(item.id)}"><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.status || 'Acompanhar')} · ${escapeHtml(item.strategy || 'Sem estratégia')}</small></span><b>${money(item.balance)}</b></button>`).join('') : empty('Nenhuma dívida cadastrada.');
}

function renderAll() {
  applyPreferences();
  renderHome();
  renderTransactions();
  renderAgenda();
  renderPlan();
  renderSettings();
}

function go(view) {
  $$('.view').forEach(item => item.classList.toggle('active', item.dataset.view === view));
  $$('.bottom-nav button').forEach(item => item.classList.toggle('active', item.dataset.nav === view));
  const titles = { home: 'Visão geral', moves: 'Movimentações', agenda: 'Agenda', plan: 'Planejamento', settings: 'Configurações' };
  $('#pageTitle').textContent = titles[view];
  $('.fab').hidden = view === 'settings';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

const field = (label, name, type = 'text', value = '', options = {}) => {
  const attrs = Object.entries(options).filter(([key]) => key !== 'class').map(([key, val]) => `${key}="${escapeHtml(val)}"`).join(' ');
  return `<label class="${options.class || ''}">${label}<input name="${name}" type="${type}" value="${escapeHtml(value)}" ${attrs}></label>`;
};
const select = (label, name, value, choices, full = false) => `<label class="${full ? 'full' : ''}">${label}<select name="${name}">${choices.map(([key, text]) => `<option value="${escapeHtml(key)}" ${key === value ? 'selected' : ''}>${escapeHtml(text)}</option>`).join('')}</select></label>`;

function openEditor(type, existing = null, prefill = {}) {
  dialogContext = { type, id: existing?.id || null, prefill };
  let title = 'Adicionar'; let eyebrow = 'NOVO'; let fields = '';
  if (type === 'transaction') {
    title = existing ? 'Editar movimentação' : 'Nova movimentação'; eyebrow = 'MOVIMENTO';
    fields = select('Tipo', 'type', existing?.type || prefill.type || 'saida', [['entrada', 'Entrada'], ['saida', 'Saída']]) +
      field('Data', 'date', 'date', existing?.date || prefill.date || new Date().toISOString().slice(0, 10)) +
      field('Descrição', 'desc', 'text', existing?.desc || prefill.desc || '', { class: 'full', required: true, maxlength: 100 }) +
      select('Categoria', 'cat', existing?.cat || prefill.cat || 'Outros', ['Alimentação', 'Casa', 'Transporte', 'Saúde', 'Educação', 'Dívida', 'Salário', 'Extra', 'Outros'].map(item => [item, item])) +
      field('Valor', 'value', 'number', existing?.value || prefill.value || '', { min: 0.01, step: 0.01, required: true, inputmode: 'decimal' });
  } else if (type === 'commitment') {
    title = existing ? 'Editar conta' : 'Nova conta ou parcela'; eyebrow = 'COMPROMISSO';
    fields = field('Nome', 'name', 'text', existing?.name || '', { class: 'full', required: true, maxlength: 100 }) +
      select('Tipo', 'kind', existing?.kind || 'essencial', [['essencial', 'Conta recorrente'], ['parcela', 'Compra parcelada'], ['divida', 'Acordo/dívida'], ['outro', 'Outro']]) +
      field('Valor mensal', 'value', 'number', existing?.value || '', { min: 0.01, step: 0.01, required: true }) +
      field('Primeiro vencimento', 'start', 'date', existing?.start || new Date().toISOString().slice(0, 10), { required: true }) +
      field('Dia de vencimento', 'day', 'number', existing?.day || new Date().getDate(), { min: 1, max: 31, required: true }) +
      select('Recorrência', 'recurring', String(existing?.recurring ?? true), [['true', 'Todo mês, sem término'], ['false', 'Número definido de parcelas']]) +
      field('Quantidade de parcelas', 'installments', 'number', existing?.installments || 1, { min: 1, max: 999 }) +
      select('Prioridade', 'priority', existing?.priority || 'media', [['essencial', 'Essencial'], ['alta', 'Alta'], ['media', 'Média'], ['baixa', 'Baixa']]);
  } else if (type === 'income') {
    title = existing ? 'Editar renda' : 'Nova fonte de renda'; eyebrow = 'RENDA';
    fields = field('Nome', 'name', 'text', existing?.name || '', { class: 'full', required: true, maxlength: 100 }) +
      field('Valor previsto', 'value', 'number', existing?.value || '', { min: 0.01, step: 0.01, required: true }) +
      select('Quando recebe', 'schedule', existing?.schedule || 'fixed', [['fixed', 'Dia fixo'], ['second-business-day', '2º dia útil']]) +
      field('Dia do mês', 'day', 'number', existing?.day || 5, { min: 1, max: 31 });
  } else if (type === 'goal') {
    title = existing ? 'Atualizar meta' : 'Nova meta'; eyebrow = 'OBJETIVO';
    fields = field('Nome', 'name', 'text', existing?.name || '', { class: 'full', required: true, maxlength: 100 }) + field('Valor alvo', 'target', 'number', existing?.target || '', { min: 0.01, step: 0.01, required: true }) + field('Já acumulado', 'current', 'number', existing?.current || 0, { min: 0, step: 0.01 });
  } else if (type === 'balance') {
    title = 'Ajustar saldo'; eyebrow = 'SALDO ATUAL';
    fields = field('Total disponível em contas e carteira', 'balance', 'number', cashNow(state), { class: 'full', step: 0.01, required: true });
  } else if (type === 'debt') {
    title = existing ? 'Editar dívida' : 'Nova dívida ou acordo'; eyebrow = 'DÍVIDA';
    fields = field('Nome', 'name', 'text', existing?.name || '', { class: 'full', required: true, maxlength: 100 }) +
      field('Saldo devedor', 'balance', 'number', existing?.balance || '', { min: 0, step: 0.01, required: true }) +
      select('Status', 'status', existing?.status || 'Atrasado', [['Atrasado', 'Atrasado'], ['Em dia', 'Em dia'], ['Renegociar', 'Renegociar'], ['Aguardar', 'Aguardar']]) +
      field('Parcela do acordo', 'monthly', 'number', existing?.monthly || 0, { min: 0, step: 0.01 }) +
      field('Dia da parcela', 'day', 'number', existing?.day || 1, { min: 1, max: 31 }) +
      field('Estratégia', 'strategy', 'text', existing?.strategy || '', { class: 'full', maxlength: 160 });
  }
  $('#dialogTitle').textContent = title; $('#dialogEyebrow').textContent = eyebrow; $('#dialogFields').innerHTML = fields;
  $('#editorDialog').showModal();
}

async function saveEditor(formData) {
  const data = Object.fromEntries(formData);
  const { type, id, prefill } = dialogContext;
  if (type === 'transaction') {
    const previous = state.transactions.find(item => item.id === id);
    const item = { ...previous, id: id || uid(), type: data.type, date: data.date, desc: data.desc.trim(), cat: data.cat, value: Number(data.value), ...prefill };
    state.transactions = id ? state.transactions.map(entry => entry.id === id ? item : entry) : [...state.transactions, item];
  } else if (type === 'commitment') {
    const previous = state.commitments.find(item => item.id === id);
    const item = { ...previous, id: id || uid(), name: data.name.trim(), kind: data.kind, value: Number(data.value), start: data.start, day: Number(data.day), recurring: data.recurring === 'true', installments: data.recurring === 'true' ? null : Number(data.installments), priority: data.priority, active: true };
    state.commitments = id ? state.commitments.map(entry => entry.id === id ? item : entry) : [...state.commitments, item];
  } else if (type === 'income') {
    const previous = state.incomes.find(item => item.id === id);
    const item = { ...previous, id: id || uid(), name: data.name.trim(), value: Number(data.value), schedule: data.schedule, day: Number(data.day), active: true };
    state.incomes = id ? state.incomes.map(entry => entry.id === id ? item : entry) : [...state.incomes, item];
  } else if (type === 'goal') {
    const previous = state.goals.find(item => item.id === id);
    const item = { ...previous, id: id || uid(), name: data.name.trim(), target: Number(data.target), current: Number(data.current) };
    state.goals = id ? state.goals.map(entry => entry.id === id ? item : entry) : [...state.goals, item];
  } else if (type === 'balance') {
    const transactionSum = state.transactions.reduce((sum, item) => sum + (item.type === 'entrada' ? 1 : -1) * Number(item.value || 0), 0);
    state.initialBalance = Number(data.balance) - transactionSum;
  } else if (type === 'debt') {
    const previous = state.debts.find(item => item.id === id);
    const item = { ...previous, id: id || uid(), name: data.name.trim(), balance: Number(data.balance), status: data.status, monthly: Number(data.monthly), day: Number(data.day), strategy: data.strategy.trim() };
    state.debts = id ? state.debts.map(entry => entry.id === id ? item : entry) : [...state.debts, item];
  }
  $('#editorDialog').close();
  await persist('Dados salvos com segurança.');
}

async function recordEntry(kind, id) {
  const entry = agendaEntries(state, selectedMonth).find(item => item.kind === kind && item.id === id);
  if (!entry) return;
  state.transactions.push({ id: uid(), type: entry.isIncome ? 'entrada' : 'saida', date: entry.date, desc: entry.name, cat: entry.isIncome ? 'Salário' : entry.kind === 'debt' ? 'Dívida' : 'Outros', value: entry.value, linkType: entry.kind, linkId: entry.id, monthKey: monthKey(selectedMonth) });
  await persist(entry.isIncome ? 'Recebimento registrado.' : 'Pagamento registrado.');
}

function simulate() {
  const value = Number($('#simValue').value) || 0;
  const monthly = Number($('#simMonthly').value) || value;
  const months = Number($('#simMonths').value) || 1;
  const totals = totalsForMonth(state, selectedMonth);
  const margin = totals.plannedIncome - totals.plannedExpense - monthly;
  const safe = cashNow(state) - reservedUntilNextIncome(state) - value;
  let verdict = 'Compatível com seu fluxo'; let detail = `Após a parcela, sobrariam ${money(margin)} por mês.`; let tone = 'positive';
  if (margin < 0 || safe < 0) { verdict = 'Não recomendado agora'; detail = `A compra criaria um déficit de ${money(Math.abs(Math.min(margin, safe)))}.`; tone = 'negative'; }
  else if (margin < totals.plannedIncome * .1) { verdict = 'Cabe, mas com pouca margem'; detail = `A folga mensal cairia para ${money(margin)} durante ${months} meses.`; tone = ''; }
  $('#simulationResult').hidden = false;
  $('#simulationResult').innerHTML = `<strong class="${tone}">${verdict}</strong><p>${detail} O custo informado foi ${money(value)}.</p>`;
}

document.addEventListener('click', async event => {
  const nav = event.target.closest('[data-nav]'); if (nav) go(nav.dataset.nav);
  const month = event.target.closest('[data-month]'); if (month) { selectedMonth = month.dataset.month === 'today' ? startOfMonth(new Date()) : addMonths(selectedMonth, Number(month.dataset.month)); renderAll(); }
  const opener = event.target.closest('[data-open]'); if (opener) openEditor(opener.dataset.open);
  const record = event.target.closest('[data-record]'); if (record) { const [kind, id] = record.dataset.record.split('|'); await recordEntry(kind, id); }
  const editTx = event.target.closest('[data-edit-transaction]'); if (editTx) openEditor('transaction', state.transactions.find(item => item.id === editTx.dataset.editTransaction));
  const editGoal = event.target.closest('[data-edit-goal]'); if (editGoal) openEditor('goal', state.goals.find(item => item.id === editGoal.dataset.editGoal));
  const editIncome = event.target.closest('[data-edit-income]'); if (editIncome) openEditor('income', state.incomes.find(item => item.id === editIncome.dataset.editIncome));
  const editCommitment = event.target.closest('[data-edit-commitment]'); if (editCommitment) openEditor('commitment', state.commitments.find(item => item.id === editCommitment.dataset.editCommitment));
  const editDebt = event.target.closest('[data-edit-debt]'); if (editDebt) openEditor('debt', state.debts.find(item => item.id === editDebt.dataset.editDebt));
  const agendaButton = event.target.closest('[data-agenda-filter]'); if (agendaButton) { agendaFilter = agendaButton.dataset.agendaFilter; $$('#agendaFilters button').forEach(item => item.classList.toggle('active', item === agendaButton)); renderAgenda(); }
});

$('#editorForm').addEventListener('submit', event => { event.preventDefault(); if (event.submitter?.value === 'cancel') { $('#editorDialog').close(); return; } if (event.currentTarget.reportValidity()) saveEditor(new FormData(event.currentTarget)); });
$('#searchTransactions').addEventListener('input', renderTransactions);
$('#transactionFilter').addEventListener('change', renderTransactions);
$('#simulateButton').addEventListener('click', simulate);
$('#themeToggle').addEventListener('click', async () => { state.preferences.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; await persist(); });
$('#privacyToggle').addEventListener('click', async () => { state.preferences.privacy = !state.preferences.privacy; await persist(); });
$('#exportButton').addEventListener('click', () => { const url = URL.createObjectURL(new Blob([exportBackup(state)], { type: 'application/json' })); const link = Object.assign(document.createElement('a'), { href: url, download: `meu-financeiro-${new Date().toISOString().slice(0, 10)}.json` }); link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast('Backup exportado.'); });
$('#importButton').addEventListener('click', () => $('#importFile').click());
$('#importFile').addEventListener('change', async event => { try { const file = event.target.files[0]; if (!file) return; const imported = importBackup(await file.text()); if (!confirm('Substituir os dados atuais por este backup validado?')) return; state = imported; await persist('Backup restaurado.'); } catch (error) { toast(error.message || 'Não foi possível importar o backup.'); } finally { event.target.value = ''; } });
$('#resetButton').addEventListener('click', async () => { if (!confirm('Apagar todos os dados financeiros deste dispositivo? Esta ação não pode ser desfeita.')) return; if (!confirm('Confirma que deseja recomeçar com o app vazio?')) return; state = await clearState(); renderAll(); toast('Dados apagados.'); });

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js').then(registration => {
    let pendingUpdateWorker = registration.waiting;
    const showUpdate = worker => {
      pendingUpdateWorker = worker || registration.waiting;
      if (!pendingUpdateWorker || sessionStorage.getItem('mcf-update-later') === '1') return;
      $('#updateBanner').hidden = false;
    };
    if (registration.waiting && navigator.serviceWorker.controller) showUpdate(registration.waiting);
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => { if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdate(worker); });
    });
    $('#updateLaterButton').addEventListener('click', () => {
      sessionStorage.setItem('mcf-update-later', '1');
      $('#updateBanner').hidden = true;
    });
    $('#updateButton').addEventListener('click', () => {
      const worker = registration.waiting || pendingUpdateWorker;
      if (!worker) return;
      $('#updateBanner').hidden = true;
      worker.postMessage({ type: 'SKIP_WAITING' });
      toast('Atualizando o app…');
    });
  }).catch(() => { $('#storageStatus').textContent = 'Modo local sem instalação PWA'; });
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload());
}

renderAll();
