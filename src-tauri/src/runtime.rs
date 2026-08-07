pub fn run() {
    let db = init_db();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_libmpv::init())
        .manage(db)
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Focused(focused) = event {
                sync_player_fullscreen_focus(window, *focused);
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_all_works_with_tags,
            get_work_detail,
            get_favorite_characters,
            set_character_favorite,
            get_tags,
            initialize_media_library,
            bind_media_library,
            delete_work,
            open_folder,
            get_studios,
            batch_import_folders,
            get_library_console_summary,
            scan_library_changes,
            apply_library_updates,
            prepare_temp_frame_capture,
            read_image_data,
            get_video_thumbnail,
            prime_video_thumbnail,
            prefetch_video_thumbnails,
            release_video_thumbnail_decoders,
            backup_database,
            backup_data_package,
            restore_database,
            load_cover_cache,
            import_work_via_json,
            ensure_archive_data_dir,
            inspect_archive_folder,
            save_archive_draft,
            save_archive_json,
            save_archive_cover,
            save_archive_episode_covers,
            detect_duplicates,
            list_unarchived_folders,
            play_video,
            set_player_fullscreen,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
