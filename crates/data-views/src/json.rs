//! The JSON tree (Step 06f D8, D9): a custom serde visitor fills an arena in
//! document order, so key order and duplicate keys stay, and the UI asks for
//! pages of children instead of the whole document.

use serde::de::{DeserializeSeed, Error as DeError, MapAccess, SeqAccess, Visitor};
use serde::{Deserialize, Deserializer, Serialize};

use crate::error::DataError;
use crate::limits::{MAX_JSON_COPY, MAX_JSON_NODES, MAX_JSON_PAGE, MAX_JSON_PREVIEW};

/// How deeply serde_json may nest before it refuses the file.
const RECURSION_MARKER: &str = "recursion limit exceeded";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JsonKind {
    Object,
    Array,
    String,
    Number,
    Bool,
    Null,
}

#[derive(Debug)]
struct Node {
    kind: JsonKind,
    key: Option<String>,
    index: Option<u32>,
    /// A string's own text, or a number, `true`, `false` or `null`.
    text: String,
    parent: Option<u32>,
    /// First entry of this container's children in `JsonDoc::children`.
    first_child: u32,
    child_count: u32,
}

/// One parsed JSON file. Node ids run in document order.
#[derive(Debug, Default)]
pub struct JsonDoc {
    nodes: Vec<Node>,
    /// The child ids of every container, each list next to the others.
    children: Vec<u32>,
    root: u32,
}

/// One child as the tree shows it (snake_case fields reach the UI).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct JsonNodeInfo {
    pub id: u32,
    pub key: Option<String>,
    pub index: Option<u32>,
    pub kind: JsonKind,
    pub preview: String,
    pub preview_cut: bool,
    pub child_count: u32,
}

/// Where a search found something, with the containers around it (root first).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct JsonMatch {
    pub id: u32,
    pub ancestors: Vec<u32>,
}

impl JsonDoc {
    pub fn root(&self) -> u32 {
        self.root
    }

    pub fn node_count(&self) -> u32 {
        self.nodes.len() as u32
    }

    /// How a node looks in the tree. The root's info is the summary's.
    pub fn node_info(&self, id: u32) -> JsonNodeInfo {
        let node = &self.nodes[id as usize];
        let (preview, preview_cut) = match node.kind {
            JsonKind::Object | JsonKind::Array => (String::new(), false),
            _ => {
                if node.text.chars().count() > MAX_JSON_PREVIEW {
                    (node.text.chars().take(MAX_JSON_PREVIEW).collect(), true)
                } else {
                    (node.text.clone(), false)
                }
            }
        };
        JsonNodeInfo {
            id,
            key: node.key.clone(),
            index: node.index,
            kind: node.kind,
            preview,
            preview_cut,
            child_count: node.child_count,
        }
    }

    fn ancestors(&self, id: u32) -> Vec<u32> {
        let mut chain = Vec::new();
        let mut current = self.nodes[id as usize].parent;
        while let Some(parent) = current {
            chain.push(parent);
            current = self.nodes[parent as usize].parent;
        }
        chain.reverse();
        chain
    }
}

/// Everything the visitor needs while it fills the document.
struct Builder<'d> {
    doc: &'d mut JsonDoc,
    too_large: bool,
}

impl Builder<'_> {
    fn push(&mut self, node: Node) -> Result<u32, String> {
        if self.doc.nodes.len() >= MAX_JSON_NODES {
            self.too_large = true;
            return Err("data.too_large".to_string());
        }
        let id = u32::try_from(self.doc.nodes.len()).unwrap_or(u32::MAX);
        self.doc.nodes.push(node);
        Ok(id)
    }

    fn set_children(&mut self, id: u32, children: &[u32]) {
        let first = u32::try_from(self.doc.children.len()).unwrap_or(u32::MAX);
        self.doc.children.extend_from_slice(children);
        let node = &mut self.doc.nodes[id as usize];
        node.first_child = first;
        node.child_count = u32::try_from(children.len()).unwrap_or(u32::MAX);
    }
}

/// A serde seed that adds one value and everything below it to the arena.
struct NodeSeed<'a, 'd> {
    builder: &'a mut Builder<'d>,
    key: Option<String>,
    index: Option<u32>,
    parent: Option<u32>,
}

impl NodeSeed<'_, '_> {
    fn scalar<E: DeError>(self, kind: JsonKind, text: String) -> Result<u32, E> {
        let node = Node {
            kind,
            key: self.key,
            index: self.index,
            text,
            parent: self.parent,
            first_child: 0,
            child_count: 0,
        };
        self.builder.push(node).map_err(E::custom)
    }

    fn start_container<E: DeError>(&mut self, kind: JsonKind) -> Result<u32, E> {
        let node = Node {
            kind,
            key: self.key.take(),
            index: self.index.take(),
            text: String::new(),
            parent: self.parent,
            first_child: 0,
            child_count: 0,
        };
        self.builder.push(node).map_err(E::custom)
    }
}

impl<'de> DeserializeSeed<'de> for NodeSeed<'_, '_> {
    type Value = u32;

    fn deserialize<D>(self, deserializer: D) -> Result<u32, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_any(self)
    }
}

impl<'de> Visitor<'de> for NodeSeed<'_, '_> {
    type Value = u32;

    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("any JSON value")
    }

    fn visit_bool<E: DeError>(self, value: bool) -> Result<u32, E> {
        self.scalar(JsonKind::Bool, value.to_string())
    }

    fn visit_i64<E: DeError>(self, value: i64) -> Result<u32, E> {
        self.scalar(JsonKind::Number, value.to_string())
    }

    fn visit_u64<E: DeError>(self, value: u64) -> Result<u32, E> {
        self.scalar(JsonKind::Number, value.to_string())
    }

    fn visit_f64<E: DeError>(self, value: f64) -> Result<u32, E> {
        self.scalar(JsonKind::Number, value.to_string())
    }

    fn visit_str<E: DeError>(self, value: &str) -> Result<u32, E> {
        self.scalar(JsonKind::String, value.to_string())
    }

    fn visit_string<E: DeError>(self, value: String) -> Result<u32, E> {
        self.scalar(JsonKind::String, value)
    }

    fn visit_unit<E: DeError>(self) -> Result<u32, E> {
        self.scalar(JsonKind::Null, "null".to_string())
    }

    fn visit_none<E: DeError>(self) -> Result<u32, E> {
        self.scalar(JsonKind::Null, "null".to_string())
    }

    fn visit_some<D>(self, deserializer: D) -> Result<u32, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_any(self)
    }

    fn visit_seq<A>(mut self, mut seq: A) -> Result<u32, A::Error>
    where
        A: SeqAccess<'de>,
    {
        let id = self.start_container(JsonKind::Array)?;
        let mut children: Vec<u32> = Vec::new();
        while let Some(child) = seq.next_element_seed(NodeSeed {
            builder: &mut *self.builder,
            key: None,
            index: Some(u32::try_from(children.len()).unwrap_or(u32::MAX)),
            parent: Some(id),
        })? {
            children.push(child);
        }
        self.builder.set_children(id, &children);
        Ok(id)
    }

    fn visit_map<A>(mut self, mut map: A) -> Result<u32, A::Error>
    where
        A: MapAccess<'de>,
    {
        let id = self.start_container(JsonKind::Object)?;
        let mut children: Vec<u32> = Vec::new();
        while let Some(key) = map.next_key::<String>()? {
            let child = map.next_value_seed(NodeSeed {
                builder: &mut *self.builder,
                key: Some(key),
                index: None,
                parent: Some(id),
            })?;
            children.push(child);
        }
        self.builder.set_children(id, &children);
        Ok(id)
    }
}

/// Parse one JSON text. Comments and trailing commas are errors.
pub fn parse_json(text: &str) -> Result<JsonDoc, DataError> {
    let mut doc = JsonDoc::default();
    let (outcome, too_large): (Result<u32, serde_json::Error>, bool) = {
        let mut builder = Builder {
            doc: &mut doc,
            too_large: false,
        };
        let mut deserializer = serde_json::Deserializer::from_str(text);
        let seed = NodeSeed {
            builder: &mut builder,
            key: None,
            index: None,
            parent: None,
        };
        let parsed = seed.deserialize(&mut deserializer);
        let result = match parsed {
            Ok(root) => deserializer.end().map(|()| root),
            Err(error) => Err(error),
        };
        (result, builder.too_large)
    };
    match outcome {
        Ok(root) => {
            doc.root = root;
            Ok(doc)
        }
        Err(_) if too_large => Err(DataError::TooLarge),
        Err(error) if error.to_string().contains(RECURSION_MARKER) => Err(DataError::TooDeep),
        Err(error) => Err(DataError::Invalid {
            line: error.line() as u64,
            column: error.column() as u64,
        }),
    }
}

/// One page of a container's children.
pub fn children(doc: &JsonDoc, id: u32, start: usize, count: usize) -> Vec<JsonNodeInfo> {
    let Some(node) = doc.nodes.get(id as usize) else {
        return Vec::new();
    };
    let total = node.child_count as usize;
    if start >= total {
        return Vec::new();
    }
    let end = start.saturating_add(count.min(MAX_JSON_PAGE)).min(total);
    let first = node.first_child as usize;
    (first + start..first + end)
        .map(|index| doc.node_info(doc.children[index]))
        .collect()
}

fn node_matches(node: &Node, text: &str, needle: &str, case_sensitive: bool) -> bool {
    let hit = |value: &str| {
        if case_sensitive {
            value.contains(text)
        } else {
            value.to_lowercase().contains(needle)
        }
    };
    if node.key.as_deref().is_some_and(hit) {
        return true;
    }
    matches!(
        node.kind,
        JsonKind::String | JsonKind::Number | JsonKind::Bool
    ) && hit(&node.text)
}

/// The next node whose key or text contains `text`, in document order; wraps
/// around once. Empty text finds nothing.
pub fn find_next(
    doc: &JsonDoc,
    text: &str,
    case_sensitive: bool,
    after: Option<u32>,
    backwards: bool,
) -> Option<JsonMatch> {
    let count = doc.nodes.len();
    if text.is_empty() || count == 0 {
        return None;
    }
    let needle = text.to_lowercase();
    let start = match after {
        Some(id) => {
            let position = (id as usize).min(count - 1);
            if backwards {
                position
            } else {
                position + 1
            }
        }
        None => {
            if backwards {
                count - 1
            } else {
                0
            }
        }
    };
    for step in 0..count {
        let index = if backwards {
            (start + count - step) % count
        } else {
            (start + step) % count
        };
        let node = &doc.nodes[index];
        if node_matches(node, text, &needle, case_sensitive) {
            let id = index as u32;
            return Some(JsonMatch {
                id,
                ancestors: doc.ancestors(id),
            });
        }
    }
    None
}

/// A string's own text, or the value as pretty JSON, at most 1 MiB.
pub fn copy_text(doc: &JsonDoc, id: u32) -> Result<String, DataError> {
    let Some(node) = doc.nodes.get(id as usize) else {
        return Err(DataError::Invalid { line: 0, column: 0 });
    };
    if node.kind == JsonKind::String {
        if node.text.len() > MAX_JSON_COPY {
            return Err(DataError::TooLarge);
        }
        return Ok(node.text.clone());
    }
    let mut out = String::new();
    write_value(doc, id, 0, &mut out)?;
    Ok(out)
}

fn push_checked(out: &mut String, text: &str) -> Result<(), DataError> {
    if out.len() + text.len() > MAX_JSON_COPY {
        return Err(DataError::TooLarge);
    }
    out.push_str(text);
    Ok(())
}

fn write_value(doc: &JsonDoc, id: u32, indent: usize, out: &mut String) -> Result<(), DataError> {
    let node = &doc.nodes[id as usize];
    match node.kind {
        JsonKind::Object | JsonKind::Array => {
            let open = if node.kind == JsonKind::Object {
                "{"
            } else {
                "["
            };
            let close = if node.kind == JsonKind::Object {
                "}"
            } else {
                "]"
            };
            if node.child_count == 0 {
                push_checked(out, open)?;
                push_checked(out, close)?;
                return Ok(());
            }
            push_checked(out, open)?;
            push_checked(out, "\n")?;
            let first = node.first_child as usize;
            let total = node.child_count as usize;
            for position in 0..total {
                let child = doc.children[first + position];
                push_checked(out, &"  ".repeat(indent + 1))?;
                if node.kind == JsonKind::Object {
                    let key = doc.nodes[child as usize].key.as_deref().unwrap_or("");
                    let escaped = serde_json::to_string(key).map_err(|_| DataError::Io)?;
                    push_checked(out, &escaped)?;
                    push_checked(out, ": ")?;
                }
                write_value(doc, child, indent + 1, out)?;
                if position + 1 < total {
                    push_checked(out, ",")?;
                }
                push_checked(out, "\n")?;
            }
            push_checked(out, &"  ".repeat(indent))?;
            push_checked(out, close)
        }
        JsonKind::String => {
            let escaped = serde_json::to_string(&node.text).map_err(|_| DataError::Io)?;
            push_checked(out, &escaped)
        }
        JsonKind::Number | JsonKind::Bool | JsonKind::Null => push_checked(out, &node.text),
    }
}
