//! Geometry pipeline: crop -> quarter turns -> flips -> angle -> resize.

use crate::types::{Affine2D, ImageGeometry, ImageSize, Point, Rect, BAD_REQUEST, TOO_LARGE};

pub fn rotated_size(size: ImageSize, quarter_turns: u8) -> Result<ImageSize, String> {
    if quarter_turns > 3 {
        return Err(BAD_REQUEST.to_string());
    }
    Ok(if quarter_turns.is_multiple_of(2) {
        size
    } else {
        ImageSize {
            width: size.height,
            height: size.width,
        }
    })
}

pub fn angle_bounds(size: ImageSize, degrees: f64) -> Result<ImageSize, String> {
    if !degrees.is_finite() {
        return Err(BAD_REQUEST.to_string());
    }
    let radians = degrees.to_radians();
    let cos = radians.cos().abs();
    let sin = radians.sin().abs();
    let width = (f64::from(size.width) * cos + f64::from(size.height) * sin - 1e-9).ceil();
    let height = (f64::from(size.width) * sin + f64::from(size.height) * cos - 1e-9).ceil();
    Ok(ImageSize {
        width: width.max(1.0) as u32,
        height: height.max(1.0) as u32,
    })
}

pub fn normalize_crop(crop: Rect, source: ImageSize) -> Result<Rect, String> {
    if !crop.x.is_finite()
        || !crop.y.is_finite()
        || !crop.width.is_finite()
        || !crop.height.is_finite()
    {
        return Err(BAD_REQUEST.to_string());
    }
    let mut width = crop.width.round().max(1.0).min(f64::from(source.width));
    let mut height = crop.height.round().max(1.0).min(f64::from(source.height));
    let mut x = crop.x.round().max(0.0);
    let mut y = crop.y.round().max(0.0);
    if x + width > f64::from(source.width) {
        x = (f64::from(source.width) - width).max(0.0);
    }
    if y + height > f64::from(source.height) {
        y = (f64::from(source.height) - height).max(0.0);
    }
    if x + width > f64::from(source.width) {
        width = f64::from(source.width) - x;
    }
    if y + height > f64::from(source.height) {
        height = f64::from(source.height) - y;
    }
    if width < 1.0 || height < 1.0 {
        return Err(BAD_REQUEST.to_string());
    }
    Ok(Rect {
        x,
        y,
        width,
        height,
    })
}

pub fn natural_output_size(
    geometry: &ImageGeometry,
    _source: ImageSize,
) -> Result<ImageSize, String> {
    let cropped = ImageSize {
        width: geometry.crop.width as u32,
        height: geometry.crop.height as u32,
    };
    if cropped.width == 0 || cropped.height == 0 {
        return Err(BAD_REQUEST.to_string());
    }
    let turned = rotated_size(cropped, geometry.quarter_turns)?;
    angle_bounds(turned, geometry.angle_degrees)
}

/// D4 resize math. With `keep_aspect`, the missing side is derived.
pub fn resize_dimensions(
    source: ImageSize,
    width: Option<u32>,
    height: Option<u32>,
    keep_aspect: bool,
) -> Result<ImageSize, String> {
    source.validate()?;
    let (mut width, mut height) = match (width, height) {
        (None, None) => return Err(BAD_REQUEST.to_string()),
        (Some(0), None) => return Err(BAD_REQUEST.to_string()),
        (width, height) => (width, height),
    };
    if width == Some(0) || height == Some(0) {
        return Err(BAD_REQUEST.to_string());
    }
    if keep_aspect {
        if width.is_none() {
            width = Some(
                ((u64::from(source.width) * u64::from(height.unwrap_or(1)))
                    + u64::from(source.height) / 2)
                    / u64::from(source.height),
            )
            .map(|value| value.max(1) as u32);
        }
        if height.is_none() {
            height = Some(
                ((u64::from(source.height) * u64::from(width.unwrap_or(1)))
                    + u64::from(source.width) / 2)
                    / u64::from(source.width),
            )
            .map(|value| value.max(1) as u32);
        }
    } else {
        width.get_or_insert(source.width);
        height.get_or_insert(source.height);
    }
    let next = ImageSize {
        width: width.unwrap_or(1).max(1),
        height: height.unwrap_or(1).max(1),
    };
    next.validate()?;
    Ok(next)
}

fn crop_translate(crop: Rect) -> Affine2D {
    Affine2D {
        e: -crop.x,
        f: -crop.y,
        ..Affine2D::default()
    }
}

fn quarter_turn_affine(quarter_turns: u8, cropped: ImageSize) -> Affine2D {
    match quarter_turns {
        1 => Affine2D {
            a: 0.0,
            b: 1.0,
            c: -1.0,
            d: 0.0,
            e: f64::from(cropped.height),
            f: 0.0,
        },
        2 => Affine2D {
            a: -1.0,
            b: 0.0,
            c: 0.0,
            d: -1.0,
            e: f64::from(cropped.width),
            f: f64::from(cropped.height),
        },
        3 => Affine2D {
            a: 0.0,
            b: -1.0,
            c: 1.0,
            d: 0.0,
            e: 0.0,
            f: f64::from(cropped.width),
        },
        _ => Affine2D::default(),
    }
}

fn flip_affine(flip_x: bool, flip_y: bool, size: ImageSize) -> Affine2D {
    Affine2D {
        a: if flip_x { -1.0 } else { 1.0 },
        b: 0.0,
        c: 0.0,
        d: if flip_y { -1.0 } else { 1.0 },
        e: if flip_x { f64::from(size.width) } else { 0.0 },
        f: if flip_y { f64::from(size.height) } else { 0.0 },
    }
}

pub fn compose(outer: Affine2D, inner: Affine2D) -> Affine2D {
    Affine2D {
        a: outer.a * inner.a + outer.c * inner.b,
        b: outer.b * inner.a + outer.d * inner.b,
        c: outer.a * inner.c + outer.c * inner.d,
        d: outer.b * inner.c + outer.d * inner.d,
        e: outer.a * inner.e + outer.c * inner.f + outer.e,
        f: outer.b * inner.e + outer.d * inner.f + outer.f,
    }
}

pub fn source_to_output_affine(
    geometry: &ImageGeometry,
    source: ImageSize,
) -> Result<Affine2D, String> {
    geometry.validate(source)?;
    let cropped = ImageSize {
        width: geometry.crop.width as u32,
        height: geometry.crop.height as u32,
    };
    let turned = rotated_size(cropped, geometry.quarter_turns)?;
    let mut matrix = crop_translate(geometry.crop);
    matrix = compose(quarter_turn_affine(geometry.quarter_turns, cropped), matrix);
    matrix = compose(
        flip_affine(geometry.flip_x, geometry.flip_y, turned),
        matrix,
    );
    let bound = angle_bounds(turned, geometry.angle_degrees)?;
    let radians = geometry.angle_degrees.to_radians();
    let (cos, sin) = (radians.cos(), radians.sin());
    let cx = f64::from(turned.width) / 2.0;
    let cy = f64::from(turned.height) / 2.0;
    let rotate = Affine2D {
        a: cos,
        b: sin,
        c: -sin,
        d: cos,
        e: cx - cos * cx + sin * cy,
        f: cy - sin * cx - cos * cy,
    };
    let corners = [
        Point { x: 0.0, y: 0.0 },
        Point {
            x: f64::from(turned.width),
            y: 0.0,
        },
        Point {
            x: 0.0,
            y: f64::from(turned.height),
        },
        Point {
            x: f64::from(turned.width),
            y: f64::from(turned.height),
        },
    ];
    let mapped: Vec<Point> = corners.iter().map(|point| rotate.map(*point)).collect();
    let min_x = mapped
        .iter()
        .map(|point| point.x)
        .fold(f64::INFINITY, f64::min);
    let min_y = mapped
        .iter()
        .map(|point| point.y)
        .fold(f64::INFINITY, f64::min);
    let align = Affine2D {
        e: -min_x,
        f: -min_y,
        ..Affine2D::default()
    };
    matrix = compose(align, compose(rotate, matrix));
    let scale = Affine2D {
        a: f64::from(geometry.output_size.width) / f64::from(bound.width),
        d: f64::from(geometry.output_size.height) / f64::from(bound.height),
        ..Affine2D::default()
    };
    let matrix = compose(scale, matrix);
    matrix.validate(true)?;
    Ok(matrix)
}

pub fn output_to_source_affine(
    geometry: &ImageGeometry,
    source: ImageSize,
) -> Result<Affine2D, String> {
    source_to_output_affine(geometry, source)?.inverse()
}

pub fn validate_output(size: ImageSize) -> Result<(), String> {
    size.validate().map_err(|error| {
        if error == BAD_REQUEST {
            TOO_LARGE.to_string()
        } else {
            error
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn geometry(size: ImageSize) -> ImageGeometry {
        ImageGeometry::default_for(size).unwrap()
    }

    #[test]
    fn rotate90_3x2_becomes2x3() {
        let size = rotated_size(
            ImageSize {
                width: 3,
                height: 2,
            },
            1,
        )
        .unwrap();
        assert_eq!(
            size,
            ImageSize {
                width: 2,
                height: 3
            }
        );
    }

    #[test]
    fn resize400x200_width100_is100x50() {
        let size = resize_dimensions(
            ImageSize {
                width: 400,
                height: 200,
            },
            Some(100),
            None,
            true,
        )
        .unwrap();
        assert_eq!(
            size,
            ImageSize {
                width: 100,
                height: 50
            }
        );
    }

    #[test]
    fn crop_endexclusive_2x2() {
        let source = ImageSize {
            width: 4,
            height: 4,
        };
        let crop = normalize_crop(
            Rect {
                x: 1.0,
                y: 1.0,
                width: 2.0,
                height: 2.0,
            },
            source,
        )
        .unwrap();
        assert_eq!(crop.x, 1.0);
        assert_eq!(crop.y, 1.0);
        assert_eq!(crop.width, 2.0);
        assert_eq!(crop.height, 2.0);
        let mut next = geometry(source);
        next.crop = crop;
        assert_eq!(
            natural_output_size(&next, source).unwrap(),
            ImageSize {
                width: 2,
                height: 2
            }
        );
    }

    #[test]
    fn inverse_roundtrip_error_below_1e_6() {
        let source = ImageSize {
            width: 640,
            height: 480,
        };
        let mut next = geometry(source);
        next.crop = Rect {
            x: 20.0,
            y: 30.0,
            width: 400.0,
            height: 300.0,
        };
        next.quarter_turns = 1;
        next.angle_degrees = 12.3;
        next.flip_x = true;
        next.output_size = ImageSize {
            width: 300,
            height: 420,
        };
        let forward = source_to_output_affine(&next, source).unwrap();
        let inverse = output_to_source_affine(&next, source).unwrap();
        let point = Point { x: 123.5, y: 77.25 };
        let back = inverse.map(forward.map(point));
        assert!((back.x - point.x).abs() < 1e-6);
        assert!((back.y - point.y).abs() < 1e-6);
    }
}
