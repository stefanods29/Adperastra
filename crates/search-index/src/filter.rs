//! Typed filter to parameterized SQL. Column names come from a closed match;
//! every user value is bound, never interpolated.

use rusqlite::types::Value;

use crate::types::{
    DateField, NumberField, NumberOp, SearchFilter, StringField, StringOp, TagMatch,
};
use crate::SearchError;

#[derive(Debug, Clone, PartialEq)]
pub struct FilterSql {
    pub clause: String,
    pub values: Vec<Value>,
}

pub fn build(filter: &SearchFilter) -> Result<FilterSql, SearchError> {
    filter.validate()?;
    let mut values = Vec::new();
    let clause = build_node(filter, &mut values)?;
    Ok(FilterSql { clause, values })
}

fn build_node(filter: &SearchFilter, values: &mut Vec<Value>) -> Result<String, SearchError> {
    match filter {
        SearchFilter::All { clauses } => build_group(clauses, "AND", true, values),
        SearchFilter::Any { clauses } => build_group(clauses, "OR", false, values),
        SearchFilter::Not { clause } => {
            let inner = build_node(clause, values)?;
            Ok(format!("NOT ({inner})"))
        }
        SearchFilter::String { field, op, value } => {
            let column = match field {
                StringField::Kind => "f.kind",
                StringField::Ext => "f.ext",
                StringField::Author => "f.author",
            };
            let stored = match field {
                StringField::Kind => normalize_kind(value),
                StringField::Ext => value.trim().trim_start_matches('.').to_lowercase(),
                StringField::Author => value.clone(),
            };
            match op {
                StringOp::Eq => {
                    values.push(Value::Text(stored));
                    Ok(format!("{column} = ?"))
                }
                StringOp::Contains => {
                    values.push(Value::Text(like_contains(&stored)));
                    Ok(format!("{column} LIKE ? ESCAPE '\\' COLLATE NOCASE"))
                }
            }
        }
        SearchFilter::Number { field, op, value } => {
            let column = match field {
                NumberField::Size => "f.size",
                NumberField::Width => "f.width",
                NumberField::Height => "f.height",
                NumberField::DurationMs => "f.duration_ms",
                NumberField::Pages => "f.pages",
            };
            let operator = match op {
                NumberOp::Eq => "=",
                NumberOp::Gte => ">=",
                NumberOp::Lte => "<=",
            };
            values.push(Value::Real(*value));
            Ok(format!("{column} {operator} ?"))
        }
        SearchFilter::Date {
            field,
            from_unix,
            to_unix,
        } => {
            let column = match field {
                DateField::Modified => "f.modified_unix",
                DateField::Created => "f.created_unix",
                DateField::DateTaken => "f.date_taken_unix",
            };
            let mut parts = Vec::new();
            if let Some(from) = from_unix {
                if *from > i64::MAX as u64 {
                    return Err(SearchError::Invalid);
                }
                values.push(Value::Integer(*from as i64));
                parts.push(format!("{column} >= ?"));
            }
            if let Some(to) = to_unix {
                if *to > i64::MAX as u64 {
                    return Err(SearchError::Invalid);
                }
                values.push(Value::Integer(*to as i64));
                parts.push(format!("{column} <= ?"));
            }
            if parts.is_empty() {
                Ok("1=1".to_string())
            } else {
                Ok(format!("({})", parts.join(" AND ")))
            }
        }
        SearchFilter::MissingDate { field } => {
            let column = match field {
                DateField::Modified => "f.modified_unix",
                DateField::Created => "f.created_unix",
                DateField::DateTaken => "f.date_taken_unix",
            };
            Ok(format!("{column} IS NULL"))
        }
        SearchFilter::ExtList {
            values: extensions,
            exclude,
        } => {
            if extensions.is_empty() {
                return Ok(if *exclude { "1=1" } else { "0=1" }.to_string());
            }
            let placeholders = vec!["?"; extensions.len()].join(",");
            for value in extensions {
                values.push(Value::Text(
                    value.trim().trim_start_matches('.').to_ascii_lowercase(),
                ));
            }
            let operator = if *exclude { "NOT IN" } else { "IN" };
            Ok(format!("f.ext {operator} ({placeholders})"))
        }
        SearchFilter::Tags {
            tag_ids,
            match_kind,
        } => {
            if tag_ids.is_empty() {
                return Ok(match match_kind {
                    TagMatch::All => "1=1".to_string(),
                    TagMatch::Any => "0=1".to_string(),
                });
            }
            let placeholders = vec!["?"; tag_ids.len()].join(",");
            for id in tag_ids {
                values.push(Value::Text(id.to_lowercase()));
            }
            match match_kind {
                TagMatch::Any => Ok(format!(
                    "EXISTS (SELECT 1 FROM tag_members t WHERE t.file_key = f.key AND t.tag_id IN ({placeholders}))"
                )),
                TagMatch::All => {
                    values.push(Value::Integer(tag_ids.len() as i64));
                    Ok(format!(
                        "(SELECT COUNT(DISTINCT t.tag_id) FROM tag_members t WHERE t.file_key = f.key AND t.tag_id IN ({placeholders})) = ?"
                    ))
                }
            }
        }
    }
}

fn build_group(
    clauses: &[SearchFilter],
    operator: &str,
    empty_true: bool,
    values: &mut Vec<Value>,
) -> Result<String, SearchError> {
    if clauses.is_empty() {
        return Ok(if empty_true { "1=1" } else { "0=1" }.to_string());
    }
    let mut parts = Vec::with_capacity(clauses.len());
    for clause in clauses {
        parts.push(build_node(clause, values)?);
    }
    Ok(format!("({})", parts.join(&format!(" {operator} "))))
}

fn normalize_kind(value: &str) -> String {
    match value.trim().to_lowercase().as_str() {
        "folder" | "folders" | "directory" => "folder".to_string(),
        "file" | "files" => "file".to_string(),
        "drive" => "drive".to_string(),
        other => other.to_string(),
    }
}

fn like_contains(value: &str) -> String {
    let escaped = value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    format!("%{escaped}%")
}

#[cfg(test)]
mod tests {
    use super::build;
    use crate::types::{NumberField, NumberOp, SearchFilter, StringField, StringOp};

    #[test]
    fn every_value_is_bound() {
        let filter = SearchFilter::All {
            clauses: vec![
                SearchFilter::String {
                    field: StringField::Ext,
                    op: StringOp::Eq,
                    value: "PDF".into(),
                },
                SearchFilter::Number {
                    field: NumberField::Size,
                    op: NumberOp::Gte,
                    value: 1024.0,
                },
            ],
        };
        let sql = build(&filter).unwrap();
        assert!(!sql.clause.contains("PDF"));
        assert!(!sql.clause.contains("1024"));
        assert_eq!(sql.values.len(), 2);
    }
}
