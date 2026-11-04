//! Bounded PNG encoding for thumbnails (Step 07a, D2).
//!
//! WIC writes through `bounded_stream`, so a broken encoder can never grow
//! the result past the 4 MiB cap. The bytes then travel to the helper's
//! owned staging file; the app never receives raw pixels over IPC.

use crate::thumbnail_decode::DecodedPixels;

/// Largest PNG a thumbnail result may contain.
pub const MAX_OUTPUT_BYTES: u64 = 4 * 1024 * 1024;

/// Encode RGBA pixels as PNG. `max_bytes` is a hard limit.
pub fn encode_png(pixels: &DecodedPixels, max_bytes: u64) -> Result<Vec<u8>, String> {
    if max_bytes == 0 || max_bytes > MAX_OUTPUT_BYTES {
        return Err("thumbnail.bad_request".to_string());
    }
    if pixels.width == 0 || pixels.height == 0 {
        return Err("thumbnail.too_large".to_string());
    }
    let expected_stride = pixels
        .width
        .checked_mul(4)
        .ok_or_else(|| "thumbnail.too_large".to_string())?;
    let expected_len = (expected_stride as u64)
        .checked_mul(u64::from(pixels.height))
        .ok_or_else(|| "thumbnail.too_large".to_string())?;
    if pixels.stride != expected_stride || pixels.rgba.len() as u64 != expected_len {
        return Err("thumbnail.bad_request".to_string());
    }
    encode_bytes(pixels, max_bytes)
}

#[cfg(windows)]
fn encode_bytes(pixels: &DecodedPixels, max_bytes: u64) -> Result<Vec<u8>, String> {
    use windows::core::Interface;
    use windows::Win32::Foundation::HGLOBAL;
    use windows::Win32::Graphics::Imaging::{
        CLSID_WICImagingFactory, GUID_ContainerFormatPng, GUID_WICPixelFormat32bppBGRA,
        IWICBitmapSource, IWICImagingFactory, WICBitmapEncoderNoCache,
    };
    use windows::Win32::System::Com::StructuredStorage::CreateStreamOnHGlobal;
    use windows::Win32::System::Com::{
        CoCreateInstance, CLSCTX_INPROC_SERVER, STATFLAG_NONAME, STATSTG, STREAM_SEEK_SET,
    };

    let _com = crate::thumbnail_decode::ComGuard::init()?;
    // SAFETY: every COM object is local and initialized before use; the
    // bounded stream enforces the size cap on every write and resize.
    unsafe {
        let factory: IWICImagingFactory =
            CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER)
                .map_err(|_| "thumbnail.failed".to_string())?;
        let mut bgra = pixels.rgba.clone();
        for pixel in bgra.as_chunks_mut::<4>().0 {
            pixel.swap(0, 2);
        }
        let bitmap = factory
            .CreateBitmapFromMemory(
                pixels.width,
                pixels.height,
                &GUID_WICPixelFormat32bppBGRA,
                pixels.stride,
                &bgra,
            )
            .map_err(|_| "thumbnail.failed".to_string())?;
        let stream = crate::bounded_stream::bounded(
            CreateStreamOnHGlobal(HGLOBAL::default(), true)
                .map_err(|_| "thumbnail.failed".to_string())?,
            max_bytes,
        );
        let encoder = factory
            .CreateEncoder(&GUID_ContainerFormatPng, std::ptr::null())
            .map_err(|_| "thumbnail.failed".to_string())?;
        encoder
            .Initialize(&stream, WICBitmapEncoderNoCache)
            .map_err(|_| "thumbnail.failed".to_string())?;
        let mut frame = None;
        encoder
            .CreateNewFrame(&mut frame, std::ptr::null_mut())
            .map_err(|_| "thumbnail.failed".to_string())?;
        let frame = frame.ok_or_else(|| "thumbnail.failed".to_string())?;
        frame
            .Initialize(None)
            .map_err(|_| "thumbnail.failed".to_string())?;
        frame
            .SetSize(pixels.width, pixels.height)
            .map_err(|_| "thumbnail.failed".to_string())?;
        let mut format = GUID_WICPixelFormat32bppBGRA;
        frame
            .SetPixelFormat(&mut format)
            .map_err(|_| "thumbnail.failed".to_string())?;
        let source: IWICBitmapSource = bitmap.cast().map_err(|_| "thumbnail.failed".to_string())?;
        frame
            .WriteSource(&source, std::ptr::null())
            .map_err(|_| "thumbnail.failed".to_string())?;
        frame.Commit().map_err(|_| "thumbnail.failed".to_string())?;
        encoder
            .Commit()
            .map_err(|_| "thumbnail.failed".to_string())?;

        let mut stat = STATSTG::default();
        stream
            .Stat(&mut stat, STATFLAG_NONAME)
            .map_err(|_| "thumbnail.failed".to_string())?;
        if stat.cbSize == 0 || stat.cbSize > max_bytes {
            return Err("thumbnail.too_large".to_string());
        }
        stream
            .Seek(0, STREAM_SEEK_SET, None)
            .map_err(|_| "thumbnail.failed".to_string())?;
        let mut bytes = vec![0u8; stat.cbSize as usize];
        let mut read = 0u32;
        stream
            .Read(
                bytes.as_mut_ptr().cast(),
                stat.cbSize as u32,
                Some(&mut read),
            )
            .ok()
            .map_err(|_| "thumbnail.failed".to_string())?;
        if read as usize != bytes.len() {
            return Err("thumbnail.failed".to_string());
        }
        Ok(bytes)
    }
}

#[cfg(not(windows))]
fn encode_bytes(_pixels: &DecodedPixels, _max_bytes: u64) -> Result<Vec<u8>, String> {
    Err("thumbnail.failed".to_string())
}

#[cfg(test)]
mod tests {
    use super::{encode_png, MAX_OUTPUT_BYTES};
    use crate::thumbnail_decode::{decode_pixels, DecodedPixels};

    fn pixels(width: u32, height: u32) -> DecodedPixels {
        let stride = width * 4;
        let mut rgba = vec![0u8; (stride * height) as usize];
        for pixel in rgba.as_chunks_mut::<4>().0 {
            pixel[0] = 255;
            pixel[1] = 0;
            pixel[2] = 0;
            pixel[3] = 255;
        }
        DecodedPixels {
            width,
            height,
            stride,
            rgba,
            original_width: width,
            original_height: height,
            orientation: 1,
        }
    }

    #[test]
    fn refuses_an_inconsistent_pixel_buffer() {
        let mut decoded = pixels(4, 4);
        decoded.stride = 8;
        assert_eq!(
            encode_png(&decoded, MAX_OUTPUT_BYTES),
            Err("thumbnail.bad_request".to_string())
        );
    }

    #[cfg(windows)]
    #[test]
    fn encodes_and_decodes_the_required_sizes() {
        let dir = tempfile::tempdir().unwrap();
        for (width, height, edge, expected) in [
            (400u32, 200u32, 128u32, (128u32, 64u32)),
            (20, 10, 64, (20, 10)),
        ] {
            let png = encode_png(&pixels(width, height), MAX_OUTPUT_BYTES).unwrap();
            assert!(png.starts_with(&[0x89, b'P', b'N', b'G', 13, 10, 26, 10]));
            let path = dir.path().join(format!("{width}x{height}.png"));
            std::fs::write(&path, &png).unwrap();
            let file = std::fs::File::open(&path).unwrap();
            let decoded = decode_pixels(&file, edge, 100_000_000).unwrap();
            assert_eq!((decoded.width, decoded.height), expected);
            assert_eq!(&decoded.rgba[..4], &[255, 0, 0, 255]);
            assert_eq!(
                (decoded.original_width, decoded.original_height),
                (width, height)
            );
        }
    }
}
