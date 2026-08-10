/// Tauri's build step generates the context the application is compiled against
/// — the config, the capabilities, the icons. The library in `src/plan.rs` needs
/// none of that, and `tauri_build::build()` panics without the `tauri` crate
/// beside it, so it only runs for a real application build.
///
/// This is what lets `cargo test --lib --no-default-features` run the plan and
/// lock tests on a machine with no webview toolchain installed.
fn main() {
    if std::env::var_os("CARGO_FEATURE_DESKTOP").is_some() {
        tauri_build::build();
    }
}
