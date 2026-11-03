//! Stage a bounded immutable result, publish owned bytes, commit the hit last.
use crate::store::{acquire_file_lock, unix_now};
use crate::{cleanup, records, schema, CacheError, CacheKey, CacheRecord, CacheStore};
use fs_service::owned_io::{OwnedOutput, PinnedDirectory};
use rusqlite::params;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom, Write};

impl CacheStore {
    pub fn publish(
        &self,
        key: &CacheKey,
        source: &File,
        mime: &str,
        width: Option<u32>,
        height: Option<u32>,
    ) -> Result<CacheRecord, CacheError> {
        let hash = crate::key_hash(key)?;
        let before = fs_service::source_stamp::stamp_for_open_file(source)?;
        let cap = key.kind.blob_cap();
        if before.size_bytes == 0 {
            return Err(CacheError::BadRequest);
        }
        if before.size_bytes > cap {
            return Err(CacheError::TooLarge);
        }
        let mut reader = source.try_clone()?;
        reader.seek(SeekFrom::Start(0))?;
        let mut bytes = Vec::new();
        reader.take(cap + 1).read_to_end(&mut bytes)?;
        if bytes.len() as u64 != before.size_bytes {
            return Err(CacheError::Changed);
        }
        if fs_service::source_stamp::stamp_for_open_file(source)? != before {
            return Err(CacheError::Changed);
        }
        let _ops = self.operation()?;
        let _lock = acquire_file_lock(&self.root)?;
        let mut connection = self.connection()?;
        self.clean_pending(&connection)?;
        // A concurrent producer may have published this exact key already.
        if let Some((record, text)) = records::find_record(&connection, &hash)? {
            if text == serde_json::to_string(key).map_err(|_| CacheError::BadRequest)?
                && self.open_indexed_blob(&connection, &record).is_ok()
            {
                return Ok(record);
            }
            return Err(CacheError::Busy);
        }
        let id = uuid::Uuid::new_v4().to_string();
        let record = CacheRecord {
            key_hash: hash,
            blob_id: id.clone(),
            relative_name: format!("blobs/{id}.png"),
            mime: mime.to_string(),
            byte_len: bytes.len() as u64,
            width,
            height,
            used_unix: unix_now(),
            pending_delete: false,
        };
        record.validate()?;
        self.make_room(&connection, record.byte_len, true)?;
        self.flush_touches(&connection)?;
        let staging_name = format!("~adp-cache-{id}.partial");
        // Intent precedes exclusive creation; ownership is recorded only
        // after creation succeeds. A preexisting foreign path is never owned.
        connection.execute(
            "INSERT INTO pending(blob_id,key_hash,expected_len,state,staging_name)
            VALUES (?1,?2,?3,'staging',?4)",
            params![id, record.key_hash, record.byte_len as i64, staging_name],
        )?;
        schema::checkpoint(&connection)?;
        let pending = PinnedDirectory::open(&self.root.join("pending"))?;
        let mut output = match OwnedOutput::create_named(&pending, &staging_name) {
            Ok(output) => output,
            Err(error) => {
                connection.execute("DELETE FROM pending WHERE blob_id=?1", [&id])?;
                schema::checkpoint(&connection)?;
                return Err(error.into());
            }
        };
        let owner = cleanup::identity(output.file_mut())?;
        connection.execute(
            "INSERT INTO owned_blobs VALUES (?1,?2,?3)",
            params![
                id,
                format!("{:x}", owner.volume),
                format!("{:x}", owner.index)
            ],
        )?;
        schema::checkpoint(&connection)?;
        let result = (|| {
            // Metadata writes happened since admission. Account them before
            // allocating the entire pending result, never just blob contents.
            if cleanup::physical_bytes(&self.root)?
                .checked_add(record.byte_len)
                .is_none_or(|n| n > self.limit_bytes())
            {
                return Err(CacheError::Busy);
            }
            output.file_mut().write_all(&bytes)?;
            output.flush_sync()?;
            if fs_service::source_stamp::stamp_for_open_file(source)? != before {
                return Err(CacheError::Changed);
            }
            let target = self.root.join("blobs").join(format!("{id}.png"));
            output.close().publish_to(&target)?;
            connection.execute(
                "UPDATE pending SET state='published' WHERE blob_id=?1",
                [&id],
            )?;
            schema::checkpoint(&connection)?;
            let transaction = connection.transaction()?;
            transaction.execute("INSERT INTO entries(key_hash,key_text,kind,blob_id,relative_name,mime,
                byte_len,width,height,used_unix,pending_delete) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,0)",
                params![record.key_hash,serde_json::to_string(key).map_err(|_|CacheError::BadRequest)?,key.kind.as_str(),
                    id,record.relative_name,mime,record.byte_len as i64,width.map(i64::from),height.map(i64::from),record.used_unix as i64])?;
            transaction.execute("DELETE FROM pending WHERE blob_id=?1", [&id])?;
            transaction.commit()?;
            schema::checkpoint(&connection)?;
            if cleanup::physical_bytes(&self.root)? > self.limit_bytes() {
                self.remove_record(&connection, &record, true)?;
                return Err(CacheError::Busy);
            }
            Ok(record.clone())
        })();
        if result.is_err() {
            self.clean_pending(&connection)?;
        }
        result
    }
}
