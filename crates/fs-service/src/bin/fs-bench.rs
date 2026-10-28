//! Folder-listing benchmark (plan/speed.md). Developer-only tool.
//!
//! Usage:
//!   fs-bench generate <dir> <count>   create a corpus folder of small files
//!   fs-bench bench <dir> [runs]       compare list_dir_std vs list_dir_with_ids

use fs_service::{list_dir_std, list_dir_with_ids, SortSpec};
use std::path::Path;
use std::time::Instant;

fn generate(dir: &Path, count: usize) {
    std::fs::create_dir_all(dir).expect("create corpus dir");
    for i in 0..count {
        let path = dir.join(format!("file-{i:06}.txt"));
        if !path.exists() {
            std::fs::write(&path, b"x").expect("write corpus file");
        }
        if i % 10000 == 0 {
            eprintln!("generated {i}/{count}");
        }
    }
    for i in 0..100 {
        let sub = dir.join(format!("folder-{i:03}"));
        std::fs::create_dir_all(&sub).expect("create corpus subfolder");
    }
}

fn median(mut values: Vec<f64>) -> f64 {
    values.sort_by(|a, b| a.partial_cmp(b).unwrap());
    values[values.len() / 2]
}

fn bench(dir: &Path, runs: usize) {
    // Warm-up (filesystem caches, first-call setup).
    let std_warm = list_dir_std(dir, SortSpec::default()).expect("std listing");
    let ids_warm = list_dir_with_ids(dir, SortSpec::default()).expect("ids listing");
    assert_eq!(std_warm.items.len(), ids_warm.items.len(), "listings disagree on item count");
    let filled = ids_warm.items.iter().filter(|i| i.attrs.file_id.is_some()).count();

    let mut std_ms = Vec::new();
    let mut ids_ms = Vec::new();
    for run in 0..runs {
        if run % 2 == 0 {
            let t = Instant::now();
            let _ = list_dir_std(dir, SortSpec::default()).unwrap();
            std_ms.push(t.elapsed().as_secs_f64() * 1000.0);
            let t = Instant::now();
            let _ = list_dir_with_ids(dir, SortSpec::default()).unwrap();
            ids_ms.push(t.elapsed().as_secs_f64() * 1000.0);
        } else {
            let t = Instant::now();
            let _ = list_dir_with_ids(dir, SortSpec::default()).unwrap();
            ids_ms.push(t.elapsed().as_secs_f64() * 1000.0);
            let t = Instant::now();
            let _ = list_dir_std(dir, SortSpec::default()).unwrap();
            std_ms.push(t.elapsed().as_secs_f64() * 1000.0);
        }
    }
    println!(
        "{{\"items\":{},\"file_ids_filled\":{},\"runs\":{},\"std_median_ms\":{:.1},\"ids_median_ms\":{:.1},\"std_min_ms\":{:.1},\"ids_min_ms\":{:.1}}}",
        std_warm.items.len(),
        filled,
        runs,
        median(std_ms.clone()),
        median(ids_ms.clone()),
        std_ms.iter().cloned().fold(f64::MAX, f64::min),
        ids_ms.iter().cloned().fold(f64::MAX, f64::min),
    );
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(|s| s.as_str()) {
        Some("generate") => {
            let dir = Path::new(args.get(2).expect("generate needs a dir"));
            let count: usize = args.get(3).expect("generate needs a count").parse().expect("count");
            generate(dir, count);
        }
        Some("bench") => {
            let dir = Path::new(args.get(2).expect("bench needs a dir"));
            let runs: usize = args.get(3).and_then(|s| s.parse().ok()).unwrap_or(5);
            bench(dir, runs);
        }
        _ => {
            eprintln!("usage: fs-bench generate <dir> <count> | fs-bench bench <dir> [runs]");
            std::process::exit(2);
        }
    }
}