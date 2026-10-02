# GitFusion

Cliente Git desktop (Tauri 2 + React + TypeScript) que une o **grafo visual e o fluxo por branches do GitKraken** às **ferramentas de "power user" do GitExtensions**: console git, log de comandos, navegador de arquivos por revisão, blame e histórico de arquivo.

O app não reimplementa o Git: ele executa o **`git` real do sistema**, então sua configuração, hooks, ssh-agent e credential helpers continuam valendo.

**Sumário:** [Recursos](#recursos) · [Início rápido](#início-rápido) · [Atalhos](#atalhos-e-linha-de-comando) · [Arquitetura](#arquitetura) · [Desenvolvimento](#desenvolvimento) · [Build e instalação](#build-e-instalação-no-linux) · [Limitações](#limitações-conhecidas)

## Recursos

### Estilo GitKraken

- **Grafo de commits** colorido por lanes, com chips de branch/tag/remote, linha virtual de "alterações não commitadas" e virtualização (histórico grande sem travar)
- **Múltiplos repositórios** em abas, dashboard com recentes, clonar / abrir / `git init`
- **Sidebar** com branches locais (↑ahead/↓behind), remotos agrupados, tags, stashes e submódulos
- **Menus de contexto** em commits, branches, tags e stashes: checkout, merge, rebase, cherry-pick, revert, reset (soft/mixed/hard), criar/renomear/excluir branch e tag, definir upstream…
- **Toolbar** personalizável: Fetch, Pull (padrão / `--ff-only` / `--rebase`), Push (publica branch nova, `--force-with-lease`, tags), Branch, Stash, Pop
- **Painel de staging** com commit, amend e resolução rápida de conflitos (Minha / Deles / Resolvido), mais um banner de merge/rebase/cherry-pick/revert em andamento (Continuar / Pular / Abortar)

### Estilo GitExtensions

- **Stage por bloco e por linha** (e descarte parcial) direto no diff, unificado ou lado a lado
- Aba **Arquivos**: árvore do repositório em qualquer commit, visualização de conteúdo e **Blame**
- Aba **Console**: execute qualquer comando `git` no repositório (histórico com ↑/↓)
- Aba **Log de comandos**: todo comando git disparado pela interface, com código de saída, tempo e saída
- **Histórico de um arquivo** e filtro por mensagem, autor, caminho ou branch atual
- Arquivos alterados (staging e detalhes do commit) em **lista ou árvore de pastas**: pastas com filho único compactadas, recolher/expandir e stage/unstage/descartar por pasta. A escolha é lembrada

### Outros

- Tema claro e escuro
- Botão para abrir a pasta do projeto no gerenciador de arquivos
- Extensões (veja abaixo), incluindo **GitHub Actions**: execuções na aba "Actions", status do CI em cada commit do grafo e na barra superior, jobs/passos, re-executar e cancelar
- Atualização automática ao voltar para a janela

## Início rápido

Se você só quer usar o app no Linux, pule para [Build e instalação](#build-e-instalação-no-linux). Para rodar a partir do código:

```bash
git clone <url-do-repositório> gitFusion
cd gitFusion
npm install
npm run tauri dev
```

## Atalhos e linha de comando

| Ação | Atalho |
| --- | --- |
| Atualizar | `F5` |
| Abrir repositório | `Ctrl+O` |
| Commitar | `Ctrl+Enter` |
| Navegar no grafo | `↑` / `↓` |

Para abrir um repositório direto do terminal:

```bash
gitfusion [pasta-do-repositório]
```

## Arquitetura

O núcleo Rust é propositalmente mínimo (`src-tauri/src/lib.rs`). Ele executa o `git` (`run_git`), verifica se caminhos existem (`path_exists`), lê o argumento de linha de comando (`startup_path`), abre pastas e URLs no sistema (`open_path`, `open_url`) e atende as extensões: HTTPS para uma lista fixa de hosts (`http_request`) e o token do GitHub (`github_auth_status`, `github_token_set`). **Toda a lógica é TypeScript.**

```
src/
├── lib/git/
│   ├── parse.ts      parsers: log, status v2, refs, diff, blame, stash, submódulos
│   ├── graph.ts      layout de lanes do grafo
│   ├── patch.ts      monta patches parciais (hunk/linhas) para `git apply`
│   ├── queries.ts    argumentos das consultas
│   └── runner.ts     ponte com o Rust + Command Log
├── extensions/
│   ├── api.ts        contrato das extensões (Extension, ExtContext)
│   ├── registry.ts   ativação, eventos e contribuições de UI
│   ├── index.ts      extensões que acompanham o app
│   └── github-actions/
├── actions.ts        operações de alto nível (refresh, commit, merge, …)
├── store.ts          estado global (zustand): diálogos, toasts, menus
└── components/       UI (grafo, sidebar, diff, console, dashboard, …)

src-tauri/            núcleo Rust + configuração do Tauri
tests/
├── git.test.ts       parsers, grafo e staging parcial contra um repositório git real
├── extensions.test.ts  partes puras da extensão GitHub Actions
└── app.test.tsx      testes da interface (jsdom) com o Tauri simulado sobre o git real
pkg/                  PKGBUILD e arquivos do pacote Arch
scripts/              utilitários de build (fallback do AppImage)
```

## Extensões

Extensões são módulos TypeScript em `src/extensions/` listados em `BUILTIN_EXTENSIONS`. Elas são ligadas e desligadas no ícone de quebra-cabeça da barra de abas. Uma extensão implementa `Extension` (`src/extensions/api.ts`) e, em `activate(ctx)`, registra o que quiser:

```ts
export const minhaExtensao: Extension = {
  id: "minha-extensao",
  name: "Minha extensão",
  description: "…",
  hosts: ["api.github.com"],            // o que ctx.http pode acessar
  activate(ctx) {
    ctx.ui.dockTab({ id: "aba", label: "Minha aba", component: MinhaAba });
    ctx.ui.toolbarItem({ id: "botao", label: "Meu botão", component: MeuBotao });
    ctx.ui.commitBadge(MeuBadge);       // recebe { commit }
    ctx.on("repoChanged", recarregar);  // também: "refreshed"
  },
};
```

Tudo o que é registrado é desfeito ao desativar. O `ctx` também oferece `git(...)` no repositório ativo, `storage`, `toast`, `ask` (diálogos), `openUrl`, `showDockTab` e `revealCommit`.

**Segurança:** o webview não acessa a rede (CSP). O `http_request` do núcleo só aceita HTTPS para hosts fixos no Rust (`ALLOWED_HOSTS`, hoje só `api.github.com`), e `ctx.http` restringe ainda aos `hosts` da extensão. O token do GitHub nunca chega ao frontend: o núcleo o injeta nas chamadas para `api.github.com`. A ordem de busca é o token salvo no chaveiro do sistema, `gh auth token` e `GH_TOKEN`/`GITHUB_TOKEN`. Sem token, só repositórios públicos funcionam, com o limite baixo da API.

## Desenvolvimento

### Requisitos

- Node 20+
- Rust (via [rustup](https://rustup.rs))
- `git` no PATH
- Linux: `webkit2gtk-4.1`, `gtk3`, `librsvg`, `patchelf`, `base-devel`, `dbus` (chaveiro do sistema via Secret Service)

### Comandos

| Comando | O que faz |
| --- | --- |
| `npm run tauri dev` | App desktop em modo desenvolvimento |
| `npm run dev` | Somente a interface no navegador (Vite), sem o núcleo Rust |
| `npm test` | Testes (parsers, grafo, staging parcial e UI em repositórios reais) |
| `npm run typecheck` | Checagem de tipos com `tsc` |
| `npm run build` | Typecheck + build do front-end |
| `npm run tauri build` | Instaladores para a plataforma atual |

## Build e instalação no Linux

### Gerar os pacotes

```bash
npm run build:arch       # pacote Arch (.pkg.tar.zst) em pkg/
npm run build:deb-rpm    # .deb e .rpm
npm run build:appimage   # AppImage (no Arch usa scripts/appimage-fallback.sh se o Tauri falhar)
npm run build:linux      # todos, copiados para release/
```

> **Nova versão?** Atualize `version` em `package.json` e `src-tauri/tauri.conf.json`, e `pkgver` em `pkg/PKGBUILD`. Os nomes dos arquivos em `release/` mudam junto.

### Instalar

```bash
# Arch / Manjaro
sudo pacman -U release/gitfusion-0.2.0-1-x86_64.pkg.tar.zst

# Debian / Ubuntu / Mint
sudo apt install ./release/GitFusion_0.2.0_amd64.deb

# Fedora / openSUSE
sudo dnf install ./release/GitFusion-0.2.0-1.x86_64.rpm

# Qualquer distro (sem instalar)
chmod +x release/GitFusion-x86_64.AppImage && ./release/GitFusion-x86_64.AppImage
```

Depois de instalar, abra pelo menu ("GitFusion") ou com `gitfusion [pasta-do-repositório]`.

Para desinstalar no Arch: `sudo pacman -R gitfusion`.

## Limitações conhecidas

Próximos passos possíveis:

- **Rebase interativo** (reordenar/squash/reword) ainda não tem UI. Use o Console
- **Conflitos** são resolvidos por arquivo inteiro (Minha/Deles); não há editor de 3 vias
- Sem integração com GitHub/GitLab (PRs, issues) nem assinatura de commit dedicada
- Repositórios com hash SHA-256 não foram testados
