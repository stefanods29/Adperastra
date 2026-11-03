use super::*;
impl MetadataService {
    pub async fn start(
        self: &Arc<Self>,
        app: AppHandle,
        request_id: String,
        request: MetadataRequest,
    ) -> Result<(), String> {
        crate::valid_request_id(&request_id)?;
        validate_request(&request)?;
        let consumer = self
            .consumers
            .register(Uuid::parse_str(&request.consumer_id).map_err(|_| "metadata.bad_request")?)?;
        if consumer.started.swap(true, Ordering::Relaxed) {
            return Err("metadata.bad_request".into());
        }
        let (idle, ac) = self.policy.samples();
        if !self.policy.eligible(BackgroundTaskKind::Metadata, idle, ac) {
            if consumer.token.load(Ordering::Relaxed) {
                return Err("background.cancelled".into());
            }
            return Err("background.paused".into());
        }
        let cache = Arc::clone(&self.cache);
        let path = request.path.clone();
        let expected =
            tauri::async_runtime::spawn_blocking(move || cache.source_stamp(Path::new(&path)))
                .await
                .map_err(|_| "metadata.failed")?
                .map_err(stamp_code)?;
        if consumer.token.load(Ordering::Relaxed) {
            return Err("background.cancelled".into());
        }
        let key = cache_key(&expected);
        let hash = key_hash(&key).map_err(|_| "metadata.bad_request")?;
        let (group, owner) = {
            let mut groups = self.groups.lock().map_err(|_| "metadata.failed")?;
            groups.retain(|_, group| !group.all_cancelled());
            if groups.len() >= MAX_ACTIVE_CONSUMERS && !groups.contains_key(&hash) {
                return Err("background.busy".into());
            }
            let owner = !groups.contains_key(&hash);
            let group = Arc::clone(
                groups
                    .entry(hash.clone())
                    .or_insert_with(|| Arc::new(Group::new())),
            );
            let mut state = group.state.lock().map_err(|_| "metadata.failed")?;
            if state.waiters.len() >= MAX_ACTIVE_CONSUMERS {
                return Err("background.busy".into());
            }
            state.waiters.push(Waiter {
                id: request_id.clone(),
                consumer: Arc::clone(&consumer),
                job_token: None,
            });
            drop(state);
            (group, owner)
        };
        if owner {
            let permit = match self
                .scheduler
                .acquire(
                    BackgroundTaskKind::Metadata,
                    group.id,
                    BackgroundPriority::Visible,
                    group.token.clone(),
                )
                .await
            {
                Ok(permit) => permit,
                Err(error) => {
                    let code = admission_code(error);
                    self.complete(&app, &group, Err(code.clone()));
                    return Err(code);
                }
            };
            // Releasing the first consumer does not prevent attached consumers from proceeding.
            if group.all_cancelled() {
                group.token.store(true, Ordering::Relaxed);
                drop(permit);
                self.complete(&app, &group, Err("background.cancelled".into()));
                return Err("background.cancelled".into());
            }
            {
                let mut state = group.state.lock().map_err(|_| "metadata.failed")?;
                state.admitted = true;
                group.wake.notify_all();
            }
            let service = Arc::clone(self);
            let work_group = Arc::clone(&group);
            let work_app = app.clone();
            let path = request.path.clone();
            tauri::async_runtime::spawn_blocking(move || {
                let _permit = permit;
                let context = JobContext::background(
                    work_app.clone(),
                    work_group.id.to_string(),
                    work_group.token.clone(),
                );
                let watched = Arc::clone(&work_group);
                let monitor = std::thread::spawn(move || loop {
                    if watched
                        .state
                        .lock()
                        .map(|state| state.outcome.is_some())
                        .unwrap_or(true)
                    {
                        break;
                    }
                    if watched.all_cancelled() {
                        watched.token.store(true, Ordering::Relaxed);
                        break;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(25));
                });
                let outcome = service.render_request(
                    &key,
                    &path,
                    &expected,
                    &work_group.token,
                    Some(&context),
                );
                service.complete(&work_app, &work_group, outcome);
                let _ = monitor.join();
            });
        } else {
            group.wait_admission(&consumer).await?;
        }
        let immediate = group.admit_waiter(&app.state::<Jobs>(), &request_id, &consumer)?;
        if let Some(outcome) = immediate {
            self.finish_waiter(
                &app,
                &Waiter {
                    id: request_id,
                    consumer,
                    job_token: None,
                },
                &outcome,
            );
        }
        Ok(())
    }
}
