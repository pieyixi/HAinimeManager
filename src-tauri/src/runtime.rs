pub fn run() {
    let db = init_db();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_libmpv::init())
        .manage(db)
        .invoke_handler(tauri::generate_handler![
            get_all_works_with_tags,
            get_work_detail,
            get_tags,
            scan_folder,
            delete_work,
            open_folder,
            get_years,
            get_studios,
            sync_database,
            batch_import_folders,
            prepare_temp_frame_capture,
            read_image_data,
            backup_database,
            backup_data_package,
            restore_database,
            load_cover_cache,
            import_work_via_json,
            inspect_archive_folder,
            save_archive_draft,
            save_archive_json,
            save_archive_cover,
            save_archive_episode_covers,
            detect_duplicates,
            list_unarchived_folders,
            play_video,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
