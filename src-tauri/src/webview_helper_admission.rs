//! One live-process budget shared by PDF, books, models and PSD helpers.
use std::sync::atomic::{AtomicUsize, Ordering};

static ACTIVE: AtomicUsize = AtomicUsize::new(0);
pub struct HelperPermit;
impl HelperPermit {
    pub fn acquire() -> Result<Self, String> {
        ACTIVE
            .try_update(Ordering::AcqRel, Ordering::Acquire, |active| {
                (active < 2).then_some(active + 1)
            })
            .map_err(|_| "helper.busy".to_string())?;
        Ok(Self)
    }
}
impl Drop for HelperPermit {
    fn drop(&mut self) {
        ACTIVE.fetch_sub(1, Ordering::AcqRel);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shared_process_budget_refuses_third_and_reopens_after_release() {
        let first = HelperPermit::acquire().unwrap();
        let second = HelperPermit::acquire().unwrap();
        assert!(HelperPermit::acquire().is_err());
        drop(first);
        let replacement = HelperPermit::acquire().unwrap();
        assert!(HelperPermit::acquire().is_err());
        drop((second, replacement));
        assert_eq!(ACTIVE.load(Ordering::Acquire), 0);
    }
}
