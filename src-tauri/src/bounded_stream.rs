//! A COM stream that limits writes and resizing before delegating to memory.
use windows::core::{implement, Error, Ref, Result, HRESULT};
use windows::Win32::Foundation::{E_FAIL, E_NOTIMPL};
use windows::Win32::System::Com::{
    ISequentialStream_Impl, IStream, IStream_Impl, LOCKTYPE, STATFLAG, STATSTG, STGC, STREAM_SEEK,
    STREAM_SEEK_CUR,
};

#[implement(IStream)]
struct BoundedStream {
    inner: IStream,
    max: u64,
    lock: std::sync::Mutex<()>,
}

pub fn bounded(inner: IStream, max: u64) -> IStream {
    BoundedStream {
        inner,
        max,
        lock: std::sync::Mutex::new(()),
    }
    .into()
}

impl ISequentialStream_Impl for BoundedStream_Impl {
    fn Read(&self, data: *mut std::ffi::c_void, count: u32, read: *mut u32) -> HRESULT {
        let Ok(_guard) = self.lock.lock() else {
            return E_FAIL;
        };
        unsafe {
            self.inner
                .Read(data, count, (!read.is_null()).then_some(read))
        }
    }
    fn Write(&self, data: *const std::ffi::c_void, count: u32, written: *mut u32) -> HRESULT {
        let Ok(_guard) = self.lock.lock() else {
            return E_FAIL;
        };
        let mut pos = 0;
        let result = unsafe { self.inner.Seek(0, STREAM_SEEK_CUR, Some(&mut pos)) };
        if let Err(e) = result {
            return e.code();
        }
        if pos
            .checked_add(u64::from(count))
            .is_none_or(|end| end > self.max)
        {
            if !written.is_null() {
                unsafe {
                    *written = 0;
                }
            }
            return E_FAIL;
        }
        unsafe {
            self.inner
                .Write(data, count, (!written.is_null()).then_some(written))
        }
    }
}

impl IStream_Impl for BoundedStream_Impl {
    fn Seek(&self, offset: i64, origin: STREAM_SEEK, position: *mut u64) -> Result<()> {
        let _guard = self.lock.lock().map_err(|_| Error::from_hresult(E_FAIL))?;
        unsafe {
            self.inner
                .Seek(offset, origin, (!position.is_null()).then_some(position))
        }
    }
    fn SetSize(&self, size: u64) -> Result<()> {
        let _guard = self.lock.lock().map_err(|_| Error::from_hresult(E_FAIL))?;
        if size > self.max {
            return Err(Error::from_hresult(E_FAIL));
        }
        unsafe { self.inner.SetSize(size) }
    }
    fn CopyTo(&self, _: Ref<'_, IStream>, _: u64, _: *mut u64, _: *mut u64) -> Result<()> {
        Err(Error::from_hresult(E_NOTIMPL))
    }
    fn Commit(&self, flags: &STGC) -> Result<()> {
        let _guard = self.lock.lock().map_err(|_| Error::from_hresult(E_FAIL))?;
        unsafe { self.inner.Commit(*flags) }
    }
    fn Revert(&self) -> Result<()> {
        Err(Error::from_hresult(E_NOTIMPL))
    }
    fn LockRegion(&self, _: u64, _: u64, _: &LOCKTYPE) -> Result<()> {
        Err(Error::from_hresult(E_NOTIMPL))
    }
    fn UnlockRegion(&self, _: u64, _: u64, _: u32) -> Result<()> {
        Err(Error::from_hresult(E_NOTIMPL))
    }
    fn Stat(&self, info: *mut STATSTG, flags: &STATFLAG) -> Result<()> {
        let _guard = self.lock.lock().map_err(|_| Error::from_hresult(E_FAIL))?;
        unsafe { self.inner.Stat(info, *flags) }
    }
    fn Clone(&self) -> Result<IStream> {
        Err(Error::from_hresult(E_NOTIMPL))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::core::Interface;
    use windows::Win32::Foundation::HGLOBAL;
    use windows::Win32::Graphics::Imaging::{
        CLSID_WICImagingFactory, GUID_ContainerFormatJpeg, GUID_ContainerFormatPng,
        GUID_WICPixelFormat32bppBGRA, IWICImagingFactory, WICBitmapEncoderNoCache,
    };
    use windows::Win32::System::Com::StructuredStorage::CreateStreamOnHGlobal;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED, STREAM_SEEK_SET,
    };

    #[test]
    fn rejects_writes_and_resize_past_limit_including_after_seek() {
        unsafe {
            CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok().unwrap();
            {
                let stream = bounded(CreateStreamOnHGlobal(HGLOBAL::default(), true).unwrap(), 4);
                let data = [1u8, 2, 3, 4, 5];
                let mut written = 0;
                assert!(stream
                    .Write(data.as_ptr().cast(), 4, Some(&mut written))
                    .is_ok());
                assert_eq!(written, 4);
                assert!(stream
                    .Write(data.as_ptr().cast(), 1, Some(&mut written))
                    .is_err());
                assert_eq!(written, 0);
                assert!(stream.SetSize(5).is_err());
                stream.Seek(3, STREAM_SEEK_SET, None).unwrap();
                assert!(stream
                    .Write(data.as_ptr().cast(), 2, Some(&mut written))
                    .is_err());
                stream.Seek(1, STREAM_SEEK_SET, None).unwrap();
                let replacement = [9u8, 8];
                assert!(stream
                    .Write(replacement.as_ptr().cast(), 2, Some(&mut written))
                    .is_ok());
                assert_eq!(written, 2);
                stream.Seek(0, STREAM_SEEK_SET, None).unwrap();
                let mut actual = [0u8; 4];
                let mut read = 0;
                stream
                    .Read(actual.as_mut_ptr().cast(), 4, Some(&mut read))
                    .ok()
                    .unwrap();
                assert_eq!(read, 4);
                assert_eq!(actual, [1, 9, 8, 4]);
                let mut stat = STATSTG::default();
                stream
                    .Stat(&mut stat, windows::Win32::System::Com::STATFLAG_NONAME)
                    .unwrap();
                assert_eq!(stat.cbSize, 4);
            }
            CoUninitialize();
        }
    }

    #[test]
    fn wic_encodes_png_and_jpeg_through_bounded_stream() {
        unsafe {
            CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok().unwrap();
            {
                let factory: IWICImagingFactory =
                    CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER).unwrap();
                let pixels = [255u8, 0, 0, 255];
                let bitmap = factory
                    .CreateBitmapFromMemory(1, 1, &GUID_WICPixelFormat32bppBGRA, 4, &pixels)
                    .unwrap();
                for container in [&GUID_ContainerFormatPng, &GUID_ContainerFormatJpeg] {
                    let stream = bounded(
                        CreateStreamOnHGlobal(HGLOBAL::default(), true).unwrap(),
                        1024 * 1024,
                    );
                    let encoder = factory.CreateEncoder(container, std::ptr::null()).unwrap();
                    encoder
                        .Initialize(&stream, WICBitmapEncoderNoCache)
                        .unwrap();
                    let mut frame = None;
                    encoder
                        .CreateNewFrame(&mut frame, std::ptr::null_mut())
                        .unwrap();
                    let frame = frame.unwrap();
                    frame.Initialize(None).unwrap();
                    frame.SetSize(1, 1).unwrap();
                    let mut format = GUID_WICPixelFormat32bppBGRA;
                    frame.SetPixelFormat(&mut format).unwrap();
                    frame
                        .WriteSource(
                            &bitmap
                                .cast::<windows::Win32::Graphics::Imaging::IWICBitmapSource>()
                                .unwrap(),
                            std::ptr::null(),
                        )
                        .unwrap();
                    frame.Commit().unwrap();
                    encoder.Commit().unwrap();
                    let mut stat = STATSTG::default();
                    stream
                        .Stat(&mut stat, windows::Win32::System::Com::STATFLAG_NONAME)
                        .unwrap();
                    assert!(stat.cbSize > 0);
                    stream.Seek(0, STREAM_SEEK_SET, None).unwrap();
                    let mut signature = [0u8; 2];
                    let mut read = 0;
                    stream
                        .Read(signature.as_mut_ptr().cast(), 2, Some(&mut read))
                        .ok()
                        .unwrap();
                    assert_eq!(read, 2);
                    assert_eq!(
                        signature,
                        if container == &GUID_ContainerFormatPng {
                            [0x89, b'P']
                        } else {
                            [0xff, 0xd8]
                        }
                    );
                    stream.Seek(0, STREAM_SEEK_SET, None).unwrap();
                    let decoder = factory
                        .CreateDecoderFromStream(
                            &stream,
                            std::ptr::null(),
                            windows::Win32::Graphics::Imaging::WICDecodeMetadataCacheOnLoad,
                        )
                        .unwrap();
                    let decoded = decoder.GetFrame(0).unwrap();
                    let (mut width, mut height) = (0, 0);
                    decoded.GetSize(&mut width, &mut height).unwrap();
                    assert_eq!((width, height), (1, 1));
                }
            }
            CoUninitialize();
        }
    }

    #[test]
    fn wic_rejects_a_truncated_synthetic_png() {
        unsafe {
            CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok().unwrap();
            {
                let factory: IWICImagingFactory =
                    CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER).unwrap();
                let stream = bounded(
                    CreateStreamOnHGlobal(HGLOBAL::default(), true).unwrap(),
                    1024,
                );
                let invalid_png = [0x89u8, b'P', b'N', b'G', 13, 10, 26, 10];
                stream
                    .Write(invalid_png.as_ptr().cast(), invalid_png.len() as u32, None)
                    .ok()
                    .unwrap();
                stream.Seek(0, STREAM_SEEK_SET, None).unwrap();
                let decoder = factory.CreateDecoderFromStream(
                    &stream,
                    std::ptr::null(),
                    windows::Win32::Graphics::Imaging::WICDecodeMetadataCacheOnLoad,
                );
                assert!(decoder.is_err() || decoder.unwrap().GetFrame(0).is_err());
            }
            CoUninitialize();
        }
    }
}
