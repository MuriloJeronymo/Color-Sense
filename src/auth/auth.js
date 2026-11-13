const api = window.colorSenseAPI;

// ── Abas ─────────────────────────────────────────────────────────────────────

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.form').forEach(f => f.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('form-' + tab.dataset.tab).classList.add('active');
  });
});

// ── Login ─────────────────────────────────────────────────────────────────────

document.getElementById('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('login-btn');
  const err = document.getElementById('login-error');
  err.textContent = '';
  btn.disabled = true;
  btn.textContent = 'Entrando...';

  try {
    await api.signIn({
      email: document.getElementById('login-email').value.trim(),
      password: document.getElementById('login-password').value
    });
    // Notifica o main process que o login foi bem-sucedido
    api.notifyAuthSuccess();
  } catch (error) {
    err.textContent = traduzirErro(error.message);
    btn.disabled = false;
    btn.textContent = 'Entrar';
  }
});

// ── Cadastro ──────────────────────────────────────────────────────────────────

document.getElementById('form-register').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('reg-btn');
  const err = document.getElementById('reg-error');
  err.textContent = '';
  btn.disabled = true;
  btn.textContent = 'Criando conta...';

  try {
    const dados = await api.signUp({
      name: document.getElementById('reg-name').value.trim(),
      email: document.getElementById('reg-email').value.trim(),
      password: document.getElementById('reg-password').value,
      daltonismType: document.getElementById('reg-daltonism').value
    });

    // Se o projeto Supabase exigir confirmação de email, o signUp devolve
    // session = null. Seguir para o painel nesse caso abre a janela principal
    // sem sessão e o getScenes() estoura. Hoje a confirmação está desligada,
    // mas isto evita a surpresa caso alguém ligue depois.
    if (!dados?.session) {
      err.textContent = 'Conta criada. Confirme seu email e depois entre.';
      btn.disabled = false;
      btn.textContent = 'Criar conta';
      return;
    }

    api.notifyAuthSuccess();
  } catch (error) {
    err.textContent = traduzirErro(error.message);
    btn.disabled = false;
    btn.textContent = 'Criar conta';
  }
});

function traduzirErro(msg) {
  if (msg.includes('Invalid login credentials')) return 'Email ou senha incorretos.';
  if (msg.includes('Email not confirmed'))       return 'Confirme seu email antes de entrar.';
  if (msg.includes('already registered'))        return 'Este email já está cadastrado.';
  if (msg.includes('Password should be'))        return 'A senha deve ter ao menos 6 caracteres.';
  return msg;
}
