use super::*;
impl ThumbnailService {
    pub async fn start(
        self: &Arc<Self>,
        app: AppHandle,
        request_id: String,
        request: ThumbnailRequest,
    ) -> Result<(), String> {
        crate::valid_request_id(&request_id)?;
        validate_request(&request)?;
        let consumer = self.consumers.register(
            Uuid::parse_str(&request.consumer_id).map_err(|_| "thumbnail.bad_request")?,
        )?;
        if consumer.started.swap(true, Ordering::Relaxed) {
            return Err("thumbnail.bad_request".into());
        }
        let (idle, ac) = self.policy.samples();
        if !self
            .policy
            .eligible(BackgroundTaskKind::Thumbnails, idle, ac)
        {
            if consumer.cancelled.load(Ordering::Relaxed) {
                return Err("background.cancelled".into());
            }
            app.state::<Jobs>().begin(&request_id, 1)?;
            app.state::<Jobs>().finish(
                &request_id,
                Ok(json!(ThumbnailReply {
                    state: ThumbnailState::Paused,
                    lease: None
                })),
            );
            return Ok(());
        }
        let cache = Arc::clone(&self.cache);
        let path = request.path.clone();
        let expected =
            tauri::async_runtime::spawn_blocking(move || cache.source_stamp(Path::new(&path)))
                .await
                .map_err(|_| "thumbnail.failed")?
                .map_err(stamp_code)?;
        if consumer.cancelled.load(Ordering::Relaxed) {
            return Err("background.cancelled".into());
        }
        let service = Arc::clone(self);
        let path = request.path.clone();
        let stamp = expected.clone();
        let edge = request.edge;
        let key =
            tauri::async_runtime::spawn_blocking(move || service.provider_key(&stamp, &path, edge))
                .await
                .map_err(|_| "thumbnail.failed")??;
        let hash = key_hash(&key).map_err(|_| "thumbnail.bad_request")?;
        let (group, owner) = {
            let mut groups = self.groups.lock().map_err(|_| "thumbnail.failed")?;
            groups.retain(|_, group| !group.all_cancelled());
            if groups.len() >= 1024 && !groups.contains_key(&hash) {
                return Err("thumbnail.busy".into());
            }
            let owner = !groups.contains_key(&hash);
            let group = Arc::clone(
                groups
                    .entry(hash.clone())
                    .or_insert_with(|| Arc::new(Group::new())),
            );
            let mut state = group.state.lock().map_err(|_| "thumbnail.failed")?;
            if state.waiters.len() >= 1024 {
                return Err("thumbnail.busy".into());
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
                    BackgroundTaskKind::Thumbnails,
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
                let mut state = group.state.lock().map_err(|_| "thumbnail.failed")?;
                state.admitted = true;
                group.wake.notify_all();
            }
            let service = Arc::clone(self);
            let work_group = Arc::clone(&group);
            let work_app = app.clone();
            let path = request.path.clone();
            let edge = request.edge;
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
                    edge,
                    &work_group.token,
                    Some(&context),
                );
                service.complete(&work_app, &work_group, outcome);
                let _ = monitor.join();
            });
        } else {
            group.wait_admission(&consumer).await?;
        }
        let immediate =
            {
                let mut state = group.state.lock().map_err(|_| "thumbnail.failed")?;
                if consumer.cancelled.load(Ordering::Relaxed) {
                    return Err("background.cancelled".into());
                }
                let token = match app.state::<Jobs>().begin(&request_id, 1) {
                    Ok(token) => token,
                    Err(error) => {
                        consumer.cancelled.store(true, Ordering::Relaxed);
                        return Err(error);
                    }
                };
                if let Some(waiter) = state.waiters.iter_mut().find(|waiter| {
                    waiter.id == request_id && Arc::ptr_eq(&waiter.consumer, &consumer)
                }) {
                    waiter.job_token = Some(token);
                }
                state.outcome.clone()
            };
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
