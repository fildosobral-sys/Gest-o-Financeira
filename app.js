import {
  addMonths, agendaEntries, balancePoint, cashNow, entryStatus, localDate, money,
  monthKey, nextIncomeDate, occurrenceForCommit, releasedWithin, reservedUntilNextIncome,
  scoreHealth, startOfMonth, totalsForMonth, transactionForMonth, uid, mergeStates, stateForMember
} from './domain.js';
import { clearState, exportBackup, importBackup, loadState, saveState } from './storage.js';

let state = await loadState();
let selectedMonth = startOfMonth(new Date());
let agendaFilter = 'pending';
let memberFilter = 'all';
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
const activeState = () => stateForMember(state, memberFilter);
const memberById = id => state.members.find(item => item.id === (id || 'primary')) || state.members[0];
const memberChoices = () => state.members.filter(item => item.active !== false).map(item => [item.id, item.name]);
const stamp = item => ({ ...item, updatedAt: new Date().toISOString() });
const extraTypeLabel = type => ({ bonus: '🏆 Meta/premiação', thirteenth: '🎁 13º salário', vacation: '🏖️ Férias', refund: '↩️ Reembolso', other: '✨ Outra renda' })[type] || '✨ Outra renda';

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
  const view = activeState();
  const totals = totalsForMonth(view, selectedMonth);
  const currentCash = cashNow(view);
  const reserve = reservedUntilNextIncome(view);
  const safe = currentCash - reserve;
  const score = scoreHealth(view, selectedMonth);
  const nextIncome = nextIncomeDate(view);
  $('#monthLabel').textContent = monthName(selectedMonth);
  $('#agendaMonthLabel').textContent = monthName(selectedMonth);
  $('#safeToSpend').textContent = money(safe);
  $('#cashNow').textContent = money(currentCash);
  $('#committedNow').textContent = money(reserve);
  $('#monthIncome').textContent = money(totals.realizedIncome);
  $('#monthExpense').textContent = money(totals.realizedExpense);
  $('#debtOpen').textContent = money(view.debts.reduce((sum, item) => sum + Number(item.balance || 0), 0));
  $('#reserveNow').textContent = money(reserve);
  $('#monthResult').textContent = money(totals.result);
  $('#monthResult').className = `money ${totals.result >= 0 ? 'positive' : 'negative'}`;
  $('#pendingIncome').textContent = money(totals.pendingIncome);
  $('#pendingExpense').textContent = money(totals.pendingExpense);
  $('#safeHint').textContent = nextIncome ? `Já reservando ${money(reserve)} até ${nextIncome.toLocaleDateString('pt-BR')}.` : 'Cadastre uma renda para calcular sua margem até o próximo recebimento.';
  $('#healthScore').textContent = score;
  $('#healthRing').style.setProperty('--score', `${score}%`);
  renderInsight({ safe, score, totals });
  renderHealthThermometer(score);
  renderLiveFlow(view, totals, currentCash, reserve, safe, nextIncome);

  renderFamilyOverview();
  renderExtraIncomeOverview(view);
  const entries = agendaEntries(view, selectedMonth)
    .filter(item => entryStatus(view, item, selectedMonth) !== 'paid')
    .slice(0, 4);
  $('#nextItems').innerHTML = entries.length ? entries.map(timelineItem).join('') : empty('Nada pendente neste mês.');

  $('#incomeComparison').textContent = `${shortMoney(totals.realizedIncome)} / ${shortMoney(totals.plannedIncome)}`;
  $('#expenseComparison').textContent = `${shortMoney(totals.realizedExpense)} / ${shortMoney(totals.plannedExpense)}`;
  $('#incomeBar').style.width = `${Math.min(100, totals.realizedIncome / Math.max(totals.plannedIncome, 1) * 100)}%`;
  $('#expenseBar').style.width = `${Math.min(100, totals.realizedExpense / Math.max(totals.plannedExpense, 1) * 100)}%`;
}

function renderExtraIncomeOverview(view) {
  const extras = view.extras.filter(item => String(item.date || '').startsWith(monthKey(selectedMonth)));
  $('#extraIncomeOverview').innerHTML = extras.length ? extras.map(item => {
    const received = view.transactions.some(tx => tx.linkType === 'extra' && tx.linkId === item.id && tx.monthKey === monthKey(selectedMonth));
    const confidence = { expected: '🟡 Possível', likely: '🟠 Provável', confirmed: '🟢 Confirmada' }[item.confidence] || '🟡 Possível';
    const period = item.type === 'vacation' && item.vacationStart ? `Férias: ${localDate(item.vacationStart).toLocaleDateString('pt-BR')} a ${localDate(item.vacationEnd || item.vacationStart).toLocaleDateString('pt-BR')}` : `Prevista para ${localDate(item.date).toLocaleDateString('pt-BR')}`;
    return `<button class="extra-income-card ${item.active === false ? 'inactive' : ''}" data-edit-extra="${escapeHtml(item.id)}"><header><span>${extraTypeLabel(item.type)}</span><small>${received ? '✅ Recebida' : confidence}</small></header><strong>${money(item.value)}</strong><small>${escapeHtml(item.name)}</small><small>${period}</small><div class="extra-warning">${received ? 'Já compõe o saldo bancário.' : item.active === false ? 'Fora da projeção.' : 'Prevista, mas ainda não disponível para gastar.'}</div></button>`;
  }).join('') : empty('Nenhuma renda extraordinária prevista para este mês.');
}

function renderHealthThermometer(score) {
  const level = score < 35 ? 'critical' : score < 60 ? 'attention' : score < 80 ? 'balance' : 'positive';
  $$('#healthThermometer [data-health]').forEach(item => item.classList.toggle('active', item.dataset.health === level));
}

function renderLiveFlow(view, totals, currentCash, reserve, safe, nextIncome) {
  const days = nextIncome ? Math.max(0, Math.ceil((localDate(nextIncome) - localDate(new Date())) / 86400000)) : null;
  $('#liveFlow').innerHTML = `
    <article class="flow-value"><span>🏦 Saldo bancário</span><strong>${money(currentCash)}</strong><small>O que existe nas contas</small></article>
    <article class="flow-value"><span>🔥 Disponível real</span><strong class="${safe >= 0 ? 'positive' : 'negative'}">${money(safe)}</strong><small>Sem usar dinheiro reservado</small></article>
    <article class="flow-value"><span>🔒 Comprometido</span><strong>${money(reserve)}</strong><small>${nextIncome ? `Próximo recebimento em ${days} dia${days === 1 ? '' : 's'}` : 'Cadastre a próxima renda'}</small></article>`;

  const entries = agendaEntries(view, selectedMonth);
  const windowCard = (title, subtitle, from, to) => {
    const period = entries.filter(item => { const day = localDate(item.date).getDate(); return day >= from && day <= to; });
    const income = period.filter(item => item.isIncome).reduce((sum, item) => sum + item.value, 0);
    const expense = period.filter(item => !item.isIncome).reduce((sum, item) => sum + item.value, 0);
    return `<article class="receipt-card"><header><strong>${title}</strong><span>${subtitle}</span></header><dl><dt>Entradas previstas</dt><dd class="positive">${shortMoney(income)}</dd><dt>Contas que vencem</dt><dd class="negative">${shortMoney(expense)}</dd><dt>Valor reservado</dt><dd>${shortMoney(expense)}</dd><dt>Saldo livre previsto</dt><dd class="${income - expense >= 0 ? 'positive' : 'negative'}">${shortMoney(income - expense)}</dd></dl></article>`;
  };
  $('#receiptWindows').innerHTML = windowCard('📆 1ª quinzena', 'DIAS 1–15', 1, 15) + windowCard('📆 2ª quinzena', 'DIAS 16–31', 16, 31);
}

function renderInsight({ safe, score, totals }) {
  const view = activeState();
  let title = 'Sua base está pronta';
  let text = 'Continue registrando cada movimento para melhorar suas projeções.';
  if (!view.incomes.length) { title = 'Cadastre sua renda'; text = 'Assim o app calcula o que realmente cabe no mês e quando você recebe.'; }
  else if (safe < 0) { title = `Faltam ${money(Math.abs(safe))} até a próxima renda`; text = 'Priorize essenciais e adie gastos que não sejam urgentes.'; }
  else if (totals.plannedExpense > totals.plannedIncome) { title = 'O mês está acima da renda'; text = `A diferença prevista é de ${money(totals.plannedExpense - totals.plannedIncome)}.`; }
  else if (score >= 80) { title = 'Boa margem de segurança'; text = 'Seu fluxo está saudável. Direcione parte da sobra para uma meta.'; }
  $('#insightTitle').textContent = title;
  $('#insightText').textContent = text;
}

function renderFamilyOverview() {
  const cards = state.members.filter(item => item.active !== false).map(member => {
    const view = stateForMember(state, member.id);
    const totals = totalsForMonth(view, selectedMonth);
    const debt = view.debts.reduce((sum, item) => sum + Number(item.balance || 0), 0);
    return `<article class="family-member-card"><header><span class="member-avatar">${escapeHtml(member.name.slice(0, 1).toUpperCase())}</span><div><strong>${escapeHtml(member.name)}</strong><small>${escapeHtml(member.role || (member.type === 'household' ? 'Compartilhado' : 'Membro'))}</small></div></header><div class="member-values"><span>Entradas<b class="positive">${shortMoney(totals.plannedIncome)}</b></span><span>Saídas<b class="negative">${shortMoney(totals.plannedExpense)}</b></span><span>Dívidas<b>${shortMoney(debt)}</b></span><span>Resultado<b class="${totals.result >= 0 ? 'positive' : 'negative'}">${shortMoney(totals.result)}</b></span></div></article>`;
  });
  $('#familyOverview').innerHTML = cards.length ? cards.join('') : empty('Adicione os membros da família.');
}

function renderMemberFilter() {
  if (memberFilter !== 'all' && !state.members.some(item => item.id === memberFilter && item.active !== false)) memberFilter = 'all';
  const options = [['all', `Toda a ${state.household.name || 'família'}`], ...memberChoices()];
  $('#memberFilter').innerHTML = options.map(([id, name]) => `<option value="${escapeHtml(id)}" ${id === memberFilter ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('');
}

function timelineItem(item) {
  const view = activeState();
  const status = entryStatus(view, item, selectedMonth);
  const paid = status === 'paid';
  const member = memberById(item.memberId);
  return `<article class="timeline-item">
    <div class="date-tile"><strong>${localDate(item.date).getDate()}</strong><span>${shortMonth(localDate(item.date))}</span></div>
    <i class="status-dot ${status}"></i>
    <div class="item-copy"><strong>${escapeHtml(item.name)}${item.installmentNo ? ` · ${item.installmentNo}/${item.total}` : ''}</strong><span>${paid ? 'Realizado' : status === 'late' ? 'Atrasado' : status === 'soon' ? 'Vence em breve' : 'Previsto'}</span><span class="timeline-member">${escapeHtml(member.name)}</span></div>
    <div class="item-amount ${item.isIncome ? 'positive' : 'negative'}">${item.isIncome ? '+' : '−'} ${money(item.value)}</div>
    ${paid ? '' : `<button class="icon-button" data-record="${escapeHtml(item.kind)}|${escapeHtml(item.id)}" title="Marcar como realizado" aria-label="Marcar ${escapeHtml(item.name)} como realizado">✓</button>`}
  </article>`;
}

function renderTransactions() {
  const query = $('#searchTransactions').value.trim().toLocaleLowerCase('pt-BR');
  const filter = $('#transactionFilter').value;
  const transactions = transactionForMonth(activeState(), selectedMonth)
    .filter(item => filter === 'all' || item.type === filter)
    .filter(item => !query || `${item.desc} ${item.cat}`.toLocaleLowerCase('pt-BR').includes(query))
    .sort((a, b) => b.date.localeCompare(a.date));
  if (!transactions.length) { $('#transactionList').innerHTML = empty('Nenhuma movimentação encontrada.'); return; }
  let lastDate = '';
  $('#transactionList').innerHTML = transactions.map(item => {
    const heading = item.date !== lastDate ? `<div class="group-label">${localDate(item.date).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}</div>` : '';
    lastDate = item.date;
    return `${heading}<article class="transaction-item"><div class="transaction-icon">${categoryIcon(item.cat)}</div><div class="item-copy"><strong>${escapeHtml(item.desc || item.cat || 'Movimentação')}</strong><span>${escapeHtml(item.cat || 'Outros')} · ${escapeHtml(memberById(item.memberId).name)}</span></div><div class="item-amount ${item.type === 'entrada' ? 'positive' : 'negative'}">${item.type === 'entrada' ? '+' : '−'} ${money(item.value)}</div><button data-edit-transaction="${escapeHtml(item.id)}" aria-label="Editar">•••</button></article>`;
  }).join('');
}

function renderAgenda() {
  const view = activeState();
  const entries = agendaEntries(view, selectedMonth);
  const counts = { pending: 0, late: 0, paid: 0 };
  entries.forEach(item => { const status = entryStatus(view, item, selectedMonth); counts[status === 'soon' ? 'pending' : status] += 1; });
  $('#agendaStats').innerHTML = `<div class="status-pill"><span>PENDENTES</span><strong>${counts.pending}</strong></div><div class="status-pill"><span>ATRASADAS</span><strong class="negative">${counts.late}</strong></div><div class="status-pill"><span>REALIZADAS</span><strong class="positive">${counts.paid}</strong></div>`;
  const filtered = entries.filter(item => {
    const status = entryStatus(view, item, selectedMonth);
    return agendaFilter === 'all' || status === agendaFilter || (agendaFilter === 'pending' && status === 'soon');
  });
  $('#agendaList').innerHTML = filtered.length ? filtered.map(timelineItem).join('') : empty('Nenhum item com esse status.');
}

function renderPlan() {
  const view = activeState();
  let accumulated = 0;
  const months = Array.from({ length: 12 }, (_, index) => {
    const date = addMonths(selectedMonth, index);
    const totals = totalsForMonth(view, date);
    const result = totals.plannedIncome - totals.plannedExpense;
    accumulated += result;
    return { date, totals, result, accumulated };
  });
  $('#twelveMonthResult').textContent = money(accumulated);
  $('#twelveMonthResult').className = `money ${accumulated >= 0 ? 'positive' : 'negative'}`;
  const point = balancePoint(view, selectedMonth);
  $('#balancePoint').textContent = point ? `Ponto de equilíbrio: ${monthName(point)}` : 'Ponto de equilíbrio não previsto em 12 meses';
  $('#forecastList').innerHTML = months.map(({ date, totals, result }) => `<article class="forecast-card ${result >= 0 ? 'positive-month' : 'negative-month'}"><span>${monthName(date)}</span><strong class="${result >= 0 ? 'positive' : 'negative'}">${result >= 0 ? '🟢' : '🔴'} ${money(result)}</strong><small>${money(totals.plannedIncome)} entra</small><small>${money(totals.plannedExpense)} sai</small>${totals.pendingIncome > 0 ? '<span class="forecast-badge">🟡 PREVISTO — NÃO DISPONÍVEL</span>' : ''}</article>`).join('');
  $('#goalList').innerHTML = view.goals.length ? view.goals.map(goal => {
    const progress = Math.min(100, Number(goal.current || 0) / Math.max(Number(goal.target || 0), 1) * 100);
    return `<button class="goal-card" data-edit-goal="${escapeHtml(goal.id)}"><span>${escapeHtml(goal.name)}</span><small>${money(goal.current)} de ${money(goal.target)}</small><div class="progress"><i style="width:${progress}%"></i></div></button>`;
  }).join('') : empty('Crie uma meta para transformar sobra em progresso.');
  renderDebtCenter(view);
  renderMonthlyReport(view);
}

function renderDebtCenter(view) {
  $('#debtCenter').innerHTML = view.debts.length ? view.debts.map(item => {
    const late = ['Atrasado', 'Renegociar'].includes(item.status);
    const installments = Number(item.remaining || item.installments || 0);
    return `<button class="debt-card" data-edit-debt="${escapeHtml(item.id)}"><header><span>${late ? '🔴' : '🟢'} ${escapeHtml(item.status || 'Acompanhar')}</span><small>dia ${Number(item.day) || '—'}</small></header><strong>${escapeHtml(item.name)}</strong><small>Saldo: ${money(item.balance)} · Parcela: ${money(item.monthly)}</small><small>${installments ? `${installments} parcelas restantes` : 'Prazo ainda não informado'}</small><div class="strategy">🎯 ${escapeHtml(item.strategy || item.proposal || 'Defina a estratégia de quitação')}</div></button>`;
  }).join('') : empty('Cadastre suas dívidas para visualizar saldo, parcela, situação e estratégia.');
}

function renderMonthlyReport(view) {
  const totals = totalsForMonth(view, selectedMonth);
  const transactions = transactionForMonth(view, selectedMonth);
  const debtPaid = transactions.filter(item => item.linkType === 'debt' || item.cat === 'Dívida').reduce((sum, item) => sum + Number(item.value || 0), 0);
  const result = totals.realizedIncome - totals.realizedExpense;
  $('#reportSummary').innerHTML = `<div><span>Você recebeu</span><strong class="positive">${money(totals.realizedIncome)}</strong></div><div><span>Você gastou</span><strong class="negative">${money(totals.realizedExpense)}</strong></div><div><span>Pagou em dívidas</span><strong>${money(debtPaid)}</strong></div><div><span>Reduziu dívidas em</span><strong class="positive">${money(debtPaid)}</strong></div><div><span>Resultado realizado</span><strong class="${result >= 0 ? 'positive' : 'negative'}">${money(result)}</strong></div>`;
  const expenses = transactions.filter(item => item.type === 'saida');
  const total = expenses.reduce((sum, item) => sum + Number(item.value || 0), 0);
  const categories = [...expenses.reduce((map, item) => map.set(item.cat || 'Outros', (map.get(item.cat || 'Outros') || 0) + Number(item.value || 0)), new Map())]
    .sort((a, b) => b[1] - a[1]);
  $('#categoryReport').innerHTML = categories.length ? categories.map(([category, value]) => { const percent = value / Math.max(total, 1) * 100; return `<div class="category-row"><span>${categoryIcon(category)} ${escapeHtml(category)}</span><div class="bar"><i class="expense" style="width:${percent}%"></i></div><b>${Math.round(percent)}%</b></div>`; }).join('') : empty('Registre saídas para formar o gráfico mensal por categoria.');
}

function renderSettings() {
  $('#memberManager').innerHTML = state.members.map(item => `<button class="manager-item" data-edit-member="${escapeHtml(item.id)}"><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.role || 'Membro')} · ${item.active === false ? 'inativo' : 'ativo'}</small></span><b>›</b></button>`).join('');
  $('#incomeManager').innerHTML = state.incomes.length ? state.incomes.map(item => `<button class="manager-item" data-edit-income="${escapeHtml(item.id)}"><span><strong>${item.availability === 'regular' ? '🟢' : '🟡'} ${escapeHtml(item.name)}</strong><small>${item.schedule === 'second-business-day' ? '2º dia útil' : `Dia ${item.day}`} · ${item.active === false ? 'fora da projeção' : item.availability === 'regular' ? 'renda regular' : 'prevista'}</small></span><b class="positive">${money(item.value)}</b></button>`).join('') : empty('Nenhuma renda cadastrada.');
  $('#extraManager').innerHTML = state.extras.length ? state.extras.sort((a, b) => String(a.date).localeCompare(String(b.date))).map(item => `<button class="manager-item" data-edit-extra="${escapeHtml(item.id)}"><span><strong>${extraTypeLabel(item.type)} · ${escapeHtml(item.name)}</strong><small>${item.date ? localDate(item.date).toLocaleDateString('pt-BR') : 'Sem data'} · ${item.active === false ? 'fora da projeção' : item.confidence === 'confirmed' ? 'confirmada' : item.confidence === 'likely' ? 'provável' : 'possível'}</small></span><b class="positive">${money(item.value)}</b></button>`).join('') : empty('Nenhuma renda extraordinária cadastrada.');
  $('#commitmentManager').innerHTML = state.commitments.length ? state.commitments.map(item => `<button class="manager-item" data-edit-commitment="${escapeHtml(item.id)}"><span><strong>${escapeHtml(item.name)}</strong><small>${item.recurring ? 'Recorrente' : `${item.installments} parcelas`} · dia ${item.day}</small></span><b class="negative">${money(item.value)}</b></button>`).join('') : empty('Nenhuma conta cadastrada.');
  $('#debtManager').innerHTML = state.debts.length ? state.debts.map(item => `<button class="manager-item" data-edit-debt="${escapeHtml(item.id)}"><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.status || 'Acompanhar')} · ${escapeHtml(item.strategy || 'Sem estratégia')}</small></span><b>${money(item.balance)}</b></button>`).join('') : empty('Nenhuma dívida cadastrada.');
}

function renderAll() {
  applyPreferences();
  renderMemberFilter();
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
      field('Dia do mês', 'day', 'number', existing?.day || 5, { min: 1, max: 31 }) +
      select('Confiança', 'availability', existing?.availability || 'expected', [['expected', '🟡 Prevista — ainda não disponível'], ['regular', '🟢 Renda regular']]) +
      select('Incluir na projeção', 'active', String(existing?.active ?? true), [['true', 'Sim'], ['false', 'Não, deixar pausada']]);
  } else if (type === 'extra') {
    title = existing ? 'Editar renda extraordinária' : 'Nova renda extraordinária'; eyebrow = 'VALOR FORA DA ROTINA';
    const replaceChoices = [['', 'Não substitui nenhuma renda'], ...state.incomes.map(item => [item.id, item.name])];
    fields = field('Nome', 'name', 'text', existing?.name || '', { class: 'full', required: true, maxlength: 100 }) +
      select('Tipo', 'extraType', existing?.type || 'bonus', [['bonus', '🏆 Meta/premiação'], ['thirteenth', '🎁 13º salário'], ['vacation', '🏖️ Férias'], ['refund', '↩️ Reembolso'], ['other', '✨ Outra renda']]) +
      field('Valor previsto', 'value', 'number', existing?.value || '', { min: 0.01, step: 0.01, required: true }) +
      field('Data prevista para receber', 'date', 'date', existing?.date || new Date().toISOString().slice(0, 10), { required: true }) +
      select('Nível de certeza', 'confidence', existing?.confidence || 'expected', [['expected', '🟡 Possível'], ['likely', '🟠 Provável'], ['confirmed', '🟢 Confirmada']]) +
      select('Incluir na projeção', 'active', String(existing?.active ?? true), [['true', 'Sim'], ['false', 'Não, deixar pausada']]) +
      field('Início das férias (opcional)', 'vacationStart', 'date', existing?.vacationStart || '') +
      field('Fim das férias (opcional)', 'vacationEnd', 'date', existing?.vacationEnd || '') +
      select('Durante as férias, este valor substitui', 'replaceIncomeId', existing?.replaceIncomeId || '', replaceChoices, true);
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
      field('Primeiro vencimento', 'start', 'date', existing?.start || new Date().toISOString().slice(0, 10)) +
      field('Dia da parcela', 'day', 'number', existing?.day || 1, { min: 1, max: 31 }) +
      field('Parcelas restantes', 'remaining', 'number', existing?.remaining || '', { min: 0, max: 999 }) +
      field('Entrada da proposta', 'proposalEntry', 'number', existing?.proposalEntry || 0, { min: 0, step: 0.01 }) +
      field('Estratégia', 'strategy', 'text', existing?.strategy || '', { class: 'full', maxlength: 160 }) +
      field('Proposta/observação', 'proposal', 'text', existing?.proposal || '', { class: 'full', maxlength: 180 });
  } else if (type === 'member') {
    title = existing ? 'Editar membro' : 'Novo membro da família'; eyebrow = 'FAMÍLIA';
    fields = field('Nome', 'name', 'text', existing?.name || '', { class: 'full', required: true, maxlength: 60 }) +
      field('Papel na família', 'role', 'text', existing?.role || '', { class: 'full', maxlength: 80 }) +
      select('Tipo', 'memberType', existing?.type || 'person', [['person', 'Pessoa'], ['household', 'Casa/compartilhado']]) +
      select('Situação', 'active', String(existing?.active ?? true), [['true', 'Ativo'], ['false', 'Inativo']]);
  } else if (type === 'household') {
    title = 'Nome da família'; eyebrow = 'GRUPO FAMILIAR';
    fields = field('Nome do grupo', 'name', 'text', state.household.name || 'Minha família', { class: 'full', required: true, maxlength: 60 });
  }
  if (['transaction', 'commitment', 'income', 'extra', 'goal', 'debt'].includes(type)) fields += select('Pertence a', 'memberId', existing?.memberId || prefill.memberId || (memberFilter === 'all' ? 'primary' : memberFilter), memberChoices(), true);
  $('#dialogTitle').textContent = title; $('#dialogEyebrow').textContent = eyebrow; $('#dialogFields').innerHTML = fields;
  $('#editorDialog').showModal();
}

async function saveEditor(formData) {
  const data = Object.fromEntries(formData);
  const { type, id, prefill } = dialogContext;
  if (type === 'transaction') {
    const previous = state.transactions.find(item => item.id === id);
    const item = stamp({ ...previous, id: id || uid(), type: data.type, date: data.date, desc: data.desc.trim(), cat: data.cat, value: Number(data.value), memberId: data.memberId, ...prefill });
    state.transactions = id ? state.transactions.map(entry => entry.id === id ? item : entry) : [...state.transactions, item];
  } else if (type === 'commitment') {
    const previous = state.commitments.find(item => item.id === id);
    const item = stamp({ ...previous, id: id || uid(), name: data.name.trim(), kind: data.kind, value: Number(data.value), start: data.start, day: Number(data.day), recurring: data.recurring === 'true', installments: data.recurring === 'true' ? null : Number(data.installments), priority: data.priority, memberId: data.memberId, active: true });
    state.commitments = id ? state.commitments.map(entry => entry.id === id ? item : entry) : [...state.commitments, item];
  } else if (type === 'income') {
    const previous = state.incomes.find(item => item.id === id);
    const item = stamp({ ...previous, id: id || uid(), name: data.name.trim(), value: Number(data.value), schedule: data.schedule, day: Number(data.day), availability: data.availability, memberId: data.memberId, active: data.active === 'true' });
    state.incomes = id ? state.incomes.map(entry => entry.id === id ? item : entry) : [...state.incomes, item];
  } else if (type === 'extra') {
    const previous = state.extras.find(item => item.id === id);
    const item = stamp({ ...previous, id: id || uid(), name: data.name.trim(), type: data.extraType, value: Number(data.value), date: data.date, confidence: data.confidence, active: data.active === 'true', vacationStart: data.vacationStart || '', vacationEnd: data.vacationEnd || '', replaceIncomeId: data.extraType === 'vacation' ? data.replaceIncomeId : '', memberId: data.memberId });
    state.extras = id ? state.extras.map(entry => entry.id === id ? item : entry) : [...state.extras, item];
  } else if (type === 'goal') {
    const previous = state.goals.find(item => item.id === id);
    const item = stamp({ ...previous, id: id || uid(), name: data.name.trim(), target: Number(data.target), current: Number(data.current), memberId: data.memberId });
    state.goals = id ? state.goals.map(entry => entry.id === id ? item : entry) : [...state.goals, item];
  } else if (type === 'balance') {
    const transactionSum = state.transactions.reduce((sum, item) => sum + (item.type === 'entrada' ? 1 : -1) * Number(item.value || 0), 0);
    state.initialBalance = Number(data.balance) - transactionSum;
  } else if (type === 'debt') {
    const previous = state.debts.find(item => item.id === id);
    const item = stamp({ ...previous, id: id || uid(), name: data.name.trim(), balance: Number(data.balance), status: data.status, monthly: Number(data.monthly), start: data.start, day: Number(data.day), remaining: Number(data.remaining) || 0, proposalEntry: Number(data.proposalEntry) || 0, strategy: data.strategy.trim(), proposal: data.proposal.trim(), memberId: data.memberId });
    state.debts = id ? state.debts.map(entry => entry.id === id ? item : entry) : [...state.debts, item];
  } else if (type === 'member') {
    const previous = state.members.find(item => item.id === id);
    const protectedMember = ['primary', 'household'].includes(id);
    const item = stamp({ ...previous, id: id || uid(), name: data.name.trim(), role: data.role.trim(), type: data.memberType, active: protectedMember ? true : data.active === 'true' });
    state.members = id ? state.members.map(entry => entry.id === id ? item : entry) : [...state.members, item];
  } else if (type === 'household') {
    state.household = stamp({ ...state.household, name: data.name.trim() });
  }
  $('#editorDialog').close();
  await persist('Dados salvos com segurança.');
}

async function recordEntry(kind, id) {
  const entry = agendaEntries(state, selectedMonth).find(item => item.kind === kind && item.id === id);
  if (!entry) return;
  state.transactions.push(stamp({ id: uid(), type: entry.isIncome ? 'entrada' : 'saida', date: entry.date, desc: entry.name, cat: entry.kind === 'extra' ? 'Extra' : entry.isIncome ? 'Salário' : entry.kind === 'debt' ? 'Dívida' : 'Outros', value: entry.value, memberId: entry.memberId || 'primary', linkType: entry.kind, linkId: entry.id, monthKey: monthKey(selectedMonth) }));
  if (kind === 'debt') state.debts = state.debts.map(item => item.id === id ? stamp({ ...item, balance: Math.max(0, Number(item.balance || 0) - entry.value), remaining: Number(item.remaining || 0) > 0 ? Number(item.remaining) - 1 : 0, status: Number(item.balance || 0) - entry.value <= 0 ? 'Em dia' : item.status }) : item);
  await persist(entry.isIncome ? 'Recebimento registrado.' : 'Pagamento registrado.');
}

function simulate() {
  const value = Number($('#simValue').value) || 0;
  const monthly = Number($('#simMonthly').value) || value;
  const months = Number($('#simMonths').value) || 1;
  const view = activeState();
  const totals = totalsForMonth(view, selectedMonth);
  const before = totals.plannedIncome - totals.plannedExpense;
  const margin = before - monthly;
  const safe = cashNow(view) - reservedUntilNextIncome(view) - value;
  let verdict = '✅ ACORDO COMPATÍVEL'; let detail = `Sua margem passaria de ${money(before)} para ${money(margin)} por mês.`; let tone = 'positive';
  if (margin < 0 || safe < 0) { verdict = '⚠️ ACORDO NÃO RECOMENDADO'; detail = `Sua margem passaria de ${money(before)} para ${money(margin)} e faltariam ${money(Math.abs(Math.min(margin, safe)))}.`; tone = 'negative'; }
  else if (margin < totals.plannedIncome * .1) { verdict = 'Cabe, mas com pouca margem'; detail = `A folga mensal cairia para ${money(margin)} durante ${months} meses.`; tone = ''; }
  $('#simulationResult').hidden = false;
  $('#simulationResult').innerHTML = `<strong class="${tone}">${verdict}</strong><p>${detail} O custo informado foi ${money(value)}.</p>`;
}

function checkSpending() {
  const value = Number($('#spendValue').value) || 0;
  const view = activeState();
  const bank = cashNow(view);
  const committed = reservedUntilNextIncome(view);
  const available = bank - committed;
  const after = available - value;
  const compatible = value > 0 && after >= 0;
  $('#spendCheckResult').hidden = false;
  $('#spendCheckResult').innerHTML = `<strong class="${compatible ? 'positive' : 'negative'}">${compatible ? '🟢 COMPATÍVEL' : '🔴 NÃO RECOMENDADO'}</strong><p>Você possui ${money(bank)} nas contas, porém ${money(committed)} já estão comprometidos. Disponível real: ${money(available)}. Após o gasto: ${money(after)}.</p>`;
}

function downloadBackup(label = '') {
  const url = URL.createObjectURL(new Blob([exportBackup(state)], { type: 'application/json' }));
  const suffix = label ? `-${label}` : '';
  const link = Object.assign(document.createElement('a'), { href: url, download: `meu-financeiro-familia${suffix}-${new Date().toISOString().slice(0, 10)}.json` });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportSummaryImage() {
  const view = activeState();
  const totals = totalsForMonth(view, selectedMonth);
  const canvas = document.createElement('canvas');
  canvas.width = 1080; canvas.height = 1350;
  const ctx = canvas.getContext('2d');
  const rounded = (x, y, w, h, r, color) => { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fillStyle = color; ctx.fill(); };
  const write = (text, x, y, size = 30, color = '#17201d', weight = 500, align = 'left') => { ctx.font = `${weight} ${size}px Arial`; ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(text, x, y); };
  ctx.fillStyle = '#f5f5f2'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  rounded(42, 42, 996, 230, 36, '#0b4d3b');
  write((state.household.name || 'Minha família').toUpperCase(), 82, 105, 22, '#a8d6c5', 700);
  write('Resumo financeiro', 82, 163, 48, '#ffffff', 700);
  write(monthName(selectedMonth), 82, 215, 25, '#cce7dc', 400);
  const filterName = memberFilter === 'all' ? 'Visão consolidada' : `Visão: ${memberById(memberFilter).name}`;
  write(filterName, 992, 215, 22, '#cce7dc', 400, 'right');
  const kpis = [['Entradas', totals.plannedIncome, '#16764e'], ['Saídas', totals.plannedExpense, '#bd3e3e'], ['Resultado', totals.result, totals.result >= 0 ? '#16764e' : '#bd3e3e'], ['Saldo atual', cashNow(view), '#17201d']];
  kpis.forEach(([label, value, color], index) => { const x = 42 + (index % 2) * 508, y = 306 + Math.floor(index / 2) * 154; rounded(x, y, 488, 132, 26, '#ffffff'); write(label, x + 28, y + 42, 21, '#68736e', 400); write(money(value), x + 28, y + 94, 34, color, 700); });
  write('Participação da família', 50, 650, 32, '#17201d', 700);
  let y = 690;
  state.members.filter(item => item.active !== false).slice(0, 7).forEach(member => {
    const memberState = stateForMember(state, member.id); const mt = totalsForMonth(memberState, selectedMonth); const debt = memberState.debts.reduce((sum, item) => sum + Number(item.balance || 0), 0);
    rounded(42, y, 996, 82, 18, '#ffffff'); rounded(58, y + 16, 50, 50, 14, '#dff4eb'); write(member.name.slice(0, 1).toUpperCase(), 83, y + 51, 22, '#126e56', 700, 'center'); write(member.name, 128, y + 35, 23, '#17201d', 700); write(member.role || 'Membro', 128, y + 62, 16, '#68736e', 400); write(`Entra ${shortMoney(mt.plannedIncome)}`, 650, y + 35, 18, '#16764e', 700, 'right'); write(`Sai ${shortMoney(mt.plannedExpense)}  ·  Dívida ${shortMoney(debt)}`, 1008, y + 62, 16, '#68736e', 400, 'right'); y += 94;
  });
  write('Gerado no Meu Financeiro · dados privados e locais', 54, 1310, 17, '#68736e', 400);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  const url = URL.createObjectURL(blob); const link = Object.assign(document.createElement('a'), { href: url, download: `resumo-${(state.household.name || 'familia').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${monthKey(selectedMonth)}.png` }); link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast('Resumo em imagem gerado.');
}

document.addEventListener('click', async event => {
  const dialogClose = event.target.closest('[data-dialog-close]'); if (dialogClose) { $('#editorDialog').close(); return; }
  const nav = event.target.closest('[data-nav]'); if (nav) go(nav.dataset.nav);
  const month = event.target.closest('[data-month]'); if (month) { selectedMonth = month.dataset.month === 'today' ? startOfMonth(new Date()) : addMonths(selectedMonth, Number(month.dataset.month)); renderAll(); }
  const opener = event.target.closest('[data-open]'); if (opener) openEditor(opener.dataset.open);
  const record = event.target.closest('[data-record]'); if (record) { const [kind, id] = record.dataset.record.split('|'); await recordEntry(kind, id); }
  const editTx = event.target.closest('[data-edit-transaction]'); if (editTx) openEditor('transaction', state.transactions.find(item => item.id === editTx.dataset.editTransaction));
  const editGoal = event.target.closest('[data-edit-goal]'); if (editGoal) openEditor('goal', state.goals.find(item => item.id === editGoal.dataset.editGoal));
  const editIncome = event.target.closest('[data-edit-income]'); if (editIncome) openEditor('income', state.incomes.find(item => item.id === editIncome.dataset.editIncome));
  const editExtra = event.target.closest('[data-edit-extra]'); if (editExtra) openEditor('extra', state.extras.find(item => item.id === editExtra.dataset.editExtra));
  const editCommitment = event.target.closest('[data-edit-commitment]'); if (editCommitment) openEditor('commitment', state.commitments.find(item => item.id === editCommitment.dataset.editCommitment));
  const editDebt = event.target.closest('[data-edit-debt]'); if (editDebt) openEditor('debt', state.debts.find(item => item.id === editDebt.dataset.editDebt));
  const editMember = event.target.closest('[data-edit-member]'); if (editMember) openEditor('member', state.members.find(item => item.id === editMember.dataset.editMember));
  const agendaButton = event.target.closest('[data-agenda-filter]'); if (agendaButton) { agendaFilter = agendaButton.dataset.agendaFilter; $$('#agendaFilters button').forEach(item => item.classList.toggle('active', item === agendaButton)); renderAgenda(); }
});

$('.fab').addEventListener('pointerdown', event => {
  const button = event.currentTarget;
  button.classList.add('is-active');
  setTimeout(() => button.classList.remove('is-active'), 1200);
});
$('#editorDialog').addEventListener('click', event => { if (event.target === event.currentTarget) event.currentTarget.close(); });

$('#editorForm').addEventListener('submit', event => { event.preventDefault(); if (event.submitter?.value === 'cancel') { $('#editorDialog').close(); return; } if (event.currentTarget.reportValidity()) saveEditor(new FormData(event.currentTarget)); });
$('#searchTransactions').addEventListener('input', renderTransactions);
$('#transactionFilter').addEventListener('change', renderTransactions);
$('#memberFilter').addEventListener('change', event => { memberFilter = event.target.value; renderAll(); });
$('#simulateButton').addEventListener('click', simulate);
$('#spendCheckButton').addEventListener('click', checkSpending);
$('#shareImageButton').addEventListener('click', exportSummaryImage);
$('#themeToggle').addEventListener('click', async () => { state.preferences.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; await persist(); });
$('#privacyToggle').addEventListener('click', async () => { state.preferences.privacy = !state.preferences.privacy; await persist(); });
$('#exportButton').addEventListener('click', () => { downloadBackup(); toast('Backup familiar exportado.'); });
$('#importButton').addEventListener('click', () => $('#importFile').click());
$('#importFile').addEventListener('change', async event => { try { const file = event.target.files[0]; if (!file) return; const imported = importBackup(await file.text()); const merge = confirm('Deseja MESCLAR este backup com os dados atuais?\n\nOK = mesclar sem duplicar\nCancelar = escolher substituição completa'); if (merge) { state = mergeStates(state, imported); await persist('Backup mesclado com sucesso.'); return; } if (!confirm('Substituir todos os dados atuais? Um backup de segurança será baixado antes.')) return; downloadBackup('antes-de-restaurar'); state = imported; memberFilter = 'all'; await persist('Backup restaurado.'); } catch (error) { toast(error.message || 'Não foi possível importar o backup.'); } finally { event.target.value = ''; } });
$('#resetButton').addEventListener('click', async () => { if (!confirm('Apagar todos os dados financeiros deste dispositivo? Esta ação não pode ser desfeita.')) return; if (!confirm('Confirma que deseja recomeçar com o app vazio?')) return; state = await clearState(); renderAll(); toast('Dados apagados.'); });

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw-financeiro.js', { scope: './', updateViaCache: 'none' }).then(registration => {
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
