use notify::{Event, EventKind, RecommendedWatcher};
use std::path::PathBuf;
use std::sync::mpsc;

pub enum WatchEvent {
    ConfigChanged,
    SourceFileChanged { path: PathBuf },
}

pub fn classify_event(event: &Event, config_path: &std::path::Path) -> Option<WatchEvent> {
    match event.kind {
        EventKind::Modify(_) | EventKind::Create(_) => {
            for path in &event.paths {
                if path == config_path {
                    return Some(WatchEvent::ConfigChanged);
                }
                if path.extension().map_or(false, |ext| ext == "csv") {
                    return Some(WatchEvent::SourceFileChanged {
                        path: path.clone(),
                    });
                }
            }
            None
        }
        _ => None,
    }
}

pub fn create_watcher(
    tx: mpsc::Sender<WatchEvent>,
    config_path: PathBuf,
) -> Result<RecommendedWatcher, notify::Error> {
    let watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
        if let Ok(event) = res {
            if let Some(watch_event) = classify_event(&event, &config_path) {
                let _ = tx.send(watch_event);
            }
        }
    })?;
    Ok(watcher)
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{CreateKind, ModifyKind};

    fn make_event(kind: EventKind, paths: Vec<PathBuf>) -> Event {
        Event {
            kind,
            paths,
            attrs: Default::default(),
        }
    }

    #[test]
    fn classify_config_modify() {
        let config = PathBuf::from("/home/user/.finwatch/config.json");
        let event = make_event(
            EventKind::Modify(ModifyKind::Data(notify::event::DataChange::Content)),
            vec![config.clone()],
        );
        match classify_event(&event, &config) {
            Some(WatchEvent::ConfigChanged) => {}
            other => panic!("Expected ConfigChanged, got {:?}", other.is_some()),
        }
    }

    #[test]
    fn classify_csv_create() {
        let config = PathBuf::from("/home/user/.finwatch/config.json");
        let csv = PathBuf::from("/home/user/data/trades.csv");
        let event = make_event(EventKind::Create(CreateKind::File), vec![csv.clone()]);
        match classify_event(&event, &config) {
            Some(WatchEvent::SourceFileChanged { path }) => assert_eq!(path, csv),
            other => panic!("Expected SourceFileChanged, got {:?}", other.is_some()),
        }
    }

    #[test]
    fn classify_ignores_delete() {
        let config = PathBuf::from("/home/user/.finwatch/config.json");
        let event = make_event(
            EventKind::Remove(notify::event::RemoveKind::File),
            vec![config.clone()],
        );
        assert!(classify_event(&event, &config).is_none());
    }

    #[test]
    fn classify_ignores_unrelated_file() {
        let config = PathBuf::from("/home/user/.finwatch/config.json");
        let txt = PathBuf::from("/tmp/notes.txt");
        let event = make_event(
            EventKind::Modify(ModifyKind::Data(notify::event::DataChange::Content)),
            vec![txt],
        );
        assert!(classify_event(&event, &config).is_none());
    }

    #[test]
    fn create_watcher_compiles() {
        let (tx, _rx) = mpsc::channel();
        let config = PathBuf::from("/tmp/test-config.json");
        let result = create_watcher(tx, config);
        assert!(result.is_ok());
    }
}
