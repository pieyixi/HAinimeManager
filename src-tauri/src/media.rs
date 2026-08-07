#[tauri::command]
fn prepare_temp_frame_capture() -> Result<CapturePath, String> {
    let dir = portable_app_dir().join("temp");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(CapturePath {
        path: dir
            .join(format!(
                "mpv_frame_{}_{}.jpg",
                std::process::id(),
                chrono_like_millis()
            ))
            .to_string_lossy()
            .to_string(),
    })
}
#[tauri::command]
fn read_image_data(path: String) -> Result<CapturedFrameData, String> {
    use base64::Engine as _;
    let temp_path = std::path::PathBuf::from(path);
    if !temp_path.is_file() {
        return Err("图片文件不存在".to_string());
    }
    let data = std::fs::read(&temp_path).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&temp_path);
    Ok(CapturedFrameData {
        image_data: format!(
            "data:image/jpeg;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(data)
        ),
    })
}

fn chrono_like_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

#[tauri::command]
fn play_video(video_path: String) -> Result<(), String> {
    let player = std::env::var("POTPLAYER_PATH").unwrap_or_else(|_| {
        let paths = [
            r"C:\Program Files\DAUM\PotPlayer\PotPlayerMini64.exe",
            r"C:\Program Files\PotPlayer\PotPlayer.exe",
            r"C:\Program Files (x86)\PotPlayer\PotPlayer.exe",
        ];
        paths
            .iter()
            .find(|p| std::path::Path::new(p).exists())
            .map(|s| s.to_string())
            .unwrap_or_default()
    });

    if !player.is_empty() {
        std::process::Command::new(&player)
            .arg(&video_path)
            .spawn()
            .map_err(|e| format!("启动播放器失败: {}", e))?;
    } else {
        // Fallback: open with system default
        open::that(&video_path).map_err(|e| format!("打开文件失败: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
fn get_studios(db: State<Database>) -> Result<Vec<String>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT DISTINCT Studio FROM Works WHERE Studio != '' ORDER BY Studio")
        .map_err(|e| e.to_string())?;
    let studios = stmt
        .query_map([], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(studios)
}

#[derive(Clone, Copy)]
struct PlayerWindowPlacement {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    was_maximized: bool,
}

static PLAYER_WINDOW_PLACEMENT: std::sync::OnceLock<
    std::sync::Mutex<Option<PlayerWindowPlacement>>,
> = std::sync::OnceLock::new();

#[cfg(windows)]
static PLAYER_FULLSCREEN_ACTIVE: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

#[cfg(windows)]
fn place_player_above_taskbar(window: &tauri::Window, topmost: bool) -> Result<(), String> {
    use std::sync::atomic::Ordering;
    use windows_sys::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_NOTOPMOST, HWND_TOPMOST, SWP_FRAMECHANGED, SWP_NOACTIVATE,
        SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW,
    };

    let hwnd = window.hwnd().map_err(|error| error.to_string())?.0;
    let insert_after = if topmost { HWND_TOPMOST } else { HWND_NOTOPMOST };
    let fullscreen = PLAYER_FULLSCREEN_ACTIVE.load(Ordering::SeqCst);
    let result = if fullscreen && topmost {
        let monitor = unsafe { MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST) };
        if monitor.is_null() {
            return Err("无法确定播放器所在显示器".to_string());
        }
        let mut info: MONITORINFO = unsafe { std::mem::zeroed() };
        info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        if unsafe { GetMonitorInfoW(monitor, &mut info) } == 0 {
            return Err(format!("读取显示器边界失败: {}", std::io::Error::last_os_error()));
        }
        unsafe {
            SetWindowPos(
                hwnd,
                insert_after,
                info.rcMonitor.left,
                info.rcMonitor.top,
                info.rcMonitor.right - info.rcMonitor.left,
                info.rcMonitor.bottom - info.rcMonitor.top,
                SWP_FRAMECHANGED | SWP_SHOWWINDOW,
            )
        }
    } else {
        unsafe {
            SetWindowPos(
                hwnd,
                insert_after,
                0,
                0,
                0,
                0,
                SWP_FRAMECHANGED | SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE,
            )
        }
    };
    if result == 0 {
        Err(format!("更新播放器全屏层级失败: {}", std::io::Error::last_os_error()))
    } else {
        Ok(())
    }
}

#[cfg(windows)]
fn place_player_in_work_area(window: &tauri::Window) -> Result<(), String> {
    use windows_sys::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_NOTOPMOST, SWP_FRAMECHANGED, SWP_SHOWWINDOW,
    };

    let hwnd = window.hwnd().map_err(|error| error.to_string())?.0;
    let monitor = unsafe { MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST) };
    if monitor.is_null() {
        return Err("无法确定播放器所在显示器".to_string());
    }
    let mut info: MONITORINFO = unsafe { std::mem::zeroed() };
    info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
    if unsafe { GetMonitorInfoW(monitor, &mut info) } == 0 {
        return Err(format!("读取显示器工作区失败: {}", std::io::Error::last_os_error()));
    }
    let result = unsafe {
        SetWindowPos(
            hwnd,
            HWND_NOTOPMOST,
            info.rcWork.left,
            info.rcWork.top,
            info.rcWork.right - info.rcWork.left,
            info.rcWork.bottom - info.rcWork.top,
            SWP_FRAMECHANGED | SWP_SHOWWINDOW,
        )
    };
    if result == 0 {
        Err(format!("恢复播放器最大化边界失败: {}", std::io::Error::last_os_error()))
    } else {
        Ok(())
    }
}

#[cfg(windows)]
fn sync_player_fullscreen_focus(window: &tauri::Window, focused: bool) {
    use std::sync::atomic::Ordering;
    if PLAYER_FULLSCREEN_ACTIVE.load(Ordering::SeqCst) {
        let _ = place_player_above_taskbar(window, focused);
    }
}

#[cfg(not(windows))]
fn sync_player_fullscreen_focus(_window: &tauri::Window, _focused: bool) {}

#[tauri::command]
fn set_player_fullscreen(window: tauri::Window, enabled: bool) -> Result<(), String> {
    let placement = PLAYER_WINDOW_PLACEMENT.get_or_init(|| std::sync::Mutex::new(None));
    if enabled {
        let position = window.outer_position().map_err(|e| e.to_string())?;
        let size = window.inner_size().map_err(|e| e.to_string())?;
        let was_maximized = window.is_maximized().map_err(|e| e.to_string())?;
        *placement.lock().map_err(|e| e.to_string())? = Some(PlayerWindowPlacement {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
            was_maximized,
        });
        // WebView2/Tauri can move a transparent borderless window off-screen when
        // fullscreen is entered directly from the Windows maximized state.
        // Normalize it first; the frontend awaits this whole command, so it never
        // renders the temporary restored state.
        if was_maximized {
            window.unmaximize().map_err(|e| e.to_string())?;
        }
        if let Err(error) = window.set_fullscreen(true) {
            if was_maximized {
                let _ = window.maximize();
            }
            *placement.lock().map_err(|e| e.to_string())? = None;
            return Err(error.to_string());
        }
        #[cfg(windows)]
        {
            use std::sync::atomic::Ordering;
            PLAYER_FULLSCREEN_ACTIVE.store(true, Ordering::SeqCst);
            place_player_above_taskbar(&window, true)?;
        }
    } else {
        #[cfg(windows)]
        {
            use std::sync::atomic::Ordering;
            PLAYER_FULLSCREEN_ACTIVE.store(false, Ordering::SeqCst);
        }
        let previous = placement.lock().map_err(|e| e.to_string())?.take();
        window.set_fullscreen(false).map_err(|e| e.to_string())?;
        #[cfg(windows)]
        place_player_above_taskbar(&window, false)?;
        if previous.map(|value| value.was_maximized).unwrap_or(false) {
            window.maximize().map_err(|e| e.to_string())?;
            #[cfg(windows)]
            place_player_in_work_area(&window)?;
        } else if let Some(previous) = previous {
            window.unmaximize().map_err(|e| e.to_string())?;
            window
                .set_position(tauri::PhysicalPosition::new(previous.x, previous.y))
                .map_err(|e| e.to_string())?;
            window
                .set_size(tauri::PhysicalSize::new(previous.width, previous.height))
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
