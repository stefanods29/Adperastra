//! Camera RAW and Windows-codec image previews (Step 07g E7, D5/D6).
//!
//! WIC reads the guarded source handle. An embedded preview is preferred;
//! only an explicit full-resolution request decodes the RAW frame. A
//! missing codec is the explicit `special_view.codec_required` state, never
//! an empty success. No hand-written RAW decoder and no external binary.

use std::fs::File;

use windows::core::Interface;
use windows::Win32::Graphics::Imaging::{
    CLSID_WICImagingFactory, GUID_ContainerFormatPng, GUID_WICPixelFormat32bppBGRA,
    GUID_WICPixelFormat32bppRGBA, IWICBitmapSource, IWICFormatConverter, IWICImagingFactory,
    WICBitmapDitherTypeNone, WICBitmapEncoderNoCache, WICBitmapInterpolationModeFant,
    WICBitmapPaletteTypeCustom, WICDecodeMetadataCacheOnDemand,
};
use windows::Win32::System::Com::StructuredStorage::CreateStreamOnHGlobal;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
    COINIT_APARTMENTTHREADED,
};

use crate::special_view_types::{
    SpecialKind, SPECIAL_MAX_DECODED_PIXELS, SPECIAL_MAX_EDGE, SPECIAL_MAX_PREVIEW_BYTES,
};
use crate::thumbnail_decode::DecodedPixels;

pub const RAW_EXTENSIONS: [&str; 8] = ["cr2", "cr3", "nef", "arw", "dng", "raf", "orf", "rw2"];
pub const CODEC_IMAGE_EXTENSIONS: [&str; 2] = ["heic", "heif"];

pub fn is_raw_extension(ext: &str) -> bool {
    RAW_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str())
}

pub fn is_codec_image_extension(ext: &str) -> bool {
    CODEC_IMAGE_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImagePlan {
    EmbeddedPreview,
    FullFrame,
    CodecRequired,
}

/// Decide what to read without touching the file. A RAW image first uses
/// its embedded preview; a full decode happens only on an explicit zoom.
/// Codec images use an embedded preview when the installed codec offers
/// one, else their first frame.
pub fn special_image_plan(
    kind: SpecialKind,
    full_resolution: bool,
    has_preview: bool,
    has_codec: bool,
) -> ImagePlan {
    if full_resolution {
        return if has_codec {
            ImagePlan::FullFrame
        } else {
            ImagePlan::CodecRequired
        };
    }
    if !has_codec {
        return ImagePlan::CodecRequired;
    }
    if has_preview {
        ImagePlan::EmbeddedPreview
    } else if kind == SpecialKind::CodecImage {
        ImagePlan::FullFrame
    } else {
        ImagePlan::CodecRequired
    }
}

/// Background work never reads an online-only placeholder. An explicit
/// foreground open may read it (R-FS-1).
#[cfg(test)]
pub fn may_read_source(online_only: bool, background: bool) -> bool {
    !(online_only && background)
}

pub fn validate_edge(edge: u32) -> Result<(), String> {
    if edge == 0 || edge > SPECIAL_MAX_EDGE {
        return Err("special_view.bad_request".to_string());
    }
    Ok(())
}

fn codec_required() -> String {
    "special_view.codec_required".to_string()
}

fn ensure_com() -> bool {
    // SAFETY: CoUninitialize is called exactly when this call succeeded.
    unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED).0 >= 0 }
}

fn convert_source(
    factory: &IWICImagingFactory,
    source: &IWICBitmapSource,
    edge: u32,
) -> Result<DecodedPixels, String> {
    let mut width = 0u32;
    let mut height = 0u32;
    // SAFETY: both pointers are local and valid for the call.
    unsafe { source.GetSize(&mut width, &mut height) }
        .map_err(|_| "special_view.corrupt".to_string())?;
    if width == 0
        || height == 0
        || u64::from(width) * u64::from(height) > SPECIAL_MAX_DECODED_PIXELS
    {
        return Err("special_view.too_large".to_string());
    }
    let scale = (f64::from(edge) / f64::from(width.max(height))).min(1.0);
    let target_width = ((f64::from(width) * scale).round() as u32).max(1);
    let target_height = ((f64::from(height) * scale).round() as u32).max(1);

    // SAFETY: the converter is initialized from a live source and writes a
    // bounded RGBA buffer below.
    unsafe {
        let converter: IWICFormatConverter = factory
            .CreateFormatConverter()
            .map_err(|_| "special_view.corrupt".to_string())?;
        converter
            .Initialize(
                source,
                &GUID_WICPixelFormat32bppRGBA,
                WICBitmapDitherTypeNone,
                None,
                0.0,
                WICBitmapPaletteTypeCustom,
            )
            .map_err(|_| "special_view.corrupt".to_string())?;
        let scaler = factory
            .CreateBitmapScaler()
            .map_err(|_| "special_view.corrupt".to_string())?;
        scaler
            .Initialize(
                &converter,
                target_width,
                target_height,
                WICBitmapInterpolationModeFant,
            )
            .map_err(|_| "special_view.corrupt".to_string())?;
        let stride = target_width
            .checked_mul(4)
            .ok_or_else(|| "special_view.too_large".to_string())?;
        let length = stride
            .checked_mul(target_height)
            .ok_or_else(|| "special_view.too_large".to_string())? as usize;
        let mut rgba = vec![0u8; length];
        scaler
            .CopyPixels(std::ptr::null(), stride, &mut rgba)
            .map_err(|_| "special_view.corrupt".to_string())?;
        Ok(DecodedPixels {
            width: target_width,
            height: target_height,
            stride,
            rgba,
            original_width: width,
            original_height: height,
            orientation: 1,
        })
    }
}

fn decode_with_wic(
    source: &File,
    edge: u32,
    full_resolution: bool,
    kind: SpecialKind,
) -> Result<DecodedPixels, String> {
    use std::os::windows::io::AsRawHandle;
    validate_edge(edge)?;
    let initialized = ensure_com();
    // SAFETY: the file handle stays alive in `source`; all COM objects are
    // released before this function returns and COM is balanced below.
    let result = unsafe {
        (|| -> Result<DecodedPixels, String> {
            let factory: IWICImagingFactory =
                CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER)
                    .map_err(|_| codec_required())?;
            let decoder = factory
                .CreateDecoderFromFileHandle(
                    source.as_raw_handle() as usize,
                    std::ptr::null(),
                    WICDecodeMetadataCacheOnDemand,
                )
                .map_err(|_| codec_required())?;
            let preview = decoder
                .GetPreview()
                .or_else(|_| decoder.GetThumbnail())
                .ok();
            let plan = special_image_plan(kind, full_resolution, preview.is_some(), true);
            match plan {
                ImagePlan::EmbeddedPreview => {
                    convert_source(&factory, preview.as_ref().unwrap(), edge)
                }
                ImagePlan::FullFrame => {
                    let frame = decoder.GetFrame(0).map_err(|_| codec_required())?;
                    let source: IWICBitmapSource = frame
                        .cast()
                        .map_err(|_| "special_view.corrupt".to_string())?;
                    convert_source(&factory, &source, edge)
                }
                ImagePlan::CodecRequired => Err(codec_required()),
            }
        })()
    };
    if initialized {
        // SAFETY: balanced with the successful CoInitializeEx above.
        unsafe { CoUninitialize() };
    }
    result
}

/// E7: decode an embedded preview or a full frame into bounded RGBA.
pub fn decode_special_image(
    source: &File,
    kind: SpecialKind,
    edge: u32,
    full_resolution: bool,
) -> Result<DecodedPixels, String> {
    if !matches!(kind, SpecialKind::Raw | SpecialKind::CodecImage) {
        return Err("special_view.bad_request".to_string());
    }
    decode_with_wic(source, edge, full_resolution, kind)
}

/// Encode the bounded RGBA result as PNG for the cache/lease. The output is
/// capped; a larger frame is refused instead of silently lowering quality.
pub fn encode_png_rgba(pixels: &DecodedPixels) -> Result<Vec<u8>, String> {
    if pixels.rgba.len() != (pixels.stride as usize) * (pixels.height as usize)
        || pixels.stride != pixels.width * 4
    {
        return Err("special_view.corrupt".to_string());
    }
    let initialized = ensure_com();
    let result = unsafe {
        (|| -> windows::core::Result<Vec<u8>> {
            use windows::Win32::System::Com::STREAM_SEEK_SET;
            let factory: IWICImagingFactory =
                CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER)?;
            let bitmap = factory.CreateBitmapFromMemory(
                pixels.width,
                pixels.height,
                &GUID_WICPixelFormat32bppRGBA,
                pixels.stride,
                &pixels.rgba,
            )?;
            let source: IWICBitmapSource = bitmap.cast()?;
            let converter: IWICFormatConverter = factory.CreateFormatConverter()?;
            converter.Initialize(
                &source,
                &GUID_WICPixelFormat32bppBGRA,
                WICBitmapDitherTypeNone,
                None,
                0.0,
                WICBitmapPaletteTypeCustom,
            )?;
            let stream = super::bounded_stream::bounded(
                CreateStreamOnHGlobal(windows::Win32::Foundation::HGLOBAL::default(), true)?,
                SPECIAL_MAX_PREVIEW_BYTES,
            );
            let encoder = factory.CreateEncoder(&GUID_ContainerFormatPng, std::ptr::null())?;
            encoder.Initialize(&stream, WICBitmapEncoderNoCache)?;
            let mut frame: Option<windows::Win32::Graphics::Imaging::IWICBitmapFrameEncode> = None;
            encoder.CreateNewFrame(&mut frame, std::ptr::null_mut())?;
            let frame = frame.ok_or_else(|| {
                windows::core::Error::from_hresult(windows::Win32::Foundation::E_FAIL)
            })?;
            frame.Initialize(None)?;
            frame.SetSize(pixels.width, pixels.height)?;
            let mut format = GUID_WICPixelFormat32bppBGRA;
            frame.SetPixelFormat(&mut format)?;
            frame.WriteSource(&converter, std::ptr::null())?;
            frame.Commit()?;
            encoder.Commit()?;
            stream.Commit(windows::Win32::System::Com::STGC_DEFAULT)?;
            let mut info = windows::Win32::System::Com::STATSTG::default();
            stream.Stat(&mut info, windows::Win32::System::Com::STATFLAG_NONAME)?;
            if info.cbSize > SPECIAL_MAX_PREVIEW_BYTES {
                return Err(windows::core::Error::from_hresult(
                    windows::Win32::Foundation::E_FAIL,
                ));
            }
            stream.Seek(0, STREAM_SEEK_SET, None)?;
            let mut bytes = Vec::with_capacity(info.cbSize as usize);
            let mut remaining = info.cbSize;
            let mut buffer = [0u8; 65536];
            while remaining > 0 {
                let mut read = 0u32;
                let count = remaining.min(buffer.len() as u64) as u32;
                stream
                    .Read(buffer.as_mut_ptr().cast(), count, Some(&mut read))
                    .ok()?;
                if read == 0 {
                    return Err(windows::core::Error::from_hresult(
                        windows::Win32::Foundation::E_FAIL,
                    ));
                }
                bytes.extend_from_slice(&buffer[..read as usize]);
                remaining -= u64::from(read);
            }
            Ok(bytes)
        })()
    };
    if initialized {
        unsafe { CoUninitialize() };
    }
    let bytes = result.map_err(|_| "special_view.unsupported".to_string())?;
    validate_png(&bytes).map(|_| bytes)
}

/// PNG signature + IHDR dimensions. Rejects a body that is not a bounded
/// PNG even when a helper claimed it was one.
pub fn validate_png(bytes: &[u8]) -> Result<(u32, u32), String> {
    if bytes.len() < 33 || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") || &bytes[12..16] != b"IHDR" {
        return Err("special_view.corrupt".to_string());
    }
    let width = u32::from_be_bytes(bytes[16..20].try_into().unwrap());
    let height = u32::from_be_bytes(bytes[20..24].try_into().unwrap());
    if width == 0
        || height == 0
        || u64::from(width) * u64::from(height) > SPECIAL_MAX_DECODED_PIXELS
    {
        return Err("special_view.too_large".to_string());
    }
    Ok((width, height))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn raw_preview_plan_uses_the_embedded_preview_first() {
        assert_eq!(
            special_image_plan(SpecialKind::Raw, false, true, true),
            ImagePlan::EmbeddedPreview
        );
        assert_eq!(
            special_image_plan(SpecialKind::Raw, false, false, true),
            ImagePlan::CodecRequired
        );
        assert_eq!(
            special_image_plan(SpecialKind::Raw, true, true, true),
            ImagePlan::FullFrame
        );
        assert_eq!(
            special_image_plan(SpecialKind::Raw, true, true, false),
            ImagePlan::CodecRequired
        );
    }

    #[test]
    fn codec_image_uses_its_frame_when_no_preview_exists() {
        assert_eq!(
            special_image_plan(SpecialKind::CodecImage, false, false, true),
            ImagePlan::FullFrame
        );
    }

    #[test]
    fn online_only_background_reads_zero_content() {
        assert!(!may_read_source(true, true));
        assert!(may_read_source(true, false));
        assert!(may_read_source(false, true));
    }

    #[test]
    fn edges_and_png_headers_are_bounded() {
        assert!(validate_edge(0).is_err());
        assert!(validate_edge(SPECIAL_MAX_EDGE + 1).is_err());
        assert!(validate_png(b"not a png").is_err());
        let mut png = vec![0u8; 33];
        png[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
        png[12..16].copy_from_slice(b"IHDR");
        png[16..20].copy_from_slice(&1u32.to_be_bytes());
        png[20..24].copy_from_slice(&1u32.to_be_bytes());
        assert_eq!(validate_png(&png), Ok((1, 1)));
    }
}
