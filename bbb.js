'use strict';

// localStorage 키와 데이터 구조 버전
const STORAGE_KEY = 'todoApp.tasks';
const VERSION_KEY = 'todoApp.version';
const SETTINGS_KEY = 'todoApp.settings';
const BACKUP_KEY = 'todoApp.backup';
const DATA_VERSION = 1;
// 카테고리 값 ↔ 한국어 이름 매핑 (화면의 모든 카테고리 표시는 이 상수를 사용)
const CATEGORIES = { work: '업무', personal: '개인', study: '공부' };
const DEFAULT_CATEGORY = 'work';
// 자동 분류용 키워드 (제목에 포함되면 해당 카테고리로 추천, 영문은 소문자로)
const CATEGORY_KEYWORDS = {
  work: ['회의', '미팅', '보고서', '보고', '메일', '출장', '업무', '기획', '프로젝트', '발표', '결재',
    '거래처', '고객', '제안서', '계약', '회사', '출근', '팀장', '야근', '마감', '견적'],
  personal: ['장보기', '마트', '운동', '헬스', '병원', '청소', '빨래', '설거지', '약속', '생일', '가족',
    '친구', '여행', '쇼핑', '요리', '산책', '은행', '택배', '이사', '미용실', '데이트'],
  study: ['공부', '시험', '과제', '강의', '수업', '인강', '독서', '책 읽기', '복습', '예습', '문제 풀이',
    '알고리즘', '영어', '수학', '자격증', '토익', '논문', '코딩', '단어', '스터디'],
};
// 상태 필터 값 ↔ 한국어 이름
const STATUS_FILTERS = { all: '전체', active: '진행 중', completed: '완료' };

// 할 일 목록 상태
let tasks = [];
// 설정(마지막 선택 카테고리, 필터 상태)
let settings = { lastCategory: DEFAULT_CATEGORY, filterCategory: 'all', filterStatus: 'all' };
// 수정 중인 항목 id(한 번에 하나만)와 입력 중인 값
let editingId = null;
let editDraft = null;
// 이번 입력 중에 사용자가 카테고리를 직접 골랐는지 (골랐으면 자동 분류 중지)
let categoryTouched = false;
// 다시 그린 뒤 포커스를 옮길 대상 ({ id, className } 또는 DOM 요소)
let pendingFocus = null;
// localStorage 사용 가능 여부
let storageAvailable = true;
// 상단 안내 문구 (종류별 하나씩, 없으면 null)
const notices = { storage: null, load: null, save: null };

// DOM 요소
const todayEl = document.getElementById('today');
const noticesEl = document.getElementById('notices');
const formEl = document.getElementById('task-form');
const titleInput = document.getElementById('task-title');
const categorySelect = document.getElementById('task-category');
const messageEl = document.getElementById('form-message');
const categoryHintEl = document.getElementById('category-hint');
const filtersEl = document.getElementById('filters');
const categoryTabsEl = document.getElementById('category-tabs');
const statusTabsEl = document.getElementById('status-tabs');
const listEl = document.getElementById('task-list');
const emptyEl = document.getElementById('empty-message');
const progressTextEl = document.getElementById('progress-text');
const progressBarEl = document.getElementById('progress-bar');
const progressFillEl = document.getElementById('progress-fill');
const progressCategoriesEl = document.getElementById('progress-categories');
const remainingEl = document.getElementById('remaining-count');
const clearCompletedBtn = document.getElementById('clear-completed');

// 고유 id 생성 (randomUUID 미지원 시 시간+난수 조합)
function createId() {
  if (window.crypto && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

// 객체에 해당 키가 있는지 확인
function hasKey(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

// 헤더에 오늘 날짜 표시
function showToday() {
  todayEl.textContent = new Date().toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });
}

// 제목 검사: 앞뒤 공백 제거 후 1~100자면 정리된 제목, 아니면 null
function normalizeTitle(value) {
  const title = String(value).trim();
  if (title.length === 0) return null;
  return title.slice(0, 100);
}

// 저장된 항목이 올바른 구조인지 확인
function isValidTask(t) {
  return t && typeof t.id === 'string' && typeof t.title === 'string' &&
    hasKey(CATEGORIES, t.category) && typeof t.completed === 'boolean' &&
    typeof t.createdAt === 'string';
}

// 저장 용량 초과 오류인지 판별 (브라우저마다 이름·코드가 다름)
function isQuotaError(e) {
  return e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    e.code === 22 || e.code === 1014);
}

// localStorage를 실제로 쓸 수 있는지 시험
function checkStorage() {
  try {
    const testKey = 'todoApp.__test__';
    localStorage.setItem(testKey, '1');
    localStorage.removeItem(testKey);
    return true;
  } catch (e) {
    // 용량 초과인데 이미 데이터가 있으면 "가득 찬 상태"로 보고 사용 가능 처리
    // (비어 있는데 용량 초과면 옛 Safari 사생활 보호 모드처럼 사용 불가)
    try {
      return isQuotaError(e) && localStorage.length > 0;
    } catch (err) {
      return false;
    }
  }
}

// 안전하게 값 읽기 (실패 시 null)
function readStorage(key) {
  if (!storageAvailable) return null;
  try {
    return localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}

// 안전하게 값 쓰기 (성공 여부와 오류 반환)
function writeStorage(key, value) {
  if (!storageAvailable) return { ok: false, error: null };
  try {
    localStorage.setItem(key, value);
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: e };
  }
}

// localStorage에서 할 일 불러오기 (깨진 데이터는 backup에 보관 후 빈 배열)
function loadTasks() {
  const raw = readStorage(STORAGE_KEY);
  if (raw === null) return [];

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    data = undefined;
  }

  if (!Array.isArray(data)) {
    writeStorage(BACKUP_KEY, raw);
    notices.load = '저장된 데이터가 손상되어 빈 목록으로 시작합니다. 원본은 "' + BACKUP_KEY + '"에 보관했습니다.';
    return [];
  }
  return data.filter(isValidTask);
}

// localStorage에 할 일과 버전 저장 (실패 시 안내 문구 설정)
function saveTasks() {
  if (!storageAvailable) return;
  const result = writeStorage(STORAGE_KEY, JSON.stringify(tasks));
  if (result.ok) {
    writeStorage(VERSION_KEY, String(DATA_VERSION));
    notices.save = null;
  } else if (isQuotaError(result.error)) {
    notices.save = '저장 공간이 부족해 저장하지 못했습니다. [완료 항목 지우기]로 완료한 할 일을 정리해 보세요.';
  } else {
    notices.save = '저장에 실패했습니다. 새로고침하면 최근 변경이 사라질 수 있습니다.';
  }
}

// 설정 불러오기 (값이 없거나 이상하면 기본값)
function loadSettings() {
  const raw = readStorage(SETTINGS_KEY);
  if (raw === null) return;
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return;
  }
  if (!data || typeof data !== 'object') return;
  if (hasKey(CATEGORIES, data.lastCategory)) settings.lastCategory = data.lastCategory;
  if (data.filterCategory === 'all' || hasKey(CATEGORIES, data.filterCategory)) {
    settings.filterCategory = data.filterCategory;
  }
  if (hasKey(STATUS_FILTERS, data.filterStatus)) settings.filterStatus = data.filterStatus;
}

// 설정 저장
function saveSettings() {
  writeStorage(SETTINGS_KEY, JSON.stringify(settings));
}

// 카테고리 select에 CATEGORIES 기준으로 옵션 채우기
function fillCategoryOptions(select) {
  Object.keys(CATEGORIES).forEach(function (key) {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = CATEGORIES[key];
    select.appendChild(option);
  });
}

// 필터 탭 버튼 생성 (카테고리: 전체 + CATEGORIES, 상태: STATUS_FILTERS)
function buildFilterTabs() {
  const categoryOptions = Object.assign({ all: '전체' }, CATEGORIES);
  Object.keys(categoryOptions).forEach(function (key) {
    categoryTabsEl.appendChild(createFilterButton('category', key, categoryOptions[key]));
  });
  Object.keys(STATUS_FILTERS).forEach(function (key) {
    statusTabsEl.appendChild(createFilterButton('status', key, STATUS_FILTERS[key]));
  });
}

// 필터 버튼 하나 생성
function createFilterButton(type, value, label) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'filter-btn';
  btn.dataset.filterType = type;
  btn.dataset.value = value;
  btn.textContent = label;
  return btn;
}

// 데이터 변경 후 저장과 화면 갱신을 함께 처리
function commit() {
  saveTasks();
  render();
}

// 새 할 일 추가
function addTask(title, category) {
  const now = new Date().toISOString();
  tasks.unshift({
    id: createId(),
    title: title,
    category: category,
    completed: false,
    createdAt: now,
    updatedAt: now,
  });
  commit();
}

// 할 일 일부 값 변경 (updatedAt 갱신)
function updateTask(id, changes) {
  const task = tasks.find(function (t) { return t.id === id; });
  if (!task) return;
  Object.assign(task, changes, { updatedAt: new Date().toISOString() });
  commit();
}

// 할 일 삭제
function deleteTask(id) {
  tasks = tasks.filter(function (t) { return t.id !== id; });
  if (editingId === id) {
    editingId = null;
    editDraft = null;
  }
  commit();
}

// 완료/미완료 전환
function toggleTask(id) {
  const task = tasks.find(function (t) { return t.id === id; });
  if (!task) return;
  updateTask(id, { completed: !task.completed });
}

// 완료 항목 일괄 삭제
function clearCompleted() {
  const editingTask = tasks.find(function (t) { return t.id === editingId; });
  if (editingTask && editingTask.completed) {
    editingId = null;
    editDraft = null;
  }
  tasks = tasks.filter(function (t) { return !t.completed; });
  commit();
}

// 정렬: 미완료 위, 완료 아래 / 같은 그룹은 최신 항목이 위
function getSortedTasks() {
  return tasks.slice().sort(function (a, b) {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    if (a.createdAt === b.createdAt) return 0;
    return a.createdAt < b.createdAt ? 1 : -1;
  });
}

// 카테고리·상태 필터를 함께 적용한 목록
function getVisibleTasks() {
  return getSortedTasks().filter(function (task) {
    const categoryOk = settings.filterCategory === 'all' || task.category === settings.filterCategory;
    const statusOk = settings.filterStatus === 'all' ||
      (settings.filterStatus === 'active' && !task.completed) ||
      (settings.filterStatus === 'completed' && task.completed);
    return categoryOk && statusOk;
  });
}

// 버튼 요소 생성 (ariaLabel은 속성값으로만 넣으므로 사용자 입력이어도 안전)
function createButton(className, label, ariaLabel) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.textContent = label;
  if (ariaLabel) btn.setAttribute('aria-label', ariaLabel);
  return btn;
}

// 일반 모드 항목 DOM 생성 (제목은 textContent로 출력)
function createTaskItem(task) {
  const li = document.createElement('li');
  li.className = 'task-item' + (task.completed ? ' completed' : '');
  li.dataset.id = task.id;
  const name = "'" + task.title + "'";

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'toggle-checkbox';
  checkbox.checked = task.completed;
  checkbox.setAttribute('aria-label', name + ' 완료');

  const badge = document.createElement('span');
  badge.className = 'badge badge-' + task.category;
  badge.textContent = CATEGORIES[task.category];

  const title = document.createElement('span');
  title.className = 'task-title';
  title.textContent = task.title;

  li.append(
    checkbox, badge, title,
    createButton('edit-btn', '수정', name + ' 수정'),
    createButton('delete-btn', '삭제', name + ' 삭제')
  );
  return li;
}

// 수정 모드 항목 DOM 생성 (입력창 + 카테고리 + 저장/취소)
function createEditItem(task) {
  const li = document.createElement('li');
  li.className = 'task-item editing';
  li.dataset.id = task.id;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'edit-title';
  input.maxLength = 100;
  input.value = editDraft.title;
  input.setAttribute('aria-label', '할 일 제목 수정');

  const select = document.createElement('select');
  select.className = 'edit-category';
  fillCategoryOptions(select);
  select.value = editDraft.category;
  select.setAttribute('aria-label', '카테고리 수정');

  const message = document.createElement('p');
  message.className = 'edit-message';
  message.setAttribute('role', 'alert');

  li.append(
    input, select,
    createButton('save-btn', '저장', '수정 내용 저장'),
    createButton('cancel-btn', '취소', '수정 취소'),
    message
  );
  return li;
}

// 전체·카테고리별 완료 현황 계산 (완료율은 소수점 버림, 0개면 0%)
function getProgress() {
  const byCategory = {};
  Object.keys(CATEGORIES).forEach(function (key) {
    byCategory[key] = { done: 0, total: 0 };
  });

  let done = 0;
  tasks.forEach(function (task) {
    byCategory[task.category].total += 1;
    if (task.completed) {
      byCategory[task.category].done += 1;
      done += 1;
    }
  });

  const total = tasks.length;
  const percent = total === 0 ? 0 : Math.floor((done / total) * 100);
  return { total: total, done: done, percent: percent, byCategory: byCategory };
}

// 진행률 영역 갱신 (필터와 무관하게 전체 기준)
function renderProgress() {
  const p = getProgress();
  const text = p.percent + '% · ' + p.total + '개 중 ' + p.done + '개 완료';
  // 값이 바뀔 때만 갱신해 aria-live가 같은 내용을 반복해서 읽지 않게 함
  if (progressTextEl.textContent !== text) progressTextEl.textContent = text;
  progressBarEl.setAttribute('aria-valuenow', String(p.percent));
  progressFillEl.style.width = p.percent + '%';
  progressCategoriesEl.textContent = Object.keys(CATEGORIES).map(function (key) {
    const c = p.byCategory[key];
    return CATEGORIES[key] + ' ' + c.done + '/' + c.total;
  }).join(' · ');
}

// 상단 안내 문구 갱신
function renderNotices() {
  noticesEl.replaceChildren();
  Object.keys(notices).forEach(function (key) {
    if (!notices[key]) return;
    const p = document.createElement('p');
    p.className = 'notice notice-' + key;
    p.textContent = notices[key];
    noticesEl.appendChild(p);
  });
}

// 필터 버튼 선택 상태 갱신
function renderFilters() {
  filtersEl.querySelectorAll('.filter-btn').forEach(function (btn) {
    const current = btn.dataset.filterType === 'category' ? settings.filterCategory : settings.filterStatus;
    const active = btn.dataset.value === current;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
}

// 하단 영역 갱신 (남은 개수, 완료 항목 지우기 버튼)
function renderFooter() {
  const remaining = tasks.filter(function (t) { return !t.completed; }).length;
  remainingEl.textContent = '남은 할 일 ' + remaining + '개';
  clearCompletedBtn.disabled = remaining === tasks.length;
}

// tasks 배열을 기준으로 화면 전체 다시 그리기
function render() {
  renderNotices();
  renderProgress();
  renderFilters();

  const visible = getVisibleTasks();
  listEl.replaceChildren();
  visible.forEach(function (task) {
    const isEditing = task.id === editingId;
    listEl.appendChild(isEditing ? createEditItem(task) : createTaskItem(task));
  });

  if (tasks.length === 0) {
    emptyEl.textContent = '할 일을 추가해 보세요';
  } else if (visible.length === 0) {
    emptyEl.textContent = '해당하는 할 일이 없습니다';
  }
  emptyEl.hidden = visible.length > 0;

  renderFooter();
  applyPendingFocus();
}

// 목록에서 id가 같은 항목 요소 찾기 (선택자에 id를 넣지 않아 특수문자에도 안전)
function findItemElement(id) {
  return Array.prototype.find.call(listEl.children, function (li) {
    return li.dataset.id === id;
  }) || null;
}

// 다시 그린 뒤 키보드 포커스 복원 (없으면 입력창으로)
function applyPendingFocus() {
  if (!pendingFocus) return;
  const target = pendingFocus;
  pendingFocus = null;

  let el = null;
  if (target instanceof Element) {
    el = target;
  } else {
    const item = findItemElement(target.id);
    el = item ? item.querySelector('.' + target.className) : null;
  }
  if (!el || el.disabled) el = titleInput;

  el.focus();
  if (el.classList.contains('edit-title')) {
    el.setSelectionRange(el.value.length, el.value.length);
  }
}

// 삭제 후 포커스를 줄 이웃 항목 id (다음 항목, 없으면 이전 항목)
function getNeighborId(id) {
  const visible = getVisibleTasks();
  const index = visible.findIndex(function (t) { return t.id === id; });
  const neighbor = visible[index + 1] || visible[index - 1];
  return neighbor ? neighbor.id : null;
}

// 수정 모드 시작 (다른 항목 수정 중이면 그 수정은 취소됨)
function startEdit(id) {
  const task = tasks.find(function (t) { return t.id === id; });
  if (!task) return;
  editingId = id;
  editDraft = { title: task.title, category: task.category };
  pendingFocus = { id: id, className: 'edit-title' };
  render();
}

// 수정 취소 (원래 값으로 복원)
function cancelEdit() {
  pendingFocus = { id: editingId, className: 'edit-btn' };
  editingId = null;
  editDraft = null;
  render();
}

// 수정 내용 저장 (제목 규칙은 추가와 동일)
function saveEdit(item) {
  const title = normalizeTitle(editDraft.title);
  if (title === null) {
    item.querySelector('.edit-message').textContent = '할 일을 입력하세요';
    item.querySelector('.edit-title').focus();
    return;
  }
  const id = editingId;
  const category = editDraft.category;
  editingId = null;
  editDraft = null;
  pendingFocus = { id: id, className: 'edit-btn' };
  updateTask(id, { title: title, category: category });
}

// 새 항목이 현재 필터에 가려지면 해당 필터를 '전체'로 바꿈 (추가한 항목이 맨 위에 보이도록)
function revealNewTask(category) {
  let changed = false;
  if (settings.filterCategory !== 'all' && settings.filterCategory !== category) {
    settings.filterCategory = 'all';
    changed = true;
  }
  if (settings.filterStatus === 'completed') {
    settings.filterStatus = 'all';
    changed = true;
  }
  if (changed) saveSettings();
}

// 추가 폼 제출 처리 (버튼 클릭·Enter 모두)
function handleSubmit(event) {
  event.preventDefault();
  const title = normalizeTitle(titleInput.value);

  if (title === null) {
    messageEl.textContent = '할 일을 입력하세요';
    titleInput.focus();
    return;
  }

  const category = categorySelect.value;
  messageEl.textContent = '';
  titleInput.value = '';
  revealNewTask(category);
  addTask(title, category);
  resetAutoCategory();
  titleInput.focus();
}

// 제목에서 키워드를 찾아 카테고리 추천 (많이 맞은 쪽, 같으면 제목 앞쪽에 나온 쪽 / 없으면 null)
function classifyTitle(title) {
  const text = String(title).toLowerCase();
  let best = null;
  Object.keys(CATEGORY_KEYWORDS).forEach(function (category) {
    let count = 0;
    let firstIndex = Infinity;
    CATEGORY_KEYWORDS[category].forEach(function (keyword) {
      const index = text.indexOf(keyword);
      if (index === -1) return;
      count += 1;
      firstIndex = Math.min(firstIndex, index);
    });
    if (count === 0) return;
    if (!best || count > best.count || (count === best.count && firstIndex < best.firstIndex)) {
      best = { category: category, count: count, firstIndex: firstIndex };
    }
  });
  return best ? best.category : null;
}

// 자동 분류 안내 문구 표시 (없으면 숨김)
function showCategoryHint(category) {
  categoryHintEl.textContent = category ? '자동 분류: ' + CATEGORIES[category] : '';
}

// 제목 입력 시 자동 분류 (직접 고른 경우는 건드리지 않음, 키워드가 없으면 기본 카테고리로)
function handleTitleInput() {
  if (categoryTouched) return;
  const category = classifyTitle(titleInput.value);
  categorySelect.value = category || settings.lastCategory;
  showCategoryHint(category);
}

// 추가 후 자동 분류 상태 초기화 (카테고리는 마지막 선택값으로 되돌림)
function resetAutoCategory() {
  categoryTouched = false;
  categorySelect.value = settings.lastCategory;
  showCategoryHint(null);
}

// 입력 영역 카테고리 변경 시 마지막 선택으로 저장 (제목 입력 중이면 자동 분류 중지)
function handleCategoryChange() {
  settings.lastCategory = categorySelect.value;
  saveSettings();
  categoryTouched = titleInput.value.trim() !== '';
  showCategoryHint(null);
}

// 필터 버튼 클릭 처리 (이벤트 위임)
function handleFilterClick(event) {
  const btn = event.target.closest('.filter-btn');
  if (!btn) return;
  if (btn.dataset.filterType === 'category') {
    settings.filterCategory = btn.dataset.value;
  } else {
    settings.filterStatus = btn.dataset.value;
  }
  saveSettings();
  render();
}

// 완료 항목 지우기 버튼 처리
function handleClearCompleted() {
  const count = tasks.filter(function (t) { return t.completed; }).length;
  if (count === 0) return;
  if (confirm('완료한 할 일 ' + count + '개를 삭제할까요?')) {
    pendingFocus = titleInput;
    clearCompleted();
  }
}

// 목록 클릭 처리 (이벤트 위임)
function handleListClick(event) {
  const item = event.target.closest('.task-item');
  if (!item) return;
  const id = item.dataset.id;
  const cls = event.target.classList;

  if (cls.contains('toggle-checkbox')) {
    pendingFocus = { id: id, className: 'toggle-checkbox' };
    toggleTask(id);
  } else if (cls.contains('edit-btn')) {
    startEdit(id);
  } else if (cls.contains('delete-btn')) {
    if (confirm('이 할 일을 삭제할까요?')) {
      const neighborId = getNeighborId(id);
      pendingFocus = neighborId ? { id: neighborId, className: 'delete-btn' } : titleInput;
      deleteTask(id);
    }
  } else if (cls.contains('save-btn')) {
    saveEdit(item);
  } else if (cls.contains('cancel-btn')) {
    cancelEdit();
  }
}

// 제목 더블클릭 시 수정 모드 (이벤트 위임)
function handleListDblClick(event) {
  if (!event.target.classList.contains('task-title')) return;
  startEdit(event.target.closest('.task-item').dataset.id);
}

// 수정 중 입력값을 draft에 반영 (다시 그려도 입력 내용 유지)
function handleListInput(event) {
  if (!editDraft) return;
  if (event.target.classList.contains('edit-title')) {
    editDraft.title = event.target.value;
  } else if (event.target.classList.contains('edit-category')) {
    editDraft.category = event.target.value;
  }
}

// 수정 모드 키 처리: Enter = 저장, Esc = 취소 (버튼 위 Enter는 버튼 기본 동작에 맡김)
function handleListKeydown(event) {
  const item = event.target.closest('.task-item.editing');
  if (!item || event.isComposing) return;
  if (event.key === 'Enter' && event.target.tagName !== 'BUTTON') {
    event.preventDefault();
    saveEdit(item);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    cancelEdit();
  }
}

// 초기화: 저장소 확인 → 데이터·설정 불러오기 → 화면 그리기
function init() {
  showToday();

  storageAvailable = checkStorage();
  if (!storageAvailable) {
    notices.storage = '저장이 되지 않습니다. 새로고침하면 데이터가 사라집니다';
  }

  tasks = loadTasks();
  loadSettings();

  fillCategoryOptions(categorySelect);
  categorySelect.value = settings.lastCategory;
  buildFilterTabs();

  formEl.addEventListener('submit', handleSubmit);
  titleInput.addEventListener('input', handleTitleInput);
  categorySelect.addEventListener('change', handleCategoryChange);
  filtersEl.addEventListener('click', handleFilterClick);
  clearCompletedBtn.addEventListener('click', handleClearCompleted);
  listEl.addEventListener('click', handleListClick);
  listEl.addEventListener('dblclick', handleListDblClick);
  listEl.addEventListener('input', handleListInput);
  listEl.addEventListener('change', handleListInput);
  listEl.addEventListener('keydown', handleListKeydown);
  render();
}

init();
