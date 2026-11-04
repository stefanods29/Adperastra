//! Step 18b T5: guarded layered project format.
//!
//! These tests exercise the pure native codec: strict entry names, hashes,
//! zstd bounds, unknown extensions and the frozen capture identity. They do
//! not run the Tauri command layer or a filesystem.

use std::io::{Cursor, Write};

use image_edit::project::{
    decode_project, encode_project, inspect_project, sha256_hex, Guide, GuideAxis,
    ImageProjectManifest, ProjectCapture, ProjectError, ProjectExtension, ProjectPayloads,
    ProjectTile, ProjectTileKind,
};
use image_edit::project_tiles::compress_tile;
use image_edit::types::{ImageAdjustments, ImageGeometry, ImageSize};
use serde_json::{json, Value};
use uuid::Uuid;

fn tile_ref(id: Uuid, width: u32, height: u32) -> Value {
    json!({
        "id": id.to_string(),
        "tile_x": 0,
        "tile_y": 0,
        "width": width,
        "height": height,
        "byte_len": u64::from(width) * u64::from(height) * 4,
        "generation": 1
    })
}

fn mask_tile_ref(id: Uuid, width: u32, height: u32) -> Value {
    json!({
        "id": id.to_string(),
        "tile_x": 0,
        "tile_y": 0,
        "width": width,
        "height": height,
        "generation": 1
    })
}

fn raster_layer(
    id: Uuid,
    name: &str,
    tile: Uuid,
    width: u32,
    height: u32,
    mask: Option<Uuid>,
) -> Value {
    json!({
        "kind": "raster",
        "id": id.to_string(),
        "name": name,
        "visible": true,
        "locked": false,
        "opacity": 1.0,
        "blend": "normal",
        "transform": {"a": 1.0, "b": 0.0, "c": 0.0, "d": 1.0, "e": 0.0, "f": 0.0},
        "mask_id": mask.map(|id| id.to_string()),
        "tiles": [tile_ref(tile, width, height)]
    })
}

fn text_layer(id: Uuid, text: &str, width: u32, height: u32) -> Value {
    json!({
        "kind": "text",
        "id": id.to_string(),
        "name": "Caption",
        "visible": true,
        "locked": false,
        "opacity": 1.0,
        "blend": "normal",
        "transform": {"a": 1.0, "b": 0.0, "c": 0.0, "d": 1.0, "e": 0.0, "f": 0.0},
        "mask_id": null,
        "text": text,
        "font_asset_id": "inter-regular",
        "font_size": 12.0,
        "color": [0, 0, 0, 255],
        "bounds": {"x": 0.0, "y": 0.0, "width": f64::from(width), "height": f64::from(height)},
        "align": "left"
    })
}

fn mask_value(id: Uuid, tile: Uuid, width: u32, height: u32) -> Value {
    json!({
        "id": id.to_string(),
        "width": width,
        "height": height,
        "inverted": false,
        "tiles": [mask_tile_ref(tile, width, height)]
    })
}

fn descriptor(id: Uuid, kind: ProjectTileKind, width: u32, height: u32) -> ProjectTile {
    ProjectTile {
        id,
        path: match kind {
            ProjectTileKind::Rgba => format!("tiles/{id}.rgba.zst"),
            ProjectTileKind::Alpha => format!("masks/{id}.alpha.zst"),
        },
        kind,
        width,
        height,
        raw_bytes: 0,
        compressed_bytes: 1,
        sha256: "0".repeat(64),
    }
}

#[allow(clippy::too_many_arguments)]
fn manifest(
    project_id: Uuid,
    width: u32,
    height: u32,
    layers: Vec<Value>,
    masks: Vec<Value>,
    tiles: Vec<ProjectTile>,
    originals: Vec<Uuid>,
    extensions: Vec<ProjectExtension>,
) -> ImageProjectManifest {
    ImageProjectManifest {
        schema_version: 1,
        project_id,
        width,
        height,
        dpi: 96,
        layers,
        masks,
        geometry: ImageGeometry::default_for(ImageSize { width, height }).expect("geometry"),
        adjustments: ImageAdjustments::default(),
        overlays: Vec::new(),
        tiles,
        original_tile_ids: originals,
        guides: vec![Guide {
            x_or_y: GuideAxis::X,
            position: 1.0,
        }],
        metadata_entries: Vec::new(),
        extensions,
    }
}

fn write_raw_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut output = Cursor::new(Vec::new());
    {
        let mut writer = zip::ZipWriter::new(&mut output);
        for (name, bytes) in entries {
            let options = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Stored)
                .last_modified_time(
                    zip::DateTime::from_date_and_time(1980, 1, 1, 0, 0, 0).expect("date"),
                );
            writer.start_file(*name, options).expect("start");
            writer.write_all(bytes).expect("write");
        }
        writer.finish().expect("finish");
    }
    output.into_inner()
}

#[test]
fn roundtrip_layers_masks_text() {
    let project_id = Uuid::new_v4();
    let raster_id = Uuid::new_v4();
    let text_id = Uuid::new_v4();
    let mask_id = Uuid::new_v4();
    let rgba_tile = Uuid::new_v4();
    let alpha_tile = Uuid::new_v4();
    let layers = vec![
        raster_layer(raster_id, "Base", rgba_tile, 2, 1, Some(mask_id)),
        text_layer(text_id, "Hola 👋 ñ 日本語", 2, 1),
    ];
    let masks = vec![mask_value(mask_id, alpha_tile, 2, 1)];
    let tiles = vec![
        descriptor(rgba_tile, ProjectTileKind::Rgba, 2, 1),
        descriptor(alpha_tile, ProjectTileKind::Alpha, 2, 1),
    ];
    let source = manifest(
        project_id,
        2,
        1,
        layers,
        masks,
        tiles,
        vec![rgba_tile],
        Vec::new(),
    );
    let payloads = ProjectPayloads {
        tiles: vec![
            (rgba_tile, vec![255, 0, 0, 255, 0, 255, 0, 255]),
            (alpha_tile, vec![0, 255]),
        ],
        metadata: Vec::new(),
        extensions: Vec::new(),
    };
    let bytes = encode_project(&source, &payloads).expect("encode");
    let opened = decode_project(&bytes).expect("decode");
    assert_eq!(opened.info.project_id, project_id);
    assert_eq!(opened.info.width, 2);
    assert_eq!(opened.info.layer_count, 2);
    assert!(opened.info.editable);
    assert_eq!(opened.manifest.guides.len(), 1);
    assert_eq!(
        opened.manifest.layers[1]
            .get("text")
            .and_then(Value::as_str)
            .expect("text"),
        "Hola 👋 ñ 日本語"
    );
    assert_eq!(opened.manifest.masks.len(), 1);
    let raster = opened
        .payloads
        .tiles
        .iter()
        .find(|(id, _)| *id == rgba_tile)
        .map(|(_, bytes)| bytes.clone())
        .expect("raster payload");
    assert_eq!(raster, vec![255, 0, 0, 255, 0, 255, 0, 255]);
    let alpha = opened
        .payloads
        .tiles
        .iter()
        .find(|(id, _)| *id == alpha_tile)
        .map(|(_, bytes)| bytes.clone())
        .expect("alpha payload");
    assert_eq!(alpha, vec![0, 255]);
}

#[test]
fn inspect_validates_without_retaining_payloads() {
    let tile = Uuid::new_v4();
    let project_id = Uuid::new_v4();
    let source = manifest(
        project_id,
        1,
        1,
        vec![raster_layer(Uuid::new_v4(), "Base", tile, 1, 1, None)],
        Vec::new(),
        vec![descriptor(tile, ProjectTileKind::Rgba, 1, 1)],
        vec![tile],
        Vec::new(),
    );
    let payloads = ProjectPayloads {
        tiles: vec![(tile, vec![1, 2, 3, 255])],
        metadata: Vec::new(),
        extensions: Vec::new(),
    };
    let bytes = encode_project(&source, &payloads).expect("encode");
    let opened = inspect_project(&bytes).expect("inspect");
    assert!(opened.info.editable);
    assert!(opened.payloads.tiles.is_empty());
    assert!(opened.payloads.metadata.is_empty());
    assert!(opened.payloads.extensions.is_empty());
}

#[test]
#[allow(non_snake_case)]
fn captureR_editRplus1_encodesR() {
    let document = Uuid::new_v4();
    let content = Uuid::new_v4();
    let capture = ProjectCapture::new(document, 1, content).expect("capture");
    // A later edit has revision 2; it must not relabel the captured identity.
    let current_revision = 2u64;
    let captured = capture
        .captured("application/vnd.adperastra.image-project+zip", 100)
        .expect("captured");
    assert_eq!(captured.revision, 1);
    assert_ne!(captured.revision, current_revision);
    assert_eq!(captured.content_id, content);

    let tile = Uuid::new_v4();
    let matching = manifest(
        document,
        1,
        1,
        vec![raster_layer(Uuid::new_v4(), "Base", tile, 1, 1, None)],
        Vec::new(),
        vec![descriptor(tile, ProjectTileKind::Rgba, 1, 1)],
        vec![tile],
        Vec::new(),
    );
    assert_eq!(capture.validate_manifest(&matching), Ok(()));
    let foreign = manifest(
        Uuid::new_v4(),
        1,
        1,
        vec![raster_layer(Uuid::new_v4(), "Base", tile, 1, 1, None)],
        Vec::new(),
        vec![descriptor(tile, ProjectTileKind::Rgba, 1, 1)],
        vec![tile],
        Vec::new(),
    );
    assert_eq!(
        capture.validate_manifest(&foreign),
        Err(ProjectError::Changed)
    );
}

#[test]
fn traversal_refused() {
    let tile = Uuid::new_v4();
    let project_id = Uuid::new_v4();
    let source = manifest(
        project_id,
        1,
        1,
        vec![raster_layer(Uuid::new_v4(), "Base", tile, 1, 1, None)],
        Vec::new(),
        vec![descriptor(tile, ProjectTileKind::Rgba, 1, 1)],
        vec![tile],
        Vec::new(),
    );
    let document = serde_json::to_vec(&source).expect("json");
    let bytes = write_raw_zip(&[
        ("document.json", document.as_slice()),
        ("../evil.txt", b"x"),
    ]);
    assert!(matches!(decode_project(&bytes), Err(ProjectError::Corrupt)));
    let absolute = write_raw_zip(&[("document.json", document.as_slice()), ("/evil.txt", b"x")]);
    assert!(matches!(
        decode_project(&absolute),
        Err(ProjectError::Corrupt)
    ));
}

#[test]
fn zstd_bomb_refused() {
    let tile = Uuid::new_v4();
    let project_id = Uuid::new_v4();
    let bomb = compress_tile(&vec![0u8; 1000]).expect("compress");
    let mut source = manifest(
        project_id,
        1,
        1,
        vec![raster_layer(Uuid::new_v4(), "Base", tile, 1, 1, None)],
        Vec::new(),
        vec![descriptor(tile, ProjectTileKind::Rgba, 1, 1)],
        vec![tile],
        Vec::new(),
    );
    source.tiles[0].raw_bytes = 4;
    source.tiles[0].compressed_bytes = bomb.len() as u64;
    source.tiles[0].sha256 = sha256_hex(&bomb);
    let document = serde_json::to_vec(&source).expect("json");
    let path = format!("tiles/{tile}.rgba.zst");
    let bytes = write_raw_zip(&[
        ("document.json", document.as_slice()),
        (path.as_str(), bomb.as_slice()),
    ]);
    assert!(matches!(
        decode_project(&bytes),
        Err(ProjectError::TooLarge)
    ));
}

#[test]
fn layer_tile_dimensions_must_match_descriptor() {
    let tile = Uuid::new_v4();
    let project_id = Uuid::new_v4();
    let mut source = manifest(
        project_id,
        2,
        1,
        vec![raster_layer(Uuid::new_v4(), "Base", tile, 1, 1, None)],
        Vec::new(),
        vec![descriptor(tile, ProjectTileKind::Rgba, 1, 1)],
        vec![tile],
        Vec::new(),
    );
    source.layers[0]["tiles"][0]["width"] = json!(2);
    source.layers[0]["tiles"][0]["byte_len"] = json!(8);
    let payloads = ProjectPayloads {
        tiles: vec![(tile, vec![1, 2, 3, 255])],
        metadata: Vec::new(),
        extensions: Vec::new(),
    };
    assert!(matches!(
        encode_project(&source, &payloads),
        Err(ProjectError::BadRequest)
    ));
}

#[test]
fn unknownoptional_preserved() {
    let tile = Uuid::new_v4();
    let project_id = Uuid::new_v4();
    let extension_bytes = vec![9u8, 8, 7, 6];
    let extension = ProjectExtension {
        name: "com.example.layerdata".to_string(),
        required: false,
        path: "extensions/com.example.layerdata.bin".to_string(),
        sha256: sha256_hex(&extension_bytes),
    };
    let source = manifest(
        project_id,
        1,
        1,
        vec![raster_layer(Uuid::new_v4(), "Base", tile, 1, 1, None)],
        Vec::new(),
        vec![descriptor(tile, ProjectTileKind::Rgba, 1, 1)],
        vec![tile],
        vec![extension],
    );
    let payloads = ProjectPayloads {
        tiles: vec![(tile, vec![1, 2, 3, 255])],
        metadata: Vec::new(),
        extensions: vec![("com.example.layerdata".to_string(), extension_bytes.clone())],
    };
    let bytes = encode_project(&source, &payloads).expect("encode");
    let opened = decode_project(&bytes).expect("decode");
    assert!(opened.info.editable);
    assert_eq!(opened.payloads.extensions.len(), 1);
    assert_eq!(opened.payloads.extensions[0].1, extension_bytes);
}

#[test]
fn unknownrequired_noedit() {
    let tile = Uuid::new_v4();
    let project_id = Uuid::new_v4();
    let extension_bytes = vec![1u8, 1, 1];
    let extension = ProjectExtension {
        name: "com.example.mustkeep".to_string(),
        required: true,
        path: "extensions/com.example.mustkeep.bin".to_string(),
        sha256: sha256_hex(&extension_bytes),
    };
    let source = manifest(
        project_id,
        1,
        1,
        vec![raster_layer(Uuid::new_v4(), "Base", tile, 1, 1, None)],
        Vec::new(),
        vec![descriptor(tile, ProjectTileKind::Rgba, 1, 1)],
        vec![tile],
        vec![extension],
    );
    let payloads = ProjectPayloads {
        tiles: vec![(tile, vec![1, 2, 3, 255])],
        metadata: Vec::new(),
        extensions: vec![("com.example.mustkeep".to_string(), extension_bytes)],
    };
    let bytes = encode_project(&source, &payloads).expect("encode");
    let opened = decode_project(&bytes).expect("decode");
    assert!(!opened.info.editable);
    assert_eq!(
        opened.info.unsupported_features,
        vec!["required_extension".to_string()]
    );
}
