//! Núcleo Rust do GitFusion.
//!
//! Toda a lógica de Git (parsers, grafo, staging parcial) vive no frontend em
//! TypeScript. Aqui só expomos o mínimo: executar o `git` do sistema e
//! consultar o sistema de arquivos, além da rede e do chaveiro usados pelas
//! extensões. Usar o binário real do Git garante
//! compatibilidade total com a configuração, hooks, ssh-agent e credential
//! helpers do usuário.

use std::collections::HashMap;
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

use serde::Serialize;

#[derive(Serialize)]
struct GitOutput {
    code: i32,
    stdout: String,
    stderr: String,
}

fn run_git_blocking(
    cwd: String,
    args: Vec<String>,
    stdin: Option<String>,
    env: Option<HashMap<String, String>>,
) -> Result<GitOutput, String> {
    let mut cmd = Command::new("git");
    cmd.args(&args)
        .current_dir(&cwd)
        // Nunca travar esperando input interativo: falhar com erro claro.
        .env("GIT_TERMINAL_PROMPT", "0")
        // Aceita mensagens/edições padrão em vez de abrir um editor sem TTY.
        .env("GIT_EDITOR", "true")
        .env("GIT_MERGE_AUTOEDIT", "no")
        .stdin(if stdin.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(env) = env {
        for (k, v) in env {
            cmd.env(k, v);
        }
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("não foi possível executar o git ({e}). Ele está instalado e no PATH?"))?;

    if let Some(input) = stdin {
        // Escrita em thread própria para não dar deadlock com stdout cheio.
        let mut pipe = child.stdin.take().ok_or("stdin indisponível")?;
        std::thread::spawn(move || {
            let _ = pipe.write_all(input.as_bytes());
        });
    }

    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    Ok(GitOutput {
        code: out.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
    })
}

/// Executa `git <args>` em `cwd`. Não interpreta nada: o chamador decide o que
/// fazer com o código de saída.
#[tauri::command]
async fn run_git(
    cwd: String,
    args: Vec<String>,
    stdin: Option<String>,
    env: Option<HashMap<String, String>>,
) -> Result<GitOutput, String> {
    tauri::async_runtime::spawn_blocking(move || run_git_blocking(cwd, args, stdin, env))
        .await
        .map_err(|e| e.to_string())?
}

/// Verifica se `rel` (relativo a `cwd`, ou absoluto) existe.
#[tauri::command]
fn path_exists(cwd: String, rel: String) -> bool {
    Path::new(&cwd).join(rel).exists()
}

/// Entrega `target` (pasta ou URL) ao abridor padrão do sistema.
fn open_with_system(target: &str) -> std::io::Result<()> {
    #[cfg(target_os = "windows")]
    let program = "explorer";
    #[cfg(target_os = "macos")]
    let program = "open";
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let program = "xdg-open";

    Command::new(program)
        .arg(target)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
}

/// Abre `path` no gerenciador de arquivos do sistema.
#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    if !Path::new(&path).is_dir() {
        return Err(format!("pasta não encontrada: {path}"));
    }
    open_with_system(&path).map_err(|e| format!("não foi possível abrir a pasta ({e})"))
}

/// Abre uma URL http(s) no navegador padrão.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err(format!("URL não suportada: {url}"));
    }
    open_with_system(&url).map_err(|e| format!("não foi possível abrir o navegador ({e})"))
}

/* ------------------------------------------------------- extensões: rede */

/// Únicos hosts que o webview pode alcançar. A lista é fixa no núcleo para que
/// nenhum código da interface consiga enviar dados para outro lugar.
const ALLOWED_HOSTS: &[&str] = &["api.github.com"];

/// Cabeçalhos que só o núcleo define (credenciais).
const RESERVED_HEADERS: &[&str] = &["authorization", "cookie", "proxy-authorization"];

#[derive(Serialize)]
struct HttpResponse {
    status: u16,
    headers: HashMap<String, String>,
    body: String,
}

/// Requisição HTTPS feita pelo núcleo (o webview não acessa a rede por causa
/// da CSP). Só aceita hosts de `ALLOWED_HOSTS`; para o GitHub, o token é
/// injetado aqui e nunca chega ao frontend.
#[tauri::command]
async fn http_request(
    method: String,
    url: String,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
) -> Result<HttpResponse, String> {
    let parsed = reqwest::Url::parse(&url).map_err(|e| format!("URL inválida ({e}): {url}"))?;
    let host = parsed.host_str().unwrap_or_default().to_owned();
    if parsed.scheme() != "https"
        || parsed.port().is_some()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || !ALLOWED_HOSTS.contains(&host.as_str())
    {
        return Err(format!("destino não permitido: {url}"));
    }

    let method = reqwest::Method::from_bytes(method.to_uppercase().as_bytes()).map_err(|e| e.to_string())?;
    let client = reqwest::Client::builder()
        .user_agent(concat!("GitFusion/", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;

    let mut req = client.request(method, parsed);
    for (k, v) in headers.unwrap_or_default() {
        if !RESERVED_HEADERS.contains(&k.to_ascii_lowercase().as_str()) {
            req = req.header(k, v);
        }
    }
    if host == "api.github.com" {
        if let Some((token, _)) = github_token().await {
            req = req.bearer_auth(token);
        }
    }
    if let Some(body) = body {
        req = req.body(body);
    }

    let res = req.send().await.map_err(|e| format!("falha de rede: {e}"))?;
    let status = res.status().as_u16();
    let headers = res
        .headers()
        .iter()
        .filter_map(|(k, v)| Some((k.as_str().to_owned(), v.to_str().ok()?.to_owned())))
        .collect();
    let body = res.text().await.map_err(|e| e.to_string())?;
    Ok(HttpResponse { status, headers, body })
}

/* ------------------------------------------------- extensões: token GitHub */

const KEYRING_SERVICE: &str = "com.gitfusion.app";
const GITHUB_TOKEN_KEY: &str = "github.token";

/// Token resolvido e sua origem (`keyring`, `gh` ou `env`); `None` interno = ainda não resolvido.
static GITHUB_TOKEN: std::sync::Mutex<Option<Option<(String, &'static str)>>> = std::sync::Mutex::new(None);

fn keyring_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, GITHUB_TOKEN_KEY).map_err(|e| e.to_string())
}

/// Ordem: token salvo no chaveiro do sistema, `gh auth token`, `GH_TOKEN`/`GITHUB_TOKEN`.
fn resolve_github_token() -> Option<(String, &'static str)> {
    if let Some(t) = keyring_entry().ok().and_then(|e| e.get_password().ok()) {
        return Some((t, "keyring"));
    }

    let mut cmd = Command::new("gh");
    cmd.args(["auth", "token"]).stdin(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    if let Ok(out) = cmd.output() {
        let token = String::from_utf8_lossy(&out.stdout).trim().to_owned();
        if out.status.success() && !token.is_empty() {
            return Some((token, "gh"));
        }
    }

    ["GH_TOKEN", "GITHUB_TOKEN"]
        .iter()
        .find_map(|k| std::env::var(k).ok().filter(|v| !v.is_empty()))
        .map(|t| (t, "env"))
}

async fn github_token() -> Option<(String, &'static str)> {
    if let Some(cached) = GITHUB_TOKEN.lock().ok()?.clone() {
        return cached;
    }
    let resolved = tauri::async_runtime::spawn_blocking(resolve_github_token).await.ok().flatten();
    if let Ok(mut slot) = GITHUB_TOKEN.lock() {
        *slot = Some(resolved.clone());
    }
    resolved
}

/// De onde vem o token do GitHub: `keyring`, `gh`, `env` ou `none`. Nunca devolve o token.
#[tauri::command]
async fn github_auth_status() -> &'static str {
    github_token().await.map(|(_, src)| src).unwrap_or("none")
}

/// Salva (ou remove, com `token` nulo) o token do GitHub no chaveiro do sistema.
#[tauri::command]
async fn github_token_set(token: Option<String>) -> Result<&'static str, String> {
    let entry = keyring_entry()?;
    let res = match token.map(|t| t.trim().to_owned()).filter(|t| !t.is_empty()) {
        Some(t) => entry.set_password(&t),
        None => match entry.delete_credential() {
            Err(keyring::Error::NoEntry) => Ok(()),
            other => other,
        },
    };
    res.map_err(|e| format!("chaveiro do sistema indisponível: {e}"))?;
    if let Ok(mut slot) = GITHUB_TOKEN.lock() {
        *slot = None;
    }
    Ok(github_auth_status().await)
}

/// Primeiro argumento de linha de comando que seja um diretório (ex.: `gitfusion .`).
#[tauri::command]
fn startup_path() -> Option<String> {
    std::env::args()
        .skip(1)
        .find(|a| !a.starts_with('-'))
        .and_then(|a| std::fs::canonicalize(a).ok())
        .filter(|p| p.is_dir())
        .map(|p| p.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            run_git,
            path_exists,
            startup_path,
            open_path,
            open_url,
            http_request,
            github_auth_status,
            github_token_set
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o GitFusion");
}
