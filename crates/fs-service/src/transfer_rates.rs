//! Speed and remaining time for a running transfer (Step 09f D5).
//!
//! Two independent pure pieces live here:
//!
//! * `TransferCounters` — the authoritative byte/item accounting. It refuses
//!   to wrap, never reports more copied bytes than total bytes and never
//!   claims a job is complete while an item is still unresolved.
//! * `RateSampler` — an EWMA over the last five seconds of *active* copying.
//!   Paused and queued time is recorded separately and never enters the
//!   rate, so a paused transfer keeps its speed and its remaining time does
//!   not run away.
//!
//! Nothing here touches the disk or a clock: the caller passes the measured
//! active nanoseconds, which keeps the tests deterministic.

/// The window the moving average reflects.
pub const RATE_WINDOW_NANOS: u64 = 5_000_000_000;
/// Progress is republished four times a second.
pub const RATE_UPDATE_NANOS: u64 = 250_000_000;
/// No estimate before at least one second of real copying.
pub const RATE_MIN_ACTIVE_NANOS: u64 = 1_000_000_000;
/// Smoothing factor for one committed sample (about a five second window at
/// the four updates per second above).
const RATE_ALPHA: f64 = 0.25;

/// Why byte accounting refused an update.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CounterError {
    /// A byte count would not fit (or would pass the total, which is a bug).
    Overflow,
    /// The item's size is larger than the bytes still expected.
    BeyondTotal,
}

/// Bytes and items of one transfer, plus what is still expected.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct TransferCounters {
    items_done: u64,
    items_total: u64,
    bytes_done: u64,
    bytes_total: u64,
}

impl TransferCounters {
    pub fn new(items_total: u64, bytes_total: u64) -> Self {
        Self {
            items_done: 0,
            items_total,
            bytes_done: 0,
            bytes_total,
        }
    }

    pub fn items_done(&self) -> u64 {
        self.items_done
    }

    pub fn items_total(&self) -> u64 {
        self.items_total
    }

    pub fn bytes_done(&self) -> u64 {
        self.bytes_done
    }

    pub fn bytes_total(&self) -> u64 {
        self.bytes_total
    }

    /// Bytes the source still has to deliver, never below zero.
    pub fn remaining_bytes(&self) -> u64 {
        self.bytes_total.saturating_sub(self.bytes_done)
    }

    /// Count bytes actually written to the owned staging file.
    pub fn add_bytes(&mut self, bytes: u64) -> Result<(), CounterError> {
        if bytes > self.remaining_bytes() {
            return Err(if self.bytes_total == u64::MAX {
                CounterError::Overflow
            } else {
                CounterError::BeyondTotal
            });
        }
        self.bytes_done = self
            .bytes_done
            .checked_add(bytes)
            .ok_or(CounterError::Overflow)?;
        Ok(())
    }

    /// One item finished, whatever its outcome. The item count never passes
    /// the total, so a retried item cannot inflate it.
    pub fn finish_item(&mut self) -> Result<(), CounterError> {
        if self.items_done >= self.items_total {
            return Err(CounterError::Overflow);
        }
        self.items_done += 1;
        Ok(())
    }

    /// An item was skipped: its expected bytes leave the remaining work.
    ///
    /// The skipped bytes are *not* added to `bytes_done` (nothing was
    /// written), so progress never jumps to a false 100% while real bytes
    /// are still outstanding. The caller keeps the skipped item in the
    /// report.
    pub fn skip_remaining(&mut self, bytes: u64) -> Result<(), CounterError> {
        if bytes > self.remaining_bytes() {
            return Err(CounterError::BeyondTotal);
        }
        self.bytes_total -= bytes;
        Ok(())
    }

    /// True only when every item is resolved and every expected byte landed.
    pub fn is_complete(&self) -> bool {
        self.items_done == self.items_total && self.bytes_done == self.bytes_total
    }
}

/// Moving-average speed plus the remaining-time estimate built from it.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct RateSampler {
    /// Bytes accumulated since the last committed sample.
    pending_bytes: u64,
    /// Active nanoseconds since the last committed sample.
    pending_nanos: u64,
    /// Smoothed bytes per second; `None` until the first sample exists.
    rate: Option<f64>,
    /// Active (never paused or queued) nanoseconds seen by this transfer.
    active_nanos: u64,
    /// Paused or queued nanoseconds, kept for the report only.
    idle_nanos: u64,
}

impl RateSampler {
    pub fn new() -> Self {
        Self::default()
    }

    /// Record `bytes` copied during `active_nanos` of unpaused work.
    ///
    /// Returns `true` when a sample was committed (the four-per-second
    /// update). A call with zero active time changes nothing: that is what
    /// keeps paused time out of the average.
    pub fn record(&mut self, bytes: u64, active_nanos: u64) -> bool {
        if active_nanos == 0 {
            return false;
        }
        self.active_nanos = self.active_nanos.saturating_add(active_nanos);
        self.pending_bytes = self.pending_bytes.saturating_add(bytes);
        self.pending_nanos = self.pending_nanos.saturating_add(active_nanos);
        if self.pending_nanos < RATE_UPDATE_NANOS {
            return false;
        }
        self.commit();
        true
    }

    fn commit(&mut self) {
        if self.pending_nanos == 0 {
            return;
        }
        let seconds = self.pending_nanos as f64 / 1_000_000_000.0;
        let instant = self.pending_bytes as f64 / seconds;
        let rate = match self.rate {
            Some(previous) => previous + RATE_ALPHA * (instant - previous),
            None => instant,
        };
        self.rate = Some(rate.max(0.0));
        self.pending_bytes = 0;
        self.pending_nanos = 0;
    }

    /// Spend this long waiting (paused, queued, or on an undecided item).
    /// It never lowers the speed and never shortens the estimate.
    pub fn record_idle(&mut self, idle_nanos: u64) {
        self.idle_nanos = self.idle_nanos.saturating_add(idle_nanos);
    }

    pub fn idle_nanos(&self) -> u64 {
        self.idle_nanos
    }

    /// The speed to show, or `None` while it is unknown.
    pub fn bytes_per_second(&self) -> Option<f64> {
        if self.active_nanos < RATE_MIN_ACTIVE_NANOS {
            return None;
        }
        self.rate.filter(|rate| rate.is_finite() && *rate > 0.0)
    }

    /// Seconds still needed for `remaining_bytes`.
    ///
    /// `None` before a whole second of copying, when the rate is unknown or
    /// zero, and when nothing is left to copy (a missing estimate is honest;
    /// a zero that never moves is not). The value is rounded up.
    pub fn eta_seconds(&self, remaining_bytes: u64) -> Option<u64> {
        if remaining_bytes == 0 {
            return None;
        }
        let rate = self.bytes_per_second()?;
        let seconds = (remaining_bytes as f64) / rate;
        if !seconds.is_finite() || seconds < 0.0 {
            return None;
        }
        let rounded = seconds.ceil();
        if rounded > u64::MAX as f64 {
            return None;
        }
        Some(rounded as u64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counters_never_wrap_or_overshoot() {
        let mut counters = TransferCounters::new(1, 10);
        assert_eq!(counters.add_bytes(4), Ok(()));
        assert_eq!(counters.add_bytes(u64::MAX), Err(CounterError::BeyondTotal));
        assert_eq!(counters.bytes_done(), 4);
        assert!(!counters.is_complete());
    }

    #[test]
    fn skipped_bytes_leave_the_remaining_work_without_faking_progress() {
        let mut counters = TransferCounters::new(2, 100);
        counters.add_bytes(10).unwrap();
        counters.skip_remaining(50).unwrap();
        assert_eq!(counters.bytes_total(), 50);
        assert_eq!(counters.bytes_done(), 10);
        assert_eq!(counters.remaining_bytes(), 40);
        assert_eq!(counters.skip_remaining(41), Err(CounterError::BeyondTotal));
    }

    #[test]
    fn no_rate_before_one_second() {
        let mut sampler = RateSampler::new();
        sampler.record(10, 900_000_000);
        assert_eq!(sampler.bytes_per_second(), None);
        assert_eq!(sampler.eta_seconds(1_000), None);
    }

    #[test]
    fn a_real_rate_produces_a_rounded_up_estimate() {
        let mut sampler = RateSampler::new();
        // 1 MiB per second for two seconds.
        for _ in 0..8 {
            sampler.record(1_048_576 / 4, 250_000_000);
        }
        let rate = sampler.bytes_per_second().unwrap();
        assert!((rate - 1_048_576.0).abs() < 1.0, "{rate}");
        assert_eq!(sampler.eta_seconds(3_000_000), Some(3));
    }

    #[test]
    fn zero_remaining_has_no_estimate() {
        let mut sampler = RateSampler::new();
        for _ in 0..8 {
            sampler.record(1_048_576 / 4, 250_000_000);
        }
        assert_eq!(sampler.eta_seconds(0), None);
    }
}
