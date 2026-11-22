use notify::Watcher;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{mpsc, LazyLock, Mutex};
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Incoming {
    name: String,
    ext: String,
    bytes: u64,
    is_dir: bool,
    thumbnail: Option<String>,
    snippet: Option<String>,
}

struct State {
    own: usize,
    known: HashSet<String>,
}

static STATE: LazyLock<Mutex<State>> = LazyLock::new(|| {
    Mutex::new(State {
        own: 0,
        known: HashSet::new(),
    })
});

static RECENT_OWN_TRASHED: LazyLock<Mutex<HashMap<String, std::time::Instant>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

pub fn mark_own_trashed(name: &str) {
    if let Ok(mut map) = RECENT_OWN_TRASHED.lock() {
        let now = std::time::Instant::now();
        map.retain(|_, time| now.duration_since(*time).as_secs() < 5);
        map.insert(name.to_string(), now);
    }
}

pub fn is_recent_own_trashed(name: &str) -> bool {
    if let Ok(mut map) = RECENT_OWN_TRASHED.lock() {
        let now = std::time::Instant::now();
        map.retain(|_, time| now.duration_since(*time).as_secs() < 5);
        map.contains_key(name)
    } else {
        false
    }
}

/// 自己放进回收站的那一段时间内，监听不要再报一次。
pub struct OwnTrash;

impl OwnTrash {
    pub fn enter() -> Self {
        if let Ok(mut state) = STATE.lock() {
            state.own += 1;
        }
        Self
    }
}

impl Drop for OwnTrash {
    fn drop(&mut self) {
        if let Ok(mut state) = STATE.lock() {
            state.known = list_keys();
            state.own = state.own.saturating_sub(1);
        }
    }
}

pub fn can_read_local_trash() -> bool {
    #[cfg(target_os = "macos")]
    {
        if let Some(home) = std::env::var_os("HOME") {
            let local = PathBuf::from(home).join(".Trash");
            return std::fs::read_dir(&local).is_ok();
        }
    }
    true
}

pub fn start(app: AppHandle) {
    std::thread::Builder::new()
        .name("trash-watch".into())
        .spawn(move || watch_loop(app))
        .ok();
}

#[derive(PartialEq, Eq, Clone)]
struct DirStamp {
    mtime: Option<SystemTime>,
    ctime: i64,
    size: u64,
}

fn dir_stamps(dirs: &[PathBuf]) -> HashMap<PathBuf, DirStamp> {
    dirs.iter()
        .map(|d| {
            let stamp = match std::fs::metadata(d) {
                Ok(m) => {
                    #[cfg(unix)]
                    let (ctime, size) = {
                        use std::os::unix::fs::MetadataExt;
                        (m.ctime(), m.size())
                    };
                    #[cfg(not(unix))]
                    let (ctime, size) = (0, m.len());
                    DirStamp {
                        mtime: m.modified().ok(),
                        ctime,
                        size,
                    }
                }
                Err(_) => DirStamp {
                    mtime: None,
                    ctime: 0,
                    size: 0,
                },
            };
            (d.clone(), stamp)
        })
        .collect()
}

fn watch_loop(app: AppHandle) {
    let mut watched_dirs = trash_dirs();
    eprintln!(
        "[shredder/watch] 启动废纸篓监听，已挂载目录: {:?} (本机 ~/.Trash 可读: {})",
        watched_dirs,
        can_read_local_trash()
    );

    if let Ok(mut state) = STATE.lock() {
        state.known = list_keys_in(&watched_dirs);
    }

    let (tx, rx) = mpsc::channel();
    let tx_watch = tx.clone();
    let mut watcher = notify::recommended_watcher(move |res| {
        let _ = tx_watch.send(res);
    })
    .ok();
    if let Some(watcher) = watcher.as_mut() {
        for dir in &watched_dirs {
            let _ = watcher.watch(dir, notify::RecursiveMode::NonRecursive);
        }
    }
    let _hold = tx;

    let mut last_stamps = dir_stamps(&watched_dirs);
    let mut tick_count: u64 = 0;

    loop {
        // 事件驱动 + 1 秒极轻量 stat() 探测（检测 mtime + ctime + dir size，避免同秒漏检）
        let got_event = match rx.recv_timeout(Duration::from_millis(1000)) {
            Ok(_) => true,
            Err(mpsc::RecvTimeoutError::Timeout) => false,
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                std::thread::sleep(Duration::from_secs(2));
                false
            }
        };
        while rx.try_recv().is_ok() {}

        tick_count += 1;
        // 每 ~15 秒检查是否有新可用的废纸篓目录
        if tick_count % 15 == 0 {
            let fresh_dirs = trash_dirs();
            if fresh_dirs != watched_dirs {
                if let Some(w) = watcher.as_mut() {
                    for d in &fresh_dirs {
                        if !watched_dirs.contains(d) {
                            let _ = w.watch(d, notify::RecursiveMode::NonRecursive);
                        }
                    }
                }
                watched_dirs = fresh_dirs;
                last_stamps = dir_stamps(&watched_dirs);
                if let Ok(mut state) = STATE.lock() {
                    state.known = list_keys_in(&watched_dirs);
                }
                continue;
            }
        }

        let cur_stamps = dir_stamps(&watched_dirs);
        let stamp_changed = cur_stamps != last_stamps;
        if !got_event && !stamp_changed {
            continue;
        }

        // 收到系统事件后短暂等待 260ms，让 Finder 完成文件移入（避免同秒竞态漏检）
        std::thread::sleep(Duration::from_millis(260));
        while rx.try_recv().is_ok() {}
        last_stamps = dir_stamps(&watched_dirs);

        let batch = commit_new(&watched_dirs);
        if batch.is_empty() {
            continue;
        }
        eprintln!("[shredder/watch] 捕获快捷键删除 {} 个文件，触发碎纸动效", batch.len());
        if let Some(win) = app.get_webview_window("main") {
            let _ = win.show();
        }
        let _ = app.emit("trash-incoming", &batch);
    }
}

fn commit_new(dirs: &[PathBuf]) -> Vec<Incoming> {
    let Ok(mut state) = STATE.lock() else {
        return Vec::new();
    };
    let current = list_keys_in(dirs);
    if state.own > 0 {
        state.known = current;
        return Vec::new();
    }
    let mut keys = unknown(&state.known, &current, false);
    keys.sort();
    state.known = current;
    let mut ql_budget: usize = 2;
    keys.into_iter()
        .filter_map(|key| {
            let mut parts = key.splitn(3, '\u{0}');
            let _dir = parts.next().unwrap_or("");
            let raw_name = parts.next().unwrap_or(&key);
            let display_name = clean_display_name(raw_name);
            if is_recent_own_trashed(&display_name) || is_recent_own_trashed(raw_name) {
                return None;
            }
            Some(describe(key, &mut ql_budget))
        })
        .collect()
}

fn unknown(known: &HashSet<String>, current: &HashSet<String>, busy: bool) -> Vec<String> {
    if busy {
        return Vec::new();
    }
    current
        .iter()
        .filter(|key| !known.contains(*key))
        .cloned()
        .collect()
}

fn trash_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    #[cfg(target_os = "macos")]
    if let Some(home) = std::env::var_os("HOME") {
        let home = PathBuf::from(home);
        for dir in [
            home.join(".Trash"),
            home.join("Library/Mobile Documents/.Trash"),
            home.join("Library/Mobile Documents/com~apple~CloudDocs/.Trash"),
        ] {
            if dir.is_dir() && std::fs::read_dir(&dir).is_ok() {
                dirs.push(dir);
            }
        }
    }
    dirs
}

fn list_keys() -> HashSet<String> {
    list_keys_in(&trash_dirs())
}

fn list_keys_in(dirs: &[PathBuf]) -> HashSet<String> {
    let mut keys = HashSet::new();
    for dir in dirs {
        let Ok(read) = std::fs::read_dir(dir) else {
            continue;
        };
        for entry in read.flatten() {
            let raw = entry.file_name();
            let name = raw.to_string_lossy();
            if name.starts_with('.') && !name.ends_with(".icloud") {
                continue;
            }
            // 将 inode 与 ctime 编入指纹：即使把文件放回原处再删同名文件，也能 100% 重新触发！
            let sig = entry
                .metadata()
                .ok()
                .map(|m| {
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::MetadataExt;
                        format!("{}:{}", m.ino(), m.ctime())
                    }
                    #[cfg(not(unix))]
                    {
                        format!("{}", m.len())
                    }
                })
                .unwrap_or_default();
            keys.insert(format!("{}\u{0}{name}\u{0}{sig}", dir.display()));
        }
    }
    keys
}

fn clean_display_name(raw_name: &str) -> String {
    if raw_name.starts_with('.') && raw_name.ends_with(".icloud") && raw_name.len() > 8 {
        return raw_name[1..raw_name.len() - 7].to_string();
    }
    raw_name.to_string()
}

fn describe(key: String, ql_budget: &mut usize) -> Incoming {
    let mut parts = key.splitn(3, '\u{0}');
    let dir = parts.next().unwrap_or("");
    let raw_name = parts.next().unwrap_or(&key);
    let path = Path::new(dir).join(raw_name);
    let display_name = clean_display_name(raw_name);
    let meta = std::fs::symlink_metadata(&path).ok();
    let is_dir = meta.as_ref().is_some_and(|item| item.is_dir());
    let bytes = meta
        .as_ref()
        .map(|item| if item.is_file() { item.len() } else { 0 })
        .unwrap_or(0);
    let ext = Path::new(&display_name)
        .extension()
        .map(|item| item.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    let (thumbnail, snippet) = if !is_dir {
        let allow_ql = *ql_budget > 0;
        crate::trash::capture_preview_safe(&path, &ext, bytes, allow_ql, ql_budget)
    } else {
        (None, None)
    };

    Incoming {
        name: display_name,
        ext,
        bytes,
        is_dir,
        thumbnail,
        snippet,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_names_are_the_ones_not_already_known() {
        let mut known = HashSet::new();
        known.insert("a".into());
        let mut current = HashSet::new();
        current.insert("a".into());
        current.insert("b".into());
        let fresh = unknown(&known, &current, false);
        assert_eq!(fresh, vec!["b".to_string()]);
    }

    #[test]
    fn own_trash_hides_the_batch() {
        let mut known = HashSet::new();
        known.insert("a".into());
        let mut current = HashSet::new();
        current.insert("a".into());
        current.insert("b".into());
        assert!(unknown(&known, &current, true).is_empty());
    }

    #[test]
    fn cleans_icloud_placeholder_name() {
        assert_eq!(clean_display_name(".报告.pdf.icloud"), "报告.pdf");
        assert_eq!(clean_display_name("正常.png"), "正常.png");
    }
}
