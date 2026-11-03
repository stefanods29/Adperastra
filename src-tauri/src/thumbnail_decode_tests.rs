use super::{
    orientation_dimensions, scaled_dimensions, transform_for_orientation, validate_dimensions,
};

#[test]
fn fits_without_upscaling() {
    assert_eq!(scaled_dimensions(400, 200, 128), (128, 64));
    assert_eq!(scaled_dimensions(200, 400, 128), (64, 128));
    assert_eq!(scaled_dimensions(20, 10, 64), (20, 10));
    assert_eq!(scaled_dimensions(256, 256, 256), (256, 256));
    assert_eq!(scaled_dimensions(1000, 1, 256), (256, 1));
}

#[test]
fn orientation_swaps_the_axes_and_picks_one_transform() {
    assert_eq!(orientation_dimensions(200, 400, 6), (400, 200));
    assert_eq!(orientation_dimensions(200, 400, 1), (200, 400));
    assert_eq!(transform_for_orientation(1), 0);
    assert_eq!(transform_for_orientation(6), 1);
    assert_eq!(transform_for_orientation(3), 2);
    assert_eq!(transform_for_orientation(8), 3);
    assert_eq!(transform_for_orientation(2), 8);
}

#[test]
fn zero_and_oversized_frames_are_refused_before_pixels() {
    assert_eq!(
        validate_dimensions(0, 10, 100_000_000),
        Err("thumbnail.too_large".to_string())
    );
    assert_eq!(
        validate_dimensions(65_537, 1, 100_000_000),
        Err("thumbnail.too_large".to_string())
    );
    assert_eq!(
        validate_dimensions(20_000, 20_000, 100_000_000),
        Err("thumbnail.too_large".to_string())
    );
    assert!(validate_dimensions(400, 200, 100_000_000).is_ok());
}

#[cfg(windows)]
#[test]
fn wic_exif_transforms_put_each_asymmetric_pixel_in_the_expected_place() {
    use windows::core::Interface;
    use windows::Win32::Graphics::Imaging::{
        CLSID_WICImagingFactory, GUID_WICPixelFormat32bppBGRA, IWICBitmapSource,
        IWICImagingFactory, WICBitmapTransformOptions,
    };
    use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER};
    let _com = super::ComGuard::init().unwrap();
    // SAFETY: all local COM interfaces remain on this initialized thread;
    // input and output slices have their exact stride*height lengths.
    unsafe {
        let factory: IWICImagingFactory =
            CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER).unwrap();
        let pixels = (1..=6u8)
            .flat_map(|label| [0, 0, label, 255])
            .collect::<Vec<_>>();
        let bitmap = factory
            .CreateBitmapFromMemory(2, 3, &GUID_WICPixelFormat32bppBGRA, 8, &pixels)
            .unwrap();
        let source: IWICBitmapSource = bitmap.cast().unwrap();
        let expected = [
            [1, 2, 3, 4, 5, 6],
            [2, 1, 4, 3, 6, 5],
            [6, 5, 4, 3, 2, 1],
            [5, 6, 3, 4, 1, 2],
            [1, 3, 5, 2, 4, 6],
            [5, 3, 1, 6, 4, 2],
            [6, 4, 2, 5, 3, 1],
            [2, 4, 6, 1, 3, 5],
        ];
        for orientation in 1..=8u8 {
            let rotator = factory.CreateBitmapFlipRotator().unwrap();
            rotator
                .Initialize(
                    &source,
                    WICBitmapTransformOptions(super::transform_for_orientation(orientation) as i32),
                )
                .unwrap();
            let (width, height) = super::orientation_dimensions(2, 3, orientation);
            let mut actual = vec![0u8; (width * height * 4) as usize];
            rotator
                .CopyPixels(std::ptr::null(), width * 4, &mut actual)
                .unwrap();
            let labels = actual
                .as_chunks::<4>()
                .0
                .iter()
                .map(|p| p[2])
                .collect::<Vec<_>>();
            assert_eq!(
                labels,
                expected[(orientation - 1) as usize],
                "EXIF {orientation}"
            );
        }
    }
}
