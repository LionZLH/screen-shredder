mod trash;
mod watch;

use serde::Serialize;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, PhysicalPosition, PhysicalSize, Position, Size, WebviewWindow,
};

#[derive(Serialize)]
struct Pointer {
    x: f64,
    y: f64,
}

#[tauri::command]
async fn move_to_trash(paths: Vec<String>) -> Result<Vec<trash::TrashReport>, String> {
    tauri::async_runtime::spawn_blocking(move || trash::move_to_trash(paths))
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
fn ready(window: WebviewWindow) -> Result<(), String> {
    place(&window)?;
    window
        .set_ignore_cursor_events(true)
        .map_err(|err| err.to_string())?;
    window.show().map_err(|err| err.to_string())?;
    Ok(())
}

#[tauri::command]
fn pin_window(window: WebviewWindow) -> Result<(), String> {
    place(&window)?;
    Ok(())
}

#[tauri::command]
fn set_pass_through(window: WebviewWindow, pass: bool) -> Result<(), String> {
    window
        .set_ignore_cursor_events(pass)
        .map_err(|err| err.to_string())
}

#[tauri::command]
fn pointer(window: WebviewWindow) -> Result<Pointer, String> {
    let cursor = window.cursor_position().map_err(|err| err.to_string())?;
    let origin = window.outer_position().map_err(|err| err.to_string())?;
    let scale = window.scale_factor().map_err(|err| err.to_string())?;
    Ok(Pointer {
        x: (cursor.x - origin.x as f64) / scale,
        y: (cursor.y - origin.y as f64) / scale,
    })
}

/// macOS Force Touch 触控板微震反馈 (0 = Generic, 1 = Alignment, 2 = LevelChange)
#[tauri::command]
fn haptic(window: WebviewWindow, pattern: Option<isize>) {
    #[cfg(target_os = "macos")]
    {
        let pat = pattern.unwrap_or(1);
        let _ = window.run_on_main_thread(move || unsafe {
            if let Some(cls) = objc2::runtime::AnyClass::get(c"NSHapticFeedbackManager") {
                let performer: *mut objc2::runtime::AnyObject =
                    objc2::msg_send![cls, defaultPerformer];
                if !performer.is_null() {
                    // NSHapticFeedbackPerformanceTimeNow = 1
                    let _: () = objc2::msg_send![performer, performFeedbackPattern: pat, performanceTime: 1usize];
                }
            }
        });
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, pattern);
    }
}

fn place(window: &WebviewWindow) -> Result<(), String> {
    let monitor = window
        .primary_monitor()
        .map_err(|err| err.to_string())?
        .ok_or("找不到主屏幕")?;
    let area = monitor.work_area();
    let scale = monitor.scale_factor();
    let width = (390.0 * scale).round() as u32;
    let height = area.size.height;
    let x = area.position.x + area.size.width as i32 - width as i32;
    let y = area.position.y;

    let current_pos = window.outer_position().map_err(|err| err.to_string())?;
    let current_size = window.outer_size().map_err(|err| err.to_string())?;
    if current_pos.x != x || current_pos.y != y {
        window
            .set_position(Position::Physical(PhysicalPosition::new(x, y)))
            .map_err(|err| err.to_string())?;
    }
    if current_size.width != width || current_size.height != height {
        window
            .set_size(Size::Physical(PhysicalSize::new(width, height)))
            .map_err(|err| err.to_string())?;
    }
    let _ = window.set_visible_on_all_workspaces(true);
    lift_above_other_windows(window);
    Ok(())
}

fn lift_above_other_windows(window: &WebviewWindow) {
    #[cfg(target_os = "macos")]
    {
        let Ok(raw) = window.ns_window() else {
            return;
        };
        let raw = raw as usize;
        let _ = window.run_on_main_thread(move || unsafe {
            let ns = raw as *mut objc2::runtime::AnyObject;
            // NSStatusWindowLevel。比普通窗口高，工作区又不盖住菜单栏。
            let _: () = objc2::msg_send![ns, setLevel: 25isize];
            let _: () = objc2::msg_send![ns, setHidesOnDeactivate: false];
        });
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = window.set_always_on_top(true);
    }
}

fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let watch_label = if watch::can_read_local_trash() {
        "快捷键监听：已就绪"
    } else {
        "快捷键监听：需授完全磁盘访问权限"
    };
    let watch_status = MenuItem::with_id(app, "watch-status", watch_label, false, None::<&str>)?;
    let sep0 = PredefinedMenuItem::separator(app)?;
    let pick = MenuItem::with_id(app, "pick", "选择文件放入回收站", true, None::<&str>)?;
    let folder = MenuItem::with_id(app, "folder", "选择文件夹放入回收站", true, None::<&str>)?;
    let dump = MenuItem::with_id(app, "dump", "倒掉纸屑", true, None::<&str>)?;
    let skin = MenuItem::with_id(app, "skin", "切换外观皮肤 (黑曜石暗黑 / 纯白极简)", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&watch_status, &sep0, &pick, &folder, &dump, &skin, &sep, &quit])?;

    let mut tray = TrayIconBuilder::new()
        .tooltip("屏幕碎纸机")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "quit" => app.exit(0),
            "pick" => emit(app, "menu-pick"),
            "folder" => emit(app, "menu-folder"),
            "dump" => emit(app, "menu-dump"),
            "skin" => emit(app, "menu-skin"),
            _ => {}
        });

    if let Ok(icon) = tauri::image::Image::from_bytes(include_bytes!("../icons/tray-template.png")) {
        tray = tray.icon(icon);
    } else if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }

    #[cfg(target_os = "macos")]
    {
        tray = tray.icon_as_template(true);
    }

    tray.build(app)?;
    Ok(())
}

fn emit(app: &tauri::AppHandle, event: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_ignore_cursor_events(false);
        let _ = window.emit(event, ());
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            move_to_trash,
            ready,
            pin_window,
            set_pass_through,
            pointer,
            haptic
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            watch::start(app.handle().clone());
            setup_tray(app)?;
            if let Some(window) = app.get_webview_window("main") {
                let _ = place(&window);
                let _ = window.set_ignore_cursor_events(true);
                let fallback = window.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(2));
                    let _ = fallback.set_ignore_cursor_events(true);
                    let _ = fallback.show();
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("屏幕碎纸机启动失败");
}
