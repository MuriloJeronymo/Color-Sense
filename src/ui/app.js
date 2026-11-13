const api = window.colorSenseAPI;

const FILTERS = [
  { key: 'normal',         label: 'Normal',         desc: 'Sem filtro' },
  { key: 'protanopia',     label: 'Protanopia',     desc: 'Deficiência em vermelho' },
  { key: 'protanomalia',   label: 'Protanomalia',   desc: 'Leve — vermelho' },
  { key: 'deuteranopia',   label: 'Deuteranopia',   desc: 'Deficiência em verde' },
  { key: 'deuteranomalia', label: 'Deuteranomalia', desc: 'Leve — verde' },
  { key: 'tritanopia',     label: 'Tritanopia',     desc: 'Deficiência em azul' },
  { key: 'tritanomalia',   label: 'Tritanomalia',   desc: 'Leve — azul' },
  { key: 'achromatopsia',  label: 'Acromatopsia',   desc: 'Sem percepção de cor' }
];

const PATTERNS = [
  { key: 'diagonal',   label: 'Diagonal'    },
  { key: 'crosshatch', label: 'Hachura'     },
  { key: 'horizontal', label: 'Horizontal'  },
  { key: 'vertical',   label: 'Vertical'    },
  { key: 'dots',       label: 'Pontos'      },
  { key: 'zigzag',     label: 'Zigzag'      }
];

// Tipos com correção por filtro (acromatopsia não tem canal para redistribuir)
const CORRECTABLE = ['protanopia', 'protanomalia', 'deuteranopia', 'deuteranomalia', 'tritanopia', 'tritanomalia'];

// Pares de teste da calibração (M2): combinações que costumam se confundir em
// cada eixo de deficiência. O filtro é aplicado sobre esta tela em tempo real.
const CALIBRATION_PAIRS = {
  redGreen: [
    { a: '#d62728', b: '#2ca02c', label: 'Linhas de gráfico' },
    { a: '#e05c7a', b: '#4caf8a', label: 'Erro e sucesso' },
    { a: '#c0392b', b: '#7f8c2a', label: 'Falhou e aprovado' },
    { a: '#8c564b', b: '#556b2f', label: 'Marrom e oliva' },
    { a: '#ff7f0e', b: '#7fbf3f', label: 'Laranja e verde-claro' }
  ],
  blueYellow: [
    { a: '#0072b2', b: '#009e73', label: 'Azul e verde' },
    { a: '#f0e442', b: '#d9d9d9', label: 'Amarelo e cinza claro' },
    { a: '#f0e442', b: '#cc79a7', label: 'Amarelo e rosa' },
    { a: '#56b4e9', b: '#7fbf7f', label: 'Azul-claro e verde-claro' },
    { a: '#6a3d9a', b: '#1f4e9a', label: 'Roxo e azul' }
  ]
};

const VERDICTS = {
  ok:      { icon: '✓', text: 'Distinguíveis' },
  caution: { icon: '!', text: 'Atenção' },
  hard:    { icon: '✗', text: 'Difíceis de distinguir' }
};

// ── Estado ────────────────────────────────────────────────────────────────────

const state = {
  prefs: {},
  scenes: [],
  user: null,
  view: 'filter',       // 'filter' | 'scenes' | 'creator' | 'edit' | 'calibrate'
  editingScene: null,
  editingRuleId: null,  // id da regra em edição (null = formulário de nova regra)
  sim: { active: false, type: 'protanopia' },
  status: { mode: 'off', icon: '○', text: 'Desligado' },
  shortcuts: [],
  // Verificador de cores do modo Criador (M1)
  checker: {
    c1: { hex: '#d62728', name: '' },
    c2: { hex: '#2ca02c', name: '' },
    result: null
  },
  // Calibração do filtro (M2)
  calib: { type: 'deuteranopia', intensity: 1, checked: [] }
};

// ── Refs fixos ────────────────────────────────────────────────────────────────

const contentEl    = document.getElementById('content');
const tabsEl       = document.getElementById('tabs');
const statusBadge  = document.getElementById('status-badge');
const userNameEl   = document.getElementById('user-name');
const globalToggle = document.getElementById('global-toggle');

// ── Render principal ──────────────────────────────────────────────────────────

function render() {
  const subView = state.view === 'edit' || state.view === 'calibrate';
  tabsEl.style.display = subView ? 'none' : 'flex';
  document.querySelectorAll('.tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === state.view)
  );

  if (state.view === 'filter')         renderFilter();
  else if (state.view === 'scenes')    renderScenes();
  else if (state.view === 'creator')   renderCreator();
  else if (state.view === 'edit')      renderEdit();
  else if (state.view === 'calibrate') renderCalibrate();

  updateGlobalControls();
}

// Indicador de estado (M4): símbolo + texto, não só a cor do selo
function updateGlobalControls() {
  globalToggle.checked    = state.prefs.filterActive || false;
  statusBadge.textContent = `${state.status.icon} ${state.status.text}`;
  statusBadge.title       = state.status.text;
  statusBadge.className   = 'badge badge-' + state.status.mode;
}

// ── View: Filtro ──────────────────────────────────────────────────────────────

function renderFilter() {
  const activeScene = state.scenes.find(s => s.id === state.prefs.activeSceneId);
  const filterLabel = FILTERS.find(f => f.key === state.prefs.filterType)?.label || 'Normal';
  const intPct      = Math.round((state.prefs.intensity ?? 1) * 100);

  contentEl.innerHTML = `
    ${activeScene ? `
    <div class="card profile-banner">
      <div class="profile-banner-row">
        <div>
          <p class="label">${activeScene.name}</p>
          <p class="sublabel">Cena ativa · ${filterLabel}</p>
        </div>
        <button class="btn-sm" id="btn-switch">Trocar cena</button>
      </div>
    </div>` : ''}

    <section class="card">
      <p class="section-title">Tipo de Daltonismo</p>
      <div class="filter-grid" id="filter-grid"></div>
    </section>

    <section class="card">
      <p class="section-title">Intensidade do Filtro</p>
      <div class="slider-row">
        <input type="range" id="intensity-slider" min="0" max="200" step="5" value="${intPct}">
        <span id="intensity-value" class="slider-value">${intPct}%</span>
      </div>
      <p class="hint-text">100% é a correção padrão. Acima disso, a correção fica mais forte.</p>
    </section>

    <section class="card">
      <div class="toggle-row">
        <div>
          <p class="label">Calibrar filtro</p>
          <p class="sublabel">Ajuste o tipo e a intensidade com uma imagem de teste.</p>
        </div>
        <button class="btn-sm btn-primary" id="btn-calibrate">Calibrar</button>
      </div>
    </section>

    <section class="card">
      <p class="section-title">Acesso rápido</p>
      <ul class="shortcut-list">
        ${state.shortcuts.map(s => `
          <li>
            <span class="kbd">${s.label}</span>
            <span>${s.description}${s.ok ? '' : ' <em>(indisponível: atalho usado por outro programa)</em>'}</span>
          </li>`).join('')}
        <li><span class="kbd">Clique</span><span>no ícone da bandeja: liga/desliga o filtro</span></li>
      </ul>
    </section>
  `;

  const grid = document.getElementById('filter-grid');
  FILTERS.forEach(f => {
    const btn = document.createElement('button');
    btn.className = 'filter-btn' + (f.key === state.prefs.filterType ? ' active' : '');
    btn.dataset.key = f.key;
    btn.innerHTML = `<span class="btn-label">${f.label}</span><span class="btn-desc">${f.desc}</span>`;
    btn.addEventListener('click', async () => {
      state.prefs = await api.setFilterType(f.key);
      render();
    });
    grid.appendChild(btn);
  });

  document.getElementById('btn-switch')?.addEventListener('click', () => switchTab('scenes'));
  document.getElementById('btn-calibrate').addEventListener('click', openCalibration);

  const slider   = document.getElementById('intensity-slider');
  const intLabel = document.getElementById('intensity-value');
  slider.addEventListener('input', () => { intLabel.textContent = slider.value + '%'; });
  slider.addEventListener('change', async () => {
    state.prefs = await api.savePreferences({ intensity: slider.value / 100 });
  });
}

// ── View: Calibração do filtro (M2) ───────────────────────────────────────────

function calibrationPairs() {
  return state.calib.type.startsWith('trit') ? CALIBRATION_PAIRS.blueYellow : CALIBRATION_PAIRS.redGreen;
}

async function openCalibration() {
  state.calib = {
    type: CORRECTABLE.includes(state.prefs.filterType) ? state.prefs.filterType : 'deuteranopia',
    intensity: state.prefs.intensity ?? 1,
    checked: []
  };
  state.view = 'calibrate';
  render();
  await api.previewCalibration(state.calib.type, state.calib.intensity);
}

async function closeCalibration(save) {
  state.prefs = await api.endCalibration(save);
  state.view = 'filter';
  render();
}

function renderCalibrate() {
  const { type, intensity, checked } = state.calib;
  const pairs  = calibrationPairs();
  const pct    = Math.round(intensity * 100);
  const nOk    = checked.length;
  const allOk  = nOk === pairs.length;

  contentEl.innerHTML = `
    <div class="edit-header">
      <button class="btn-back" id="btn-back">← Filtro</button>
      <p class="edit-title">Calibrar filtro</p>
    </div>

    <p class="hint-text">
      O filtro está sendo aplicado a esta tela em tempo real. Escolha o tipo e
      ajuste a intensidade até conseguir distinguir as duas cores de cada par.
    </p>

    <section class="card">
      <p class="section-title">1. Tipo de daltonismo</p>
      <div class="filter-grid" id="calib-types"></div>
    </section>

    <section class="card">
      <p class="section-title">2. Intensidade</p>
      <div class="slider-row">
        <input type="range" id="calib-intensity" min="0" max="200" step="5" value="${pct}">
        <span id="calib-intensity-value" class="slider-value">${pct}%</span>
      </div>
    </section>

    <section class="card">
      <p class="section-title">3. Você distingue as cores de cada par?</p>
      <div class="calib-pairs">
        ${pairs.map((p, i) => `
          <label class="calib-pair">
            <span class="calib-swatches">
              <span class="calib-swatch" style="background:${p.a}"></span>
              <span class="calib-swatch" style="background:${p.b}"></span>
            </span>
            <span class="calib-pair-label">${i + 1}. ${p.label}</span>
            <input type="checkbox" data-pair="${i}" ${checked.includes(i) ? 'checked' : ''}>
            <span class="calib-check-text">Distingo</span>
          </label>`).join('')}
      </div>
      <p class="calib-progress">
        ${allOk ? '✓ ' : ''}${nOk} de ${pairs.length} pares distinguíveis
      </p>
      ${!allOk && pct >= 200 ? `
        <p class="hint-text">Mesmo no máximo alguns pares continuam iguais? Experimente outro tipo,
        por exemplo protan em vez de deutan.</p>` : ''}
    </section>

    <div class="form-actions">
      <button class="btn-sm" id="btn-calib-cancel">Cancelar</button>
      <button class="btn-sm btn-primary" id="btn-calib-save">Salvar calibração</button>
    </div>
  `;

  const grid = document.getElementById('calib-types');
  FILTERS.filter(f => CORRECTABLE.includes(f.key)).forEach(f => {
    const btn = document.createElement('button');
    btn.className = 'filter-btn' + (f.key === type ? ' active' : '');
    btn.innerHTML = `<span class="btn-label">${f.label}</span><span class="btn-desc">${f.desc}</span>`;
    btn.addEventListener('click', async () => {
      state.calib.type = f.key;
      state.calib.checked = [];   // novo tipo: o teste recomeça
      renderCalibrate();
      await api.previewCalibration(f.key, state.calib.intensity);
    });
    grid.appendChild(btn);
  });

  const slider = document.getElementById('calib-intensity');
  let previewTimer = null;
  slider.addEventListener('input', () => {
    state.calib.intensity = slider.value / 100;
    document.getElementById('calib-intensity-value').textContent = slider.value + '%';
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => api.previewCalibration(state.calib.type, state.calib.intensity), 60);
  });
  slider.addEventListener('change', () => renderCalibrate());

  contentEl.querySelectorAll('[data-pair]').forEach(cb => {
    cb.addEventListener('change', () => {
      const i = Number(cb.dataset.pair);
      state.calib.checked = cb.checked
        ? [...state.calib.checked, i]
        : state.calib.checked.filter(n => n !== i);
      renderCalibrate();
    });
  });

  document.getElementById('btn-back').addEventListener('click', () => closeCalibration(false));
  document.getElementById('btn-calib-cancel').addEventListener('click', () => closeCalibration(false));
  document.getElementById('btn-calib-save').addEventListener('click', () => closeCalibration(true));
}

// ── View: Cenas ───────────────────────────────────────────────────────────────

function renderScenes() {
  const activeId = state.prefs.activeSceneId;

  contentEl.innerHTML = `
    <div class="profiles-header">
      <p class="section-title" style="margin:0">Minhas Cenas</p>
      <button class="btn-sm btn-primary" id="btn-new">+ Nova</button>
    </div>
    <div id="scene-list">
      ${state.scenes.length === 0
        ? '<p class="empty-state">Nenhuma cena ainda.<br>Clique em "+ Nova" para criar.</p>'
        : state.scenes.map(s => sceneCardHTML(s, activeId)).join('')}
    </div>
  `;

  document.getElementById('btn-new').addEventListener('click', () => openEdit(null));

  state.scenes.forEach(s => {
    document.getElementById(`btn-activate-${s.id}`)
      ?.addEventListener('click', () => activateScene(s));
    document.getElementById(`btn-edit-${s.id}`)
      .addEventListener('click', () => openEdit(s));
    document.getElementById(`btn-delete-${s.id}`)
      ?.addEventListener('click', () => removeScene(s));
  });
}

function sceneCardHTML(s, activeId) {
  const isActive    = s.id === activeId;
  const filterLabel = FILTERS.find(f => f.key === s.filter_type)?.label || s.filter_type;
  const rulesCount  = s.pattern_rules?.length ?? 0;

  return `
    <div class="card profile-card ${isActive ? 'profile-active' : ''}">
      <div class="profile-card-top">
        <div class="profile-card-info">
          <p class="profile-name">${s.name}</p>
          <div class="profile-meta">
            <span class="chip">${filterLabel}</span>
            ${rulesCount > 0 ? `<span class="chip chip-rules">${rulesCount} regra${rulesCount > 1 ? 's' : ''}</span>` : ''}
            ${isActive ? '<span class="chip chip-active">Ativa</span>' : ''}
          </div>
        </div>
      </div>
      <div class="profile-card-actions">
        ${!isActive ? `<button class="btn-sm btn-primary" id="btn-activate-${s.id}">Ativar</button>` : ''}
        <button class="btn-sm" id="btn-edit-${s.id}">Editar</button>
        ${!s.is_default ? `<button class="btn-sm btn-danger" id="btn-delete-${s.id}">Excluir</button>` : ''}
      </div>
    </div>
  `;
}

async function activateScene(scene) {
  state.prefs = await api.activateScene(scene.id, scene.filter_type, scene.pattern_rules || []);
  render();
}

async function removeScene(scene) {
  if (!confirm(`Excluir a cena "${scene.name}"?`)) return;
  await api.deleteScene(scene.id);
  if (state.prefs.activeSceneId === scene.id)
    state.prefs = await api.savePreferences({ activeSceneId: null });
  state.scenes = await api.getScenes();
  render();
}

// ── View: Criador (simulação para designers/devs) ─────────────────────────────

function renderCreator() {
  const simTypes = FILTERS.filter(f => f.key !== 'normal');
  const active   = state.sim.active;
  const curLabel = FILTERS.find(f => f.key === state.sim.type)?.label || '';

  contentEl.innerHTML = `
    <section class="card creator-intro">
      <p class="label">Modo Criador</p>
      <p class="sublabel">
        Simule como pessoas com daltonismo enxergam sua tela.
        Ative a simulação e abra seu design, site ou app para validar as cores.
      </p>
    </section>

    <section class="card">
      <div class="toggle-row">
        <div>
          <p class="label">Simulação de daltonismo</p>
          <p class="sublabel" id="sim-status">
            ${active ? `Simulando: ${curLabel}` : 'Desativada'}
          </p>
        </div>
        <label class="switch">
          <input type="checkbox" id="sim-toggle" ${active ? 'checked' : ''}>
          <span class="slider"></span>
        </label>
      </div>
    </section>

    <section class="card">
      <p class="section-title">Tipo de daltonismo a simular</p>
      <div class="filter-grid" id="sim-grid"></div>
    </section>

    <p class="creator-hint">
      A simulação afeta toda a tela e tem prioridade sobre o filtro de correção.
      Os padrões visuais ficam ocultos enquanto ela está ativa.
    </p>

    <section class="card">
      <p class="section-title">Verificador de cores</p>
      <p class="sublabel">
        Capture duas cores da tela (texto e fundo, ou duas séries de um gráfico)
        para conferir o contraste mínimo da WCAG e se elas continuam
        distinguíveis para cada tipo de daltonismo.
      </p>
      <div class="checker-colors">
        ${checkerSlotHTML('c1', 'Cor 1 · texto ou elemento')}
        ${checkerSlotHTML('c2', 'Cor 2 · fundo ou outro elemento')}
      </div>
      <div id="checker-result">${checkerResultHTML()}</div>
    </section>
  `;

  const grid = document.getElementById('sim-grid');
  simTypes.forEach(f => {
    const btn = document.createElement('button');
    btn.className = 'filter-btn' + (f.key === state.sim.type ? ' active' : '');
    btn.dataset.key = f.key;
    btn.innerHTML = `<span class="btn-label">${f.label}</span><span class="btn-desc">${f.desc}</span>`;
    btn.addEventListener('click', async () => {
      state.sim = await api.setSimType(f.key);
      renderCreator();
    });
    grid.appendChild(btn);
  });

  document.getElementById('sim-toggle').addEventListener('change', async (e) => {
    state.sim = await api.toggleSim(e.target.checked);
    renderCreator();
  });

  bindCheckerEvents();
  if (!state.checker.result) updateChecker();
}

// ── Verificador de cores (M1) ─────────────────────────────────────────────────

function checkerSlotHTML(slot, title) {
  const c = state.checker[slot];
  return `
    <div class="checker-slot">
      <p class="checker-slot-title">${title}</p>
      <div class="color-input-row">
        <input type="color" id="${slot}-color" value="${c.hex}">
        <span class="checker-hex">${c.hex}</span>
      </div>
      <p class="color-name">${c.name ? '≈ ' + c.name : ''}</p>
      <button class="btn-sm btn-pick" id="${slot}-pick">⌖ Capturar da tela</button>
    </div>
  `;
}

const fmt = (n, digits = 2) => n.toFixed(digits).replace('.', ',');

function passFailHTML(passes, label) {
  return `
    <div class="check-row ${passes ? 'check-pass' : 'check-fail'}">
      <span class="check-icon">${passes ? '✓' : '✗'}</span>
      <span class="check-verdict">${passes ? 'Aprovado' : 'Reprovado'}</span>
      <span class="check-label">${label}</span>
    </div>
  `;
}

function checkerResultHTML() {
  const r = state.checker.result;
  if (!r) return '';

  return `
    <div class="checker-contrast">
      <span class="sublabel">Razão de contraste</span>
      <span class="checker-ratio">${fmt(r.contrast)}:1</span>
    </div>
    ${passFailHTML(r.passesText, 'Texto normal (mín. 4,5:1 · WCAG 1.4.3)')}
    ${passFailHTML(r.passesGraphic, 'Texto grande e elementos gráficos (mín. 3:1 · WCAG 1.4.11)')}
    ${r.suggestion ? `
      <div class="checker-suggestion">
        <span class="rule-swatch" style="background:${r.suggestion}"></span>
        <span>Para atingir 4,5:1, troque a cor 1 por <b>${r.suggestion}</b></span>
        <button class="btn-sm" id="btn-use-suggestion">Usar</button>
      </div>` : ''}

    <p class="section-title" style="margin-top:12px">Por tipo de daltonismo</p>
    <div class="cvd-list">
      ${r.types.map(t => {
        const v = VERDICTS[t.verdict];
        const label = FILTERS.find(f => f.key === t.type)?.label || t.type;
        return `
          <div class="cvd-row cvd-${t.verdict}">
            <span class="cvd-label">${label}</span>
            <span class="cvd-swatches">
              <span class="rule-swatch" style="background:${t.sim1}"></span>
              <span class="rule-swatch" style="background:${t.sim2}"></span>
            </span>
            <span class="cvd-verdict"><span class="check-icon">${v.icon}</span> ${v.text}</span>
            <span class="cvd-delta">ΔE ${fmt(t.deltaE, 1)}</span>
          </div>`;
      }).join('')}
    </div>
    <p class="hint-text">
      ΔE (CIEDE2000) entre as duas cores como cada pessoa as veria:
      abaixo de 10, difíceis de distinguir; de 10 a 20, distinguíveis com atenção.
      Quando o par não é distinguível, acrescente texto, ícone ou padrão (WCAG 1.4.1).
    </p>
  `;
}

async function updateChecker() {
  const { c1, c2 } = state.checker;
  const [result, n1, n2] = await Promise.all([
    api.analyzeColors(c1.hex, c2.hex),
    api.colorName(c1.hex),
    api.colorName(c2.hex)
  ]);
  state.checker.result = result;
  c1.name = n1;
  c2.name = n2;
  if (state.view === 'creator') renderCreator();
}

async function setCheckerColor(slot, hex) {
  state.checker[slot].hex = hex;
  await updateChecker();
}

function bindCheckerEvents() {
  ['c1', 'c2'].forEach(slot => {
    document.getElementById(`${slot}-color`).addEventListener('change', (e) =>
      setCheckerColor(slot, e.target.value)
    );
    document.getElementById(`${slot}-pick`).addEventListener('click', async () => {
      const picked = await api.pickColor();
      if (picked) setCheckerColor(slot, picked.hex);
    });
  });

  document.getElementById('btn-use-suggestion')?.addEventListener('click', () =>
    setCheckerColor('c1', state.checker.result.suggestion)
  );
}

// ── View: Editar cena ─────────────────────────────────────────────────────────

function openEdit(scene) {
  state.editingScene  = scene ? JSON.parse(JSON.stringify(scene)) : null;
  state.editingRuleId = null;
  state.view = 'edit';
  render();
}

function renderEdit() {
  const s     = state.editingScene;
  const isNew = !s;

  contentEl.innerHTML = `
    <div class="edit-header">
      <button class="btn-back" id="btn-back">← Cenas</button>
      <p class="edit-title">${isNew ? 'Nova Cena' : 'Editar Cena'}</p>
    </div>

    <div class="card">
      <p class="section-title">Informações</p>
      <div class="field">
        <label>Nome da cena</label>
        <input type="text" id="s-name" class="input"
          placeholder="Ex: Trabalho, Dev - VSCode, Casual..."
          value="${s?.name ?? ''}">
      </div>
      <div class="field" style="margin-top:10px">
        <label>Filtro base de daltonismo</label>
        <select id="s-filter" class="input">
          ${FILTERS.map(f =>
            `<option value="${f.key}" ${f.key === (s?.filter_type ?? 'normal') ? 'selected' : ''}>${f.label} — ${f.desc}</option>`
          ).join('')}
        </select>
      </div>
      <button class="btn-primary" id="btn-save" style="margin-top:12px;width:100%;padding:9px">
        ${isNew ? 'Criar Cena' : 'Salvar Alterações'}
      </button>
    </div>

    ${!isNew ? `
    <div class="card" id="rules-card">
      <div class="rules-header">
        <p class="section-title" style="margin:0">Regras de Padrão Visual</p>
        <button class="btn-sm btn-primary" id="btn-add-rule">+ Regra</button>
      </div>

      <div id="rules-list">
        ${(s.pattern_rules ?? []).length === 0
          ? '<p class="empty-state" style="padding:8px 0 4px">Nenhuma regra. Adicione uma cor para substituir por padrão visual.</p>'
          : (s.pattern_rules ?? []).map(ruleItemHTML).join('')}
      </div>

      <div id="rule-form" style="display:none"></div>
    </div>` : ''}
  `;

  document.getElementById('btn-back').addEventListener('click', () => {
    state.view = 'scenes';
    render();
  });

  document.getElementById('btn-save').addEventListener('click', saveScene);

  if (!isNew) {
    document.getElementById('btn-add-rule').addEventListener('click', () => openRuleForm(null));

    (s.pattern_rules ?? []).forEach(r => {
      document.getElementById(`edit-rule-${r.id}`)
        ?.addEventListener('click', () => openRuleForm(r));
      document.getElementById(`del-rule-${r.id}`)
        ?.addEventListener('click', () => deleteRule(r.id));
    });
  }
}

function ruleItemHTML(r) {
  const patLabel = PATTERNS.find(pt => pt.key === r.pattern)?.label ?? r.pattern;
  return `
    <div class="rule-item">
      <span class="rule-swatch" style="background:${r.color_hex}"></span>
      <div class="rule-info">
        <span class="rule-label">${r.label || r.color_hex}</span>
        <span class="rule-sub">${patLabel} · tolerância ±${r.hue_tolerance}° · ${Math.round(r.opacity * 100)}% opacidade</span>
      </div>
      <button class="btn-icon" id="edit-rule-${r.id}" title="Editar">✎</button>
      <button class="btn-icon btn-danger" id="del-rule-${r.id}" title="Remover">×</button>
    </div>
  `;
}

// ── Formulário de regra (criar/editar) ────────────────────────────────────────

function openRuleForm(rule) {
  state.editingRuleId = rule?.id ?? null;

  const formEl = document.getElementById('rule-form');
  formEl.innerHTML = ruleFormHTML(rule);
  formEl.style.display = 'block';
  document.getElementById('btn-add-rule').style.display = 'none';

  bindRuleFormEvents();
}

function ruleFormHTML(r) {
  const hex = r?.color_hex ?? '#ff0000';
  const tol = r?.hue_tolerance ?? 30;
  const op  = r?.opacity ?? 0.7;

  return `
    <div class="add-rule-form">
      <div class="field">
        <label>Cor alvo</label>
        <button class="btn-sm btn-primary btn-pick" id="r-pick">⌖ Capturar cor da tela</button>
        <p class="hint-text">Clique no elemento da tela que tem a cor. Não é preciso saber o código.</p>
        <div class="color-input-row">
          <input type="color" id="r-color" value="${hex}">
          <input type="text"  id="r-hex" class="input input-sm" value="${hex}" maxlength="7">
          <span class="color-name" id="r-name"></span>
        </div>
      </div>
      <div class="field">
        <label>Padrão visual</label>
        <select id="r-pattern" class="input">
          ${PATTERNS.map(p =>
            `<option value="${p.key}" ${p.key === r?.pattern ? 'selected' : ''}>${p.label}</option>`
          ).join('')}
        </select>
      </div>
      <div class="field">
        <label>Rótulo (opcional; se vazio, usa o nome da cor)</label>
        <input type="text" id="r-label" class="input"
          placeholder="Ex: Vermelho de alerta, Botões de erro..."
          value="${r?.label && r.label !== r?.color_hex ? r.label : ''}">
      </div>
      <div class="field">
        <label>Tolerância de matiz: <span id="r-tol-val">±${tol}°</span></label>
        <input type="range" id="r-tolerance" min="5" max="90" value="${tol}">
      </div>
      <div class="field">
        <label>Opacidade do padrão: <span id="r-op-val">${Math.round(op * 100)}%</span></label>
        <input type="range" id="r-opacity" min="0.1" max="1" step="0.05" value="${op}">
      </div>
      <div class="form-actions">
        <button class="btn-sm" id="btn-cancel-rule">Cancelar</button>
        <button class="btn-sm btn-primary" id="btn-confirm-rule">${state.editingRuleId ? 'Salvar' : 'Adicionar'}</button>
      </div>
    </div>
  `;
}

function bindRuleFormEvents() {
  const colorPicker = document.getElementById('r-color');
  const hexInput    = document.getElementById('r-hex');
  const nameEl      = document.getElementById('r-name');

  // Nome aproximado da cor em texto (M3): quem não vê a cor sabe qual capturou
  const showName = async (hex) => {
    const name = await api.colorName(hex);
    nameEl.textContent = name ? '≈ ' + name : '';
    nameEl.dataset.name = name || '';
  };
  const setColor = (hex) => {
    colorPicker.value = hex;
    hexInput.value = hex;
    showName(hex);
  };

  showName(colorPicker.value);

  colorPicker.addEventListener('input', (e) => { hexInput.value = e.target.value; });
  colorPicker.addEventListener('change', (e) => showName(e.target.value));

  hexInput.addEventListener('change', (e) => {
    if (/^#[0-9a-f]{6}$/i.test(e.target.value)) setColor(e.target.value.toLowerCase());
  });

  document.getElementById('r-pick').addEventListener('click', async () => {
    const picked = await api.pickColor();
    if (picked) setColor(picked.hex);
  });

  document.getElementById('r-tolerance').addEventListener('input', (e) => {
    document.getElementById('r-tol-val').textContent = '±' + e.target.value + '°';
  });

  document.getElementById('r-opacity').addEventListener('input', (e) => {
    document.getElementById('r-op-val').textContent = Math.round(e.target.value * 100) + '%';
  });

  document.getElementById('btn-cancel-rule').addEventListener('click', () => {
    state.editingRuleId = null;
    document.getElementById('rule-form').style.display = 'none';
    document.getElementById('btn-add-rule').style.display = '';
  });

  document.getElementById('btn-confirm-rule').addEventListener('click', submitRule);
}

async function saveScene() {
  const name       = document.getElementById('s-name').value.trim();
  const filterType = document.getElementById('s-filter').value;
  if (!name) { alert('Dê um nome à cena.'); return; }

  if (!state.editingScene) {
    const created = await api.createScene({ name, filterType });
    state.scenes = await api.getScenes();
    state.editingScene = state.scenes.find(s => s.id === created.id);
    render();
  } else {
    await api.updateScene(state.editingScene.id, { name, filter_type: filterType });
    if (state.prefs.activeSceneId === state.editingScene.id)
      state.prefs = await api.setFilterType(filterType);
    state.scenes = await api.getScenes();
    state.editingScene = state.scenes.find(s => s.id === state.editingScene.id);
    render();
  }
}

async function submitRule() {
  const hex = document.getElementById('r-hex').value.trim();
  if (!/^#[0-9a-f]{6}$/i.test(hex)) { alert('Cor inválida. Use o formato #rrggbb.'); return; }

  const payload = {
    colorHex:     hex,
    hueCenter:    hexToHue(hex),
    hueTolerance: parseInt(document.getElementById('r-tolerance').value),
    pattern:      document.getElementById('r-pattern').value,
    label:        document.getElementById('r-label').value.trim()
                    || document.getElementById('r-name').dataset.name
                    || hex,
    opacity:      parseFloat(document.getElementById('r-opacity').value)
  };

  if (state.editingRuleId) {
    await api.updatePatternRule(state.editingRuleId, payload);
  } else {
    await api.addPatternRule(state.editingScene.id, payload);
  }

  state.editingRuleId = null;
  state.scenes = await api.getScenes();
  state.editingScene = state.scenes.find(s => s.id === state.editingScene.id);
  render();
}

async function deleteRule(ruleId) {
  await api.deletePatternRule(ruleId);
  state.scenes = await api.getScenes();
  state.editingScene = state.scenes.find(s => s.id === state.editingScene.id);
  render();
}

// ── Utilitários ───────────────────────────────────────────────────────────────

function hexToHue(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0)
        : max === g ? (b - r) / d + 2
                    : (r - g) / d + 4;
  return Math.round(h * 60);
}

function switchTab(tab) {
  state.view = tab;
  render();
}

// ── Listeners globais ─────────────────────────────────────────────────────────

document.querySelectorAll('.tab').forEach(tab =>
  tab.addEventListener('click', () => switchTab(tab.dataset.tab))
);

// Toggle universal — liga/desliga filtro de cor + padrões visuais
globalToggle.addEventListener('change', async () => {
  state.prefs = await api.toggleOverlay(globalToggle.checked);
  render();
});

document.getElementById('btn-logout').addEventListener('click', () => api.signOut());

// Mudanças vindas da bandeja, dos atalhos ou do próprio painel (M4/M5).
// Telas com formulário (edição, calibração) só atualizam o rodapé.
api.onStateChanged(({ prefs, sim, status }) => {
  state.prefs  = prefs;
  state.sim    = sim;
  state.status = status;
  if (['filter', 'scenes', 'creator'].includes(state.view)) render();
  else updateGlobalControls();
});

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  const [prefs, user, scenes, sim, appState] = await Promise.all([
    api.getPreferences(),
    api.getUser().catch(() => null),
    api.getScenes().catch(() => []),
    api.getSimState().catch(() => ({ active: false, type: 'protanopia' })),
    api.getState()
  ]);

  state.prefs     = prefs;
  state.user      = user;
  state.scenes    = scenes;
  state.sim       = sim;
  state.status    = appState.status;
  state.shortcuts = appState.shortcuts;

  if (user?.name) userNameEl.textContent = user.name;

  render();
}

init();
