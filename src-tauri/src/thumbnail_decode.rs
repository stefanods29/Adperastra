//! Bounded WIC decoding for thumbnails (Step 07a, E8).
//!
//! The decoder reads the guarded source handle into a bounded buffer and
//! hands WIC a memory stream, so it never reopens the user's path. Dimensions
//! are checked before any pixel allocation, orientation is applied before
//! scaling, and the result is a tightly packed RGBA buffer of the upright scaled size.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};

/// Largest source file the helper reads into memory.
pub const MAX_SOURCE_BYTES: u64 = 64 * 1024 * 1024;
/// Largest edge any result may have.
pub const MAX_EDGE_LIMIT: u32 = 65_536;
/// Largest pixel product any result may have.
pub const MAX_PIXELS_LIMIT: u64 = 100_000_000;

/// Tightly packed, unpremultiplied sRGB RGBA pixels (the E8 contract).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedPixels {
    pub width: u32,
    pub height: u32,
    pub stride: u32,
    pub rgba: Vec<u8>,
    pub original_width: u32,
    pub original_height: u32,
    pub orientation: u8,
}

/// Decode the first frame of `source`, bound it, rotate it upright and fit it
/// inside `max_edge`. Never upscales. Errors are `thumbnail.*` codes.
pub fn decode_pixels(
    source: &File,
    max_edge: u32,
    max_pixels: u64,
) -> Result<DecodedPixels, String> {
    if max_edge == 0 || max_edge > MAX_EDGE_LIMIT {
        return Err("thumbnail.bad_request".to_string());
    }
    if max_pixels == 0 || max_pixels > MAX_PIXELS_LIMIT {
        return Err("thumbnail.bad_request".to_string());
    }
    let bytes = read_source(source)?;
    decode_bytes(&bytes, max_edge, max_pixels)
}

fn read_source(source: &File) -> Result<Vec<u8>, String> {
    let mut reader = source
        .try_clone()
        .map_err(|_| "thumbnail.failed".to_string())?;
    reader
        .seek(SeekFrom::Start(0))
        .map_err(|_| "thumbnail.failed".to_string())?;
    let mut bytes = Vec::new();
    reader
        .take(MAX_SOURCE_BYTES.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|_| "thumbnail.failed".to_string())?;
    if bytes.is_empty() {
        return Err("thumbnail.failed".to_string());
    }
    if bytes.len() as u64 > MAX_SOURCE_BYTES {
        return Err("thumbnail.too_large".to_string());
    }
    Ok(bytes)
}

#[cfg(windows)]
fn decode_bytes(bytes: &[u8], max_edge: u32, max_pixels: u64) -> Result<DecodedPixels, String> {
    use windows::core::Interface;
    use windows::Win32::Foundation::HGLOBAL;
    use windows::Win32::Graphics::Imaging::{
        CLSID_WICImagingFactory, GUID_WICPixelFormat32bppBGRA, IWICBitmapFlipRotator,
        IWICBitmapScaler, IWICBitmapSource, IWICImagingFactory, IWICPalette,
        WICBitmapDitherTypeNone, WICBitmapInterpolationModeFant, WICBitmapPaletteTypeCustom,
        WICBitmapTransformOptions, WICDecodeMetadataCacheOnLoad,
    };
    use windows::Win32::System::Com::StructuredStorage::CreateStreamOnHGlobal;
    use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER, STREAM_SEEK_SET};

    let _com = ComGuard::init()?;
    // SAFETY: every COM object below is local, initialized before use and
    // dropped before this function returns (so before the source guard).
    unsafe {
        let stream = CreateStreamOnHGlobal(HGLOBAL::default(), true)
            .map_err(|_| "thumbnail.failed".to_string())?;
        let mut written = 0u32;
        stream
            .Write(
                bytes.as_ptr().cast(),
                bytes.len() as u32,
                Some(&mut written),
            )
            .ok()
            .map_err(|_| "thumbnail.failed".to_string())?;
        if written as usize != bytes.len() {
            return Err("thumbnail.failed".to_string());
        }
        stream
            .Seek(0, STREAM_SEEK_SET, None)
            .map_err(|_| "thumbnail.failed".to_string())?;
        let factory: IWICImagingFactory =
            CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER)
                .map_err(|_| "thumbnail.failed".to_string())?;
        let decoder = factory
            .CreateDecoderFromStream(&stream, std::ptr::null(), WICDecodeMetadataCacheOnLoad)
            .map_err(|_| "thumbnail.failed".to_string())?;
        let frame = decoder
            .GetFrame(0)
            .map_err(|_| "thumbnail.failed".to_string())?;
        let (mut width, mut height) = (0u32, 0u32);
        frame
            .GetSize(&mut width, &mut height)
            .map_err(|_| "thumbnail.failed".to_string())?;
        validate_dimensions(width, height, max_pixels)?;
        let orientation = read_orientation(&frame).unwrap_or(1);
        let (original_width, original_height) = orientation_dimensions(width, height, orientation);
        let source: IWICBitmapSource = frame.cast().map_err(|_| "thumbnail.failed".to_string())?;
        let upright: IWICBitmapSource = if orientation == 1 {
            source
        } else {
            let rotator: IWICBitmapFlipRotator = factory
                .CreateBitmapFlipRotator()
                .map_err(|_| "thumbnail.failed".to_string())?;
            rotator
                .Initialize(
                    &source,
                    WICBitmapTransformOptions(transform_for_orientation(orientation) as i32),
                )
                .map_err(|_| "thumbnail.failed".to_string())?;
            rotator.cast().map_err(|_| "thumbnail.failed".to_string())?
        };
        let (target_width, target_height) =
            scaled_dimensions(original_width, original_height, max_edge);
        let scaler: IWICBitmapScaler = factory
            .CreateBitmapScaler()
            .map_err(|_| "thumbnail.failed".to_string())?;
        scaler
            .Initialize(
                &upright,
                target_width,
                target_height,
                WICBitmapInterpolationModeFant,
            )
            .map_err(|_| "thumbnail.failed".to_string())?;
        let scaler_source: IWICBitmapSource =
            scaler.cast().map_err(|_| "thumbnail.failed".to_string())?;
        let converter = factory
            .CreateFormatConverter()
            .map_err(|_| "thumbnail.failed".to_string())?;
        converter
            .Initialize(
                &scaler_source,
                &GUID_WICPixelFormat32bppBGRA,
                WICBitmapDitherTypeNone,
                None::<&IWICPalette>,
                0.0,
                WICBitmapPaletteTypeCustom,
            )
            .map_err(|_| "thumbnail.failed".to_string())?;
        let stride = target_width
            .checked_mul(4)
            .ok_or_else(|| "thumbnail.too_large".to_string())?;
        let length = (stride as u64)
            .checked_mul(u64::from(target_height))
            .ok_or_else(|| "thumbnail.too_large".to_string())?;
        let length = usize::try_from(length).map_err(|_| "thumbnail.too_large")?;
        let mut rgba = Vec::new();
        rgba.try_reserve_exact(length)
            .map_err(|_| "thumbnail.too_large")?;
        rgba.resize(length, 0);
        converter
            .CopyPixels(std::ptr::null(), stride, &mut rgba)
            .map_err(|_| "thumbnail.failed".to_string())?;
        for pixel in rgba.as_chunks_mut::<4>().0 {
            pixel.swap(0, 2);
        }
        Ok(DecodedPixels {
            width: target_width,
            height: target_height,
            stride,
            rgba,
            original_width,
            original_height,
            orientation,
        })
    }
}

#[cfg(not(windows))]
fn decode_bytes(_bytes: &[u8], _max_edge: u32, _max_pixels: u64) -> Result<DecodedPixels, String> {
    Err("thumbnail.failed".to_string())
}

/// Check one decoded frame before allocating its pixels.
pub fn validate_dimensions(width: u32, height: u32, max_pixels: u64) -> Result<(), String> {
    if width == 0 || height == 0 || width > MAX_EDGE_LIMIT || height > MAX_EDGE_LIMIT {
        return Err("thumbnail.too_large".to_string());
    }
    if u64::from(width) * u64::from(height) > max_pixels.min(MAX_PIXELS_LIMIT) {
        return Err("thumbnail.too_large".to_string());
    }
    Ok(())
}

/// The displayed size before scaling: orientations 5 to 8 swap the axes.
pub fn orientation_dimensions(width: u32, height: u32, orientation: u8) -> (u32, u32) {
    if (5..=8).contains(&orientation) {
        (height, width)
    } else {
        (width, height)
    }
}

/// Fit inside a square without upscaling; each side rounds to nearest and
/// never goes below one pixel.
pub fn scaled_dimensions(width: u32, height: u32, max_edge: u32) -> (u32, u32) {
    let longest = width.max(height);
    if longest <= max_edge {
        return (width, height);
    }
    let scale = f64::from(max_edge) / f64::from(longest);
    (
        ((f64::from(width) * scale).round() as u32).max(1),
        ((f64::from(height) * scale).round() as u32).max(1),
    )
}

/// WIC's clockwise transform for an EXIF orientation value.
pub fn transform_for_orientation(orientation: u8) -> u32 {
    // Values are the WIC option bits; the helper keeps them as a number so
    // this mapping is unit-testable without COM.
    const ROTATE_0: u32 = 0;
    const ROTATE_90: u32 = 1;
    const ROTATE_180: u32 = 2;
    const ROTATE_270: u32 = 3;
    const FLIP_HORIZONTAL: u32 = 8;
    const FLIP_VERTICAL: u32 = 16;
    match orientation {
        2 => FLIP_HORIZONTAL,
        3 => ROTATE_180,
        4 => FLIP_VERTICAL,
        // WIC applies the flip after its clockwise rotation: transpose and
        // transverse therefore use 270 and 90 degrees respectively.
        5 => ROTATE_270 | FLIP_HORIZONTAL,
        6 => ROTATE_90,
        7 => ROTATE_90 | FLIP_HORIZONTAL,
        8 => ROTATE_270,
        _ => ROTATE_0,
    }
}

/// COM is initialized only for the duration of one decode; an apartment
/// that was already initialized by another part of the helper is left alone.
pub(crate) struct ComGuard {
    initialized: bool,
}

impl ComGuard {
    pub(crate) fn init() -> Result<Self, String> {
        #[cfg(windows)]
        {
            use windows::Win32::Foundation::RPC_E_CHANGED_MODE;
            use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
            // SAFETY: a null reservation and a valid apartment model.
            let result = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
            if result.is_ok() {
                Ok(Self { initialized: true })
            } else if result == RPC_E_CHANGED_MODE {
                Ok(Self { initialized: false })
            } else {
                Err("thumbnail.failed".to_string())
            }
        }
        #[cfg(not(windows))]
        {
            Ok(Self { initialized: false })
        }
    }
}

impl Drop for ComGuard {
    fn drop(&mut self) {
        #[cfg(windows)]
        if self.initialized {
            // SAFETY: this guard initialized the apartment on this thread.
            unsafe { windows::Win32::System::Com::CoUninitialize() };
        }
    }
}

#[cfg(windows)]
fn read_orientation(
    frame: &windows::Win32::Graphics::Imaging::IWICBitmapFrameDecode,
) -> Option<u8> {
    use windows::core::PCWSTR;
    use windows::Win32::System::Com::StructuredStorage::{PropVariantClear, PROPVARIANT};
    use windows::Win32::System::Variant::{VT_I2, VT_I4, VT_UI2, VT_UI4};

    // SAFETY: frame is a live local COM interface on its initialized thread.
    let reader = unsafe { frame.GetMetadataQueryReader() }.ok()?;
    for name in ["/app1/ifd/{ushort=274}", "/ifd/{ushort=274}"] {
        let wide: Vec<u16> = name.encode_utf16().chain([0]).collect();
        let mut value = PROPVARIANT::default();
        // SAFETY: `wide` is a terminated string; `value` is zeroed and
        // cleared by PropVariantClear below.
        let result = unsafe { reader.GetMetadataByName(PCWSTR(wide.as_ptr()), &mut value) };
        if result.is_err() {
            // SAFETY: clear even a partially initialized failed result.
            unsafe {
                let _ = PropVariantClear(&mut value);
            }
            continue;
        }
        let number = unsafe {
            let inner = &value.Anonymous.Anonymous;
            let vt = inner.vt;
            if vt == VT_UI2 {
                Some(u32::from(inner.Anonymous.uiVal))
            } else if vt == VT_UI4 {
                Some(inner.Anonymous.ulVal)
            } else if vt == VT_I2 {
                u32::try_from(inner.Anonymous.iVal).ok()
            } else if vt == VT_I4 {
                u32::try_from(inner.Anonymous.lVal).ok()
            } else {
                None
            }
        };
        // SAFETY: the PROPVARIANT was filled by WIC and is cleared once.
        unsafe {
            let _ = PropVariantClear(&mut value);
        }
        if let Some(number) = number {
            if (1..=8).contains(&number) {
                return Some(number as u8);
            }
        }
    }
    None
}

#[cfg(test)]
#[path = "thumbnail_decode_tests.rs"]
mod tests;
