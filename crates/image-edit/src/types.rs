//! Native mirror of `src/image-edit/types.ts` (interface `image-document-1`).
//! Values, bounds and error codes are identical; field names are snake_case
//! on both sides.

use serde::{Deserialize, Serialize};

pub const TILE_EDGE: u32 = 256;
pub const MAX_IMAGE_PIXELS: u64 = 100_000_000;
pub const MAX_IMAGE_EDGE: u32 = 32_768;
pub const MAX_OVERLAYS: usize = 10_000;
pub const MAX_OVERLAY_POINTS: usize = 100_000;
pub const MAX_BRUSH_WIDTH: f64 = 512.0;

pub const BAD_REQUEST: &str = "image_edit.bad_request";
pub const TOO_LARGE: &str = "image_edit.too_large";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ImageSize {
    pub width: u32,
    pub height: u32,
}

impl ImageSize {
    pub fn pixels(self) -> u64 {
        u64::from(self.width) * u64::from(self.height)
    }

    pub fn validate(self) -> Result<(), String> {
        if self.width == 0 || self.height == 0 {
            return Err(BAD_REQUEST.to_string());
        }
        if self.width > MAX_IMAGE_EDGE
            || self.height > MAX_IMAGE_EDGE
            || self.pixels() > MAX_IMAGE_PIXELS
        {
            return Err(TOO_LARGE.to_string());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

impl Point {
    pub fn validate(self) -> Result<(), String> {
        if !self.x.is_finite() || !self.y.is_finite() {
            return Err(BAD_REQUEST.to_string());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Rect {
    pub fn validate(self) -> Result<(), String> {
        if !self.x.is_finite()
            || !self.y.is_finite()
            || !self.width.is_finite()
            || !self.height.is_finite()
            || self.width < 1.0
            || self.height < 1.0
        {
            return Err(BAD_REQUEST.to_string());
        }
        Ok(())
    }

    pub fn validate_integer(self) -> Result<(), String> {
        if !self.x.is_finite()
            || !self.y.is_finite()
            || !self.width.is_finite()
            || !self.height.is_finite()
        {
            return Err(BAD_REQUEST.to_string());
        }
        if self.x.fract() != 0.0
            || self.y.fract() != 0.0
            || self.width.fract() != 0.0
            || self.height.fract() != 0.0
        {
            return Err(BAD_REQUEST.to_string());
        }
        if self.width < 1.0 || self.height < 1.0 {
            return Err(BAD_REQUEST.to_string());
        }
        Ok(())
    }
}

/// Maps `(x, y)` to `(a*x + c*y + e, b*x + d*y + f)`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Affine2D {
    pub a: f64,
    pub b: f64,
    pub c: f64,
    pub d: f64,
    pub e: f64,
    pub f: f64,
}

impl Default for Affine2D {
    fn default() -> Self {
        Self {
            a: 1.0,
            b: 0.0,
            c: 0.0,
            d: 1.0,
            e: 0.0,
            f: 0.0,
        }
    }
}

impl Affine2D {
    pub fn determinant(self) -> f64 {
        self.a * self.d - self.b * self.c
    }

    pub fn map(self, point: Point) -> Point {
        Point {
            x: self.a * point.x + self.c * point.y + self.e,
            y: self.b * point.x + self.d * point.y + self.f,
        }
    }

    pub fn inverse(self) -> Result<Self, String> {
        let det = self.determinant();
        if !det.is_finite() || det.abs() < 1e-12 {
            return Err(BAD_REQUEST.to_string());
        }
        let a = self.d / det;
        let b = -self.b / det;
        let c = -self.c / det;
        let d = self.a / det;
        Ok(Self {
            a,
            b,
            c,
            d,
            e: -(a * self.e + c * self.f),
            f: -(b * self.e + d * self.f),
        })
    }

    pub fn validate(self, committed: bool) -> Result<(), String> {
        let values = [self.a, self.b, self.c, self.d, self.e, self.f];
        if values.iter().any(|value| !value.is_finite()) {
            return Err(BAD_REQUEST.to_string());
        }
        if committed && self.determinant().abs() < 1e-12 {
            return Err(BAD_REQUEST.to_string());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TileRef {
    pub id: String,
    pub tile_x: u32,
    pub tile_y: u32,
    pub width: u32,
    pub height: u32,
    pub byte_len: u64,
    pub generation: u64,
}

impl TileRef {
    pub fn validate(&self) -> Result<(), String> {
        if self.id.len() != 36 {
            return Err(BAD_REQUEST.to_string());
        }
        if self.width == 0 || self.height == 0 || self.width > TILE_EDGE || self.height > TILE_EDGE
        {
            return Err(BAD_REQUEST.to_string());
        }
        let expected = u64::from(self.width) * u64::from(self.height) * 4;
        if self.byte_len != expected || self.generation == 0 {
            return Err(BAD_REQUEST.to_string());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AdjustmentPreset {
    Original,
    Vivid,
    Warm,
    Cool,
    Bw,
    Sepia,
    Custom,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ImageAdjustments {
    pub brightness: f64,
    pub contrast: f64,
    pub saturation: f64,
    pub warmth: f64,
    pub sharpness: f64,
    pub blur: f64,
    pub preset: AdjustmentPreset,
}

impl Default for ImageAdjustments {
    fn default() -> Self {
        Self {
            brightness: 0.0,
            contrast: 0.0,
            saturation: 0.0,
            warmth: 0.0,
            sharpness: 0.0,
            blur: 0.0,
            preset: AdjustmentPreset::Original,
        }
    }
}

impl ImageAdjustments {
    pub fn validate(&self) -> Result<(), String> {
        for value in [self.brightness, self.contrast, self.saturation, self.warmth] {
            if !value.is_finite() || !(-1.0..=1.0).contains(&value) {
                return Err(BAD_REQUEST.to_string());
            }
        }
        if !self.sharpness.is_finite() || !(0.0..=1.0).contains(&self.sharpness) {
            return Err(BAD_REQUEST.to_string());
        }
        if !self.blur.is_finite() || !(0.0..=64.0).contains(&self.blur) {
            return Err(BAD_REQUEST.to_string());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ImageGeometry {
    pub crop: Rect,
    /// 0..=3 clockwise quarter turns.
    pub quarter_turns: u8,
    /// -45..=45, in 0.1-degree increments.
    pub angle_degrees: f64,
    pub flip_x: bool,
    pub flip_y: bool,
    pub output_size: ImageSize,
}

impl ImageGeometry {
    pub fn default_for(size: ImageSize) -> Result<Self, String> {
        size.validate()?;
        Ok(Self {
            crop: Rect {
                x: 0.0,
                y: 0.0,
                width: f64::from(size.width),
                height: f64::from(size.height),
            },
            quarter_turns: 0,
            angle_degrees: 0.0,
            flip_x: false,
            flip_y: false,
            output_size: size,
        })
    }

    pub fn validate(&self, source: ImageSize) -> Result<(), String> {
        self.crop.validate_integer()?;
        if self.quarter_turns > 3 {
            return Err(BAD_REQUEST.to_string());
        }
        if !self.angle_degrees.is_finite()
            || !(-45.0..=45.0).contains(&self.angle_degrees)
            || (self.angle_degrees * 10.0 - (self.angle_degrees * 10.0).round()).abs() > 1e-9
        {
            return Err(BAD_REQUEST.to_string());
        }
        self.output_size.validate()?;
        if self.crop.x < 0.0
            || self.crop.y < 0.0
            || self.crop.x + self.crop.width > f64::from(source.width)
            || self.crop.y + self.crop.height > f64::from(source.height)
        {
            return Err(BAD_REQUEST.to_string());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OverlayKind {
    Stroke,
    Arrow,
    Rectangle,
    Ellipse,
    Text,
    Highlight,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ImageOverlay {
    pub id: String,
    pub kind: OverlayKind,
    pub points: Vec<Point>,
    pub bounds: Rect,
    pub color: [u8; 4],
    pub width: f64,
    pub opacity: f64,
    pub text: Option<String>,
    pub font_size: Option<f64>,
    pub fill: Option<[u8; 4]>,
}

impl ImageOverlay {
    pub fn validate(&self, canvas: ImageSize) -> Result<(), String> {
        if self.id.len() != 36 || self.points.len() > MAX_OVERLAY_POINTS {
            return Err(BAD_REQUEST.to_string());
        }
        let minimum = if self.kind == OverlayKind::Text { 1 } else { 2 };
        if self.points.len() < minimum {
            return Err(BAD_REQUEST.to_string());
        }
        for point in &self.points {
            point.validate()?;
            if point.x < 0.0
                || point.y < 0.0
                || point.x > f64::from(canvas.width)
                || point.y > f64::from(canvas.height)
            {
                return Err(BAD_REQUEST.to_string());
            }
        }
        self.bounds.validate()?;
        if self.bounds.x + self.bounds.width > f64::from(canvas.width)
            || self.bounds.y + self.bounds.height > f64::from(canvas.height)
        {
            return Err(BAD_REQUEST.to_string());
        }
        if !self.width.is_finite() || !(1.0..=MAX_BRUSH_WIDTH).contains(&self.width) {
            return Err(BAD_REQUEST.to_string());
        }
        if !self.opacity.is_finite() || !(0.0..=1.0).contains(&self.opacity) {
            return Err(BAD_REQUEST.to_string());
        }
        if self.kind == OverlayKind::Text {
            let text = self.text.as_deref().unwrap_or("");
            if text.chars().count() > 10_000 {
                return Err(BAD_REQUEST.to_string());
            }
            let size = self.font_size.unwrap_or(0.0);
            if !size.is_finite() || !(1.0..=512.0).contains(&size) {
                return Err(BAD_REQUEST.to_string());
            }
        }
        Ok(())
    }
}
