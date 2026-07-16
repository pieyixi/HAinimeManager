fn main() {
    copy_libmpv_runtime_libs();
    tauri_build::build();
}

fn copy_libmpv_runtime_libs() {
    let manifest_dir = match std::env::var("CARGO_MANIFEST_DIR") {
        Ok(value) => std::path::PathBuf::from(value),
        Err(_) => return,
    };
    let source_dir = manifest_dir.join("lib");
    if !source_dir.is_dir() {
        return;
    }

    let out_dir = match std::env::var("OUT_DIR") {
        Ok(value) => std::path::PathBuf::from(value),
        Err(_) => return,
    };
    let profile_dir = out_dir
        .ancestors()
        .find(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .map(|name| name == "debug" || name == "release")
                .unwrap_or(false)
        })
        .map(|path| path.to_path_buf());
    let Some(profile_dir) = profile_dir else {
        return;
    };

    let target_dir = profile_dir.join("lib");
    let _ = std::fs::create_dir_all(&target_dir);
    for file_name in ["libmpv-wrapper.dll", "libmpv-2.dll"] {
        let source = source_dir.join(file_name);
        if source.is_file() {
            let _ = std::fs::copy(source, target_dir.join(file_name));
        }
    }
}
