use base64::Engine as _;
use libloading::Library;
use std::ffi::{c_char, c_int, c_void, CString};
use std::path::{Path as ThumbnailPath, PathBuf as ThumbnailPathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, OnceLock};
use std::time::{Duration, Instant};

type MpvCreate = unsafe extern "C" fn() -> *mut c_void;
type MpvSetOptionString = unsafe extern "C" fn(*mut c_void, *const c_char, *const c_char) -> c_int;
type MpvInitialize = unsafe extern "C" fn(*mut c_void) -> c_int;
type MpvCommand = unsafe extern "C" fn(*mut c_void, *const *const c_char) -> c_int;
type MpvWaitEvent = unsafe extern "C" fn(*mut c_void, f64) -> *const c_void;
type MpvTerminateDestroy = unsafe extern "C" fn(*mut c_void);

struct MpvApi {
    _library: Library,
    create: MpvCreate,
    set_option_string: MpvSetOptionString,
    initialize: MpvInitialize,
    command: MpvCommand,
    wait_event: MpvWaitEvent,
    terminate_destroy: MpvTerminateDestroy,
}

impl MpvApi {
    fn load(path: &ThumbnailPath) -> Result<Self, String> {
        unsafe {
            let library = Library::new(path)
                .map_err(|e| format!("加载缩略图解码器失败: {} ({})", e, path.display()))?;
            let create = *library.get::<MpvCreate>(b"mpv_create\0").map_err(|e| e.to_string())?;
            let set_option_string = *library
                .get::<MpvSetOptionString>(b"mpv_set_option_string\0")
                .map_err(|e| e.to_string())?;
            let initialize = *library
                .get::<MpvInitialize>(b"mpv_initialize\0")
                .map_err(|e| e.to_string())?;
            let command = *library.get::<MpvCommand>(b"mpv_command\0").map_err(|e| e.to_string())?;
            let wait_event = *library
                .get::<MpvWaitEvent>(b"mpv_wait_event\0")
                .map_err(|e| e.to_string())?;
            let terminate_destroy = *library
                .get::<MpvTerminateDestroy>(b"mpv_terminate_destroy\0")
                .map_err(|e| e.to_string())?;
            Ok(Self {
                _library: library,
                create,
                set_option_string,
                initialize,
                command,
                wait_event,
                terminate_destroy,
            })
        }
    }

    fn set_option(&self, handle: *mut c_void, name: &str, value: &str) -> Result<(), String> {
        let name = CString::new(name).map_err(|e| e.to_string())?;
        let value = CString::new(value).map_err(|e| e.to_string())?;
        let result = unsafe { (self.set_option_string)(handle, name.as_ptr(), value.as_ptr()) };
        if result < 0 {
            return Err(format!("libmpv 选项设置失败: {} ({})", name.to_string_lossy(), result));
        }
        Ok(())
    }

    fn run_command(&self, handle: *mut c_void, values: &[String]) -> Result<(), String> {
        let strings = values
            .iter()
            .map(|value| CString::new(value.as_str()).map_err(|e| e.to_string()))
            .collect::<Result<Vec<_>, _>>()?;
        let mut pointers = strings.iter().map(|value| value.as_ptr()).collect::<Vec<_>>();
        pointers.push(std::ptr::null());
        let result = unsafe { (self.command)(handle, pointers.as_ptr()) };
        if result < 0 {
            return Err(format!("libmpv 命令失败: {} ({})", values.join(" "), result));
        }
        Ok(())
    }
}

struct ThumbnailDecoder {
    api: MpvApi,
    handle: *mut c_void,
    video_path: ThumbnailPathBuf,
    output_dir: ThumbnailPathBuf,
    sequence: u64,
}

static THUMBNAIL_DECODER_ID: AtomicU64 = AtomicU64::new(1);

impl ThumbnailDecoder {
    fn open(video_path: &ThumbnailPath, time: f64) -> Result<(Self, String), String> {
        if !video_path.is_file() {
            return Err("视频文件不存在".to_string());
        }
        let api = MpvApi::load(&thumbnail_mpv_library_path())?;
        let handle = unsafe { (api.create)() };
        if handle.is_null() {
            return Err("创建缩略图解码器失败".to_string());
        }

        let output_dir = portable_app_dir().join("temp").join(format!(
            "timeline_{}_{}_{}",
            std::process::id(),
            chrono_like_millis(),
            THUMBNAIL_DECODER_ID.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&output_dir).map_err(|e| e.to_string())?;
        let output_dir_string = output_dir.to_string_lossy().to_string();
        let options = [
            ("vo", "image".to_string()),
            ("audio", "no".to_string()),
            ("hwdec", "auto-safe".to_string()),
            ("pause", "yes".to_string()),
            ("start", format!("{:.3}", time.max(0.0))),
            ("vf", "scale=160:90:force_original_aspect_ratio=decrease,pad=160:90:-1:-1".to_string()),
            ("vo-image-outdir", output_dir_string),
            ("vo-image-format", "jpg".to_string()),
            ("vo-image-jpeg-quality", "70".to_string()),
            ("really-quiet", "yes".to_string()),
        ];
        for (name, value) in options {
            if let Err(error) = api.set_option(handle, name, &value) {
                unsafe { (api.terminate_destroy)(handle) };
                return Err(error);
            }
        }
        let initialized = unsafe { (api.initialize)(handle) };
        if initialized < 0 {
            unsafe { (api.terminate_destroy)(handle) };
            return Err(format!("初始化缩略图解码器失败 ({})", initialized));
        }

        let mut decoder = Self {
            api,
            handle,
            video_path: video_path.to_path_buf(),
            output_dir,
            sequence: 0,
        };
        decoder.api.run_command(
            decoder.handle,
            &["loadfile".to_string(), video_path.to_string_lossy().to_string()],
        )?;
        let first_frame = decoder.wait_for_next_frame(Duration::from_secs(3))?;
        Ok((decoder, first_frame))
    }

    fn frame_at(&mut self, time: f64, exact: bool) -> Result<String, String> {
        self.api.run_command(
            self.handle,
            &[
                "seek".to_string(),
                format!("{:.3}", time.max(0.0)),
                if exact {
                    "absolute+exact".to_string()
                } else {
                    "absolute+keyframes".to_string()
                },
            ],
        )?;
        self.wait_for_next_frame(Duration::from_secs(2))
    }

    fn wait_for_next_frame(&mut self, timeout: Duration) -> Result<String, String> {
        let next_sequence = self.sequence + 1;
        let path = self.output_dir.join(format!("{:08}.jpg", next_sequence));
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            unsafe { (self.api.wait_event)(self.handle, 0.03) };
            if path.is_file() {
                let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
                let _ = std::fs::remove_file(&path);
                self.sequence = next_sequence;
                return Ok(format!(
                    "data:image/jpeg;base64,{}",
                    base64::engine::general_purpose::STANDARD.encode(bytes)
                ));
            }
        }
        Err("视频预览帧解码超时".to_string())
    }
}

fn thumbnail_mpv_library_path() -> ThumbnailPathBuf {
    std::env::var_os("HANIME_MPV_LIBRARY")
        .map(ThumbnailPathBuf::from)
        .unwrap_or_else(|| portable_app_dir().join("lib").join("libmpv-2.dll"))
}

impl Drop for ThumbnailDecoder {
    fn drop(&mut self) {
        unsafe { (self.api.terminate_destroy)(self.handle) };
        let _ = std::fs::remove_dir(&self.output_dir);
    }
}

struct ThumbnailRequest {
    video_path: ThumbnailPathBuf,
    time: f64,
    exact: bool,
    response: mpsc::Sender<Result<String, String>>,
}

struct ThumbnailWorker {
    sender: mpsc::Sender<ThumbnailRequest>,
}

impl ThumbnailWorker {
    fn start() -> Self {
        let (sender, receiver) = mpsc::channel::<ThumbnailRequest>();
        std::thread::Builder::new()
            .name("timeline-thumbnail-decoder".to_string())
            .spawn(move || {
                let mut decoder: Option<ThumbnailDecoder> = None;
                while let Ok(request) = receiver.recv() {
                    let result = if decoder
                        .as_ref()
                        .map(|value| value.video_path.as_path())
                        != Some(request.video_path.as_path())
                    {
                        match ThumbnailDecoder::open(&request.video_path, request.time) {
                            Ok((value, first_frame)) => {
                                decoder = Some(value);
                                Ok(first_frame)
                            }
                            Err(error) => {
                                decoder = None;
                                Err(error)
                            }
                        }
                    } else {
                        decoder
                            .as_mut()
                            .expect("matching decoder must exist")
                            .frame_at(request.time, request.exact)
                    };
                    let _ = request.response.send(result);
                }
            })
            .expect("failed to start timeline thumbnail decoder");
        Self { sender }
    }

    fn request(
        &self,
        video_path: ThumbnailPathBuf,
        time: f64,
        exact: bool,
    ) -> Result<String, String> {
        let (response_sender, response_receiver) = mpsc::channel();
        self.sender
            .send(ThumbnailRequest {
                video_path,
                time,
                exact,
                response: response_sender,
            })
            .map_err(|_| "缩略图解码线程已停止".to_string())?;
        response_receiver
            .recv_timeout(Duration::from_secs(5))
            .map_err(|_| "缩略图解码响应超时".to_string())?
    }
}

static INTERACTIVE_THUMBNAIL_WORKER: OnceLock<ThumbnailWorker> = OnceLock::new();
static PREFETCH_THUMBNAIL_WORKER: OnceLock<ThumbnailWorker> = OnceLock::new();
static PREFETCH_BATCH_LOCK: OnceLock<std::sync::Mutex<()>> = OnceLock::new();

#[derive(serde::Serialize)]
struct TimelineThumbnailFrame {
    time: f64,
    image_data: String,
}

#[tauri::command]
async fn get_video_thumbnail(
    video_path: String,
    time: f64,
    exact: Option<bool>,
) -> Result<CapturedFrameData, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let image_data = INTERACTIVE_THUMBNAIL_WORKER
            .get_or_init(ThumbnailWorker::start)
            .request(
                ThumbnailPathBuf::from(video_path),
                time,
                exact.unwrap_or(false),
            )?;
        Ok(CapturedFrameData { image_data })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn prime_video_thumbnail(video_path: String) -> Result<CapturedFrameData, String> {
    get_video_thumbnail(video_path, 0.0, Some(false)).await
}

#[tauri::command]
async fn prefetch_video_thumbnails(
    video_path: String,
    times: Vec<f64>,
) -> Result<Vec<TimelineThumbnailFrame>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _batch_guard = PREFETCH_BATCH_LOCK
            .get_or_init(|| std::sync::Mutex::new(()))
            .lock()
            .map_err(|e| e.to_string())?;
        let worker = PREFETCH_THUMBNAIL_WORKER.get_or_init(ThumbnailWorker::start);
        let path = ThumbnailPathBuf::from(video_path);
        let mut frames = Vec::with_capacity(times.len());
        for time in times.into_iter().take(24) {
            let safe_time = time.max(0.0);
            let image_data = worker.request(path.clone(), safe_time, false)?;
            frames.push(TimelineThumbnailFrame {
                time: safe_time,
                image_data,
            });
        }
        Ok(frames)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod thumbnail_tests {
    use super::*;

    fn jpeg_dimensions(data_url: &str) -> Option<(u16, u16)> {
        let encoded = data_url.split_once(',')?.1;
        let bytes = base64::engine::general_purpose::STANDARD.decode(encoded).ok()?;
        let mut index = 2;
        while index + 8 < bytes.len() {
            if bytes[index] != 0xff {
                index += 1;
                continue;
            }
            let marker = bytes[index + 1];
            if matches!(marker, 0xc0 | 0xc1 | 0xc2 | 0xc3 | 0xc5 | 0xc6 | 0xc7) {
                let height = u16::from_be_bytes([bytes[index + 5], bytes[index + 6]]);
                let width = u16::from_be_bytes([bytes[index + 7], bytes[index + 8]]);
                return Some((width, height));
            }
            if index + 3 >= bytes.len() {
                break;
            }
            let length = u16::from_be_bytes([bytes[index + 2], bytes[index + 3]]) as usize;
            if length < 2 {
                break;
            }
            index += length + 2;
        }
        None
    }

    #[test]
    fn decodes_real_frames_without_a_window() {
        let Some(video_path) = std::env::var_os("HANIME_TEST_VIDEO") else {
            return;
        };
        let (mut decoder, first) =
            ThumbnailDecoder::open(ThumbnailPath::new(&video_path), 60.0).unwrap();
        assert!(first.starts_with("data:image/jpeg;base64,"));
        assert!(first.len() > 1_000);
        assert_eq!(jpeg_dimensions(&first), Some((160, 90)));
        let started = Instant::now();
        let second = decoder.frame_at(120.0, false).unwrap();
        println!("warm thumbnail latency: {:?}", started.elapsed());
        assert!(second.starts_with("data:image/jpeg;base64,"));
        assert!(second.len() > 1_000);
        assert_ne!(first, second);
        let exact = decoder.frame_at(121.37, true).unwrap();
        assert_eq!(jpeg_dimensions(&exact), Some((160, 90)));
    }

    #[test]
    fn decodes_with_two_windowless_workers() {
        let Some(video_path) = std::env::var_os("HANIME_TEST_VIDEO") else {
            return;
        };
        let first_path = video_path.clone();
        let second_path = video_path;
        let first = std::thread::spawn(move || {
            ThumbnailDecoder::open(ThumbnailPath::new(&first_path), 90.0)
                .map(|(_, frame)| frame)
        });
        let second = std::thread::spawn(move || {
            ThumbnailDecoder::open(ThumbnailPath::new(&second_path), 180.0)
                .map(|(_, frame)| frame)
        });
        let first_frame = first.join().unwrap().unwrap();
        let second_frame = second.join().unwrap().unwrap();
        assert!(first_frame.len() > 1_000);
        assert!(second_frame.len() > 1_000);
        assert_ne!(first_frame, second_frame);
    }
}
