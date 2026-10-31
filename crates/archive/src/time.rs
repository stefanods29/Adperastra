//! Dates from archives (Step 06d D10, Step 06e T6). Zip stores a "DOS time"
//! in local time with no zone; Windows' own zone rules turn it into a real
//! moment, exactly as the Explorer does for the same file. 7z and tar store
//! UTC. The reverse conversion is used when a new zip is written.

/// The local `(year, month, day, hour, minute, second)` a created zip
/// entry records for `unix`, or `None` when the moment cannot be written.
pub fn unix_to_dos_local(unix: u64) -> Option<(u16, u8, u8, u8, u8, u8)> {
    if unix == 0 {
        return None;
    }
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::{FILETIME, SYSTEMTIME};
        use windows::Win32::System::Time::{FileTimeToSystemTime, SystemTimeToTzSpecificLocalTime};
        let ticks = unix.checked_add(11_644_473_600)?.checked_mul(10_000_000)?;
        let file_time = FILETIME {
            dwLowDateTime: (ticks & 0xffff_ffff) as u32,
            dwHighDateTime: (ticks >> 32) as u32,
        };
        let mut utc = SYSTEMTIME::default();
        // SAFETY: both structures are locals that outlive the calls.
        unsafe { FileTimeToSystemTime(&file_time, &mut utc) }.ok()?;
        let mut local = SYSTEMTIME::default();
        // SAFETY: same; `None` asks for the current zone.
        unsafe { SystemTimeToTzSpecificLocalTime(None, &utc, &mut local) }.ok()?;
        Some((
            local.wYear,
            local.wMonth as u8,
            local.wDay as u8,
            local.wHour as u8,
            local.wMinute as u8,
            local.wSecond as u8,
        ))
    }
    #[cfg(not(windows))]
    {
        let _ = unix;
        None
    }
}

/// A zip entry's `(year, month, day, hour, minute, second)` in the PC's own
/// time zone, as seconds since 1970. 0 when the values are impossible (a
/// damaged or unset date) or Windows cannot convert them.
pub fn dos_local_to_unix(year: u16, month: u8, day: u8, hour: u8, minute: u8, second: u8) -> u64 {
    if !(1980..=2107).contains(&year)
        || !(1..=12).contains(&month)
        || !(1..=31).contains(&day)
        || hour > 23
        || minute > 59
        || second > 59
    {
        return 0;
    }
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::SYSTEMTIME;
        use windows::Win32::System::Time::{SystemTimeToFileTime, TzSpecificLocalTimeToSystemTime};
        let local = SYSTEMTIME {
            wYear: year,
            wMonth: u16::from(month),
            wDayOfWeek: 0,
            wDay: u16::from(day),
            wHour: u16::from(hour),
            wMinute: u16::from(minute),
            wSecond: u16::from(second),
            wMilliseconds: 0,
        };
        let mut utc = SYSTEMTIME::default();
        // SAFETY: both pointers refer to locals that outlive the calls.
        let converted = unsafe { TzSpecificLocalTimeToSystemTime(None, &local, &mut utc) };
        if converted.is_err() {
            return 0;
        }
        let mut filetime = windows::Win32::Foundation::FILETIME::default();
        // SAFETY: `utc` is a valid SYSTEMTIME and `filetime` a local of the
        // type the call writes.
        if unsafe { SystemTimeToFileTime(&utc, &mut filetime) }.is_err() {
            return 0;
        }
        let ticks = (u64::from(filetime.dwHighDateTime) << 32) | u64::from(filetime.dwLowDateTime);
        fs_service::filetime_to_unix(ticks)
    }
    #[cfg(not(windows))]
    {
        // Without the Windows zone rules the local time is taken as UTC.
        let _ = (year, month, day, hour, minute, second);
        0
    }
}
