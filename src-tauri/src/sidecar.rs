use std::sync::{Arc, Mutex};

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

    pub fn state(&self) -> SidecarState {
        self.state.lock().unwrap().clone()
    }

    pub fn set_state(&self, new_state: SidecarState) {
        *self.state.lock().unwrap() = new_state;
    }

    pub fn should_restart(&self) -> bool {
        match self.state() {
            SidecarState::Crashed { restart_count } => restart_count < self.max_restarts,
            _ => false,
        }
    }

    pub fn record_crash(&self) {
        let mut state = self.state.lock().unwrap();
        let count = match *state {
            SidecarState::Crashed { restart_count } => restart_count + 1,
            _ => 1,
        };
        *state = SidecarState::Crashed {
            restart_count: count,
        };
    }

    pub fn record_started(&self) {
        *self.state.lock().unwrap() = SidecarState::Running;
    }

    pub fn record_stopped(&self) {
        *self.state.lock().unwrap() = SidecarState::Stopped;
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
}
