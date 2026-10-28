//! Adperastra setup launcher (Step 01a).
//!
//! Normal start: verify components silently (Instant tier), then hand over
//! to the main app. Missing components open the repair window; a fresh
//! profile opens the one-time first-run window. See plan/steps/step-01a.md.

mod theme;

use setup_core::i18n::t;
use setup_core::logfile::append_log;
use setup_core::manifest::{ComponentKind, Manifest};
use setup_core::profile::{free_disk_space, is_first_run, load_profile, save_profile, Profile};
use setup_core::verify::{missing_required, verify_all, Status};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};

#[derive(Default, Clone)]
struct Args {
    repair: bool,
    first_run: bool,
    reset_profile: bool,
    headless: bool,
    data_dir: Option<PathBuf>,
    manifest: Option<PathBuf>,
    app_exe: Option<PathBuf>,
    simulate_missing: Vec<String>,
}

/// `--simulate-missing` is a test flag: compiled in only for debug/test
/// builds, ignored (with a warning) in release builds.
const SIMULATE_ALLOWED: bool = cfg!(debug_assertions);

fn effective_simulate(ids: &[String], allowed: bool) -> Vec<String> {
    if allowed {
        ids.to_vec()
    } else {
        Vec::new()
    }
}

fn parse_args() -> Args {
    let mut a = Args::default();
    let mut it = std::env::args().skip(1);
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--repair" => a.repair = true,
            "--first-run" => a.first_run = true,
            "--reset-profile" => a.reset_profile = true,
            "--headless" => a.headless = true,
            "--data-dir" => a.data_dir = it.next().map(PathBuf::from),
            "--manifest" => a.manifest = it.next().map(PathBuf::from),
            "--app-exe" => a.app_exe = it.next().map(PathBuf::from),
            "--simulate-missing" => {
                if let Some(id) = it.next() {
                    a.simulate_missing.push(id);
                }
            }
            other => eprintln!("ignoring unknown argument: {other}"),
        }
    }
    a
}

fn fmt(template: &str, pairs: &[(&str, &str)]) -> String {
    let mut out = template.to_string();
    for (k, v) in pairs {
        out = out.replace(&format!("{{{k}}}"), v);
    }
    out
}

fn human_size(bytes: u64) -> String {
    const KB: f64 = 1024.0;
    let b = bytes as f64;
    if b < KB {
        format!("{bytes} B")
    } else if b < KB * KB {
        format!("{:.1} KB", b / KB)
    } else if b < KB * KB * KB {
        format!("{:.1} MB", b / (KB * KB))
    } else {
        format!("{:.2} GB", b / (KB * KB * KB))
    }
}

fn data_dir(args: &Args) -> PathBuf {
    if let Some(d) = &args.data_dir {
        return d.clone();
    }
    if let Ok(d) = std::env::var("ADPERASTRA_DATA_DIR") {
        if !d.is_empty() {
            return PathBuf::from(d);
        }
    }
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        return PathBuf::from(local).join("Adperastra");
    }
    PathBuf::from("adperastra-data")
}

fn exe_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
}

struct Cfg {
    manifest: Manifest,
    base_dir: PathBuf,
    data_dir: PathBuf,
    lang: String,
}

fn component_by_id<'m>(m: &'m Manifest, id: &str) -> Option<&'m setup_core::Component> {
    m.components.iter().find(|c| c.id == id)
}

/// Install every missing File component without a window. Returns exit code.
fn run_headless_repair(cfg: &Cfg, missing: &[String]) -> i32 {
    let mut failed = false;
    for id in missing {
        let Some(comp) = component_by_id(&cfg.manifest, id) else {
            continue;
        };
        match &comp.kind {
            ComponentKind::File { .. } => {
                let name = comp.id.clone();
                let res = setup_core::install::install_component(
                    comp,
                    &cfg.base_dir,
                    &cfg.base_dir,
                    &mut |f| {
                        append_log(&cfg.data_dir, &format!("install {name}: {:.0}%", f * 100.0))
                    },
                );
                match res {
                    Ok(()) => append_log(&cfg.data_dir, &format!("installed {id}")),
                    Err(e) => {
                        append_log(&cfg.data_dir, &format!("install failed {id}: {e}"));
                        failed = true;
                    }
                }
            }
            ComponentKind::AnyPath { .. } => {
                if comp.installer.is_some() {
                    let res = setup_core::install_runtime(
                        comp,
                        &cfg.base_dir,
                        &cfg.data_dir,
                        &mut |phase| match phase {
                            setup_core::RuntimeProgress::Downloading(f) => append_log(
                                &cfg.data_dir,
                                &format!("runtime {id} download: {:.0}%", f * 100.0),
                            ),
                            setup_core::RuntimeProgress::Installing => append_log(
                                &cfg.data_dir,
                                &format!("runtime {id} installing (Microsoft installer)"),
                            ),
                        },
                    );
                    match res {
                        Ok(()) => append_log(&cfg.data_dir, &format!("runtime installed {id}")),
                        Err(e) => {
                            append_log(&cfg.data_dir, &format!("runtime install failed {id}: {e}"));
                            failed = true;
                        }
                    }
                } else {
                    append_log(
                        &cfg.data_dir,
                        &format!("cannot auto-install runtime component {id} yet"),
                    );
                    failed = true;
                }
            }
        }
    }
    let reports = verify_all(&cfg.manifest, &cfg.base_dir, true);
    let still = missing_required(&cfg.manifest, &reports);
    if failed || !still.is_empty() {
        1
    } else {
        0
    }
}

fn main() {
    let args = parse_args();
    let data = data_dir(&args);
    let simulate = effective_simulate(&args.simulate_missing, SIMULATE_ALLOWED);
    if !args.simulate_missing.is_empty() && !SIMULATE_ALLOWED {
        append_log(
            &data,
            "warning: --simulate-missing ignored in release builds (development/test only)",
        );
        eprintln!("Adperastra setup: --simulate-missing is only available in development/test builds; ignoring it.");
    }
    if args.reset_profile {
        let _ = std::fs::remove_file(data.join("profile.json"));
        append_log(&data, "profile reset by --reset-profile");
    }
    let manifest_path = args
        .manifest
        .clone()
        .or_else(|| {
            let p = exe_dir().join("dependencies.json");
            if p.exists() {
                Some(p)
            } else {
                None
            }
        })
        .unwrap_or_else(|| PathBuf::from("dependencies.json"));
    let manifest = match setup_core::load_manifest(&manifest_path) {
        Ok(m) => m,
        Err(e) => {
            append_log(
                &data,
                &format!("manifest load failed {}: {e}", manifest_path.display()),
            );
            eprintln!(
                "Adperastra setup: cannot load {}: {e}",
                manifest_path.display()
            );
            std::process::exit(2);
        }
    };
    if manifest
        .signature
        .as_ref()
        .map(|s| s.public_key.is_empty())
        .unwrap_or(false)
    {
        append_log(
            &data,
            "manifest signature not configured (development build)",
        );
    }
    let base_dir = manifest_path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .map(|p| p.to_path_buf())
        .unwrap_or_else(exe_dir);
    let lang = load_profile(&data)
        .map(|p| p.language)
        .unwrap_or_else(|| "en".into());
    let theme_name = load_profile(&data)
        .map(|p| p.theme)
        .unwrap_or_else(|| "system".into());
    // Signature gate: never trust an unsigned or tampered manifest.
    let sig_status =
        setup_core::signature_status(&manifest, setup_core::signing::DEVELOPMENT_PUBLIC_KEY);
    let manifest = if sig_status != setup_core::SignatureStatus::Valid {
        append_log(
            &data,
            &format!("manifest signature rejected: {sig_status:?}"),
        );
        if args.headless {
            eprintln!("Adperastra setup: manifest signature missing or invalid ({sig_status:?}); refusing to start.");
            std::process::exit(4);
        }
        let fixed = Arc::new(AtomicBool::new(false));
        let app = SignatureApp::new(
            manifest_path.clone(),
            data.clone(),
            lang.clone(),
            theme_name.clone(),
            fixed.clone(),
        );
        let options = eframe::NativeOptions {
            viewport: egui::ViewportBuilder::default()
                .with_title(t(&lang, "signature.title"))
                .with_inner_size([520.0, 340.0]),
            ..Default::default()
        };
        let _ = eframe::run_native(
            "adperastra-setup",
            options,
            Box::new(|_cc| Ok(Box::new(app))),
        );
        if !fixed.load(Ordering::Relaxed) {
            std::process::exit(4);
        }
        match setup_core::load_manifest(&manifest_path) {
            Ok(m) => m,
            Err(e) => {
                append_log(
                    &data,
                    &format!("manifest reload after signature fix failed: {e}"),
                );
                std::process::exit(2);
            }
        }
    } else {
        manifest
    };

    let cfg = Cfg {
        manifest,
        base_dir,
        data_dir: data.clone(),
        lang,
    };

    let mut reports = verify_all(&cfg.manifest, &cfg.base_dir, args.repair);
    for id in &simulate {
        // Test flag: pretend a component is missing without touching the PC.
        if let Some(r) = reports.iter_mut().find(|r| &r.id == id) {
            r.status = Status::Broken("simulated missing (test flag)".into());
            append_log(&data, &format!("simulating missing component: {id}"));
        }
    }
    let missing = missing_required(&cfg.manifest, &reports);
    append_log(
        &data,
        &format!(
            "verify: {} components, {} missing required",
            reports.len(),
            missing.len()
        ),
    );

    if !missing.is_empty() || args.repair {
        if args.headless {
            std::process::exit(run_headless_repair(&cfg, &missing));
        }
        let bad: HashSet<String> = reports
            .iter()
            .filter(|r| r.status != Status::Ok)
            .map(|r| r.id.clone())
            .collect();
        let app = RepairApp::new(&cfg, bad, theme_name.clone());
        let options = eframe::NativeOptions {
            viewport: egui::ViewportBuilder::default()
                .with_title(t(&cfg.lang, "window.preparing"))
                .with_inner_size([520.0, 380.0]),
            ..Default::default()
        };
        let _ = eframe::run_native(
            "adperastra-setup",
            options,
            Box::new(|_cc| Ok(Box::new(app))),
        );
        let reports = verify_all(&cfg.manifest, &cfg.base_dir, true);
        if !missing_required(&cfg.manifest, &reports).is_empty() {
            append_log(&data, "repair window closed with components still missing");
            std::process::exit(1);
        }
    }

    if is_first_run(&data) || args.first_run {
        if args.headless {
            append_log(&data, "first run required (headless: not completing it)");
            std::process::exit(3);
        }
        let app = WizardApp::new(&cfg, theme_name.clone());
        let options = eframe::NativeOptions {
            viewport: egui::ViewportBuilder::default()
                .with_title(t(&cfg.lang, "window.welcome"))
                .with_inner_size([640.0, 560.0]),
            ..Default::default()
        };
        let _ = eframe::run_native(
            "adperastra-setup",
            options,
            Box::new(|_cc| Ok(Box::new(app))),
        );
    }

    // Silent success path: no window, hand over to the main app if present.
    append_log(&data, "verify ok (silent start)");
    let app_exe = args.app_exe.clone().or_else(|| {
        let p = cfg.base_dir.join("Adperastra.exe");
        if p.exists() {
            Some(p)
        } else {
            None
        }
    });
    match app_exe {
        Some(exe) => {
            append_log(&data, &format!("starting main app: {}", exe.display()));
            let _ = std::process::Command::new(&exe).spawn();
        }
        None => append_log(&data, "main app not present yet (step 01b)"),
    }
}

// ---------- Repair window ----------

enum Msg {
    Progress(String, f32),
    Installing(String),
    Done(String, Result<(), String>),
}

struct Row {
    id: String,
    label: String,
    detail: String,
    frac: f32,
    installing: bool,
    status: String,
    error: Option<String>,
}

struct RepairApp {
    manifest: Manifest,
    base_dir: PathBuf,
    lang: String,
    theme_name: String,
    fonts_done: bool,
    rows: Vec<Row>,
    rx: Option<mpsc::Receiver<Msg>>,
    cancel: Arc<AtomicBool>,
    running: bool,
    started: bool,
}

impl RepairApp {
    fn new(cfg: &Cfg, bad: HashSet<String>, theme_name: String) -> Self {
        let rows = cfg
            .manifest
            .components
            .iter()
            .filter(|c| bad.contains(&c.id))
            .map(|c| Row {
                id: c.id.clone(),
                label: t(&cfg.lang, &c.name_key),
                detail: format!("{} | {}", c.version, human_size(c.size.unwrap_or(0))),
                frac: 0.0,
                installing: false,
                status: t(&cfg.lang, "repair.checking"),
                error: None,
            })
            .collect();
        Self {
            manifest: cfg.manifest.clone(),
            base_dir: cfg.base_dir.clone(),
            lang: cfg.lang.clone(),
            theme_name,
            fonts_done: false,
            rows,
            rx: None,
            cancel: Arc::new(AtomicBool::new(false)),
            running: false,
            started: false,
        }
    }

    fn start_worker(&mut self) {
        let (tx, rx) = mpsc::channel();
        self.rx = Some(rx);
        self.running = true;
        self.started = true;
        self.cancel.store(false, Ordering::Relaxed);
        let manifest = self.manifest.clone();
        let base = self.base_dir.clone();
        let cancel = self.cancel.clone();
        let ids: Vec<String> = self.rows.iter().map(|r| r.id.clone()).collect();
        std::thread::spawn(move || {
            for id in ids {
                if cancel.load(Ordering::Relaxed) {
                    break;
                }
                let Some(comp) = manifest.components.iter().find(|c| c.id == id) else {
                    continue;
                };
                match &comp.kind {
                    ComponentKind::File { .. } => {
                        let tx2 = tx.clone();
                        let id2 = id.clone();
                        let res =
                            setup_core::install::install_component(comp, &base, &base, &mut |f| {
                                let _ = tx2.send(Msg::Progress(id2.clone(), f));
                            })
                            .map_err(|e| e.to_string());
                        let _ = tx.send(Msg::Done(id, res));
                    }
                    ComponentKind::AnyPath { .. } => {
                        if comp.installer.is_some() {
                            let tx2 = tx.clone();
                            let id2 = id.clone();
                            let work = std::env::temp_dir().join("adperastra-installers");
                            let res =
                                setup_core::install_runtime(comp, &base, &work, &mut |phase| {
                                    match phase {
                                        setup_core::RuntimeProgress::Downloading(f) => {
                                            let _ = tx2.send(Msg::Progress(id2.clone(), f));
                                        }
                                        setup_core::RuntimeProgress::Installing => {
                                            let _ = tx2.send(Msg::Installing(id2.clone()));
                                        }
                                    }
                                })
                                .map_err(|e| e.to_string());
                            let _ = tx.send(Msg::Done(id, res));
                        } else {
                            let _ = tx.send(Msg::Done(id, Err("not-installable".into())));
                        }
                    }
                }
            }
        });
    }

    fn all_ok(&self) -> bool {
        self.started
            && !self.running
            && self
                .rows
                .iter()
                .all(|r| !r.installing && r.error.is_none() && r.frac >= 1.0)
    }
}

impl eframe::App for RepairApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        if !self.fonts_done {
            theme::install_fonts(ctx, &self.base_dir);
            theme::apply(
                ctx,
                self.theme_name == "dark"
                    || (self.theme_name == "system" && theme::system_dark(ctx)),
            );
            self.fonts_done = true;
        }
        if !self.started {
            self.start_worker();
        }
        if let Some(rx) = &self.rx {
            while let Ok(msg) = rx.try_recv() {
                match msg {
                    Msg::Progress(id, f) => {
                        if let Some(r) = self.rows.iter_mut().find(|r| r.id == id) {
                            r.frac = f;
                            r.status =
                                fmt(&t(&self.lang, "repair.installing"), &[("name", &r.label)]);
                        }
                    }
                    Msg::Installing(id) => {
                        self.running = true;
                        if let Some(r) = self.rows.iter_mut().find(|r| r.id == id) {
                            r.installing = true;
                            r.status = fmt(&t(&self.lang, "repair.runtime"), &[("name", &r.label)]);
                        }
                    }
                    Msg::Done(id, res) => {
                        if let Some(r) = self.rows.iter_mut().find(|r| r.id == id) {
                            match res {
                                Ok(()) => {
                                    r.frac = 1.0;
                                    r.status = t(&self.lang, "repair.done");
                                }
                                Err(e) => {
                                    r.error = Some(e);
                                    r.status =
                                        fmt(&t(&self.lang, "repair.failed"), &[("name", &r.label)]);
                                }
                            }
                        }
                    }
                }
            }
        }
        if self.running
            && self
                .rows
                .iter()
                .all(|r| !r.installing && (r.frac >= 1.0 || r.error.is_some()))
        {
            self.running = false;
        }
        if self.running || self.rows.iter().any(|r| r.installing) {
            ctx.request_repaint_after(std::time::Duration::from_millis(50));
        }
        egui::CentralPanel::default().show(ctx, |ui| {
            ui.heading(t(&self.lang, "window.preparing"));
            ui.add_space(8.0);
            let lang = self.lang.clone();
            for r in &mut self.rows {
                ui.label(format!("{} ({})", r.label, r.detail));
                if r.installing {
                    ui.add(
                        egui::ProgressBar::new(0.0)
                            .animate(true)
                            .desired_width(f32::INFINITY),
                    );
                } else {
                    ui.add(egui::ProgressBar::new(r.frac).show_percentage());
                }
                ui.small(&r.status);
                if let Some(e) = &r.error {
                    if e.contains("hash mismatch") || e.contains("size mismatch") {
                        ui.label(t(&lang, "repair.checksum_mismatch"));
                    } else if e.contains("download") || e.contains("http") || e.contains("url") {
                        ui.label(fmt(&t(&lang, "repair.offline"), &[("name", &r.label)]));
                    }
                }
                ui.add_space(6.0);
            }
            ui.horizontal(|ui| {
                if self.running && ui.button(t(&lang, "button.cancel")).clicked() {
                    self.cancel.store(true, Ordering::Relaxed);
                }
                if !self.running && !self.all_ok() && ui.button(t(&lang, "button.retry")).clicked()
                {
                    for r in &mut self.rows {
                        if r.error.is_some() {
                            r.error = None;
                            r.frac = 0.0;
                            r.installing = false;
                        }
                    }
                    self.start_worker();
                }
                if self.all_ok() && ui.button(t(&lang, "button.continue")).clicked() {
                    ctx.send_viewport_cmd(egui::ViewportCommand::Close);
                }
            });
        });
    }
}

// ---------- First-run window ----------

struct WizardApp {
    base_dir: PathBuf,
    data_dir: PathBuf,
    lang: String,
    theme: String,
    packs: Vec<setup_core::Pack>,
    required: Vec<(String, String)>,
    selected: HashSet<String>,
    fonts_done: bool,
}

impl WizardApp {
    fn new(cfg: &Cfg, theme_name: String) -> Self {
        Self {
            base_dir: cfg.base_dir.clone(),
            data_dir: cfg.data_dir.clone(),
            lang: cfg.lang.clone(),
            theme: theme_name,
            packs: cfg.manifest.optional_packs.clone(),
            required: cfg
                .manifest
                .components
                .iter()
                .filter(|c| c.required)
                .map(|c| (t(&cfg.lang, &c.name_key), c.version.clone()))
                .collect(),
            selected: HashSet::new(),
            fonts_done: false,
        }
    }
}

impl eframe::App for WizardApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        if !self.fonts_done {
            theme::install_fonts(ctx, &self.base_dir);
            self.fonts_done = true;
        }
        let dark = self.theme == "dark" || (self.theme == "system" && theme::system_dark(ctx));
        theme::apply(ctx, dark);
        let lang = self.lang.clone();
        egui::CentralPanel::default().show(ctx, |ui| {
            egui::ScrollArea::vertical().show(ui, |ui| {
                ui.heading(t(&lang, "window.welcome"));
                ui.add_space(10.0);

                ui.label(t(&lang, "first.language"));
                ui.radio_value(&mut self.lang, "en".to_string(), "English");
                ui.radio_value(&mut self.lang, "es".to_string(), "Espanol (Latinoamerica)");
                ui.add_space(10.0);

                ui.label(t(&lang, "first.theme"));
                ui.radio_value(
                    &mut self.theme,
                    "light".to_string(),
                    t(&lang, "theme.light"),
                );
                ui.radio_value(&mut self.theme, "dark".to_string(), t(&lang, "theme.dark"));
                ui.radio_value(
                    &mut self.theme,
                    "system".to_string(),
                    t(&lang, "theme.system"),
                );
                ui.add_space(10.0);

                ui.label(t(&lang, "first.packs"));
                for (label, version) in &self.required {
                    let mut on = true;
                    ui.add_enabled(
                        false,
                        egui::Checkbox::new(
                            &mut on,
                            format!("{label} ({version}) - {}", t(&lang, "first.included")),
                        ),
                    );
                }
                let packs = self.packs.clone();
                for p in &packs {
                    let mut on = self.selected.contains(&p.id);
                    let text = format!(
                        "{} ({} / {})",
                        t(&lang, &p.name_key),
                        human_size(p.download_size),
                        human_size(p.install_size)
                    );
                    if ui.checkbox(&mut on, text).changed() {
                        if on {
                            self.selected.insert(p.id.clone());
                        } else {
                            self.selected.remove(&p.id);
                        }
                    }
                    ui.small(t(&lang, &p.desc_key));
                    ui.small(t(&lang, "first.later"));
                    ui.add_space(4.0);
                }
                ui.add_space(6.0);
                let free = human_size(free_disk_space(&self.data_dir));
                ui.label(fmt(&t(&lang, "first.free_space"), &[("space", &free)]));
                ui.small(t(&lang, "first.packs_note"));
                ui.add_space(10.0);
                if ui.button(t(&lang, "button.continue")).clicked() {
                    let mut packs_selected: Vec<String> = self.selected.iter().cloned().collect();
                    packs_selected.sort();
                    let profile = Profile {
                        schema: 1,
                        language: self.lang.clone(),
                        theme: self.theme.clone(),
                        packs_selected,
                        first_run_completed: true,
                    };
                    match save_profile(&self.data_dir, &profile) {
                        Ok(()) => append_log(&self.data_dir, "first-run choices saved"),
                        Err(e) => append_log(&self.data_dir, &format!("profile save failed: {e}")),
                    }
                    ctx.send_viewport_cmd(egui::ViewportCommand::Close);
                }
            });
        });
    }
}

// ---------- Signature error window ----------

struct SignatureApp {
    manifest_path: PathBuf,
    data_dir: PathBuf,
    lang: String,
    theme_name: String,
    fixed: Arc<AtomicBool>,
    note: String,
    fonts_done: bool,
}

impl SignatureApp {
    fn new(
        manifest_path: PathBuf,
        data_dir: PathBuf,
        lang: String,
        theme_name: String,
        fixed: Arc<AtomicBool>,
    ) -> Self {
        Self {
            manifest_path,
            data_dir,
            lang,
            theme_name,
            fixed,
            note: String::new(),
            fonts_done: false,
        }
    }
}

impl eframe::App for SignatureApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        if !self.fonts_done {
            theme::install_fonts(ctx, &exe_dir());
            let dark = self.theme_name == "dark"
                || (self.theme_name == "system" && theme::system_dark(ctx));
            theme::apply(ctx, dark);
            self.fonts_done = true;
        }
        let lang = self.lang.clone();
        egui::CentralPanel::default().show(ctx, |ui| {
            ui.heading(t(&lang, "signature.title"));
            ui.add_space(8.0);
            ui.label(t(&lang, "signature.body"));
            if !self.note.is_empty() {
                ui.add_space(6.0);
                ui.label(&self.note);
            }
            ui.add_space(10.0);
            ui.horizontal(|ui| {
                if ui.button(t(&lang, "signature.repair")).clicked() {
                    match setup_core::load_manifest(&self.manifest_path) {
                        Ok(m) => {
                            let status = setup_core::signature_status(
                                &m,
                                setup_core::signing::DEVELOPMENT_PUBLIC_KEY,
                            );
                            if status == setup_core::SignatureStatus::Valid {
                                append_log(&self.data_dir, "signature ok after repair check");
                                self.fixed.store(true, Ordering::Relaxed);
                                ctx.send_viewport_cmd(egui::ViewportCommand::Close);
                            } else {
                                append_log(
                                    &self.data_dir,
                                    &format!("signature still invalid: {status:?}"),
                                );
                                self.note = format!("{status:?}");
                            }
                        }
                        Err(e) => {
                            self.note = e.to_string();
                        }
                    }
                }
                if ui.button(t(&lang, "signature.close")).clicked() {
                    ctx.send_viewport_cmd(egui::ViewportCommand::Close);
                }
            });
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn simulate_ids_kept_in_development_builds() {
        let ids = vec!["webview2".to_string()];
        assert_eq!(effective_simulate(&ids, true), ids);
    }

    #[test]
    fn simulate_ids_dropped_in_release_builds() {
        let ids = vec!["webview2".to_string()];
        assert!(effective_simulate(&ids, false).is_empty());
    }
}
