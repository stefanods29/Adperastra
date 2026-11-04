use data_views::notebook::{parse_notebook, NotebookCellKind, NotebookOutputKind};
use data_views::viewer_error::ViewerError;
use serde_json::{json, Value};

fn notebook(cells: Value) -> Vec<u8> {
    serde_json::to_vec(&json!({
        "nbformat": 4,
        "metadata": { "language_info": { "name": "python" } },
        "cells": cells
    }))
    .unwrap()
}

#[test]
fn notebook_code_is_inert() {
    let bytes = notebook(json!([{
        "cell_type": "code",
        "source": ["open('x')"],
        "outputs": []
    }]));
    let doc = parse_notebook(&bytes).unwrap();
    assert_eq!(doc.cells[0].kind, NotebookCellKind::Code);
    assert_eq!(doc.cells[0].source, "open('x')");
    assert!(doc.cells[0].outputs.is_empty());
}

#[test]
fn five_thousand_and_one_cells_are_refused() {
    let cells: Vec<Value> = (0..5_001)
        .map(|_| json!({ "cell_type": "markdown", "source": "x" }))
        .collect();
    assert_eq!(
        parse_notebook(&notebook(Value::Array(cells))).unwrap_err(),
        ViewerError::TooLarge
    );
}

#[test]
fn an_unsafe_output_becomes_an_explicit_unsupported_note() {
    let bytes = notebook(json!([{
        "cell_type": "code",
        "source": "",
        "outputs": [{
            "output_type": "display_data",
            "data": { "application/javascript": "alert(1)" }
        }]
    }]));
    let doc = parse_notebook(&bytes).unwrap();
    assert!(doc.cells[0].outputs.is_empty());
    assert_eq!(doc.unsupported_outputs, 1);
    assert!(doc.partial);
}

#[test]
fn saved_png_output_becomes_a_bounded_image() {
    let bytes = notebook(json!([{
        "cell_type": "code",
        "source": "",
        "outputs": [{
            "output_type": "display_data",
            "data": { "image/png": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lP5lJwAAAABJRU5ErkJggg==" }
        }]
    }]));
    let doc = parse_notebook(&bytes).unwrap();
    assert_eq!(doc.cells[0].outputs[0].kind, NotebookOutputKind::Image);
    let image = doc.cells[0].outputs[0].image.as_ref().unwrap();
    assert_eq!(image.mime, "image/png");
    assert_eq!(image.width, Some(1));
    assert_eq!(image.height, Some(1));
}
