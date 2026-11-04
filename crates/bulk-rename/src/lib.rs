//! Bounded, deterministic bulk rename planning. No source bytes are read here.
pub mod collisions;
pub mod executor;
pub mod journal;
pub mod operations;
pub mod preview;
pub mod types;
