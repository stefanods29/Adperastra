//! Worker half of Step 22a T7, split from presentation_session.rs.

use super::*;

#[allow(clippy::too_many_arguments)]
pub(super) fn run_session(
    engine: Arc<dyn PresentationEngine>,
    presentation_id: Uuid,
    session_id: Uuid,
    request: PresentationRequest,
    deck: PresentationDeckInfo,
    display: DisplayChoice,
    app: AppHandle,
    mut helper: crate::webview_helper::WebviewHelperSession,
    state: Arc<Mutex<PresentationState>>,
    receiver: Receiver<SessionCommand>,
    cancel: fs_service::CancellationToken,
) -> Result<(), String> {
    let binding = engine.presentation_start(session_id, request.slide_id)?;
    let mut last_sequence = 0u64;
    let mut started_at = Instant::now();
    let mut paused_total = Duration::ZERO;
    let mut paused_at: Option<Instant> = None;
    let mut leases = FrameLeaseTracker::default();
    let first = engine.presentation_step(
        binding.id,
        PresentationIntent::GoTo { slide_id: request.slide_id },
    )?;
    present_frame(
        &mut helper, session_id, presentation_id, &first, &deck, &state, &app, &cancel,
        &mut leases, started_at, paused_total, paused_at,
    )?;
    let mut ticks = 0u32;
    let mut display_lost = false;

    loop {
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        match receiver.try_recv() {
            Ok(SessionCommand::Navigate(intent, reply)) => {
                let result = apply_intent(
                    &*engine, binding.id, session_id, presentation_id, intent, &deck, &mut helper,
                    &state, &app, &cancel, &mut leases, &mut started_at, &mut paused_total,
                    &mut paused_at,
                );
                let _ = reply.send(result);
            }
            Ok(SessionCommand::End(reply)) => {
                finish(&*engine, binding.id, &mut helper, &mut leases, &state, &app);
                let _ = reply.send(());
                return Ok(());
            }
            Err(mpsc::TryRecvError::Disconnected) => break,
            Err(mpsc::TryRecvError::Empty) => {}
        }
        ticks = ticks.wrapping_add(1);
        if ticks.is_multiple_of(DISPLAY_RECHECK_EVERY) {
            let live = crate::presentation_displays::list_displays()
                .map(|displays| crate::presentation_displays::choice_is_live(&display, &displays))
                .unwrap_or(false);
            if !live {
                if !display_lost {
                    display_lost = true;
                    set_paused(&state, &app, true);
                    let _ = app.emit("office-presentation-display-lost", presentation_id);
                }
                std::thread::sleep(IDLE_POLL);
                continue;
            }
            display_lost = false;
        }
        let wait = PresentationWaitIntentRequest {
            presentation_id,
            after_sequence: last_sequence,
            wait_ms: crate::presentation_helper_types::PRESENTATION_WAIT_MS,
        };
        let request = WebviewHelperRequest {
            request_id: Uuid::new_v4(),
            action: HelperAction::PresentationWaitIntent,
            payload: serde_json::to_value(wait).map_err(|_| "presentation.failed".to_string())?,
            output_specs: Vec::new(),
        };
        let reply = match helper.request(request, cancel.clone()) {
            Ok(result) => result,
            Err(_) => break,
        };
        let reply: PresentationIntentReply =
            serde_json::from_value(reply.reply).map_err(|_| "presentation.failed".to_string())?;
        if reply.presentation_id != presentation_id {
            continue;
        }
        let Some(intent) = reply.intent else {
            std::thread::sleep(WAIT_SLEEP);
            continue;
        };
        if !intent_is_new(reply.sequence, last_sequence) {
            continue;
        }
        last_sequence = reply.sequence;
        if matches!(&intent, PresentationIntent::End) {
            finish(&*engine, binding.id, &mut helper, &mut leases, &state, &app);
            return Ok(());
        }
        apply_intent(
            &*engine, binding.id, session_id, presentation_id, intent, &deck, &mut helper,
            &state, &app, &cancel, &mut leases, &mut started_at, &mut paused_total, &mut paused_at,
        )?;
    }
    finish(&*engine, binding.id, &mut helper, &mut leases, &state, &app);
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn apply_intent(
    engine: &dyn PresentationEngine,
    binding_id: Uuid,
    session_id: Uuid,
    presentation_id: Uuid,
    intent: PresentationIntent,
    deck: &PresentationDeckInfo,
    helper: &mut crate::webview_helper::WebviewHelperSession,
    state: &Arc<Mutex<PresentationState>>,
    app: &AppHandle,
    cancel: &fs_service::CancellationToken,
    leases: &mut FrameLeaseTracker,
    started_at: &mut Instant,
    paused_total: &mut Duration,
    paused_at: &mut Option<Instant>,
) -> Result<PresentationState, String> {
    if let PresentationIntent::GoTo { slide_id } = &intent {
        if deck.hidden.contains(slide_id) || !deck.visible().contains(slide_id) {
            return Err("presentation.invalid".to_string());
        }
    }
    if matches!(&intent, PresentationIntent::ResetTimer) {
        *started_at = Instant::now();
        *paused_total = Duration::ZERO;
        *paused_at = None;
    }
    let was_paused = state.lock().map(|value| value.paused).unwrap_or(false);
    let pause_next = if matches!(&intent, PresentationIntent::TogglePause) {
        if was_paused {
            if let Some(at) = paused_at.take() {
                *paused_total += at.elapsed();
            }
            false
        } else {
            *paused_at = Some(Instant::now());
            true
        }
    } else {
        was_paused
    };
    let black_next = if matches!(&intent, PresentationIntent::ToggleBlack) {
        !state.lock().map(|value| value.black).unwrap_or(false)
    } else {
        state.lock().map(|value| value.black).unwrap_or(false)
    };
    let frame = engine.presentation_step(binding_id, intent)?;
    if let Ok(mut value) = state.lock() {
        value.paused = pause_next;
        value.black = black_next;
        value.ended = false;
    }
    present_frame(
        helper, session_id, presentation_id, &frame, deck, state, app, cancel, leases,
        *started_at, *paused_total, *paused_at,
    )?;
    emit(state, app);
    state.lock().map(|value| value.clone()).map_err(|_| "presentation.failed".to_string())
}

#[allow(clippy::too_many_arguments)]
fn present_frame(
    helper: &mut crate::webview_helper::WebviewHelperSession,
    session_id: Uuid,
    presentation_id: Uuid,
    frame: &BindingPresentationFrame,
    deck: &PresentationDeckInfo,
    state: &Arc<Mutex<PresentationState>>,
    app: &AppHandle,
    cancel: &fs_service::CancellationToken,
    leases: &mut FrameLeaseTracker,
    started_at: Instant,
    paused_total: Duration,
    paused_at: Option<Instant>,
) -> Result<(), String> {
    let grant = prepare_audience_frame_input(session_id, presentation_id, frame)?;
    if !sensitive_frame_allowed(helper.private_profile_verified(), grant.source.is_sensitive()) {
        return Err("helper.sensitive_unsupported".to_string());
    }
    helper.update_inputs(vec![grant], cancel.clone())?;
    let black = state.lock().map(|value| value.black).unwrap_or(false);
    let paused = state.lock().map(|value| value.paused).unwrap_or(false);
    let payload = PresentationAudienceFrame {
        presentation_id,
        slide_id: frame.slide_id,
        frame_revision: frame.frame_revision,
        image_grant_id: frame.image.lease_id,
        width: frame.width,
        height: frame.height,
        black,
        paused,
    };
    let request = WebviewHelperRequest {
        request_id: Uuid::new_v4(),
        action: HelperAction::PresentationFrame,
        payload: serde_json::to_value(payload).map_err(|_| "presentation.failed".to_string())?,
        output_specs: Vec::new(),
    };
    let result = helper.request(request, cancel.clone())?;
    let ack: PresentationFrameAck =
        serde_json::from_value(result.reply).map_err(|_| "presentation.failed".to_string())?;
    if !ack.displayed || ack.presentation_id != presentation_id || ack.frame_revision != frame.frame_revision {
        return Err("presentation.failed".to_string());
    }
    leases.acknowledge(frame.image.lease_id);
    let elapsed = elapsed_ms(started_at, paused_total, paused_at);
    if let Ok(mut value) = state.lock() {
        value.slide_id = frame.slide_id;
        value.slide_index = deck.visible_index(frame.slide_id).unwrap_or(0);
        value.slide_count = deck.visible().len() as u32;
        value.step_index = frame.step_index;
        value.elapsed_ms = elapsed;
        value.black = black;
        value.paused = paused;
        value.ended = false;
    }
    emit(state, app);
    Ok(())
}

fn set_paused(state: &Arc<Mutex<PresentationState>>, app: &AppHandle, paused: bool) {
    if let Ok(mut value) = state.lock() {
        value.paused = paused;
    }
    emit(state, app);
}

pub(crate) fn elapsed_ms(started_at: Instant, paused_total: Duration, paused_at: Option<Instant>) -> u64 {
    let mut elapsed = started_at.elapsed();
    if let Some(at) = paused_at {
        elapsed = elapsed.saturating_sub(at.elapsed());
    }
    elapsed.saturating_sub(paused_total).as_millis().min(u128::from(u64::MAX)) as u64
}

fn emit(state: &Arc<Mutex<PresentationState>>, app: &AppHandle) {
    if let Ok(value) = state.lock() {
        let _ = app.emit("office-presentation-state", value.clone());
    }
}

fn finish(
    engine: &dyn PresentationEngine,
    binding_id: Uuid,
    helper: &mut crate::webview_helper::WebviewHelperSession,
    leases: &mut FrameLeaseTracker,
    state: &Arc<Mutex<PresentationState>>,
    app: &AppHandle,
) {
    let presentation_id = state.lock().map(|value| value.presentation_id).unwrap_or_default();
    let request = WebviewHelperRequest {
        request_id: Uuid::new_v4(),
        action: HelperAction::PresentationEnd,
        payload: serde_json::to_value(PresentationAudienceEnd { presentation_id }).unwrap_or_default(),
        output_specs: Vec::new(),
    };
    let _ = helper.request(request, fs_service::new_cancellation_token());
    let _ = helper.close();
    let _ = engine.presentation_end(binding_id);
    leases.clear();
    if let Ok(mut value) = state.lock() {
        value.ended = true;
        value.paused = true;
    }
    emit(state, app);
}
