use serde::Serialize;
use std::path::{Path, PathBuf};

/// 只进系统回收站。不要在这里改成永久删除或多次覆写。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashReport {
    pub path: String,
    pub name: String,
    pub ext: String,
    pub bytes: u64,
    pub is_dir: bool,
    pub trashed: bool,
    pub error: Option<String>,
    pub thumbnail: Option<String>,
    pub snippet: Option<String>,
}

pub fn move_to_trash(paths: Vec<String>) -> Vec<TrashReport> {
    let _own = crate::watch::OwnTrash::enter();
    let mut seen = std::collections::BTreeSet::new();
    let mut reports = Vec::new();
    let mut ql_budget: usize = 2; // 一次性拖入多文件时，耗时的 QuickLook 外部进程全局最多调 2 次，保证毫秒级即时响应！
    for raw in paths {
        let path = raw.trim().to_string();
        if path.is_empty() || !seen.insert(path.clone()) {
            continue;
        }
        let allow_ql = ql_budget > 0;
        reports.push(trash_one(path, allow_ql, &mut ql_budget));
    }
    reports
}

fn trash_one(path: String, allow_ql: bool, ql_budget: &mut usize) -> TrashReport {
    let file = PathBuf::from(&path);
    let name = file
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.clone());
    let ext = file
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    let meta = match std::fs::symlink_metadata(&file) {
        Ok(meta) => meta,
        Err(_) => {
            return TrashReport {
                path,
                name,
                ext,
                bytes: 0,
                is_dir: false,
                trashed: false,
                error: Some("找不到这个文件".into()),
                thumbnail: None,
                snippet: None,
            };
        }
    };

    if is_unsafe_target(&file) {
        return TrashReport {
            path,
            name,
            ext,
            bytes: 0,
            is_dir: meta.is_dir(),
            trashed: false,
            error: Some("这个位置不能整夹放进回收站".into()),
            thumbnail: None,
            snippet: None,
        };
    }

    let is_dir = meta.is_dir();
    let bytes = if meta.is_file() { meta.len() } else { 0 };
    let cloud_only = is_cloud_placeholder(&file, &meta, is_dir, bytes);

    // 在移入回收站之前抓取缩略图或文本摘录（图片/代码文本瞬时读取，慢速 QuickLook 严格受限预算）
    let (thumbnail, snippet) = if !is_dir && !cloud_only {
        capture_preview_safe(&file, &ext, bytes, allow_ql, ql_budget)
    } else {
        (None, None)
    };

    match delete_to_system_trash(&file) {
        Ok(()) => {
            crate::watch::mark_own_trashed(&name);
            TrashReport {
                path,
                name,
                ext,
                bytes,
                is_dir,
                trashed: true,
                error: None,
                thumbnail,
                snippet,
            }
        }
        Err(err) => TrashReport {
            path,
            name,
            ext,
            bytes,
            is_dir,
            trashed: false,
            error: Some(format!("回收站没收下：{err}")),
            thumbnail: None,
            snippet: None,
        },
    }
}

/// 识别 macOS iCloud 未下载到本地的云端占位文件（.icloud 或 APFS dataless 文件），
/// 避免读取内容或调用 QuickLook 时触发内核阻塞等待云端下载。
fn is_cloud_placeholder(file: &Path, meta: &std::fs::Metadata, is_dir: bool, bytes: u64) -> bool {
    if let Some(name) = file.file_name().and_then(|n| n.to_str()) {
        if name.starts_with('.') && name.ends_with(".icloud") {
            return true;
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        // 非空普通文件若占用 0 个物理磁盘块，在 APFS/iCloud Drive 上即为未下载的 dataless 占位文件
        if !is_dir && bytes > 0 && meta.blocks() == 0 {
            return true;
        }
    }
    let _ = (meta, is_dir, bytes);
    false
}

/// 在 macOS 上优先使用原生 NSFileManager.trashItemAtURL，
/// 彻底避免默认 Finder AppleEvent 删除 iCloud Drive 文件时卡死或等待弹窗。
fn delete_to_system_trash(file: &Path) -> Result<(), trash::Error> {
    #[cfg(target_os = "macos")]
    {
        use trash::macos::{DeleteMethod, TrashContextExtMacos};
        let mut ctx = trash::TrashContext::new();
        ctx.set_delete_method(DeleteMethod::NsFileManager);
        ctx.delete(file)
    }
    #[cfg(not(target_os = "macos"))]
    {
        trash::delete(file)
    }
}

pub fn capture_preview_safe(
    file: &Path,
    ext: &str,
    bytes: u64,
    allow_ql: bool,
    ql_budget: &mut usize,
) -> (Option<String>, Option<String>) {
    if let Ok(meta) = std::fs::symlink_metadata(file) {
        if meta.is_dir() || is_cloud_placeholder(file, &meta, meta.is_dir(), bytes) {
            return (None, None);
        }
    }
    capture_preview(file, ext, bytes, allow_ql, ql_budget)
}

fn capture_preview(
    file: &Path,
    ext: &str,
    bytes: u64,
    allow_ql: bool,
    ql_budget: &mut usize,
) -> (Option<String>, Option<String>) {
    // 1. 常见图片直接读取编码（<= 2.5MB 时零开销瞬时返回）
    let direct_mime = match ext {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "webp" => Some("image/webp"),
        "gif" => Some("image/gif"),
        _ => None,
    };

    if let Some(mime) = direct_mime {
        if bytes > 0 && bytes <= 2_500_000 {
            if let Ok(raw) = std::fs::read(file) {
                return (Some(format!("data:{mime};base64,{}", encode_base64(&raw))), None);
            }
        }
    }

    // 2. 纯文本/代码文件读取前 320 字节用于纸张微缩排版
    const TEXT_EXTS: &[&str] = &[
        "txt", "md", "markdown", "json", "js", "ts", "jsx", "tsx", "py", "rs", "go", "css",
        "html", "xml", "yml", "yaml", "toml", "csv", "log", "sh", "sql",
    ];
    if TEXT_EXTS.contains(&ext) && bytes > 0 {
        if let Ok(mut f) = std::fs::File::open(file) {
            use std::io::Read;
            let mut buf = vec![0u8; 360];
            if let Ok(n) = f.read(&mut buf) {
                buf.truncate(n);
                let text = String::from_utf8_lossy(&buf).trim().to_string();
                if !text.is_empty() {
                    return (None, Some(text));
                }
            }
        }
    }

    // 3. macOS QuickLook 缩略图：仅在有预算时执行，避免拖入多文件时串行卡顿
    #[cfg(target_os = "macos")]
    if allow_ql && *ql_budget > 0 {
        *ql_budget -= 1;
        if let Some(data_url) = quicklook_thumbnail(file) {
            return (Some(data_url), None);
        }
    }

    (None, None)
}

#[cfg(target_os = "macos")]
fn quicklook_thumbnail(file: &Path) -> Option<String> {
    use std::process::Command;
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("shredder-thumb-{stamp}"));
    std::fs::create_dir_all(&dir).ok()?;

    let mut child = Command::new("qlmanage")
        .args(["-t", "-s", "340", "-o"])
        .arg(&dir)
        .arg(file)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .ok()?;

    // 严控 220ms 超时保护：绝不拖延主界面动效启动
    let deadline = Instant::now() + Duration::from_millis(220);
    let mut succeeded = false;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                succeeded = status.success();
                break;
            }
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    break;
                }
                std::thread::sleep(Duration::from_millis(25));
            }
            Err(_) => break,
        }
    }

    let mut result = None;
    if succeeded {
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.extension().and_then(|e| e.to_str()) == Some("png") {
                    if let Ok(raw) = std::fs::read(&p) {
                        if !raw.is_empty() && raw.len() <= 1_800_000 {
                            result = Some(format!("data:image/png;base64,{}", encode_base64(&raw)));
                        }
                    }
                    break;
                }
            }
        }
    }

    let _ = std::fs::remove_dir_all(&dir);
    result
}

fn encode_base64(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((input.len() + 2) / 3 * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[((n >> 18) & 63) as usize] as char);
        out.push(TABLE[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 { TABLE[((n >> 6) & 63) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { TABLE[(n & 63) as usize] as char } else { '=' });
    }
    out
}

pub fn is_unsafe_target(path: &Path) -> bool {
    if is_blocked(path) {
        return true;
    }
    match path.canonicalize() {
        Ok(canonical) => is_blocked(&canonical),
        Err(_) => false,
    }
}

fn is_blocked(path: &Path) -> bool {
    if let Some(home) = home_dir() {
        if path == home {
            return true;
        }
    }

    let text = path.to_string_lossy();
    let lower = text.to_ascii_lowercase();
    if lower == "/" || lower == "c:\\" || lower == "c:/" {
        return true;
    }

    const UNIX: &[&str] = &[
        "/system",
        "/usr",
        "/bin",
        "/sbin",
        "/library",
        "/applications",
        "/users",
        "/private",
        "/volumes",
        "/opt",
        "/var",
        "/etc",
        "/tmp",
        "/dev",
    ];
    if UNIX.iter().any(|item| lower == *item) {
        return true;
    }

    const WINDOWS: &[&str] = &[
        "c:\\windows",
        "c:\\program files",
        "c:\\program files (x86)",
        "c:\\users",
    ];
    WINDOWS.iter().any(|item| lower == *item)
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_home_root_and_system() {
        let home = home_dir().expect("home");
        assert!(is_unsafe_target(&home));
        assert!(is_unsafe_target(Path::new("/")));
        assert!(is_unsafe_target(Path::new("/System")));
        assert!(is_blocked(Path::new("C:\\Windows")));
    }

    #[test]
    fn allows_a_normal_file() {
        let home = home_dir().expect("home");
        let file = home.join("Desktop").join("合同.pdf");
        assert!(!is_unsafe_target(&file));
    }

    #[test]
    fn missing_file_is_reported() {
        let report = move_to_trash(vec!["/tmp/shredder-does-not-exist-xyz.pdf".into()]);
        assert_eq!(report.len(), 1);
        assert!(!report[0].trashed);
        assert_eq!(report[0].error.as_deref(), Some("找不到这个文件"));
    }

    #[test]
    fn puts_a_real_file_in_the_trash() {
        let path = std::env::temp_dir().join(format!("shredder-trash-{}.txt", std::process::id()));
        std::fs::write(&path, "放进回收站").unwrap();
        let report = move_to_trash(vec![path.display().to_string()]);
        assert!(report[0].trashed, "{:?}", report[0].error);
        assert!(!path.exists());
        assert_eq!(report[0].name, path.file_name().unwrap().to_string_lossy());
    }
}
