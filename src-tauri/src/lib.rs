//! Núcleo Rust do GitFusion.
//!
//! Toda a lógica de Git (parsers, grafo, staging parcial) vive no frontend em
//! TypeScript. Aqui só expomos o mínimo: executar o `git` do sistema e
//! consultar o sistema de arquivos. Usar o binário real do Git garante
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
        .invoke_handler(tauri::generate_handler![run_git, path_exists, startup_path])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o GitFusion");
}
