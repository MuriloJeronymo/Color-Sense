const Store = require('electron-store');

const schema = {
  filterActive: { type: 'boolean', default: false },
  filterType: { type: 'string', default: 'normal' },
  // Intensidade da correção: 1 = daltonização padrão; até 2 para exagerar (calibração)
  intensity: { type: 'number', default: 1.0, minimum: 0, maximum: 2 },
  // Padrões visuais da cena ativa (podem ser desligados sem desligar o filtro)
  patternsActive: { type: 'boolean', default: true },
  // Indicador de estado sempre visível no canto da tela
  showIndicator: { type: 'boolean', default: true },
  userId: { type: ['string', 'null'], default: null },
  userName: { type: ['string', 'null'], default: null },
  activeSceneId: { type: ['string', 'null'], default: null },
  theme: { type: 'string', default: 'dark' }
};

const store = new Store({ schema });

function getPreferences() {
  return {
    filterActive: store.get('filterActive'),
    filterType: store.get('filterType'),
    intensity: store.get('intensity'),
    patternsActive: store.get('patternsActive'),
    showIndicator: store.get('showIndicator'),
    userId: store.get('userId'),
    userName: store.get('userName'),
    activeSceneId: store.get('activeSceneId'),
    theme: store.get('theme')
  };
}

function savePreferences(partial) {
  Object.entries(partial).forEach(([key, value]) => {
    if (key in schema) store.set(key, value);
  });
}

function resetPreferences() {
  store.clear();
}

module.exports = { getPreferences, savePreferences, resetPreferences };
