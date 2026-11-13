<div align="center">

# 🎨 ColorSense

**Ferramenta de acessibilidade visual para pessoas com daltonismo**

Trabalho de Conclusão de Curso — PUCPR
Guilherme Dias · Enzo Sprengoski · Murilo Jeronymo

</div>

---

## 📖 Sobre o projeto

O **ColorSense** é um aplicativo de desktop que ajuda pessoas com daltonismo (discromatopsia) a distinguir cores em **toda a tela do computador**, em tempo real — não apenas dentro de um site ou programa específico.

A ferramenta atende a **dois públicos**:

- 👤 **Usuário daltônico** — corrige as cores da tela para torná-las distinguíveis.
- 🎨 **Designers / desenvolvedores** — simulam como um daltônico enxergaria a tela, para validar seu próprio trabalho.

---

## ✨ Funcionalidades

| Recurso | Descrição |
|---------|-----------|
| 🎚️ **Filtro de correção** | Reprocessa as cores da tela (daltonização) para compensar o daltonismo. Suporta 9 perfis. |
| 👁️ **Modo Criador (simulação)** | Mostra como a tela apareceria para um daltônico, para validação por designers. |
| 🟦 **Padrões visuais** | Sobrepõe texturas (listras, pontos, hachuras) sobre regiões de uma cor específica, tornando-a identificável pela *forma*. |
| 🗂️ **Cenas** | Perfis de configuração salvos na nuvem, ativáveis conforme a tarefa. |
| 🔐 **Conta de usuário** | Cadastro/login com persistência de preferências e cenas. |
| 🧪 **Verificador de cores** | No modo Criador: razão de contraste WCAG (4,5:1 e 3:1) e se duas cores continuam distinguíveis para cada tipo de daltonismo (ΔE CIEDE2000). |
| 🎯 **Calibração do filtro** | Ajuste guiado do tipo e da intensidade do filtro com pares de cores de teste. |
| ⌖ **Conta-gotas** | Captura uma cor clicando na tela, com o nome aproximado da cor (regras de cena e verificador). |
| ◐ **Indicador de estado** | Símbolo e texto sempre visíveis no canto da tela, no painel e na bandeja (Desligado, Filtro ligado, Simulando). |
| ⌨️ **Acesso rápido** | Ctrl+Alt+F (filtro), Ctrl+Alt+P (padrões), Ctrl+Alt+S (simulação) e clique no ícone da bandeja. |

**Tipos de daltonismo suportados:** Protanopia, Protanomalia, Deuteranopia, Deuteranomalia, Tritanopia, Tritanomalia, Acromatopsia e Acromatomalia.

---

## 🏗️ Arquitetura

O ColorSense é construído com **Electron**, que combina o **Chromium** (interface) com o **Node.js** (acesso ao sistema). A aplicação se divide em processos isolados que se comunicam por IPC:

```
┌──────────────────────────────────────────────────────────────┐
│  PROCESSO PRINCIPAL (main.js) — Node.js                        │
│  • Orquestra a aplicação, janelas, bandeja e menus            │
│  • Conversa com o Windows (Magnification API)                 │
│  • Conversa com o Supabase (nuvem)                            │
└───────────────┬───────────────────────────┬──────────────────┘
                │ IPC (canal seguro)         │ stdin/stdout
   ┌────────────▼───────────┐   ┌────────────▼──────────────────┐
   │ INTERFACE (Chromium)    │   │ COLOR DAEMON (PowerShell)      │
   │ • Login / painel        │   │ • Aplica o filtro na tela      │
   │ • Overlay de padrões    │   │   inteira via Magnification API│
   └─────────────────────────┘   └────────────────────────────────┘
```

**Dois mecanismos de cor, com abordagens distintas:**

- **Filtro de cor** → o JavaScript *calcula* a matriz de transformação ([src/algorithms/colorFilters.js](src/algorithms/colorFilters.js)); o daemon PowerShell a *aplica* na tela inteira via Windows Magnification API (GPU).
- **Padrões visuais** → o app captura a tela como vídeo, analisa o matiz de cada pixel e desenha texturas sobre a cor-alvo usando um `<canvas>` numa janela transparente sobreposta ([src/ui/overlay.js](src/ui/overlay.js)).

📚 **Esquema do banco:** [supabase/schema.sql](supabase/schema.sql) — tabelas, políticas de RLS e restrições, comentados.

---

## 🧰 Stack tecnológica

| Camada | Tecnologia |
|--------|-----------|
| Plataforma desktop | Electron 31 |
| Interface | HTML + CSS + JavaScript (Chromium) |
| Lógica / sistema | Node.js |
| Filtro de tela (nativo) | Windows Magnification API via PowerShell |
| Padrões visuais | Canvas 2D + `getUserMedia` / `desktopCapturer` |
| Backend / Auth / BD | Supabase (PostgreSQL) |
| Persistência local | electron-store |
| Empacotamento | electron-builder |

---

## 📁 Estrutura do projeto

```
ColorSense/
├── main.js                  # Processo principal (orquestração)
├── preload.js               # Ponte segura interface ↔ sistema
├── run.js                   # Inicializador do Electron
├── .env                     # Credenciais do Supabase (NÃO versionado)
├── .env.example             # Template das credenciais
├── docs/                    # Documentação técnica
├── site/                    # Guia do usuário (colorsense-guia.vercel.app)
└── src/
    ├── algorithms/
    │   ├── colorFilters.js     # Matrizes de simulação e correção (daltonização)
    │   ├── contrastChecker.js  # Verificação de contraste WCAG
    │   ├── colorChecker.js     # Verificador de cores (contraste + ΔE por tipo de daltonismo)
    │   └── colorNames.js       # Nome aproximado das cores em português
    ├── native/
    │   └── colorDaemon.ps1     # Daemon PowerShell (Magnification API)
    ├── store/
    │   ├── supabase.js         # Cliente Supabase
    │   ├── auth.js             # Autenticação
    │   ├── sceneStore.js       # CRUD de cenas e regras
    │   └── preferences.js      # Preferências locais (electron-store)
    ├── ui/
    │   ├── index.html / app.js / style.css   # Painel principal
    │   ├── auth/                              # Tela de login
    │   ├── overlay.html / overlay.js          # Overlay de padrões visuais
    │   └── overlay-preload.js                 # Ponte do overlay
    ├── picker/                  # Conta-gotas (captura de cor na tela)
    └── tray/trayIcons.js        # Ícones da bandeja por estado
```

---

## 🚀 Como rodar o projeto

### Pré-requisitos

- **Windows 10 ou 11** (obrigatório — o filtro depende da Magnification API)
- **Node.js 18+** ([download](https://nodejs.org))
- **PowerShell** (já incluído no Windows)

### Passo a passo

**1. Clone o repositório**
```bash
git clone <url-do-repositorio>
cd ColorSense
```

**2. Instale as dependências**
```bash
npm install
```

**3. Configure as credenciais do Supabase**

Crie um arquivo `.env` na raiz do projeto, baseado no [.env.example](.env.example):

```env
SUPABASE_URL=sua_url_aqui
SUPABASE_KEY=sua_chave_aqui
```

> 🔑 **Credenciais de avaliação:** a URL e a chave do Supabase são fornecidas **no comentário da entrega no Canvas**. Copie-as para o `.env` e o login passa a funcionar.
>
> A chave usada é a **publishable** (`sb_publishable_...`), que é pública por natureza — ela vai embutida no executável e é o RLS que protege os dados. A chave secreta (`sb_secret_...`) **nunca** deve ir para o `.env`: ela ignora o RLS inteiro e daria a qualquer usuário acesso aos dados de todos os outros.
>
> Projetos Supabase no plano gratuito são **pausados por inatividade**, e um projeto pausado deixa o app travado na tela de login. Se isso acontecer, restaure o projeto pelo painel antes de avaliar.

**4. Inicie a aplicação**
```bash
npm start
```

O app abrirá com a tela de login. Após autenticar, o painel principal aparece e um ícone fica disponível na **bandeja do sistema** (system tray).


## 🔄 Atualizações

A versão **instalada** se atualiza sozinha pelas releases deste repositório:

- ao abrir e a cada 4 horas, o app consulta a última release do GitHub;
- se houver versão nova, ela é baixada em segundo plano — só os blocos que mudaram, quando dá;
- a instalação acontece quando o app é fechado pelo menu da bandeja ou, se ele não for fechado, na próxima abertura, **antes** de qualquer janela aparecer. O menu da bandeja também oferece **Reiniciar e atualizar**.

A versão **portátil** não tem instalação para trocar: ela só avisa que existe uma versão nova.

Cada verificação fica registrada em `%APPDATA%\colorsense\atualizacao.log` — é o arquivo a pedir quando uma atualização falhar no computador de alguém.

### Como lançar uma versão

1. Aumente a versão em `package.json` (por exemplo, `0.3.0` → `0.3.1`). O app só se atualiza para uma versão **maior** que a instalada.
2. Gere os arquivos com `npm run build`. Saem em `dist/`: `ColorSense-Setup.exe`, `ColorSense-Setup.exe.blockmap`, `latest.yml` e `ColorSense-Portable.exe`.
3. Publique a release com a tag `v` + versão, enviando **os quatro arquivos**:

```bash
gh release create v0.3.1 dist/ColorSense-Setup.exe dist/ColorSense-Setup.exe.blockmap dist/latest.yml dist/ColorSense-Portable.exe --title "ColorSense 0.3.1"
```

Sem o `latest.yml`, os apps instalados não enxergam a versão nova; sem o `.blockmap`, baixam o instalador inteiro. A release precisa estar publicada — rascunho e pré-lançamento não contam como a última.

Os nomes dos arquivos não têm versão de propósito: o site aponta para `releases/latest/download/`, e o link continua certo a cada lançamento.

> Se o `npm run build` falhar com `Cannot create symbolic link`, ative o **Modo de desenvolvedor** do Windows (Configurações → Sistema → Para desenvolvedores) e rode de novo. O electron-builder extrai ferramentas que contêm links simbólicos, e sem esse modo o Windows só permite criá-los como administrador.

## ⚠️ Limitações

- **Apenas Windows.** O filtro de tela inteira usa a Windows Magnification API, que não existe em macOS/Linux. Embora o `package.json` tenha alvos de build para os três sistemas, **só o Windows é funcional**.
- **Correção por matriz linear.** Recupera a distinção de cores redistribuindo informação, mas não "cria" o que foi perdido. Acromatopsia e acromatomalia não têm correção possível por esse método — não sobra canal funcional para onde realocar a informação. Nesses dois casos a interface marca o filtro como indisponível em vez de aplicar uma matriz que não faz nada; a simulação deles continua funcionando na aba Criador.
- **Distorção como contrapartida.** Afastar cores que a pessoa confunde significa deslocar cores que ela já enxergava bem. O slider *Intensidade do Filtro* existe para achar o equilíbrio — não há um valor certo universal.
- **Relógio do sistema.** O token de sessão do Supabase é rejeitado se o relógio do computador estiver adiantado em relação ao servidor (`JWT issued at future`). Se as cenas não carregarem, verifique a sincronização de data e hora do Windows.
- **Ajustes da Sprint 3** (verificador de cores, calibração, conta-gotas, indicador de estado e acesso rápido) foram verificados apenas por testes funcionais da equipe, sem nova rodada com usuários (Seção 6.9.3).

---

<div align="center">

ColorSense v0.4 · PUCPR · 2025–2026

</div>
