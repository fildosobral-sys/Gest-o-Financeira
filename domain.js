export const SCHEMA_VERSION = 5;

export const emptyState = () => ({
  version: SCHEMA_VERSION,
  household: { id: uid(), name: 'Minha família', updatedAt: new Date().toISOString() },
  members: [
    { id: 'primary', name: 'Eu', role: 'Responsável principal', type: 'person', active: true, updatedAt: new Date().toISOString() },
    { id: 'household', name: 'Casa', role: 'Despesas compartilhadas', type: 'household', active: true, updatedAt: new Date().toISOString() }
  ],
  initialBalance: 0,
  incomes: [],
  commitments: [],
  debts: [],
  extras: [],
  goals: [],
  transactions: [],
  preferences: { theme: 'system', privacy: false }
});

export const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const money = value => brl.format(Number(value) || 0);
export const uid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const pad = value => String(value).padStart(2, '0');
export const monthKey = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
export const localDate = value => value instanceof Date ? new Date(value.getFullYear(), value.getMonth(), value.getDate(), 12) : new Date(`${value}T12:00:00`);
export const isoDate = (year, month, day) => `${year}-${pad(month + 1)}-${pad(Math.min(Math.max(Number(day) || 1, 1), new Date(year, month + 1, 0).getDate()))}`;
export const startOfMonth = date => new Date(date.getFullYear(), date.getMonth(), 1, 12);
export const addMonths = (date, count) => new Date(date.getFullYear(), date.getMonth() + count, 1, 12);
export const monthDistance = (from, to) => (to.getFullYear() - from.getFullYear()) * 12 + to.getMonth() - from.getMonth();
export const isWeekend = date => date.getDay() === 0 || date.getDay() === 6;

export function secondBusinessDay(year, month, holidays = []) {
  const excluded = new Set(holidays);
  let count = 0;
  for (let day = 1; day <= 7; day += 1) {
    const date = new Date(year, month, day, 12);
    const iso = isoDate(year, month, day);
    if (!isWeekend(date) && !excluded.has(iso)) {
      count += 1;
      if (count === 2) return iso;
    }
  }
  throw new Error('Não foi possível calcular o segundo dia útil.');
}

export function incomeOccurrence(income, date, holidays = []) {
  if (!income?.active) return null;
  const year = date.getFullYear();
  const month = date.getMonth();
  const occurrenceDate = income.schedule === 'second-business-day'
    ? secondBusinessDay(year, month, holidays)
    : isoDate(year, month, income.day);
  return { kind: 'income', id: income.id, name: income.name, value: Number(income.value) || 0, date: occurrenceDate, isIncome: true, memberId: income.memberId || 'primary' };
}

export function occurrenceForCommit(commitment, date) {
  if (!commitment?.active || !commitment.start) return null;
  const index = monthDistance(startOfMonth(localDate(commitment.start)), startOfMonth(date));
  if (index < 0) return null;
  const recurring = commitment.recurring || Number(commitment.installments) === 999;
  const total = recurring ? null : Math.max(1, Number(commitment.installments) || 1);
  const paidCount = Math.max(0, Number(commitment.paidCount) || 0);
  if (!recurring && index >= total - paidCount) return null;
  const installmentNo = recurring ? null : paidCount + index + 1;
  return {
    kind: 'commitment', id: commitment.id, name: commitment.name,
    value: Number(commitment.value) || 0,
    date: isoDate(date.getFullYear(), date.getMonth(), commitment.day || localDate(commitment.start).getDate()),
    isIncome: false, installmentNo, total, commitment, memberId: commitment.memberId || 'primary'
  };
}

export function migrateState(raw) {
  if (!raw || typeof raw !== 'object') return emptyState();
  const base = emptyState();
  const state = { ...base, ...raw, preferences: { ...base.preferences, ...(raw.preferences || {}) } };
  state.household = raw.household && typeof raw.household === 'object' ? { ...base.household, ...raw.household } : base.household;
  state.members = Array.isArray(raw.members) && raw.members.length
    ? raw.members
    : base.members.map(item => ({ ...item, updatedAt: '1970-01-01T00:00:00.000Z' }));
  state.members = state.members.map(item => ({ ...item, active: item.active !== false, updatedAt: item.updatedAt || '1970-01-01T00:00:00.000Z' }));
  if (!state.members.some(item => item.id === 'primary')) state.members.unshift(base.members[0]);
  if (!state.members.some(item => item.id === 'household')) state.members.push(base.members[1]);
  for (const key of ['incomes', 'commitments', 'debts', 'extras', 'goals', 'transactions']) {
    state[key] = Array.isArray(raw[key]) ? raw[key] : [];
    state[key] = state[key].map(item => ({ ...item, memberId: item.memberId || 'primary', updatedAt: item.updatedAt || '1970-01-01T00:00:00.000Z' }));
  }
  state.commitments = state.commitments.map(item => ({
    ...item,
    recurring: item.recurring ?? Number(item.installments) === 999,
    installments: Number(item.installments) === 999 ? null : Math.max(1, Number(item.installments) || 1),
    active: item.active !== false
  }));
  state.incomes = state.incomes.map(item => ({ ...item, active: item.active !== false }));
  state.version = SCHEMA_VERSION;
  return state;
}

export function validateBackup(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('O backup não contém um objeto válido.');
  const collections = ['members', 'incomes', 'commitments', 'debts', 'extras', 'goals', 'transactions'];
  if (!collections.some(key => Array.isArray(raw[key]))) throw new Error('O arquivo não parece ser um backup do Meu Financeiro.');
  for (const key of collections) if (raw[key] != null && !Array.isArray(raw[key])) throw new Error(`Campo inválido: ${key}.`);
  const state = migrateState(raw);
  const all = collections.flatMap(key => state[key]);
  if (all.length > 100000) throw new Error('O backup excede o limite de registros.');
  return state;
}

export const transactionForMonth = (state, date) => state.transactions.filter(item => String(item.date || '').startsWith(monthKey(date)));
export const linkedTransaction = (state, kind, id, date) => state.transactions.find(item => item.linkType === kind && item.linkId === id && item.monthKey === monthKey(date));

export function agendaEntries(state, date, holidays = []) {
  const entries = [];
  const monthExtras = state.extras.filter(item => item.active !== false && String(item.date).startsWith(monthKey(date)));
  const selectedKey = monthKey(date);
  const replacedIncomeIds = new Set(state.extras.filter(item => item.active !== false && item.type === 'vacation' && item.replaceIncomeId && item.vacationStart && monthKey(localDate(item.vacationStart)) <= selectedKey && monthKey(localDate(item.vacationEnd || item.vacationStart)) >= selectedKey).map(item => item.replaceIncomeId));
  state.incomes.filter(item => !replacedIncomeIds.has(item.id)).forEach(item => { const occurrence = incomeOccurrence(item, date, holidays); if (occurrence) entries.push(occurrence); });
  monthExtras.forEach(item => entries.push({ kind: 'extra', id: item.id, name: item.name, value: Number(item.value) || 0, date: item.date, isIncome: true, memberId: item.memberId || 'primary', extraType: item.type || 'other', confidence: item.confidence || 'expected' }));
  state.commitments.forEach(item => { const occurrence = occurrenceForCommit(item, date); if (occurrence) entries.push(occurrence); });
  state.debts.filter(item => {
    if (Number(item.monthly) <= 0 || Number(item.balance) <= 0) return false;
    return !item.start || monthDistance(startOfMonth(localDate(item.start)), startOfMonth(date)) >= 0;
  }).forEach(item => entries.push({ kind: 'debt', id: item.id, name: `Acordo: ${item.name}`, value: Number(item.monthly), date: isoDate(date.getFullYear(), date.getMonth(), item.day), isIncome: false, memberId: item.memberId || 'primary' }));
  return entries.sort((a, b) => a.date.localeCompare(b.date));
}

export function stateForMember(state, memberId = 'all') {
  if (!memberId || memberId === 'all') return state;
  const filtered = { ...state, initialBalance: memberId === 'primary' ? Number(state.initialBalance || 0) : 0 };
  for (const key of ['incomes', 'commitments', 'debts', 'extras', 'goals', 'transactions']) {
    filtered[key] = state[key].filter(item => (item.memberId || 'primary') === memberId);
  }
  return filtered;
}

export function mergeStates(currentRaw, incomingRaw) {
  const current = migrateState(currentRaw);
  const incoming = migrateState(incomingRaw);
  const mergeCollection = (left, right) => {
    const records = new Map(left.map(item => [item.id, item]));
    right.forEach(item => {
      const existing = records.get(item.id);
      if (!existing || String(item.updatedAt || '') >= String(existing.updatedAt || '')) records.set(item.id, item);
    });
    return [...records.values()].filter(item => !item.deletedAt);
  };
  const sameHousehold = incoming.household?.id === current.household?.id;
  const incomingHouseholdIsNewer = String(incoming.household?.updatedAt || '') >= String(current.household?.updatedAt || '');
  const merged = {
    ...current,
    household: sameHousehold && incomingHouseholdIsNewer ? { ...current.household, ...incoming.household } : current.household
  };
  for (const key of ['members', 'incomes', 'commitments', 'debts', 'extras', 'goals', 'transactions']) merged[key] = mergeCollection(current[key], incoming[key]);
  return migrateState(merged);
}

export function entryStatus(state, entry, selectedMonth, today = new Date()) {
  if (linkedTransaction(state, entry.kind, entry.id, selectedMonth)) return 'paid';
  const selectedKey = monthKey(selectedMonth);
  const todayKey = monthKey(today);
  if (selectedKey < todayKey) return 'late';
  if (selectedKey > todayKey) return 'pending';
  const due = localDate(entry.date);
  const current = localDate(today);
  if (due < current) return 'late';
  return (due - current) / 86400000 <= 3 ? 'soon' : 'pending';
}

export function totalsForMonth(state, date) {
  const transactions = transactionForMonth(state, date);
  const entries = agendaEntries(state, date);
  const realizedIncome = transactions.filter(item => item.type === 'entrada').reduce((sum, item) => sum + Number(item.value || 0), 0);
  const realizedExpense = transactions.filter(item => item.type === 'saida').reduce((sum, item) => sum + Number(item.value || 0), 0);
  const pending = entries.filter(item => !linkedTransaction(state, item.kind, item.id, date));
  const pendingIncome = pending.filter(item => item.isIncome).reduce((sum, item) => sum + item.value, 0);
  const pendingExpense = pending.filter(item => !item.isIncome).reduce((sum, item) => sum + item.value, 0);
  const plannedIncome = entries.filter(item => item.isIncome).reduce((sum, item) => sum + item.value, 0);
  const plannedExpense = entries.filter(item => !item.isIncome).reduce((sum, item) => sum + item.value, 0);
  return { realizedIncome, realizedExpense, pendingIncome, pendingExpense, plannedIncome, plannedExpense, result: realizedIncome + pendingIncome - realizedExpense - pendingExpense };
}

export const cashNow = state => Number(state.initialBalance || 0) + state.transactions.reduce((sum, item) => sum + (item.type === 'entrada' ? 1 : -1) * Number(item.value || 0), 0);

export function nextIncomeDate(state, today = new Date()) {
  const candidates = [];
  for (let offset = 0; offset <= 2; offset += 1) {
    const month = addMonths(today, offset);
    agendaEntries(state, month).filter(item => item.isIncome).forEach(item => {
      if (localDate(item.date) > localDate(today)) candidates.push(localDate(item.date));
    });
  }
  return candidates.sort((a, b) => a - b)[0] || null;
}

export function reservedUntilNextIncome(state, today = new Date()) {
  const next = nextIncomeDate(state, today);
  if (!next) return totalsForMonth(state, today).pendingExpense;
  let total = 0;
  for (let offset = 0; offset <= 1; offset += 1) {
    const month = addMonths(today, offset);
    agendaEntries(state, month).filter(item => !item.isIncome && !linkedTransaction(state, item.kind, item.id, month)).forEach(item => {
      const due = localDate(item.date);
      if (due >= localDate(today) && due <= next) total += item.value;
    });
  }
  return total;
}

export function scoreHealth(state, date, today = new Date()) {
  const totals = totalsForMonth(state, date);
  if (!state.incomes.some(item => item.active !== false)) return 0;
  const income = Math.max(totals.plannedIncome, 1);
  const commitmentRate = totals.plannedExpense / income;
  const lateEntries = agendaEntries(state, date).filter(item => entryStatus(state, item, date, today) === 'late').length;
  const overdueDebt = state.debts.filter(item => ['Atrasado', 'Renegociar'].includes(item.status)).reduce((sum, item) => sum + Number(item.balance || 0), 0);
  const buffer = cashNow(state) - reservedUntilNextIncome(state, today);
  let score = 100;
  score -= Math.min(45, Math.max(0, commitmentRate - .5) * 70);
  score -= Math.min(20, lateEntries * 5);
  score -= Math.min(20, overdueDebt / Math.max(income, 1) * 15);
  if (buffer < 0) score -= 15; else if (buffer < income * .1) score -= 6;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function balancePoint(state, date, horizon = 12) {
  let cumulative = 0;
  for (let index = 0; index < horizon; index += 1) {
    const month = addMonths(date, index);
    const totals = totalsForMonth(state, month);
    cumulative += totals.plannedIncome - totals.plannedExpense;
    if (cumulative >= 0) return month;
  }
  return null;
}

export function releasedWithin(state, date, months) {
  const start = totalsForMonth(state, date).plannedExpense;
  const end = totalsForMonth(state, addMonths(date, months)).plannedExpense;
  return Math.max(0, start - end);
}
