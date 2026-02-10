use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Maximum backoff duration for restart attempts.
const MAX_BACKOFF: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, PartialEq)]
pub enum SidecarState {
    Stopped,
    Starting,
    Running,
    Crashed { restart_count: u32 },
}

pub struct SidecarSupervisor {
    state: Arc<Mutex<SidecarState>>,
    max_restarts: u32,
}

impl SidecarSupervisor {
    pub fn new(max_restarts: u32) -> Self {
        Self {
            state: Arc::new(Mutex::new(SidecarState::Stopped)),
            max_restarts,
        }
    }

    /// Create a supervisor from an existing state Arc (used by watchdog thread).
    pub fn from_arc(state: Arc<Mutex<SidecarState>>, max_restarts: u32) -> Self {
        Self {
            state,
            max_restarts,
        }
    }

    /// Get a clone of the state Arc for sharing with other threads.
    pub fn state_arc(&self) -> Arc<Mutex<SidecarState>> {
        Arc::clone(&self.state)
    }

    /// Get the maximum number of allowed restarts.
    pub fn max_restarts(&self) -> u32 {
        self.max_restarts
    }

    pub fn state(&self) -> SidecarState {
        self.state.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    pub fn set_state(&self, new_state: SidecarState) {
        *self.state.lock().unwrap_or_else(|e| e.into_inner()) = new_state;
    }

    pub fn should_restart(&self) -> bool {
        match self.state() {
            SidecarState::Crashed { restart_count } => restart_count < self.max_restarts,
            _ => false,
        }
    }

    pub fn record_crash(&self) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let count = match *state {
            SidecarState::Crashed { restart_count } => restart_count + 1,
            _ => 1,
        };
        *state = SidecarState::Crashed {
            restart_count: count,
        };
    }

    pub fn record_started(&self) {
        *self.state.lock().unwrap_or_else(|e| e.into_inner()) = SidecarState::Running;
    }

    pub fn record_stopped(&self) {
        *self.state.lock().unwrap_or_else(|e| e.into_inner()) = SidecarState::Stopped;
    }

    /// Get the current restart count (0 if not crashed).
    pub fn restart_count(&self) -> u32 {
        match self.state() {
            SidecarState::Crashed { restart_count } => restart_count,
            _ => 0,
        }
    }

    /// Compute exponential backoff duration based on restart count.
    /// Returns 1s, 2s, 4s, 8s, 16s, 30s (capped at MAX_BACKOFF).
    pub fn backoff_duration(&self) -> Duration {
        let count = self.restart_count();
        if count == 0 {
            return Duration::from_secs(1);
        }
        let secs = 1u64.checked_shl(count.min(31)).unwrap_or(u64::MAX);
        Duration::from_secs(secs).min(MAX_BACKOFF)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_supervisor_starts_stopped() {
        let sup = SidecarSupervisor::new(3);
        assert_eq!(sup.state(), SidecarState::Stopped);
    }

    #[test]
    fn record_started_sets_running() {
        let sup = SidecarSupervisor::new(3);
        sup.record_started();
        assert_eq!(sup.state(), SidecarState::Running);
    }

    #[test]
    fn record_crash_increments_count() {
        let sup = SidecarSupervisor::new(3);
        sup.record_started();
        sup.record_crash();
        assert_eq!(sup.state(), SidecarState::Crashed { restart_count: 1 });
        sup.record_crash();
        assert_eq!(sup.state(), SidecarState::Crashed { restart_count: 2 });
    }

    #[test]
    fn should_restart_true_under_max() {
        let sup = SidecarSupervisor::new(3);
        sup.record_started();
        sup.record_crash(); // count = 1
        assert!(sup.should_restart());
        sup.record_crash(); // count = 2
        assert!(sup.should_restart());
    }

    #[test]
    fn should_restart_false_at_max() {
        let sup = SidecarSupervisor::new(2);
        sup.record_started();
        sup.record_crash(); // 1
        sup.record_crash(); // 2 = max
        assert!(!sup.should_restart());
    }

    #[test]
    fn should_restart_false_when_stopped() {
        let sup = SidecarSupervisor::new(3);
        assert!(!sup.should_restart());
    }

    #[test]
    fn record_stopped_resets() {
        let sup = SidecarSupervisor::new(3);
        sup.record_started();
        sup.record_crash();
        sup.record_stopped();
        assert_eq!(sup.state(), SidecarState::Stopped);
    }

    #[test]
    fn state_recovers_from_poisoned_mutex() {
        let sup = SidecarSupervisor::new(3);
        sup.record_started();
        // Poison the mutex
        let state_clone = Arc::clone(&sup.state);
        let _ = std::thread::spawn(move || {
            let _guard = state_clone.lock().unwrap();
            panic!("intentional poison");
        })
        .join();
        // Should not panic - should recover from poisoned mutex
        let state = sup.state();
        assert_eq!(state, SidecarState::Running);
    }

    #[test]
    fn backoff_starts_at_one_second() {
        let sup = SidecarSupervisor::new(10);
        // Not crashed yet, so backoff should be 1s
        assert_eq!(sup.backoff_duration(), Duration::from_secs(1));
    }

    #[test]
    fn backoff_increases_exponentially() {
        let sup = SidecarSupervisor::new(10);
        sup.record_started();

        sup.record_crash(); // count = 1
        assert_eq!(sup.backoff_duration(), Duration::from_secs(2));

        sup.record_crash(); // count = 2
        assert_eq!(sup.backoff_duration(), Duration::from_secs(4));

        sup.record_crash(); // count = 3
        assert_eq!(sup.backoff_duration(), Duration::from_secs(8));

        sup.record_crash(); // count = 4
        assert_eq!(sup.backoff_duration(), Duration::from_secs(16));
    }

    #[test]
    fn backoff_caps_at_30_seconds() {
        let sup = SidecarSupervisor::new(20);
        sup.record_started();

        // 5 crashes: 2^5 = 32 > 30, should cap
        for _ in 0..5 {
            sup.record_crash();
        }
        assert_eq!(sup.backoff_duration(), Duration::from_secs(30));

        // Even more crashes should still cap at 30
        for _ in 0..5 {
            sup.record_crash();
        }
        assert_eq!(sup.backoff_duration(), Duration::from_secs(30));
    }

    #[test]
    fn restart_count_returns_zero_when_not_crashed() {
        let sup = SidecarSupervisor::new(3);
        assert_eq!(sup.restart_count(), 0);
        sup.record_started();
        assert_eq!(sup.restart_count(), 0);
    }

    #[test]
    fn restart_count_tracks_crashes() {
        let sup = SidecarSupervisor::new(5);
        sup.record_started();
        sup.record_crash();
        assert_eq!(sup.restart_count(), 1);
        sup.record_crash();
        assert_eq!(sup.restart_count(), 2);
    }

    #[test]
    fn set_state_recovers_from_poisoned_mutex() {
        let sup = SidecarSupervisor::new(3);
        // Poison the mutex
        let state_clone = Arc::clone(&sup.state);
        let _ = std::thread::spawn(move || {
            let _guard = state_clone.lock().unwrap();
            panic!("intentional poison");
        })
        .join();
        // Should not panic - should recover and set state
        sup.set_state(SidecarState::Running);
        assert_eq!(sup.state(), SidecarState::Running);
    }
}
