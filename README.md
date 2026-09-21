# GitFusion

Cliente Git desktop (Tauri 2 + React + TypeScript) que mescla o **grafo visual e o fluxo por branches do GitKraken** com **as ferramentas de "power user" do GitExtensions** (console git, log de comandos, navegador de arquivos por revisão, blame, histórico de arquivo).

## Recursos

**Estilo GitKraken**
- Grafo de commits colorido por lanes, com chips de branch/tag/remote, linha virtual de "alterações não commitadas" e virtualização (histórico grande sem travar)
- Abas de múltiplos repositórios, dashboard com recentes, clonar/abrir/`git init`
- Sidebar com branches locais (↑ahead/↓behind), remotos agrupados, tags, stashes e submódulos
- Menus de contexto em commits, branches, tags e stashes: checkout, merge, rebase, cherry-pick, revert, reset (soft/mixed/hard), criar/renomear/excluir branch e tag, upstream…
- Toolbar: Fetch, Pull (default / `--ff-only` / `--rebase`), Push (publica branch nova, `--force-with-lease`, tags), Branch, Stash, Pop
- Painel de staging com commit, amend e resolução rápida de conflitos (Minha / Deles / Resolvido) + banner de merge/rebase/cherry-pick/revert em andamento (Continuar / Pular / Abortar)

**Estilo GitExtensions**
- **Stage por bloco e por linha** (e descarte parcial) direto no diff, unificado ou lado a lado
- Aba **Arquivos**: árvore do repositório em qualquer commit, visualização de conteúdo e **Blame**
- Aba **Console**: execute qualquer comando `git` no repositório (histórico com ↑/↓)
- Aba **Log de comandos**: todo comando git disparado pela interface, com código de saída, tempo e saída
- Histórico de um arquivo, filtro por mensagem/autor/caminho/branch atual
- Arquivos alterados (staging e detalhes do commit) em **lista ou árvore de pastas** (pastas com filho único compactadas, recolher/expandir, stage/unstage/descartar por pasta); a escolha é lembrada

**Outros:** tema claro/escuro, atualização automática ao voltar para a janela, `gitfusion <pasta>` abre um repositório pela linha de comando.
Atalhos: `F5` atualizar · `Ctrl+O` abrir · `Ctrl+Enter` commitar · `↑/↓` navegar no grafo.

## Arquitetura

O núcleo Rust é propositalmente mínimo (`src-tauri/src/lib.rs`): apenas executa o **`git` real do sistema** (`run_git`), checa existência de caminhos e lê o argumento de linha de comando. Assim você mantém sua configuração, hooks, ssh-agent e credential helpers. **Toda a lógica é TypeScript**:

```
src/lib/git/parse.ts    parsers: log, status v2, refs, diff, blame, stash, submódulos
src/lib/git/graph.ts    layout de lanes do grafo
src/lib/git/patch.ts    monta patches parciais (hunk/linhas) para `git apply`
src/lib/git/queries.ts  argumentos das consultas
src/lib/git/runner.ts   ponte com o Rust + Command Log
src/actions.ts          operações de alto nível (refresh, commit, merge, …)
src/store.ts            estado global (zustand), diálogos, toasts, menus
src/components/*        UI
tests/git.test.ts       testes contra um repositório git real
```

## Desenvolvimento

Requisitos: Node 20+, Rust (rustup), `git` no PATH e, no Linux, `webkit2gtk-4.1`, `gtk3`, `librsvg`, `patchelf`, `base-devel`.

```bash
npm install
npm run tauri dev        # app em modo desenvolvimento
npm test                 # testes (parsers, grafo, staging parcial em repo real)
npm run typecheck
npm run tauri build      # instaladores (AppImage/deb/rpm)
```

## Build e instalação no Linux

Gerar os instaladores (saem em `release/` com `build:linux`):

```bash
npm run build:arch       # pacote Arch (.pkg.tar.zst) em pkg/
npm run build:deb-rpm    # .deb e .rpm
npm run build:appimage   # AppImage (no Arch usa scripts/appimage-fallback.sh se o Tauri falhar)
npm run build:linux      # todos, copiados para release/
```

Se mudar a versão, atualize também `version` em `package.json` e `src-tauri/tauri.conf.json`, e `pkgver` em `pkg/PKGBUILD`.

Instalar:

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

Depois de instalar, abra pelo menu ("GitFusion") ou com `gitfusion [pasta-do-repositório]`. Para desinstalar no Arch: `sudo pacman -R gitfusion`.

## Limitações conhecidas (próximos passos)

- Rebase interativo (reordenar/squash/reword) ainda não tem UI — use o Console
- Resolução de conflitos é por arquivo inteiro (Minha/Deles); não há editor de 3 vias
- Sem integração com GitHub/GitLab (PRs, issues) nem assinatura de commit dedicada
- Repositórios com hash SHA-256 não foram testados
