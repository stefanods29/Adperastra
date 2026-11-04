//! Canonical conversion data shapes (Step 08a, interface revision
//! `conversion-2`). The TypeScript mirrors live in `src/convert/types.ts`;
//! field names are snake_case on both sides. Later steps add IDs and option
//! variants, never rename these.

use std::collections::BTreeSet;
use std::path::Path;

use fs_service::SourceStamp;
use serde::{Deserialize, Serialize};

use crate::error::ConvertError;

include!("types_formats.rs");
include!("types_specs.rs");
include!("types_options.rs");
include!("types_requests.rs");
include!("types_results.rs");
