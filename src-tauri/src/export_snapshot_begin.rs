impl ExportSnapshots {

    /// `root` is `<data>/export-input`; it is created and pinned once.
    pub fn new(root: PathBuf) -> Result<Self, String> {
        std::fs::create_dir_all(&root).map_err(|_| "snapshot.bad_request".to_string())?;
        let input_dir =
            PinnedDirectory::open(&root).map_err(|_| "snapshot.bad_request".to_string())?;
        Ok(Self {
            input_dir: Arc::new(input_dir),
            budget: Arc::new(SnapshotBudget::default()),
            authorities: SnapshotAuthorityRegistry::default(),
            uploads: Mutex::new(HashMap::new()),
            finalized: Mutex::new(HashMap::new()),
        })
    }

    pub fn authorities(&self) -> &SnapshotAuthorityRegistry {
        &self.authorities
    }

    pub fn root(&self) -> &Path {
        self.input_dir.path()
    }

    fn uploads_lock(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, UploadEntries>, String> {
        self.uploads
            .lock()
            .map_err(|_| "snapshot.bad_request".to_string())
    }

    fn finalized_lock(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, HashMap<Uuid, Arc<FinalizedEntry>>>, String> {
        self.finalized
            .lock()
            .map_err(|_| "snapshot.bad_request".to_string())
    }

    /// Start one upload. Native validation decides the policy, the MIME and
    /// whether the source identity matches the authority.
    pub fn begin(&self, request: SnapshotBeginRequest) -> Result<SnapshotBeginReply, String> {
        if request.revision == 0
            || request.byte_len == 0
            || request.byte_len > MAX_SNAPSHOT_BYTES
            || !valid_snapshot_mime(&request.mime)
        {
            return Err("snapshot.bad_request".to_string());
        }
        let record = self.authorities.get(request.document_id)?;
        if !record.capture_mimes.iter().any(|mime| mime == &request.mime) {
            return Err("snapshot.bad_request".to_string());
        }
        // The policy and the source identity come from the authority, never
        // from the request. A sensitive authority stays sensitive even when
        // the source is omitted; a provided source must match exactly.
        if let (Some(expected), Some(provided)) = (&record.source, &request.source) {
            if expected != provided {
                return Err("snapshot.bad_request".to_string());
            }
        }
        let source = record.source.clone();
        let live_uploads = self.uploads_lock()?.len();
        if live_uploads >= 32 {
            return Err("snapshot.too_large".to_string());
        }
        self.budget.reserve(request.byte_len)?;
        let snapshot_id = Uuid::new_v4();
        let token = Uuid::new_v4().simple().to_string();
        let entry = if record.authority.storage_policy == StoragePolicy::Sensitive {
            UploadEntry {
                document_id: request.document_id,
                revision: request.revision,
                content_id: request.content_id,
                token: token.clone(),
                expected_len: request.byte_len,
                mime: request.mime,
                source,
                policy: StoragePolicy::Sensitive,
                offset: 0,
                hasher: Sha256::new(),
                ordinary: None,
                sensitive: Some(Zeroizing::new(Vec::with_capacity(
                    usize::try_from(request.byte_len).unwrap_or(0),
                ))),
                last_touched: Instant::now(),
                finished: false,
            }
        } else {
            let output = match OwnedOutput::create(&self.input_dir, "snapshot") {
                Ok(output) => output,
                Err(_) => {
                    self.budget.release(request.byte_len);
                    return Err("snapshot.bad_request".to_string());
                }
            };
            UploadEntry {
                document_id: request.document_id,
                revision: request.revision,
                content_id: request.content_id,
                token: token.clone(),
                expected_len: request.byte_len,
                mime: request.mime,
                source,
                policy: StoragePolicy::Ordinary,
                offset: 0,
                hasher: Sha256::new(),
                ordinary: Some(output),
                sensitive: None,
                last_touched: Instant::now(),
                finished: false,
            }
        };
        let mut uploads = match self.uploads_lock() {
            Ok(uploads) => uploads,
            Err(error) => {
                self.budget.release(request.byte_len);
                return Err(error);
            }
        };
        if uploads.len() >= 32 {
            self.budget.release(request.byte_len);
            return Err("snapshot.too_large".into());
        }
        uploads.insert(snapshot_id, Arc::new(Mutex::new(entry)));
        Ok(SnapshotBeginReply {
            snapshot_id: snapshot_id.to_string(),
            upload_token: token,
        })
    }


}
